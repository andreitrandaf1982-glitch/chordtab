// Diagrame de acorduri pentru chitară: de la eticheta acordului la un desen pe corzi.
//
// Nu ținem o bază de date cu toate acordurile. Ținem formele DESCHISE (cele pe care le cântă
// oricine, cu corzi libere) și, pentru restul, construim forma de bară după sistemul CAGED:
// aceeași formă de E sau de A, mutată pe gât până cade fundamentala unde trebuie.
// Așa acoperim toate cele 24 de acorduri majore și minore, plus septimele uzuale.
//
// Convenție: șase numere, de la coarda 6 (Mi grav) la coarda 1 (Mi acut).
//   -1 = coardă mută (nu o cânți), 0 = coardă liberă, n = poziția n.

import { parseChord, NOTES } from './music-theory.js';

// Clasa de înălțime a corzilor libere: Mi La Re Sol Si Mi
const OPEN_STRING_PC = [4, 9, 2, 7, 11, 4];

/** Forme deschise — preferate, fiindcă sună mai plin și sunt mai ușor de prins. */
const OPEN_SHAPES = {
  C: [-1, 3, 2, 0, 1, 0],
  A: [-1, 0, 2, 2, 2, 0],
  G: [3, 2, 0, 0, 0, 3],
  E: [0, 2, 2, 1, 0, 0],
  D: [-1, -1, 0, 2, 3, 2],
  Am: [-1, 0, 2, 2, 1, 0],
  Em: [0, 2, 2, 0, 0, 0],
  Dm: [-1, -1, 0, 2, 3, 1],

  C7: [-1, 3, 2, 3, 1, 0],
  A7: [-1, 0, 2, 0, 2, 0],
  G7: [3, 2, 0, 0, 0, 1],
  E7: [0, 2, 0, 1, 0, 0],
  D7: [-1, -1, 0, 2, 1, 2],
  B7: [-1, 2, 1, 2, 0, 2],
  Am7: [-1, 0, 2, 0, 1, 0],
  Em7: [0, 2, 0, 0, 0, 0],
  Dm7: [-1, -1, 0, 2, 1, 1],

  Cmaj7: [-1, 3, 2, 0, 0, 0],
  Amaj7: [-1, 0, 2, 1, 2, 0],
  Gmaj7: [3, 2, 0, 0, 0, 2],
  Emaj7: [0, 2, 1, 1, 0, 0],
  Dmaj7: [-1, -1, 0, 2, 2, 2],
  Fmaj7: [-1, -1, 3, 2, 1, 0],

  Asus2: [-1, 0, 2, 2, 0, 0],
  Asus4: [-1, 0, 2, 2, 3, 0],
  Dsus2: [-1, -1, 0, 2, 3, 0],
  Dsus4: [-1, -1, 0, 2, 3, 3],
  Esus4: [0, 2, 2, 2, 0, 0],
};

// Forme de bară, relative la poziția barei. Indexul 0 = coarda 6.
// `string` spune pe ce coardă cade fundamentala (6 pentru forma de E, 5 pentru forma de A).
const BARRE_SHAPES = {
  E: { '': [0, 2, 2, 1, 0, 0], m: [0, 2, 2, 0, 0, 0], 7: [0, 2, 0, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0], maj7: [0, 2, 1, 1, 0, 0], string: 6 },
  A: { '': [-1, 0, 2, 2, 2, 0], m: [-1, 0, 2, 2, 1, 0], 7: [-1, 0, 2, 0, 2, 0], m7: [-1, 0, 2, 0, 1, 0], maj7: [-1, 0, 2, 1, 2, 0], string: 5 },
};

/** Acordajele pe care le știm. `drop` = cu cât e coborâtă coarda 6 față de standard. */
export const TUNINGS = {
  standard: { label: 'Standard', drop: 0 },
  dropD: { label: 'Drop D', drop: 2 },
};

/**
 * Traduce o formă din acordaj standard în Drop D.
 *
 * În Drop D, coarda 6 e coborâtă cu un ton, deci la aceeași poziție sună cu 2 semitonuri mai
 * jos. Ca să sune aceeași notă, o apeși cu 2 poziții mai sus. Restul corzilor nu se schimbă.
 * Dacă mutarea face acordul necântabil (întindere prea mare), e mai cinstit să muți coarda 6
 * decât să ceri imposibilul — oricum așa cântă lumea în practică.
 */
function toDropD(frets) {
  const out = frets.slice();
  if (out[0] >= 0) {
    const moved = out[0] + 2;
    const others = out.slice(1).filter((f) => f > 0);
    const span = others.length ? Math.max(moved, ...others) - Math.min(moved, ...others) : 0;
    out[0] = span <= 3 ? moved : -1;
  }
  return out;
}

/**
 * Forma acordului: șase poziții + de unde începe bara (0 = fără bară).
 * @param {string} label
 * @param {'standard'|'dropD'} tuning
 * @returns {{frets:number[], barre:number, baseFret:number}|null}
 */
export function chordShape(label, tuning = 'standard') {
  const shape = standardShape(label);
  if (!shape || tuning === 'standard') return shape;
  const frets = toDropD(shape.frets);
  return { frets, barre: barreOf(label, frets), baseFret: shape.baseFret };
}

