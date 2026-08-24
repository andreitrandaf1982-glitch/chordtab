# PLAN — ChordTab: acorduri de chitară pentru YouTube (Etapa 1)

> Scris de Fable, 2026-08-24. Executat de Opus, pas cu pas, în ordine.
> Fiecare pas are o **POARTĂ** de verificare — nu treci la pasul următor până nu e bifată.
> **Regula celor două încercări:** dacă un pas eșuează de 2 ori pe același bug → STOP,
> scrii `docs/BUG-<slug>.md` (reproducere + ce s-a încercat + dovezi) și escaladezi pe Fable.
> După fiecare pas încheiat: `git add -A` → `git commit` cu mesaj descriptiv (co-author Claude).

## Obiectiv

Extensie Chrome (Manifest V3) care ascultă audio-ul unui video YouTube **local, în browser**
(zero API, zero chei, zero server) și afișează sub video acordurile principale, sincronizate
cu redarea, cu: diagrame la hover, sugestie de capo și transpoziție. UI în **română**.

Nume de lucru: **ChordTab** (Andrei decide numele final; alternative notate: Acord, SingAlong, CapoZero).

## Ce NU facem în Etapa 1 (nu te abate)

- NU Supabase, NU Klangio, NU niciun API extern. (Klangio = doar o mențiune în README,
  ca posibil upgrade viitor cu cheie plătită — fără buton în aplicație.)
