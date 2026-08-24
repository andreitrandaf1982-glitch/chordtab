# Verificare în Chrome — **structura melodiei (v0.2.0)**

Document viu: descrie mereu ce e de verificat ACUM.

---

## Ce e nou

Funcția pe care ai cerut-o după Poarta 2: **tiparul pe secțiuni**.

![Structura melodiei](capturi/panou-structura.png)

**Bara structurii** arată din ce e făcută melodia: fiecare segment e o secțiune, colorată pe
grup. Click pe un segment și sari direct acolo — util când exersezi doar refrenul.

**Legenda** îți dă tiparul fiecărei secțiuni **o singură dată**: „A · Strofă: G D Am C, ×6".
Asta ai cerut — nu un șir nesfârșit de acorduri pe care trebuie să le prinzi din zbor.

**Indicatorul** de lângă acord îți spune în ce secțiune ești acum („B · REFREN"), iar cu ~3
secunde înainte de schimbare scrie „urmează: Strofă", ca să te pregătești.

Numirea e **prudentă cu intenție**: „Strofă" și „Refren" apar doar când tiparul alternanței e
limpede. Altfel vezi doar litera (A, B, C). Un nume greșit ar fi mai rău decât unul neutru.

Diagramele merg și în legendă — treci cu mouse-ul peste orice acord de acolo.

---

## Ce te rog să verifici

Reload la extensie, apoi pe o melodie deja memorată (sau analizează una nouă un minut-două):

1. **Apare bara?** Pe o melodie cu strofă și refren clare ar trebui să vezi segmente alternând.
2. **Click pe un segment** te duce acolo în melodie?
3. **Tiparele din legendă** sunt cele pe care le cânți? Aici e proba cea mai bună: tu știi
   melodia, deci vezi imediat dacă „Strofă: G D Am C" e adevărat.
4. **Indicatorul** se potrivește cu ce auzi? Când intri în refren, scrie „Refren"?
5. Pe **melodia ta de la Fink** — care e aproape o singură buclă tot cântecul — te aștepți la
   **o singură secțiune, fără nume**, cu ×mai multe. Ăsta e răspunsul corect, nu un bug:
   melodia chiar e așa.

---

## Ce să nu te sperie

- Pe melodii fără structură clară (jazz, improvizație, un acord ținut), **bara nu apare deloc**.
  E intenționat: mai bine nimic decât o structură inventată.
- Dacă oprești analiza pe la jumătatea melodiei, structura acoperă doar ce s-a analizat.
- Pe înregistrări live, cu tempo elastic, repetițiile se potrivesc mai slab.

---

## Starea proiectului

| | Ce face | Cum e verificat |
|---|---|---|
| 0–3 | Detecția acordurilor + netezirea | 97% acuratețe pe semnal ostil |
| 4–7 | Panou, memorie, capo, diagrame | Chromium real |
| 8–9 | Loguri, arhivă | consolă curată; arhiva dezarhivată și încărcată automat |
| **nou** | **Structura melodiei** | 10 grupuri de teste pe algoritm + 11 verificări de interfață |

`npm test` rulează tot (25 de verificări doar în interfață). `npm run test:package` verifică arhiva.

---

## Ce urmează

**Adversarialul pe toată extensia**, pe Fable — asta ai cerut. E momentul potrivit: extensia e
completă funcțional, deci merită o privire rea, care caută ce s-a stricat pe drum.

---

## Unde te uiți dacă ceva crapă

Pornește **Debug logging** din pagina de opțiuni. Mesajele încep cu `[ChordTab:...]`.
Structura loghează la intrarea în modul memorat: câte secțiuni, câte tipare, ce acoperire.
