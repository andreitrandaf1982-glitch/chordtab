// Rulare: node tests/ui.test.mjs
//
// Verifică panoul într-un Chromium REAL, cu extensia încărcată. Nu deschidem YouTube (ar cere
// cont, ar avea reclame și s-ar schimba sub noi): interceptăm adresa și servim o pagină cu
// aceeași structură pe care se bazează content.js (#below, .html5-video-player, <video>).
// Content scriptul se injectează pentru că adresa se potrivește cu tiparul din manifest.
//
// Acoperă Pașii 4, 5, 6 și 7: panoul, redarea din memorie, capo/transpoziția și diagramele.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'extension');
const VIDEO_ID = 'testVideo01';
const URL_WATCH = `https://www.youtube.com/watch?v=${VIDEO_ID}`;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('SĂRIT: lipsește playwright — rulează `npm install` apoi `npx playwright install chromium`.');
  process.exit(0);
}

// Cronologie de test: G D Am C, câte 4 secunde. Aleasă ca să aibă capo sugerat 0
// (toate sunt forme deschise), ca verificările de capo să pornească de la o bază știută.
const CHORDS = [
  { t: 0, label: 'G', confidence: 0.9 },
  { t: 4, label: 'D', confidence: 0.9 },
  { t: 8, label: 'Am', confidence: 0.9 },
  { t: 12, label: 'C', confidence: 0.9 },
];

// Elementul <video> trebuie să fie REAL, cu media care se poate derula: content scriptul rulează
// într-o lume izolată, care are propriul înveliș peste elementul DOM — o proprietate `currentTime`
// pusă din pagină cu defineProperty NU se vede acolo. (Am aflat-o pe pielea noastră: testul
// arăta mereu primul acord.) Așa că generăm un WAV tăcut de 20s și îl punem ca sursă.
function silentWav(seconds = 20, sampleRate = 8000) {
  const data = seconds * sampleRate;                 // 8 biți, mono
  const buf = Buffer.alloc(44 + data, 128);          // 128 = liniște în PCM 8 biți fără semn
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + data, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate, 28);
  buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34);
  buf.write('data', 36); buf.writeUInt32LE(data, 40);
  return buf.toString('base64');
}

const FAKE_PAGE = `<!DOCTYPE html><html lang="ro"><head><meta charset="utf-8"><title>Test</title></head>
<body>
  <div id="player"><div class="html5-video-player">
    <video class="html5-main-video" src="data:audio/wav;base64,${silentWav()}" preload="auto"></video>
  </div></div>
  <div id="below"><div id="comments">comentarii</div></div>
</body></html>`;

const profile = mkdtempSync(join(tmpdir(), 'chordtab-ui-'));
let ctx;
let failures = 0;

const check = async (name, fn) => {
  try { await fn(); console.log(`  ${name} ✔`); }
  catch (err) { failures++; console.error(`  ${name} ✘ — ${err.message}`); }
};

