// Rulare: node tests/progression.test.mjs
//
// Verifică ce contează de fapt pentru sing-along: că analizorul URMĂREȘTE schimbările de acord
// în timp, nu doar că recunoaște un acord izolat. Sintetizează progresia din
// „Knockin' on Heaven's Door” (G D Am C) și verifică succesiunea și momentele.
//
// E cel mai apropiat lucru de Poarta 2 care se poate verifica fără muzică reală și fără browser.

import assert from 'node:assert/strict';
import { Analyzer, FRAME_SIZE, HOP_SIZE } from '../extension/offscreen/analyzer.js';
import { NOTES, NO_CHORD } from '../extension/lib/music-theory.js';

const SR = 48000;              // rata tipică a unui AudioContext
const SECONDS_PER_CHORD = 2;

const freqOf = (name, oct) => 440 * Math.pow(2, (NOTES.indexOf(name) - 9) / 12 + (oct - 4));

// Voicing-uri apropiate de ce iese dintr-o chitară: bas jos + acordul în registrul mediu.
const PROGRESSION = [
  { label: 'G',  notes: [['G', 2], ['B', 3], ['D', 4], ['G', 4]] },
  { label: 'D',  notes: [['D', 3], ['F#', 3], ['A', 3], ['D', 4]] },
  { label: 'Am', notes: [['A', 2], ['C', 4], ['E', 4], ['A', 4]] },
  { label: 'C',  notes: [['C', 3], ['E', 3], ['G', 3], ['C', 4]] },
];

function renderProgression() {
  const total = Math.floor(PROGRESSION.length * SECONDS_PER_CHORD * SR);
  const out = new Float32Array(total);
  PROGRESSION.forEach((chord, ci) => {
    const start = Math.floor(ci * SECONDS_PER_CHORD * SR);
    const len = Math.floor(SECONDS_PER_CHORD * SR);
    const freqs = chord.notes.map(([n, o]) => freqOf(n, o));
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      // ciupitură: atac scurt, stingere lentă — ca o coardă lăsată să sune
      const env = Math.min(1, t * 80) * Math.exp(-1.1 * t);
      let s = 0;
      for (const f of freqs) {
        for (let h = 1; h <= 6; h++) s += (1 / h) * Math.sin(2 * Math.PI * f * h * t);
      }
      out[start + i] = (s / (freqs.length * 2.5)) * env * 0.9;
    }
  });
  return out;
}

const signal = renderProgression();
const events = [];
const analyzer = new Analyzer({ sampleRate: SR, onChord: (e) => events.push(e) });
await analyzer.init();

for (let off = 0; off + FRAME_SIZE <= signal.length; off += HOP_SIZE) {
  analyzer.push(signal.subarray(off, off + FRAME_SIZE), off / SR);
}
analyzer.flush();

// Acordul afișat la un moment dat = ultimul eveniment de dinaintea lui.
const chordAt = (t) => {
  let label = NO_CHORD;
  for (const e of events) { if (e.t <= t) label = e.label; else break; }
  return label;
};

// Eșantionăm la mijlocul fiecărui acord, unde sunetul e stabil.
let correct = 0;
const report = [];
PROGRESSION.forEach((chord, ci) => {
  const t = ci * SECONDS_PER_CHORD + SECONDS_PER_CHORD / 2;
  const got = chordAt(t);
  if (got === chord.label) correct++;
  report.push(`${chord.label}@${t.toFixed(1)}s -> ${got}${got === chord.label ? '' : ' ✘'}`);
});

console.log('  Progresie G D Am C:', report.join(' | '));
console.log(`  Corecte la mijlocul acordului: ${correct}/${PROGRESSION.length}`);
assert.equal(correct, PROGRESSION.length, 'toate cele 4 acorduri trebuie recunoscute corect');

// Fiecare schimbare trebuie prinsă aproape de momentul ei (±0,5s — cerința Porții 4).
// Detecția poate cădea PUȚIN ÎNAINTE de schimbare: un cadru durează FRAME_SIZE/SR (~0,17s)
// și e datat la începutul lui, deci un cadru care începe înainte de schimbare o cuprinde deja.
const frameSeconds = FRAME_SIZE / SR;
const delays = [];
for (let ci = 1; ci < PROGRESSION.length; ci++) {
  const changeAt = ci * SECONDS_PER_CHORD;
  const target = PROGRESSION[ci].label;
  const hit = events.find((e) => e.label === target && e.t > changeAt - frameSeconds - 0.05);
  assert.ok(hit, `schimbarea către ${target} la ${changeAt}s nu a fost detectată deloc`);
  const delay = hit.t - changeAt;
  assert.ok(Math.abs(delay) <= 0.5,
    `${target} detectat la ${delay >= 0 ? '+' : ''}${delay.toFixed(2)}s față de schimbare (max ±0,5s)`);
  delays.push(`${target} ${delay >= 0 ? '+' : ''}${delay.toFixed(2)}s`);
}
console.log(`  Schimbări prinse în ±0,5s: ${delays.join(', ')} ✔`);

// Măsură a zgomotului: câte evenimente peste minimul teoretic de 4.
console.log(`  Evenimente emise: ${events.length} (minim teoretic 4) — Pasul 3 le va netezi`);

console.log('progression.test.mjs: toate testele au trecut ✔');
