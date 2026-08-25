# PLAN — Reparațiile auditului 2 (țintă: v0.5.1)

Scris de Fable pe 2026-08-25, din auditul adversarial pe v0.5.0 — rulat economic, la cererea
lui Andrei: 3 auditori pe lentile independente + 4 sceptici puși să infirme (7 agenți în
total). **16 constatări brute, 0 infirmate, 2 retrogradate; după contopirea duplicatelor:
14 defecte reale — 1 critic, 2 mari, 5 medii, 6 mici.** Toate verdictele au dovadă
fișier:linie verificată de un sceptic independent.

## STARE: toți cei 9 pași executați (Opus, 2026-08-25) — v0.5.1 livrată

Toate porțile trecute, 50 de verificări UI verzi + algoritmii + arhiva. Cele trei reparații
grele au fost verificate ȘI negativ (testul nou pus pe codul vechi trebuie să PICE):
- foaia care derula pagina: cu `scrollIntoView` la loc, pagina sare de la 2000px la 601px ✓
- bucla contopită circular: cu `lead` forțat la 0, testul pică pe „lead 0, aștept ~2" ✓

Abateri de la plan, conștiente:
- **Pasul 5** (cursa pe două taburi) nu a primit test automat: cere două taburi reale cu
  invocări diferite de extensie, ceea ce Playwright nu poate simula cinstit. Reparația e
  minimă și evidentă la citire (cerem permisiunea înainte să oprim captura veche); rămâne
  probă manuală. Am respectat regula: n-am forțat un test fragil.
- **Pasul 4**: proba adevărată (tab ascuns) nu se poate automatiza — testul acoperă calea
  care rămâne vie acolo (`timeupdate` emis fără niciun tick rAF util), iar proba manuală e
  scrisă în VERIFICARE.md.

---

Executat de Opus, pas cu pas; fiecare pas se încheie cu `npm test` verde și un commit.
La blocaj: regula celor două încercări → `docs/BUG-<slug>.md` → escaladare pe Fable.
Liniile de cod citate mai jos sunt orientative (fișierele se mai mișcă); citatele de cod
sunt reperul.

---

## Pasul 1 — CRITIC: foaia derulează pagina YouTube întreagă

**Defectul** (două constatări contopite — ambii auditori l-au găsit independent):
`updateSheetHighlight` cheamă `rows[i].scrollIntoView({ block: 'nearest' })` la fiecare
schimbare de acord. `scrollIntoView` derulează TOȚI strămoșii derulabili — inclusiv
scroller-ul documentului — deci, când omul a derulat la comentarii, pagina sare înapoi la
panou la fiecare acord (~la 1–4 s). Pornit implicit pe ORICE melodie deja analizată (modul
memorat intră singur din cache). A doua față a aceluiași defect: când omul derulează manual
în interiorul foii, foaia îi fuge de sub cursor înapoi la rândul curent.

**Reparația:**
- În `panel.css`, dă-i lui `.ct-sheet` `position: relative` (ca `offsetTop`-ul rândurilor
  să fie relativ la foaie).
- În `updateSheetHighlight`, înlocuiește `scrollIntoView` cu derularea DOAR a foii, și DOAR
  când se schimbă RÂNDUL (nu chip-ul — ține minte ultimul rând în `ui.sheetRowLast`):
  ```js
  // Derulăm DOAR foaia: scrollIntoView urcă până la scroller-ul paginii și smucește
  // tot YouTube-ul înapoi la panou la fiecare acord. Și doar la schimbarea RÂNDULUI,
  // ca foaia să nu fugă de sub cursor când omul o derulează singur.
  if (isCurrent && rowIdx !== ui.sheetRowLast) {
    const top = rows[i].offsetTop;
    const bottom = top + rows[i].offsetHeight;
    if (top < ui.sheet.scrollTop) ui.sheet.scrollTop = top;
    else if (bottom > ui.sheet.scrollTop + ui.sheet.clientHeight) {
      ui.sheet.scrollTop = bottom - ui.sheet.clientHeight;
    }
  }
  ```
  (`ui.sheetRowLast = rowIdx` la finalul funcției; resetat unde se resetează `sheetHighlight`.)
- Citirile de layout rămân rare: gardate de cheia existentă + condiția de rând.

