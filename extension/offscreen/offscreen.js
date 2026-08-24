// Documentul offscreen: singurul loc din MV3 unde putem prelua audio-ul tabului.
// Primește streamId de la background, capturează, ține ceasul video (CT_TIME) și
// alimentează analizorul de acorduri.

import { createLogger } from '../lib/logger.js';
import { Analyzer, selfTest } from './analyzer.js';

const log = createLogger('offscreen');

let media = null;   // { stream, ctx, source, worklet, analyserNode, rmsInterval }
let analyzer = null;
let clock = null;   // { videoId, t, rate, receivedAt } — ultimul CT_TIME primit

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== 'offscreen') return;
  if (msg.type === 'START_CAPTURE') start(msg).catch((err) => log.error('Captura a eșuat:', err?.message || err));
  if (msg.type === 'STOP_CAPTURE') stop();
  if (msg.type === 'CT_TIME') clock = { videoId: msg.videoId, t: msg.t, rate: msg.rate, receivedAt: performance.now() };
});

// Scriptul e modul ES, deci se încarcă ASINCRON după createDocument(): fără semnalul ăsta,
// background-ul poate trimite START_CAPTURE înainte ca ascultătorul de mai sus să existe.
chrome.runtime.sendMessage({ target: 'background', type: 'OFFSCREEN_READY' }).catch(() => {});

// POARTA 0: dovada în browser că lanțul WASM merge (acord C sintetizat -> „C”).
// Rezultatul e pus și pe window, ca tests/browser-selftest.mjs să-l poată citi automat.
selfTest()
  .then((ok) => { window.__chordtabGate = { ok }; })
  .catch((err) => {
    log.error('[POARTA 0] Auto-testul Essentia a eșuat:', err?.message || err);
    window.__chordtabGate = { ok: false, error: String(err?.message || err) };
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

  // Analizorul de acorduri, alimentat de AudioWorklet.
  analyzer = new Analyzer({ sampleRate: ctx.sampleRate, onChord: sendChordEvent });
  await analyzer.init();
  await ctx.audioWorklet.addModule(chrome.runtime.getURL('offscreen/frame-processor.js'));
  const worklet = new AudioWorkletNode(ctx, 'chordtab-frame-processor');
  worklet.port.onmessage = (e) => analyzer?.push(e.data, videoTimeNow());
  source.connect(worklet);
  // Worklet-ul nu produce sunet, dar unele versiuni de Chrome nu-l rulează nelegat.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  worklet.connect(mute).connect(ctx.destination);

  // POARTA 1: dovada că preluarea audio funcționează, independent de detecția de acorduri.
  const analyserNode = ctx.createAnalyser();
  analyserNode.fftSize = 2048;
  source.connect(analyserNode);
  const buf = new Float32Array(analyserNode.fftSize);
  const rmsInterval = setInterval(() => {
    analyserNode.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    log.info(`[POARTA 1] RMS=${Math.sqrt(sum / buf.length).toFixed(4)} @video t=${videoTimeNow().toFixed(1)}s`);
  }, 1000);

  media = { stream, ctx, source, worklet, analyserNode, rmsInterval };
  log.info(`Captura audio a pornit. sampleRate=${ctx.sampleRate}`);
}

function stop() {
  if (!media) return;
  clearInterval(media.rmsInterval);
  try { media.worklet.port.onmessage = null; media.worklet.disconnect(); } catch { /* deja oprit */ }
  media.stream.getTracks().forEach((t) => t.stop());
  media.ctx.close().catch(() => {});
  media = null;
  if (analyzer) { analyzer.flush(); analyzer.dispose(); analyzer = null; }
  clock = null;
  log.info('Captura audio s-a oprit.');
}

// Timpul curent al videoclipului, interpolat din ultimul CT_TIME. -1 = ceas absent (ex. reclamă).
function videoTimeNow() {
  if (!clock) return -1;
  return clock.t + ((performance.now() - clock.receivedAt) / 1000) * (clock.rate || 1);
}

function sendChordEvent({ t, label, confidence }) {
  if (!clock) return;
  chrome.runtime.sendMessage({
    target: 'content',
    type: 'CHORD_EVENT',
    videoId: clock.videoId,
    t, label, confidence,
  }).catch(() => {});
}
