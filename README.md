# ChordTab — acorduri de chitară pentru YouTube

Extensie Chrome care ascultă melodia din tabul de YouTube **local, în browserul tău**
(zero servere, zero chei API, zero costuri) și afișează acordurile principale sincronizate
cu redarea — cu diagrame la hover, sugestie de capo și transpoziție.

**Stare:** în lucru — Etapa 1, Pasul 0 încheiat (motorul de detecție validat).
Planul complet: [docs/PLAN-guitar-chords-extension.md](docs/PLAN-guitar-chords-extension.md)

## Instalare (dezvoltare)

1. Deschide `chrome://extensions`, pornește **Developer mode**.
2. **Load unpacked** → alege folderul `extension/`.
3. Deschide un video pe YouTube și apasă pe iconița extensiei.

## Teste

```bash
npm install     # o singură dată (aduce essentia.js pentru teste)
npm test
```

`tests/music-theory.test.mjs` — transpoziție, parsare de acorduri, calculul capo-ului.
`tests/chord-detection.test.mjs` — lanțul de detecție pe acorduri sintetizate, la 44100 și 48000 Hz.

## Cum funcționează

Sunetul tabului e preluat cu `chrome.tabCapture` și analizat într-un document offscreen:
`Windowing → Spectrum → SpectralPeaks → HPCP → ChordsDetection` (Essentia.js, WebAssembly).
Nimic nu părăsește browserul.

## Limitări oneste

- Detectează acordurile **principale** (majore/minore); nu transcrie solo-uri sau tabs
  notă-cu-notă. Acuratețea scade pe mixuri foarte dense.
- Prima analiză se face în timp ce melodia se redă; rezultatul se salvează per video.
- La viteze de redare diferite de 1x sincronizarea rămâne corectă, dar calitatea detecției scade.
- Upgrade posibil în viitor: analiză de precizie printr-un API plătit (ex. Klangio),
  cu cheia securizată printr-un backend (Supabase Edge Functions) — neinclus în această versiune.

## Licență

**AGPL-3.0** — impusă de [essentia.js](https://github.com/MTG/essentia.js) (Music Technology
Group, Universitat Pompeu Fabra), motorul de analiză audio. Codul extensiei e deci open-source
și trebuie să rămână așa; vezi [LICENSE](LICENSE).
