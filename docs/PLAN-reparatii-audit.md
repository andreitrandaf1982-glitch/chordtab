# PLAN — Reparațiile auditului + Foaia melodiei (v0.2.0 → v0.3.0)

> Audit rulat pe Fable, 2026-08-24: 4 auditori pe dimensiuni independente + câte un sceptic
> pus să INFIRME fiecare constatare (14 agenți). 10 constatări verificate, 10 confirmate,
> 0 infirmate; scepticii au coborât gravitatea la 2 dintre ele și au corectat mecanismele
> pretinse la altele. 12 constatări minore au rămas neverificate (plafon de economie) — listate
> la final. Executat de Opus, pas cu pas. Regula celor două încercări rămâne în vigoare.
> După fiecare pas: suita completă + commit + push.

## Pasul 1 — CRITIC: arhiva zip se strică pe Windows „curat”

**Confirmat empiric pe mașina asta.** `build-zip.mjs` cheamă `spawnSync('powershell', ...)` =
Windows PowerShell 5.1, al cărui `Compress-Archive` scrie intrările cu `\` în loc de `/`
(încălcând specificația ZIP). Pe macOS/Linux dezarhivarea produce fișiere plate numite literal
`content\loader.js` → Load unpacked moare pentru toți destinatarii non-Windows. Testul de
pachet NU o poate prinde: dezarhivează tot cu PowerShell, care tolerează `\` — simetria
build/extract pe același OS maschează defectul. Arhivele din dist/ de până acum au avut noroc
de `/`; prima reconstrucție pe un Windows standard strecoară regresiunea tăcut.

**Fix:** în `tools/build-zip.mjs`, ramura Windows devine
`spawnSync('tar', ['-a', '-c', '-f', out, '-C', EXT, '.'])` — tar.exe (bsdtar) e livrat
in-box pe Windows 10/11 și scrie `/`. Apoi adaugă în `tests/package.test.mjs` o verificare de
regresie care citește NUMELE intrărilor din zip și pică dacă vreunul conține `\` — asta rupe
simetria care mascheaza bug-ul. Reconstruiește arhiva.
**POARTĂ:** test:package verde + verificarea de nume trece pe arhiva nouă.

## Pasul 2 — MAJOR: viața capturii (service worker, refresh, dublu-click)

Trei defecte înrudite, se repară împreună în `background.js` (+ puțin content/offscreen):

**2a. Restartul service workerului MV3 pierde starea capturii.** Detaliu subtil confirmat de
sceptic: în redare normală SW-ul NU moare (CT_TIME-ul difuzat la 250ms îi resetează timerul),
dar la **pauză/reclamă >30s** traficul încetează și Chrome îl recuperează. La restart,
`state.capturingTabId = null` → releul aruncă toate CHORD_EVENT (panou înghețat pe „ascult”),
iar „Oprește” pornește o captură NOUĂ care șterge acordurile strânse. Tab închis → document
offscreen orfan.
**Fix:** persistă `capturingTabId` în `chrome.storage.session` la fiecare atribuire
(startCapture/stopCapture) și rehidratează-l la pornirea SW-ului — o promisiune `ready`
așteptată în toggleCapture, în releu (handlerul devine async-safe: returnează după await) și
în tabs.onRemoved/onUpdated.

**2b. Refresh (F5) în timpul analizei lasă captura fantomă.** `tabs.onUpdated` oprește doar la
`changeInfo.url`, care lipsește la reload → captura continuă, content renaște în playback,
evenimentele fantomă poluează cronologia în memorie, iar butonul face inversul etichetei.
**Fix:** în listener, oprește și la `changeInfo.status === 'loading'`. Apărare în adâncime în
`content.js`: acceptă CHORD_EVENT **doar când `state.mode === 'listening'`**.

**2c. Dublu-click rapid pe iconiță** (minor, confirmat cu gravitate coborâtă — recuperabil
dintr-un click): două startCapture concurente; calea de eroare a celui de-al doilea închide
documentul primului. **Fix:** flag sincron `state.busy` setat înainte de primul await în
toggleCapture, eliberat în `finally`; în plus `ensureOffscreen` nu suprascrie `offscreenReady`
dacă există deja (memorează promisiunea de creare).

**2d. Bonus din aceeași zonă (neverificat, dar fix de 3 rânduri):** eșecul lui `start()` în
offscreen e mut — content a primit deja `capturing: true` și rămâne pe „ascult” în gol.
**Fix:** catch-ul din offscreen trimite `{target:'background', type:'CAPTURE_ERROR'}`;
background face stopCapture + CAPTURE_FAILED către content.
**POARTĂ 2:** toată suita verde; manual (Andrei, la verificarea finală): pauză de 60s în
timpul analizei → acordurile continuă după reluare; F5 în timpul analizei → nicio captură
fantomă (iconița pornește curat o analiză nouă).

## Pasul 3 — MAJOR: ceasul și cronologia

**3a. Ceasul offscreen extrapolează la nesfârșit** fără CT_TIME (pauză/reclamă): acordurile
RECLAMEI se scriu pe cronologia melodiei la timpi extrapolați; comentariul din content.js
(„analizorul aruncă cadrele”) e fals azi.
**Fix:** în `offscreen.js`, `videoTimeNow()` tratează ceasul vechi ca absent: CT_TIME vine la
250ms, deci `if (!clock || performance.now() - clock.receivedAt > 750) return -1;` — garda
`videoTime >= 0` din analyzer începe în sfârșit să facă ce promite comentariul.

**3b. `state.chords` își pierde sortarea la derulare înapoi** în timpul analizei → căutarea
binară din redare întoarce acorduri greșite, iar saveCache cimentează defectul în storage.
**Fix:** în handlerul CHORD_EVENT, înainte de push: cât timp ultimul element are `t >= msg.t`,
fă pop (re-analiza după seek înlocuiește coada veche). Plasă de siguranță pentru cache-urile
deja corupte: `loadCache` sortează `stored.chords` după t.
**POARTĂ 3:** test nou în ui.test.mjs: injectează CHORD_EVENT cu timpi necrescători → lista
rămâne sortată și redarea corectă. Suita verde.

## Pasul 4 — MAJOR: două defecte de DSP

**4a. Garda `minChordSeconds` suprimă PERMANENT un acord legitim.** Ambii operanzi ai testului
sunt înghețați (`sinceT` nu se reîmprospătează cât eticheta candidatului nu se schimbă,
`committedAt` doar la comitere), deci un acord care revine repede după o comitere greșită nu
mai e emis NICIODATĂ cât ține — o strofă întreagă pe acordul vechi.
**Fix (exact cel verificat de sceptic):** garda devine temporală —
`if (now - this.committedAt < this.cfg.minChordSeconds) return;` — iar onset-ul se limitează
ca să nu retro-dateze sub acordul precedent:
`onset = Math.max(0, this.committedAt + this.cfg.minChordSeconds, sinceT - windowSeconds/2)`
(atenție: committedAt pornește la -Infinity — Math.max îl tratează corect).

**4b. Bas absent = prag umflat tăcut.** Când `bassChroma` întoarce vector zero (fingerpicking
în registru înalt, capo sus, voce+pian), scorul se împarte tot la 1,3 → pragul efectiv urcă de
la 0,6 la 0,78 → N.C. fals pe pasaje întregi perfect clare.
**Fix:** în `chords.js`, calculează `bassMax` ÎNAINTE de `bassWeight` și:
`const bassWeight = (bass && bassMax > 0) ? (opts.bassWeight ?? DEFAULT_BASS_WEIGHT) : 0;`
**POARTĂ 4:** stability/progression/chord-detection toate verzi (pragurile lor stricte prind
regresiile de reglaj); un test unit nou pentru 4a (secvența comitere-greșită → revenire-rapidă
→ trebuie emis după minChordSeconds) și pentru 4b (chroma bună + bas zero → același verdict ca
fără bas).

## Pasul 5 — vizibile utilizatorului (din cele neverificate, cu lanț limpede în cod)

**5a. Panoul apare ca overlay plutitor pe TOATE paginile YouTube non-watch** (homepage,
căutare, canal): `buildPanel()` rulează necondiționat și, fără `#below`, rămâne overlay fix
peste pagină. **Fix:** în `init()` și `onNavigate()`, dacă `getVideoId()` e null → scoate
panoul (dacă există) și nu construi nimic.

