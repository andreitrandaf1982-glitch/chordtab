// Rulare: npm run build
//
// Împachetează folderul extension/ într-o arhivă gata de trimis: dist/chordtab-<versiune>.zip.
// Asta e ce dai comunității — omul o dezarhivează și o încarcă cu „Load unpacked”.
//
// Verifică înainte două lucruri care nu trebuie să scape niciodată într-o arhivă publică:
// că nu se strecoară fișiere de secrete și că manifestul e valid.

import { readFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'extension');
const DIST = join(ROOT, 'dist');

const manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
const version = manifest.version;
if (!version) { console.error('manifest.json nu are versiune.'); process.exit(1); }

// --- Verificări înainte de împachetare ---------------------------------------
const FORBIDDEN = /(^\.env|\.env\.|\.key$|\.pem$|secret|credentials)/i;
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else files.push(relative(EXT, full));
  }
})(EXT);

const leaks = files.filter((f) => FORBIDDEN.test(f));
if (leaks.length) {
  console.error('OPRIT: fișiere care nu au ce căuta într-o arhivă publică:', leaks.join(', '));
  process.exit(1);
}

for (const needed of ['manifest.json', 'background.js', 'content/content.js', 'offscreen/offscreen.html']) {
  if (!files.includes(needed.replace(/\//g, '\\')) && !files.includes(needed)) {
    console.error(`OPRIT: lipsește ${needed} din extensie.`);
    process.exit(1);
  }
}

// --- Împachetare --------------------------------------------------------------
mkdirSync(DIST, { recursive: true });
const out = join(DIST, `chordtab-${version}.zip`);
if (existsSync(out)) rmSync(out);

const isWindows = process.platform === 'win32';
const result = isWindows
  ? spawnSync('powershell', ['-NoProfile', '-Command',
    `Compress-Archive -Path '${EXT}\\*' -DestinationPath '${out}' -CompressionLevel Optimal`],
  { encoding: 'utf8' })
  : spawnSync('zip', ['-r', '-q', out, '.'], { cwd: EXT, encoding: 'utf8' });

if (result.status !== 0) {
  console.error('Împachetarea a eșuat:', result.stderr || result.error?.message);
  if (!isWindows) console.error('Ai nevoie de utilitarul `zip` instalat.');
  process.exit(1);
}

const kb = Math.round(statSync(out).size / 1024);
console.log(`  ${relative(ROOT, out)} — ${files.length} fișiere, ${kb} KB`);
console.log('  Gata de trimis: se dezarhivează și se încarcă cu „Load unpacked”.');
