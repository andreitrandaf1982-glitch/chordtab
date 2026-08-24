// Rulare: node tests/chord-detection.test.mjs
//
// Verifică lanțul propriu de detecție (FFT -> vârfuri spectrale -> chroma -> șabloane),
// care a înlocuit Essentia.js — vezi docs/BUG-essentia-mv3-csp.md.
// Aceeași suită de acorduri ca la Pasul 0, ca să putem compara cinstit cele două variante.

import assert from 'node:assert/strict';
import { FFT } from '../extension/lib/fft.js';
import { spectralPeaks, chromaFromPeaks } from '../extension/lib/chroma.js';
import { matchChord } from '../extension/lib/chords.js';
import { NOTES, NO_CHORD } from '../extension/lib/music-theory.js';

const FRAME = 8192, HOP = 4096;
const freqOf = (name, oct = 4) => 440 * Math.pow(2, (NOTES.indexOf(name) - 9) / 12 + (oct - 4));

// --- 1. FFT: un sinus curat trebuie să dea vârful la frecvența lui ------------
{
  const sr = 44100, f = 440, fft = new FFT(FRAME);
  const sig = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) sig[i] = Math.sin((2 * Math.PI * f * i) / sr);
  const mag = fft.magnitudeSpectrum(sig);
  let peakBin = 0;
  for (let i = 1; i < mag.length; i++) if (mag[i] > mag[peakBin]) peakBin = i;
  const peakHz = (peakBin * sr) / FRAME;
  assert.ok(Math.abs(peakHz - f) < sr / FRAME, `vârf FFT la ${peakHz.toFixed(1)} Hz, aștept ${f}`);

  const peaks = spectralPeaks(mag, sr, FRAME);
  assert.ok(Math.abs(peaks[0].freq - f) < 1.0,
    `după interpolare aștept ~${f} Hz, am ${peaks[0].freq.toFixed(2)}`);
  console.log(`  FFT: vârf la ${peaks[0].freq.toFixed(2)} Hz (aștept ${f}) ✔`);
}

// --- 2. Un semnal cât de cât realist: fundamentală + armonice, cu atac și stingere ---
function synth(noteNames, sampleRate, seconds = 2, octave = 3) {
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  const freqs = noteNames.map((x) => freqOf(x, octave));
  for (let i = 0; i < n; i++) {
    const env = Math.exp(-1.2 * (i / sampleRate)) * Math.min(1, (i / sampleRate) * 60);
    let s = 0;
    for (const f of freqs) {
      // spectru asemănător unei corzi ciupite: armonice care scad ~1/h
      for (let h = 1; h <= 6; h++) s += (1 / h) * Math.sin((2 * Math.PI * f * h * i) / sampleRate);
    }
    out[i] = (s / (freqs.length * 2.5)) * env * 0.9;
  }
  return out;
}

function analyze(signal, sampleRate) {
  const fft = new FFT(FRAME);
  const votes = new Map();
  for (let o = 0; o + FRAME <= signal.length; o += HOP) {
    const mag = fft.magnitudeSpectrum(signal.subarray(o, o + FRAME));
    const { label } = matchChord(chromaFromPeaks(spectralPeaks(mag, sampleRate, FRAME)));
    if (label !== NO_CHORD) votes.set(label, (votes.get(label) || 0) + 1);
  }
  if (votes.size === 0) return NO_CHORD;
  return [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

const CASES = [
  ['C', ['C', 'E', 'G']], ['G', ['G', 'B', 'D']], ['D', ['D', 'F#', 'A']], ['A', ['A', 'C#', 'E']],
  ['Am', ['A', 'C', 'E']], ['Em', ['E', 'G', 'B']], ['Dm', ['D', 'F', 'A']], ['F', ['F', 'A', 'C']],
];

for (const sampleRate of [44100, 48000]) {
  const wrong = [];
  for (const [expected, notes] of CASES) {
    const got = analyze(synth(notes, sampleRate), sampleRate);
    if (got !== expected) wrong.push(`${expected}->${got}`);
  }
  assert.equal(wrong.length, 0, `@${sampleRate}Hz greșite: ${wrong.join(', ')}`);
  console.log(`  ${sampleRate} Hz: ${CASES.length}/${CASES.length} acorduri corecte ✔`);
}

// --- 3. Convenție: indexul 0 al vectorului chroma = C ------------------------
{
  const sr = 44100;
  const fft = new FFT(FRAME);
  const sig = synth(['C', 'E', 'G'], sr);
  const mag = fft.magnitudeSpectrum(sig.subarray(4096, 4096 + FRAME));
  const ch = chromaFromPeaks(spectralPeaks(mag, sr, FRAME));
  const top3 = [...ch].map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v).slice(0, 3);
  assert.equal(top3.map((t) => NOTES[t.i]).sort().join(','), 'C,E,G',
    'indexul 0 al chroma trebuie să fie C');
  console.log('  Chroma: index 0 = C confirmat ✔');
}

// --- 4. Zgomot și liniște -> N.C., nu un acord inventat ----------------------
{
  const sr = 44100, fft = new FFT(FRAME);
  const silence = new Float32Array(FRAME);
  assert.equal(matchChord(chromaFromPeaks(spectralPeaks(fft.magnitudeSpectrum(silence), sr, FRAME))).label,
    NO_CHORD, 'liniștea trebuie să dea N.C.');

  // zgomot alb, deterministic (generator liniar congruențial — fără Math.random)
  let seed = 12345;
  const noise = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    noise[i] = (seed / 0x3fffffff) - 1;
  }
  const nl = matchChord(chromaFromPeaks(spectralPeaks(fft.magnitudeSpectrum(noise), sr, FRAME)));
  console.log(`  Liniște -> N.C. ✔ | zgomot alb -> ${nl.label} (scor ${nl.score.toFixed(2)})`);
}

// --- 5. Worklet-ul și analizorul trebuie să folosească aceleași dimensiuni de cadru ---
// Nu se pot importa între ele (worklet-ul rulează în scope-ul audio, fără module), deci
// constantele sunt duplicate. Dacă se desincronizează, analizorul primește cadre greșite.
{
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

  const read = (p) => readFileSync(join(ROOT, 'extension', p), 'utf8');
  const grab = (src, name) => Number(src.match(new RegExp(`${name}\\s*=\\s*(\\d+)`))?.[1]);

  const analyzer = read('offscreen/analyzer.js');
  const worklet = read('offscreen/frame-processor.js');
  for (const name of ['FRAME_SIZE', 'HOP_SIZE']) {
    const a = grab(analyzer, name), w = grab(worklet, name);
    assert.ok(Number.isFinite(a) && Number.isFinite(w), `nu găsesc ${name} în ambele fișiere`);
    assert.equal(w, a, `${name} diferă: analyzer.js=${a}, frame-processor.js=${w}`);
  }
  assert.equal(grab(analyzer, 'FRAME_SIZE'), FRAME,
    'testul rulează pe altă dimensiune de cadru decât analizorul');
  console.log('  Dimensiunile cadrului sunt sincronizate (analyzer ↔ worklet ↔ test) ✔');
}

console.log('chord-detection.test.mjs: toate testele au trecut ✔');
