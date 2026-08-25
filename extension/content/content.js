// Content script: panoul de acorduri de sub video, ceasul CT_TIME către offscreen,
// memorarea per melodie și redarea sincronizată din memorie.
//
// Două moduri:
//   „ascult”  — analiză live; acordurile sosesc prin CHORD_EVENT, cu ~1s întârziere
//               (netezirea are nevoie de context — vezi analyzer.js).
//   „memorat” — melodia a mai fost analizată; avem cronologia completă, deci afișăm exact
//               la timp și putem arăta și ce URMEAZĂ, ceea ce e tot ce contează la sing-along.
//
// YouTube e un SPA — navigarea între videouri NU reîncarcă pagina (vezi yt-navigate-finish).

import { createLogger } from '../lib/logger.js';
import { STR } from '../lib/strings.js';
import { transposeChord, bestCapo, NO_CHORD } from '../lib/music-theory.js';
import { renderChordDiagram, hasDiagram } from '../lib/diagrams.js';
import { detectSections } from '../lib/sections.js';

const log = createLogger('content');

const CACHE_VERSION = 1;
const MAX_CAPO = 7;
const RECENT_COUNT = 4;
const MIN_COVERAGE = 0.5;   // sub atât, structura găsită e prea firavă ca s-o arătăm
const ANNOUNCE_AHEAD = 3;   // cu câte secunde înainte anunțăm secțiunea următoare

// Banda rulantă: cât de lat vrem, în medie, un acord. Din el iese scara (pixeli/secundă), NU
// din lățimea panoului — așa se văd mereu ~6 acorduri, și pe melodii lente, și pe melodii dese,
// și nu citim dimensiuni din pagină în bucla de redare (ar declanșa recalcul de layout la 60fps).
const STRIP_TARGET_CHIP_PX = 92;
const STRIP_MIN_PX_PER_SEC = 14;
const STRIP_MAX_PX_PER_SEC = 80;
const STRIP_GAP_PX = 6;     // spațiul dintre cartonașe

const PRACTICE_RATES = [0.5, 0.75, 1];
const PRACTICE_MIN_SECONDS = 1; // sub atât n-are sens să pui ceva pe repetat

const state = {
  videoId: null,
  mode: 'idle',       // 'idle' | 'listening' | 'playback'
  chords: [],         // { t, label, confidence } — sortate după t
  capo: 0,            // poziția capo aleasă (0 = fără)
  suggestedCapo: 0,
  transpose: 0,       // schimbare de tonalitate cerută manual, în semitonuri
  analyzedAt: null,
  structure: null,    // rezultatul lui detectSections — doar în modul „memorat”
  clusterOrder: new Map(), // literă de grup -> „a câta bucată distinctă” e (pentru „Partea N”)
  stripPx: 40,        // scara benzii rulante, în pixeli pe secundă
  practice: null,     // { index, start, end, label, prevRate } — secțiunea pusă pe repetat
  practiceRate: 1,    // viteza aleasă pentru exersare (ține între secțiuni)
  practiceVideo: null, // elementul pe care ascultăm „timeupdate” cât timp exersăm
  clockVideo: null,   // elementul <video> pe care ascultăm „ended” cât timp analizăm
  lastClockT: 0,      // ultimul timp trimis prin CT_TIME (ca să prindem reluarea buclei)
  timeInterval: null,
  saveTimer: null,
  rafId: null,
  lastIndex: -1,
  lastSection: -1,
};

const ui = {};

init();

// --- Ciclu de viață -----------------------------------------------------------

function init() {
  state.videoId = getVideoId();
  syncPanelPresence();
  window.addEventListener('yt-navigate-finish', onNavigate);
  // Ultima șansă de salvare la închiderea paginii. E doar o plasă: scrierea în storage e
  // asincronă și s-ar putea să nu apuce. De aceea salvarea din mers, de mai sus, e cea care
  // contează cu adevărat.
  window.addEventListener('pagehide', () => { if (state.mode === 'listening') saveCache(); });
  chrome.runtime.onMessage.addListener(onMessage);
  log.info('ChordTab activ. videoId =', state.videoId);
  loadCache();
}

function getVideoId() {
  return new URLSearchParams(location.search).get('v');
}

function getVideo() {
  return document.querySelector('video.html5-main-video') || document.querySelector('video');
}

function isAdShowing() {
  return !!document.querySelector('.html5-video-player.ad-showing');
}

function onNavigate() {
  const newId = getVideoId();
  if (newId === state.videoId) return;
  log.info('Navigare SPA: video nou', newId);
  stopPractice(true); // altfel viteza aleasă pentru exersare rămâne pe melodia următoare
  stopClock();
  stopPlayback();
  Object.assign(state, {
    videoId: newId, mode: 'idle', chords: [], capo: 0, suggestedCapo: 0,
    transpose: 0, analyzedAt: null, structure: null, clusterOrder: new Map(),
    lastIndex: -1, lastSection: -1,
  });
  syncPanelPresence();
}

// Content scriptul se injectează pe TOT www.youtube.com, dar panoul are sens doar pe pagina
// unui video. Fără verificarea asta, pe pagina principală / căutare / canal `#below` nu există
// niciodată, iar panoul rămânea un dreptunghi plutitor fix peste conținut, cu un buton care
// oricum nu putea porni nimic.
function syncPanelPresence() {
  if (!state.videoId) {
    document.getElementById('chordtab-panel')?.remove();
    ui.panel = null;
    log.debug('Pagină fără video — nu construiesc panoul.');
    return;
  }
  buildPanel();
  loadCache();
}

// --- Memoria per melodie ------------------------------------------------------

function cacheKey(videoId = state.videoId) {
  return `chords:${videoId}`;
}

async function loadCache() {
  if (!state.videoId) return;
  try {
    const id = state.videoId;
    const key = cacheKey(id);
    const stored = (await chrome.storage.local.get(key))[key];
    // Citirea e asincronă, iar YouTube e un SPA: la două navigări rapide, promisiunea asta
    // se poate rezolva pe pagina ALTUI video. Fără garda de mai jos, acordurile melodiei
    // dinainte se aplicau peste cea curentă și porneau redarea, sincronizate pe timpul greșit.
    if (id !== state.videoId) {
      log.debug('S-a navigat între timp — memoria citită e a altui video.');
      return;
    }
    if (!stored || stored.version !== CACHE_VERSION || !stored.chords?.length) return;
    // Citirea din memorie e asincronă. Dacă între timp a pornit o analiză nouă, ea are
    // prioritate — altfel am șterge exact acordurile care tocmai se strâng.
    if (state.mode === 'listening') {
      log.debug('Analiza a pornit între timp — nu încarc memoria peste ea.');
      return;
    }
    // Plasă de siguranță pentru memoria scrisă de versiuni mai vechi, care puteau salva
    // lista nesortată după o derulare înapoi: căutarea binară din redare cere sortare.
    state.chords = [...stored.chords].sort((a, b) => a.t - b.t);
    state.analyzedAt = stored.analyzedAt;
    // Recalculăm sugestia din acorduri în loc s-o credem pe cea salvată: e ieftin și rămâne
    // corectă chiar dacă memoria a fost scrisă de o versiune mai veche sau din afară.
    state.suggestedCapo = bestCapo(stored.chords.map((c) => c.label), MAX_CAPO).capo;
    // NU o aplicăm singuri: pornim de la acordurile care se aud cu adevărat. Un capo aplicat
    // din oficiu ar arăta „D” la o melodie care sună „E”, ceea ce derutează pe cineva care
    // n-are capo la îndemână. Sugestia e doar marcată pe buton, la un click distanță.
    state.capo = 0;
    log.info(`Am găsit ${stored.chords.length} acorduri memorate pentru ${state.videoId}.`);
    startPlayback();
  } catch (err) {
    log.warn('Nu am putut citi memoria:', err?.message);
  }
}

