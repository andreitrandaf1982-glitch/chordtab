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
  offscreen/frame-processor.js — AudioWorklet: cadre suprapuse 8192/4096 (pasul 0)
  lib/logger.js            — logging central (GATA — folosește-l în TOATE fișierele)
  lib/music-theory.js      — transpoziție + capo + parsare acorduri (GATA — nu rescrie)
  lib/fft.js               — FFT radix-2 + fereastră Hann (GATA, testat)
  lib/chroma.js            — vârfuri spectrale -> 12 clase de înălțime (GATA, testat)
  lib/chords.js            — 24 șabloane maj/min + similaritate cosinus (GATA, testat)
  lib/strings.js           — toate textele UI, în română (nimic hardcodat în alte fișiere)
  icons/                   — iconițe generate (16/32/48/128)
  options/options.html/.js — comutator debug + golire cache
  assets/chords.json       — subset diagrame de acorduri (pasul 7)
tests/music-theory.test.mjs   — teorie muzicală
tests/chord-detection.test.mjs — lanțul de detecție (FFT -> chroma -> acord)
tests/browser-selftest.mjs     — extensia într-un Chromium real, sub CSP-ul MV3
   `npm test` le rulează pe toate trei.
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

> **REZULTAT PASUL 0 (executat 2026-08-24, Opus) — POARTA 0 TRECUTĂ, PE FALLBACK.**
>
> **Essentia.js a fost încercată și abandonată.** Merge impecabil în Node (8/8 acorduri), dar
> **nu poate rula într-o extensie MV3**: glue-ul emscripten/embind își construiește funcțiile
> de legătură cu C++ ca text și le evaluează, ceea ce CSP-ul extensiilor interzice. Două
> încercări (vendorizare simplă, apoi peticirea locurilor care evaluează text) au eșuat;
> mecanismul e central în embind, nu se poate ocoli cu un petic. Raport complet, cu stack
> trace și ce s-a mai luat în calcul: **`docs/BUG-essentia-mv3-csp.md`**.
>
> **Lecția de metodă:** testele Node treceau, browserul cădea. De aici a apărut
> `tests/browser-selftest.mjs` — încarcă extensia într-un Chromium real și verifică sub CSP-ul
> autentic. Rulează-l după fiecare pas; Node nu poate dovedi că ceva merge într-o extensie.
>
> **Varianta livrată: lanțul propriu prevăzut ca fallback**, în trei module pure și testabile:
> `lib/fft.js` (FFT radix-2 + fereastră Hann) → `lib/chroma.js` (vârfuri spectrale cu
> interpolare parabolică → 12 clase de înălțime) → `lib/chords.js` (24 de șabloane maj/min,
> similaritate cosinus, prag 0,6 → `N.C.`).
> - **Scor: 8/8** acorduri (C G D A Am Em Dm F), la **44100 ȘI 48000 Hz** — egal cu Essentia.
>   În plus, liniștea și zgomotul alb dau corect `N.C.`, nu un acord inventat.
> - **Cadru 8192, hop 4096** (ca în fallback-ul din plan). Constantele sunt duplicate în
>   `frame-processor.js` (worklet-ul nu poate importa module) — **un test verifică sincronizarea**.
> - **Convenție chroma: indexul 0 = C.** (Essentia folosea 0 = A — de-aia ne-a surprins.)
> - Vârfurile sunt interpolate parabolic: frecvența iese mult mai precisă decât lățimea unui
>   bin, ceea ce contează la notele joase, unde semitonurile sunt mai apropiate decât rezoluția.
>
> **Câștiguri colaterale față de planul inițial:**
> - **Licența e acum MIT**, nu AGPL-3.0 — Essentia impunea copyleft puternic. Extensia poate fi
>   folosită și dezvoltată liber.
> - **Minus 2,44 MB** de cod străin; extensia nu mai are deloc WebAssembly.
> - CSP-ul a fost strâns la `script-src 'self'` — `wasm-unsafe-eval` nu mai e necesar.
> - Codul e de înțeles cap-coadă, ceea ce contează: scopul proiectului e învățarea.

### Pasul 1 — Scheletul rulează
`chrome://extensions` → Developer mode → Load unpacked pe folderul `extension/`.
**POARTĂ 1:** extensia se încarcă fără erori; pe un video YouTube, click pe iconiță →
consola offscreen loghează RMS-ul la fiecare secundă, **audio-ul se aude în continuare**,
iar panoul apare sub video cu starea „Ascult…". Al doilea click oprește captura.