**5b. Pe music.youtube.com clickul pe iconiță pornește captura FĂRĂ niciun UI** (content
scriptul nu se injectează acolo, dar verificarea din background `includes('youtube.com/watch')`
se potrivește). **Fix:** restrânge verificarea la `new URL(tab.url).host === 'www.youtube.com'`
&& pathname `/watch` — scope-ul declarat al extensiei.

**5c. „Analizează din nou” cu același număr de secțiuni lasă bara veche** (cheia de
idempotență `...|sections.length` nu vede conținutul; handler-ele de click țin granițe vechi).
**Fix:** include în cheie un rezumat al conținutului (ex. `sections.map(s=>s.cluster+s.start.toFixed(0)).join(',')`)
și resetează `ui.barKey` în `startClock()`.
**POARTĂ 5:** teste UI noi pentru 5a (pagină fără v= → fără panou) și 5c (structură schimbată
cu același număr de secțiuni → bara se reconstruiește). Suita verde.

## Pasul 6 — FOAIA MELODIEI (funcție nouă, proiectată de Fable la cererea lui Andrei)

**Problema, în cuvintele lui:** „văd mereu pe ecran doar patru acorduri… n-am ceva istoric să
văd melodia sau să derulez înainte-înapoi pe bucăți." Legenda arată *tiparele* (dedublate),
dar nu arată *melodia*. Foaia e partitura întreagă, în ordinea cântecului, pe care poți da click.

**Design (mod „memorat”; live rămâne cum e):**

```
STRUCTURA    [bara existentă — neschimbată]
FOAIA MELODIEI
  ▶ A · Strofă   [G][D][Am][C]        ×4     ← rând per SECȚIUNE, ÎN ORDINEA MELODIEI
    B · Refren   [Em][C][G][D]        ×2        (nu dedublat ca legenda!)
    A · Strofă   [G][D][Am][C]        ×2
    B · Refren   [Em][C][G][D]        ×2
    C · Punte    [F][F#m]
    B · Refren   [Em][C][G][D]        ×2
```

