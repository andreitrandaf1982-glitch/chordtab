// AudioWorkletProcessor: strânge eșantioanele în cadre suprapuse și le trimite pe port.
// Rulează în scope-ul audio (fără chrome.*, fără import-uri) — ține-l minimal.
// Contract: postMessage(Float32Array de FRAME_SIZE) la fiecare HOP_SIZE eșantioane noi.

const FRAME_SIZE = 4096;
const HOP_SIZE = 2048;

class FrameProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(FRAME_SIZE);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // Mixaj mono: media canalelor disponibile.
    const chans = input.length;
    const n = input[0].length;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let c = 0; c < chans; c++) s += input[c][i];
      this.buf[this.filled++] = s / chans;

      if (this.filled === FRAME_SIZE) {
        this.port.postMessage(this.buf.slice());
        // Suprapunere: păstrăm ultimele FRAME_SIZE - HOP_SIZE eșantioane.
        this.buf.copyWithin(0, HOP_SIZE);
        this.filled = FRAME_SIZE - HOP_SIZE;
      }
    }
    return true;
  }
}

registerProcessor('chordtab-frame-processor', FrameProcessor);
