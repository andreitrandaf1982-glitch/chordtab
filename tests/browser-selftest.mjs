// Rulare: node tests/browser-selftest.mjs   (cere `npm install playwright` + `npx playwright install chromium`)
//
// Verifică partea de BROWSER a Porții 0: că lanțul de detecție chiar rulează într-o pagină
// de extensie MV3, sub CSP-ul real. Testele din Node validează algoritmul; ăsta validează mediul.
//
// Testul ăsta s-a născut dintr-un bug adevărat: Essentia.js trecea toate testele în Node și
// cădea în browser (docs/BUG-essentia-mv3-csp.md). Node nu poate dovedi că ceva merge în extensie.
//
// Nu acoperă tabCapture (cere click pe iconiță, imposibil de automatizat) — asta rămâne
// verificarea manuală din docs/VERIFICARE-porti-0-1-2.md.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'extension');

// Import dinamic: dacă playwright lipsește, sărim curat în loc să crăpăm la încărcare.
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('SĂRIT: lipsește playwright — rulează `npm install` apoi `npx playwright install chromium`.');
  process.exit(0);
}

const profile = mkdtempSync(join(tmpdir(), 'chordtab-'));
let ctx;
let exitCode = 1;

try {
  ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });

  // ID-ul extensiei: îl aflăm din service worker-ul ei.
  let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 20000 }));
  const extId = new URL(sw.url()).host;
  console.log('  Extensie încărcată, id =', extId);

  const page = await ctx.newPage();
  const lines = [];
  page.on('console', (m) => lines.push(m.text()));
  page.on('pageerror', (e) => lines.push('PAGEERROR: ' + e.message));

  await page.goto(`chrome-extension://${extId}/offscreen/offscreen.html`);

  // selfTest() e asincron (încarcă 2,4 MB de WASM) — îi dăm timp.
  const gate = await page.waitForFunction(
    () => window.__chordtabGate || null,
    null,
    { timeout: 60000 },
  ).then((h) => h.jsonValue()).catch(() => null);

  const consoleHit = lines.find((l) => l.includes('[POARTA 0]'));
  if (consoleHit) console.log('  Consolă:', consoleHit.trim());

  const ok = gate?.ok === true || /chord=C.*CORECT/.test(consoleHit || '');
  if (!ok) {
    console.error('  EȘEC — Poarta 0 nu a trecut în browser.');
    for (const l of lines.slice(-25)) console.error('    |', l);
  } else {
    console.log('  Poarta 0 (browser): lanțul de detecție rulează sub CSP-ul MV3, chord=C ✔');
    exitCode = 0;
  }

  // --- POARTA 8: consola tace cu debug oprit, vorbește cu el pornit ---
  const noisy = lines.filter((l) => l.includes('[ChordTab:'));
  if (noisy.length > 0) {
    exitCode = 1;
    console.error(`  EȘEC Poarta 8 — cu debug oprit, consola ar trebui să tacă. ${noisy.length} mesaje:`);
    for (const l of noisy.slice(0, 5)) console.error('    |', l);
  } else {
    console.log('  Poarta 8: cu debug oprit, consola e curată ✔');
  }

  await page.evaluate(() => chrome.storage.local.set({ debug: true }));
  const after = [];
  page.on('console', (m) => after.push(m.text()));
  await page.reload();
  await page.waitForFunction(() => window.__chordtabGate || null, null, { timeout: 60000 }).catch(() => {});
  const spoken = after.filter((l) => l.includes('[ChordTab:'));
  if (spoken.length === 0) {
    exitCode = 1;
    console.error('  EȘEC Poarta 8 — cu debug pornit nu s-a logat nimic.');
  } else {
    console.log(`  Poarta 8: cu debug pornit, traseul se vede (${spoken.length} mesaje) ✔`);
  }
} catch (err) {
  console.error('  EȘEC la pornirea browserului:', err?.message || err);
} finally {
  await ctx?.close().catch(() => {});
  rmSync(profile, { recursive: true, force: true });
}

process.exit(exitCode);