**Foaia ÎNLOCUIEȘTE legenda** (informația ei — tipar + ×total — e cuprinsă în rânduri; primele
apariții ale fiecărui grup o acoperă). Elementul `.ct-legend` devine `.ct-sheet`; testele
existente de legendă se rescriu pe foaie (tiparul per rând + ×reps rămân verificate).

Reguli exacte:
1. **Un rând per element din `st.sections`, în ordine.** Eticheta rândului = `sectionLabel(s)`
   cu aceleași culori `data-group` ca bara. Click pe etichetă = salt la `s.start + 0.05`.
2. **Chip-urile rândului:**
   - secțiune cu grup: `st.patterns[s.cluster].loop`, prin `displayLabel()` (capo/ton se
     aplică); click pe chip-ul k = salt la `s.start + Σ(loop[j].seconds, j<k) + 0.05`
     (prima trecere prin buclă). `×s.reps` la capătul rândului (fără × la reps=1).
   - secțiune liberă (punte/intro/final): felia reală din `state.chords` cu
     `s.start <= t < s.end`, dedublată pe etichete consecutive; click pe chip = salt la
     `max(chord.t, s.start) + 0.05`. Ține `t`-ul fiecărui chip în `dataset.t`.
   - hover pe orice chip = diagrama lui (`attachChipHover`, exact ca peste tot).
3. **Evidențierea „aici ești”:** rândul curent primește `is-current`; ÎN rândul curent,
   chip-ul acordului care sună primește `is-now`. Calcul: pentru rând cu grup, faza
   `p = (t - s.start) % st.patterns[cluster].period`, apoi mers cumulativ prin
   `loop[].seconds` până îl conține pe p; pentru rând liber, ultimul chip cu
   `dataset.t <= t`. LECȚIA PÂLPÂITULUI: bucla rAF NU reconstruiește DOM; extinde garda
   existentă din tick cu o cheie `sheetKey = sectionIdx|chordIdx` și scrie clase DOAR când
   cheia se schimbă (~o dată la 2 s). La schimbarea rândului curent:
   `row.scrollIntoView({ block: 'nearest' })`.
4. **Fără structură, foaia TOT apare** — plângerea lui Andrei e valabilă și acolo. Decuplează:
   bara+numele cer `hasUsefulStructure()`; foaia cere doar `state.chords.length >= 4` în
   playback. Fallback: un singur rând fără etichetă, cu TOATE acordurile memorate ca chip-uri
   (dedublate consecutiv, click = salt la `t`), împachetate pe mai multe linii.
5. **Gabarit:** `.ct-sheet { max-height: 300px; overflow-y: auto; }` — melodiile lungi se
   derulează în interiorul foii, panoul nu crește la nesfârșit.
6. **Reconstrucție:** aceeași cheie ca bara (după fixul 5c include conținutul secțiunilor) +
   capo/ton; zero reconstrucții din bucla rAF.
7. Texte noi în `strings.js`: `sheet: 'Foaia melodiei'` (+ ce mai e nevoie). Captură nouă în
   `tools/screenshot.mjs` (înlocuiește-o pe cea de structură ca să arate și foaia), README
   actualizat la secțiunea de structură.

**POARTĂ 6 (teste UI noi, pe cronologia structurată existentă):** foaia are exact câte un rând
per secțiune, în ordinea A B A B (nu dedublat); click pe chip-ul 2 din rândul 2 duce
currentTime la ~32+2s (±1); după seek în rândul 2, rândul 2 e `is-current` și chip-ul corect
e `is-now`; pe cronologia FĂRĂ structură foaia apare cu toate acordurile și click pe un chip
sare la timpul lui; observatorul de mutații pe foaie, cu redarea pe pauză 1,5 s → ≤2 modificări.
Testele vechi de legendă rescrise pe foaie; toată suita verde.

## Pasul 7 — ambalare v0.3.0

Versiune 0.3.0 în manifest + package.json (funcție nouă, nu doar reparații),
`npm run test:package`, commit, push.
**POARTĂ 7:** tot verde, arhiva nouă construită cu tar și verificată la nume de intrări.

## Backlog asumat (minore neverificate — NU se repară acum; decizie Andrei mai târziu)

- Redarea ignoră reclamele (acord fals afișat în mid-roll; corectat automat la finalul ei).
- Cache-ul chords:* crește nemărginit; la cotă plină salvarea moare cu un warn în consolă.
- Literele de secțiuni se saturează la 'J' pe mixuri cu >10 bucle distincte.
- Retro-datarea primului acord după seek (până la 0,6s înainte de punctul de aterizare).
- `npm test` nu include test:package, iar testul iese 0 când lipsesc precondițiile (CI naiv
  l-ar crede verde). De discutat când apare un CI.
- Pagina falsă din teste are mereu `#below` → ramura overlay și comportamentul la reclame
  rămân netestate automat.
