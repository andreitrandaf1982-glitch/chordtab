// Chroma (profil de clase de înălțime) din spectru — cod propriu, pur, testabil în Node.
//
// Ideea: un acord e definit de CARE note sună, nu de în ce octavă. Deci strângem energia
// spectrului în 12 „coșuri”, câte unul pentru fiecare notă (Do, Do#, Re, …), indiferent de octavă.
//
// Lucrăm pe VÂRFURI spectrale, nu pe binuri brute: un vârf interpolat parabolic dă frecvența
// mult mai precis decât lățimea unui bin, ceea ce contează la notele joase, unde semitonurile
// sunt mai apropiate decât rezoluția FFT-ului.
//
// Convenție: indexul 0 = C (Do). (Essentia folosea 0 = A — de-aia ne-a surprins la Pasul 0.)

export const CHROMA_SIZE = 12;

const DEFAULTS = {
  minFreq: 55,        // sub La1 nu mai avem rezoluție utilă
  maxFreq: 3500,      // peste asta e mai mult zgomot decât informație armonică
  maxPeaks: 80,
  peakThreshold: 0.005, // raportat la vârful cel mai mare din cadru
  harmonics: 4,         // câte armonice considerăm pentru fiecare vârf
  harmonicDecay: 0.6,   // cât de mult slăbește contribuția fiecărei armonice
  windowSemitones: 1.0, // lățimea ferestrei cos² în jurul unei clase de înălțime
};

/**
 * Vârfurile spectrale, cu frecvență interpolată parabolic.
 * @param {Float64Array} mag magnitudini (binuri 0..fftSize/2)
 * @param {number} sampleRate
 * @param {number} fftSize
 * @returns {{freq:number, mag:number}[]} sortate descrescător după magnitudine
 */
export function spectralPeaks(mag, sampleRate, fftSize, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const binHz = sampleRate / fftSize;
  const minBin = Math.max(1, Math.floor(o.minFreq / binHz));
  const maxBin = Math.min(mag.length - 2, Math.ceil(o.maxFreq / binHz));

  let peak = 0;
  for (let i = minBin; i <= maxBin; i++) if (mag[i] > peak) peak = mag[i];
  if (peak <= 0) return [];
  const floor = peak * o.peakThreshold;

  const peaks = [];
  for (let i = minBin; i <= maxBin; i++) {
    const y1 = mag[i];
    if (y1 < floor || y1 <= mag[i - 1] || y1 <= mag[i + 1]) continue;
    const y0 = mag[i - 1], y2 = mag[i + 1];
    const denom = y0 - 2 * y1 + y2;
    // Interpolare parabolică: vârful real cade între binuri, nu exact pe unul.
    const delta = denom === 0 ? 0 : (0.5 * (y0 - y2)) / denom;
    peaks.push({ freq: (i + delta) * binHz, mag: y1 - 0.25 * (y0 - y2) * delta });
  }

  peaks.sort((a, b) => b.mag - a.mag);
  return peaks.slice(0, o.maxPeaks);
}

/**
 * Vârfuri -> vector chroma de 12 valori, normalizat la maxim 1. Index 0 = C.
 * @param {{freq:number, mag:number}[]} peaks
 * @param {Float64Array} [out] tampon reutilizabil de 12
 */
export function chromaFromPeaks(peaks, opts = {}, out) {
  const o = { ...DEFAULTS, ...opts };
  const chroma = out && out.length === CHROMA_SIZE ? out.fill(0) : new Float64Array(CHROMA_SIZE);
  const half = o.windowSemitones / 2;

  for (const p of peaks) {
    // Energia (magnitudinea la pătrat) contează mai mult decât amplitudinea brută.
    const energy = p.mag * p.mag;
    for (let h = 1; h <= o.harmonics; h++) {
      // Vârful ăsta ar putea fi armonica h a unui fundamental f/h.
      const f = p.freq / h;
      if (f < o.minFreq) break;
      const w = energy * Math.pow(o.harmonicDecay, h - 1);

      // Poziția continuă pe scara de 12 clase (MIDI 60 = C4, iar 60 % 12 = 0 => index 0 = C).
      const midi = 69 + 12 * Math.log2(f / 440);
      const pc = ((midi % 12) + 12) % 12;

      for (let b = 0; b < CHROMA_SIZE; b++) {
        let d = Math.abs(pc - b);
        if (d > 6) d = 12 - d; // distanță circulară
        if (d >= half) continue;
        const win = Math.cos((Math.PI / 2) * (d / half));
        chroma[b] += w * win * win;
      }
    }
  }

  let max = 0;
  for (let i = 0; i < CHROMA_SIZE; i++) if (chroma[i] > max) max = chroma[i];
  if (max > 0) for (let i = 0; i < CHROMA_SIZE; i++) chroma[i] /= max;
  return chroma;
}
