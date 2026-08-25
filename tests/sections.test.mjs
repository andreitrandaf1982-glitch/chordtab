// Rulare: node tests/sections.test.mjs
//
// POARTA 0 a planului de structură (docs/PLAN-sectiuni.md): pe cronologii sintetice cu
// structură cunoscută, detectSections trebuie să găsească secțiunile, să le numească prudent
// și — esențial — să REPARE prin votul repetițiilor acordurile corupte.

import assert from 'node:assert/strict';
import { detectSections } from '../extension/lib/sections.js';

// Construiește o cronologie din bucăți [label, secunde]; evenimente doar la schimbare.
function timeline(parts) {
  const events = [];
  let t = 0;
  let prev = null;
  for (const [label, sec] of parts) {
    if (label !== prev) events.push({ t, label });
    prev = label;
    t += sec;
  }
  return { events, duration: t };
}

const rep = (loop, n) => Array(n).fill(loop).flat();
const LOOP_A = [['G', 2], ['D', 2], ['Am', 2], ['C', 2]];   // 8 s — „strofa”
const LOOP_B = [['Em', 2], ['C', 2], ['G', 2], ['D', 2]];   // 8 s — „refrenul”
const BRIDGE = [['F', 4], ['F#m', 4]];                       // 8 s, o singură dată

const letterSeq = (r) => r.sections.map((s) => s.cluster);
const nameSeq = (r) => r.sections.map((s) => s.name);
const loopLabels = (r, c) => r.patterns[c].loop.map((x) => x.label);

// --- 0. Contopirea circulară: bucla care începe ȘI se termină pe același acord ----
// Cazul obișnuit, nu exotic: orice progresie care pleacă și revine pe tonică. compressLoop
// unește capetele și mută secundele cozii în capul listei — deci primul element începe cu
// `lead` secunde ÎNAINTE de faza 0. Cine consumă lista trebuie să compenseze; fără asta,
// foaia melodiei ieșea rotită (click pe al doilea acord sărea unde suna primul).
{
  // E-A-E-B-A-E: 4+2+2+2+2+2 = 14 s, prima și ultima bucată sunt E.
  const LOOP_E = [['E', 4], ['A', 2], ['E', 2], ['B', 2], ['A', 2], ['E', 2]];
  const { events, duration } = timeline(rep(LOOP_E, 6));
  const r = detectSections(events, duration);
  const c = Object.keys(r.patterns)[0];
  assert.ok(c, 'trebuie găsit un tipar');

  const p = r.patterns[c];
  assert.equal(p.loop[0].label, 'E', 'bucla începe pe E');
  assert.ok(p.loop[p.loop.length - 1].label !== 'E',
    `după contopire, coada nu mai are voie să fie tot E: ${JSON.stringify(p.loop.map((x) => x.label))}`);
  // Coada contopită era de 2 s: exact atât trebuie raportat ca `lead`.
  assert.ok(Math.abs(p.lead - 2) <= 0.6, `lead ${p.lead}, aștept ~2`);
  assert.ok(Math.abs(p.loop[0].seconds - 6) <= 0.9,
    `capul contopit ține ${p.loop[0].seconds}s (4 de la început + 2 din coadă), aștept ~6`);

  // Verificarea care contează: reconstruind momentele așa cum o face foaia (primul chip la
  // start, restul la acc - lead), fiecare chip trebuie să cadă pe acordul care chiar sună.
  const sec = r.sections[0];
  let acc = 0;
  p.loop.forEach((item, k) => {
    const at = k === 0 ? sec.start : sec.start + Math.max(0, acc - p.lead);
    acc += item.seconds;
    // Ce sună la momentul `at`, după cronologia originală?
    let sounding = null;
    for (const e of events) { if (e.t <= at + 0.01) sounding = e.label; else break; }
    assert.equal(sounding, item.label,
      `chip-ul ${k} („${item.label}") duce la ${at.toFixed(1)}s, unde sună „${sounding}"`);
  });
  console.log('  Buclă contopită circular: lead raportat, chip-urile cad pe acordul corect ✔');
}

