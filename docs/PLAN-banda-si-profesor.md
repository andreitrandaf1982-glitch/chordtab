# PLAN — Banda rulantă, modul de exersare și Profesorul AI (țintă: v0.4.0)

Scris de Fable pe 2026-08-25, după feedbackul lui Andrei pe v0.3.0: „e ok, dar pare
contra-intuitivă, greoaie, nu face mai mult decât să arate acorduri static; foaia pare
învechită… VREAU MULT MAI MULT CALITATIV.” Executat de Opus, pas cu pas; fiecare pas se
încheie cu poarta lui bifată și un commit descriptiv. La blocaj: regula celor două încercări
→ `docs/BUG-<slug>.md` → escaladare pe Fable.

## Decizii de produs (nu se renegociază în execuție)

- **Ideea „extensia te ascultă la microfon” e RESPINSĂ de Andrei** (2026-08-25): chitările
  amatorilor sunt des dezacordate, deci verdictul verde/roșu ar părea defectul extensiei.
  NU o reintroduce, nici ca opțiune.
- Rămân regulile vechi: **zero servere, zero chei** (Gemini Nano e local, deci respectă
  regula), capo-ul sugerat NU se aplică automat, fără detecție de acordaj (drop D & co.).
- Povestea produsului pentru concurs: *îți arată ce vine (banda) → te lasă să exersezi pe
  bucăți (loop + viteză) → îți explică de ce (Profesorul AI local)*.
- După livrarea v0.4.0: UN singur adversarial pe toată extensia, înainte de trimiterea la
  concurs. Nu se face audit intermediar.

---

## Poarta 0 — Gemini Nano pe mașina lui Andrei ✅ construită, ⏳ așteaptă rezultatul

Hardware verificat de Fable (2026-08-25), totul peste cerințe: Chrome **151** (cerință ≥138),
RTX 5070 Laptop **8 GB VRAM** (cerință >4), **771 GB** liberi (cerință ≥22), 31 GB RAM.

Proba e în **pagina de opțiuni** (secțiunea „Poarta 0”), cu suport în `background.js`
(mesajul `NANO_PROBE`): butonul 1 raportează forma API-ului (stabil `LanguageModel` /
variantă veche / absent) în pagină ȘI în service worker, plus disponibilitatea modelului;
butonul 2 descarcă modelul dacă e nevoie (~2–4 GB, o dată) și cere un răspuns de probă în
română, cu timpii măsurați. Chromium-ul din testele Playwright NU are modelul — de-asta proba
se rulează manual, în Chrome-ul real (lecția Essentia).

**Ramificație:** VERDE (API prezent + model disponibil + română utilizabilă) → se execută tot
planul. ROȘU → pașii 5–6 se SAR, restul rămâne, iar lui Andrei i se spune explicit ce a picat.
Rezultatul probei (copiat de Andrei) se notează aici înainte de pasul 5:

> Rezultat Poarta 0: _(de completat)_

---

## Pasul 0 — Numele secțiunilor pe românește (cerut explicit de Andrei)

„A · liber / B / C” e limbaj de laborator. Se schimbă DOAR prezentarea (content + strings);
`lib/sections.js` și testele lui nu se ating — euristica internă (`intro/verse/chorus/
bridge/outro`, clustere cu litere) rămâne cum e.

- `strings.js`: `sectionLabel` nu mai afișează litera. Eticheta devine: numele tradus când
  există („Strofă”, „Refren”…), altfel **„Partea N”**, unde N = numărul de ordine al
  clusterului după prima apariție în melodie (A→1, B→2… — stabil, nu depinde de câte au nume).
  `freeSection(null)` devine **„Trecere”** (azi „Liber”); zonele libere de la capete au deja
  nume (Intro/Final) din `sections.js`.
- `content.js`: `sectionLabel(s)` primește maparea cluster→număr de ordine (construită o dată
  din `state.sections`, la aceeași cheie de idempotență ca bara de structură).
- Litera rămâne doar intern (chei, culori). Culoarea continuă să arate „aceeași muzică”.
- Teste: aserțiile din `tests/ui.test.mjs` care caută „A · ” / „Liber” se actualizează;
  un test nou verifică „Partea 1/Partea 2” pe un demo fără nume euristice.

**Poarta 0.1:** `npm test` verde; captura `panou-structura.png` regenerată arată numele noi.

## Pașii 1–3 — Banda rulantă (înlocuiește afișajul „static” din capul panoului)

Banda apare **doar în modul playback** (acorduri memorate): acolo cunoaștem viitorul. În
listening viitorul nu există încă — rămâne afișajul curent (acord mare + istoric), fără bandă.

- **Pasul 1 — modelul (funcții pure în content.js):** dat `chords[]`, `sections[]` și `t` →
  layout: poziția fiecărui cartonaș = `t × scală`; scala se alege adaptiv ca fereastra
  vizibilă să arate ~12s de melodie (limitată la 8–20s după densitatea acordurilor — melodiile
  lente nu defilează gol, cele dese nu se înghesuie). Linia „ACUM” e fixă, la 25% din lățime.
- **Pasul 2 — DOM + mișcare:** cartonașele se poziționează absolut O dată per reconstrucție
  (cheie de conținut, ca la bara de structură — reconstrucția e idempotentă); mișcarea e UN
  singur `transform: translateX` pe container, actualizat din rAF-ul de playback EXISTENT.
  Etichetele trec prin `displayChord` (capo/transpoziția le schimbă → reconstrucție la
  schimbarea cheii de conținut). Sub cartonașe: benzi subțiri cu culorile secțiunilor
  (`--ct-g0..g4`). Click pe cartonaș = seek (ca în foaie). Cartonașul aflat sub linia „ACUM”
  e aprins în albastrul de brand.
  **Reduced-motion (lecția iPhone din 2026-08-20 — TOATE căile de randare):** cu
  `prefers-reduced-motion`, banda NU defilează continuu; poziția sare doar la schimbarea
  acordului.
