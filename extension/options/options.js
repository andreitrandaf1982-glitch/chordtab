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
