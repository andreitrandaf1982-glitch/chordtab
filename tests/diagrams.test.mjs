// Rulare: node tests/diagrams.test.mjs
//
// Verifică diagramele MUZICAL, nu doar că se desenează: pentru fiecare formă calculăm ce note
// ies de fapt din corzi și le comparăm cu notele acordului. O digitație greșită e mai rea decât
// niciuna — cineva ar învăța să cânte fals și ar da vina pe urechea lui.

import assert from 'node:assert/strict';
import { chordShape, renderChordDiagram, hasDiagram } from '../extension/lib/diagrams.js';
import { NOTES } from '../extension/lib/music-theory.js';

const OPEN_STRING_PC = [4, 9, 2, 7, 11, 4]; // Mi La Re Sol Si Mi

// Ce note conține fiecare calitate de acord și care dintre ele NU pot lipsi.
// Cvinta se poate omite (voicing-uri standard ca C7 = x32310 chiar o omit);
// fundamentala, terța și septima definesc acordul, deci sunt obligatorii.
const QUALITIES = {
  '':     { all: [0, 4, 7],      required: [0, 4, 7] },
  m:      { all: [0, 3, 7],      required: [0, 3, 7] },
  7:      { all: [0, 4, 7, 10],  required: [0, 4, 10] },
  m7:     { all: [0, 3, 7, 10],  required: [0, 3, 10] },
  maj7:   { all: [0, 4, 7, 11],  required: [0, 4, 11] },
  sus2:   { all: [0, 2, 7],      required: [0, 2, 7] },
  sus4:   { all: [0, 5, 7],      required: [0, 5, 7] },
};

function pitchClassesOf(frets, strings = OPEN_STRING_PC) {
  const out = [];
  frets.forEach((f, s) => { if (f >= 0) out.push((strings[s] + f) % 12); });
  return out;
}

function bassPitchClass(frets, strings = OPEN_STRING_PC) {
  for (let s = 0; s < 6; s++) if (frets[s] >= 0) return (strings[s] + frets[s]) % 12;
  return null;
}

function check(label, root, quality, tuning = 'standard') {
  const shape = chordShape(label, tuning);
  assert.ok(shape, `lipsește forma pentru ${label} (${tuning})`);
  const { frets } = shape;

  assert.equal(frets.length, 6, `${label}: aștept 6 corzi`);
  assert.ok(frets.some((f) => f >= 0), `${label}: toate corzile mute`);

  const spec = QUALITIES[quality];
  const allowed = new Set(spec.all.map((iv) => (root + iv) % 12));
  // În Drop D, coarda 6 sună cu 2 semitonuri mai jos la aceeași poziție.
  const strings = tuning === 'dropD'
    ? [(OPEN_STRING_PC[0] - 2 + 12) % 12, ...OPEN_STRING_PC.slice(1)]
    : OPEN_STRING_PC;
  const produced = new Set(pitchClassesOf(frets, strings));

  for (const pc of produced) {
    assert.ok(allowed.has(pc),
      `${label}: forma conține ${NOTES[pc]}, care nu face parte din acord (${[...allowed].map((p) => NOTES[p]).join(' ')})`);
  }
  for (const iv of spec.required) {
    const pc = (root + iv) % 12;
    assert.ok(produced.has(pc), `${label}: lipsește ${NOTES[pc]} din formă`);
  }
  assert.equal(bassPitchClass(frets, strings), root,
    `${label} (${tuning}): cea mai joasă notă ar trebui să fie fundamentala ${NOTES[root]}`);

  // Întinderea trebuie să fie cântabilă: maximum 4 poziții între prima și ultima.
  const played = frets.filter((f) => f > 0);
  if (played.length) {
    const span = Math.max(...played) - Math.min(...played);
    assert.ok(span <= 3, `${label}: întindere de ${span + 1} poziții — necântabil`);
  }
  return shape;
}

// --- 1. Toate cele 24 de acorduri majore și minore ---------------------------
let barreCount = 0;
for (let root = 0; root < 12; root++) {
  for (const quality of ['', 'm']) {
    const label = NOTES[root] + quality;
    const shape = check(label, root, quality);
    if (shape.barre > 0) barreCount++;
  }
}
console.log(`  24/24 acorduri majore și minore verificate muzical ✔ (${barreCount} cu bară)`);

// --- 2. Septimele și suspendatele din tabelul de forme deschise ---------------
const EXTRAS = ['C7', 'A7', 'G7', 'E7', 'D7', 'B7', 'Am7', 'Em7', 'Dm7',
  'Cmaj7', 'Amaj7', 'Gmaj7', 'Emaj7', 'Dmaj7', 'Fmaj7',
  'Asus2', 'Asus4', 'Dsus2', 'Dsus4', 'Esus4'];
