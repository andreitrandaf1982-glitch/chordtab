// Analizorul de acorduri (Essentia.js WASM).
//
// PASUL 0 — verificat: build-ul WASM expune ChordsDetection, HPCP, SpectralPeaks, Spectrum,
// Windowing, FrameGenerator. Pe 8 acorduri sintetizate (C G D Am Em F Dm A) → 8/8 corect.
// Varianta aleasă: **ChordsDetection** (nu potrivirea manuală pe șabloane).
// ATENȚIE: vectorul HPCP are indexul 0 = **A**, nu C (referință 440 Hz) — verificat empiric,
// 8/8 doar cu offset 9. ChordsDetection știe singur convenția; contează doar dacă citim chroma direct.
//
// CONTRACT (respectat de offscreen.js):
//   const a = new Analyzer({ sampleRate, onChord });
//   await a.init();
//   a.push(frameFloat32, videoTime);  // cadru de FRAME_SIZE eșantioane + timpul video al cadrului
//   a.flush();
//   a.dispose();
// onChord primește { t, label, confidence } DOAR când acordul se schimbă.

import { createLogger } from '../lib/logger.js';
import { NO_CHORD } from '../lib/music-theory.js';

const log = createLogger('analyzer');

export const FRAME_SIZE = 4096;
export const HOP_SIZE = 2048;

// Fereastra pe care rulează ChordsDetection (secunde) și cât de des o rulăm.
const WINDOW_SECONDS = 2.0;
const DETECT_EVERY_MS = 500;

let essentiaPromise = null;

// Încarcă Essentia o singură dată. Build-ul .es.js are WASM-ul încorporat base64 —
// fără fetch, fără locateFile: exact ce ne trebuie sub CSP-ul MV3 (wasm-unsafe-eval).
export function loadEssentia() {
  if (!essentiaPromise) {
    essentiaPromise = (async () => {
      const { EssentiaWASM } = await import('../vendor/essentia-wasm.es.js');
      const Essentia = (await import('../vendor/essentia.js-core.es.js')).default;
      const wasm = EssentiaWASM.ready ? await EssentiaWASM.ready : EssentiaWASM;
      const essentia = new Essentia(wasm);
      log.info('Essentia încărcat, versiune', essentia.version);
      return essentia;
    })().catch((err) => {
      essentiaPromise = null; // permite reîncercarea la următoarea captură
      throw err;
    });
  }
  return essentiaPromise;
}

export class Analyzer {
  constructor({ sampleRate = 44100, onChord } = {}) {
    this.sampleRate = sampleRate;
    this.onChord = onChord || (() => {});
    this.essentia = null;
    this.pcp = [];       // { vec: number[12], t: number }
    this.lastLabel = NO_CHORD;
    this.lastDetectAt = 0;
    this.maxFrames = Math.ceil((WINDOW_SECONDS * sampleRate) / HOP_SIZE);
  }

  async init() {
    this.essentia = await loadEssentia();
    log.debug('Analyzer pregătit. sampleRate =', this.sampleRate, '| fereastră =', this.maxFrames, 'cadre');
  }

  // Un cadru audio -> un vector HPCP (12 valori). Eliberează vectorii WASM.
  frameToHpcp(frame) {
    const e = this.essentia;
    let vec = null, win = null, spec = null, peaks = null, hpcp = null;
    try {
      vec = e.arrayToVector(frame);
      win = e.Windowing(vec, true, FRAME_SIZE, 'hann').frame;
      spec = e.Spectrum(win, FRAME_SIZE).spectrum;
      peaks = e.SpectralPeaks(spec, 0, 5000, 100, 20, 'frequency', this.sampleRate);
      // Parametrii = EXACT valorile implicite Essentia (cele validate 8/8 în spike);
      // singurul care variază e sampleRate, fiindcă AudioContext-ul rulează des la 48000.
      // NU pune maxShifted=true: rotește vectorul la maxim și strică ChordsDetection.
      hpcp = e.HPCP(peaks.frequencies, peaks.magnitudes, true, 500, 0, 5000, false, 40, false,
        'unitMax', 440, this.sampleRate, 12, 'squaredCosine', 1);
      return Array.from(e.vectorToArray(hpcp.hpcp));
    } finally {
      for (const v of [vec, win, spec, peaks?.frequencies, peaks?.magnitudes, hpcp?.hpcp]) {
        try { v?.delete?.(); } catch { /* deja eliberat */ }
      }
    }
  }

