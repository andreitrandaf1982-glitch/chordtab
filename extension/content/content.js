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
const UPCOMING_COUNT = 3;
const RECENT_COUNT = 4;
const MIN_COVERAGE = 0.5;   // sub atât, structura găsită e prea firavă ca s-o arătăm
const ANNOUNCE_AHEAD = 3;   // cu câte secunde înainte anunțăm secțiunea următoare

const state = {
  videoId: null,
  mode: 'idle',       // 'idle' | 'listening' | 'playback'
  chords: [],         // { t, label, confidence } — sortate după t
  capo: 0,            // poziția capo aleasă (0 = fără)
  suggestedCapo: 0,
  transpose: 0,       // schimbare de tonalitate cerută manual, în semitonuri
  analyzedAt: null,
  structure: null,    // rezultatul lui detectSections — doar în modul „memorat”
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
  stopClock();
  stopPlayback();
  Object.assign(state, {
    videoId: newId, mode: 'idle', chords: [], capo: 0, suggestedCapo: 0,
    transpose: 0, analyzedAt: null, structure: null, lastIndex: -1, lastSection: -1,
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
    const key = cacheKey();
    const stored = (await chrome.storage.local.get(key))[key];
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

function buildPanel() {
  document.getElementById('chordtab-panel')?.remove();

  const panel = document.createElement('div');
  panel.id = 'chordtab-panel';
  panel.innerHTML = `
    <div class="ct-head">
      <span class="ct-title">${STR.title}</span>
      <span class="ct-status"></span>
      <button class="ct-action" type="button"></button>
    </div>
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
    <div class="ct-structure" hidden>
      <span class="ct-group-label">${STR.structure}</span>
      <div class="ct-bar"></div>
    </div>
    <div class="ct-sheet-wrap" hidden>
      <span class="ct-group-label">${STR.sheet}</span>
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
    current: panel.querySelector('.ct-current'),
    nextLabel: panel.querySelector('.ct-next-label'),
    nextList: panel.querySelector('.ct-next-list'),
    capoButtons: panel.querySelector('.ct-capo-buttons'),
    capoHint: panel.querySelector('.ct-capo-hint'),
    trValue: panel.querySelector('.ct-tr-value'),
    diagramSlot: panel.querySelector('.ct-diagram-slot'),
    structure: panel.querySelector('.ct-structure'),
    bar: panel.querySelector('.ct-bar'),
    sheetWrap: panel.querySelector('.ct-sheet-wrap'),
    sheet: panel.querySelector('.ct-sheet'),
    sectionNow: panel.querySelector('.ct-section-now'),
  });

  ui.diagramKey = null;
  ui.chipKey = null;
  ui.action.addEventListener('click', onActionClick);
  panel.querySelector('.ct-tr-down').addEventListener('click', () => nudgeTranspose(-1));
  panel.querySelector('.ct-tr-up').addEventListener('click', () => nudgeTranspose(1));
  panel.querySelector('.ct-reset').addEventListener('click', resetControls);
  buildCapoButtons();

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

  buildStructure();
  buildSheet();
  if (mode === 'playback') {
    const video = getVideo();
    const t = video ? video.currentTime : 0;
    updateCurrentSection(t);
    ui.sheetHighlight = null; // foaia s-a putut reconstrui: forțăm o evidențiere proaspătă
    updateSheetHighlight(t);
  } else if (ui.sectionNow) {
    ui.sectionNow.hidden = true;
  }
}

function renderPlayback() {
  const video = getVideo();
  const idx = chordIndexAt(video ? video.currentTime : 0);
  setCurrent(idx >= 0 ? state.chords[idx].label : null);
  ui.nextLabel.textContent = STR.upNext;
  fillChordList(state.chords.slice(idx + 1, idx + 1 + UPCOMING_COUNT).map((c) => c.label));
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

// --- Structura melodiei -------------------------------------------------------
//
// Există DOAR în modul „memorat”: repetițiile se văd numai privind melodia întreagă.
// Bara se construiește O SINGURĂ DATĂ; în bucla de redare se schimbă doar clasa segmentului
// curent. (Lecția pâlpâitului: nu reconstrui DOM sub cursor la fiecare cadru.)

/** Numele de afișat al unei secțiuni: „B · Refren”, „Partea C”, „Intro” sau „Liber”. */
function sectionLabel(s) {
  const name = s.name ? STR.sectionNames[s.name] : null;
  return s.cluster ? STR.sectionLabel(s.cluster, name) : STR.freeSection(name);
}

function computeStructure() {
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

/** Construiește bara și legenda. Idempotent: dacă nimic relevant nu s-a schimbat, iese. */
function buildStructure() {
  if (!ui.structure) return;
  if (state.mode !== 'playback' || !hasUsefulStructure()) {
    ui.structure.hidden = true;
    ui.barKey = null;
    return;
  }
  const st = state.structure;
  // Cheia trebuie să vadă CONȚINUTUL secțiunilor, nu doar numărul lor: o reanaliză a aceleiași
  // melodii dă aproape sigur tot atâtea secțiuni, iar cu o cheie bazată pe lungime bara veche
  // rămânea pe ecran — inclusiv handler-ele de click, care duceau la granițele vechi. Exact
  // defectul pe care utilizatorul încerca să-l repare reanalizând.
  const shape = st.sections.map((s) => `${s.cluster || '-'}${s.start.toFixed(0)}`).join(',');
  const key = `${state.videoId}|${state.capo}|${state.transpose}|${shape}`;
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
    seg.textContent = s.cluster || '';
    const label = sectionLabel(s);
    seg.title = STR.jumpTo(label);
    seg.setAttribute('aria-label', STR.jumpTo(label));
    seg.addEventListener('click', () => {
      const video = getVideo();
      if (video) video.currentTime = s.start + 0.05; // 0.05 ca să cădem SIGUR în secțiune
    });
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

function makeSheetChip(label, seekTo) {
  const shown = displayLabel(label);
  const chip = document.createElement('span');
  chip.className = 'ct-chip ct-sheet-chip';
  chip.textContent = shown;
  chip.dataset.chord = shown;
  chip.dataset.t = String(seekTo);
  chip.tabIndex = 0;
  chip.classList.toggle('ct-has-diagram', hasDiagram(shown));
  attachChipHover(chip);
  chip.addEventListener('click', () => {
    const video = getVideo();
    if (video) video.currentTime = Math.max(0, seekTo) + 0.05;
  });
  return chip;
}

function sheetRow({ tag, group, chips, reps, index }) {
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
    label.addEventListener('click', () => {
      const video = getVideo();
      if (video) video.currentTime = tag.start + 0.05;
    });
    row.appendChild(label);
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
    + (st ? st.sections.map((s) => `${s.cluster || '-'}${s.start.toFixed(0)}`).join(',')
          : `plat:${state.chords.length}`);
  if (ui.sheetKey === key) return;
  ui.sheetKey = key;
  ui.sheetWrap.hidden = false;
  ui.sheet.innerHTML = '';

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
      // PRIMA trecere prin buclă.
      let offset = 0;
      chips = st.patterns[s.cluster].loop.map((item) => {
        const chip = makeSheetChip(item.label, s.start + offset);
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
    }));
  });
}

/** În ce chip din rândul dat cade momentul t? -1 dacă nu se poate spune. */
function sheetChipIndexAt(section, t) {
  const st = state.structure;
  if (section && section.cluster && st?.patterns[section.cluster]) {
    const { loop, period } = st.patterns[section.cluster];
    if (!(period > 0)) return -1;
    let phase = (t - section.start) % period;
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
    if (isCurrent) rows[i].scrollIntoView({ block: 'nearest' });
  }
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
  ui.nextLabel.textContent = soon ? STR.upNextSection(sectionLabel(next)) : STR.upNext;
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
  chrome.runtime.sendMessage({ target: 'background', type: 'REQUEST_START' })
    .catch((err) => log.warn('Nu am putut cere pornirea capturii:', err?.message));
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
  stopPlayback();
  state.mode = 'listening';
  state.chords = [];
  state.capo = 0;
  state.suggestedCapo = 0;
  state.structure = null; // structura ține de melodia memorată, nu de analiza în curs
  state.lastSection = -1;
  ui.barKey = null;       // reanaliza trebuie să reconstruiască bara, nu s-o creadă valabilă
  ui.sheetKey = null;
  clearInterval(state.timeInterval);
  state.timeInterval = setInterval(() => {
    const video = getVideo();
    if (!video || video.paused || isAdShowing()) return; // fără ceas => analizorul aruncă cadrele
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