### Pasul 2 — Detecția în timp real
*(Implementat deja la Pasul 0, odată cu trecerea pe lanțul propriu — rămâne de verificat
în browser pe muzică reală.)* În `analyzer.js`: cadrele audio → chroma → potrivire pe șabloane
(24 de șabloane: 12 majore, 12 minore; similaritate cosinus; sub prag 0.6 → `N.C.`).
Fiecare detecție primește
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

> **REZULTAT PASUL 3 (2026-08-24, Opus) — implementat, verificat sintetic; Poarta 3 așteaptă
> verificarea pe muzică reală.**
>
> Declanșator: la Poarta 2, Andrei a raportat că acordurile „se schimbă la fiecare sunet” și
> „urmăresc linia melodică, nu acordul”. `tests/stability.test.mjs` reproduce exact asta —
> progresie + melodie mai tare decât acordul, cu note din afara lui + percuție — și a măsurat
> problema: **28,4% acuratețe, 51 de schimbări în 16s**.
>
> Netezirea are trei niveluri, nu unul:
> 1. **medierea chroma pe ~1,2s** — un cadru durează 170 ms, adică o clipă, nu un acord;
>    mediat, notele trecătoare și percuția se estompează, iar armonia care ține rămâne;
> 2. **un candidat trebuie să câștige neîntrerupt ~0,45s** ca să fie comis;
> 3. **datarea retroactivă** — acordul e datat cu momentul în care a început, nu cu cel în care
>    ne-am convins (fereastra privește în urmă, deci scădem jumătate din ea). Contează la
>    Pasul 5: în redarea din cache momentele trebuie să fie exacte.
>
> **A doua cauză, mai subtilă: confuzia între acorduri înrudite.** G cu un F# trecător în
> melodie conține exact Bm (B-D-F#) — detectorul alegea Bm. Rezolvat muzical, nu statistic:
> **nota de bas dă fundamentala** (pondere 0,3 în scor).
> Atenție la capcana în care am căzut o dată: nu e „chroma registrului grav” — într-un Do
> cântat C3-E3-G3, tot registrul grav conține C, E și G, deci Em primea la fel de mult sprijin.
> Contează **cea mai joasă notă**, nu orice notă joasă (`bassChroma()` în `lib/chroma.js`).
>
> **Rezultat: 28,4% → 97,2% acuratețe, 51 → exact 4 schimbări.** Pragurile testului sunt
> strânse la 90% / 6 schimbări, ca o regresie la reglaje să cadă zgomotos.
>
> Rămâne o **întârziere de ~0,5–1s în analiza live** — inevitabilă: stabilitatea cere context.
> La redarea din cache (Pasul 5) dispare, fiindcă acolo avem cronologia completă.

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

> **REZULTAT PAȘII 4–7 (2026-08-24, Opus) — implementați și verificați într-un Chromium real.**
>
> Poarta 3 a fost trecută pe muzică reală (Andrei: „toate momentele sunt corecte, n-am văzut
> greșeală"), așa că am mers mai departe cu 4, 5, 6 și 7 într-o singură rundă.
>
> **Verificarea nu mai e doar sintetică.** `tests/ui.test.mjs` încarcă extensia într-un Chromium
> real și interceptează adresa YouTube, servind o pagină cu aceeași structură pe care se bazează
> content.js (`#below`, `.html5-video-player`, `<video>`). Content scriptul se injectează normal,
> fiindcă adresa se potrivește cu tiparul din manifest. 12 verificări, toate trec.
>
> **Capcană de care să ții cont dacă umbli la testul de UI:** content scriptul rulează într-o
> lume izolată, cu propriul înveliș peste elementele DOM. O proprietate `currentTime` pusă din
> pagină cu `defineProperty` **nu se vede acolo** — testul arăta încăpățânat primul acord.
> Soluția: `<video>` real, cu un WAV tăcut generat în test ca sursă, care chiar se poate derula.
>
> **Pasul 4 — panoul.** Acordul curent (mare) + diagrama lui + ce urmează. Pe canalul de
> memorie arătăm **ce vine**, nu istoricul: la sing-along asta folosește.
>
> **Pasul 5 — memoria.** `chords:<videoId>` în `chrome.storage.local`. La redare urmărim
> `video.currentTime` prin căutare binară, într-o buclă `requestAnimationFrame` care redesenează
> doar la schimbarea acordului. Aici dispare întârzierea de ~1s din analiza live.
> Sugestia de capo se **recalculează la fiecare încărcare**, nu se citește orbește din memorie.
>
> **Pasul 6 — capo și transpoziție.** `acord cântat = acord auzit + transpoziție − capo`.
> Capo-ul sugerat e cel care dă cele mai multe forme deschise (`bestCapo`). Exemplu real:
> „Wonderwall" sună F#m A E B; cu capo 2 cânți Em G D A — vezi `docs/capturi/panou-capo.png`.
>
> **Pasul 7 — diagramele.** Nu ținem o bază de date cu toate acordurile: ținem formele deschise
> și construim restul ca forme de bară după sistemul CAGED. `tests/diagrams.test.mjs` verifică
> **muzical** fiecare formă — calculează ce note ies din corzi și le compară cu notele acordului
> (24/24 majore și minore + 20 septime/suspendate). O digitație greșită ar fi mai rea decât una
> lipsă: cineva ar învăța să cânte fals și ar da vina pe urechea lui.
>
> **Schimbare de design față de plan:** diagrama nu e un balon la hover, ci stă **permanent**
> lângă acordul curent. Prima variantă (tooltip) acoperea butoanele de capo și ieșea din panou —
> s-a văzut în captura de ecran. Hover pe un acord care urmează îi arată diagrama temporar.
> Un test verifică explicit că diagrama nu suprapune controalele.

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

> **REZULTAT PAȘII 8–9 (2026-08-24, Opus) — ETAPA 1 COMPLETĂ.**
>
> **Pasul 8 — logging.** Debug e acum implicit OPRIT; warn și error se văd mereu, fiindcă
> alea înseamnă că ceva chiar s-a stricat. Singurul `console` direct rămas e în
> `content/loader.js`, și e justificat: dacă tocmai importul modulelor eșuează, nici loggerul
> nu s-a încărcat.
> **Defect real găsit la trecerea asta:** citirea setării din storage e asincronă, iar modulele
> loghează imediat ce se încarcă — deci exact mesajele de la pornire, cele mai utile la
> depanare, se pierdeau *chiar cu debug pornit*. Acum sunt ținute într-un tampon (max 200) și
> vărsate când se află setarea. `tests/browser-selftest.mjs` verifică ambele stări.
>
> **Pasul 9 — ambalare.** `npm run build` produce `dist/chordtab-<versiune>.zip` (22 fișiere,
> 32 KB) și refuză să împacheteze dacă găsește fișiere care seamănă a secrete sau dacă lipsește
> ceva esențial din manifest.
> `npm run test:package` construiește arhiva, o **dezarhivează într-un folder nou și o încarcă
> într-un Chromium cu profil curat** — adică exact ce va face un om din comunitate. Verifică
> motorul de detecție, panoul pe o pagină de tip YouTube și pagina de opțiuni. Testăm ARHIVA,
> nu folderul de lucru: dacă uităm un fișier la împachetare, aici se vede.
>
> **Scos pe parcurs:** comutatorul de acordaj Drop D. Ideea a venit dintr-o melodie anume, dar
> există drop D, drop C, drop orice — un comutator pentru unul singur e arbitrar. Detecția
> automată a acordajului rămâne imposibilă cinstit: basul cântă în același registru.

## Riscuri cunoscute și ce faci cu ele

1. **Tabul se mutează la captură** → e normal; legătura `sursă→destination` din offscreen
   rezolvă. Dacă auzi liniște, acolo s-a rupt ceva, nu în YouTube.
2. ~~**Essentia nu merge în WASM/MV3**~~ → **S-A ÎNTÂMPLAT.** Fallback-ul din pasul 0 a fost
   aplicat: lanț propriu FFT → chroma → șabloane. Vezi `docs/BUG-essentia-mv3-csp.md`.
3. **YouTube își schimbă DOM-ul** → injectarea are fallback overlay; nu depinde de clase
   obscure, doar de `#below` + `.html5-video-player` + elementul `<video>`.
4. **Viteza de redare ≠ 1x** → timestamp-urile folosesc `currentTime`, deci sincronizarea
   rămâne corectă; doar calitatea detecției scade la 2x — acceptat, notează în README.
5. **Reclame** → tratate în pasul 2 (fără `CT_TIME` în timpul reclamei).
6. **Live-uri / premiere** → în afara scopului; content.js afișează „indisponibil pe live".

## Etapa 2 (DOAR după livrarea Etapei 1 — nu începe fără decizie explicită de la Andrei)

Supabase (cont nou, gratuit): cache comun per videoId între utilizatori + Edge Function
ca proxy cu cheia în secrets, dacă se decide vreodată un API plătit (ex. Klangio).