// Salvăm din mers, nu doar la oprire. Altfel un refresh sau o navigare în timpul analizei
// pierde tot ce s-a găsit: content scriptul moare înainte să apuce să scrie, iar mesajul de
// oprire trimis de background ajunge la o pagină care nu mai există. Ăsta era motivul pentru
// care acordurile nu reapăreau după refresh.
function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => { saveCache(); }, 3000);
}

async function saveCache() {
  clearTimeout(state.saveTimer);
  if (!state.videoId || state.chords.length < 2) return;
  try {
    const suggestion = bestCapo(state.chords.map((c) => c.label), MAX_CAPO);
    state.suggestedCapo = suggestion.capo;
    await chrome.storage.local.set({
      [cacheKey()]: {
        version: CACHE_VERSION,
        analyzedAt: new Date().toISOString(),
        capo: suggestion.capo,
        chords: state.chords,
      },
    });
    log.info(`Am memorat ${state.chords.length} acorduri (capo sugerat ${suggestion.capo}).`);
  } catch (err) {
    log.warn('Nu am putut salva memoria:', err?.message);
  }
}

// --- Afișare ------------------------------------------------------------------

/** Acordul care se AUDE -> acordul pe care îl CÂNȚI, ținând cont de capo și transpoziție. */
function displayLabel(sounding) {
  if (!sounding || sounding === NO_CHORD) return sounding || STR.noChordsYet;
  return transposeChord(sounding, state.transpose - state.capo);
}

/** Indexul acordului care sună la momentul t (căutare binară). -1 dacă e înainte de primul. */
function chordIndexAt(t) {
  const a = state.chords;
  let lo = 0, hi = a.length - 1, res = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid].t <= t) { res = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return res;
}

/** Sare în melodie. 0,05 s peste momentul cerut, ca să cădem SIGUR în acordul / secțiunea lui. */
function seekTo(t) {
  const video = getVideo();
  if (video) video.currentTime = Math.max(0, t) + 0.05;
}

function buildPanel() {
  document.getElementById('chordtab-panel')?.remove();

  const panel = document.createElement('div');
  panel.id = 'chordtab-panel';
  panel.innerHTML = `
    <div class="ct-head">
      <span class="ct-title">${STR.title}</span>
      <span class="ct-status"></span>
      <button class="ct-guide-toggle" type="button">${STR.guideButton}</button>
      <button class="ct-action" type="button"></button>
    </div>
    <div class="ct-guide" hidden></div>
    <div class="ct-step"></div>
    <div class="ct-now">
      <div class="ct-chord-block">
        <div class="ct-current" tabindex="0">${STR.noChordsYet}</div>
        <div class="ct-diagram-slot"></div>
      </div>
      <div class="ct-next">
        <span class="ct-section-now" hidden></span>
        <span class="ct-next-label"></span><span class="ct-next-list"></span>
      </div>
    </div>
    <div class="ct-strip-wrap" hidden>
      <div class="ct-strip-view">
        <div class="ct-strip"></div>
        <div class="ct-strip-line"></div>
      </div>
    </div>
    <div class="ct-structure" hidden>
      <span class="ct-group-label">${STR.structure}</span>
      <div class="ct-bar"></div>
    </div>
    <div class="ct-sheet-wrap" hidden>
      <span class="ct-group-label">${STR.sheet}</span>
      <div class="ct-practice" hidden>
        <span class="ct-practice-what"></span>
        <span class="ct-group-label">${STR.speed}</span>
        <span class="ct-practice-speeds"></span>
        <button class="ct-btn ct-practice-stop" type="button">${STR.practiceStop}</button>
      </div>
      <div class="ct-sheet"></div>
    </div>
    <div class="ct-controls">
      <div class="ct-group ct-capo-group">
        <span class="ct-group-label" title="${STR.capoHelp}">${STR.capo}</span>
        <span class="ct-capo-buttons"></span>
        <span class="ct-capo-hint"></span>
      </div>
      <div class="ct-group">
        <span class="ct-group-label" title="${STR.transposeHelp}">${STR.transpose}</span>
        <button class="ct-btn ct-tr-down" type="button">−</button>
        <span class="ct-tr-value">0</span>
        <button class="ct-btn ct-tr-up" type="button">+</button>
      </div>
      <button class="ct-btn ct-reset" type="button">${STR.reset}</button>
    </div>
  `;

  Object.assign(ui, {
    panel,
    status: panel.querySelector('.ct-status'),
    action: panel.querySelector('.ct-action'),
    guide: panel.querySelector('.ct-guide'),
    guideToggle: panel.querySelector('.ct-guide-toggle'),
    step: panel.querySelector('.ct-step'),
    current: panel.querySelector('.ct-current'),
    nextLabel: panel.querySelector('.ct-next-label'),
    nextList: panel.querySelector('.ct-next-list'),
    capoButtons: panel.querySelector('.ct-capo-buttons'),
    capoHint: panel.querySelector('.ct-capo-hint'),
    trValue: panel.querySelector('.ct-tr-value'),
    diagramSlot: panel.querySelector('.ct-diagram-slot'),
    structure: panel.querySelector('.ct-structure'),
    bar: panel.querySelector('.ct-bar'),
    stripWrap: panel.querySelector('.ct-strip-wrap'),
    strip: panel.querySelector('.ct-strip'),
    sheetWrap: panel.querySelector('.ct-sheet-wrap'),
    sheet: panel.querySelector('.ct-sheet'),
    practice: panel.querySelector('.ct-practice'),
    practiceWhat: panel.querySelector('.ct-practice-what'),
    practiceSpeeds: panel.querySelector('.ct-practice-speeds'),
    sectionNow: panel.querySelector('.ct-section-now'),
  });

  ui.diagramKey = null;
  ui.chipKey = null;
  ui.action.addEventListener('click', onActionClick);
  panel.querySelector('.ct-tr-down').addEventListener('click', () => nudgeTranspose(-1));
  panel.querySelector('.ct-tr-up').addEventListener('click', () => nudgeTranspose(1));
  panel.querySelector('.ct-reset').addEventListener('click', resetControls);
  panel.querySelector('.ct-practice-stop').addEventListener('click', () => stopPractice());
  ui.guideToggle.addEventListener('click', () => toggleGuide());
  buildCapoButtons();
  buildSpeedButtons();
  buildGuide();

  // Îl atașăm imediat (overlay) ca să fie vizibil din prima, apoi îl mutăm sub video
  // când #below apare. Dacă nu apare deloc, rămâne overlay — comportamentul de rezervă.
  panel.classList.add('ct-overlay');
  document.body.appendChild(panel);
  waitFor('#below').then((host) => {
    if (!host || panel !== ui.panel || !panel.isConnected) return;
    panel.classList.remove('ct-overlay');
    host.prepend(panel);
    log.debug('Panou mutat sub video (#below).');
  });

  render();
}

