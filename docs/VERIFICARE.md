# Verificare în Chrome — **v0.3.0: foaia melodiei + reparațiile auditului**

Document viu: descrie mereu ce e de verificat ACUM.

---

## Ce e nou: foaia melodiei

Asta ai cerut: „văd mereu doar patru acorduri… n-am ceva istoric să văd melodia sau să derulez
înainte-înapoi pe bucăți."

![Foaia melodiei](capturi/panou-structura.png)

Sub bara de structură, acum vezi **cântecul întreg** — un rând pentru fiecare secțiune, în
ordinea în care se cântă (nu dedublat ca înainte). Rândul în care ești e evidențiat, iar
**acordul care sună chiar acum e aprins în albastru**, ca să știi mereu unde te afli.

**Click pe orice acord te duce exact acolo.** Ăsta e derulatul pe bucăți: vrei să exersezi al
doilea refren, dai click pe el. Click pe eticheta secțiunii („B · Refren") sare la începutul ei.

Melodiile lungi se derulează în interiorul foii, ca panoul să nu crească peste tot ecranul.
Iar melodiile fără structură clară primesc tot o foaie — cu toate acordurile, tot clickabile.

---

## Ce s-a reparat din audit

Auditul adversarial a găsit 10 defecte reale. Cele pe care le-ai putea observa:

**Pauza de peste 30 de secunde nu mai rupe analiza.** Înainte, dacă puneai pauză și te
întorceai, acordurile nu mai apăreau, iar butonul „Oprește" ștergea ce se strânsese. Starea
capturii se ține acum într-un loc care supraviețuiește.

**F5 în timpul analizei** nu mai lasă o captură-fantomă care consuma resurse și inversa butonul.

**Reclamele nu se mai scriu peste melodie.** Ceasul intern îngheață când nu primește semnal,
deci acordurile reclamei nu mai ajung pe cronologia cântecului.

**Derularea înapoi în timpul analizei** nu mai strică ordinea acordurilor (și deci nici redarea
memorată). Memoria veche, dacă era deja stricată, se repară singură la încărcare.

**Panoul nu mai apare pe pagina principală YouTube** — doar pe paginile de video, unde are sens.

Plus două defecte de matematică pe care nu le puteai vedea, dar le auzeai: un acord ținut mult
timp putea fi suprimat definitiv după o detecție greșită, iar pasajele fără bas (fingerpicking,
capo sus) primeau tăcut un prag mai sever și ieșeau „N.C." degeaba.

Și una pentru comunitate: **arhiva se strica pentru utilizatorii de Mac și Linux**. Se
construia cu o unealtă Windows care scrie căile greșit. Acum se construiește corect, iar
build-ul refuză să producă o arhivă stricată.

---

## Ce te rog să verifici

Reload la extensie, apoi pe o melodie deja memorată:

1. **Foaia** — vezi cântecul întreg? Rândurile corespund cu ce auzi?
2. **Click pe un acord din foaie** — sare unde trebuie?
3. **Acordul aprins** se mișcă odată cu melodia, pe rândul corect?
4. **Proba de pauză**: pornește analiza, pune pauză 60 de secunde, reia. Acordurile trebuie să
   continue să apară.
5. **Proba de refresh**: în timpul analizei dă F5. După reîncărcare, apasă iconița — trebuie să
   pornească o analiză nouă, curat.
6. **Pagina principală YouTube** — panoul nu mai are voie să apară acolo.

---

## Starea proiectului

`npm test` = 30 de verificări doar în interfață, plus testele de algoritm.
`npm run test:package` verifică arhiva, inclusiv separatoarele din zip.
Arhiva v0.3.0: 23 de fișiere, 52 KB.

## Ce a rămas dinadins nereparat

Backlogul e scris la finalul [planului de reparații](docs/PLAN-reparatii-audit.md): în timpul
unei reclame panoul afișează acordul greșit (se corectează singur la final), memoria de acorduri
crește nelimitat, iar mixurile cu peste 10 bucle distincte confundă literele. Toate sunt
marginale — le luăm când și dacă devin supărătoare.