function standardShape(label) {
  const open = OPEN_SHAPES[label];
  if (open) return { frets: open.slice(), barre: barreOf(label, open), baseFret: 1 };

  const parsed = parseChord(label);
  if (!parsed) return null;
  const root = NOTES.indexOf(parsed.root);
  const quality = parsed.quality;

  let best = null;
  for (const form of ['E', 'A']) {
    const shape = BARRE_SHAPES[form];
    const template = shape[quality];
    if (!template) continue;
    const openPc = OPEN_STRING_PC[6 - shape.string];
    let fret = ((root - openPc) % 12 + 12) % 12;
    if (fret === 0) fret = 12; // poziția 0 ar fi forma deschisă, tratată deja mai sus
    if (!best || fret < best.fret) {
      best = { fret, frets: template.map((f) => (f < 0 ? -1 : f + fret)) };
    }
  }
  if (!best) return null;
  return { frets: best.frets, barre: best.fret, baseFret: best.fret };
}

/** Bara unei forme deschise (F și Bm au bară chiar dacă stau jos pe gât). */
function barreOf(label, frets) {
  const played = frets.filter((f) => f > 0);
  if (played.length < 4) return 0;
  const min = Math.min(...played);
  const atMin = frets.filter((f) => f === min).length;
  return atMin >= 3 ? min : 0;
}

export function hasDiagram(label, tuning = 'standard') {
  return !!chordShape(label, tuning);
}

/**
 * Diagrama ca SVG, gata de pus în pagină.
 * @param {string} label acordul AȘA CUM SE CÂNTĂ (deja transpus, dacă e cazul)
 * @param {number} capo poziția capo, doar ca să apară scris pe diagramă
 * @param {'standard'|'dropD'} tuning acordajul chitarei
 */
export function renderChordDiagram(label, capo = 0, tuning = 'standard') {
  const shape = chordShape(label, tuning);
  if (!shape) return null;

  const { frets, barre } = shape;
  const played = frets.filter((f) => f > 0);
  const minFret = played.length ? Math.min(...played) : 1;
  const maxFret = played.length ? Math.max(...played) : 1;
  // Fereastra de 4 poziții: de la 1 dacă acordul stă jos, altfel de la prima poziție folosită.
  const start = maxFret <= 4 ? 1 : minFret;
  const rows = 4;

  const W = 140, H = 168;
  const left = 26, top = 40, cw = 17, rh = 24;
  const x = (s) => left + s * cw;                  // s: 0 = coarda 6 (stânga)
  const y = (r) => top + r * rh;                   // r: rândul de poziție
  const parts = [];

  parts.push(`<text x="${W / 2}" y="18" class="ct-d-name" text-anchor="middle">${escapeHtml(label)}</text>`);

  if (start > 1) {
    parts.push(`<text x="${left - 10}" y="${y(0) + rh / 2 + 4}" class="ct-d-fret" text-anchor="end">${start}</text>`);
  } else {
    // Cu capo pus, bara de sus nu mai e pragul chitarei, ci capodastrul: pozițiile din
    // diagramă se numără de la el. Îl desenăm în altă culoare ca să se vadă diferența.
    const cls = capo > 0 ? 'ct-d-capo-bar' : 'ct-d-nut';
    parts.push(`<rect x="${x(0) - 3}" y="${top - 6}" width="${cw * 5 + 6}" height="5" rx="2" class="${cls}"/>`);
  }

  for (let s = 0; s < 6; s++) {
    parts.push(`<line x1="${x(s)}" y1="${top}" x2="${x(s)}" y2="${y(rows)}" class="ct-d-string"/>`);
  }
  for (let r = 0; r <= rows; r++) {
    parts.push(`<line x1="${x(0)}" y1="${y(r)}" x2="${x(5)}" y2="${y(r)}" class="ct-d-fretline"/>`);
  }

  // corzi mute / libere, deasupra pragului
  frets.forEach((f, s) => {
    if (f === -1) parts.push(`<text x="${x(s)}" y="${top - 10}" class="ct-d-mark" text-anchor="middle">×</text>`);
    else if (f === 0) parts.push(`<circle cx="${x(s)}" cy="${top - 14}" r="4" class="ct-d-open"/>`);
  });

  // bara, dacă există și intră în fereastră
  if (barre >= start && barre < start + rows) {
    const first = frets.findIndex((f) => f === barre);
    const last = frets.length - 1 - [...frets].reverse().findIndex((f) => f === barre);
    const row = barre - start;
    parts.push(`<rect x="${x(first) - 6}" y="${y(row) + rh / 2 - 6}" width="${x(last) - x(first) + 12}" height="12" rx="6" class="ct-d-barre"/>`);
  }

  frets.forEach((f, s) => {
    if (f <= 0) return;
    const row = f - start;
    if (row < 0 || row >= rows) return;
    if (f === barre) return; // deja acoperit de bară
    parts.push(`<circle cx="${x(s)}" cy="${y(row) + rh / 2}" r="6.5" class="ct-d-dot"/>`);
  });

  const notes = [];
  if (capo > 0) notes.push(`capo ${capo}`);
  if (tuning !== 'standard') notes.push(TUNINGS[tuning]?.label ?? tuning);
  const caption = notes.length
    ? `<text x="${W / 2}" y="${H - 6}" class="ct-d-capo" text-anchor="middle">${escapeHtml(notes.join(' · '))}</text>`
    : '';

  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="ct-diagram" role="img" aria-label="Diagrama acordului ${escapeHtml(label)}">${parts.join('')}${caption}</svg>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
