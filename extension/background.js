// Service worker: pornește/oprește captura la click pe iconiță și face releu de mesaje
// offscreen -> content (documentul offscreen nu poate vorbi direct cu tabul).
//
// ATENȚIE la ciclul de viață MV3: Chrome oprește service workerul după ~30s fără evenimente.
// În timpul analizei cu videoul rulând nu se întâmplă (CT_TIME-ul de la 250ms îl ține treaz),
// dar la o PAUZĂ sau o reclamă mai lungă de 30s traficul încetează și SW-ul e reciclat, în
// timp ce documentul offscreen continuă să captureze. De aceea starea capturii NU poate trăi
// doar în memorie: se persistă în chrome.storage.session și se rehidratează la pornire.
// Fără asta, un SW repornit arunca toate CHORD_EVENT-urile (panou înghețat) și transforma
// butonul „Oprește” într-un restart care ștergea acordurile strânse.

import { createLogger } from './lib/logger.js';

const log = createLogger('background');

const state = {
  capturingTabId: null,
  busy: false,        // o pornire/oprire e în curs (gardă sincronă contra dublu-click)
  hydrated: false,
};

/** Citește starea persistată o singură dată, la prima nevoie după pornirea SW-ului. */
async function ready() {
  if (state.hydrated) return;
  try {
    const { capturingTabId } = await chrome.storage.session.get('capturingTabId');
    state.capturingTabId = capturingTabId ?? null;
  } catch (err) {
    log.warn('Nu am putut reciti starea capturii:', err?.message);
  }
  state.hydrated = true;
}

async function setCapturingTab(tabId) {
  state.capturingTabId = tabId;
  state.hydrated = true;
  try {
    if (tabId === null) await chrome.storage.session.remove('capturingTabId');
    else await chrome.storage.session.set({ capturingTabId: tabId });
  } catch (err) {
    log.warn('Nu am putut salva starea capturii:', err?.message);
  }
}

chrome.action.onClicked.addListener((tab) => toggleCapture(tab, 'click pe iconiță'));

function isWatchPage(url) {
  // Strict pe scope-ul declarat: content scriptul se injectează DOAR pe www.youtube.com.
  // Pe music.youtube.com / m.youtube.com am porni captura fără niciun panou și fără cale
  // vizibilă de oprire — mai bine refuzăm decât să capturăm în gol.
  try {
    const u = new URL(url);
    return u.hostname === 'www.youtube.com' && u.pathname === '/watch';
  } catch {
    return false;
  }
}

async function toggleCapture(tab, reason) {
  // Gardă sincronă: două click-uri rapide porneau două startCapture concurente, iar calea de
  // eroare a celui de-al doilea închidea documentul offscreen al primului.
  if (state.busy) {
    log.debug('O pornire/oprire e deja în curs — ignor cererea.');
    return;
  }
  state.busy = true;
  try {
    if (!tab?.url || !isWatchPage(tab.url)) {
      log.warn('Cerere de captură în afara unei pagini de video YouTube — ignor.', tab?.url);
      return;
    }
    await ready();
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
  } finally {
    state.busy = false;
  }
}

async function startCapture(tab) {
  // ORDINEA CONTEAZĂ: cerem streamId ÎNAINTE de orice alt await. getMediaStreamId are nevoie
  // de gestul utilizatorului (clickul pe iconiță), iar acesta se poate pierde peste un await.
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  await ensureOffscreen();
  await setCapturingTab(tab.id);
  log.info('Pornesc captura pe tab', tab.id);
  chrome.runtime
    .sendMessage({ target: 'offscreen', type: 'START_CAPTURE', streamId, tabId: tab.id })
    .catch((err) => log.error('START_CAPTURE nu a ajuns la offscreen:', err?.message));
  notifyContent({ type: 'CAPTURE_STATE', capturing: true });
}

async function stopCapture(reason) {
  await ready();
  if (state.capturingTabId !== null) {
    log.info('Opresc captura:', reason);
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP_CAPTURE' }).catch(() => {});
    notifyContent({ type: 'CAPTURE_STATE', capturing: false });
    await setCapturingTab(null);
  }
  // Închidem documentul necondiționat: dacă startCapture a crăpat după ce l-a creat,
  // altfel ar rămâne agățat fără ca nimeni să-l mai închidă.
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // nu era deschis — ok
  }
}