function buildCapoButtons() {
  ui.capoButtons.innerHTML = '';
  for (let n = 0; n <= MAX_CAPO; n++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ct-btn ct-capo';
    b.dataset.capo = String(n);
    b.textContent = n === 0 ? STR.noCapo : String(n);
    b.addEventListener('click', () => { state.capo = n; render(); });
    ui.capoButtons.appendChild(b);
  }
}

function render() {
  const { mode } = state;
  ui.status.classList.remove('is-warning');
  ui.status.textContent =
    mode === 'listening' ? STR.listening :
    mode === 'playback' ? STR.playback : STR.idle;
  ui.action.textContent =
    mode === 'listening' ? STR.stop :
    mode === 'playback' ? STR.reanalyze : STR.start;

  // capo + transpoziție
  ui.trValue.textContent = STR.transposeValue(state.transpose);
  ui.capoHint.textContent = state.chords.length ? STR.capoSuggested(state.suggestedCapo) : '';
  for (const b of ui.capoButtons.children) {
    b.classList.toggle('is-active', Number(b.dataset.capo) === state.capo);
    b.classList.toggle('is-suggested',
      state.chords.length > 0 && state.suggestedCapo > 0
      && Number(b.dataset.capo) === state.suggestedCapo);
  }

  if (mode === 'playback') renderPlayback();
  else renderLive();

  renderStep();
  buildStrip();
  buildStructure();
  buildSheet();
  renderPractice();
  if (mode === 'playback') {
    const video = getVideo();
    const t = video ? video.currentTime : 0;
    updateCurrentSection(t);
    ui.sheetHighlight = null; // foaia s-a putut reconstrui: forțăm o evidențiere proaspătă
    updateSheetHighlight(t);
    updateStripHighlight(chordIndexAt(t));
    updateStrip(t);
  } else if (ui.sectionNow) {
    ui.sectionNow.hidden = true;
  }
}

function renderPlayback() {
  const video = getVideo();
  const idx = chordIndexAt(video ? video.currentTime : 0);
  setCurrent(idx >= 0 ? state.chords[idx].label : null);
  // Ce urmează se vede pe BANDĂ, cu tot cu cât ține fiecare acord. Lista de trei chip-uri de
  // aici era fix ce reclama Andrei: „văd mereu pe ecran doar patru acorduri”. Eticheta rămâne
  // goală; o umple doar anunțul secțiunii următoare, din updateCurrentSection.
  ui.nextLabel.textContent = '';
  fillChordList([]);
}

function renderLive() {
  const last = state.chords[state.chords.length - 1];
  setCurrent(last ? last.label : null);
  ui.nextLabel.textContent = state.chords.length > 1 ? STR.recent : '';
  const recent = state.chords.slice(-1 - RECENT_COUNT, -1).map((c) => c.label).reverse();
  fillChordList(recent);
}

function setCurrent(sounding) {
  const label = displayLabel(sounding);
  ui.current.textContent = label;
  ui.current.dataset.chord = label;
  showDiagram(label);
}

function fillChordList(soundingLabels) {
  const labels = soundingLabels.map(displayLabel);
  // Reconstruim lista DOAR dacă s-a schimbat. Altfel, ștergerea și recrearea chip-urilor sub
  // cursor stinge și reaprinde evenimentele de hover — a doua sursă de pâlpâit.
  if (ui.chipKey === labels.join('|')) return;
  ui.chipKey = labels.join('|');

  ui.nextList.innerHTML = '';
  for (const label of labels) {
    const chip = document.createElement('span');
    chip.className = 'ct-chip';
    chip.textContent = label;
    chip.dataset.chord = label;
    chip.tabIndex = 0;
    chip.classList.toggle('ct-has-diagram', hasDiagram(label));
    attachChipHover(chip);
    ui.nextList.appendChild(chip);
  }
}

function nudgeTranspose(delta) {
  state.transpose = Math.max(-6, Math.min(6, state.transpose + delta));
  render();
}

function resetControls() {
  state.transpose = 0;
  state.capo = 0; // înapoi la acordurile care se aud cu adevărat
  render();
}

// --- Ghidul de folosire -------------------------------------------------------
//
// Extensia are DOUĂ faze, iar a doua e cea frumoasă. Cine o încearcă prima oară vede în
// timpul analizei doar niște acorduri care trec și n-are de unde să știe că banda, secțiunile
// și exersarea apar abia după ce melodia s-a terminat — a rămas cu impresia că asta e tot.
// De-asta linia „Pasul N din 2" e MEREU vizibilă, iar butonul portocaliu deschide povestea
// întreagă. (Reparat și la rădăcină: analiza se oprește acum singură la finalul melodiei,
// deci nu mai e nevoie de niciun gest ca să ajungi în Pasul 2.)

function buildGuide() {
  ui.guide.innerHTML = '';
  const h = document.createElement('div');
  h.className = 'ct-guide-title';
  h.textContent = STR.guideTitle;
  ui.guide.appendChild(h);

  for (const [title, body] of STR.guideSteps) {
    const item = document.createElement('div');
    item.className = 'ct-guide-item';
    const t = document.createElement('span');
    t.className = 'ct-guide-item-title';
    t.textContent = title;
    const b = document.createElement('span');
    b.className = 'ct-guide-item-body';
    b.textContent = body;
    item.append(t, b);
    ui.guide.appendChild(item);
  }

  const priv = document.createElement('div');
  priv.className = 'ct-guide-privacy';
  priv.textContent = STR.guidePrivacy;
  ui.guide.appendChild(priv);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ct-btn ct-guide-done';
  close.textContent = STR.guideClose;
  close.addEventListener('click', () => toggleGuide(false));
  ui.guide.appendChild(close);

  // Prima oară se deschide singur: cine tocmai a instalat extensia n-are de unde să știe
  // că trebuie să citească ceva. După ce l-a închis o dată, nu mai insistăm.
  chrome.storage.local.get('guideSeen').then(({ guideSeen }) => {
    if (!guideSeen && ui.guide?.isConnected) toggleGuide(true, false);
  }).catch(() => {});
}

function toggleGuide(open = ui.guide.hidden, remember = true) {
  ui.guide.hidden = !open;
  ui.guideToggle.classList.toggle('is-open', open);
  ui.guideToggle.setAttribute('aria-expanded', String(open));
  if (remember && !open) chrome.storage.local.set({ guideSeen: true }).catch(() => {});
}

/** Linia „Pasul N din 2” — singurul loc care spune, mereu, ce se întâmplă și ce urmează. */
function renderStep() {
  if (!ui.step) return;
  ui.step.textContent =
    state.mode === 'listening' ? STR.stepListening(state.chords.length) :
    state.mode === 'playback' ? STR.stepPlayback : STR.stepIdle;
  ui.step.dataset.mode = state.mode;
}

// --- Modul de exersare --------------------------------------------------------
//
// O secțiune pusă pe repetat, la viteza pe care o vrei. Asta e ce lipsea ca extensia să
// treacă de la „îmi arată acorduri” la „mă ajută să învăț melodia”: alegi refrenul, îl
// încetinești, îl cânți de zece ori. Există DOAR în modul memorat — în timpul analizei
// bucla ar re-analiza la nesfârșit aceleași secunde.

