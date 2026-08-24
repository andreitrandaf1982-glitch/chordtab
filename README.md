# ChordTab — acorduri de chitară pentru YouTube

Extensie Chrome care ascultă melodia din tabul de YouTube **local, în browserul tău**
(zero servere, zero chei API, zero costuri) și afișează acordurile principale sincronizate
cu redarea — cu diagrame la hover, sugestie de capo și transpoziție.

**Stare:** în lucru — Etapa 1. Planul complet: [docs/PLAN-guitar-chords-extension.md](docs/PLAN-guitar-chords-extension.md)

## Instalare (dezvoltare)

1. Deschide `chrome://extensions`, pornește **Developer mode**.
2. **Load unpacked** → alege folderul `extension/`.
3. Deschide un video pe YouTube și apasă pe iconița extensiei.

## Teste

```bash
node tests/music-theory.test.mjs
```

## Limitări oneste

- Detectează acordurile **principale** (majore/minore, ~75–85% acuratețe pe pop/rock/folk);
  nu transcrie solo-uri sau tabs notă-cu-notă.
- Prima analiză se face în timp ce melodia se redă; rezultatul se salvează per video.
- Upgrade posibil în viitor: analiză de precizie printr-un API plătit (ex. Klangio),
  cu cheia securizată printr-un backend (Supabase Edge Functions) — neinclus în această versiune.
