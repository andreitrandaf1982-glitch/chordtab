// Caietul meu — cuprinsul melodiilor învățate. Ideea aleasă de Andrei (21.09.2026): „caietul
// cu acorduri din copilărie, dar care se scrie singur”. Fiecare melodie analizată e deja în
// chrome.storage.local (chords:<videoId>); aici doar le adunăm într-o pagină de caiet:
// titlu, acordurile ei, capo-ul sugerat, data, de câte ori a fost deschisă. Click pe titlu
// deschide videoul; „Rupe pagina” salvează foaia ei ca imagine, ca din panou. Zero rețea.

import { createLogger } from '../lib/logger.js';
import { STR } from '../lib/strings.js';
import { detectSections, cleanTimeline } from '../lib/sections.js';
import { sheetRows, clusterOrdinals, makeSectionLabel } from '../lib/sheet-model.js';
import { tearPage } from '../lib/tear-page.js';
import { NO_CHORD } from '../lib/music-theory.js';

const log = createLogger('caiet');
const $ = (id) => document.getElementById(id);

const MAX_CHIPS = 8;

/**
 * Acordurile melodiei, cele mai cântate primele (după cât timp sună fiecare în cronologia
 * curățată). În ordinea primei apariții, intrușii din intro ieșeau în față (Wonderwall
 * începea cu „Dm A# C”); ordonate după timp, primele opt sunt chiar acordurile melodiei.
 */
function distinctChords(chords, duration) {
  const time = new Map();
  chords.forEach((c, i) => {
    if (c.label === NO_CHORD) return;
    const d = (i + 1 < chords.length ? chords[i + 1].t : duration) - c.t;
    time.set(c.label, (time.get(c.label) || 0) + Math.max(0, d));
  });
  return [...time].sort((a, b) => b[1] - a[1]).map(([label]) => label);
}

function fmtDate(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('ro-RO') : null;
}

async function loadSongs() {
  const all = await chrome.storage.local.get(null);
  const songs = [];
  for (const [key, entry] of Object.entries(all)) {
    if (!key.startsWith('chords:') || !entry?.chords?.length) continue;
    const videoId = key.slice('chords:'.length);
    const last = entry.chords[entry.chords.length - 1];
    const cleaned = cleanTimeline(entry.chords, last.t + 4);
    songs.push({
      key, videoId, entry,
      title: entry.title || STR.notebookUntitled(videoId),
      chords: distinctChords(cleaned, last.t + 4),
      cleaned,
      capo: entry.capo || 0,
      date: fmtDate(entry.analyzedAt),
      sortKey: entry.analyzedAt || '',
      opened: entry.opened || 0,
    });
  }
  songs.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
  return songs;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function render(songs) {
  const list = $('list');
  list.innerHTML = '';
  $('empty').hidden = songs.length > 0;
  $('empty').textContent = STR.notebookEmpty;
  $('clear').hidden = songs.length === 0;
  $('clear').textContent = STR.notebookClear;
  const first = songs.length ? songs[songs.length - 1].date : null;
  $('subtitle').textContent = STR.notebookSubtitle(songs.length, first);
  $('foot').textContent = STR.notebookFoot;

  for (const song of songs) {
    const row = el('article', 'cb-song');
    row.dataset.videoId = song.videoId;

    const title = el('a', 'cb-song-title', song.title);
    title.href = `https://www.youtube.com/watch?v=${encodeURIComponent(song.videoId)}`;
    title.target = '_blank';
    title.rel = 'noopener';
    title.title = STR.notebookOpen;
    row.appendChild(title);

    const meta = [];
    if (song.capo > 0) meta.push(STR.notebookCapo(song.capo));
    if (song.date) meta.push(STR.notebookLearned(song.date));
    if (song.opened > 0) meta.push(STR.notebookOpened(song.opened));
    row.appendChild(el('div', 'cb-song-meta', meta.join(' · ')));

    const chips = el('div', 'cb-chips');
    for (const label of song.chords.slice(0, MAX_CHIPS)) chips.appendChild(el('span', 'cb-chip', label));
    if (song.chords.length > MAX_CHIPS) chips.appendChild(el('span', 'cb-song-meta', `+${song.chords.length - MAX_CHIPS}`));
    row.appendChild(chips);

    const actions = el('div', 'cb-actions');
    const open = el('a', 'cb-btn is-primary', STR.notebookOpen);
    open.href = title.href;
    open.target = '_blank';
    open.rel = 'noopener';
    actions.appendChild(open);

    const tear = el('button', 'cb-btn', STR.tearPage);
    tear.type = 'button';
    tear.title = STR.tearHelp;
    tear.addEventListener('click', () => onTear(song, tear));
    actions.appendChild(tear);

    const del = el('button', 'cb-btn is-danger', STR.notebookDelete);
    del.type = 'button';
    del.addEventListener('click', () => onDelete(song));
    actions.appendChild(del);
    row.appendChild(actions);

    list.appendChild(row);
  }
}

async function onTear(song, btn) {
  try {
    const last = song.cleaned[song.cleaned.length - 1];
    const structure = detectSections(song.cleaned, last.t + 4);
    const sectionLabel = makeSectionLabel(STR, clusterOrdinals(structure.sections));
    const rows = sheetRows(song.cleaned, structure, { sectionLabel, wholeSong: STR.wholeSong, rowAt: STR.sheetRowAt })
      .map((r) => ({ label: r.label, group: r.group, reps: r.reps, chips: r.chips.map((c) => c.label) }));
    const name = await tearPage({ title: song.title, capo: 0, transpose: 0, analyzedAt: song.date, rows });
    const before = btn.textContent;
    btn.textContent = STR.torn;
    setTimeout(() => { btn.textContent = before; }, 1600);
    log.info('Pagina ruptă din caiet:', name);
  } catch (err) {
    log.error('Nu am putut rupe pagina:', err?.message || err);
  }
}

async function onDelete(song) {
  if (!window.confirm(STR.notebookDeleteConfirm(song.title))) return;
  await chrome.storage.local.remove(song.key);
  log.info('Melodie ștearsă din caiet:', song.videoId);
  render(await loadSongs());
}

// Golirea caietului (tot ce e `chords:*`), cu confirmare. Andrei a vrut să fie sigur că
// nimeni nu primește caietul cu istoricul lui: memoria e oricum per profil de Chrome (nu
// stă în arhivă), dar butonul face curățenia la un click.
async function onClearAll() {
  const songs = await loadSongs();
  if (!songs.length || !window.confirm(STR.notebookClearConfirm(songs.length))) return;
  await chrome.storage.local.remove(songs.map((s) => s.key));
  log.info('Caietul golit:', songs.length, 'melodii.');
  render(await loadSongs());
}
$('clear').addEventListener('click', onClearAll);

render(await loadSongs());

// Dacă între timp se învață o melodie în alt tab, caietul se actualizează singur.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !Object.keys(changes).some((k) => k.startsWith('chords:'))) return;
  render(await loadSongs());
});