**Testul (obligatoriu):** în pagina falsă, fă documentul înalt (un div de 3000px sub
`#below`), derulează fereastra jos de tot (`window.scrollTo(0, 99999)`), apoi schimbă
acordul (seek). Aserțiuni: `window.scrollY` NU se schimbă; iar pe o melodie cu multe
secțiuni, `ui.sheet.scrollTop` se mișcă atunci când rândul curent iese din vederea foii.

**Poarta 1:** `npm test` verde, inclusiv testul nou de ne-derulare a paginii.

## Pasul 2 — MARE: „ended” al reclamei oprește analiza

**Defectul:** reclamele rulează în ACELAȘI `<video>`; la capătul natural al reclamei
elementul emite `ended`, iar `onVideoEnded` îl ia drept finalul melodiei: pre-roll →
analiza se „termină” cu 0 acorduri (butonul pare mort); mid-roll → jumătate de melodie
salvată și prezentată drept „melodia e învățată”. Ceasul CT_TIME are deja garda
`isAdShowing()` — exact handlerul care ÎNCHEIE analiza nu o are.

**Reparația:** în `onVideoEnded`, extinde garda existentă:
```js
// 'ended' al reclamei nu e finalul melodiei — reclama rulează în același <video>.
if (state.mode !== 'listening' || isAdShowing()) return;
```
Limitare asumată (scrie-o în comentariu): dacă un post-roll marchează playerul ca reclamă
chiar în clipa în care se termină MELODIA, ratăm oprirea automată și omul oprește manual —
degradare acceptabilă, opusul (reclama care „termină” melodia) nu e.

**Testul:** în pagina falsă, adaugă clasa `ad-showing` pe `.html5-video-player`, dispecerizează
`ended` → panoul RĂMÂNE în „Pasul 1” / ascultare; scoate clasa, dispecerizează `ended` din
nou → trece în „Pasul 2”.

**Poarta 2:** `npm test` verde cu ambele ramuri acoperite.

## Pasul 3 — MARE: bucla nativă YouTube (click-dreapta → Loop) rupe tot

**Defectul:** cu `video.loop = true`, spec-ul HTML NU emite `ended` — melodia reia de la 0
fără niciun eveniment. Consecințe în lanț: (1) oprirea automată nu vine niciodată — panoul
rămâne veșnic în Pasul 1, deși ghidul promite altceva; (2) la reluare, CHORD_EVENT-urile cu
t≈0 golesc, prin while-pop-ul de dedublare, TOATĂ cronologia strânsă în prima trecere;
(3) salvarea din mers suprascrie memoria completă cu prefixul trecerii a doua. Pierdere de
date reală, pe un gest obișnuit când înveți o melodie.

**Reparația:** în interval-ul CT_TIME din `startClock`, imediat DUPĂ garda de pauză/reclamă,
prinde reluarea buclei și tratează wrap-ul ca pe finalul melodiei:
```js
// Cu Loop pornit (click-dreapta pe player) 'ended' nu vine NICIODATĂ — spec-ul HTML
// sare la început fără eveniment. Reluarea buclei E finalul melodiei.
if (video.loop && state.lastClockT > 5 && video.currentTime < 1.5
    && video.currentTime < state.lastClockT - 5) {
  onVideoEnded();
  return;
}
state.lastClockT = video.currentTime;
```
`state.lastClockT` se inițializează 0 în `startClock`. Asumat și comentat: cu Loop pornit,
o derulare manuală înapoi aproape de 0 e indistinctibilă de wrap și încheie analiza — cu ce
s-a strâns până atunci; acceptabil, fiindcă alternativa e pierderea întregii cronologii.

**Testul:** în listening (folosind mecanismul existent de simulare din ui.test), pune
`video.loop = true`, împinge `currentTime` mare, apoi înapoi la 0 → panoul trebuie să treacă
în Pasul 2 cu acordurile primei treceri intacte.

**Poarta 3:** `npm test` verde; acordurile primei treceri supraviețuiesc în aserțiune.

## Pasul 4 — MEDIU: exersarea moare când tabul nu e vizibil

**Defectul** (retrogradat de sceptic din „mare”, cu motiv bun): bucla de exersare trăiește
DOAR în tick-ul rAF, iar Chrome nu livrează rAF în taburi ascunse — treci pe alt tab cât
exersezi și melodia curge nestingherită dincolo de secțiune, la 0,5×, prin toată piesa.
Nu se pierde nimic și starea se repară singură la revenire, dar funcția promisă tace.