try {
  ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });

  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 20000 }));
  const extId = new URL(sw.url()).host;

  // Punem cronologia în memoria extensiei, ca și cum melodia ar fi fost deja analizată.
  const seeder = await ctx.newPage();
  await seeder.goto(`chrome-extension://${extId}/options/options.html`);
  await seeder.evaluate(async ({ id, chords }) => {
    await chrome.storage.local.set({
      [`chords:${id}`]: { version: 1, analyzedAt: new Date().toISOString(), capo: 0, chords },
    });
  }, { id: VIDEO_ID, chords: CHORDS });
  await seeder.close();

  const page = await ctx.newPage();
  page.on('pageerror', (e) => { failures++; console.error('  PAGEERROR:', e.message); });
  await page.route('https://www.youtube.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FAKE_PAGE }));
  await page.goto(URL_WATCH);

  const panel = page.locator('#chordtab-panel');
  await panel.waitFor({ state: 'attached', timeout: 15000 });

  await check('Pasul 4: panoul se injectează sub video (#below)', async () => {
    await page.waitForFunction(() => {
      const p = document.getElementById('chordtab-panel');
      return p && p.parentElement && p.parentElement.id === 'below';
    }, null, { timeout: 10000 });
    assert.ok(!(await panel.getAttribute('class') || '').includes('ct-overlay'),
      'panoul nu ar trebui să rămână overlay când #below există');
  });

  await check('Pasul 5: memoria e găsită, panoul intră în modul redare', async () => {
    await page.waitForFunction(
      () => document.querySelector('#chordtab-panel .ct-current')?.textContent?.trim() === 'G',
      null, { timeout: 10000 });
    const status = await page.locator('#chordtab-panel .ct-status').textContent();
    assert.match(status, /memorate/i, `stare neașteptată: „${status}”`);
  });

  const currentChord = () => page.locator('#chordtab-panel .ct-current').textContent();
  const upcoming = () => page.locator('#chordtab-panel .ct-chip').allTextContents();
  // Așteptăm ca media să fie încărcată, altfel currentTime nu se poate poziționa.
  await page.waitForFunction(() => {
    const v = document.querySelector('video');
    return v && v.readyState >= 1 && v.duration > 0;
  }, null, { timeout: 15000 });

  const seek = async (t) => {
    await page.evaluate((x) => { document.querySelector('video').currentTime = x; }, t);
    await page.waitForFunction(
      (x) => Math.abs(document.querySelector('video').currentTime - x) < 0.5,
      t, { timeout: 5000 });
    await page.waitForTimeout(150); // bucla rAF are nevoie de un cadru ca să redeseneze
  };

  await check('Pasul 5: acordul urmărește timpul videoului', async () => {
    await seek(5);
    assert.equal((await currentChord()).trim(), 'D', 'la 5s trebuie D');
    await seek(9);
    assert.equal((await currentChord()).trim(), 'Am', 'la 9s trebuie Am');
    await seek(13);
    assert.equal((await currentChord()).trim(), 'C', 'la 13s trebuie C');
  });

  await check('Pasul 4: se vede ce urmează, nu doar ce e acum', async () => {
    await seek(1);
    const next = await upcoming();
    assert.deepEqual(next, ['D', 'Am', 'C'], `„urmează” greșit: ${JSON.stringify(next)}`);
  });

  await check('Pasul 6: transpoziția mută toate acordurile', async () => {
    await seek(1);
    await page.click('#chordtab-panel .ct-tr-up');
    await page.click('#chordtab-panel .ct-tr-up');
    assert.equal((await currentChord()).trim(), 'A', 'G + 2 semitonuri = A');
    assert.deepEqual(await upcoming(), ['E', 'Bm', 'D'], 'și lista „urmează” trebuie transpusă');
    assert.equal((await page.locator('#chordtab-panel .ct-tr-value').textContent()).trim(), '+2');
    await page.click('#chordtab-panel .ct-reset');
    assert.equal((await currentChord()).trim(), 'G', 'resetarea readuce acordul original');
  });

  await check('Pasul 6: capo schimbă forma cântată, nu sunetul', async () => {
    await seek(1);
    await page.click('#chordtab-panel .ct-capo[data-capo="3"]');
    // Cu capo 3, ca să sune G cânți forma de E (G transpus în jos cu 3 semitonuri).
    assert.equal((await currentChord()).trim(), 'E', 'G cu capo 3 se cântă ca E');
    assert.deepEqual(await upcoming(), ['B', 'F#m', 'A'], 'lista „urmează” cu capo 3');
    const active = await page.locator('#chordtab-panel .ct-capo.is-active').textContent();
    assert.equal(active.trim(), '3', 'butonul de capo apăsat trebuie marcat');
    await page.click('#chordtab-panel .ct-reset');
  });

  const slot = () => page.locator('#chordtab-panel .ct-diagram-slot');

  await check('Pasul 7: diagrama acordului curent e mereu vizibilă', async () => {
    await seek(1);
    const svg = slot().locator('svg.ct-diagram');
    await svg.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal((await svg.locator('.ct-d-name').textContent()).trim(), 'G',
      'diagrama trebuie să fie a acordului afișat');
    // G deschis = 320003: trei degete apăsate, fără bară.
    assert.equal(await svg.locator('.ct-d-dot').count(), 3, 'G are 3 degete apăsate');
    assert.equal(await svg.locator('.ct-d-barre').count(), 0, 'G nu are bară');
  });

  await check('Pasul 7: diagrama se schimbă odată cu acordul', async () => {
    await seek(9);
    await page.waitForFunction(
      () => document.querySelector('#chordtab-panel .ct-d-name')?.textContent?.trim() === 'Am',
      null, { timeout: 5000 });
    // Am = x02210: trei degete, fără bară.
    assert.equal(await slot().locator('.ct-d-dot').count(), 3, 'Am are 3 degete apăsate');
  });

  await check('Pasul 7: diagrama urmează capo-ul', async () => {
    await seek(1);
    await page.click('#chordtab-panel .ct-capo[data-capo="3"]');
    await page.waitForFunction(
      () => document.querySelector('#chordtab-panel .ct-d-name')?.textContent?.trim() === 'E',
      null, { timeout: 5000 });
    assert.match(await slot().locator('.ct-d-capo').textContent(), /capo pe 3/);
    await page.click('#chordtab-panel .ct-reset');
  });

  await check('Pasul 7: hover pe un acord care urmează îi arată diagrama, apoi revine', async () => {
    await seek(1);
    await page.hover('#chordtab-panel .ct-chip >> nth=1'); // Am
    await page.waitForFunction(
      () => document.querySelector('#chordtab-panel .ct-d-name')?.textContent?.trim() === 'Am',
      null, { timeout: 5000 });
    await page.hover('#chordtab-panel .ct-title');
    await page.waitForFunction(
      () => document.querySelector('#chordtab-panel .ct-d-name')?.textContent?.trim() === 'G',
      null, { timeout: 5000 });
  });

  await check('Diagrama nu acoperă controalele', async () => {
    const d = await slot().boundingBox();
    const capo = await page.locator('#chordtab-panel .ct-capo-group').boundingBox();
    assert.ok(d && capo, 'ambele zone trebuie să fie vizibile');
    assert.ok(d.y + d.height <= capo.y + 1,
      `diagrama (până la ${Math.round(d.y + d.height)}px) intră peste controale (de la ${Math.round(capo.y)}px)`);
  });

  await check('Navigarea SPA resetează panoul', async () => {
    await page.evaluate(() => {
      history.pushState({}, '', '/watch?v=altVideo99');
      window.dispatchEvent(new Event('yt-navigate-finish'));
    });
    await page.waitForFunction(
      () => document.querySelector('#chordtab-panel .ct-current')?.textContent?.trim() === '—',
      null, { timeout: 8000 });
  });
} catch (err) {
  failures++;
  console.error('  EȘEC la pornirea testului:', err?.message || err);
} finally {
  await ctx?.close().catch(() => {});
  rmSync(profile, { recursive: true, force: true });
}

if (failures) {
  console.error(`ui.test.mjs: ${failures} verificări au picat ✘`);
  process.exit(1);
}
console.log('ui.test.mjs: toate testele au trecut ✔');
