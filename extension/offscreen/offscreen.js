// Documentul offscreen: singurul loc din MV3 unde putem prelua audio-ul tabului.
// Primește streamId de la background, capturează, ține ceasul video (CT_TIME) și
// va alimenta analizorul de acorduri (Pasul 2). Deocamdată: proof-of-life RMS (Poarta 1).

import { createLogger } from '../lib/logger.js';
// import { Analyzer } from './analyzer.js'; // TODO(Pasul 2): activează și cablează

const log = createLogger('offscreen');

let media = null; // { stream, ctx, source, analyserNode, rmsInterval }
let clock = null; // { videoId, t, rate, receivedAt } — ultimul CT_TIME primit

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== 'offscreen') return;
  if (msg.type === 'START_CAPTURE') start(msg).catch((err) => log.error('Captura a eșuat:', err));
  if (msg.type === 'STOP_CAPTURE') stop();
  if (msg.type === 'CT_TIME') clock = { videoId: msg.videoId, t: msg.t, rate: msg.rate, receivedAt: performance.now() };
});

async function start({ streamId }) {
  stop();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);

  // NU șterge legătura asta: fără ea, captura mutează tabul și utilizatorul nu mai aude nimic.
  source.connect(ctx.destination);

  const analyserNode = ctx.createAnalyser();
  analyserNode.fftSize = 2048;
  source.connect(analyserNode);

  // Proof-of-life pentru Poarta 1. Pasul 2 înlocuiește cu AudioWorklet -> Analyzer.
  const buf = new Float32Array(analyserNode.fftSize);
  const rmsInterval = setInterval(() => {
    analyserNode.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    log.info(`RMS=${rms.toFixed(4)} @video t=${videoTimeNow().toFixed(1)}s`);
  }, 1000);

  media = { stream, ctx, source, analyserNode, rmsInterval };
  log.info('Captura audio a pornit.');

  // TODO(Pasul 2): const analyzer = new Analyzer({ onChord: sendChordEvent });
  //                AudioWorklet care împinge cadre Float32 în analyzer.push(frame, videoTimeNow())
}

function stop() {
  if (!media) return;
  clearInterval(media.rmsInterval);
  media.stream.getTracks().forEach((t) => t.stop());
  media.ctx.close().catch(() => {});
  media = null;
  clock = null;
  log.info('Captura audio s-a oprit.');
}

// Timpul curent al videoclipului, interpolat din ultimul CT_TIME. -1 = ceas absent (ex. reclamă).
function videoTimeNow() {
  if (!clock) return -1;
  const elapsed = (performance.now() - clock.receivedAt) / 1000;
  return clock.t + elapsed * (clock.rate || 1);
}

// eslint-disable-next-line no-unused-vars
function sendChordEvent({ t, label, confidence }) {
  if (!clock) return;
  chrome.runtime.sendMessage({
    target: 'content',
    type: 'CHORD_EVENT',
    videoId: clock.videoId,
    t, label, confidence,
  }).catch(() => {});
}
