// Analizorul de acorduri. CONTRACT (nu-l schimba fără să actualizezi offscreen.js):
//   const a = new Analyzer({ onChord: ({ t, label, confidence }) => {} });
//   a.push(frameFloat32, videoTime)  — cadru audio mono 44.1kHz + timpul video la care începe
//   a.flush()                        — la STOP_CAPTURE: emite ce a rămas în buffer
//
// label: notație cu diezi ('Am', 'F#', 'N.C.'). confidence: 0..1.
// Emite CHORD_EVENT DOAR când acordul se schimbă (după netezire — Pasul 3).

import { createLogger } from '../lib/logger.js';
import { NO_CHORD } from '../lib/music-theory.js';

const log = createLogger('analyzer');

export class Analyzer {
  constructor({ onChord }) {
    this.onChord = onChord;
    this.lastLabel = NO_CHORD;
    // TODO(Pasul 0): încarcă Essentia.js din ../vendor/ și verifică ChordsDetection / HPCP
    //                pe semnalul de test din plan (acord C sintetizat). Notează în plan varianta.
    // TODO(Pasul 2): chroma la ~4 cadre/s -> potrivire pe 24 șabloane maj/min (cosinus, prag 0.6 -> N.C.)
    // TODO(Pasul 3): fereastră mediană 3-5 + durată minimă 0.8s + contopire repetiții
    log.debug('Analyzer instanțiat (schelet).');
  }

  push(frame, videoTime) {
    // TODO(Pasul 2)
  }

  flush() {
    // TODO(Pasul 2)
  }
}
