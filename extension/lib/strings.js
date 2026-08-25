// Toate textele UI, într-un singur loc, în română. Nimic hardcodat prin alte fișiere.

export const STR = {
  title: 'ChordTab',

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
