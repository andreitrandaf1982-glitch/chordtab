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
  sectionLabel: (letter, name) => (name ? `${letter} · ${name}` : `Partea ${letter}`),
  freeSection: (name) => name || 'Liber',
  jumpTo: (label) => `Sari la ${label}`,
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
