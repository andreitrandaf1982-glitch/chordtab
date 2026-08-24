// Toate textele UI, într-un singur loc, în română. Nimic hardcodat prin alte fișiere.

export const STR = {
  title: 'ChordTab',
  idle: 'Apasă pe iconița extensiei ca să analizez melodia',
  listening: 'Ascult…',
  playback: 'Acorduri din memorie', // TODO(Pasul 5)
  liveUnavailable: 'Indisponibil pe transmisiuni live',
  capoSuggestion: (capo) => (capo === 0 ? 'Fără capo' : `Capo ${capo}`), // TODO(Pasul 6)
  noDiagram: 'Diagramă indisponibilă', // TODO(Pasul 7)
};