function buildSpeedButtons() {
  ui.practiceSpeeds.innerHTML = '';
  for (const rate of PRACTICE_RATES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ct-btn ct-speed';
    b.dataset.rate = String(rate);
    b.textContent = STR.speedValue(rate);
    b.addEventListener('click', () => {
      state.practiceRate = rate;
      applyRate(rate);
      renderPractice();
    });
    ui.practiceSpeeds.appendChild(b);
  }
}

/** Schimbă viteza PĂSTRÂND tonalitatea — altfel acordurile afișate n-ar mai fi ce auzi. */
function applyRate(rate) {
  const video = getVideo();
  if (!video) return;
  video.preservesPitch = true;
  if ('webkitPreservesPitch' in video) video.webkitPreservesPitch = true;
  if ('mozPreservesPitch' in video) video.mozPreservesPitch = true;
  video.playbackRate = rate;
}

// requestAnimationFrame TACE în taburile ascunse, iar bucla de exersare trăia numai acolo:
// treceai pe alt tab ca să cauți ritmul și melodia curgea nestingherită dincolo de secțiune,
// la 0,5×, prin toată piesa. „timeupdate” bate și în taburi ascunse.
function onPracticeTime() {
  if (state.practice && state.practiceVideo) tickPractice(state.practiceVideo.currentTime);
}

function startPractice(index, range) {
  const video = getVideo();
  if (!video || range.end - range.start <= PRACTICE_MIN_SECONDS) return;
  // Viteza „dinainte” se reține O SINGURĂ DATĂ, la intrarea în exersare: dacă schimbi
  // secțiunea în timp ce exersezi încetinit, „dinainte” tot viteza ta inițială e, nu 0,75.
  const prevRate = state.practice ? state.practice.prevRate : video.playbackRate;
  state.practice = { index, start: range.start, end: range.end, label: range.label, prevRate };
  applyRate(state.practiceRate);
  // Dubla execuție (rAF + timeupdate) în tabul vizibil e inofensivă: tickPractice e idempotent.
  state.practiceVideo?.removeEventListener('timeupdate', onPracticeTime);
  state.practiceVideo = video;
  video.addEventListener('timeupdate', onPracticeTime);
  seekTo(range.start);
  render();
}

function stopPractice(silent = false) {
  if (!state.practice) return;
  const { prevRate } = state.practice;
  state.practice = null;
  state.practiceVideo?.removeEventListener('timeupdate', onPracticeTime);
  state.practiceVideo = null;
  // Înapoi la viteza pe care o avea OMUL, nu orbește 1: putea să aibă deja YouTube-ul pe 1,25.
  applyRate(prevRate);
  if (!silent) render();
}

/** Bucla propriu-zisă, din tick-ul de redare. */
function tickPractice(t) {
  const p = state.practice;
  const video = getVideo();
  if (!video) return;
  const end = Math.min(p.end, Number.isFinite(video.duration) && video.duration > 0
    ? video.duration : p.end);
  if (end - p.start <= 0.5) { stopPractice(); return; }
  // Ai sărit în altă parte a melodiei (click în foaie, pe bandă, pe bara YouTube): exersarea
  // s-a terminat. Nu te tragem înapoi într-o secțiune pe care ai părăsit-o intenționat.
  if (t < p.start - 1 || t > end + 1) { stopPractice(); return; }
  if (t >= end - 0.05) video.currentTime = p.start + 0.02;
}

/** Doar text și clase — bara de exersare nu se reconstruiește niciodată. */
function renderPractice() {
  if (!ui.practice) return;
  const p = state.mode === 'playback' ? state.practice : null;
  ui.practice.hidden = !p;
  if (p) {
    ui.practiceWhat.textContent = STR.practiceOn(p.label);
    for (const b of ui.practiceSpeeds.children) {
      b.classList.toggle('is-active', Number(b.dataset.rate) === state.practiceRate);
    }
  }
  // Butonul ⟳ al secțiunii care se exersează rămâne apăsat, ca să se vadă unde ești.
  if (ui.sheet) {
    for (const row of ui.sheet.children) {
      row.querySelector('.ct-loop')
        ?.classList.toggle('is-active', !!p && Number(row.dataset.index) === p.index);
    }
  }
}

// --- Banda rulantă ------------------------------------------------------------
//
// Acordurile curg spre linia „acum”, ca la karaoke: le vezi venind, cu lățimea proporțională
// cu cât ține fiecare, deci se citește și RITMUL, nu doar ordinea. Înlocuiește lista de trei
// chip-uri „urmează” — exact reclamația lui Andrei („văd mereu pe ecran doar patru acorduri”).
//
// Există DOAR în modul „memorat”: în timpul analizei viitorul încă nu e cunoscut, deci n-ar
// avea ce curge. Mecanica e făcută să nu coste nimic în bucla de 60 fps: cartonașele se
// așază O SINGURĂ DATĂ, cu poziții absolute în pixeli, iar mișcarea e un singur translateX
// pe containerul lor. Containerul are `margin-left: 25%`, deci translateX(-t·px) aduce
// momentul t exact sub linia „acum” — fără să citim vreo dimensiune din pagină.

let reducedMotionMQ = null;
function prefersReducedMotion() {
  if (!reducedMotionMQ && window.matchMedia) {
    reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  }
  return !!reducedMotionMQ?.matches;
}

/** Scara benzii: pixeli pe secundă, aleasă din cât ține un acord obișnuit în melodia asta. */
function stripPxPerSecond(chords) {
  const gaps = [];
  for (let i = 1; i < chords.length; i++) gaps.push(chords[i].t - chords[i - 1].t);
  if (!gaps.length) return 40;
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)] || 2;
  return Math.max(STRIP_MIN_PX_PER_SEC,
    Math.min(STRIP_MAX_PX_PER_SEC, STRIP_TARGET_CHIP_PX / median));
}

/** Construiește banda. Idempotentă, ca bara și foaia — zero reconstrucții din bucla de redare. */
function buildStrip() {
  if (!ui.strip) return;
  if (state.mode !== 'playback' || state.chords.length < 2) {
    ui.stripWrap.hidden = true;
    ui.stripKey = null;
    return;
  }
  const last = state.chords[state.chords.length - 1];
  const key = `${state.videoId}|${state.capo}|${state.transpose}`
    + `|${state.chords.length}@${last.t.toFixed(0)}|${structureShape()}`;
  if (ui.stripKey === key) return;
  ui.stripKey = key;
  ui.stripWrap.hidden = false;

  const px = stripPxPerSecond(state.chords);
  state.stripPx = px;
  ui.strip.innerHTML = '';
  ui.stripNowEl = null;
  ui.stripShift = null; // scara s-a putut schimba: forțăm o repoziționare

  // Dedesubt, benzile secțiunilor — vezi „Refren” venind, nu doar acordurile lui.
  const st = hasUsefulStructure() ? state.structure : null;
  if (st) {
    const letters = Object.keys(st.patterns);
    for (const s of st.sections) {
      const band = document.createElement('div');
      band.className = 'ct-strip-band';
      if (s.cluster) band.dataset.group = String(letters.indexOf(s.cluster) % 5);
      band.style.left = `${(s.start * px).toFixed(1)}px`;
      band.style.width = `${Math.max(2, (s.end - s.start) * px - 2).toFixed(1)}px`;
      band.textContent = sectionLabel(s);
      ui.strip.appendChild(band);
    }
  }

  // Ultimul acord n-are următorul de la care să-și ia lățimea: îi dăm durata medie.
  const span = last.t - state.chords[0].t;
  const tail = Math.max(2, span / Math.max(1, state.chords.length - 1));
  state.chords.forEach((c, i) => {
    const until = i + 1 < state.chords.length ? state.chords[i + 1].t : c.t + tail;
    const shown = displayLabel(c.label);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'ct-strip-chip';
    chip.dataset.index = String(i);
    chip.dataset.chord = shown;
    chip.textContent = shown;
    chip.style.left = `${(c.t * px).toFixed(1)}px`;
    chip.style.width = `${Math.max(8, (until - c.t) * px - STRIP_GAP_PX).toFixed(1)}px`;
    chip.classList.toggle('ct-has-diagram', hasDiagram(shown));
    chip.title = STR.jumpTo(shown);
    attachChipHover(chip);
    chip.addEventListener('click', () => seekTo(c.t));
    ui.strip.appendChild(chip);
  });
}

