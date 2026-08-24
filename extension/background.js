// Service worker: pornește/oprește captura la click pe iconiță și face releu de mesaje
// offscreen -> content (documentul offscreen nu poate vorbi direct cu tabul).

import { createLogger } from './lib/logger.js';

const log = createLogger('background');
const state = { capturingTabId: null };

chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (!tab.url || !tab.url.includes('youtube.com/watch')) {
      log.warn('Click pe iconiță în afara unei pagini de video YouTube — ignor.', tab.url);
      return;
    }
    if (state.capturingTabId === tab.id) {
      await stopCapture('click utilizator');
      return;
    }
    if (state.capturingTabId !== null) await stopCapture('captură nouă pe alt tab');
    await startCapture(tab);
  } catch (err) {
    log.error('Eroare la pornirea/oprirea capturii:', err);
    await stopCapture('eroare').catch(() => {});
  }
});

async function startCapture(tab) {
  await ensureOffscreen();
  // getMediaStreamId cere gestul utilizatorului (clickul pe iconiță) — de aici, nu din altă parte
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  state.capturingTabId = tab.id;
  log.info('Pornesc captura pe tab', tab.id);
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'START_CAPTURE', streamId, tabId: tab.id });
  notifyContent({ type: 'CAPTURE_STATE', capturing: true });
}

async function stopCapture(reason) {
  if (state.capturingTabId === null) return;
  log.info('Opresc captura:', reason);
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP_CAPTURE' }).catch(() => {});
  notifyContent({ type: 'CAPTURE_STATE', capturing: false });
  state.capturingTabId = null;
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // era deja închis — ok
  }
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Analizează audio-ul tabului pentru detecția acordurilor de chitară.',
  });
  log.debug('Document offscreen creat.');
}

function notifyContent(msg) {
  if (state.capturingTabId === null) return;
  chrome.tabs.sendMessage(state.capturingTabId, { target: 'content', ...msg }).catch((err) => {
    log.warn('Nu am putut anunța content scriptul:', err?.message);
  });
}

// Releu: mesajele offscreen (CHORD_EVENT etc.) către content scriptul tabului capturat.
// CT_TIME (content -> offscreen) NU trece pe aici: runtime.sendMessage ajunge direct la offscreen.
chrome.runtime.onMessage.addListener((msg) => {
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
