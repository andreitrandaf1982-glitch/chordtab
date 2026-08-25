// Toate textele UI, într-un singur loc, în română. Nimic hardcodat prin alte fișiere.

export const STR = {
  title: 'ChordTab',

  // --- ghidul: extensia trebuie să-și explice SINGURĂ cele două faze ---
  //
  // Fără asta, cine o încearcă prima oară vede în timpul analizei doar niște acorduri care
  // trec și nu are de unde să știe că partea frumoasă (banda, secțiunile, exersarea) vine
  // abia după ce melodia s-a terminat. Linia „Pasul N" e mereu vizibilă; butonul portocaliu
  // deschide povestea întreagă.
  guideButton: 'Cum se folosește',
  guideClose: 'Am înțeles',
  guideTitle: 'ChordTab în două minute',
  guideSteps: [
    ['Pasul 1 — ascult melodia',
      'Dă play și apasă „Analizează". Extensia ascultă sunetul tabului și scoate acordurile, '
      + 'local, în browserul tău. Poți cânta pe ele din prima, dar apar cu vreo secundă '
      + 'întârziere: au nevoie de context ca să nu se răzgândească la fiecare notă.'],
    ['Pasul 2 — melodia întreagă',
      'Când melodia se termină, analiza se oprește singură și panoul se schimbă: acordurile '
      + 'curg pe bandă spre linia „acum", apare structura (strofă, refren) și foaia melodiei. '
      + 'Dacă vrei mai devreme, apasă „Oprește". Ce s-a analizat rămâne memorat, deci a doua '
      + 'oară melodia se deschide gata învățată.'],
    ['Exersează pe bucăți',
      'La melodiile cu secțiuni, butonul ⟳ de lângă o secțiune din foaie o pune pe repetat. '
      + 'O poți încetini la 0,75× '
      + 'sau 0,5× fără să se schimbe tonalitatea. „Gata" te scoate și îți dă înapoi viteza '
      + 'pe care o aveai.'],
    ['Capo și ton',
      'Capo îți spune pe ce poziție să-l pui ca să cânți forme deschise — sugestia e doar '
      + 'marcată, se aplică la un click. „Ton" transpune melodia, dacă vrei s-o cânți în '
      + 'altă tonalitate.'],
    ['Ce nu face',
      'Scoate acordurile principale, nu solouri sau tabs notă-cu-notă. Presupune acordaj '
      + 'standard. Pe mixuri foarte dense acuratețea scade.'],
  ],
  guidePrivacy: 'Nu cere cont, nu cere nicio cheie și nu trimite nimic nicăieri. '
    + 'Sunetul e analizat în browserul tău.',

  stepIdle: 'Pasul 1 din 2 — apasă „Analizează" și lasă melodia să curgă până la capăt: '
    + 'învăț acordurile ascultând.',
  // „12 acorduri”, dar „24 DE acorduri”: de la 20 în sus numeralul cere „de”.
  countOf: (n, word) => `${n}${n % 100 >= 1 && n % 100 <= 19 ? '' : ' de'} ${word}`,
  stepListening: (n) => `Pasul 1 din 2 — învăț melodia${n > 1 ? ` (${STR.countOf(n, 'acorduri')} până acum)` : ''}. `
    + 'Poți cânta pe acordurile de mai jos. Când melodia se termină, trec singură la Pasul 2: '
    + 'banda, secțiunile și exersarea.',
  stepPlayback: 'Pasul 2 din 2 — melodia e învățată. Click pe orice acord sau secțiune ca să '
    + 'sari acolo; ⟳ pune o secțiune pe repetat.',
  // Melodiile fără structură clară n-au secțiuni, deci n-au nici butonul ⟳ — nu-l promitem.
  stepPlaybackFlat: 'Pasul 2 din 2 — melodia e învățată. Click pe orice acord ca să sari acolo.',

  // stări
  idle: 'Apasă „Analizează" ca să scot acordurile',
  listening: 'Ascult… (acordurile apar cu ~1s întârziere)',
  playback: 'Acorduri memorate',
  analyzing: 'Se analizează…',
  liveUnavailable: 'Indisponibil pe transmisiuni live',
  needIconClick: 'Apasă iconița ChordTab din bara de sus ca să pornesc',
  noChordsYet: '—',

  // butoane
  start: 'Analizează',
  stop: 'Oprește',
  reanalyze: 'Analizează din nou',

  // acorduri
  upNext: 'urmează',
  recent: 'până acum',

  // structura melodiei
  structure: 'Structura',
  sheet: 'Foaia melodiei',
  wholeSong: 'Toată melodia',
  sectionNames: {
    intro: 'Intro',
    verse: 'Strofă',
    chorus: 'Refren',
    bridge: 'Punte',
    outro: 'Final',
  },
  // Numele secțiunilor sunt pentru OM, nu pentru algoritm: „A · Refren” și „Partea C” erau
  // limbaj de laborator („aia cu A liber, B CD, redenumește cumva” — Andrei). Litera rămâne
  // doar în interior, ca cheie și ca sursă de culoare. Numărul e ordinea primei apariții în
  // melodie, deci „Partea 2” e a doua bucată distinctă pe care o auzi.
  sectionLabel: (ordinal, name) => name || `Partea ${ordinal}`,
  freeSection: (name) => name || 'Trecere',
  jumpTo: (label) => `Sari la ${label}`,

  // exersare: o secțiune pusă pe repetat, cât vrei, la ce viteză vrei
  practiceOn: (label) => `Exersezi: ${label}`,
  practiceHelp: (label) => `Pune „${label}” pe repetat, ca să exersezi`,
  practiceStop: 'Gata',
  speed: 'viteză',
  // Virgulă zecimală, că așa se scrie în română.
  speedValue: (r) => `${String(r).replace('.', ',')}×`,
  times: (n) => `×${n}`,
  upNextSection: (label) => `urmează: ${label}`,

  // capo & transpoziție
  capo: 'Capo',
  noCapo: 'fără',
  // Când sugestia e „fără”, butonul aprins spune deja totul — nu repetăm.
  capoSuggested: (n) => (n === 0 ? '' : `sugerat: ${n}`),
  transpose: 'Ton',
  transposeValue: (n) => (n === 0 ? '0' : n > 0 ? `+${n}` : `${n}`),
  reset: 'Resetează',

  // explicații la hover
  capoHelp: 'Cu capo pe poziția asta, cânți formele afișate și suni la fel ca în melodie.',
  transposeHelp: 'Schimbă tonalitatea (nu se mai potrivește cu înregistrarea, dar poate fi mai comod de cântat).',
  noDiagram: 'Diagramă indisponibilă',
  savedAt: (d) => `analizat ${d}`,
};
