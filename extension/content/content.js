// Content script: panoul de acorduri de sub video + ceasul CT_TIME către offscreen.
// YouTube e un SPA — navigarea între videouri NU reîncarcă pagina (vezi yt-navigate-finish).

import { createLogger } from '../lib/logger.js';
import { STR } from '../lib/strings.js';

const log = createLogger('content');

const state = {
  videoId: null,
  capturing: false,
  timeInterval: null,
  chords: [], // { t, label, confidence } — acumulate în sesiunea curentă
  transpose: 0, // TODO(Pasul 6): butoane ±1 semiton + capo
};

const ui = { panel: null, current: null, strip: null, status: null };

init();

function init() {
  state.videoId = getVideoId();
  buildPanel();
  window.addEventListener('yt-navigate-finish', onNavigate);
  chrome.runtime.onMessage.addListener(onMessage);
  log.info('ChordTab activ pe pagină. videoId =', state.videoId);
  // TODO(Pasul 5): dacă există cache pentru videoId -> intră în "mod redare" fără captură
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

// --- Panoul -----------------------------------------------------------------

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

function buildPanel() {
  if (ui.panel) ui.panel.remove();
  const panel = document.createElement('div');
  panel.id = 'chordtab-panel';
  panel.innerHTML = `
    <div class="chordtab-header">
      <span class="chordtab-title">${STR.title}</span>
      <span class="chordtab-status"></span>
    </div>
    <div class="chordtab-current">—</div>
    <div class="chordtab-strip"></div>
  `;
  ui.panel = panel;
  ui.status = panel.querySelector('.chordtab-status');
  ui.current = panel.querySelector('.chordtab-current');
  ui.strip = panel.querySelector('.chordtab-strip');
  setStatus(STR.idle);

  // Îl atașăm imediat (overlay) ca să fie vizibil din prima, apoi îl mutăm sub video
  // când #below apare. Dacă nu apare deloc, rămâne overlay — comportamentul de rezervă.
  panel.classList.add('chordtab-overlay');
  document.body.appendChild(panel);

  waitFor('#below').then((host) => {
    if (!host || panel !== ui.panel || !panel.isConnected) return; // panoul a fost înlocuit între timp
    panel.classList.remove('chordtab-overlay');
    host.prepend(panel);
    log.debug('Panou mutat sub video (#below).');
  });
  // TODO(Pasul 7): tooltip cu diagrama acordului la hover pe .chordtab-current și chip-uri
}

function setStatus(text) {
  if (ui.status) ui.status.textContent = text;
}

function renderChord({ label }) {
  ui.current.textContent = label; // TODO(Pasul 6): aplică transpoziția activă la afișare
  const chip = document.createElement('span');
  chip.className = 'chordtab-chip';
  chip.textContent = label;
  ui.strip.appendChild(chip);
  while (ui.strip.children.length > 8) ui.strip.firstChild.remove();
}

// --- Mesaje + ceas ------------------------------------------------------------

function onMessage(msg) {
  if (msg?.target !== 'content') return;
  if (msg.type === 'CAPTURE_STATE') {
    msg.capturing ? startClock() : stopClock();
  }
  if (msg.type === 'CHORD_EVENT' && msg.videoId === state.videoId) {
    log.debug('CHORD_EVENT', msg.label, '@', msg.t);
    state.chords.push({ t: msg.t, label: msg.label, confidence: msg.confidence });
    renderChord(msg);
  }
}

function startClock() {
  state.capturing = true;
  setStatus(STR.listening);
  state.chords = [];
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
}

function stopClock() {
  state.capturing = false;
  clearInterval(state.timeInterval);
  state.timeInterval = null;
  setStatus(STR.idle);
  log.info('Ceasul CT_TIME oprit.');
  // TODO(Pasul 5): salvează state.chords în chrome.storage.local sub `chords:<videoId>`
}

function onNavigate() {
  const newId = getVideoId();
  if (newId === state.videoId) return;
  log.info('Navigare SPA: video nou', newId);
  stopClock();
  state.videoId = newId;
  state.chords = [];
  buildPanel();
}