// --- 1. Structura clasică: A A A A B B A A B B punte B B --------------------------
// Capcana pe care o testăm explicit: A și B au ACEEAȘI perioadă (8 s) — segmentarea doar
// după perioadă le-ar lipi; tăietura pe conținut trebuie să le despartă.
{
  const song = [...rep(LOOP_A, 4), ...rep(LOOP_B, 2), ...rep(LOOP_A, 2), ...rep(LOOP_B, 2),
    ...BRIDGE, ...rep(LOOP_B, 2)];
  const { events, duration } = timeline(song);
  assert.equal(duration, 104);
  const r = detectSections(events, duration);

  assert.deepEqual(letterSeq(r), ['A', 'B', 'A', 'B', null, 'B'],
    `litere greșite: ${JSON.stringify(letterSeq(r))}`);
  assert.deepEqual(nameSeq(r), ['verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus'],
    `nume greșite: ${JSON.stringify(nameSeq(r))}`);

  const expectedBounds = [0, 32, 48, 64, 80, 88, 104];
  r.sections.forEach((s, i) => {
    assert.ok(Math.abs(s.start - expectedBounds[i]) <= 2,
      `secțiunea ${i} începe la ${s.start}, aștept ~${expectedBounds[i]}`);
  });
  assert.ok(Math.abs(r.sections[5].end - 104) <= 2, 'ultima secțiune trebuie să țină până la final');

  assert.deepEqual(loopLabels(r, 'A'), ['G', 'D', 'Am', 'C'], 'tiparul A');
  assert.deepEqual(loopLabels(r, 'B'), ['Em', 'C', 'G', 'D'], 'tiparul B');
  for (const c of ['A', 'B']) {
    for (const item of r.patterns[c].loop) {
      assert.ok(Math.abs(item.seconds - 2) <= 0.6, `${c}: ${item.label} ține ${item.seconds}s, aștept ~2`);
    }
    assert.ok(Math.abs(r.patterns[c].period - 8) <= 1, `${c}: perioadă ${r.patterns[c].period}, aștept ~8`);
  }
  assert.deepEqual(r.sections.map((s) => s.reps), [4, 2, 2, 2, 1, 2], 'numărul de repetiții');
  assert.ok(r.coverage > 0.85, `acoperire ${r.coverage.toFixed(2)}, aștept >0.85`);
  console.log('  Structură A B A B punte B: litere, nume, granițe, tipare, reps ✔');
}

// --- 2. Votul repetițiilor repară acordurile corupte -------------------------------
{
  const song = [...rep(LOOP_A, 4), ...rep(LOOP_B, 2), ...rep(LOOP_A, 2), ...rep(LOOP_B, 2),
    ...BRIDGE, ...rep(LOOP_B, 2)];
  const { events, duration } = timeline(song);

  // Corupem ~10% din evenimente, determinist (LCG — fără Math.random, ca peste tot în teste).
  let seed = 424242;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const WRONG = ['E7', 'Bm', 'Cmaj7', 'G#m'];
  const noisy = events.map((ev) => (rand() < 0.10
    ? { t: ev.t, label: WRONG[Math.floor(rand() * WRONG.length)] }
    : { ...ev }));
  const corrupted = noisy.filter((ev, i) => ev.label !== events[i].label).length;
  assert.ok(corrupted >= 3, `corupția n-a atins destule evenimente (${corrupted})`);

  const r = detectSections(noisy, duration);
  assert.deepEqual(letterSeq(r), ['A', 'B', 'A', 'B', null, 'B'],
    `cu zgomot, literele s-au stricat: ${JSON.stringify(letterSeq(r))}`);
  assert.deepEqual(loopLabels(r, 'A'), ['G', 'D', 'Am', 'C'],
    `votul n-a reparat tiparul A: ${JSON.stringify(loopLabels(r, 'A'))}`);
  assert.deepEqual(loopLabels(r, 'B'), ['Em', 'C', 'G', 'D'],
    `votul n-a reparat tiparul B: ${JSON.stringify(loopLabels(r, 'B'))}`);
  console.log(`  Zgomot: ${corrupted} evenimente corupte, structura neschimbată, tiparele reparate de vot ✔`);
}

// --- 3. Intro și outro ---------------------------------------------------------------
{
  const song = [['E', 10], ...rep(LOOP_A, 4), ['B7', 10]];
  const { events, duration } = timeline(song);
  const r = detectSections(events, duration);

  assert.equal(r.sections.length, 3, `aștept 3 secțiuni, am ${r.sections.length}`);
  assert.equal(r.sections[0].name, 'intro');
  assert.equal(r.sections[0].cluster, null);
  assert.equal(r.sections[1].cluster, 'A');
  assert.equal(r.sections[1].name, null, 'un singur grup nu se numește strofă');
  assert.equal(r.sections[2].name, 'outro');
  assert.deepEqual(loopLabels(r, 'A'), ['G', 'D', 'Am', 'C']);
  console.log('  Intro + buclă + outro: numite corect, grupul singur rămâne literă ✔');
}

