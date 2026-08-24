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

  // capo & transpoziție
  capo: 'Capo',
  noCapo: 'fără',
  // Când sugestia e „fără”, butonul aprins spune deja totul — nu repetăm.
  capoSuggested: (n) => (n === 0 ? '' : `sugerat: ${n}`),
  tuning: 'Acordaj',
  tuningHelp: 'Schimbă digitațiile pentru chitare acordate altfel. Nu putem ghici acordajul din '
    + 'sunet — basul cântă în același registru — deci alegi tu.',
  transpose: 'Ton',
  transposeValue: (n) => (n === 0 ? '0' : n > 0 ? `+${n}` : `${n}`),
  reset: 'Resetează',

  // explicații la hover
  capoHelp: 'Cu capo pe poziția asta, cânți formele afișate și suni la fel ca în melodie.',
  transposeHelp: 'Schimbă tonalitatea (nu se mai potrivește cu înregistrarea, dar poate fi mai comod de cântat).',
  noDiagram: 'Diagramă indisponibilă',
  savedAt: (d) => `analizat ${d}`,
};