/** Mișcarea: un singur translateX, scris doar când chiar se schimbă. */
function updateStrip(t) {
  if (!ui.strip || ui.stripWrap?.hidden) return;
  // Cu „mișcare redusă” banda NU curge: sare o dată, la schimbarea acordului. Altfel un
  // element care se mișcă neîncetat sub ochi e exact ce cere setarea asta să nu existe.
  const at = prefersReducedMotion()
    ? (state.chords[state.lastIndex]?.t ?? 0)
    : t;
  const shift = Math.round(-at * state.stripPx * 10) / 10;
  if (ui.stripShift === shift) return;
  ui.stripShift = shift;
  ui.strip.style.transform = `translateX(${shift}px)`;
}

/** Aprinde cartonașul de sub linia „acum”. O singură scriere, nu o buclă peste toate. */
function updateStripHighlight(idx) {
  if (!ui.strip || ui.stripWrap?.hidden) return;
  if (ui.stripNow === idx && ui.stripNowEl?.isConnected) return;
  ui.stripNow = idx;
  ui.stripNowEl?.classList.remove('is-now');
  const el = idx >= 0 ? ui.strip.querySelector(`.ct-strip-chip[data-index="${idx}"]`) : null;
  el?.classList.add('is-now');
  ui.stripNowEl = el;
}

// --- Structura melodiei -------------------------------------------------------
//
// Există DOAR în modul „memorat”: repetițiile se văd numai privind melodia întreagă.
// Bara se construiește O SINGURĂ DATĂ; în bucla de redare se schimbă doar clasa segmentului
// curent. (Lecția pâlpâitului: nu reconstrui DOM sub cursor la fiecare cadru.)

/** Numele de afișat al unei secțiuni: „Refren”, „Partea 2”, „Intro” sau „Trecere”. */
function sectionLabel(s) {
  const name = s.name ? STR.sectionNames[s.name] : null;
  if (!s.cluster) return STR.freeSection(name);
  return STR.sectionLabel(state.clusterOrder.get(s.cluster) ?? 1, name);
}

// Numărul de ordine al fiecărui grup, după PRIMA APARIȚIE în melodie — nu după litera dată de
// sections.js. Literele se atribuie în ordinea în care sunt descoperite buclele, iar pasul de
// adopție poate lipi mai târziu un grup pe o secțiune de la începutul melodiei; atunci litera
// n-ar mai corespunde cu ce aude omul. Ordinea din secțiuni corespunde mereu.
function clusterOrdinals(sections) {
  const map = new Map();
  for (const s of sections) {
    if (s.cluster && !map.has(s.cluster)) map.set(s.cluster, map.size + 1);
  }
  return map;
}

function computeStructure() {
  state.clusterOrder = new Map();
  if (!state.chords.length) { state.structure = null; return; }
  const video = getVideo();
  const videoEnd = video && Number.isFinite(video.duration) && video.duration > 0
    ? video.duration
    : Infinity;

  // Analizăm doar CÂT ȘTIM, nu toată durata videoului. Dacă analiza a fost oprită devreme
  // (sau melodia se termină înainte de finalul clipului), coada fără date ar apărea ca un
  // segment gol uriaș — și, mai rău, ar dilua acoperirea sub pragul de afișare, ascunzând
  // o structură perfect bună. Ultimul acord + o coadă cât o schimbare obișnuită.
  const last = state.chords[state.chords.length - 1];
  const gaps = [];
  for (let i = 1; i < state.chords.length; i++) gaps.push(state.chords[i].t - state.chords[i - 1].t);
  gaps.sort((a, b) => a - b);
  const typical = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 4;
  const duration = Math.min(videoEnd, last.t + Math.max(2, typical));

  try {
    state.structure = detectSections(state.chords, duration);
    state.clusterOrder = clusterOrdinals(state.structure.sections);
    const groups = Object.keys(state.structure.patterns).length;
    log.info(`Structură: ${state.structure.sections.length} secțiuni, ${groups} tipare, `
      + `acoperire ${(state.structure.coverage * 100).toFixed(0)}%`);
  } catch (err) {
    log.error('Detecția structurii a eșuat:', err?.message || err);
    state.structure = null;
  }
}

function hasUsefulStructure() {
  const st = state.structure;
  return !!st && st.coverage >= MIN_COVERAGE && Object.keys(st.patterns).length > 0;
}

// Amprenta structurii, pentru cheile de idempotență. Trebuie să vadă CONȚINUTUL secțiunilor,
// nu doar numărul lor: o reanaliză a aceleiași melodii dă aproape sigur tot atâtea secțiuni,
// iar cu o cheie bazată pe lungime desenul vechi rămânea pe ecran — inclusiv handler-ele de
// click, care duceau la granițele vechi. Exact defectul pe care omul încerca să-l repare
// reanalizând.
function structureShape() {
  const st = hasUsefulStructure() ? state.structure : null;
  return st ? st.sections.map((s) => `${s.cluster || '-'}${s.start.toFixed(0)}`).join(',') : '';
}

/** Construiește bara și legenda. Idempotent: dacă nimic relevant nu s-a schimbat, iese. */
function buildStructure() {
  if (!ui.structure) return;
  if (state.mode !== 'playback' || !hasUsefulStructure()) {
    ui.structure.hidden = true;
    ui.barKey = null;
    return;
  }
  const st = state.structure;
  const key = `${state.videoId}|${state.capo}|${state.transpose}|${structureShape()}`;
  if (ui.barKey === key) return;
  ui.barKey = key;
  ui.structure.hidden = false;

  const total = st.sections[st.sections.length - 1]?.end || 1;
  const letters = Object.keys(st.patterns);

  ui.bar.innerHTML = '';
  st.sections.forEach((s, i) => {
    const seg = document.createElement('button');
    seg.type = 'button';
    seg.className = 'ct-seg';
    seg.dataset.index = String(i);
    if (s.cluster) seg.dataset.group = String(letters.indexOf(s.cluster) % 5);
    seg.style.flexGrow = String(Math.max(0.02, (s.end - s.start) / total));
    const label = sectionLabel(s);
    // Numele întreg, nu litera: pe segmentele înguste CSS-ul îl taie cu „…”, iar titlul
    // rămâne complet. Tot ce se vede în panou vorbește aceeași limbă.
    seg.textContent = label;
    seg.title = STR.jumpTo(label);
    seg.setAttribute('aria-label', STR.jumpTo(label));
    seg.addEventListener('click', () => seekTo(s.start));
    ui.bar.appendChild(seg);
  });
}

