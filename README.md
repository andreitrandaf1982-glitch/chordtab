# ChordTab — acorduri de chitară pentru YouTube

Extensie Chrome care ascultă melodia din tabul de YouTube **local, în browserul tău**
(zero servere, zero chei API, zero costuri) și afișează acordurile principale sincronizate
cu redarea — cu diagrame la hover, sugestie de capo și transpoziție.

**Stare:** Etapa 1, Pașii 0–7 încheiați. Mai rămâne ambalarea (Pasul 9).
Planul complet: [docs/PLAN-guitar-chords-extension.md](docs/PLAN-guitar-chords-extension.md) ·
Ce e de verificat acum: [docs/VERIFICARE.md](docs/VERIFICARE.md)

![Panoul ChordTab sub video](docs/capturi/panou.png)

Acordul curent, diagrama lui pe corzi și ce urmează — sincronizat cu melodia.

![Sugestie de capo](docs/capturi/panou-capo.png)

Când melodia are capo, îți spune unde să-l pui ca să cânți forme deschise: „Wonderwall" sună
F#m A E B, dar cu capo 2 cânți Em G D A. Bara verde din diagramă e capodastrul.

## Instalare (dezvoltare)

1. Deschide `chrome://extensions`, pornește **Developer mode**.
2. **Load unpacked** → alege folderul `extension/`.
3. Deschide un video pe YouTube și apasă pe iconița extensiei.

Verificarea pas cu pas, în română: [docs/VERIFICARE.md](docs/VERIFICARE.md)

## Teste

```bash
npm install
npx playwright install chromium   # o singură dată, pentru testul din browser
npm test
```

| Test | Ce verifică |
|---|---|
| `tests/music-theory.test.mjs` | transpoziție, parsare de acorduri, calculul capo-ului |
| `tests/chord-detection.test.mjs` | lanțul FFT → chroma → acord, pe acorduri sintetizate, la 44100 și 48000 Hz |
| `tests/progression.test.mjs` | urmărirea schimbărilor de acord în timp, pe o progresie |
| `tests/stability.test.mjs` | acuratețe și stabilitate pe semnal ostil (melodie + percuție) |
| `tests/diagrams.test.mjs` | fiecare digitație, verificată **muzical**: ce note ies din corzi |
| `tests/browser-selftest.mjs` | extensia încărcată într-un Chromium real, sub CSP-ul MV3 |
| `tests/ui.test.mjs` | panoul, memoria, capo, transpoziția și diagramele — în browser real |

`npm run test:unit` sare peste testul din browser dacă nu vrei să aștepți.

## Cum funcționează

Sunetul tabului e preluat cu `chrome.tabCapture` și analizat într-un document offscreen:

```
cadru audio → FFT → vârfuri spectrale (interpolate) → chroma (12 clase) → netezire → acord
```

Netezirea e partea care face rezultatul citibil: un cadru durează 170 ms, adică o clipă, nu un
acord — judecat singur, urmărește ce se aude mai tare atunci. Mediem chroma pe ~1,2 s, cerem
unui acord nou să se țină ~0,45 s înainte să-l afișăm, și folosim **nota de bas** ca să stabilim
fundamentala (altfel un Sol cu un Fa# trecător se confundă cu un Si minor).
Măsurat pe semnal ostil: **28% → 97% acuratețe, 51 → 4 schimbări**.

Totul e cod propriu, fără biblioteci externe și fără WebAssembly. Nimic nu părăsește browserul.

> Prima variantă folosea [essentia.js](https://github.com/MTG/essentia.js). Trecea toate testele
> în Node, dar nu poate rula într-o extensie Manifest V3 — povestea completă e în
> [docs/BUG-essentia-mv3-csp.md](docs/BUG-essentia-mv3-csp.md). Merită citită dacă te
> interesează de ce un test verde nu înseamnă întotdeauna cod care merge.

## Ce face, pe scurt

- **Acordurile sincronizate** cu melodia, sub video, cu ce urmează la vedere.
- **Diagrama pe corzi** a acordului curent, mereu vizibilă; hover pe unul care urmează ți-o arată
  pe a lui.
- **Capo**: îți spune pe ce poziție să-l pui ca să cânți forme deschise, și îți arată formele.
- **Transpoziție** ±6 semitonuri, dacă vrei să cânți în altă tonalitate.
- **Memorie per melodie**: a doua oară acordurile apar instant și perfect sincronizate.

## Limitări oneste

- Detectează acordurile **principale** (majore și minore); nu transcrie solo-uri sau tabs
  notă-cu-notă. Acuratețea scade pe mixuri foarte dense.
- Prima analiză se face în timp ce melodia se redă; rezultatul se salvează per video.
- La viteze de redare diferite de 1x sincronizarea rămâne corectă, dar calitatea detecției scade.
- Upgrade posibil în viitor: analiză de precizie printr-un API plătit (ex. Klangio),
  cu cheia securizată printr-un backend (Supabase Edge Functions) — neinclus în această versiune.

## Licență

[MIT](LICENSE).