**Reparația:** `timeupdate` bate și în taburi ascunse. În `startPractice`, după `applyRate`:
```js
// rAF tace în taburi ascunse — 'timeupdate' bate și acolo, deci bucla nu moare.
state.practiceVideo = video;
video.addEventListener('timeupdate', onPracticeTime);
```
cu `onPracticeTime = () => { if (state.practice && state.practiceVideo) tickPractice(state.practiceVideo.currentTime); }`
definit la nivel de modul; în `stopPractice`:
`state.practiceVideo?.removeEventListener('timeupdate', onPracticeTime); state.practiceVideo = null;`.
Dubla execuție (rAF + timeupdate în tab vizibil) e inofensivă — `tickPractice` e idempotent.

**Testul:** automat, verifică-le pe cele existente (rămân verzi) + un test că bucla se
declanșează și dintr-un `timeupdate` dispecerizată manual cu `currentTime` peste graniță.
Proba tabului ascuns nu se poate automatiza cinstit în Playwright — scrie-o în VERIFICARE.md
la probele manuale: „exersează, treci pe alt tab, bucla trebuie să se audă repetând”.

**Poarta 4:** `npm test` verde.

## Pasul 5 — MEDIU: „Analizează” pe tabul B omoară analiza de pe tabul A degeaba

**Defectul:** `toggleCapture` oprește captura de pe A ÎNAINTE să afle dacă B poate porni;
când `getMediaStreamId` aruncă (extensia neinvocată pe B), analiza de pe A e sacrificată
pentru o pornire imposibilă, fără repornire.

**Reparația:** cere streamId-ul pentru tabul nou ÎNAINTE de a opri captura veche — respectă
și regula existentă „streamId înainte de orice alt await” (gestul utilizatorului):
- `startCapture(tab, streamId)` primește streamId-ul deja obținut (dacă lipsește, îl cere
  singur, ca azi — calea normală a iconiței rămâne neschimbată);
- în `toggleCapture`, pe ramura de pornire cu captură activă pe ALT tab:
  `const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });`
  apoi `stopCapture('captură nouă pe alt tab')`, apoi `startCapture(tab, streamId)`.
  Dacă cererea aruncă, A nu e atins (catch-ul existent anunță doar B).

**Testul:** greu de făcut cinstit cu două taburi în Playwright; dacă în 30 de minute nu iese
stabil, documentează proba manuală în VERIFICARE.md și acoperă cu un test că fluxul normal
(un singur tab) rămâne intact. Nu-l forța — regula celor două încercări.

**Poarta 5:** `npm test` verde; comportamentul pe un tab neatins.

## Pasul 6 — MEDIU: memoria melodiei vechi aterizează pe videoul nou

**Defectul:** `loadCache` nu re-verifică după `await` că `state.videoId` mai e cel pentru
care a citit — la două navigări SPA rapide, acordurile videoului B se aplică pe C.

**Reparația:** în `loadCache`, `const id = state.videoId;` înainte de await; imediat după:
```js
if (id !== state.videoId) return; // s-a navigat între timp — memoria citită e a altui video
```

**Poarta 6:** `npm test` verde (garda e trivială; testele existente de navigare acoperă).

## Pasul 7 — MEDIU: contopirea circulară din compressLoop rotește foaia

**Defectul:** când bucla cuantizată începe și se termină cu același acord (cazul tipic:
progresie care pleacă și revine pe tonică — E-A-E-B-A-E), `compressLoop` unește capetele și
adaugă durata cozii PRIMULUI element. Dar `buildSheet` și `sheetChipIndexAt` mapează lista
liniar de la faza 0 → chip-urile sunt decalate cu durata cozii: click pe „A” sare unde sună
E, iar evidențierea din foaie contrazice acordul mare de sus.

**Reparația** (atinge `lib/sections.js` — NU modifica detecția de perioade, doar
prezentarea buclei):
- `compressLoop` întoarce `{ loop, lead }`, unde `lead` = secundele cozii mutate în capul
  buclei (0 fără contopire); `patterns[letter]` devine `{ loop, period, lead }`.
- `buildSheet` (ramura cu tipar): momentul chip-ului i = `s.start + max(0, acc - lead)`,
  unde `acc` e suma secundelor dinaintea lui i (primul chip rămâne la `s.start`).
