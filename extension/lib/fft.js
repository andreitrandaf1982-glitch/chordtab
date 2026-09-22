// FFT radix-2 (Cooley-Tukey iterativ, in-place) — cod propriu, fără dependențe.
// A înlocuit Essentia.js, care nu poate rula sub CSP-ul MV3 (vezi docs/BUG-essentia-mv3-csp.md).
// Pur: fără chrome.*, testabil direct în Node.

export class FFT {
  /** @param {number} size putere a lui 2 */
  constructor(size) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT: dimensiunea trebuie să fie putere a lui 2, am primit ${size}`);
    }
    this.size = size;
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);

    // Inversarea biților: indicele i își schimbă locul cu oglinditul lui pe log2(size) biți.
    const bits = Math.log2(size);
    this.rev = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }

    // Twiddle factors, precalculate o singură dată.
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size);
    }

    this.window = new Float64Array(size); // Hann
    for (let i = 0; i < size; i++) this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }

  /**
   * Spectrul de magnitudini al unui semnal real, cu fereastră Hann aplicată.
   * @param {Float32Array|Float64Array} signal exact `size` eșantioane
   * @param {Float64Array} [out] tampon de size/2+1 valori, reutilizabil
   * @returns {Float64Array} magnitudini pentru binurile 0..size/2
   */
  magnitudeSpectrum(signal, out) {
    const n = this.size;
    if (signal.length !== n) throw new Error(`FFT: aștept ${n} eșantioane, am primit ${signal.length}`);
    const { re, im, rev, cos, sin, window } = this;

    for (let i = 0; i < n; i++) {
      re[rev[i]] = signal[i] * window[i];
      im[rev[i]] = 0;
    }

    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const c = cos[k], s = sin[k];
          const a = i + j, b = a + half;
          const tre = re[b] * c - im[b] * s;
          const tim = re[b] * s + im[b] * c;
          re[b] = re[a] - tre;
          im[b] = im[a] - tim;
          re[a] += tre;
          im[a] += tim;
        }
      }
    }

    const bins = n / 2 + 1;
    const mag = out && out.length === bins ? out : new Float64Array(bins);
    for (let i = 0; i < bins; i++) mag[i] = Math.hypot(re[i], im[i]);
    return mag;
  }
}
