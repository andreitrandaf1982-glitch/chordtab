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

  const host = document.querySelector('#below');
  if (host) {
    host.prepend(panel);
  } else {
    // YouTube și-a schimbat DOM-ul sau nu suntem pe pagina de watch — overlay fix.
    log.warn('Selectorul #below lipsește — folosesc overlay-ul de rezervă.');
    panel.classList.add('chordtab-overlay');
    document.body.appendChild(panel);
  }
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
