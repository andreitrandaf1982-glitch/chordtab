// Rulare: node tests/package.test.mjs   (cere `npm run build` înainte)
//
// POARTA 9: cineva din comunitate primește arhiva, o dezarhivează și o încarcă. Testul face
// exact asta — dezarhivează într-un folder nou, pornește un Chromium cu profil curat și
// verifică pe o pagină de tip YouTube că panoul apare și motorul de detecție merge.
//
// Nu testăm folderul de lucru, ci ARHIVA: dacă uităm un fișier la împachetare, aici se vede.

import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ZIP = join(ROOT, 'dist', 'chordtab-0.1.0.zip');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('SĂRIT: lipsește playwright.');
  process.exit(0);
}
if (!existsSync(ZIP)) {
  console.log('SĂRIT: nu există arhiva — rulează întâi `npm run build`.');
  process.exit(0);
}

const unzipped = mkdtempSync(join(tmpdir(), 'chordtab-pkg-'));
const profile = mkdtempSync(join(tmpdir(), 'chordtab-pkgprof-'));
let ctx;
let failures = 0;

const check = (name, fn) => {
  try { const r = fn(); if (r?.then) return r.then(() => console.log(`  ${name} ✔`), (e) => { failures++; console.error(`  ${name} ✘ — ${e.message}`); }); console.log(`  ${name} ✔`); }
  catch (err) { failures++; console.error(`  ${name} ✘ — ${err.message}`); }
};

try {
  const unzip = process.platform === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -Path '${ZIP}' -DestinationPath '${unzipped}' -Force`], { encoding: 'utf8' })
    : spawnSync('unzip', ['-q', ZIP, '-d', unzipped], { encoding: 'utf8' });
  assert.equal(unzip.status, 0, `dezarhivarea a eșuat: ${unzip.stderr}`);
  console.log(`  Arhiva se dezarhivează (${readdirSync(unzipped).length} intrări la rădăcină) ✔`);

  ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${unzipped}`, `--load-extension=${unzipped}`],
  });

  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 20000 }));
  const extId = new URL(sw.url()).host;
  console.log(`  Extensia din arhivă se încarcă în Chromium (id ${extId.slice(0, 8)}…) ✔`);

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await check('Motorul de detecție merge din arhivă', async () => {
    await page.goto(`chrome-extension://${extId}/offscreen/offscreen.html`);
    const gate = await page.waitForFunction(() => window.__chordtabGate || null, null, { timeout: 60000 })
      .then((h) => h.jsonValue());
    assert.equal(gate.ok, true, `auto-testul a picat: ${JSON.stringify(gate)}`);
  });

  await check('Panoul apare pe o pagină de tip YouTube', async () => {
    await page.route('https://www.youtube.com/**', (r) => r.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!DOCTYPE html><html lang="ro"><body><div class="html5-video-player">'
        + '<video class="html5-main-video"></video></div><div id="below"></div></body></html>',
    }));
    await page.goto('https://www.youtube.com/watch?v=pkgTest');
    await page.locator('#chordtab-panel').waitFor({ state: 'attached', timeout: 15000 });
    await page.waitForFunction(() => {
      const p = document.getElementById('chordtab-panel');
      return p?.parentElement?.id === 'below';
    }, null, { timeout: 10000 });
    const controls = await page.locator('#chordtab-panel .ct-capo').count();
    assert.ok(controls > 0, 'controalele de capo lipsesc din panou');
  });

  await check('Pagina de opțiuni se deschide', async () => {
    const opts = await ctx.newPage();
    await opts.goto(`chrome-extension://${extId}/options/options.html`);
    assert.ok(await opts.locator('#debug').count(), 'lipsește comutatorul de debug');
    assert.ok(await opts.locator('#clear-cache').count(), 'lipsește butonul de golire a memoriei');
    await opts.close();
  });

  if (errors.length) {
    failures++;
    console.error('  Erori de pagină:', errors.slice(0, 3).join(' | '));
  }
} catch (err) {
  failures++;
  console.error('  EȘEC:', err?.message || err);
} finally {
  await ctx?.close().catch(() => {});
  rmSync(unzipped, { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });
}

if (failures) { console.error(`package.test.mjs: ${failures} verificări au picat ✘`); process.exit(1); }
console.log('package.test.mjs: arhiva e gata de dat mai departe ✔');
