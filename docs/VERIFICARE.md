# Verificare în Chrome — pasul curent: **Pașii 4–7 (panou, memorie, capo, diagrame)**

Document viu: descrie mereu ce e de verificat ACUM. Ce s-a trecut deja rămâne mai jos, pe scurt.

---

## Ce s-a schimbat

Poarta 3 a trecut („toate momentele sunt corecte"), așa că am construit tot restul funcțional.
Panoul arată acum așa:

![Panoul ChordTab](capturi/panou.png)

**Pasul 4 — panoul.** Acordul curent (mare), diagrama lui, și **ce urmează**. La sing-along
contează ce vine, nu ce a fost.

**Pasul 5 — memorie per melodie.** După prima analiză, acordurile se salvează. A doua oară când
deschizi melodia apar **instant**, fără să mai analizezi nimic — și **fără întârzierea de o
secundă**, fiindcă avem cronologia completă și știm exact la ce secundă vine fiecare acord.

**Pasul 6 — capo și transpoziție.** Exact ce ai cerut la început: dacă melodia are capo,
extensia îți spune unde să-l pui ca să cânți forme deschise.

![Sugestie de capo](capturi/panou-capo.png)

„Wonderwall" sună F#m A E B — greu, numai acorduri cu bară. Cu capo 2 cânți Em G D A, adică
numai forme deschise. Bara verde din diagramă e capodastrul: pozițiile se numără de la el.

**Pasul 7 — diagramele.** Asta ai încercat să apeși și nu mergea. Acum diagrama acordului curent
stă **permanent** lângă el. Dacă treci cu mouse-ul peste un acord care urmează, îți arată
diagrama lui, apoi revine.

---

## Ce ai de făcut

1. Pe `chrome://extensions`, la ChordTab, apasă **Reload**.
2. Deschide o melodie, dă play, apasă iconița. Lasă-l să analizeze un minut-două.
3. Apasă **Oprește** (sau iconița din nou). Acordurile se salvează automat.
4. **Dă refresh la pagină** — aici e partea interesantă: acordurile trebuie să apară instant,
   fără să mai analizezi, și sincronizate exact.
5. Derulează prin melodie (dă click pe bara de progres). Acordul afișat trebuie să sară imediat
   la cel potrivit.
6. Apasă pe pozițiile de **capo** și pe **± ton** și uită-te cum se schimbă acordurile și diagrama.

---

## Ce mă interesează să-mi spui

1. După refresh, acordurile au apărut instant și sincronizate? (da / nu)
2. Când ai derulat prin melodie, acordul a sărit unde trebuie? (da / nu)
3. Diagramele arată bine? Le recunoști ca fiind digitațiile corecte? (da / nu / care greșește)
4. Sugestia de capo ți s-a părut rezonabilă pe melodia ta?
5. Ceva la aspectul panoului care te deranjează?

La punctul 3 ai avantajul că știi chitară — dacă vezi o digitație care nu e cea pe care o
cânți tu, spune-mi care acord. Toate au fost verificate automat (se calculează ce note ies din
corzi și se compară cu notele acordului), dar există mai multe digitații corecte pentru același
acord și s-ar putea să nu fie cea cu care ești obișnuit.

---

## Ce mai rămâne

- **Pasul 8** — trecerea de logging (mesajele de debug se sting implicit).
- **Pasul 9** — ambalarea pentru comunitate: instrucțiuni, arhivă, test pe un Chrome curat.
- **Ideea ta cu tiparul pe secțiuni** (strofă / refren / punte) — acum se poate face, fiindcă
  avem cronologia completă în memorie. Nu e în planul inițial și cere puțină gândire de
  arhitectură, deci ăla e momentul să treci pe Fable.

---

## Porți deja trecute

- **Poarta 0** (motorul merge în browser) — automatizată în `npm test`.
- **Poarta 1** (captura audio, fără să taie sunetul) — trecută.
- **Poarta 2** (acordurile au legătură cu melodia) — trecută.
- **Poarta 3** (netezirea) — trecută pe muzică reală: „toate momentele sunt corecte".
- **Porțile 4–7** — verificate automat într-un Chromium real (`npm test`, 12 verificări).
  Rămâne confirmarea ta pe o melodie adevărată.

## Unde te uiți dacă ceva crapă

Trei console, fiecare cu altă bucată:
- **service worker** (`chrome://extensions` → *Inspect views: service worker*) — pornirea capturii
- **offscreen.html** (apare doar cât captura e pornită) — analiza audio
- **consola paginii YouTube** (F12) — panoul, memoria și redarea

Toate mesajele încep cu `[ChordTab:...]`, deci le poți filtra scriind `ChordTab` în consolă.
