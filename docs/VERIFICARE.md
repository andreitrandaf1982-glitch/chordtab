# Verificare în Chrome — **Etapa 1 completă**

Document viu: descrie mereu ce e de verificat ACUM.

---

## Ce s-a schimbat în ultima rundă

**Pâlpâitul e reparat.** Aveai dreptate că era ceva rău, și erau două cauze. Principala: caseta
diagramei își schimba mărimea când n-avea ce arăta, ceea ce muta tot panoul, îți scotea cursorul
de pe acord, diagrama revenea, panoul se muta la loc — de zeci de ori pe secundă. Acum caseta are
mărime fixă, plină sau goală. Un test ține cursorul nemișcat o secundă și jumătate și numără
schimbările; dacă trec de trei, cade.

**Memoria e reparată.** Tot două bug-uri. Acordurile se salvau doar dacă apăsai explicit
„Oprește" — un refresh în timpul analizei pierdea tot. Acum se salvează din mers. Iar al doilea,
găsit scriind testul: citirea din memorie e asincronă și, dacă porneai analiza imediat după
deschiderea paginii, memoria veche se scria peste analiza tocmai pornită.

**Culoarea** e acum albastrul din logo-ul tău, `#3058F0`.

**Drop D scos**, cum ai cerut.

**Logurile sunt stinse implicit** (Pasul 8) — consola rămâne curată pentru cine folosește
extensia. Se pornesc din pagina de opțiuni când vrei să vezi ce se întâmplă.

**Arhiva pentru comunitate** e gata (Pasul 9): `npm run build` face un `.zip` de 32 KB.

---

## Ce te rog să verifici

Reload la extensie, apoi:

1. **Pâlpâitul.** Pune melodia pe pauză și plimbă mouse-ul peste acordurile care urmează.
   Trebuie să fie complet liniștit.
2. **Memoria.** Analizează un minut, apoi dă refresh **fără să apeși Oprește**. Acordurile
   trebuie să fie acolo, în modul „Acorduri memorate".
3. **Derularea.** Sari prin melodie cu bara de progres — acordul trebuie să sară unde trebuie.
4. **Culoarea și aspectul.** Spune-mi dacă albastrul e cel potrivit.
5. **Diagramele.** Tu știi chitară — dacă vreo digitație nu e cea pe care o cânți, zi-mi care.

---

## Ce înseamnă că Etapa 1 e completă

Tot ce era în plan e făcut și verificat:

| | Ce face | Cum e verificat |
|---|---|---|
| 0 | Motorul de detecție (FFT → chroma → acorduri) | 8/8 acorduri, la 44100 și 48000 Hz |
| 1 | Captura audio fără să taie sunetul | manual, de tine |
| 2 | Acordurile urmăresc melodia | manual, de tine |
| 3 | Netezirea | 28% → 97% acuratețe, 51 → 4 schimbări |
| 4 | Panoul | 15 verificări într-un Chromium real |
| 5 | Memoria per melodie | idem, inclusiv refresh în timpul analizei |
| 6 | Capo și transpoziție | idem |
| 7 | Diagramele | 44 de digitații verificate muzical |
| 8 | Logurile | consola tace cu debug oprit, vorbește cu el pornit |
| 9 | Arhiva | dezarhivată și încărcată automat, ca un utilizator |

`npm test` rulează tot. `npm run test:package` verifică arhiva.

---

## Ce urmează

**Ideea ta cu tiparul pe secțiuni** — strofă, refren, punte. Acum se poate face: avem cronologia
completă în memorie, deci se pot căuta repetițiile.

**Ăsta e momentul să treci pe Fable.** E funcție nouă, nu e în plan, și cere decizii pe care nu
le poți lua din mers: ce înseamnă „o secțiune", cum decizi că două pasaje sunt același refren,
ce faci când melodia nu se repetă curat. Pe Fable facem întâi planul, apoi îl execuți pe Opus —
exact ritualul obișnuit.

Până atunci, mai poți cere oricând ajustări de aspect sau reglaje — alea rămân clasă Opus.

---

## Unde te uiți dacă ceva crapă

Pornește **Debug logging** din pagina de opțiuni, apoi:
- **service worker** (`chrome://extensions` → *Inspect views: service worker*) — pornirea capturii
- **offscreen.html** (apare doar cât captura e pornită) — analiza audio
- **consola paginii YouTube** (F12) — panoul, memoria și redarea

Toate mesajele încep cu `[ChordTab:...]`, deci le poți filtra scriind `ChordTab`.