- **Pasul 3 — teste UI (Playwright):** banda există în playback și lipsește în listening;
  cartonașul aprins = acordul curent afișat; click pe cartonaș sare corect; transpoziția
  schimbă etichetele; testul de flicker se extinde pe bandă (reconstrucții doar la schimbări
  reale); `page.emulateMedia({ reducedMotion: 'reduce' })` → containerul nu-și schimbă
  transformul între două cadre cu același acord. Capturi noi pentru README.

**Poarta 3:** `npm test` verde + captură cu banda; Andrei o vede pe o melodie reală.

## Pasul 4 — Modul de exersare (loop pe secțiune + viteză)

- Buton „⟳ exersează” pe fiecare rând al foii și pe segmentele barei — **doar în playback**
  (în listening loop-ul ar strica analiza; butoanele nu se randează).
- Activ: loop pe `[start, end)` — în tick, dacă `t ≥ end − 0.05` → seek la `start`. Un rând
  compact deasupra foii: „Exersezi: Refren · viteză [0.5][0.75][1] · Oprește”.
- Viteza: `video.playbackRate` cu `video.preservesPitch = true` setat explicit (tonalitatea
  nu se schimbă). La intrare se memorează viteza dinainte; la ieșire (Oprește / alt ⟳ /
  navigare / stop analiză) se RESTAUREAZĂ aia, nu 1 orbește — omul putea avea deja YouTube
  pe altă viteză. Sincronizarea nu suferă: cronologia e în secunde de video, `currentTime`
  curge corect la orice viteză.
- Teste: loop-ul se întoarce la start; viteza se aplică și se restaurează la ieșire;
  butoanele lipsesc în listening; banda + evidențierea foii rămân corecte în loop.

**Poarta 4:** `npm test` verde; Andrei exersează un refren încetinit pe o melodie reală.

## Pașii 5–6 — Profesorul AI (DOAR dacă Poarta 0 e verde)

- **Pasul 5 — fundația:**
  - Contextul de rulare: cel dovedit de Poarta 0 — service workerul dacă raportul arată
    API acolo; altfel un document offscreen dedicat. Content scriptul cere prin mesaj
    (`TEACHER_REQUEST` → răspuns), nu atinge API-ul direct.
  - Datele promptului se calculează LOCAL, din ce avem: tonalitate — funcție nouă
    `keyFromChords(chords)` în `music-theory.js` (+ test unit); progresia dominantă per
    secțiune (din bucle); capo sugerat; densitatea schimbărilor; titlul videoclipului
    (`document.title` fără „ - YouTube”).
  - Modul nou `lib/teacher.js` (pur, testabil): construiește promptul — profesor prietenos,
    română simplă, structură fixă: (1) melodia și tonalitatea, (2) cu ce secțiune începi și
    de ce, (3) acordul cel mai greu + un truc, (4) o încurajare; sub ~120 de cuvinte.
    Temperatura mică (din `params()` dacă există).
  - Cache: `teacher:<videoId>` în `storage.local` (version, text, createdAt); se șterge
    ORIUNDE se șterge `chords:<videoId>` (reanalizare, golirea cache-ului din opțiuni).
- **Pasul 6 — UI:** cardul „Profesorul” în panou (doar playback): buton „Explică-mi melodia”
  → indicator discret → textul; sub el, 3 întrebări fixe („Cu ce încep?”, „De ce capo aici?”,
  „Cum exersez trecerile?”) care refolosesc aceeași sesiune. **Dacă API-ul lipsește, cardul
  NU se randează deloc** — nicio promisiune falsă. Eroare la generare → un singur mesaj onest.
- Teste: `teacher.js` unit (promptul conține datele; cache round-trip); UI: cardul absent
  când API-ul lipsește — Chromium-ul din Playwright chiar nu-l are, deci fallback-ul se
  testează natural. Calea CU model nu se poate automatiza în CI — se spune onest în
  VERIFICARE.md și se probează manual de Andrei, pe 2 melodii.

**Poarta 6:** `npm test` verde; proba manuală a lui Andrei pe 2 melodii (calitatea românei
e criteriul — dacă e slabă, STOP și discuție cu Andrei pe Fable, nu cârpeli).

## Pasul 7 — Ambalare v0.4.0

- Se SCOATE proba Poarta 0 din opțiuni și `NANO_PROBE` din background (și-au făcut treaba).
- Versiune 0.4.0 în `manifest.json` + `package.json`; README (funcții noi + „AI local cu
  Gemini Nano” + limitare onestă: Profesorul apare doar unde Chrome are modelul);
  VERIFICARE.md rescris pentru ce verifică Andrei acum; capturi regenerate (bandă, exersare;
  cardul Profesorului nu se poate captura din Chromium — captură manuală de la Andrei sau
  rămâne descris în text).
- `npm run test:package`; commit + push.

**Poarta 7:** arhiva se dezarhivează și se încarcă curat; `npm test` + `test:package` verzi.

---

## Backlog (se adaugă la cel din PLAN-reparatii-audit, nu se lucrează acum)

- Pagina de opțiuni e încă pe verdele vechi (teal) — de trecut pe albastrul de brand #3058F0.
- Metronom / count-in la intrarea în loop-ul de exersare.
- Întrebare liberă la Profesor (v1 are doar cele 3 fixe).
- „Mai puțin la final” — Andrei a semnalat vag o detecție mai slabă la sfârșitul unei melodii;
  de cerut link-ul și de investigat separat dacă revine.