// --- Foaia melodiei -----------------------------------------------------------
//
// Bara arată FORMA melodiei; foaia arată MELODIA — un rând per secțiune, în ordinea
// cântecului (nu dedublat ca o legendă), cu acordurile pe chip-uri pe care poți da click ca
// să sari exact acolo. Asta a cerut Andrei: „n-am ceva istoric să văd melodia sau să derulez
// înainte-înapoi pe bucăți”. Apare și fără structură — atunci ca un singur rând cu tot
// cântecul, fiindcă nevoia e aceeași.

/** Acordurile memorate din intervalul [from, to), cu repetițiile consecutive contopite. */
function chordsBetween(from, to) {
  const out = [];
  for (const c of state.chords) {
    if (c.t >= to) break;
    if (c.t < from - 0.001) { // acordul care sună deja la începutul feliei
      if (out.length) out[0] = { t: from, label: c.label };
      else out.push({ t: from, label: c.label });
      continue;
    }
    if (out.length && out[out.length - 1].label === c.label) continue;
    out.push({ t: c.t, label: c.label });
  }
  return out;
}

function makeSheetChip(label, at) {
  const shown = displayLabel(label);
  const chip = document.createElement('span');
  chip.className = 'ct-chip ct-sheet-chip';
  chip.textContent = shown;
  chip.dataset.chord = shown;
  chip.dataset.t = String(at);
  chip.tabIndex = 0;
  chip.classList.toggle('ct-has-diagram', hasDiagram(shown));
  attachChipHover(chip);
  chip.addEventListener('click', () => seekTo(at));
  return chip;
}

function sheetRow({ tag, group, chips, reps, index, range }) {
  const row = document.createElement('div');
  row.className = 'ct-sheet-row';
  row.dataset.index = String(index);

  if (tag !== null) {
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'ct-sheet-tag';
    if (group !== null) label.dataset.group = String(group);
    label.textContent = tag.text;
    label.title = STR.jumpTo(tag.text);
    label.addEventListener('click', () => seekTo(tag.start));
    row.appendChild(label);
  }

  // ⟳ — pune secțiunea pe repetat. Doar pe rândurile care CHIAR sunt o secțiune: pe foaia
  // plată (melodie fără structură) rândul e tot cântecul, iar „repetă tot cântecul” nu e
  // exersare, e redare normală.
  if (range) {
    const loop = document.createElement('button');
    loop.type = 'button';
    loop.className = 'ct-loop';
    loop.textContent = '⟳';
    loop.title = STR.practiceHelp(range.label);
    loop.setAttribute('aria-label', STR.practiceHelp(range.label));
    loop.addEventListener('click', () => {
      if (state.practice?.index === index) stopPractice();
      else startPractice(index, range);
    });
    row.appendChild(loop);
  }

  const list = document.createElement('span');
  list.className = 'ct-sheet-chips';
  for (const chip of chips) list.appendChild(chip);
  row.appendChild(list);

  if (reps > 1) {
    const count = document.createElement('span');
    count.className = 'ct-sheet-count';
    count.textContent = STR.times(reps);
    row.appendChild(count);
  }
  return row;
}

/** Construiește foaia. Idempotentă, ca bara — zero reconstrucții din bucla de redare. */
function buildSheet() {
  if (!ui.sheet) return;
  // Foaia nu depinde de structură: și fără ea utilizatorul vrea să vadă melodia întreagă.
  if (state.mode !== 'playback' || state.chords.length < 4) {
    ui.sheetWrap.hidden = true;
    ui.sheetKey = null;
    return;
  }
  const st = hasUsefulStructure() ? state.structure : null;
  const key = `${state.videoId}|${state.capo}|${state.transpose}|`
    + (st ? structureShape() : `plat:${state.chords.length}`);
  if (ui.sheetKey === key) return;
  ui.sheetKey = key;
  ui.sheetWrap.hidden = false;
  ui.sheet.innerHTML = '';
  // Foaie nouă = derulare nouă. Se resetează DOAR aici, nu la fiecare render: altfel
  // „rândul s-a schimbat” ar fi adevărat mereu și foaia s-ar re-derula la fiecare acord.
  ui.sheetRowLast = null;

  if (!st) {
    // Fără structură: un singur rând cu toată melodia, tot clickabil.
    const chips = chordsBetween(0, Infinity).map((c) => makeSheetChip(c.label, c.t));
    ui.sheet.appendChild(sheetRow({
      tag: { text: STR.wholeSong, start: 0 }, group: null, chips, reps: 1, index: 0,
    }));
    return;
  }

  const letters = Object.keys(st.patterns);
  st.sections.forEach((s, i) => {
    let chips;
    if (s.cluster && st.patterns[s.cluster]) {
      // Secțiune cu buclă: arătăm tiparul-consens, iar clickul duce la locul acordului în
      // PRIMA trecere prin buclă. `lead` = secundele mutate din coada buclei în capul ei la
      // contopirea circulară: fără scăderea lui, toate chip-urile de după primul erau
      // decalate cu atât, deci clickul sărea unde suna alt acord.
      const { loop, lead = 0 } = st.patterns[s.cluster];
      let offset = 0;
      chips = loop.map((item, k) => {
        const chip = makeSheetChip(item.label, k === 0 ? s.start : s.start + Math.max(0, offset - lead));
        offset += item.seconds;
        return chip;
      });
    } else {
      // Zonă liberă (punte, intro, final): nu există tipar, deci arătăm ce sună de fapt.
      chips = chordsBetween(s.start, s.end).map((c) => makeSheetChip(c.label, Math.max(c.t, s.start)));
    }
    ui.sheet.appendChild(sheetRow({
      tag: { text: sectionLabel(s), start: s.start },
      group: s.cluster ? letters.indexOf(s.cluster) % 5 : null,
      chips,
      reps: s.reps,
      index: i,
      range: { start: s.start, end: s.end, label: sectionLabel(s) },
    }));
  });
}

/** În ce chip din rândul dat cade momentul t? -1 dacă nu se poate spune. */
function sheetChipIndexAt(section, t) {
  const st = state.structure;
  if (section && section.cluster && st?.patterns[section.cluster]) {
    const { loop, period, lead = 0 } = st.patterns[section.cluster];
    if (!(period > 0)) return -1;
    // + lead, fiindcă lista comprimată începe cu `lead` secunde ÎNAINTE de faza 0 (capetele
    // buclei au fost contopite). Fără asta, foaia aprindea alt acord decât cel care sună.
    let phase = (t - section.start + lead) % period;
    if (phase < 0) phase += period;
    let acc = 0;
    for (let i = 0; i < loop.length; i++) {
      acc += loop[i].seconds;
      if (phase < acc) return i;
    }
    return loop.length - 1;
  }
  // Rând liber sau foaie plată: ultimul chip al cărui moment a trecut.
  const chips = ui.sheet?.querySelector(`.ct-sheet-row${section ? `[data-index="${sectionIndexOf(section)}"]` : ''}`)
    ?.querySelectorAll('.ct-sheet-chip');
  if (!chips || !chips.length) return -1;
  let idx = -1;
  for (let i = 0; i < chips.length; i++) {
    if (Number(chips[i].dataset.t) <= t) idx = i; else break;
  }
  return idx;
}

function sectionIndexOf(section) {
  return state.structure?.sections.indexOf(section) ?? -1;
}

