# PLAN — Banda rulantă și modul de exersare (țintă: v0.4.0)

Scris de Fable pe 2026-08-25, după feedbackul lui Andrei pe v0.3.0: „e ok, dar pare
contra-intuitivă, greoaie, nu face mai mult decât să arate acorduri static; foaia pare
învechită… VREAU MULT MAI MULT CALITATIV.” Executat de Opus, pas cu pas; fiecare pas se
încheie cu poarta lui bifată și un commit descriptiv. La blocaj: regula celor două încercări
→ `docs/BUG-<slug>.md` → escaladare pe Fable.

Înlocuiește `PLAN-banda-si-profesor.md` (șters în aceeași zi — vezi deciziile de mai jos).

## Decizii de produs (nu se renegociază în execuție)

- **„Extensia te ascultă la microfon” — RESPINSĂ de Andrei** (2026-08-25): chitările
  amatorilor sunt des dezacordate, verdictul verde/roșu ar părea defectul extensiei.
  NU o reintroduce, nici ca opțiune.
- **„Profesorul AI” pe Gemini Nano — RESPINS de Andrei** (2026-08-25, în aceeași zi în care
  fusese propus): fiecare utilizator ar trebui să descarce 2–4 GB și să aibă un calculator
  care trece cerințele (placă video cu >4 GB VRAM) — majoritatea comunității și a juriului
  NU le trece, deci funcția ar fi invizibilă exact pentru oamenii care contează. Contra
  promisiunii „instalezi și merge”. NU reintroduce — nici Nano, nici alt model descărcabil.
- Rămân regulile vechi: **zero servere, zero chei, zero descărcări** în afara arhivei;
  capo-ul sugerat NU se aplică automat; fără detecție de acordaj (drop D & co.).
- Povestea produsului pentru concurs: *îți arată ce vine (banda) → te lasă să exersezi pe
  bucăți, încetinit, fără să se schimbe tonul (loop + viteză)*.
- După livrarea v0.4.0: UN singur adversarial pe toată extensia, înainte de trimiterea la
  concurs. Nu se face audit intermediar.

---

## STARE: toți pașii executați (Opus, 2026-08-25) — v0.4.0 livrată

| Pas | Stare | Commit |
|---|---|---|
| 0 — nume de secțiuni | ✅ Poarta 0 trecută (31 verificări UI + captură) | `d061912` |
| 1–3 — banda rulantă | ✅ Poarta 3 trecută (36 verificări, inclusiv reduced-motion) | `c370928` |
| 4 — exersare | ✅ Poarta 4 trecută (42 verificări) | `0097d6f` |
| 5 — ambalare | ✅ Poarta 5 trecută | acest commit |

**Abatere conștientă de la plan, la Pasul 4:** butonul ⟳ e doar pe rândurile foii, nu și pe
segmentele barei — un `<button>` în interiorul altui `<button>` e HTML invalid. Bara rămâne
pentru salt, foaia pentru exersare.

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

**Poarta 0:** `npm test` verde; captura `panou-structura.png` regenerată arată numele noi.

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

## Pasul 5 — Ambalare v0.4.0

- Versiune 0.4.0 în `manifest.json` + `package.json`; README actualizat (banda rulantă,
  exersarea pe bucăți cu încetinire fără schimbarea tonului, numele de secțiuni);
  VERIFICARE.md rescris pentru ce verifică Andrei acum; capturi regenerate (bandă, exersare).
- `npm run test:package`; commit + push.

**Poarta 5:** arhiva se dezarhivează și se încarcă curat; `npm test` + `test:package` verzi.

---

## Backlog (se adaugă la cel din PLAN-reparatii-audit, nu se lucrează acum)

- Pagina de opțiuni e încă pe verdele vechi (teal) — de trecut pe albastrul de brand #3058F0.
- Metronom / count-in la intrarea în loop-ul de exersare.
- „Mai puțin la final” — Andrei a semnalat vag o detecție mai slabă la sfârșitul unei melodii;
  de cerut link-ul și de investigat separat dacă revine.
