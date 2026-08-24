// Rulare: node tests/chord-detection.test.mjs   (cere `npm install essentia.js`)
//
// Blochează deciziile DSP validate la Pasul 0:
//  1. lanțul Windowing -> Spectrum -> SpectralPeaks -> HPCP -> ChordsDetection recunoaște
//     corect 8 acorduri sintetizate, la 44100 ȘI la 48000 Hz (rata reală a AudioContext);
//  2. parametrii HPCP din analyzer.js sunt exact cei testați aici (verificare pe sursă —
//     dacă cineva îi schimbă, testul cade și explică de ce contează).

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'node_modules', 'essentia.js', 'dist');

if (!existsSync(DIST)) {
  console.log('SĂRIT: lipsește node_modules/essentia.js — rulează `npm install essentia.js`.');
  process.exit(0);
}

// În Node folosim build-ul UMD (cel ES cade pe __dirname); extensia folosește build-ul ES.
const EssentiaWASM = require(join(DIST, 'essentia-wasm.umd.js'));
const Essentia = require(join(DIST, 'essentia.js-core.umd.js'));
const essentia = new Essentia(EssentiaWASM);

const FRAME_SIZE = 4096, HOP_SIZE = 2048;
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const freqOf = (name) => 440 * Math.pow(2, (NOTES.indexOf(name) - 9) / 12);

function synth(noteNames, sampleRate, seconds = 2) {
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const f of noteNames.map(freqOf)) {
      s += Math.sin(2 * Math.PI * f * i / sampleRate)
         + 0.35 * Math.sin(2 * Math.PI * 2 * f * i / sampleRate)
         + 0.15 * Math.sin(2 * Math.PI * 3 * f * i / sampleRate);
    }
    out[i] = (s / 4.5) * 0.8;
  }
  return out;
}

// Aceleași apeluri și aceiași parametri ca Analyzer.frameToHpcp / Analyzer.detectOn.
function frameToHpcp(frame, sampleRate) {
  const vec = essentia.arrayToVector(frame);
  const win = essentia.Windowing(vec, true, FRAME_SIZE, 'hann').frame;
  const spec = essentia.Spectrum(win, FRAME_SIZE).spectrum;
  const peaks = essentia.SpectralPeaks(spec, 0, 5000, 100, 20, 'frequency', sampleRate);
  const hpcp = essentia.HPCP(peaks.frequencies, peaks.magnitudes, true, 500, 0, 5000, false, 40,
    false, 'unitMax', 440, sampleRate, 12, 'squaredCosine', 1);
  return Array.from(essentia.vectorToArray(hpcp.hpcp));
}

function dominantChord(frames, sampleRate) {
  const vv = new essentia.module.VectorVectorFloat();
  for (const f of frames) vv.push_back(essentia.arrayToVector(Float32Array.from(f)));
  const res = essentia.ChordsDetection(vv, HOP_SIZE, sampleRate, FRAME_SIZE);
  const tally = new Map();
  for (let i = 0; i < res.chords.size(); i++) {
    const c = res.chords.get(i);
    tally.set(c, (tally.get(c) || 0) + 1);
  }
  vv.delete();
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

const CASES = [
  ['C', ['C', 'E', 'G']], ['G', ['G', 'B', 'D']], ['D', ['D', 'F#', 'A']], ['A', ['A', 'C#', 'E']],
  ['Am', ['A', 'C', 'E']], ['Em', ['E', 'G', 'B']], ['Dm', ['D', 'F', 'A']], ['F', ['F', 'A', 'C']],
];

for (const sampleRate of [44100, 48000]) {
  for (const [expected, notes] of CASES) {
    const signal = synth(notes, sampleRate);
    const frames = [];
    for (let o = 0; o + FRAME_SIZE <= signal.length; o += HOP_SIZE) {
      frames.push(frameToHpcp(signal.subarray(o, o + FRAME_SIZE), sampleRate));
    }
    const got = dominantChord(frames, sampleRate);
    assert.equal(got, expected, `@${sampleRate}Hz: ${notes.join('+')} -> ${got}, așteptat ${expected}`);
  }
  console.log(`  ${sampleRate} Hz: ${CASES.length}/${CASES.length} acorduri corecte ✔`);
}

// Convenția HPCP: indexul 0 = A (referință 440 Hz), NU C. Contează dacă citim chroma direct.
{
  const signal = synth(['C', 'E', 'G'], 44100);
  const avg = new Array(12).fill(0);
  let count = 0;
  for (let o = 0; o + FRAME_SIZE <= signal.length; o += HOP_SIZE) {
    const f = frameToHpcp(signal.subarray(o, o + FRAME_SIZE), 44100);
    for (let i = 0; i < 12; i++) avg[i] += f[i];
    count++;
  }
  const top3 = avg.map((v, i) => ({ v: v / count, i })).sort((a, b) => b.v - a.v).slice(0, 3);
  const asC = top3.map((t) => NOTES[t.i]).sort().join(',');
  const asA = top3.map((t) => NOTES[(t.i + 9) % 12]).sort().join(',');
  assert.notEqual(asC, 'C,E,G', 'dacă asta trece, convenția HPCP s-a schimbat — reverifică offsetul');
  assert.equal(asA, 'C,E,G', 'HPCP index 0 ar trebui să fie A (offset 9 până la C)');
  console.log('  HPCP: index 0 = A confirmat (offset 9 → C) ✔');
}

// Parametrii HPCP din analyzer.js trebuie să rămână cei testați aici.
{
  const src = readFileSync(join(ROOT, 'extension', 'offscreen', 'analyzer.js'), 'utf8');
  const call = src.match(/e\.HPCP\(peaks\.frequencies,\s*peaks\.magnitudes,([^;]*?)\);/s);
  assert.ok(call, 'nu găsesc apelul HPCP în analyzer.js');
  const args = call[1].replace(/\s+/g, ' ').trim();
  assert.equal(
    args,
    "true, 500, 0, 5000, false, 40, false, 'unitMax', 440, this.sampleRate, 12, 'squaredCosine', 1",
    'parametrii HPCP din analyzer.js diferă de cei validați (atenție la maxShifted: true rotește vectorul și strică detecția)'
  );
  console.log('  Parametrii HPCP din analyzer.js sunt sincronizați cu testul ✔');
}

console.log('chord-detection.test.mjs: toate testele au trecut ✔');
