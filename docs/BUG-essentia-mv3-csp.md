# BUG — Essentia.js nu poate rula într-o extensie Manifest V3

**Data:** 2026-08-24 · **Găsit de:** Opus, la Pasul 0 · **Stare:** ÎNCHIS — s-a trecut pe
fallback-ul prevăzut în plan (chroma proprie). Documentul rămâne ca urmă a deciziei.

## Simptom

La încărcarea modulului WASM într-o pagină de extensie (documentul offscreen):

```
EvalError: Evaluating a string as JavaScript violates the following Content Security Policy
directive because 'unsafe-eval' is not an allowed source of script: script-src 'self' 'wasm-unsafe-eval'
```

## Reproducere

```bash
npm install && npx playwright install chromium
node tests/browser-selftest.mjs      # încarcă extensia în Chromium și rulează auto-testul
```

Testele Node treceau (8/8 acorduri) — **doar browserul cade**. De aceea a fost nevoie de o
verificare în browser real, nu doar în Node: mediul, nu algoritmul, era problema.

## Cauza reală

`essentia-wasm.es.js` e generat cu **emscripten + embind**. Embind construiește funcțiile de
legătură cu C++ **ca text**, apoi le materializează prin constructorul `Function` — ceea ce
CSP-ul MV3 interzice. `wasm-unsafe-eval` permite compilarea WebAssembly, dar **nu** evaluarea
de șiruri ca JavaScript. Sunt lucruri diferite, ușor de confundat.

Stack trace-ul arată clar traseul:

```
at Function (<anonymous>)
at new_               (essentia-wasm.es.js)
at craftInvokerFunction
at registerType
at __embind_register_void
```

## Ce s-a încercat

**Încercarea 1 — vendorizare ca atare.** Cade la `__embind_register_void`, adică la
inițializarea modulului: nu e o cale ocolitoare, e chiar pornirea.

**Încercarea 2 — peticirea locurilor care evaluează text** (`tools/vendor-essentia.mjs`).
Am rescris ca închideri echivalente `createNamedFunction`, `makeDynCaller` și
`craftEmvalAllocator`. Toate trei s-au aplicat curat, fișierul parsează, `new Function(` a
dispărut din sursă — **și tot cade**.

Motivul: apelul real e scris `new_(Function, args1)`, nu `new Function(...)`, așa că o căutare
textuală după `new Function(` nu-l găsește. Iar el trăiește în **`craftInvokerFunction`**,
care compune din text întreaga funcție de conversie a argumentelor **pentru fiecare metodă
C++ legată**. Nu e un loc izolat, e mecanismul central al embind. A-l înlocui înseamnă a
reimplementa marshalling-ul embind — disproporționat și fragil.

## Ce ar mai fi fost posibil (și de ce nu s-a ales)

- **Recompilare Essentia din C++ cu `-sDYNAMIC_EXECUTION=0`** — corect în principiu, dar cere
  tot lanțul emscripten + build C++. Disproporționat pentru proiectul ăsta.
- **Pagină `sandbox` în manifest** (CSP relaxat, comunicare prin postMessage) — ar funcționa,
  dar planul spune explicit „nu improviza alt fallback", iar cel prevăzut are avantaje reale
  (vezi mai jos).

## Decizia

S-a trecut pe **fallback-ul scris în plan la Pasul 0**: chroma calculată în casă
(FFT + vârfuri spectrale + profil de clase de înălțime) și potrivire pe șabloane de acorduri.

Avantaje colaterale, care nu erau evidente când s-a scris planul:

- **Dispare licența AGPL-3.0** impusă de essentia.js. Extensia poate fi licențiată liber —
  contează dacă Andrei vrea vreodată să construiască pe ea altfel.
- **Dispar 2,44 MB de cod străin** din extensie.
- **Dispare orice risc de CSP** — e cod propriu, fără WebAssembly și fără evaluare de text.
- Codul devine **de înțeles**, ceea ce contează: scopul declarat al proiectului e învățarea.

Dezavantaj asumat: acuratețea trebuie demonstrată, nu moștenită. De aceea suita de teste
(aceleași 8 acorduri, la 44100 și 48000 Hz) a fost păstrată și aplicată noii implementări.

## Ce rămâne din munca pierdută

Nu s-a pierdut tot: `tests/browser-selftest.mjs` (verificarea automată în Chromium real) a
apărut din bug-ul ăsta și rămâne folositoare la fiecare pas de acum înainte. Fără ea,
problema ar fi ieșit la iveală abia pe calculatorul lui Andrei, mult mai târziu.