  push(frame, videoTime) {
    if (!this.essentia) return;
    if (!(videoTime >= 0)) return; // fără ceas video (reclamă / pauză) → aruncăm cadrul
    try {
      this.pcp.push({ vec: this.frameToHpcp(frame), t: videoTime });
    } catch (err) {
      log.error('HPCP a eșuat pe cadru:', err?.message || err);
      return;
    }
    while (this.pcp.length > this.maxFrames) this.pcp.shift();

    const now = performance.now();
    if (now - this.lastDetectAt >= DETECT_EVERY_MS && this.pcp.length >= 8) {
      this.lastDetectAt = now;
      this.detect();
    }
  }

  // Rulează ChordsDetection pe fereastra curentă și emite doar la schimbare de acord.
  detect() {
    const result = this.detectOn(this.pcp.map((p) => p.vec));
    if (!result) return;
    const { label, confidence } = result;
    if (label === this.lastLabel) return;
    this.lastLabel = label;
    const t = this.pcp[this.pcp.length - 1]?.t ?? 0;
    log.debug(`acord: ${label} (conf ${confidence.toFixed(2)}) @ ${t.toFixed(1)}s`);
    this.onChord({ t, label, confidence });
  }

  // Acordul dominant dintr-o fereastră de cadre PCP + cât de dominant e (0..1).
  detectOn(frames) {
    const e = this.essentia;
    if (!e || frames.length === 0) return null;
    let vv = null, res = null;
    try {
      vv = new e.module.VectorVectorFloat();
      for (const f of frames) {
        const v = e.arrayToVector(Float32Array.from(f));
        vv.push_back(v);
        try { v.delete(); } catch { /* push_back copiază */ }
      }
      res = e.ChordsDetection(vv, HOP_SIZE, this.sampleRate, FRAME_SIZE);
      const tally = new Map();
      const n = res.chords.size();
      for (let i = 0; i < n; i++) {
        const c = res.chords.get(i);
        tally.set(c, (tally.get(c) || 0) + 1);
      }
      if (n === 0) return null;
      const [label, count] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
      return { label, confidence: count / n };
    } catch (err) {
      log.error('ChordsDetection a eșuat:', err?.message || err);
      return null;
    } finally {
      try { res?.chords?.delete?.(); } catch { /* ignor */ }
      try { res?.strength?.delete?.(); } catch { /* ignor */ }
      try { vv?.delete?.(); } catch { /* ignor */ }
    }
  }

  flush() {
    if (this.pcp.length) this.detect();
  }

  dispose() {
    this.pcp = [];
    this.lastLabel = NO_CHORD;
  }
}

// --- Auto-test Poarta 0 -------------------------------------------------------
// Sintetizează un acord de Do major și verifică în browser că lanțul WASM dă „C”.
export async function selfTest() {
  const sampleRate = 44100;
  const a = new Analyzer({ sampleRate });
  await a.init();

  const seconds = 2;
  const n = seconds * sampleRate;
  const signal = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const f of [261.63, 329.63, 392.00]) {
      s += Math.sin(2 * Math.PI * f * i / sampleRate)
         + 0.35 * Math.sin(2 * Math.PI * 2 * f * i / sampleRate)
         + 0.15 * Math.sin(2 * Math.PI * 3 * f * i / sampleRate);
    }
    signal[i] = (s / 4.5) * 0.8;
  }

  const frames = [];
  for (let off = 0; off + FRAME_SIZE <= n; off += HOP_SIZE) {
    frames.push(a.frameToHpcp(signal.subarray(off, off + FRAME_SIZE)));
  }
  const res = a.detectOn(frames);
  const ok = res?.label === 'C';
  log.warn(`[POARTA 0] chord=${res?.label} (conf ${res?.confidence?.toFixed(2)}) — ${ok ? 'CORECT ✔' : 'GREȘIT ✘'}`);
  a.dispose();
  return ok;
}
