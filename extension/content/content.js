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

const log = createLogger('content');

const CACHE_VERSION = 1;
const MAX_CAPO = 7;
const UPCOMING_COUNT = 3;
const RECENT_COUNT = 4;

const state = {
  videoId: null,
  mode: 'idle',       // 'idle' | 'listening' | 'playback'
  chords: [],         // { t, label, confidence } — sortate după t
  capo: 0,            // poziția capo aleasă (0 = fără)
  suggestedCapo: 0,
  transpose: 0,       // schimbare de tonalitate cerută manual, în semitonuri
  analyzedAt: null,
  timeInterval: null,
  rafId: null,
  lastIndex: -1,
};

const ui = {};

init();

// --- Ciclu de viață -----------------------------------------------------------

function init() {
  state.videoId = getVideoId();
  buildPanel();
  window.addEventListener('yt-navigate-finish', onNavigate);
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
    transpose: 0, analyzedAt: null, lastIndex: -1,
  });
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
    state.chords = stored.chords;
    state.analyzedAt = stored.analyzedAt;
    // Recalculăm sugestia din acorduri în loc s-o credem pe cea salvată: e ieftin și rămâne
    // corectă chiar dacă memoria a fost scrisă de o versiune mai veche sau din afară.
    state.suggestedCapo = bestCapo(stored.chords.map((c) => c.label), MAX_CAPO).capo;
    state.capo = state.suggestedCapo;
    log.info(`Am găsit ${stored.chords.length} acorduri memorate pentru ${state.videoId}.`);
    startPlayback();
  } catch (err) {
    log.warn('Nu am putut citi memoria:', err?.message);
  }
}

async function saveCache() {
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
      <div class="ct-next"><span class="ct-next-label"></span><span class="ct-next-list"></span></div>
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
  });

  ui.action.addEventListener('click', onActionClick);
  panel.querySelector('.ct-tr-down').addEventListener('click', () => nudgeTranspose(-1));
  panel.querySelector('.ct-tr-up').addEventListener('click', () => nudgeTranspose(1));
  panel.querySelector('.ct-reset').addEventListener('click', resetTuning);
  buildCapoButtons();
  wireDiagramPreview(panel);

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
      state.chords.length > 0 && Number(b.dataset.capo) === state.suggestedCapo);
  }

  if (mode === 'playback') renderPlayback();
  else renderLive();
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
  ui.nextList.innerHTML = '';
  for (const s of soundingLabels) {
    const label = displayLabel(s);
    const chip = document.createElement('span');
    chip.className = 'ct-chip';
    chip.textContent = label;
    chip.dataset.chord = label;
    chip.tabIndex = 0;
    chip.classList.toggle('ct-has-diagram', hasDiagram(label));
    ui.nextList.appendChild(chip);
  }
}

function nudgeTranspose(delta) {
  state.transpose = Math.max(-6, Math.min(6, state.transpose + delta));
  render();
}

function resetTuning() {
  state.transpose = 0;
  state.capo = state.suggestedCapo;
  render();
}

// --- Diagrame (Pasul 7) -------------------------------------------------------
//
// Diagrama acordului curent stă permanent lângă el — asta vrei când cânți, nu un balon
// care apare la hover. Trecerea cu mouse-ul peste un acord care urmează o înlocuiește
// temporar, ca să poți pregăti următoarea schimbare; la ieșire revine la acordul curent.

function showDiagram(label) {
  if (!ui.diagramSlot) return;
  const svg = label && label !== NO_CHORD && label !== STR.noChordsYet
    ? renderChordDiagram(label, state.capo)
    : null;
  ui.diagramSlot.innerHTML = svg || '';
  ui.diagramSlot.classList.toggle('is-empty', !svg);
}

function wireDiagramPreview(panel) {
  const preview = (e) => {
    const el = e.target.closest?.('.ct-chip[data-chord]');
    if (el) showDiagram(el.dataset.chord);
  };
  const restore = (e) => {
    if (e.target.closest?.('.ct-chip[data-chord]')) showDiagram(ui.current?.dataset.chord);
  };
  panel.addEventListener('mouseover', preview);
  panel.addEventListener('focusin', preview);
  panel.addEventListener('mouseout', restore);
  panel.addEventListener('focusout', restore);
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
    log.debug('CHORD_EVENT', msg.label, '@', msg.t);
    state.chords.push({ t: msg.t, label: msg.label, confidence: msg.confidence });
    if (state.mode === 'listening') render();
  }
}

function startClock() {
  stopPlayback();
  state.mode = 'listening';
  state.chords = [];
  state.capo = 0;
  state.suggestedCapo = 0;
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
  stopPlayback(true);
  const tick = () => {
    const video = getVideo();
    if (video) {
      const idx = chordIndexAt(video.currentTime);
      if (idx !== state.lastIndex) { state.lastIndex = idx; render(); }
    }
    state.rafId = requestAnimationFrame(tick);
  };
  state.rafId = requestAnimationFrame(tick);
  log.info('Mod redare: urmăresc timpul videoului.');
  render();
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