/** Evidențiază rândul și acordul curent. Scrie în DOM doar când chiar se schimbă ceva. */
function updateSheetHighlight(t) {
  if (!ui.sheet || ui.sheetWrap?.hidden) return;
  const st = hasUsefulStructure() ? state.structure : null;
  const rowIdx = st ? sectionIndexAt(t) : 0;
  const section = st ? st.sections[rowIdx] : null;
  const chipIdx = sheetChipIndexAt(section, t);
  const key = `${rowIdx}|${chipIdx}`;
  if (ui.sheetHighlight === key) return;
  ui.sheetHighlight = key;

  const rows = ui.sheet.children;
  for (let i = 0; i < rows.length; i++) {
    const isCurrent = i === rowIdx;
    rows[i].classList.toggle('is-current', isCurrent);
    const chips = rows[i].querySelectorAll('.ct-sheet-chip');
    for (let k = 0; k < chips.length; k++) {
      chips[k].classList.toggle('is-now', isCurrent && k === chipIdx);
    }
    // NU folosi scrollIntoView aici. „nearest” înseamnă „deplasare minimă”, nu „doar
    // containerul interior”: API-ul derulează TOȚI strămoșii derulabili, inclusiv pagina.
    // Cu panoul sub linia de plutire, YouTube-ul era smucit înapoi la panou la fiecare
    // acord — nu mai puteai citi comentariile cât timp melodia rula.
    // Și doar la schimbarea RÂNDULUI: altfel foaia fuge de sub cursor când o derulezi singur.
    if (isCurrent && rowIdx !== ui.sheetRowLast) {
      const top = rows[i].offsetTop;
      const bottom = top + rows[i].offsetHeight;
      if (top < ui.sheet.scrollTop) ui.sheet.scrollTop = top;
      else if (bottom > ui.sheet.scrollTop + ui.sheet.clientHeight) {
        ui.sheet.scrollTop = bottom - ui.sheet.clientHeight;
      }
    }
  }
  ui.sheetRowLast = rowIdx;
}

/** Indexul secțiunii care conține momentul t (căutare binară). -1 dacă nu există. */
function sectionIndexAt(t) {
  const a = state.structure?.sections;
  if (!a || !a.length) return -1;
  let lo = 0, hi = a.length - 1, res = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid].start <= t) { res = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return res;
}

/** Pasul 2: doar clase și text — fără reconstrucție de DOM. */
function updateCurrentSection(t) {
  const st = state.structure;
  if (!ui.sectionNow) return;
  // Aceeași regulă ca la bară: dacă structura găsită e prea firavă, nu spunem nimic. Un
  // indicator care scrie „Liber” toată melodia e zgomot, nu informație.
  if (state.mode !== 'playback' || !hasUsefulStructure() || !st.sections.length) {
    ui.sectionNow.hidden = true;
    ui.nextLabel.classList.remove('is-announce');
    return;
  }
  const idx = sectionIndexAt(t);
  const current = idx >= 0 ? st.sections[idx] : null;

  if (!ui.structure.hidden) {
    for (const seg of ui.bar.children) {
      seg.classList.toggle('is-current', Number(seg.dataset.index) === idx);
    }
  }

  if (!current) { ui.sectionNow.hidden = true; return; }
  ui.sectionNow.hidden = false;
  ui.sectionNow.textContent = sectionLabel(current);
  ui.sectionNow.dataset.group = current.cluster
    ? String(Object.keys(st.patterns).indexOf(current.cluster) % 5)
    : '';

  // Anunțul secțiunii următoare, cu câteva secunde înainte de graniță.
  const next = st.sections[idx + 1];
  const soon = next && current.end - t <= ANNOUNCE_AHEAD;
  ui.nextLabel.textContent = soon ? STR.upNextSection(sectionLabel(next)) : '';
  ui.nextLabel.classList.toggle('is-announce', !!soon);
}

// --- Diagrame (Pasul 7) -------------------------------------------------------
//
// Diagrama acordului curent stă permanent lângă el — asta vrei când cânți, nu un balon
// care apare la hover. Trecerea cu mouse-ul peste un acord care urmează o înlocuiește
// temporar, ca să poți pregăti următoarea schimbare; la ieșire revine la acordul curent.

// Slotul are dimensiune FIXĂ prin CSS, chiar și gol. Altfel apariția și dispariția unui
// dreptunghi mare mută restul panoului, cursorul „iese” de pe acordul pe care stă, diagrama
// se schimbă înapoi, panoul se mută la loc — și o ia de la capăt. Ăsta era pâlpâitul.
// A doua parte a reparației: nu redesenăm dacă e aceeași diagramă.
function showDiagram(label) {
  if (!ui.diagramSlot) return;
  const wanted = label && label !== NO_CHORD && label !== STR.noChordsYet ? label : null;
  const key = `${wanted}|${state.capo}`;
  if (ui.diagramKey === key) return; // deja e pe ecran — nu atingem DOM-ul degeaba
  ui.diagramKey = key;
  const svg = wanted ? renderChordDiagram(wanted, state.capo) : null;
  ui.diagramSlot.innerHTML = svg || '';
  ui.diagramSlot.classList.toggle('is-empty', !svg);
}

// mouseenter/mouseleave nu se propagă și nu se declanșează la mișcarea în interiorul
// aceluiași element — spre deosebire de mouseover/mouseout, care se aprindeau în lanț.
function attachChipHover(chip) {
  chip.addEventListener('mouseenter', () => showDiagram(chip.dataset.chord));
  chip.addEventListener('focus', () => showDiagram(chip.dataset.chord));
  const back = () => showDiagram(ui.current?.dataset.chord);
  chip.addEventListener('mouseleave', back);
  chip.addEventListener('blur', back);
}

// --- Mesaje, ceas, redare -----------------------------------------------------

function onActionClick() {
  if (state.mode === 'listening') {
    chrome.runtime.sendMessage({ target: 'background', type: 'REQUEST_STOP' }).catch(() => {});
    return;
  }
  // Cine apasă „Analizează” a înțeles ce are de făcut — nu-i mai deschidem ghidul.
  chrome.storage.local.set({ guideSeen: true }).catch(() => {});
  chrome.runtime.sendMessage({ target: 'background', type: 'REQUEST_START' })
    .catch((err) => log.warn('Nu am putut cere pornirea capturii:', err?.message));
}

// Finalul melodiei ÎNCHEIE analiza singur. Înainte, cine lăsa melodia să se termine rămânea
// la nesfârșit în Pasul 1: acordurile treceau, dar banda și secțiunile nu apăreau niciodată,
// fiindcă nimeni nu-i spusese că trebuie să apese „Oprește”. Ăsta era defectul de fond.
function onVideoEnded() {
  // Reclamele rulează în ACELAȘI <video>, deci la capătul lor firesc elementul emite tot
  // „ended”. Fără garda asta, un pre-roll „termina” analiza cu zero acorduri (butonul părea
  // mort), iar un mid-roll salva jumătate de melodie și o prezenta drept învățată.
  // Asumat: dacă un post-roll pornește exact în clipa în care se termină melodia, ratăm
  // oprirea automată și omul apasă „Oprește” — degradare acceptabilă; opusul nu era.
  if (state.mode !== 'listening' || isAdShowing()) return;
  log.info('Melodia s-a terminat — închei analiza singur.');
  chrome.runtime.sendMessage({ target: 'background', type: 'REQUEST_STOP' }).catch(() => {});
  // Trecem local în Pasul 2 fără să așteptăm confirmarea: dacă service workerul a fost
  // reciclat și mesajul se pierde, omul tot trebuie să-și vadă melodia. Dublura e inofensivă
  // — stopClock() iese din prima dacă nu mai suntem în „ascult”, iar CHORD_EVENT-urile
  // întârziate sunt oricum ignorate în afara modului „ascult”.
  stopClock();
}

