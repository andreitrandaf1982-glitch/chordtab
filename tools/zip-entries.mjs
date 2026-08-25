// Citește numele intrărilor dintr-un fișier .zip, direct din antetele locale.
//
// De ce există: specificația ZIP (APPNOTE 4.4.17.1) cere separatorul `/`. Compress-Archive din
// Windows PowerShell 5.1 scrie `\`, iar dezarhivatoarele de pe macOS/Linux tratează backslash-ul
// ca literă din numele fișierului — rezultă fișiere plate numite literal `content\loader.js` și
// Chrome refuză extensia. Defectul e invizibil pe Windows, unde Expand-Archive îl iartă, așa că
// avem nevoie să ne uităm direct în arhivă.

import { readFileSync } from 'node:fs';

const LOCAL_HEADER = 0x04034b50;

/** @returns {string[]} numele intrărilor, în ordinea din arhivă */
export function zipEntryNames(path) {
  const buf = readFileSync(path);
  const names = [];
  for (let i = 0; i + 30 <= buf.length; i++) {
    if (buf.readUInt32LE(i) !== LOCAL_HEADER) continue;
    const len = buf.readUInt16LE(i + 26);
    if (len > 0 && i + 30 + len <= buf.length) {
      names.push(buf.slice(i + 30, i + 30 + len).toString('utf8'));
    }
  }
  return names;
}

/** @returns {string[]} intrările cu separator greșit (gol = arhivă bună) */
export function badSeparatorEntries(path) {
  return zipEntryNames(path).filter((n) => n.includes('\\'));
}
