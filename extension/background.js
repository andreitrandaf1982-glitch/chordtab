// Service worker: pornește/oprește captura la click pe iconiță și face releu de mesaje
// offscreen -> content (documentul offscreen nu poate vorbi direct cu tabul).

import { createLogger } from './lib/logger.js';

const log = createLogger('background');
const state = { capturingTabId: null };

chrome.action.onClicked.addListener((tab) => toggleCapture(tab, 'click pe iconiță'));

async function toggleCapture(tab, reason) {
  try {
    if (!tab?.url || !tab.url.includes('youtube.com/watch')) {
      log.warn('Cerere de captură în afara unei pagini de video YouTube — ignor.', tab?.url);
      return;
    }
    if (state.capturingTabId === tab.id) {
      await stopCapture(reason);
      return;
    }
    if (state.capturingTabId !== null) await stopCapture('captură nouă pe alt tab');
    await startCapture(tab);
  } catch (err) {
    log.error('Eroare la pornirea/oprirea capturii:', err?.message || err);
    await stopCapture('eroare').catch(() => {});
    // Cel mai probabil motiv: tabCapture cere ca extensia să fi fost INVOCATĂ (click pe
    // iconiță). Un click în pagină nu contează ca invocare, deci îi spunem omului ce să facă.
    if (tab?.id != null) {
      chrome.tabs.sendMessage(tab.id, {
        target: 'content', type: 'CAPTURE_FAILED', reason: String(err?.message || err),
      }).catch(() => {});
    }
  }
}

async function startCapture(tab) {
  // ORDINEA CONTEAZĂ: cerem streamId ÎNAINTE de orice alt await. getMediaStreamId are nevoie
  // de gestul utilizatorului (clickul pe iconiță), iar acesta se poate pierde peste un await.
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  await ensureOffscreen();
  state.capturingTabId = tab.id;
  log.info('Pornesc captura pe tab', tab.id);
  chrome.runtime
    .sendMessage({ target: 'offscreen', type: 'START_CAPTURE', streamId, tabId: tab.id })
    .catch((err) => log.error('START_CAPTURE nu a ajuns la offscreen:', err?.message));
  notifyContent({ type: 'CAPTURE_STATE', capturing: true });
}

async function stopCapture(reason) {
  const wasCapturing = state.capturingTabId !== null;
  if (wasCapturing) {
    log.info('Opresc captura:', reason);
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP_CAPTURE' }).catch(() => {});
    notifyContent({ type: 'CAPTURE_STATE', capturing: false });
    state.capturingTabId = null;
  }
  // Închidem documentul necondiționat: dacă startCapture a crăpat după ce l-a creat,
  // altfel ar rămâne agățat fără ca nimeni să-l mai închidă.
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // nu era deschis — ok
  }
}

let offscreenReady = null; // resolver-ul strângerii de mână cu documentul offscreen

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length > 0) return;

  // Scriptul offscreen e modul ES => se încarcă asincron DUPĂ createDocument(). Așteptăm
  // semnalul OFFSCREEN_READY, altfel START_CAPTURE se pierde în gol.
  const ready = new Promise((resolve) => { offscreenReady = resolve; });
  await chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Analizează audio-ul tabului pentru detecția acordurilor de chitară.',
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), 10000));
  if (await Promise.race([ready, timeout]) === 'timeout') {
    log.warn('Documentul offscreen n-a semnalat OFFSCREEN_READY în 10s — continui oricum.');
  }
  offscreenReady = null;
  log.debug('Document offscreen creat și pregătit.');
}

function notifyContent(msg) {
  if (state.capturingTabId === null) return;
  chrome.tabs.sendMessage(state.capturingTabId, { target: 'content', ...msg }).catch((err) => {
    log.warn('Nu am putut anunța content scriptul:', err?.message);
  });
}

// Releu: mesajele offscreen (CHORD_EVENT etc.) către content scriptul tabului capturat.
// CT_TIME (content -> offscreen) NU trece pe aici: runtime.sendMessage ajunge direct la offscreen.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.target === 'background') {
    if (msg.type === 'OFFSCREEN_READY') {
      log.debug('Documentul offscreen a semnalat că e pregătit.');
      offscreenReady?.();
      return;
    }
    // Butoanele din panoul de sub video.
    if (msg.type === 'REQUEST_START' || msg.type === 'REQUEST_STOP') {
      if (sender?.tab) toggleCapture(sender.tab, 'buton din panou');
      return;
    }
  }
  if (msg?.target === 'content' && state.capturingTabId !== null) {
    notifyContent(msg);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.capturingTabId) stopCapture('tab închis');
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === state.capturingTabId && changeInfo.url) stopCapture('navigare în alt video');
});
