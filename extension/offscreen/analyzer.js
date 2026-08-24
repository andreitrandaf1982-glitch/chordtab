// Analizorul de acorduri.
//
// ISTORIC: prima variantă folosea Essentia.js (WebAssembly). Merge perfect în Node, dar NU
// poate rula într-o extensie MV3 — vezi docs/BUG-essentia-mv3-csp.md. Acum lanțul e propriu:
//
//   cadru audio -> FFT -> vârfuri spectrale -> chroma (12) -> [NETEZIRE] -> acord
//
// PASUL 3 — de ce e nevoie de netezire: un cadru durează ~170 ms, adică o clipă, nu un acord.
// Judecat singur, fiecare cadru urmărește ce se aude mai tare ATUNCI — o notă din melodie, o
// lovitură de tobă, basul — și rezultatul pâlpâie de necitit (măsurat: 51 de schimbări în 16s).
// Netezirea lucrează pe trei niveluri:
//   1. mediem chroma pe o fereastră de ~1,2s: notele trecătoare și percuția se estompează,
//      armonia care ține tot timpul rămâne;
//   2. un candidat nou trebuie să câștige neîntrerupt ~0,45s ca să-l credem;
//   3. acordul e datat cu momentul în care a ÎNCEPUT de fapt, nu cu cel în care ne-am convins
//      (fereastra privește în urmă, deci corectăm cu jumătate din ea).
//
// Punctul 3 contează pentru Pasul 5: în redarea din cache, momentele trebuie să fie exacte.
// În analiza live rămâne o întârziere de ~1s — inevitabilă, fiindcă stabilitatea cere context.
//
// CONTRACT (respectat de offscreen.js):
//   const a = new Analyzer({ sampleRate, onChord });
//   await a.init();
//   a.push(frameFloat32, videoTime);
//   a.flush();
//   a.dispose();

import { createLogger } from '../lib/logger.js';
import { NO_CHORD } from '../lib/music-theory.js';
import { FFT } from '../lib/fft.js';
import { spectralPeaks, chromaFromPeaks, bassChroma, CHROMA_SIZE } from '../lib/chroma.js';
import { matchChord } from '../lib/chords.js';

const log = createLogger('analyzer');

// ATENȚIE: aceleași valori sunt hardcodate în frame-processor.js (worklet-ul rulează în alt
// scope și nu poate importa). Dacă le schimbi aici, schimbă-le și acolo. Un test verifică.
export const FRAME_SIZE = 8192;
export const HOP_SIZE = 4096;

/** Reglajele netezirii — schimbă-le doar cu tests/stability.test.mjs în față. */
export const SMOOTHING = {
  windowSeconds: 1.2,   // pe cât mediem chroma
  minHoldSeconds: 0.45, // cât trebuie să câștige un candidat ca să-l comitem
  minChordSeconds: 0.8, // cât ține minim un acord (sub asta e pâlpâire, nu schimbare)
  seekJumpSeconds: 2.0, // salt de timp peste care presupunem că userul a derulat
};

export class Analyzer {
  constructor({ sampleRate = 44100, onChord, smoothing = {} } = {}) {
    this.sampleRate = sampleRate;
    this.onChord = onChord || (() => {});
    this.cfg = { ...SMOOTHING, ...smoothing };

    this.fft = new FFT(FRAME_SIZE);
    this.magBuf = new Float64Array(FRAME_SIZE / 2 + 1);

    this.history = [];       // { t, chroma, bass } pe fereastra de netezire
    this.avgBuf = new Float64Array(CHROMA_SIZE);
    this.avgBassBuf = new Float64Array(CHROMA_SIZE);
    this.committed = NO_CHORD;
    this.committedAt = -Infinity;
    this.candidate = null;   // { label, sinceT, score }
    this.lastT = -Infinity;
  }

  async init() {
    log.debug(`Analyzer pregătit. sampleRate=${this.sampleRate} cadru=${FRAME_SIZE} ` +
      `fereastră=${this.cfg.windowSeconds}s`);
  }

