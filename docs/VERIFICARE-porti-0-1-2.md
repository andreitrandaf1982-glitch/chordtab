# Verificare în Chrome — Porțile 0, 1 și 2

Codul e scris și testat cât se poate fără browser (motorul de acorduri: 8/8 acorduri corecte
în teste automate). Ce urmează **nu poate fi verificat decât de un om cu Chrome deschis**.

Cele trei porți se verifică într-o singură sesiune, fiindcă fiecare lasă în consolă o urmă
**distinctă** — dacă una pică, se vede exact care.

---

## Instalare (o singură dată)

1. Deschide `chrome://extensions`
2. Pornește **Developer mode** (colț dreapta-sus)
3. **Load unpacked** → alege folderul `extension/`
4. Extensia apare cu o iconiță verde-petrol (gât de chitară). Prinde-o în bara de sus
   (click pe puzzle → pin), ca s-o ai la îndemână.

**Dacă apar erori roșii chiar aici, oprește-te** și trimite-mi textul lor — înseamnă că
manifestul sau un fișier are o problemă, și n-are rost să mergi mai departe.

---

## Poarta 0 — motorul de acorduri merge în browser

Documentul offscreen se creează abia la prima captură, deci întâi pornește o analiză (pasul de
mai jos), apoi deschide consola lui:

1. Pe `chrome://extensions`, la ChordTab, click pe linkul **„offscreen.html"** de la
   *Inspect views* (apare doar cât timp captura e pornită).
2. În consola care se deschide, caută linia:

```
[ChordTab:analyzer] [POARTA 0] chord=C (conf 1.00) — CORECT ✔
```

**Trecut dacă:** scrie `chord=C ... CORECT ✔`.
**Picat dacă:** scrie `GREȘIT` sau apare `Auto-testul Essentia a eșuat`. Trimite-mi mesajul.

---

## Poarta 1 — captura audio funcționează, fără să taie sunetul

1. Deschide un video pe YouTube (unul cu muzică simplă — vezi recomandările de la Poarta 2).
2. Dă play.
3. Click pe iconița ChordTab.

**Trecut dacă toate trei:**
- **Auzi în continuare melodia.** (Ăsta e cel mai important. Dacă se face liniște, s-a rupt
  legătura sursă→destinație din offscreen — spune-mi imediat.)
- Sub video apare panoul ChordTab cu textul **„Ascult…"**.
  (Panoul apare întâi în colțul din dreapta-jos și se mută singur sub video în câteva
  secunde — e normal, așa e construit.)
- În consola offscreen curg linii de forma:
  ```
  [ChordTab:offscreen] [POARTA 1] RMS=0.0842 @video t=12.3s
  ```
  **RMS trebuie să fie mai mare decât 0** cât timp cântă melodia. Dacă e mereu `0.0000`,
  captura merge dar nu primește sunet.

4. Click din nou pe iconiță → captura se oprește, panoul revine la starea inițială.

---

## Poarta 2 — acordurile detectate sunt cele reale

Lasă captura pornită 30–60 de secunde pe una din melodiile astea (alese fiindcă au acorduri
simple, clare și binecunoscute):

| Melodie | Acorduri așteptate |
|---|---|
| Bob Dylan — *Knockin' on Heaven's Door* | G, D, Am, C (ciclic) |
| Ben E. King — *Stand by Me* | A, F#m, D, E |

În consola offscreen vei vedea linii de forma:

```
[ChordTab:analyzer] acord: G (conf 0.78) @ 14.2s
[ChordTab:analyzer] acord: D (conf 0.65) @ 16.1s
```

**Trecut dacă:** acordurile care apar sunt **majoritar cele din tabel**, în ordinea aia ciclică.
Nu trebuie să fie perfect — la Pasul 3 urmează netezirea, care taie exact zgomotul ăsta.
Câteva acorduri greșite printre ele sunt normale în etapa asta.

**Picat dacă:** acordurile n-au nicio legătură cu melodia (ex. tot felul de acorduri aleatorii,
sau mereu același acord). Atunci Poarta 0 și 1 tot au valoare — știm că problema e în
detecție, nu în captură.

---

## Ce-mi trimiți înapoi

Cel mai util: **o captură de ecran a consolei offscreen** după ~1 minut de melodie, plus
răspunsul la trei întrebări scurte:

1. Se auzea melodia în continuare? (da / nu)
2. Ai văzut panoul „Ascult…" sub video? (da / nu)
3. Acordurile din consolă semănau cu cele din tabel? (da / parțial / deloc)

Cu asta știu exact la ce pas continuăm.

---

## Dacă ceva crapă urât

Consolele utile sunt trei, și fiecare arată altă bucată:
- **service worker** (`chrome://extensions` → *Inspect views: service worker*) — pornirea/oprirea capturii
- **offscreen.html** — captura audio + detecția (aici e cea mai multă informație)
- **consola paginii YouTube** (F12) — panoul și ceasul video

Toate mesajele extensiei încep cu `[ChordTab:...]`, deci le poți filtra scriind `ChordTab`
în caseta de filtrare a consolei.
