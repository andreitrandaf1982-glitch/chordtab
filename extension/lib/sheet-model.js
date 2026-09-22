// Modelul „foii melodiei” — un rând per secțiune, în ordinea cântecului — construit PUR, fără
// DOM, din cronologie + structură. E singura sursă pentru: rândurile din panou (content.js),
// textul copiat, pagina ruptă (tear-page.js) și paginile rupte din Caietul meu (caiet.js).
//
// Rând: { label, start, group, chips: [{ label, at }], reps, range }
//   label  — numele secțiunii („Strofă”, „Partea 2”, „Toată melodia”, „de la 1:20”)
//   group  — 0..4 (culoarea de evidențiator) sau null pentru zone libere / foaia plată
//   chips  — acordurile care SUNĂ (netranspuse) și momentul la care sare clickul
//   range  — intervalul de exersare, doar pentru secțiunile adevărate (altfel null)

import { NO_CHORD } from './music-theory.js';

export const SHEET_FLAT_ROW = 8;   // pe foaia fără structură, câte acorduri pe un rând
export const MIN_COVERAGE = 0.5;   // sub atât, structura găsită e prea firavă ca s-o arătăm

export function hasUsefulStructure(structure) {
  return !!structure && structure.coverage >= MIN_COVERAGE && Object.keys(structure.patterns).length > 0;
}

// Numărul de ordine al fiecărui grup, după PRIMA APARIȚIE în melodie — nu după litera dată de
// sections.js. Literele se atribuie în ordinea în care sunt descoperite buclele, iar pasul de
// adopție poate lipi mai târziu un grup pe o secțiune de la începutul melodiei; atunci litera
// n-ar mai corespunde cu ce aude omul. Ordinea din secțiuni corespunde mereu.
export function clusterOrdinals(sections) {
  const map = new Map();
  for (const s of sections) {
    if (s.cluster && !map.has(s.cluster)) map.set(s.cluster, map.size + 1);
  }
  return map;
}

/** Acordurile din intervalul [from, to), cu repetițiile consecutive contopite; fără N.C. */
export function chordsBetween(chords, from, to) {
  const out = [];
  for (const c of chords) {
    if (c.t >= to) break;
    if (c.label === NO_CHORD) continue; // „niciun acord” nu e un acord al melodiei
    if (c.t < from - 0.001) { // acordul care sună deja la începutul feliei
      if (out.length) out[0] = { t: from, label: c.label };
      else out.push({ t: from, label: c.label });
      continue;
    }
    if (out.length && out[out.length - 1].label === c.label) continue;
    out.push({ t: c.t, label: c.label });
  }
  return out;
}

/**
 * @param chords cronologia (curățată), sortată după t
 * @param structure rezultatul lui detectSections (sau null)
 * @param names { sectionLabel(section) => string, wholeSong: string, rowAt(t) => string }
 */
export function sheetRows(chords, structure, names) {
  const st = hasUsefulStructure(structure) ? structure : null;
  const rows = [];
  if (!st) {
    // Fără structură: toată melodia, pe RÂNDURI de câte SHEET_FLAT_ROW acorduri — un singur
    // rând cu 174 de chip-uri (Adele, audit 3) nu se putea citi. Eticheta rândului sare la
    // primul lui acord.
    const items = chordsBetween(chords, 0, Infinity);
    for (let r = 0; r * SHEET_FLAT_ROW < items.length; r++) {
      const slice = items.slice(r * SHEET_FLAT_ROW, (r + 1) * SHEET_FLAT_ROW);
      rows.push({
        label: r === 0 ? names.wholeSong : names.rowAt(slice[0].t), start: slice[0].t, group: null,
        chips: slice.map((c) => ({ label: c.label, at: c.t })), reps: 1, range: null,
      });
    }
    return rows;
  }
  const letters = Object.keys(st.patterns);
  for (const s of st.sections) {
    let chips;
    if (s.cluster && st.patterns[s.cluster]) {
      // Secțiune cu buclă: arătăm tiparul-consens, iar clickul duce la locul acordului în
      // PRIMA trecere prin buclă. `lead` = secundele mutate din coada buclei în capul ei la
      // contopirea circulară: fără scăderea lui, toate chip-urile de după primul erau
      // decalate cu atât, deci clickul sărea unde suna alt acord.
      const { loop, lead = 0 } = st.patterns[s.cluster];
      let offset = 0;
      chips = loop.map((item, k) => {
        const at = k === 0 ? s.start : s.start + Math.max(0, offset - lead);
        offset += item.seconds;
        return { label: item.label, at };
      });
    } else {
      // Zonă liberă (punte, intro, final): nu există tipar, deci arătăm ce sună de fapt.
      chips = chordsBetween(chords, s.start, s.end).map((c) => ({ label: c.label, at: Math.max(c.t, s.start) }));
    }
    const label = names.sectionLabel(s);
    rows.push({
      label, start: s.start,
      group: s.cluster ? letters.indexOf(s.cluster) % 5 : null,
      chips, reps: s.reps,
      range: { start: s.start, end: s.end, label },
    });
  }
  return rows;
}

/** Numele unei secțiuni: „Refren”, „Partea 2”, „Intro” sau „Trecere” — din STR + ordinea grupurilor. */
export function makeSectionLabel(STR, clusterOrder) {
  return (s) => {
    const name = s.name ? STR.sectionNames[s.name] : null;
    if (!s.cluster) return STR.freeSection(name);
    return STR.sectionLabel(clusterOrder.get(s.cluster) ?? 1, name);
  };
}