  /**
   * Un cadru -> două vectori chroma proaspeți (nu reutilizăm tampoane: intră în istoric):
   *  - `chroma`: tot registrul, adică ce note sună;
   *  - `bass`: doar registrul grav, adică ce notă e la bas — de obicei fundamentala acordului.
   * Al doilea e cel care deosebește acordurile înrudite (G de Bm, C de Am).
   */
  frameToChroma(frame) {
    const mag = this.fft.magnitudeSpectrum(frame, this.magBuf);
    const peaks = spectralPeaks(mag, this.sampleRate, FRAME_SIZE);
    return { chroma: chromaFromPeaks(peaks), bass: bassChroma(peaks) };
  }

  push(frame, videoTime) {
    if (!(videoTime >= 0)) return; // fără ceas video (reclamă / pauză) -> aruncăm cadrul
    if (frame.length !== FRAME_SIZE) {
      log.warn(`cadru de ${frame.length} eșantioane, aștept ${FRAME_SIZE} — ignorat`);
      return;
    }

    // Derulare în video: istoricul de dinainte nu mai are legătură cu ce se aude acum.
    if (Math.abs(videoTime - this.lastT) > this.cfg.seekJumpSeconds) this.resetHistory();
    this.lastT = videoTime;

    let framed;
    try {
      framed = this.frameToChroma(frame);
    } catch (err) {
      log.error('Analiza cadrului a eșuat:', err?.message || err);
      return;
    }

    this.history.push({ t: videoTime, chroma: framed.chroma, bass: framed.bass });
    const cutoff = videoTime - this.cfg.windowSeconds;
    while (this.history.length > 1 && this.history[0].t < cutoff) this.history.shift();

    this.evaluate(videoTime);
  }

  /** Media chroma (și a basului) pe fereastră -> candidat -> comitere dacă s-a ținut destul. */
  evaluate(now) {
    const n = this.history.length;
    if (n === 0) return;
    const avg = this.avgBuf.fill(0);
    const avgBass = this.avgBassBuf.fill(0);
    for (const h of this.history) {
      for (let i = 0; i < CHROMA_SIZE; i++) {
        avg[i] += h.chroma[i];
        avgBass[i] += h.bass[i];
      }
    }
    for (let i = 0; i < CHROMA_SIZE; i++) { avg[i] /= n; avgBass[i] /= n; }

    const { label, score } = matchChord(avg, { bass: avgBass });

    if (!this.candidate || this.candidate.label !== label) {
      this.candidate = { label, sinceT: now, score };
      return;
    }
    this.candidate.score = score;

    if (label === this.committed) return;
    if (now - this.candidate.sinceT < this.cfg.minHoldSeconds) return;

    // Momentul REAL al schimbării: fereastra privește în urmă, deci candidatul a început
    // să câștige cu ~jumătate de fereastră mai devreme decât ne-am dat noi seama.
    const onset = Math.max(0, this.candidate.sinceT - this.cfg.windowSeconds / 2);
    if (onset - this.committedAt < this.cfg.minChordSeconds) return; // prea scurt: pâlpâire

    this.committed = label;
    this.committedAt = onset;
    log.debug(`acord: ${label} (scor ${score.toFixed(2)}) @ ${onset.toFixed(1)}s`);
    this.onChord({ t: onset, label, confidence: score });
  }

  resetHistory() {
    this.history = [];
    this.candidate = null;
    this.committed = NO_CHORD;
    this.committedAt = -Infinity;
  }

  flush() { /* netezirea nu ține nimic nepublicat: comiterea se face pe măsură */ }

  dispose() {
    this.resetHistory();
    this.lastT = -Infinity;
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

  const { chroma, bass } = a.frameToChroma(frame);
  const res = matchChord(chroma, { bass });
  const ok = res.label === 'C';
  log.warn(`[POARTA 0] chord=${res.label} (scor ${res.score.toFixed(2)}) — ${ok ? 'CORECT ✔' : 'GREȘIT ✘'}`);
  a.dispose();
  return ok;
}
