// Rulare: npm run screenshot
//
// Fotografiază panoul ChordTab dintr-un Chromium real, cu extensia încărcată, pe o pagină
// care imită structura YouTube. Folosit pentru README și ca să se poată vedea cum arată
// fără să fie nevoie de instalare.
//
// Rezultate în docs/capturi/: panou.png (starea normală) și panou-diagrama.png (cu diagrama).

import { chromium } from 'playwright';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'extension');
const OUT = join(ROOT, 'docs', 'capturi');
const VIDEO_ID = 'demoVideo01';

mkdirSync(OUT, { recursive: true });

// Trei melodii demonstrative.
const LOOP_A = ['G', 'D', 'Am', 'C'];
const LOOP_B = ['Em', 'C', 'G', 'D'];
const DEMOS = {
  // „Knockin' on Heaven's Door” — deja în forme deschise, deci fără capo.
  [VIDEO_ID]: ['G', 'D', 'Am', 'G', 'D', 'C'],
  // „Wonderwall” — sună F#m A E B; cu capo 2 cânți Em G D A, adică numai forme deschise.
  wonderwallDemo: ['F#m', 'A', 'E', 'B', 'F#m', 'A'],
  // Melodie cu structură: strofă ×4, refren ×2, strofă ×2, refren ×2.
  structureDemo: [
    ...LOOP_A, ...LOOP_A, ...LOOP_A, ...LOOP_A,
    ...LOOP_B, ...LOOP_B,
    ...LOOP_A, ...LOOP_A,
    ...LOOP_B, ...LOOP_B,
  ],
};
const timeline = (labels) => labels.map((label, i) => ({ t: i * 2, label, confidence: 0.88 }));

function silentWav(seconds = 120, sampleRate = 8000) {
  const data = seconds * sampleRate;
  const buf = Buffer.alloc(44 + data, 128);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + data, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate, 28);
  buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34);
  buf.write('data', 36); buf.writeUInt32LE(data, 40);
  return buf.toString('base64');
}

const PAGE = `<!DOCTYPE html><html lang="ro"><head><meta charset="utf-8"><title>Demo</title>
<style>body{margin:0;background:#0f0f0f;font-family:Roboto,Arial,sans-serif}
#wrap{max-width:860px;margin:0 auto;padding:16px}
.html5-video-player{background:#000;border-radius:12px;aspect-ratio:16/9;display:flex;
  align-items:center;justify-content:center;color:#333;font-size:13px}
video{width:1px;height:1px;opacity:0}</style></head>
<body><div id="wrap">
  <div class="html5-video-player">(video)
    <video class="html5-main-video" src="data:audio/wav;base64,${silentWav()}" preload="auto"></video>
  </div>
  <div id="below"></div>
</div></body></html>`;

const profile = mkdtempSync(join(tmpdir(), 'chordtab-shot-'));
let ctx;
try {
  ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 900, height: 700 },
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });

  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 20000 }));
  const extId = new URL(sw.url()).host;

  const seeder = await ctx.newPage();
  await seeder.goto(`chrome-extension://${extId}/options/options.html`);
  await seeder.evaluate(async (demos) => {
    const entries = {};
    for (const [id, chords] of Object.entries(demos)) {
      // capo: 0 aici e doar valoarea memorată; panoul recalculează sugestia la salvare.
      entries[`chords:${id}`] = { version: 1, analyzedAt: new Date().toISOString(), capo: 0, chords };
    }
    await chrome.storage.local.set(entries);
  }, Object.fromEntries(Object.entries(DEMOS).map(([id, labels]) => [id, timeline(labels)])));
  await seeder.close();

  const page = await ctx.newPage();
  await page.route('https://www.youtube.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE }));
  await page.goto(`https://www.youtube.com/watch?v=${VIDEO_ID}`);

  const panel = page.locator('#chordtab-panel');
  await panel.waitFor({ state: 'attached', timeout: 15000 });
  await page.waitForFunction(() => {
    const p = document.getElementById('chordtab-panel');
    return p?.parentElement?.id === 'below';
  }, null, { timeout: 10000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('video');
    return v && v.readyState >= 1;
  }, null, { timeout: 15000 });

  await page.evaluate(() => { document.querySelector('video').currentTime = 7; });
  await page.waitForTimeout(600);
  await panel.screenshot({ path: join(OUT, 'panou.png') });
  console.log('  docs/capturi/panou.png');

  // A doua captură: melodia cu capo. Panoul sugerează singur poziția care dă forme deschise.
  await page.goto('https://www.youtube.com/watch?v=wonderwallDemo');
  await panel.waitFor({ state: 'attached', timeout: 15000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('video');
    return v && v.readyState >= 1;
  }, null, { timeout: 15000 });
  // Sugestia e doar marcată; o aplicăm cu un click, ca în folosirea reală.
  await page.waitForFunction(
    () => !!document.querySelector('#chordtab-panel .ct-capo.is-suggested'),
    null, { timeout: 10000 });
  await page.evaluate(() => { document.querySelector('video').currentTime = 1; });
  await page.click('#chordtab-panel .ct-capo.is-suggested');
  await page.waitForTimeout(600);
  await panel.screenshot({ path: join(OUT, 'panou-capo.png') });
  console.log('  docs/capturi/panou-capo.png');

  // A treia captură: structura melodiei — bara secțiunilor și legenda cu tiparele.
  await page.goto('https://www.youtube.com/watch?v=structureDemo');
  await panel.waitFor({ state: 'attached', timeout: 15000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('video');
    return v && v.readyState >= 1;
  }, null, { timeout: 15000 });
  await page.locator('#chordtab-panel .ct-structure').waitFor({ state: 'visible', timeout: 10000 });
  await page.evaluate(() => { document.querySelector('video').currentTime = 36; }); // în refren
  await page.waitForTimeout(700);
  await panel.screenshot({ path: join(OUT, 'panou-structura.png') });
  console.log('  docs/capturi/panou-structura.png');
} finally {
  await ctx?.close().catch(() => {});
  rmSync(profile, { recursive: true, force: true });
}