let offscreenReady = null;   // resolver-ul strângerii de mână cu documentul offscreen
let creatingOffscreen = null; // promisiunea creării în curs (nu o porni de două ori)

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length > 0) return;
  if (creatingOffscreen) return creatingOffscreen; // o creare e deja în zbor

  // Scriptul offscreen e modul ES => se încarcă asincron DUPĂ createDocument(). Așteptăm
  // semnalul OFFSCREEN_READY, altfel START_CAPTURE se pierde în gol.
  creatingOffscreen = (async () => {
    const ready$ = new Promise((resolve) => { offscreenReady = resolve; });
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Analizează audio-ul tabului pentru detecția acordurilor de chitară.',
    });
    const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), 10000));
    if (await Promise.race([ready$, timeout]) === 'timeout') {
      log.warn('Documentul offscreen n-a semnalat OFFSCREEN_READY în 10s — continui oricum.');
    }
    offscreenReady = null;
    log.debug('Document offscreen creat și pregătit.');
  })().finally(() => { creatingOffscreen = null; });

  return creatingOffscreen;
}

function notifyContent(msg) {
  if (state.capturingTabId === null) return;
  chrome.tabs.sendMessage(state.capturingTabId, { target: 'content', ...msg }).catch((err) => {
    log.warn('Nu am putut anunța content scriptul:', err?.message);
  });
}

// Releu: mesajele offscreen (CHORD_EVENT etc.) către content scriptul tabului capturat.
// CT_TIME (content -> offscreen) NU trece pe aici: runtime.sendMessage ajunge direct la offscreen.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'background') {
    // Poarta 0 (temporar): pagina de opțiuni întreabă dacă Gemini Nano există AICI, în
    // service worker — contextul în care ar rula „Profesorul AI” în producție.
    if (msg.type === 'NANO_PROBE') {
      (async () => {
        let found = null;
        let availability = null;
        try {
          if (typeof LanguageModel !== 'undefined') {
            found = 'LanguageModel (stabil)';
            availability = await LanguageModel.availability();
          } else if (globalThis.ai?.languageModel) {
            found = 'ai.languageModel (variantă veche)';
            const c = await globalThis.ai.languageModel.capabilities?.();
            availability = c?.available ?? null;
          }
        } catch (err) {
          availability = `eroare: ${err?.message || err}`;
        }
        sendResponse({ found, availability });
      })();
      return true; // sendResponse vine asincron
    }
    if (msg.type === 'OFFSCREEN_READY') {
      log.debug('Documentul offscreen a semnalat că e pregătit.');
      offscreenReady?.();
      return;
    }
    // Documentul offscreen n-a putut porni captura. Fără asta, content rămânea pe „ascult”
    // la nesfârșit, fiindcă primise deja CAPTURE_STATE capturing:true.
    if (msg.type === 'CAPTURE_ERROR') {
      log.error('Offscreen nu a putut porni captura:', msg.reason);
      (async () => {
        const tabId = state.capturingTabId;
        await stopCapture('eroare în offscreen');
        if (tabId != null) {
          chrome.tabs.sendMessage(tabId, {
            target: 'content', type: 'CAPTURE_FAILED', reason: String(msg.reason || ''),
          }).catch(() => {});
        }
      })();
      return;
    }
    // Butoanele din panoul de sub video.
    if (msg.type === 'REQUEST_START' || msg.type === 'REQUEST_STOP') {
      if (sender?.tab) toggleCapture(sender.tab, 'buton din panou');
      return;
    }
  }
  if (msg?.target === 'content') {
    // Handlerul e sincron, dar rehidratarea e asincronă: după un restart de SW starea încă
    // nu e citită, iar un guard naiv ar arunca tăcut toate acordurile.
    (async () => {
      await ready();
      if (state.capturingTabId !== null) notifyContent(msg);
    })();
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ready();
  if (tabId === state.capturingTabId) stopCapture('tab închis');
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  // `status: 'loading'` prinde ȘI refresh-ul (F5), unde changeInfo.url lipsește fiindcă
  // adresa nu se schimbă. Fără el, captura rămânea fantomă după reload: continua să consume
  // resurse, poluia cronologia cu evenimente vechi și inversa sensul butonului din panou.
  if (!changeInfo.url && changeInfo.status !== 'loading') return;
  await ready();
  if (tabId === state.capturingTabId) stopCapture(changeInfo.url ? 'navigare' : 'reîncărcare');
});
