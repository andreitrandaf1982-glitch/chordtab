// Logger central ChordTab. TOATE fișierele îl folosesc — niciun console.log direct.
// (Singura excepție justificată e content/loader.js; motivul e scris acolo.)
//
// debug/info tac dacă opțiunea „Debug logging” e oprită; warn/error se văd mereu.

// Implicit OPRIT: consola utilizatorului rămâne curată. Avertismentele și erorile se văd
// mereu, fiindcă alea sunt lucruri care chiar s-au stricat. Se pornește din pagina de opțiuni.
export const DEBUG_DEFAULT = false;

const state = { debug: DEBUG_DEFAULT, settled: false };

// Citirea setării e ASINCRONĂ, dar modulele încep să logheze imediat ce se încarcă. Fără
// tamponul ăsta, exact mesajele de la pornire — cele mai utile la depanare — se pierdeau,
// chiar cu debug pornit. Le ținem deoparte până aflăm setarea, apoi le vărsăm sau le uităm.
const pending = [];
const MAX_PENDING = 200;

function emit(level, prefix, args) {
  if (level === 'warn' || level === 'error') {
    console[level](prefix, ...args);
    return;
  }
  if (!state.settled) {
    if (pending.length < MAX_PENDING) pending.push([level, prefix, args]);
    return;
  }
  if (state.debug) console[level](prefix, ...args);
}

function settle(debug) {
  state.debug = debug;
  state.settled = true;
  if (debug) for (const [level, prefix, args] of pending) console[level](prefix, ...args);
  pending.length = 0;
}

(async () => {
  try {
    const { debug } = await chrome.storage.local.get('debug');
    settle(debug === undefined ? DEBUG_DEFAULT : !!debug);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && 'debug' in changes) state.debug = !!changes.debug.newValue;
    });
  } catch {
    // În afara contextului de extensie (ex. testele din Node) nu există chrome.storage.
    // Acolo tăcem: testele își tipăresc singure concluziile.
    settle(false);
  }
})();

export function createLogger(module) {
  const prefix = `[ChordTab:${module}]`;
  return {
    debug: (...args) => emit('debug', prefix, args),
    info: (...args) => emit('info', prefix, args),
    warn: (...args) => emit('warn', prefix, args),
    error: (...args) => emit('error', prefix, args),
  };
}
