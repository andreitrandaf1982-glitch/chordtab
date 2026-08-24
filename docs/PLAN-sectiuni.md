# PLAN — Structura melodiei: strofă / refren / punte

> Scris de Fable, 2026-08-24, la cererea lui Andrei (feedback din Poarta 2: „să-mi scoți un
> pattern principal de vers, de refren, de punte — acum trebuie să le prind din zbor").
> **Pasul 0 e implementat de Fable** (miezul algoritmic + teste — acolo se pierd zilele).
> Pașii 1–3 îi execută Opus, în ordine, cu porțile bifate. Regula celor două încercări rămâne:
> 2 eșecuri pe același bug → `docs/BUG-<slug>.md` și escaladare pe Fable.
> După fiecare pas: commit + push (co-author Claude).

## Ce construim, în cuvintele utilizatorului

Din cronologia de acorduri memorată, extensia găsește singură **buclele care se repetă** și
împarte melodia în secțiuni: „strofa e G–D–Am–C, refrenul e Em–C–G–D, puntea e F–Fm". Sub video
apare o **bară a structurii** (click pe o secțiune = salt acolo) și o **legendă** cu tiparul
fiecărei secțiuni, afișat O SINGURĂ DATĂ, nu ca șir nesfârșit de acorduri.

## De ce se poate abia acum

În modul „memorat" avem cronologia completă a melodiei. Repetițiile se găsesc doar privind
melodia întreagă — de-aia funcția asta n-avea cum să existe în analiza live.

## Arhitectura decisă

**Tot calculul e într-un modul pur: `extension/lib/sections.js` (GATA, scris de Fable, testat).**
Fără chrome.*, fără DOM — primește cronologia + durata, întoarce structura. Se recalculează la
fiecare intrare în modul „memorat" (sub 50 ms; NU se salvează în storage — zero migrare de schemă).

```
detectSections(chords, duration) →
{
  sections: [{ start, end, cluster: 'A'|'B'|…|null, name: 'verse'|'chorus'|'bridge'|'intro'|'outro'|null, reps }],
  patterns: { A: { loop: [{ label, seconds }], period }, … },
  coverage: 0..1   // cât din melodie e acoperit de bucle repetate
}
```

Cum funcționează (pe scurt, ca să nu fie cutie neagră):
1. **Cuantizare**: cronologia devine „ce acord sună la fiecare 0,5 s".
2. **Căutare de perioade**: pentru fiecare moment și fiecare durată candidat (4–45 s), verificăm
   dacă fereastra următoare REPETĂ fereastra curentă (potrivire ≥70%). Cea mai mică perioadă
   care se susține câștigă. Gardă anti-dronă: o „buclă" cu un singur acord nu e buclă.
3. **Segmentare**: porțiuni consecutive cu aceeași perioadă = o secțiune; granițele se lipesc
   de cea mai apropiată schimbare de acord.
4. **Votul repetițiilor**: tiparul afișat al unei secțiuni NU e prima ei apariție, ci
   **consensul tuturor repetițiilor** — la fiecare poziție din buclă câștigă acordul majoritar.
   Efect important: o detecție greșită într-o repetiție e corectată de celelalte. Structura nu
   doar organizează acordurile, le și CURĂȚĂ.
5. **Grupare**: secțiunile cu bucle echivalente (comparate circular — aceeași buclă poate începe
   din alt punct) primesc aceeași literă: A, B, C, în ordinea apariției.
6. **Numire prudentă**: A (prima buclă) = strofă și cea mai frecventă altă buclă = refren, DOAR
   dacă există măcar două grupuri; segment unic la început = intro, la final = outro, unul
   singur la mijloc = punte. Orice altceva rămâne literă — un nume greșit e mai rău decât unul
   neutru. Numele sunt token-uri engleze în modul; româna vine din `strings.js`.

Cazuri degradate, tratate explicit (nu crapă, doar arată mai puțin):
- melodie fără repetiții (jazz, rubato) → o singură zonă „liberă", fără bară de structură;
- un singur acord ținut minute → idem (garda anti-dronă);
- înregistrări live cu tempo elastic → potrivirea slăbește; acceptat, notat în README.

## Pașii pentru Opus

### Pasul 0 — Miezul (FĂCUT de Fable — nu rescrie)
`lib/sections.js` + `tests/sections.test.mjs` (în `npm run test:unit`).
**POARTA 0 (trecută):** pe cronologii sintetice — structură A B A B punte B găsită corect
(granițe ±2 s), 12% acorduri corupte reparate de votul repetițiilor, fără-repetiții și dronă
tratate curat, determinism (două rulări → identic).

### Pasul 1 — Bara structurii + legenda (UI)
În modul „memorat" (DOAR acolo — live nu există structură încă), sub rândul cu acordul curent:

```
├─ A ──┤├─ B ─┤├─ A ──┤├─ B ─┤├C┤├─ B ─┤     ← bară proporțională cu timpul
A · Strofă   [G][D][Am][C]   ×6              ← legendă: tiparul O DATĂ + de câte ori
B · Refren   [Em][C][G][D]   ×6
C · Punte    [F][Fm]         ×1
```

- Bara: un segment per secțiune, colorat pe grup (A/B/C — nuanțe derivate din albastrul de
  brand #3058F0), segmentul curent evidențiat; **click pe segment → `video.currentTime = start`**.
- Legenda: chip-urile refolosesc `.ct-chip` + `attachChipHover` (hover → diagramă, EXACT ca
  restul panoului); etichetele trec prin `displayLabel()` (capo/transpoziția se aplică și aici).
- `coverage < 0.5` sau zero grupuri → bara și legenda nu se afișează deloc.
- Textele noi în `strings.js`: numele secțiunilor (verse→Strofă, chorus→Refren, bridge→Punte,
  intro→Intro, outro→Final), „Structura", tooltip „Sari la {nume}".
- Atenție la lecția pâlpâitului: bara se construiește O DATĂ la intrarea în modul memorat și
  doar clasa „segment curent" se schimbă la tick — nu reconstrui DOM-ul în bucla rAF.
**POARTA 1:** `tests/ui.test.mjs` extins: cronologie structurată în memorie → bara are numărul
corect de segmente, click pe al doilea segment mută `currentTime` la startul lui (±1 s), legenda
arată tiparul o singură dată cu ×reps, transpoziția schimbă și chip-urile legendei, iar pentru
o cronologie fără repetiții bara lipsește. Toate testele vechi rămân verzi.

### Pasul 2 — Secțiunea curentă în timpul redării
- Indicator lângă acordul curent: „Refren" (sau litera), actualizat din bucla rAF existentă
  (căutare binară în `sections`, ca la acorduri).
- „Urmează" devine conștient de structură: la mai puțin de ~3 s de granița unei secțiuni noi,
  arată și numele ei (ex. „urmează: Refren").
**POARTA 2:** test UI: la derulare în mijlocul secțiunii B, indicatorul arată numele lui B;
aproape de graniță apare anunțul. Manual (Andrei): pe 2 melodii reale structura „se simte" corectă.

### Pasul 3 — Ambalare
README (secțiune nouă cu captură), VERIFICARE.md rescris pentru runda asta, `npm run screenshot`
extins cu o captură a structurii, versiune 0.2.0, `npm run test:package`.
**POARTA 3:** toată suita verde + arhiva testată.

## Riscuri și decizii deja luate (nu le redeschide)

1. **Numirea secțiunilor e prudentă cu intenție.** Fără „probabil refren" afișat cu jumătate de
   gură — ori suntem rezonabil de siguri (tiparul alternanței), ori afișăm litera. 
2. **Structura nu se salvează în storage** — se recalculează. Zero migrare, iar îmbunătățirile
   viitoare ale algoritmului se aplică automat melodiilor deja memorate.
3. **Culorile grupurilor derivă din albastrul de brand**, nu paletă nouă — panoul rămâne al lui.
4. Melodia lui Andrei de test (Fink — Looking Too Closely: buclă de 4 acorduri aproape tot
   timpul) e cazul „un singur grup": bara va fi aproape uniformă, cu eventual intro/outro.
   E CORECT, nu e bug — melodia chiar e așa.
