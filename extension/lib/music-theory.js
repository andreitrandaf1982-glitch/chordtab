// Teorie muzicală pură — fără chrome.*, testabilă în node (tests/music-theory.test.mjs).
// Scris de Fable la kickoff. Nu rescrie; dacă pare greșit ceva, rulează întâi testele.

export const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const FLAT_TO_SHARP = {
  Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B', Fb: 'E',
  'E#': 'F', 'B#': 'C',
};

export const NO_CHORD = 'N.C.';

// Forme "deschise" pe care un amator le cântă confortabil fără barré.
export const OPEN_SHAPES = new Set([
  'C', 'A', 'G', 'E', 'D',
  'Am', 'Em', 'Dm',
  'C7', 'A7', 'G7', 'E7', 'D7', 'B7',
  'Am7', 'Em7', 'Dm7',
  'Cmaj7', 'Amaj7', 'Gmaj7', 'Emaj7', 'Dmaj7', 'Fmaj7',
  'Asus2', 'Dsus2', 'Esus4', 'Asus4', 'Dsus4',
]);

export function normalizeNote(note) {
  if (!note) return null;
  const clean = note[0].toUpperCase() + note.slice(1);
  const mapped = FLAT_TO_SHARP[clean] || clean;
  return NOTES.includes(mapped) ? mapped : null;
}

// "F#m7/A" -> { root:'F#', quality:'m7', bass:'A' }; N.C./necunoscut -> null
export function parseChord(label) {
  if (!label || label === NO_CHORD) return null;
  const [main, bassRaw] = label.split('/');
  const m = main.match(/^([A-Ga-g][b#]?)(.*)$/);
  if (!m) return null;
  const root = normalizeNote(m[1]);
  if (!root) return null;
  const bass = bassRaw ? normalizeNote(bassRaw) : null;
  if (bassRaw && !bass) return null;
  return { root, quality: m[2] || '', bass };
}

export function chordToString({ root, quality, bass }) {
  return root + quality + (bass ? '/' + bass : '');
}

export function transposeNote(note, semitones) {
  const n = normalizeNote(note);
  if (n == null) return null;
  const idx = (NOTES.indexOf(n) + semitones) % 12;
  return NOTES[(idx + 12) % 12];
}

export function transposeChord(label, semitones) {
  const chord = parseChord(label);
  if (!chord) return label; // N.C. și etichetele neînțelese trec neschimbate
  return chordToString({
    root: transposeNote(chord.root, semitones),
    quality: chord.quality,
    bass: chord.bass ? transposeNote(chord.bass, semitones) : null,
  });
}

// Primește etichetele acordurilor detectate (cu repetiții — frecvența contează).
// Întoarce cea mai bună poziție de capo (0..maxCapo): cea care transformă cât mai mult
// din melodie în forme deschise. La egalitate câștigă capo-ul mai mic.
export function bestCapo(labels, maxCapo = 7) {
  const counts = new Map();
  for (const label of labels) {
    if (!parseChord(label)) continue;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return { capo: 0, score: 0, played: new Map(), total: 0 };

  let best = null;
  for (let capo = 0; capo <= maxCapo; capo++) {
    const played = new Map();
    let openWeight = 0;
    for (const [label, count] of counts) {
      const playedLabel = transposeChord(label, -capo);
      played.set(label, playedLabel);
      if (OPEN_SHAPES.has(playedLabel)) openWeight += count;
    }
    const score = openWeight / total;
    if (!best || score > best.score) best = { capo, score, played, total };
  }
  return best;
}