for (const label of EXTRAS) {
  const m = label.match(/^([A-G][#b]?)(.*)$/);
  check(label, NOTES.indexOf(m[1]), m[2]);
}
console.log(`  ${EXTRAS.length}/${EXTRAS.length} septime și suspendate verificate ✔`);

// --- 3. Acordurile din Poarta 7 a planului ------------------------------------
const GATE7 = ['C', 'G', 'D', 'A', 'E', 'Am', 'Em', 'Dm', 'F', 'Bm', 'F#m', 'E7', 'Am7', 'Cmaj7', 'Dsus4'];
for (const label of GATE7) assert.ok(hasDiagram(label), `Poarta 7 cere diagramă pentru ${label}`);
console.log(`  Poarta 7: toate cele ${GATE7.length} acorduri au diagramă ✔`);

// Verificări punctuale, contra digitațiilor pe care le știe orice chitarist.
assert.deepEqual(chordShape('C').frets, [-1, 3, 2, 0, 1, 0], 'C trebuie să fie x32010');
assert.deepEqual(chordShape('G').frets, [3, 2, 0, 0, 0, 3], 'G trebuie să fie 320003');
assert.deepEqual(chordShape('Em').frets, [0, 2, 2, 0, 0, 0], 'Em trebuie să fie 022000');
assert.deepEqual(chordShape('F').frets, [1, 3, 3, 2, 1, 1], 'F trebuie să fie bară la 1');
assert.deepEqual(chordShape('Bm').frets, [-1, 2, 4, 4, 3, 2], 'Bm trebuie să fie bară la 2');
assert.equal(chordShape('F').barre, 1, 'F are bară pe poziția 1');
assert.equal(chordShape('Bm').barre, 2, 'Bm are bară pe poziția 2');
assert.equal(chordShape('C').barre, 0, 'C nu are bară');
console.log('  Digitații cunoscute (C, G, Em, F, Bm) ✔');

// --- 3b. Drop D: aceleași acorduri, coarda 6 coborâtă cu un ton ---------------
// Verificarea e aceeași — ce note ies din corzi — dar cu coarda 6 acordată în D.
// Dacă transformarea ar fi greșită, ar ieși note străine de acord: testul le prinde.
{
  let dropped = 0, muted = 0;
  for (let root = 0; root < 12; root++) {
    for (const quality of ['', 'm']) {
      const label = NOTES[root] + quality;
      const std = chordShape(label, 'standard');
      const drop = check(label, root, quality, 'dropD');
      if (std.frets[0] >= 0 && drop.frets[0] === -1) muted++;
      else if (std.frets[0] !== drop.frets[0]) dropped++;
    }
  }
  console.log(`  Drop D: 24/24 acorduri corecte ✔ (${dropped} cu coarda 6 mutată, ${muted} cu ea mută)`);

  // Acordurile care nu ating coarda 6 trebuie să rămână neschimbate.
  for (const label of ['C', 'Am', 'D', 'Dm', 'Bm']) {
    assert.deepEqual(chordShape(label, 'dropD').frets, chordShape(label, 'standard').frets,
      `${label} nu folosește coarda 6, deci nu se schimbă în Drop D`);
  }
  // E standard e 022100; în Drop D coarda 6 urcă la 2 ca să sune tot Mi.
  assert.equal(chordShape('E', 'dropD').frets[0], 2, 'E în Drop D are coarda 6 pe poziția 2');
  assert.equal(chordShape('E', 'standard').frets[0], 0, 'E standard are coarda 6 liberă');
  console.log('  Drop D: acordurile fără coarda 6 rămân neschimbate, E se mută corect ✔');
}

// --- 4. Desenul: SVG valid, fără injecție ------------------------------------
{
  const svg = renderChordDiagram('Am', 3);
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'), 'diagrama trebuie să fie un SVG');
  assert.ok(svg.includes('capo 3'), 'capo-ul trebuie scris pe diagramă');
  assert.ok(renderChordDiagram('E', 0, 'dropD').includes('Drop D'), 'acordajul trebuie scris pe diagramă');
  assert.ok(!renderChordDiagram('Xyz'), 'un acord necunoscut nu trebuie să deseneze nimic');

  // O etichetă ciudată nu trebuie să scape ca HTML în pagină.
  assert.ok(!hasDiagram('<img src=x onerror=alert(1)>'), 'eticheta invalidă nu are diagramă');
  const high = renderChordDiagram('G#m');
  assert.ok(high.includes('class="ct-d-fret"'), 'acordurile de sus trebuie să arate poziția');
}
console.log('  Desen SVG: structură, capo, acord necunoscut, etichetă ostilă ✔');

console.log('diagrams.test.mjs: toate testele au trecut ✔');
