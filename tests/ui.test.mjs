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
// 120 s: cronologia cu structură din testele de mai jos ajunge la 80 s, iar `seek` are nevoie
// de media care chiar se poate poziționa acolo.
function silentWav(seconds = 120, sampleRate = 8000) {
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
  <!-- Pagina trebuie să fie ÎNALTĂ și derulabilă: fără asta nu se poate dovedi că panoul
       nu smucește YouTube-ul înapoi la el la fiecare acord (defectul critic al auditului 2). -->
  <div id="umplutura" style="height: 3000px"></div>
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

  const first = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 20000 }));
  const extId = new URL(first.url()).host;

  // Service worker-ul MV3 se oprește singur când e inactiv și repornește la nevoie, deci o
  // referință veche devine inutilizabilă. O luăm proaspătă de fiecare dată.
  const liveWorker = async () =>
    ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 20000 }));

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

  // --- GHIDUL: extensia trebuie să-și explice singură cele două faze ---

  await check('Ghidul portocaliu se deschide singur prima oară', async () => {
    await page.locator('#chordtab-panel .ct-guide').waitFor({ state: 'visible', timeout: 8000 });
    const title = await page.locator('#chordtab-panel .ct-guide-title').textContent();
    assert.match(title, /două minute/i, `titlul ghidului: „${title}”`);
    assert.ok((await page.locator('#chordtab-panel .ct-guide-item').count()) >= 4,
      'ghidul trebuie să explice cei doi pași, exersarea și limitările');
    const text = await page.locator('#chordtab-panel .ct-guide').textContent();
    assert.match(text, /Pasul 1/, 'ghidul trebuie să explice Pasul 1');
    assert.match(text, /Pasul 2/, 'ghidul trebuie să explice Pasul 2');
    // Portocaliul „exotic orange” din brandul Not a Coder, nu albastrul panoului.
    const border = await page.locator('#chordtab-panel .ct-guide-toggle')
      .evaluate((el) => getComputedStyle(el).borderTopColor);
    assert.equal(border, 'rgb(245, 79, 27)', `butonul ghidului e ${border}, aștept portocaliul de brand`);
  });

  await check('„Am înțeles" închide ghidul, și rămâne închis data viitoare', async () => {
    await page.click('#chordtab-panel .ct-guide-done');
    await page.waitForFunction(
      () => document.querySelector('#chordtab-panel .ct-guide')?.hidden === true,
      null, { timeout: 5000 });
    await page.reload();
    await page.locator('#chordtab-panel').waitFor({ state: 'attached', timeout: 15000 });
    await page.waitForTimeout(1000); // timp berechet ca un ghid nedorit să fi apucat să apară
    assert.equal(await page.locator('#chordtab-panel .ct-guide:visible').count(), 0,
      'după „Am înțeles" ghidul nu mai are voie să se deschidă singur');
    // Butonul rămâne, ca să-l poți redeschide oricând.
    await page.click('#chordtab-panel .ct-guide-toggle');
    await page.locator('#chordtab-panel .ct-guide').waitFor({ state: 'visible', timeout: 5000 });
    await page.click('#chordtab-panel .ct-guide-toggle');
    await page.waitForFunction(
      () => document.querySelector('#chordtab-panel .ct-guide')?.hidden === true,
      null, { timeout: 5000 });
  });

  const currentChord = () => page.locator('#chordtab-panel .ct-current').textContent();
  const stripChips = () => page.locator('#chordtab-panel .ct-strip-chip');
  // „Ce urmează” se citește acum de pe BANDĂ: cartonașele de după cel aprins. Lista statică de
  // trei chip-uri a dispărut din modul memorat (era exact reclamația lui Andrei).
  const upcoming = async (n = 3) => {
    const all = (await stripChips().allTextContents()).map((s) => s.trim());
    const idx = await page.evaluate(() => {
      const el = document.querySelector('#chordtab-panel .ct-strip-chip.is-now');
      return el ? Number(el.dataset.index) : -1;
    });
    return all.slice(idx + 1, idx + 1 + n);
  };
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

  // --- PAȘII 1-3: banda rulantă ---

  await check('Pasul 1: banda arată melodia ÎNTREAGĂ, în ordine', async () => {
    await page.locator('#chordtab-panel .ct-strip-wrap').waitFor({ state: 'visible', timeout: 5000 });
    const labels = (await stripChips().allTextContents()).map((s) => s.trim());
    assert.deepEqual(labels, ['G', 'D', 'Am', 'C'],
      `banda trebuie să conțină toate acordurile memorate: ${JSON.stringify(labels)}`);
    // Lățimea fiecărui cartonaș spune cât ține acordul — asta e ce lipsea listei „urmează”.
    const widths = await stripChips().evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
    assert.ok(widths.every((w) => w > 10), `cartonașe fără lățime: ${JSON.stringify(widths)}`);
  });

  await check('Pasul 2: cartonașul aprins e acordul care sună acum', async () => {
    await seek(9);
    await page.waitForFunction(
      () => document.querySelector('#chordtab-panel .ct-strip-chip.is-now')?.textContent?.trim() === 'Am',
      null, { timeout: 5000 });
    assert.equal(await page.locator('#chordtab-panel .ct-strip-chip.is-now').count(), 1,
      'exact un cartonaș trebuie aprins');
  });

  await check('Pasul 2: click pe un acord de pe bandă sare acolo', async () => {
    await seek(1);
    await page.locator('#chordtab-panel .ct-strip-chip[data-index="3"]').click();
    await page.waitForTimeout(300);
    const t = await page.evaluate(() => document.querySelector('video').currentTime);
    assert.ok(Math.abs(t - 12) <= 1.5, `după click sunt la ${t.toFixed(1)}s, aștept ~12s`);
  });

  await check('Pasul 3: banda curge cu melodia; cu mișcare redusă stă pe loc', async () => {
    const transform = () => page.evaluate(() =>
      getComputedStyle(document.querySelector('#chordtab-panel .ct-strip')).transform);
    await seek(4.5);
    await page.evaluate(async () => {
      const v = document.querySelector('video');
      v.muted = true;                       // fără „muted”, politica de autoplay refuză play()
      try { await v.play(); } catch { /* dacă tot nu pornește, verificarea de mai jos o spune */ }
    });
    const a = await transform();
    await page.waitForTimeout(500);
    const b = await transform();
    assert.notEqual(a, b, 'banda nu curge deloc cât timp melodia merge');

    // Cu „mișcare redusă” banda NU are voie să curgă continuu: sare doar la schimbarea
    // acordului. Rămânem bine în interiorul aceluiași acord (D ține de la 4s la 8s).
    await seek(4.2);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(200);
    const c = await transform();
    await page.waitForTimeout(500);
    const d = await transform();
    assert.equal(c, d, 'cu „mișcare redusă” banda curge — trebuie să stea pe loc');
    await page.emulateMedia({ reducedMotion: null });
    await page.evaluate(() => document.querySelector('video').pause());
  });

  await check('Banda nu pâlpâie când redarea stă pe loc', async () => {
    await seek(5);
    await page.evaluate(() => {
      window.__stripMut = 0;
      const el = document.querySelector('#chordtab-panel .ct-strip');
      window.__stripObs = new MutationObserver((r) => { window.__stripMut += r.length; });
      window.__stripObs.observe(el, { childList: true, subtree: true, attributes: true });
    });
    await page.waitForTimeout(1500);
    const mut = await page.evaluate(() => { window.__stripObs.disconnect(); return window.__stripMut; });
    assert.ok(mut <= 2, `${mut} modificări pe bandă cu redarea oprită — se rescrie degeaba`);
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
    assert.match(await slot().locator('.ct-d-capo').textContent(), /capo 3/);
    await page.click('#chordtab-panel .ct-reset');
  });

  await check('Pasul 7: hover pe un acord care urmează îi arată diagrama, apoi revine', async () => {
    await seek(1);
    await page.hover('#chordtab-panel .ct-strip-chip[data-index="2"]'); // Am, de pe bandă
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

  // --- Pâlpâitul raportat de Andrei: hover pe un acord făcea tot ecranul să clipească ---
  await check('Hover pe un acord nu produce pâlpâit', async () => {
    await seek(1);
    await page.evaluate(() => {
      window.__mutations = 0;
      const slot = document.querySelector('#chordtab-panel .ct-diagram-slot');
      window.__obs = new MutationObserver((recs) => { window.__mutations += recs.length; });
      window.__obs.observe(slot, { childList: true, subtree: true, attributes: true });
    });
    await page.hover('#chordtab-panel .ct-strip-chip[data-index="1"]');
    await page.waitForTimeout(1500); // stăm pe loc: nimic nu trebuie să se mai schimbe
    const mutations = await page.evaluate(() => { window.__obs.disconnect(); return window.__mutations; });
    // O singură schimbare (înlocuirea diagramei) e normală. Zeci înseamnă buclă.
    assert.ok(mutations <= 3, `${mutations} modificări ale diagramei cât timp cursorul stă pe loc — pâlpâie`);
  });

  await check('Slotul diagramei nu-și schimbă mărimea (sursa pâlpâitului)', async () => {
    await seek(1);
    const full = await page.locator('#chordtab-panel .ct-diagram-slot').boundingBox();
    // Golim slotul, ca la un acord fără diagramă, și verificăm că mărimea rămâne.
    await page.evaluate(() => {
      const s = document.querySelector('#chordtab-panel .ct-diagram-slot');
      s.innerHTML = ''; s.classList.add('is-empty');
    });
    const empty = await page.locator('#chordtab-panel .ct-diagram-slot').boundingBox();
    assert.equal(Math.round(empty.width), Math.round(full.width), 'lățimea slotului trebuie să rămână');
    assert.equal(Math.round(empty.height), Math.round(full.height), 'înălțimea slotului trebuie să rămână');
    await page.reload();
    await page.locator('#chordtab-panel').waitFor({ state: 'attached', timeout: 15000 });
  });

  // --- Memoria: acordurile găsite în timpul analizei trebuie să supraviețuiască unui refresh ---
  await check('Pasul 5: acordurile se salvează din mers, nu doar la oprire', async () => {
    const live = [
      { t: 0, label: 'E', confidence: 0.8 },
      { t: 3, label: 'B', confidence: 0.8 },
      { t: 6, label: 'C#m', confidence: 0.8 },
      { t: 9, label: 'A', confidence: 0.8 },
    ];
    const panelState = () => page.evaluate(() => ({
      status: document.querySelector('#chordtab-panel .ct-status')?.textContent,
      current: document.querySelector('#chordtab-panel .ct-current')?.textContent,
    }));
    const waitFor = async (label, fn) => {
      try { await page.waitForFunction(fn, null, { timeout: 10000 }); }
      catch { throw new Error(`${label} — panoul arată ${JSON.stringify(await panelState())}`); }
    };

    // Așteptăm ca încărcarea din memorie să se așeze, ca să nu confundăm cele două stări.
    await waitFor('nu a intrat în modul memorat înainte de analiză',
      () => /memorate/i.test(document.querySelector('#chordtab-panel .ct-status')?.textContent || ''));

    // Jucăm rolul background-ului: pornim „ascultarea” și trimitem acorduri, fără să oprim.
    await (await liveWorker()).evaluate(async ({ videoId, chords }) => {
      const tabs = await chrome.tabs.query({});
      const send = async (m) => {
        for (const t of tabs) { try { await chrome.tabs.sendMessage(t.id, m); } catch { /* alt tab */ } }
      };
      await send({ target: 'content', type: 'CAPTURE_STATE', capturing: true });
      for (const c of chords) await send({ target: 'content', type: 'CHORD_EVENT', videoId, ...c });
    }, { videoId: VIDEO_ID, chords: live });

    // Panoul trebuie să treacă în „ascult” și să arate ultimul acord primit.
    await waitFor('nu a ajuns la acordul A după CHORD_EVENT',
      () => document.querySelector('#chordtab-panel .ct-current')?.textContent?.trim() === 'A');

    // Banda ține de melodia MEMORATĂ: în timpul analizei viitorul încă nu e cunoscut, deci
    // n-ar avea ce să curgă. În schimb reapare lista „până acum”.
    assert.equal(await page.locator('#chordtab-panel .ct-strip-wrap:visible').count(), 0,
      'banda nu are ce căuta în timpul analizei');
    assert.ok((await page.locator('#chordtab-panel .ct-next-list .ct-chip').count()) > 0,
      'în timpul analizei rămâne lista cu acordurile de până acum');

    // …și, mai important, panoul îi SPUNE omului unde e și ce urmează.
    const step = await page.locator('#chordtab-panel .ct-step').textContent();
    assert.match(step, /Pasul 1 din 2/, `linia pasului spune „${step}”`);
    assert.match(step, /când melodia se termină/i,
      'în Pasul 1 omul trebuie să afle ce se întâmplă când melodia se termină');

    // Salvarea e amânată 3s ca să nu scriem la fiecare acord.
    await page.waitForTimeout(4000);

    const saved = await (await liveWorker()).evaluate(async (id) => (await chrome.storage.local.get(`chords:${id}`))[`chords:${id}`], VIDEO_ID);
    assert.ok(saved, 'nimic în memorie după analiză');
    assert.deepEqual(saved.chords.map((c) => c.label), ['E', 'B', 'C#m', 'A'],
      `în memorie au ajuns alte acorduri: ${JSON.stringify(saved.chords.map((c) => c.label))}`);

    // Refresh FĂRĂ să fi apăsat vreodată „Oprește” — exact scenariul care pierdea totul.
    await page.reload();
    await page.locator('#chordtab-panel').waitFor({ state: 'attached', timeout: 15000 });
    await waitFor('după refresh nu arată E din memoria proaspătă',
      () => document.querySelector('#chordtab-panel .ct-current')?.textContent?.trim() === 'E');
    const status = await page.locator('#chordtab-panel .ct-status').textContent();
    assert.match(status, /memorate/i, `după refresh aștept modul memorat, am „${status}”`);
  });

  // --- Defectul de fond raportat de Andrei: „dacă nu dau reload, nu mai apare chestia aia
  // frumoasă”. Cine lăsa melodia să se termine rămânea la nesfârșit în Pasul 1. ---
  await check('La finalul melodiei analiza se încheie singură și trece în Pasul 2', async () => {
    const live = [
      { t: 0, label: 'C', confidence: 0.8 },
      { t: 3, label: 'G', confidence: 0.8 },
      { t: 6, label: 'Am', confidence: 0.8 },
      { t: 9, label: 'F', confidence: 0.8 },
    ];
    await (await liveWorker()).evaluate(async ({ videoId, chords }) => {
      const tabs = await chrome.tabs.query({});
      const send = async (m) => {
        for (const t of tabs) { try { await chrome.tabs.sendMessage(t.id, m); } catch { /* alt tab */ } }
      };
      await send({ target: 'content', type: 'CAPTURE_STATE', capturing: true });
      for (const c of chords) await send({ target: 'content', type: 'CHORD_EVENT', videoId, ...c });
    }, { videoId: VIDEO_ID, chords: live });

    await page.waitForFunction(
      () => /Pasul 1 din 2/.test(document.querySelector('#chordtab-panel .ct-step')?.textContent || ''),
      null, { timeout: 10000 });

    // Melodia se termină — fără ca omul să apese ceva.
    await page.evaluate(() => {
      document.querySelector('video').dispatchEvent(new Event('ended'));
    });

    await page.waitForFunction(
      () => /Pasul 2 din 2/.test(document.querySelector('#chordtab-panel .ct-step')?.textContent || ''),
      null, { timeout: 10000 });
    // Și partea frumoasă chiar apare, fără reload.
    await page.locator('#chordtab-panel .ct-strip-wrap').waitFor({ state: 'visible', timeout: 5000 });
    const status = await page.locator('#chordtab-panel .ct-status').textContent();
    assert.match(status, /memorate/i, `după finalul melodiei aștept modul memorat, am „${status}”`);
  });

  // --- PAȘII 1-2: structura melodiei (bara + legenda + secțiunea curentă) ---
  //
  // Cronologie cu structură limpede: A A A A B B A A B B, buclă de 8 s.
  // (Aceleași bucle ca în tests/sections.test.mjs, ca să știm ce trebuie să iasă.)
  const STRUCT_ID = 'structVideo01';
  {
    const LOOP_A = [['G', 2], ['D', 2], ['Am', 2], ['C', 2]];
    const LOOP_B = [['Em', 2], ['C', 2], ['G', 2], ['D', 2]];
    const flat = [];
    for (const loop of [...Array(4).fill(LOOP_A), ...Array(2).fill(LOOP_B),
      ...Array(2).fill(LOOP_A), ...Array(2).fill(LOOP_B)]) flat.push(...loop);
    const structured = [];
    let t = 0, prev = null;
    for (const [label, sec] of flat) {
      if (label !== prev) structured.push({ t, label, confidence: 0.9 });
      prev = label;
      t += sec;
    }

    await (await liveWorker()).evaluate(async ({ id, chords }) => {
      await chrome.storage.local.set({
        [`chords:${id}`]: { version: 1, analyzedAt: new Date().toISOString(), capo: 0, chords },
      });
    }, { id: STRUCT_ID, chords: structured });

    await page.goto(`https://www.youtube.com/watch?v=${STRUCT_ID}`);
    await page.locator('#chordtab-panel').waitFor({ state: 'attached', timeout: 15000 });
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return v && v.readyState >= 1 && v.duration > 0;
    }, null, { timeout: 15000 });
    await page.locator('#chordtab-panel .ct-structure').waitFor({ state: 'visible', timeout: 10000 });
  }

  const segments = () => page.locator('#chordtab-panel .ct-seg');
  const sheetRows = () => page.locator('#chordtab-panel .ct-sheet-row');

  await check('Pasul 1: bara are un segment per secțiune, cu numele lor (nu litere)', async () => {
    const count = await segments().count();
    assert.ok(count >= 4 && count <= 6, `aștept 4-6 segmente, am ${count}`);
    const names = (await segments().allTextContents()).map((s) => s.trim());
    assert.deepEqual(names.slice(0, 4), ['Strofă', 'Refren', 'Strofă', 'Refren'],
      `numele din bară: ${JSON.stringify(names)}`);
    // Literele de laborator n-au voie să mai ajungă pe ecran nicăieri în panou.
    const panelText = await page.locator('#chordtab-panel').textContent();
    assert.ok(!/\b[A-J]\s*·/.test(panelText), `panoul încă arată litere de grup: ${panelText}`);
  });

  await check('Pasul 6: foaia are un rând per secțiune, ÎN ORDINEA melodiei', async () => {
    // Cronologia e A A A A B B A A B B → patru secțiuni, în ordine (nu dedublate ca o legendă).
    assert.equal(await sheetRows().count(), 4, 'aștept patru rânduri: A B A B');
    const tags = await page.locator('#chordtab-panel .ct-sheet-tag').allTextContents();
    assert.match(tags[0], /Strofă/, `rândul 1: „${tags[0]}”`);
    assert.match(tags[1], /Refren/, `rândul 2: „${tags[1]}”`);
    assert.match(tags[2], /Strofă/, `rândul 3: „${tags[2]}”`);
    assert.match(tags[3], /Refren/, `rândul 4: „${tags[3]}”`);
  });

  await check('Pasul 6: fiecare rând arată tiparul lui, cu ×repetiții', async () => {
    assert.deepEqual(await sheetRows().nth(0).locator('.ct-chip').allTextContents(),
      ['G', 'D', 'Am', 'C'], 'tiparul primei strofe');
    assert.deepEqual(await sheetRows().nth(1).locator('.ct-chip').allTextContents(),
      ['Em', 'C', 'G', 'D'], 'tiparul primului refren');
    // Prima strofă are 4 treceri prin buclă, primul refren 2.
    assert.equal((await sheetRows().nth(0).locator('.ct-sheet-count').textContent()).trim(), '×4');
    assert.equal((await sheetRows().nth(1).locator('.ct-sheet-count').textContent()).trim(), '×2');
  });

  await check('Pasul 6: click pe un acord din foaie sare la momentul lui', async () => {
    await page.evaluate(() => { document.querySelector('video').currentTime = 0; });
    await page.waitForTimeout(200);
    // Al doilea acord din rândul 2 (refrenul începe la 32s, al doilea acord la +2s).
    await sheetRows().nth(1).locator('.ct-sheet-chip').nth(1).click();
    await page.waitForTimeout(300);
    const t = await page.evaluate(() => document.querySelector('video').currentTime);
    assert.ok(Math.abs(t - 34) <= 1.5, `după click sunt la ${t.toFixed(1)}s, aștept ~34s`);
  });

  await check('Pasul 6: rândul și acordul curent sunt evidențiate', async () => {
    await seek(36); // în refren, la ~4s de la începutul lui (32s) => al treilea acord al buclei
    await page.waitForFunction(
      () => document.querySelector('#chordtab-panel .ct-sheet-row.is-current')?.dataset.index === '1',
      null, { timeout: 5000 });
    assert.equal(await page.locator('#chordtab-panel .ct-sheet-row.is-current').count(), 1,
      'exact un rând trebuie evidențiat');
    const now = page.locator('#chordtab-panel .ct-sheet-chip.is-now');
    assert.equal(await now.count(), 1, 'exact un acord trebuie marcat ca „acum”');
    assert.equal((await now.textContent()).trim(), 'G',
      'la 36s, în bucla Em C G D pornită la 32s, sună al treilea acord');
  });

  await check('Pasul 1: click pe al doilea segment sare în melodie', async () => {
    await page.evaluate(() => { document.querySelector('video').currentTime = 0; });
    await page.waitForTimeout(200);
    await segments().nth(1).click();
    await page.waitForTimeout(300);
    const t = await page.evaluate(() => document.querySelector('video').currentTime);
    // Al doilea segment (refrenul) începe pe la 32 s.
    assert.ok(Math.abs(t - 32) <= 1.5, `după click sunt la ${t.toFixed(1)}s, aștept ~32s`);
  });

  await check('Pasul 6: transpoziția schimbă și acordurile din foaie', async () => {
    await page.click('#chordtab-panel .ct-tr-up');
    await page.waitForFunction(
      () => document.querySelector('#chordtab-panel .ct-sheet-row .ct-chip')?.textContent?.trim() === 'G#',
      null, { timeout: 5000 });
    assert.deepEqual(
      await sheetRows().nth(0).locator('.ct-chip').allTextContents(),
      ['G#', 'D#', 'A#m', 'C#'], 'foaia transpusă cu un semiton');
    await page.click('#chordtab-panel .ct-reset');
    await page.waitForFunction(
      () => document.querySelector('#chordtab-panel .ct-sheet-row .ct-chip')?.textContent?.trim() === 'G',
      null, { timeout: 5000 });
  });

  // --- PASUL 4: modul de exersare (secțiune pe repetat + viteză) ---

  await check('Pasul 4: fiecare secțiune are butonul ⟳ de exersare', async () => {
    assert.equal(await page.locator('#chordtab-panel .ct-sheet-row .ct-loop').count(), 4,
      'câte un ⟳ pe fiecare rând de secțiune');
    assert.equal(await page.locator('#chordtab-panel .ct-practice:visible').count(), 0,
      'bara de exersare apare abia când exersezi');
  });

  await check('Pasul 4: ⟳ pune secțiunea pe repetat și sare la începutul ei', async () => {
    await page.evaluate(() => { document.querySelector('video').currentTime = 5; });
    await page.waitForTimeout(200);
    await sheetRows().nth(1).locator('.ct-loop').click(); // refrenul, 32-48s
    await page.locator('#chordtab-panel .ct-practice').waitFor({ state: 'visible', timeout: 5000 });
    const what = await page.locator('#chordtab-panel .ct-practice-what').textContent();
    assert.match(what, /Exersezi:\s*Refren/, `bara de exersare spune „${what}”`);
    const t = await page.evaluate(() => document.querySelector('video').currentTime);
    assert.ok(Math.abs(t - 32) <= 1.5, `⟳ trebuie să sară la începutul secțiunii, sunt la ${t.toFixed(1)}s`);
    assert.equal(await sheetRows().nth(1).locator('.ct-loop.is-active').count(), 1,
      'butonul secțiunii exersate rămâne apăsat');
  });

  await check('Pasul 4: bucla se întoarce singură la începutul secțiunii', async () => {
    // Melodia trebuie să RULEZE: bucla se declanșează când timpul ajunge la finalul
    // secțiunii (48s), nu la o poziționare manuală undeva aproape de el.
    await page.evaluate(async () => {
      const v = document.querySelector('video');
      v.currentTime = 47.4;
      v.muted = true;
      try { await v.play(); } catch { /* verificarea de mai jos spune dacă n-a pornit */ }
    });
    await page.waitForFunction(
      () => document.querySelector('video').currentTime < 34,
      null, { timeout: 8000 });
    const t = await page.evaluate(() => {
      const v = document.querySelector('video');
      v.pause();
      return v.currentTime;
    });
    assert.ok(t >= 31.9, `bucla a sărit prea departe înapoi: ${t.toFixed(1)}s`);
  });

  await check('Pasul 4: viteza se schimbă fără să schimbe tonalitatea', async () => {
    await page.click('#chordtab-panel .ct-speed[data-rate="0.75"]');
    await page.waitForTimeout(200);
    const v = await page.evaluate(() => {
      const el = document.querySelector('video');
      return { rate: el.playbackRate, pitch: el.preservesPitch };
    });
    assert.equal(v.rate, 0.75, 'viteza trebuie aplicată videoului');
    assert.equal(v.pitch, true, 'fără preservesPitch melodia ar coborî în tonalitate');
    assert.equal(await page.locator('#chordtab-panel .ct-speed.is-active').count(), 1,
      'exact o viteză marcată ca activă');
  });

  await check('Pasul 4: la ieșire se revine la viteza dinainte, nu orbește la 1', async () => {
    await page.click('#chordtab-panel .ct-practice-stop');
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#chordtab-panel .ct-practice:visible').count(), 0,
      'bara de exersare trebuie să dispară');
    // Intrăm din nou, dar de data asta cu o viteză „a omului” diferită de 1.
    await page.evaluate(() => { document.querySelector('video').playbackRate = 1.25; });
    await sheetRows().nth(1).locator('.ct-loop').click();
    await page.waitForTimeout(200);
    await page.click('#chordtab-panel .ct-speed[data-rate="0.5"]');
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.querySelector('video').playbackRate), 0.5);
    await page.click('#chordtab-panel .ct-practice-stop');
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.querySelector('video').playbackRate), 1.25,
      'la ieșire trebuie restaurată viteza pe care o avea omul înainte');
    await page.evaluate(() => { document.querySelector('video').playbackRate = 1; });
  });

  await check('Pasul 4: dacă sari în altă parte a melodiei, exersarea se oprește', async () => {
    await sheetRows().nth(1).locator('.ct-loop').click(); // refren, 32-48s
    await page.locator('#chordtab-panel .ct-practice').waitFor({ state: 'visible', timeout: 5000 });
    // Click pe prima strofă: ai plecat intenționat, nu te tragem înapoi în refren.
    await sheetRows().nth(0).locator('.ct-sheet-tag').click();
    await page.waitForFunction(
      () => document.querySelector('#chordtab-panel .ct-practice')?.hidden === true,
      null, { timeout: 5000 });
    const t = await page.evaluate(() => document.querySelector('video').currentTime);
    assert.ok(t < 10, `trebuie să rămânem în strofă, suntem la ${t.toFixed(1)}s`);
  });

  await check('Pasul 2: indicatorul arată secțiunea în care ești', async () => {
    await seek(10);   // în interiorul primei strofe
    await page.waitForFunction(
      () => /Strofă/.test(document.querySelector('#chordtab-panel .ct-section-now')?.textContent || ''),
      null, { timeout: 5000 });
    await seek(36);   // în interiorul refrenului
    await page.waitForFunction(
      () => /Refren/.test(document.querySelector('#chordtab-panel .ct-section-now')?.textContent || ''),
      null, { timeout: 5000 });
  });

  await check('Pasul 2: segmentul curent e evidențiat în bară', async () => {
    await seek(36);
    await page.waitForFunction(
      () => document.querySelector('#chordtab-panel .ct-seg.is-current')?.dataset.index === '1',
      null, { timeout: 5000 });
    assert.equal(await page.locator('#chordtab-panel .ct-seg.is-current').count(), 1,
      'exact un segment trebuie evidențiat');
  });

  await check('Pasul 2: secțiunea următoare e anunțată înainte de graniță', async () => {
    await seek(46); // aproape de finalul refrenului (~48s)
    await page.waitForFunction(
      () => /urmează:/.test(document.querySelector('#chordtab-panel .ct-next-label')?.textContent || ''),
      null, { timeout: 5000 });
    const txt = await page.locator('#chordtab-panel .ct-next-label').textContent();
    assert.match(txt, /Strofă/, `anunțul spune „${txt}”`);
  });

  await check('Structura nu pâlpâie când redarea stă pe loc', async () => {
    await seek(10);
    await page.evaluate(() => {
      window.__structMut = 0;
      const el = document.querySelector('#chordtab-panel .ct-structure');
      window.__structObs = new MutationObserver((r) => { window.__structMut += r.length; });
      window.__structObs.observe(el, { childList: true, subtree: true, characterData: true });
    });
    await page.waitForTimeout(1500);
    const mut = await page.evaluate(() => { window.__structObs.disconnect(); return window.__structMut; });
    assert.ok(mut <= 2, `${mut} modificări în structură cu redarea oprită — se reconstruiește degeaba`);
  });

  // --- AUDIT 2, defectul critic: foaia derula PAGINA YouTube întreagă ---
  await check('Foaia nu mai trage pagina YouTube înapoi la panou', async () => {
    await seek(2);
    await page.evaluate(() => window.scrollTo(0, 2000));
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => window.scrollY);
    assert.ok(before > 500, `pagina trebuie să fie derulată ca proba să însemne ceva (${before}px)`);
    // Traversăm mai multe acorduri ȘI granița dintre strofă și refren (32s) — exact
    // momentele în care evidențierea din foaie se muta și smucea pagina.
    for (const t of [10, 20, 33, 36, 40]) {
      await page.evaluate((x) => { document.querySelector('video').currentTime = x; }, t);
      await page.waitForTimeout(250);
    }
    const after = await page.evaluate(() => window.scrollY);
    assert.equal(after, before,
      `pagina a sărit de la ${before}px la ${after}px cât timp melodia rula`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
  });

  await check('Foaia se derulează totuși în interiorul ei, la schimbarea rândului', async () => {
    // Îngustăm foaia ca rândul 4 să nu încapă, apoi sărim în el: doar .ct-sheet trebuie
    // să se deruleze, nu pagina.
    await page.evaluate(() => {
      document.querySelector('#chordtab-panel .ct-sheet').style.maxHeight = '60px';
    });
    await seek(2);
    await page.waitForTimeout(300);
    const top0 = await page.evaluate(() => document.querySelector('#chordtab-panel .ct-sheet').scrollTop);
    await seek(70); // ultima secțiune
    await page.waitForTimeout(400);
    const top1 = await page.evaluate(() => document.querySelector('#chordtab-panel .ct-sheet').scrollTop);
    assert.ok(top1 > top0,
      `foaia trebuie să se deruleze la rândul curent (${top0} → ${top1})`);
    await page.evaluate(() => {
      document.querySelector('#chordtab-panel .ct-sheet').style.maxHeight = '';
    });
  });

  await check('Pasul 6: foaia nu pâlpâie când redarea stă pe loc', async () => {
    await seek(10);
    await page.evaluate(() => {
      window.__sheetMut = 0;
      const el = document.querySelector('#chordtab-panel .ct-sheet');
      window.__sheetObs = new MutationObserver((r) => { window.__sheetMut += r.length; });
      window.__sheetObs.observe(el, { childList: true, subtree: true, attributes: true });
    });
    await page.waitForTimeout(1500);
    const mut = await page.evaluate(() => { window.__sheetObs.disconnect(); return window.__sheetMut; });
    assert.ok(mut <= 2, `${mut} modificări în foaie cu redarea oprită — se rescrie degeaba`);
  });

  await check('Fără repetiții nu se afișează nicio structură', async () => {
    const NOSTRUCT = 'noStructVideo';
    const chords = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A']
      .map((label, i) => ({ t: i * 5, label, confidence: 0.9 }));
    await (await liveWorker()).evaluate(async ({ id, c }) => {
      await chrome.storage.local.set({
        [`chords:${id}`]: { version: 1, analyzedAt: new Date().toISOString(), capo: 0, chords: c },
      });
    }, { id: NOSTRUCT, c: chords });
    await page.goto(`https://www.youtube.com/watch?v=${NOSTRUCT}`);
    await page.locator('#chordtab-panel').waitFor({ state: 'attached', timeout: 15000 });
    await page.waitForFunction(
      () => document.querySelector('#chordtab-panel .ct-current')?.textContent?.trim() === 'C',
      null, { timeout: 10000 });
    assert.equal(await page.locator('#chordtab-panel .ct-structure:visible').count(), 0,
      'bara nu trebuie să apară fără structură');
    assert.equal(await page.locator('#chordtab-panel .ct-section-now:visible').count(), 0,
      'nici indicatorul de secțiune');
  });

  await check('Pasul 6: fără structură, foaia TOT apare, cu toată melodia', async () => {
    // Nevoia lui Andrei — „să văd melodia” — nu dispare când melodia n-are structură clară.
    await page.locator('#chordtab-panel .ct-sheet-wrap').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await sheetRows().count(), 1, 'un singur rând, cu tot cântecul');
    const chips = await sheetRows().nth(0).locator('.ct-sheet-chip').allTextContents();
    assert.deepEqual(chips, ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A'],
      `foaia plată: ${JSON.stringify(chips)}`);
    // Și tot se poate naviga: al patrulea acord e la 15s.
    await page.evaluate(() => { document.querySelector('video').currentTime = 0; });
    await page.waitForTimeout(200);
    await sheetRows().nth(0).locator('.ct-sheet-chip').nth(3).click();
    await page.waitForTimeout(300);
    const t = await page.evaluate(() => document.querySelector('video').currentTime);
    assert.ok(Math.abs(t - 15) <= 1.5, `după click sunt la ${t.toFixed(1)}s, aștept ~15s`);
  });

  // --- PASUL 0: secțiuni fără nume euristic primesc „Partea N”, nu litere ---
  //
  // A×4, B×2, A×2: „refrenul” apare o singură dată, deci nameSections refuză (pe bună dreptate)
  // să ghicească strofă/refren. Înainte ieșea „Partea A” / „Partea B”; acum trebuie să iasă
  // numere, în ordinea în care le auzi.
  await check('Pasul 0: fără nume ghicit, secțiunile sunt „Partea 1/2”, în ordinea auzirii', async () => {
    const PARTS_ID = 'partsVideo01';
    const LOOP_A = [['G', 2], ['D', 2], ['Am', 2], ['C', 2]];
    const LOOP_B = [['Em', 2], ['C', 2], ['G', 2], ['D', 2]];
    const flat = [];
    for (const loop of [...Array(4).fill(LOOP_A), ...Array(2).fill(LOOP_B), ...Array(2).fill(LOOP_A)]) {
      flat.push(...loop);
    }
    const chords = [];
    let t = 0, prev = null;
    for (const [label, sec] of flat) {
      if (label !== prev) chords.push({ t, label, confidence: 0.9 });
      prev = label;
      t += sec;
    }
    await (await liveWorker()).evaluate(async ({ id, c }) => {
      await chrome.storage.local.set({
        [`chords:${id}`]: { version: 1, analyzedAt: new Date().toISOString(), capo: 0, chords: c },
      });
    }, { id: PARTS_ID, c: chords });

    await page.goto(`https://www.youtube.com/watch?v=${PARTS_ID}`);
    await page.locator('#chordtab-panel').waitFor({ state: 'attached', timeout: 15000 });
    await page.locator('#chordtab-panel .ct-sheet-wrap').waitFor({ state: 'visible', timeout: 10000 });

    const tags = (await page.locator('#chordtab-panel .ct-sheet-tag').allTextContents())
      .map((s) => s.trim());
    assert.deepEqual(tags, ['Partea 1', 'Partea 2', 'Partea 1'],
      `etichetele foii: ${JSON.stringify(tags)}`);
    // Același grup = același număr ORIUNDE apare, chiar dacă revine mai târziu.
    const segs = (await page.locator('#chordtab-panel .ct-seg').allTextContents()).map((s) => s.trim());
    assert.deepEqual(segs.slice(0, 3), ['Partea 1', 'Partea 2', 'Partea 1'],
      `numele din bară: ${JSON.stringify(segs)}`);
  });

  await check('Pasul 5: pe o pagină fără video, panoul nu apare deloc', async () => {
    await page.goto('https://www.youtube.com/feed/subscriptions');
    await page.waitForTimeout(1200); // timp berechet ca un panou greșit să fi apucat să apară
    assert.equal(await page.locator('#chordtab-panel').count(), 0,
      'panoul nu are ce căuta pe o pagină care nu e de video');
  });

  await check('Navigarea SPA resetează panoul', async () => {
    await page.evaluate(() => {
      history.pushState({}, '', '/watch?v=altVideo99');
      window.dispatchEvent(new Event('yt-navigate-finish'));
    });
    await page.waitForFunction(
      () => document.querySelector('#chordtab-panel .ct-current')?.textContent?.trim() === '—',
      null, { timeout: 8000 });
    // Pe o melodie neanalizată, linia pasului spune de unde se începe.
    const step = await page.locator('#chordtab-panel .ct-step').textContent();
    assert.match(step, /Pasul 1 din 2/, `pe o melodie nouă linia pasului spune „${step}”`);
    assert.match(step, /Analizează/, 'trebuie să spună exact ce buton să apese');
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