- NU solo-uri / tabs notă-cu-notă.
- NU publicare în Chrome Web Store (comunitatea instalează cu „Load unpacked" / .zip).
- NU framework-uri (React etc.) — vanilla JS, module ES, fără bundler dacă se poate.

## Arhitectura (deja cablată în schelet)

```
click pe iconița extensiei (gest utilizator — obligatoriu pt. tabCapture)
        │
   background.js (service worker)
        │ chrome.tabCapture.getMediaStreamId(targetTabId)
        ▼
   offscreen/offscreen.js  (document offscreen — MV3 nu lasă service workerul să atingă audio)
        │ getUserMedia(chromeMediaSource:'tab') → AudioContext
        │ ├─ sursa → destination (ALTFEL SE MUTEȘTE TABUL — nu șterge legătura asta!)
        │ └─ sursa → analizor (Essentia.js WASM → acorduri cu timestamp)
        ▼
   background.js (releu mesaje) ◄──── content/content.js trimite currentTime la 250ms
        ▼
   content/content.js — panoul de sub video: acord curent, următorul, bandă istorică,
                        transpoziție, capo, diagrame la hover; cache per videoId
```

Structura fișierelor (scheletul există deja; nu redenumi fără motiv):

```
extension/
  manifest.json            — MV3, permisiuni: tabCapture, offscreen, storage, activeTab
  background.js            — ciclu de viață captură + releu de mesaje
  offscreen/offscreen.html — gazda documentului offscreen
  offscreen/offscreen.js   — captura audio + proof-of-life RMS (pasul 2 îl extinde)
  offscreen/analyzer.js    — detecția de acorduri (pasul 0 + 2 + 3)
  content/loader.js        — încărcător minuscul (content scripts nu pot fi module ES)
  content/content.js       — panou UI + sincronizare + cache
  content/panel.css        — stiluri panou
  lib/logger.js            — logging central (GATA — folosește-l în TOATE fișierele)
  lib/music-theory.js      — transpoziție + capo + parsare acorduri (GATA — nu rescrie)
  lib/strings.js           — toate textele UI, în română (nimic hardcodat în alte fișiere)
  options/options.html/.js — comutator debug + golire cache
  vendor/                  — essentia.js vendorizat (pasul 0)
  assets/chords.json       — subset diagrame de acorduri (pasul 7)
tests/music-theory.test.mjs — rulezi cu `node tests/music-theory.test.mjs`
```

Convenție de mesaje (respect-o strict): orice mesaj are `{target: 'background'|'offscreen'|'content', type, ...payload}`.
Tipuri existente: `START_CAPTURE`, `STOP_CAPTURE`, `CT_TIME` (content→offscreen: `{videoId, t, rate}`),
`CHORD_EVENT` (offscreen→content: `{videoId, t, label, confidence}`), `CAPTURE_STATE`.

## Pașii

### Pasul 0 — Spike Essentia.js (fă-l PRIMUL, e riscul nr. 1)
Vendorizează essentia.js în `extension/vendor/` (din pachetul npm `essentia.js`: fișierele
`essentia-wasm.web.js`/`.wasm` + `essentia.js-core.es.js`). Manifest are deja CSP cu
`wasm-unsafe-eval`. În offscreen, încarcă WASM-ul și rulează pe un semnal de test generat
(un acord de Do major sintetizat: sinusuri 261.63 + 329.63 + 392.00 Hz, 2 secunde):
încearcă întâi extractorul `ChordsDetection`; dacă nu e expus în build-ul WASM, folosește
`HPCP` (chroma) — ne ajunge, pasul 2 are plan pentru ambele variante.
**POARTĂ 0:** consola offscreen loghează fie `chord=C` (ChordsDetection), fie un vector
chroma cu vârfuri clare pe C/E/G (HPCP). Notează în plan care variantă a mers.
*Fallback (după 2 încercări eșuate cu Essentia):* renunță la Essentia; calculează chroma
manual — AudioWorklet strânge cadre de 8192 eșantioane (hop 4096) la 44.1kHz, FFT
(vendorizează o bibliotecă mică de FFT, ex. `fft.js`), mapare bin→clasă de înălțime
(12 clase, însumare pe octavele 2–6) → același contract de ieșire: vector chroma de 12.

> **REZULTAT PASUL 0 (executat 2026-08-24, Opus) — POARTA 0 TRECUTĂ, fallback-ul NU e necesar.**
> - **Varianta care a mers: `ChordsDetection`** (nu potrivirea manuală pe șabloane).
>   Lanț: `Windowing(hann) → Spectrum → SpectralPeaks → HPCP → ChordsDetection`.
>   Scor: **8/8** acorduri sintetizate corect (C G D A Am Em Dm F), la **44100 ȘI 48000 Hz**.
> - **Capcană descoperită — convenția HPCP: indexul 0 = A (referință 440 Hz), NU C.**
>   Confirmat empiric (offset 9 → 8/8; offset 0 → 0/8). `ChordsDetection` știe singur
>   convenția; offsetul contează doar dacă cineva citește vectorul chroma direct.
> - **Parametrii HPCP = exact valorile implicite Essentia**, cu excepția `sampleRate`
>   (AudioContext-ul rulează des la 48000). **NU pune `maxShifted=true`** — rotește vectorul
>   la maxim și strică detecția. Testul `tests/chord-detection.test.mjs` blochează parametrii
>   (verifică sursa lui `analyzer.js` și cade dacă îi schimbă cineva).
> - **Cost: 0,29 ms/cadru** față de 42,7 ms disponibile la hop 2048@48kHz → **~0,7% CPU**.
>   Timpul real e trivial de atins; nu e nevoie de rărirea cadrelor.
> - **Build vendorizat: `essentia-wasm.es.js`** (2,44 MB) — încorporează WASM-ul ca base64,
>   deci **fără fetch și fără `locateFile`**, exact ce trebuie sub CSP-ul MV3. NU folosi
>   `essentia-wasm.web.js`: are nevoie de `document.currentScript.src`, care e `null` în
>   module ES. (Build-ul `.es.js` nu merge în Node — `__dirname`; în teste folosim UMD.)
> - **Curățenia memoriei e sigură:** `push_back` copiază, deci `delete()` imediat după e ok
>   (verificat pe 200 de iterații, zero rezultate corupte).
> - ⚠️ **Licență: essentia.js e AGPL-3.0** (copyleft puternic). Extensia trebuie livrată tot
>   sub AGPL-3.0, cu sursa disponibilă. E în regulă pentru scopul lui Andrei (open-source,
>   comunitate, învățare), dar **exclude o variantă comercială cu sursă închisă**.
>   `LICENSE` (AGPL-3.0) e la rădăcină; `extension/vendor/LICENSE-essentia.txt` însoțește codul.

### Pasul 1 — Scheletul rulează
`chrome://extensions` → Developer mode → Load unpacked pe folderul `extension/`.
**POARTĂ 1:** extensia se încarcă fără erori; pe un video YouTube, click pe iconiță →
consola offscreen loghează RMS-ul la fiecare secundă, **audio-ul se aude în continuare**,
iar panoul apare sub video cu starea „Ascult…". Al doilea click oprește captura.

### Pasul 2 — Detecția în timp real
În `analyzer.js`: cadrele audio → chroma la ~4 cadre/s → potrivire pe șabloane
(24 de șabloane: 12 majore, 12 minore; similaritate cosinus; sub prag 0.6 → `N.C.`)
sau direct ChordsDetection, după ce a mers la pasul 0. Fiecare detecție primește
timestamp-ul video interpolat din ultimul `CT_TIME` (t + timpul scurs de la primire,
înmulțit cu `rate`). Trimite `CHORD_EVENT` doar când acordul se schimbă.
Ignoră perioadele de reclamă: content.js detectează clasa `ad-showing` pe
`.html5-video-player` și oprește trimiterea `CT_TIME` (analizorul, fără ceas, aruncă cadrele).
**POARTĂ 2:** pe „Knockin' on Heaven's Door" (Bob Dylan) consola content loghează o
secvență dominată de G, D, Am, C, în ordinea asta ciclică.

### Pasul 3 — Netezire
Fereastră mediană peste ultimele 3–5 detecții; durată minimă de acord 0.8s (schimbările
mai scurte se ignoră); acordurile identice consecutive se contopesc. Păstrează și scorul.
**POARTĂ 3:** pe 2 melodii de test („Knockin' on Heaven's Door" — G D Am C; „Stand by Me"
— A F#m D E), ≥70% din timpul melodiei afișează acordul corect (verificare manuală prin
sondaj în 10 puncte ale melodiei, contra acordurilor cunoscute).

### Pasul 4 — Panoul UI
Panoul (deja injectat ca stub) afișează: acordul curent (mare), acordul următor (dacă e
în cache), banda ultimelor ~8 acorduri, buton pornire/oprire, stare. Injectare: la începutul
lui `#below` (pagina de watch); dacă selectorul dispare (YouTube schimbă DOM-ul), fallback
la overlay fix jos-dreapta — logică deja schițată în content.js, n-o simplifica.
Navigarea YouTube e SPA: ascultă `yt-navigate-finish`, resetează panoul și videoId-ul.
**POARTĂ 4:** vizual, acordul afișat se schimbă în ±0.5s față de schimbarea reală din
melodie; navigarea la alt video resetează curat panoul.

### Pasul 5 — Cache per video
La `STOP_CAPTURE` sau la finalul videoului, salvează în `chrome.storage.local` sub cheia
`chords:<videoId>`: `{version:1, analyzedAt, key, chords:[{t,label,confidence}]}`.
La deschiderea unui video cu cache: panoul intră în „mod redare" — NU mai cere captură,
urmărește `video.currentTime` prin binary search în listă și afișează acordul curent + următorul.
**POARTĂ 5:** refresh pe un video analizat → acordurile apar instant, sincronizate, fără
click pe iconiță; poarta 4 rămâne valabilă în modul redare.

### Pasul 6 — Capo + transpoziție
Folosește `lib/music-theory.js` (gata scris, cu teste): după analiză, calculează
`bestCapo()` din histograma acordurilor și afișează sugestia („Capo 3 → cânți Am, F, C, G").
Butoane ±1 semiton pentru transpoziție manuală; comutator „am capo / n-am capo".
Tot ce se afișează (banda, acordul curent, diagramele) respectă transpoziția activă.
**POARTĂ 6:** `node tests/music-theory.test.mjs` trece; manual: pe o melodie cunoscută cu
capo (ex. „Wonderwall" — capo 2), sugestia de capo produce forme deschise rezonabile.

### Pasul 7 — Diagrame la hover
Vendorizează un subset din baza open-source `tombatossals/chords-db` (licență MIT) în
`assets/chords.json`: toate cele 24 maj/min + variantele 7, m7, maj7, sus2, sus4 uzuale.
Desenează diagrama ca SVG (6 corzi × 4-5 poziții, puncte pe degete, corzi libere/mute, barré).
Tooltip la hover/click pe orice acord afișat; acord fără diagramă → tooltip cu text simplu
(„diagramă indisponibilă"), fără eroare.
**POARTĂ 7:** hover pe fiecare din: C, G, D, A, E, Am, Em, Dm, F, Bm, F#m, E7, Am7, Cmaj7,
Dsus4 → diagramă corectă (verifică 3 dintre ele contra unei surse externe).

### Pasul 8 — Options + trecere de logging
Pagina de opțiuni: comutator „Debug logging" + buton „Golește cache-ul de acorduri".
Trecere finală: TOATE fișierele folosesc `lib/logger.js` (nimic `console.log` direct);
debug OFF → consolă tăcută (doar warn/error); debug ON → traseu complet al fluxului.
**POARTĂ 8:** demonstrația de mai sus, verificată în consolă pe ambele stări.

### Pasul 9 — Ambalare pentru comunitate
README.md în română: ce face, capturi de ecran, instalare pas cu pas (Load unpacked),
limitări oneste (acuratețe ~75-85%, doar acorduri principale), mențiunea Klangio ca
upgrade viitor. Test final pe un profil Chrome curat.
**POARTĂ 9:** o persoană care urmează DOAR README-ul ajunge la acorduri pe ecran.

## Riscuri cunoscute și ce faci cu ele

1. **Tabul se mutează la captură** → e normal; legătura `sursă→destination` din offscreen
   rezolvă. Dacă auzi liniște, acolo s-a rupt ceva, nu în YouTube.
2. **Essentia nu merge în WASM/MV3** → fallback-ul concret e în pasul 0. Nu improviza altul.
3. **YouTube își schimbă DOM-ul** → injectarea are fallback overlay; nu depinde de clase
   obscure, doar de `#below` + `.html5-video-player` + elementul `<video>`.
4. **Viteza de redare ≠ 1x** → timestamp-urile folosesc `currentTime`, deci sincronizarea
   rămâne corectă; doar calitatea detecției scade la 2x — acceptat, notează în README.
5. **Reclame** → tratate în pasul 2 (fără `CT_TIME` în timpul reclamei).
6. **Live-uri / premiere** → în afara scopului; content.js afișează „indisponibil pe live".

## Etapa 2 (DOAR după livrarea Etapei 1 — nu începe fără decizie explicită de la Andrei)

Supabase (cont nou, gratuit): cache comun per videoId între utilizatori + Edge Function
ca proxy cu cheia în secrets, dacă se decide vreodată un API plătit (ex. Klangio).
