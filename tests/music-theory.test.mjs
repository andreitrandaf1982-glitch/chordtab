// Rulare: node tests/music-theory.test.mjs  (din rădăcina proiectului)
import assert from 'node:assert/strict';
import {
  parseChord, chordToString, transposeChord, transposeNote, bestCapo, normalizeNote,
} from '../extension/lib/music-theory.js';

// normalizare + parsare
assert.equal(normalizeNote('Bb'), 'A#');
assert.equal(normalizeNote('Db'), 'C#');
assert.deepEqual(parseChord('F#m7/A'), { root: 'F#', quality: 'm7', bass: 'A' });
assert.deepEqual(parseChord('Bb'), { root: 'A#', quality: '', bass: null });
assert.equal(parseChord('N.C.'), null);
assert.equal(parseChord('???'), null);
assert.equal(chordToString(parseChord('F#m7/A')), 'F#m7/A');

// transpoziție
assert.equal(transposeNote('C', 1), 'C#');
assert.equal(transposeNote('C', -1), 'B');
assert.equal(transposeChord('Am', 3), 'Cm');
assert.equal(transposeChord('G', -2), 'F');
assert.equal(transposeChord('D/F#', 2), 'E/G#');
assert.equal(transposeChord('Bm7', 12), 'Bm7');
assert.equal(transposeChord('N.C.', 5), 'N.C.');

// capo: „Wonderwall” sună F#m A E B -> capo 2 -> Em G D A (toate deschise)
{
  const r = bestCapo(['F#m', 'A', 'E', 'B', 'F#m', 'A']);
  assert.equal(r.capo, 2);
  assert.equal(r.score, 1);
  assert.equal(r.played.get('F#m'), 'Em');
  assert.equal(r.played.get('B'), 'A');
}
// deja deschise -> capo 0 (la egalitate câștigă capo-ul mai mic)
{
  const r = bestCapo(['G', 'C', 'D', 'Em']);
  assert.equal(r.capo, 0);
  assert.equal(r.score, 1);
}
// N.C. și etichete invalide se ignoră fără să strice scorul
{
  const r = bestCapo(['N.C.', 'F#m', 'A', 'E', 'B', '???']);
  assert.equal(r.capo, 2);
  assert.equal(r.total, 4);
}
// fără acorduri valide -> capo 0, scor 0
{
  const r = bestCapo(['N.C.']);
  assert.equal(r.capo, 0);
  assert.equal(r.score, 0);
}

console.log('music-theory.test.mjs: toate testele au trecut ✔');