// --- 4. Melodie fără repetiții: nu inventăm structură --------------------------------
{
  const labels = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const song = labels.map((l) => [l, 5]);
  const { events, duration } = timeline(song);
  const r = detectSections(events, duration);

  assert.equal(Object.keys(r.patterns).length, 0, 'nu trebuie găsit niciun tipar');
  assert.equal(r.coverage, 0);
  assert.ok(r.sections.every((s) => s.cluster === null));
  assert.ok(r.sections.every((s) => s.name === null), 'fără structură nu se numește nimic');
  console.log('  Fără repetiții: zero tipare, zero nume inventate ✔');
}

// --- 5. Dronă (un singur acord ținut) -----------------------------------------------
{
  const r = detectSections([{ t: 0, label: 'E' }], 120);
  assert.equal(r.sections.length, 1);
  assert.equal(r.sections[0].cluster, null);
  assert.equal(Object.keys(r.patterns).length, 0);
  console.log('  Dronă: o singură zonă liberă, fără buclă inventată ✔');
}

// --- 6. Intrări ciudate nu dărâmă nimic ----------------------------------------------
{
  assert.deepEqual(detectSections([], 0).sections, []);
  assert.deepEqual(detectSections(null, 100).sections.length, 1);
  const junk = detectSections(
    [{ t: 3, label: 'G' }, { t: 1, label: 'C' }, { t: 'x', label: 'D' }, null, { t: 5 }],
    30,
  );
  assert.ok(Array.isArray(junk.sections));
  console.log('  Intrări goale / nesortate / stricate: tratate fără erori ✔');
}

// --- 6b. Strofă și refren cu lungimi DIFERITE (8 s vs 12 s) ---------------------------
// Perioadele diferite trebuie să coexiste, iar fiecare secțiune să-și păstreze bucla ei.
{
  const V = [['G', 2], ['D', 2], ['Em', 2], ['C', 2]];                       // 8 s
  const C = [['C', 2], ['G', 2], ['Am', 2], ['F', 2], ['C', 2], ['G', 2]];   // 12 s
  const song = [...rep(V, 3), ...rep(C, 2), ...rep(V, 2), ...rep(C, 2)];
  const { events, duration } = timeline(song);
  const r = detectSections(events, duration);

  assert.deepEqual(letterSeq(r), ['A', 'B', 'A', 'B'],
    `litere greșite: ${JSON.stringify(letterSeq(r))}`);
  assert.deepEqual(nameSeq(r), ['verse', 'chorus', 'verse', 'chorus']);
  assert.deepEqual(loopLabels(r, 'A'), ['G', 'D', 'Em', 'C']);
  assert.ok(Math.abs(r.patterns.A.period - 8) <= 1, `perioada A: ${r.patterns.A.period}`);
  assert.ok(Math.abs(r.patterns.B.period - 12) <= 1, `perioada B: ${r.patterns.B.period}`);
  console.log('  Strofă 8s + refren 12s: perioade diferite coexistă, buclele rămân separate ✔');
}

// --- 6c. Melodia dintr-o singură buclă (cazul „Looking Too Closely”) ------------------
{
  const { events, duration } = timeline(rep(LOOP_A, 10));
  const r = detectSections(events, duration);
  assert.equal(r.sections.length, 1);
  assert.equal(r.sections[0].cluster, 'A');
  assert.equal(r.sections[0].name, null, 'o singură buclă nu se numește strofă');
  assert.equal(r.sections[0].reps, 10);
  assert.deepEqual(loopLabels(r, 'A'), ['G', 'D', 'Am', 'C']);
  assert.ok(r.coverage > 0.95);
  console.log('  Melodie = o singură buclă: o secțiune, ×10, fără nume inventat ✔');
}

// --- 7. Determinism -------------------------------------------------------------------
{
  const song = [...rep(LOOP_A, 3), ...rep(LOOP_B, 3), ...rep(LOOP_A, 2)];
  const { events, duration } = timeline(song);
  const a = JSON.stringify(detectSections(events, duration));
  const b = JSON.stringify(detectSections(events, duration));
  assert.equal(a, b, 'două rulări pe aceeași intrare trebuie să dea exact același rezultat');
  console.log('  Determinism: două rulări → identic ✔');
}

// --- 8. Viteză: o melodie de 6 minute se analizează instant ---------------------------
{
  const song = [];
  for (let i = 0; i < 15; i++) song.push(...rep(i % 2 ? LOOP_B : LOOP_A, 3));
  const { events, duration } = timeline(song);
  const t0 = process.hrtime.bigint();
  detectSections(events, duration);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 250, `detectSections a durat ${ms.toFixed(0)} ms — prea lent pentru UI`);
  console.log(`  Viteză: ${duration}s de melodie analizate în ${ms.toFixed(1)} ms ✔`);
}

console.log('sections.test.mjs: toate testele au trecut ✔');
