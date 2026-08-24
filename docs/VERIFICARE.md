# Verificare în Chrome — pasul curent: **Poarta 3 (netezirea)**

Document viu: descrie mereu ce e de verificat ACUM. Ce s-a trecut deja rămâne mai jos, pe scurt.

---

## Ce s-a schimbat față de data trecută

Ai raportat că acordurile „se schimbă la fiecare sunet" și urmăresc linia melodică, nu acordul.
Aveai dreptate, și s-a putut măsura: pe un semnal de test construit special (progresie + melodie
mai tare decât acordul + percuție), detectorul nimerea acordul doar **28% din timp** și emitea
**51 de schimbări în 16 secunde**. De necitit, exact cum ai spus.

Acum, pe același test: **97% din timp** și **exact 4 schimbări** — câte acorduri sunt.

Două lucruri s-au reparat, nu unul:

1. **Memoria.** Înainte, fiecare fragment de 170 ms decidea singur — deci urmărea ce se aude mai
   tare atunci: o notă de melodie, o tobă, basul. Acum se ia media pe ~1,2 secunde, iar un acord
   nou trebuie să câștige neîntrerupt ~0,45 s ca să fie afișat. Notele trecătoare se estompează,
   armonia care ține rămâne.
2. **Basul decide fundamentala.** Confuzia clasică: un Sol major cu un Fa# trecător în melodie
   conține exact un Si minor, iar programul alegea Si minor. Acum cea mai joasă notă spune care
   e fundamentala — cum face și un chitarist când ascultă.

**Ce să te aștepți:** o întârziere de aproximativ o secundă la schimbarea acordului. E prețul
stabilității și e de așteptat. Dispare la Pasul 5, când melodia se redă din memorie și avem
cronologia completă (atunci acordurile pot fi afișate chiar puțin înainte).

---

## Ce ai de făcut (aceleași 3 minute ca data trecută)

1. Pe `chrome://extensions`, la ChordTab, apasă **Reload** (săgeata circulară) — altfel rulează
   versiunea veche.
2. Deschide una din melodiile de mai jos, dă play, apasă iconița.
3. Lasă-l 60–90 de secunde și **uită-te la panoul de sub video**, nu la consolă.

| Melodie | Acorduri așteptate |
|---|---|
| Bob Dylan — *Knockin' on Heaven's Door* | G, D, Am, C (ciclic) |
| Ben E. King — *Stand by Me* | A, F#m, D, E |

---

## Ce înseamnă „trecut"

**Trecut** dacă, urmărind panoul:
- acordul stă pe loc destul cât să-l poți citi (nu mai pâlpâie la fiecare notă);
- acordurile care apar sunt **majoritar** cele din tabel, în ordinea aia ciclică;
- din 10 momente în care te uiți, în cel puțin 7 acordul afișat e cel corect.

**Nu e nevoie să fie perfect.** Ținta scrisă în plan e 70% din timp. Pe refrenuri și pasaje
liniștite ar trebui să fie foarte bun; pe pasaje aglomerate va mai greși.

**Picat** dacă acordurile tot n-au legătură cu melodia, sau dacă acum stau pe loc dar sunt
constant greșite (ex. mereu cu un ton mai sus).

---

## Ce-mi trimiți înapoi

Trei răspunsuri scurte îmi ajung:

1. Acordurile stau pe loc destul cât să le citești? (da / nu)
2. Din 10 momente, în câte era acordul corect? (o estimare, nu trebuie numărat exact)
3. Pe ce melodie ai încercat?

Dacă vezi o greșeală sistematică (ex. „îmi dă mereu Em în loc de G"), scrie-mi-o — genul ăsta
de tipar e cel mai ușor de reparat.

---

## Ce urmează după, ca să știi

- **Pasul 4** — panoul propriu-zis: acordul curent mare, următorul, banda cu ultimele acorduri.
- **Pasul 5** — memorarea per melodie: a doua oară apar instant și perfect sincronizate.
- **Pasul 6** — capo și transpoziție („n-am capo" → îți dă forme deschise).
- **Pasul 7** — **click pe acord → diagrama pe corzi.** Asta ai încercat și n-a mers: încă nu e
  construită. Vine la pasul 7, cu tot cu explicația acordului.
- **Idee nouă, de la tine:** tiparul principal pe secțiuni (strofă / refren / punte). Nu e în
  planul inițial și cere un pic de gândire — se face după Pasul 5, fiindcă are nevoie de
  cronologia întreagă a melodiei ca să găsească ce se repetă.

---

## Porți deja trecute

- **Poarta 0** (motorul de acorduri merge în browser) — automatizată: `npm test` încarcă
  extensia într-un Chromium real și verifică sub CSP-ul autentic.
- **Poarta 1** (captura audio, fără să taie sunetul) — trecută: melodia se aude, panoul apare.
- **Poarta 2** (acordurile au legătură cu melodia) — trecută parțial: acordurile erau plauzibile,
  dar instabile. Instabilitatea e obiectul Pasului 3, de mai sus.

## Unde te uiți dacă ceva crapă

Trei console, fiecare cu altă bucată:
- **service worker** (`chrome://extensions` → *Inspect views: service worker*) — pornirea capturii
- **offscreen.html** (apare doar cât captura e pornită) — analiza audio, cele mai multe detalii
- **consola paginii YouTube** (F12) — panoul și ceasul video

Toate mesajele încep cu `[ChordTab:...]`, deci le poți filtra scriind `ChordTab` în consolă.