- `sheetChipIndexAt`: faza devine `(phase + lead) % period` înainte de acumulare.
- Comentariu în `compressLoop`: „capul contopit începe de fapt cu `lead` secunde ÎNAINTE de
  faza 0 — cine consumă lista trebuie să compenseze”.

**Testele:** în `tests/sections.test.mjs`, caz nou cu buclă circular-contopită (prima==ultima
etichetă) care verifică `lead`; în `tests/ui.test.mjs` sau ca verificare de algoritm, că pe
un asemenea tipar chip-ul al doilea primește momentul corect (fără decalaj). Testele
existente pe `patterns[x].loop` trebuie să rămână verzi (câmp adăugat, nu schimbat).

**Poarta 7:** `npm test` verde, inclusiv cazul circular nou.

## Pasul 8 — mărunțișurile confirmate (toate într-un singur commit e ok)

1. **README „Instalare” predă fluxul vechi** (contrazice introducerea): rescrie paragraful
   „Cum se folosește” pe fluxul real — „Analizează” în panou, oprirea vine singură la final,
   fără niciun „apasă din nou”. E documentul pe care îl urmează juratul.
2. **Linia Pasului 2 promite ⟳ pe melodii fără structură**: adaugă `stepPlaybackFlat` în
   strings („Click pe orice acord ca să sari acolo.”) și alege în `renderStep` după
   `hasUsefulStructure()`.
3. **„24 acorduri” fără „de”**: în `stepListening`, regula numeralului:
   `${n}${n % 100 >= 1 && n % 100 <= 19 ? '' : ' de'} acorduri` + comentariu
   („«12 acorduri», dar «24 de acorduri»”).
4. **Descrierea din manifest are 187 de caractere** (limita Chrome Web Store: 132; azi
   invizibil fiindcă distribuim zip, dar lansarea în CWS ar pica exact la publicare):
   scurteaz-o sub 132 și adaugă în `tests/package.test.mjs` aserțiunea
   `manifest.description.length <= 132` cu comentariul limitei.
5. **Diagrama previzualizată la hover e furată de schimbarea acordului**: ține chip-ul de
   sub cursor în `ui.hoverChip` (setat la mouseenter/focus, șters la mouseleave/blur), iar
   `setCurrent` afișează `ui.hoverChip?.isConnected ? ui.hoverChip.dataset.chord : label`.
6. **`sheetChipIndexAt` interoghează DOM-ul la fiecare cadru** pe foaia plată/zonele libere
   (retrogradat la mic — doar risipă de CPU): memorează momentele chip-urilor per rând la
   construcție (`ui.sheetTimes`, Map index-rând → listă de t) și caută în ea.
7. **„46 de verificări” → sunt 45**: în VERIFICARE.md scrie numărul REAL de la momentul
   ambalării (numără `await check(` din ui.test.mjs) — și lasă o notă în text că cifra se
   actualizează la fiecare versiune, ca să nu mai drifteze.

**Poarta 8:** `npm test` verde; recitește diff-ul de texte cu voce de utilizator.

## Pasul 9 — Ambalare v0.5.1

- Versiune 0.5.1 (manifest + package.json). README și VERIFICARE.md actualizate (inclusiv
  probele manuale noi: reclamă la final, Loop nativ, exersare cu tabul ascuns, pagina care
  NU mai sare). `npm run test:package` verde; commit + push.

**Poarta 9:** arhiva se dezarhivează și se încarcă curat; toate suitele verzi.

---

## Consemnate, fără acțiune acum

- Cele două perechi de duplicate au fost contopite (scroll-ul paginii; bucla nativă) —
  fiecare defect apare O dată mai sus.
- Retrogradate de sceptici, cu motive citate în jurnalul auditului: exersarea în tab ascuns
  (mare→medie), interogarea DOM la 60fps (medie→mică), manifestul >132 (medie→mică).
- Fluxul „melodia următoare” (întrebarea explicită a lui Andrei): auditorul de ciclu de
  viață nu a găsit un defect distinct în lanțul ended→autoplay→navigare SPA — dar
  README-ul care preda fluxul vechi (Pasul 8.1) e foarte probabil sursa derutei, iar
  clickul pe iconiță după oprirea automată PORNEA o analiză nouă peste melodia învățată
  (comportament real, documentat la 8.1; textul corectat îl previne).