function onMessage(msg) {
  if (msg?.target !== 'content') return;
  if (msg.type === 'CAPTURE_STATE') {
    msg.capturing ? startClock() : stopClock();
  }
  if (msg.type === 'CAPTURE_FAILED') {
    // tabCapture cere ca extensia să fi fost invocată; un click în pagină nu contează.
    log.warn('Captura nu a pornit:', msg.reason);
    ui.status.textContent = STR.needIconClick;
    ui.status.classList.add('is-warning');
    return;
  }
  if (msg.type === 'CHORD_EVENT' && msg.videoId === state.videoId) {
    // DOAR în modul „ascult”: după un refresh, captura poate rămâne o clipă în viață și ar
    // împinge evenimente vechi peste cronologia tocmai încărcată din memorie.
    if (state.mode !== 'listening') {
      log.debug('CHORD_EVENT ignorat (nu ascult):', msg.label);
      return;
    }
    log.debug('CHORD_EVENT', msg.label, '@', msg.t);
    // Invariantul „sortate după t” e obligatoriu: chordIndexAt e căutare binară, iar lista
    // ajunge ca atare în memorie. La derulare înapoi analizorul re-analizează zona, deci
    // evenimentele noi ÎNLOCUIESC coada veche în loc să se așeze după ea.
    while (state.chords.length && state.chords[state.chords.length - 1].t >= msg.t) {
      state.chords.pop();
    }
    state.chords.push({ t: msg.t, label: msg.label, confidence: msg.confidence });
    render();
    scheduleSave();
  }
}

function startClock() {
  // O buclă de exersare ar re-analiza la nesfârșit aceleași secunde, iar viteza schimbată
  // strică detecția. Analiza cere melodia întreagă, la viteza ei.
  stopPractice(true);
  stopPlayback();
  state.mode = 'listening';
  state.chords = [];
  state.capo = 0;
  state.suggestedCapo = 0;
  state.structure = null; // structura ține de melodia memorată, nu de analiza în curs
  state.clusterOrder = new Map();
  state.lastSection = -1;
  ui.barKey = null;       // reanaliza trebuie să reconstruiască bara, nu s-o creadă valabilă
  ui.sheetKey = null;
  ui.stripKey = null;
  state.clockVideo = getVideo();
  state.clockVideo?.addEventListener('ended', onVideoEnded);
  state.lastClockT = 0;
  clearInterval(state.timeInterval);
  state.timeInterval = setInterval(() => {
    const video = getVideo();
    if (!video || video.paused || isAdShowing()) return; // fără ceas => analizorul aruncă cadrele
    // Cu bucla nativă a YouTube (click-dreapta pe player → repetare) evenimentul „ended” NU
    // se emite NICIODATĂ: spec-ul HTML sare la început fără niciun eveniment. Fără asta,
    // panoul rămânea veșnic în Pasul 1, iar la reluare acordurile cu t≈0 ștergeau, prin
    // curățarea de după derulare, toată cronologia primei treceri — și o salvau peste
    // memoria bună. Reluarea buclei E finalul melodiei.
    // Asumat: cu Loop pornit, o derulare manuală înapoi la început e indistinctibilă de
    // wrap și încheie analiza cu ce s-a strâns; mai bine decât să pierdem tot.
    if (video.loop && state.lastClockT > 5 && video.currentTime < 1.5
        && video.currentTime < state.lastClockT - 5) {
      onVideoEnded();
      return;
    }
    state.lastClockT = video.currentTime;
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'CT_TIME',
      videoId: state.videoId,
      t: video.currentTime,
      rate: video.playbackRate,
    }).catch(() => {});
  }, 250);
  log.info('Ceasul CT_TIME pornit.');
  render();
}

function stopClock() {
  if (state.mode !== 'listening') return;
  state.clockVideo?.removeEventListener('ended', onVideoEnded);
  state.clockVideo = null;
  clearInterval(state.timeInterval);
  state.timeInterval = null;
  log.info(`Ceasul CT_TIME oprit. ${state.chords.length} acorduri strânse.`);
  saveCache().then(() => {
    if (state.chords.length >= 2) startPlayback();
    else { state.mode = 'idle'; render(); }
  });
}

function startPlayback() {
  state.mode = 'playback';
  state.lastIndex = -1;
  state.lastSection = -1;
  stopPlayback(true);
  computeStructure();
  const tick = () => {
    const video = getVideo();
    if (video) {
      const t = video.currentTime;
      const idx = chordIndexAt(t);
      if (idx !== state.lastIndex) { state.lastIndex = idx; render(); }
      // Secțiunea și anunțul depind de TIMP, nu de schimbarea acordului, deci se verifică
      // separat — dar scriem în DOM doar când chiar se schimbă ceva (bucla e la 60 fps).
      const sIdx = sectionIndexAt(t);
      const announce = shouldAnnounce(t, sIdx);
      if (sIdx !== state.lastSection || announce !== state.lastAnnounce) {
        state.lastSection = sIdx;
        state.lastAnnounce = announce;
        updateCurrentSection(t);
      }
      // Foaia se evidențiază la nivel de ACORD, deci se schimbă mai des decât secțiunea —
      // dar tot doar de câteva ori pe minut. updateSheetHighlight iese singură dacă nimic
      // nu s-a schimbat, deci nu atinge DOM-ul la fiecare cadru.
      updateSheetHighlight(t);
      // Singura scriere care CHIAR se face la fiecare cadru: transformul benzii. E o
      // proprietate compozitată, deci nu declanșează recalcul de layout.
      updateStrip(t);
      if (state.practice) tickPractice(t);
    }
    state.rafId = requestAnimationFrame(tick);
  };
  state.rafId = requestAnimationFrame(tick);
  log.info('Mod redare: urmăresc timpul videoului.');
  render();
}

/** Suntem aproape de granița secțiunii curente? (folosit ca să nu rescriem DOM degeaba) */
function shouldAnnounce(t, sIdx) {
  const st = state.structure;
  if (!st || sIdx < 0) return false;
  const current = st.sections[sIdx];
  return !!st.sections[sIdx + 1] && current.end - t <= ANNOUNCE_AHEAD;
}

function stopPlayback(keepMode = false) {
  if (state.rafId !== null) cancelAnimationFrame(state.rafId);
  state.rafId = null;
  if (!keepMode && state.mode === 'playback') state.mode = 'idle';
}

// --- Utilitare ----------------------------------------------------------------

// YouTube e SPA: la document_idle, #below poate să nu existe încă. Îl așteptăm scurt
// înainte să cădem pe overlay — altfel panoul ajunge în colț chiar și pe pagini normale.
function waitFor(selector, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const found = document.querySelector(selector);
    if (found) return resolve(found);
    const obs = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) { obs.disconnect(); clearTimeout(timer); resolve(el); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(() => { obs.disconnect(); resolve(null); }, timeoutMs);
  });
}
