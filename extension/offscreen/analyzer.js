// Analizorul de acorduri.
//
// ISTORIC: prima variantă folosea Essentia.js (WebAssembly). Merge perfect în Node, dar NU
// poate rula într-o extensie MV3: glue-ul emscripten/embind își construiește funcțiile de
// legătură ca text și le evaluează, ceea ce CSP-ul extensiilor interzice.
// Detalii complete: docs/BUG-essentia-mv3-csp.md. Acum lanțul e propriu:
//
//   cadru audio -> FFT -> vârfuri spectrale (interpolate) -> chroma (12) -> șabloane de acorduri
//
// Aceeași suită de test ca varianta Essentia: 8/8 acorduri, la 44100 și 48000 Hz.
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
import { FFT } from '../lib/fft.js';
import { spectralPeaks, chromaFromPeaks, CHROMA_SIZE } from '../lib/chroma.js';
import { matchChord } from '../lib/chords.js';

const log = createLogger('analyzer');

// ATENȚIE: aceleași valori sunt hardcodate în frame-processor.js (worklet-ul rulează în alt
// scope și nu poate importa). Dacă le schimbi aici, schimbă-le și acolo.
export const FRAME_SIZE = 8192;
export const HOP_SIZE = 4096;

export class Analyzer {
  constructor({ sampleRate = 44100, onChord } = {}) {
    this.sampleRate = sampleRate;
    this.onChord = onChord || (() => {});
    this.fft = new FFT(FRAME_SIZE);
    this.magBuf = new Float64Array(FRAME_SIZE / 2 + 1);
    this.chromaBuf = new Float64Array(CHROMA_SIZE);
    this.lastLabel = NO_CHORD;
    this.lastT = 0;
  }

  // Păstrat asincron: offscreen.js îl așteaptă, iar contractul rămâne stabil dacă
  // vreodată revenim la ceva care are nevoie de încărcare.
  async init() {
    log.debug('Analyzer pregătit. sampleRate =', this.sampleRate, '| cadru =', FRAME_SIZE);
  }

  /** Un cadru audio -> eticheta acordului + cât de sigur suntem (0..1). */
  analyzeFrame(frame) {
    const mag = this.fft.magnitudeSpectrum(frame, this.magBuf);
    const peaks = spectralPeaks(mag, this.sampleRate, FRAME_SIZE);
    const chroma = chromaFromPeaks(peaks, {}, this.chromaBuf);
    return matchChord(chroma);
  }

  push(frame, videoTime) {
    if (!(videoTime >= 0)) return; // fără ceas video (reclamă / pauză) -> aruncăm cadrul
    if (frame.length !== FRAME_SIZE) {
      log.warn(`cadru de ${frame.length} eșantioane, aștept ${FRAME_SIZE} — ignorat`);
      return;
    }
    let result;
    try {
      result = this.analyzeFrame(frame);
    } catch (err) {
      log.error('Analiza cadrului a eșuat:', err?.message || err);
      return;
    }
    this.lastT = videoTime;
    // TODO(Pasul 3): netezire — fereastră mediană + durată minimă 0,8s + contopire repetiții.
    if (result.label === this.lastLabel) return;
    this.lastLabel = result.label;
    log.debug(`acord: ${result.label} (scor ${result.score.toFixed(2)}) @ ${videoTime.toFixed(1)}s`);
    this.onChord({ t: videoTime, label: result.label, confidence: result.score });
  }

  flush() { /* fără tampon de golit în varianta fără netezire */ }

  dispose() {
    this.lastLabel = NO_CHORD;
  }
}

// --- Auto-test Poarta 0 -------------------------------------------------------
// Sintetizează un acord de Do major și verifică în browser că lanțul dă „C”.
export async function selfTest() {
  const sampleRate = 44100;
  const a = new Analyzer({ sampleRate });
  await a.init();

  const frame = new Float32Array(FRAME_SIZE);
  const freqs = [130.81, 164.81, 196.00]; // C3, E3, G3
  for (let i = 0; i < FRAME_SIZE; i++) {
    let s = 0;
    for (const f of freqs) for (let h = 1; h <= 6; h++) s += (1 / h) * Math.sin((2 * Math.PI * f * h * i) / sampleRate);
    frame[i] = (s / 7.5) * 0.9;
  }

  const res = a.analyzeFrame(frame);
  const ok = res.label === 'C';
  log.warn(`[POARTA 0] chord=${res.label} (scor ${res.score.toFixed(2)}) — ${ok ? 'CORECT ✔' : 'GREȘIT ✘'}`);
  a.dispose();
  return ok;
}
