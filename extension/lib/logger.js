// Logger central ChordTab. TOATE fișierele îl folosesc — niciun console.log direct.
// debug/info tac dacă opțiunea "Debug logging" e oprită; warn/error se văd mereu.

// Implicit PORNIT cât timp construim (Pasul 8 îl trece pe false la trecerea finală de logging).
export const DEBUG_DEFAULT = true;

const state = { debug: DEBUG_DEFAULT };

(async () => {
  try {
    const { debug } = await chrome.storage.local.get('debug');
    state.debug = debug === undefined ? DEBUG_DEFAULT : !!debug;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && 'debug' in changes) state.debug = !!changes.debug.newValue;
    });
  } catch {
    // în afara contextului de extensie (ex. teste node) rămâne debug=false
  }
})();

export function createLogger(module) {
  const prefix = `[ChordTab:${module}]`;
  return {
    debug: (...args) => { if (state.debug) console.debug(prefix, ...args); },
    info: (...args) => { if (state.debug) console.info(prefix, ...args); },
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}
