import { createLogger, DEBUG_DEFAULT } from '../lib/logger.js';

const log = createLogger('options');
const debugEl = document.getElementById('debug');
const clearEl = document.getElementById('clear-cache');
const statusEl = document.getElementById('status');

const { debug } = await chrome.storage.local.get('debug');
debugEl.checked = debug === undefined ? DEBUG_DEFAULT : !!debug;

debugEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ debug: debugEl.checked });
  statusEl.textContent = debugEl.checked ? 'Debug pornit.' : 'Debug oprit.';
  log.info('Debug =', debugEl.checked);
});

clearEl.addEventListener('click', async () => {
  const all = await chrome.storage.local.get(null);
  const chordKeys = Object.keys(all).filter((k) => k.startsWith('chords:'));
  await chrome.storage.local.remove(chordKeys);
  statusEl.textContent = `Cache golit (${chordKeys.length} melodii).`;
  log.info('Cache golit:', chordKeys.length, 'chei.');
});

// ---------------------------------------------------------------------------------------------
// Poarta 0 — proba Gemini Nano (temporară: se scoate la ambalarea v0.4.0, după decizie).
// „Profesorul AI” se construiește DOAR dacă proba asta trece în Chrome-ul real al lui Andrei —
// Chromium-ul din teste n-are modelul, deci un test automat verde n-ar dovedi nimic (lecția
// Essentia). Proba răspunde la trei întrebări: există API-ul (și sub ce formă), e modelul
// disponibil (și în service worker, unde ar rula în producție), și cum sună româna lui.

const nanoCheckEl = document.getElementById('nano-check');
const nanoRunEl = document.getElementById('nano-run');
const nanoOutEl = document.getElementById('nano-out');

const NANO_TEST_PROMPT =
  'Ești profesor de chitară pentru începători. Explică în română, în 3-4 fraze simple, ' +
  'de ce acordul Fa (F) e greu pentru începători și dă un truc practic ca să iasă mai ușor.';

function nanoAPI() {
  if (typeof LanguageModel !== 'undefined') return { kind: 'LanguageModel (stabil)', api: LanguageModel };
  const legacy = globalThis.ai?.languageModel;
  if (legacy) return { kind: 'ai.languageModel (variantă veche)', api: legacy };
  return null;
}

async function nanoAvailability(api) {
  if (typeof api.availability === 'function') return api.availability();
  if (typeof api.capabilities === 'function') {
    const c = await api.capabilities();
    return { no: 'unavailable', 'after-download': 'downloadable', readily: 'available' }[c.available] ?? String(c.available);
  }
  return 'necunoscut (API fără availability/capabilities)';
}

const nanoLines = [];
function nanoReport(...added) {
  nanoLines.push(...added);
  nanoOutEl.textContent = nanoLines.join('\n');
}

nanoCheckEl.addEventListener('click', async () => {
  nanoLines.length = 0;
  nanoOutEl.textContent = '';
  const found = nanoAPI();
  nanoReport(`API în pagina de opțiuni: ${found ? found.kind : 'ABSENT'}`);

  let availability = null;
  if (found) {
    try {
      availability = await nanoAvailability(found.api);
      nanoReport(`Disponibilitate model: ${availability}`);
    } catch (err) {
      nanoReport(`Disponibilitate model: EROARE — ${err?.message || err}`);
    }
  }

  // Părerea service workerului: în producție, „Profesorul” ar rula acolo, nu în pagina asta.
  try {
    const sw = await chrome.runtime.sendMessage({ target: 'background', type: 'NANO_PROBE' });
    nanoReport(`API în service worker: ${sw?.found || 'ABSENT'}${sw?.availability ? ` (model: ${sw.availability})` : ''}`);
  } catch (err) {
    nanoReport(`API în service worker: fără răspuns — ${err?.message || err}`);
  }

  if (availability === 'available') {
    nanoRunEl.hidden = false;
    nanoRunEl.textContent = '2. Testează româna';
    nanoReport('', 'Modelul e deja descărcat. Apasă butonul 2.');
  } else if (availability === 'downloadable' || availability === 'downloading') {
    nanoRunEl.hidden = false;
    nanoRunEl.textContent = '2. Descarcă modelul (~2–4 GB, o dată) și testează';
    nanoReport('', 'Modelul trebuie descărcat o singură dată. Butonul 2 pornește descărcarea.');
  } else if (found) {
    nanoReport('', 'Modelul nu e disponibil pe calculatorul ăsta în forma actuală.');
  }
  log.info('Poarta 0 Nano — verificare:', nanoLines.join(' | '));
});

nanoRunEl.addEventListener('click', async () => {
  nanoRunEl.disabled = true;
  nanoReport('', '— Testul de română —');
  const found = nanoAPI();
  if (!found) {
    nanoReport('API absent — rulează întâi butonul 1.');
    nanoRunEl.disabled = false;
    return;
  }
  try {
    const t0 = performance.now();
    const session = await found.api.create({
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          // API-ul nou dă e.loaded ca fracție 0..1; cel vechi dă octeți + e.total.
          const frac = e.total > 1 ? e.loaded / e.total : (e.loaded ?? 0);
          nanoOutEl.textContent = `${nanoLines.join('\n')}\nDescărcare model: ${Math.round(frac * 100)}%`;
        });
      },
    });
    nanoReport(`Sesiune creată în ${Math.round(performance.now() - t0)} ms (include descărcarea, dacă a fost).`);
    const t1 = performance.now();
    const answer = await session.prompt(NANO_TEST_PROMPT);
    nanoReport(`Răspuns în ${Math.round(performance.now() - t1)} ms:`, '', answer);
    session.destroy?.();
    log.info('Poarta 0 Nano — prompt reușit.');
  } catch (err) {
    nanoReport(`EROARE: ${err?.name || ''} ${err?.message || err}`);
    log.error('Poarta 0 Nano — eroare:', err?.message || err);
  } finally {
    nanoRunEl.disabled = false;
  }
});
