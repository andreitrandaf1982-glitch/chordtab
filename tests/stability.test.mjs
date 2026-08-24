// Rulare: node tests/stability.test.mjs
//
// Reproduce plângerea lui Andrei de la Poarta 2: „se schimbă în permanență la fiecare sunet…
// urmărește linia melodică / basul, nu acordul”.
//
// Semnalul de test e intenționat ostil, ca o melodie adevărată:
//   - acordul, ciupit din nou la fiecare secundă (nu ținut continuu);
//   - o linie melodică DEASUPRA, mai tare decât acordul, care se schimbă la fiecare 0,4s
//     și trece și prin note din AFARA acordului (exact ce derutează detectorul);
//   - lovituri de percuție (zgomot de bandă largă) la fiecare 0,5s.
//
// Măsurăm două lucruri, nu unul:
//   ACURATEȚE — cât la sută din timp se afișează acordul corect (cerința Porții 3: ≥70%);
//   STABILITATE — câte schimbări de acord se emit (ideal 4; multe = pâlpâire de necitit).

import assert from 'node:assert/strict';
import { Analyzer, FRAME_SIZE, HOP_SIZE } from '../extension/offscreen/analyzer.js';
import { NOTES, NO_CHORD } from '../extension/lib/music-theory.js';

const SR = 48000;
const SECONDS_PER_CHORD = 4;
const freqOf = (name, oct) => 440 * Math.pow(2, (NOTES.indexOf(name) - 9) / 12 + (oct - 4));

const PROGRESSION = [
  { label: 'G',  voicing: [['G', 2], ['B', 3], ['D', 4], ['G', 4]], melody: ['G', 'A', 'B', 'D', 'B', 'A', 'G', 'F#', 'G', 'B'] },
  { label: 'D',  voicing: [['D', 3], ['F#', 3], ['A', 3], ['D', 4]], melody: ['D', 'E', 'F#', 'A', 'F#', 'E', 'D', 'C#', 'D', 'F#'] },
  { label: 'Am', voicing: [['A', 2], ['C', 4], ['E', 4], ['A', 4]], melody: ['A', 'B', 'C', 'E', 'C', 'B', 'A', 'G', 'A', 'C'] },
  { label: 'C',  voicing: [['C', 3], ['E', 3], ['G', 3], ['C', 4]], melody: ['C', 'D', 'E', 'G', 'E', 'D', 'C', 'B', 'C', 'E'] },
];

function pluck(t, decay = 1.1) {
  return Math.min(1, t * 80) * Math.exp(-decay * t);
}

function render() {
  const total = Math.floor(PROGRESSION.length * SECONDS_PER_CHORD * SR);
  const out = new Float32Array(total);
  let seed = 987654321;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };

  for (let i = 0; i < total; i++) {
    const time = i / SR;
    const ci = Math.min(PROGRESSION.length - 1, Math.floor(time / SECONDS_PER_CHORD));
    const chord = PROGRESSION[ci];
    let s = 0;

    // acordul, ciupit din nou la fiecare secundă
    const tc = time % 1;
    for (const [n, o] of chord.voicing) {
      const f = freqOf(n, o);
      for (let h = 1; h <= 6; h++) s += (1 / h) * Math.sin(2 * Math.PI * f * h * time) * pluck(tc);
    }
    s /= chord.voicing.length * 2.5;

    // linia melodică: mai TARE decât acordul, se schimbă des, trece prin note din afara acordului
    const mi = Math.floor((time % SECONDS_PER_CHORD) / 0.4) % chord.melody.length;
    const fm = freqOf(chord.melody[mi], 5);
    const tm = (time % 0.4);
    let m = 0;
    for (let h = 1; h <= 4; h++) m += (1 / h) * Math.sin(2 * Math.PI * fm * h * time);
    s += (m / 2.1) * pluck(tm, 2.5) * 1.5;

    // percuție: pocnet de bandă largă la fiecare 0,5s
    const tp = time % 0.5;
    if (tp < 0.04) s += rand() * 0.9 * Math.exp(-60 * tp);

    out[i] = s * 0.55;
  }
  return out;
}

const signal = render();
const events = [];
const analyzer = new Analyzer({ sampleRate: SR, onChord: (e) => events.push(e) });
await analyzer.init();
for (let off = 0; off + FRAME_SIZE <= signal.length; off += HOP_SIZE) {
  analyzer.push(signal.subarray(off, off + FRAME_SIZE), off / SR);
}
analyzer.flush();

// Depanare: `CHORDTAB_DEBUG=1 node tests/stability.test.mjs` arată exact ce s-a emis și când.
if (process.env.CHORDTAB_DEBUG) {
  console.log('  --- evenimente emise ---');
  for (const e of events) console.log(`    ${e.t.toFixed(2)}s -> ${e.label} (${e.confidence.toFixed(2)})`);
  console.log('  --- așteptat: ' + PROGRESSION.map((c, i) => `${c.label}@${i * SECONDS_PER_CHORD}s`).join(', '));
}

const chordAt = (t) => {
  let label = NO_CHORD;
  for (const e of events) { if (e.t <= t) label = e.label; else break; }
  return label;
};

// Acuratețea: eșantionăm des, dar sărim prima jumătate de secundă a fiecărui acord
// (acolo detectorul are voie să fie încă pe cel dinainte).
let hits = 0, total = 0;
const perChord = PROGRESSION.map(() => ({ hit: 0, all: 0 }));
for (let t = 0; t < PROGRESSION.length * SECONDS_PER_CHORD; t += 0.1) {
  const ci = Math.floor(t / SECONDS_PER_CHORD);
  if (t % SECONDS_PER_CHORD < 0.5) continue;
  const ok = chordAt(t) === PROGRESSION[ci].label;
  total++; if (ok) hits++;
  perChord[ci].all++; if (ok) perChord[ci].hit++;
}
const accuracy = hits / total;
const changes = events.length;

console.log('  Detalii pe acord: ' + PROGRESSION.map((c, i) =>
  `${c.label} ${Math.round((perChord[i].hit / perChord[i].all) * 100)}%`).join(', '));
console.log(`  ACURATEȚE: ${(accuracy * 100).toFixed(1)}% din timp (cerință ≥70%)`);
console.log(`  STABILITATE: ${changes} schimbări emise (ideal 4)`);

// Pragurile sunt strânse INTENȚIONAT în jurul rezultatului obținut la Pasul 3 (97% / 4),
// mult peste cerința minimă de 70% din plan. Rolul lor e să prindă regresiile: dacă umbli la
// netezire sau la ponderea basului și scorul scade, testul trebuie să cadă, nu să treacă tăcut.
// Înainte de netezire, aceleași măsurători dădeau 28,4% și 51 de schimbări.
assert.ok(accuracy >= 0.9, `acuratețe ${(accuracy * 100).toFixed(1)}% — a scăzut sub 90% (Pasul 3 dădea 97%)`);
assert.ok(changes <= 6, `${changes} schimbări — pâlpâie prea des (Pasul 3 dădea exact 4, ideal)`);

console.log('stability.test.mjs: toate testele au trecut ✔');
