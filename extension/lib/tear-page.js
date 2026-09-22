// „Rupe pagina”: foaia melodiei, desenată ca o pagină de caiet și salvată ca imagine PNG,
// plus varianta text pentru clipboard. Decizia lui Andrei (21.09.2026): nu tipărire, ci
// „foaia exact cum apare în panou, salvată ca imagine”.
//
// Desenăm direct pe <canvas> cu fonturile deja încărcate în pagină de panel.css (Playpen
// Sans pentru acorduri, Playwrite RO pentru titlurile scrise de mână) — nimic nu părăsește
// browserul și nu depindem de conversia SVG → imagine, care în Chrome pierde fonturile.
//
// Modelul foii vine din content.js (aceeași sursă ca rândurile din panou):
//   { title, capo, transpose, analyzedAt, rows: [{ label, group, chips: [text], reps }] }
// `group` e 0..4 (culoarea de evidențiator) sau null pentru zonele libere / foaia plată.

const PAPER = '#f6f1e4';
const INK = '#1e223d';
const INK_SOFT = 'rgba(30, 34, 61, 0.62)';
const RULE = 'rgba(30, 34, 61, 0.10)';
const TEAL = '#1f8f87';
const BLUE = '#3058f0';
const ORANGE = '#f54f1b';
const GROUP_FILL = [
  'rgba(48, 88, 240, 0.22)', 'rgba(122, 79, 240, 0.24)', 'rgba(31, 143, 135, 0.26)',
  'rgba(245, 79, 27, 0.22)', 'rgba(86, 150, 58, 0.24)',
];
const FONT_PRINT = '"CT Playpen", "Playpen Sans", "Segoe Print", sans-serif';
const FONT_HAND = '"CT Playwrite", "Playwrite RO", "Segoe Script", cursive';

const W = 1200;          // lățimea paginii, în px CSS (se desenează la 2×)
const PAD = 56;
const LINE = 36;         // distanța dintre liniile caietului
const TAG_W = 190;       // coloana etichetelor de secțiune
const CHIP_H = 44;
const CHIP_GAP = 10;
const ROW_GAP = 18;

/** Textul foii, pentru clipboard: un rând per secțiune, „Strofă: G D Am C ×4”. */
export function sheetAsText(model) {
  const lines = [model.title || 'Melodie'];
  const meta = [];
  if (model.capo > 0) meta.push(`capo ${model.capo}`);
  if (model.transpose) meta.push(`ton ${model.transpose > 0 ? '+' : ''}${model.transpose}`);
  if (meta.length) lines.push(meta.join(' · '));
  lines.push('');
  for (const r of model.rows) {
    lines.push(`${r.label}: ${r.chips.join(' ')}${r.reps > 1 ? ` ×${r.reps}` : ''}`);
  }
  lines.push('', 'ChordTab — acorduri găsite local, în browser');
  return lines.join('\n');
}

/** Un chenar „tras cu creionul”: dreptunghi cu raze inegale, ușor înclinat. */
function pencilBox(ctx, x, y, w, h, seed, fill, stroke) {
  const r = (k) => 4 + ((seed * 7 + k * 13) % 5);
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(((seed % 3) - 1) * 0.006);
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, [r(1), r(2), r(3), r(4)]);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.6; ctx.stroke(); }
  ctx.restore();
}

/** Desenează foaia pe un canvas și îl întoarce (2× pentru claritate). */
export async function drawSheet(model) {
  // Fonturile trebuie să fie gata ÎNAINTE de măsurare, altfel Chrome desenează cu fallback.
  if (document.fonts?.load) {
    await Promise.all([
      document.fonts.load(`600 22px ${FONT_PRINT}`),
      document.fonts.load(`800 34px ${FONT_PRINT}`),
      document.fonts.load(`400 24px ${FONT_HAND}`),
    ]).catch(() => {});
  }
  const measure = document.createElement('canvas').getContext('2d');
  const chipW = (text) => {
    measure.font = `600 22px ${FONT_PRINT}`;
    return Math.ceil(measure.measureText(text).width) + 30;
  };

  // Așezarea: chip-urile unui rând se rup pe mai multe linii dacă nu încap.
  const chipsX = PAD + TAG_W;
  const maxX = W - PAD - 70; // loc pentru „×N”
  const layout = [];
  let y = PAD + 110; // sub titlu și subtitlu
  for (const row of model.rows) {
    const lines = [[]];
    let x = chipsX;
    for (const text of row.chips) {
      const w = chipW(text);
      if (x + w > maxX && lines[lines.length - 1].length) { lines.push([]); x = chipsX; }
      lines[lines.length - 1].push({ text, x, w });
      x += w + CHIP_GAP;
    }
    const h = lines.length * (CHIP_H + 8) - 8;
    layout.push({ row, y, lines, h });
    y += h + ROW_GAP;
  }
  const H = y + PAD + 40;

  const canvas = document.createElement('canvas');
  canvas.width = W * 2;
  canvas.height = H * 2;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);

  // Hârtia și liniile caietului.
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1;
  for (let ly = PAD + 20; ly < H - PAD / 2; ly += LINE) {
    ctx.beginPath(); ctx.moveTo(PAD / 2, ly + 0.5); ctx.lineTo(W - PAD / 2, ly + 0.5); ctx.stroke();
  }
  // Marginea roșie a caietului, în stânga.
  ctx.strokeStyle = 'rgba(214, 69, 69, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(PAD - 14, 0); ctx.lineTo(PAD - 14, H); ctx.stroke();
  // Banda de scotch portocalie, sus.
  ctx.save();
  ctx.translate(PAD + 60, 18);
  ctx.rotate(-0.05);
  ctx.fillStyle = 'rgba(245, 79, 27, 0.7)';
  ctx.fillRect(-60, -12, 130, 26);
  ctx.restore();

  // Titlul melodiei și subtitlul.
  ctx.fillStyle = INK;
  ctx.font = `800 34px ${FONT_PRINT}`;
  ctx.textBaseline = 'alphabetic';
  const title = model.title || 'Melodie';
  ctx.fillText(fitText(ctx, title, W - 2 * PAD), PAD, PAD + 40);
  ctx.fillStyle = TEAL;
  ctx.font = `400 24px ${FONT_HAND}`;
  const sub = [];
  if (model.capo > 0) sub.push(`capo ${model.capo}`);
  if (model.transpose) sub.push(`ton ${model.transpose > 0 ? '+' : ''}${model.transpose}`);
  sub.push(model.analyzedAt ? `învățată pe ${model.analyzedAt}` : 'învățată ascultând');
  ctx.fillText(sub.join(' · '), PAD, PAD + 78);

  // Rândurile.
  for (const { row, y: ry, lines } of layout) {
    // eticheta secțiunii, pe evidențiator
    ctx.font = `400 24px ${FONT_HAND}`;
    const tagText = row.label;
    const tagW = Math.min(TAG_W - 20, Math.ceil(ctx.measureText(tagText).width) + 24);
    ctx.save();
    ctx.translate(PAD, ry + 4);
    ctx.rotate(-0.012);
    ctx.fillStyle = row.group !== null ? GROUP_FILL[row.group % GROUP_FILL.length] : 'rgba(30, 34, 61, 0.10)';
    ctx.beginPath(); ctx.roundRect(0, 0, tagW, 34, [3, 8, 4, 9]); ctx.fill();
    ctx.fillStyle = INK;
    ctx.fillText(fitText(ctx, tagText, tagW - 16), 12, 25);
    ctx.restore();

    // chip-urile
    lines.forEach((line, li) => {
      const cy = ry + li * (CHIP_H + 8);
      line.forEach((chip, ci) => {
        pencilBox(ctx, chip.x, cy, chip.w, CHIP_H, ci + li * 7 + row.chips.length, '#efe8d6', INK);
        ctx.fillStyle = INK;
        ctx.font = `600 22px ${FONT_PRINT}`;
        ctx.textAlign = 'center';
        ctx.fillText(chip.text, chip.x + chip.w / 2, cy + 30);
        ctx.textAlign = 'left';
      });
    });

    // ×N, în dreapta
    if (row.reps > 1) {
      ctx.fillStyle = INK_SOFT;
      ctx.font = `400 24px ${FONT_HAND}`;
      ctx.textAlign = 'right';
      ctx.fillText(`×${row.reps}`, W - PAD, ry + 30);
      ctx.textAlign = 'left';
    }
  }

  // Subsolul.
  ctx.fillStyle = BLUE;
  ctx.font = `800 20px ${FONT_PRINT}`;
  ctx.fillText('ChordTab', PAD, H - PAD + 8);
  ctx.fillStyle = INK_SOFT;
  ctx.font = `400 15px ${FONT_PRINT}`;
  ctx.fillText('acorduri găsite local, în browser — fără cont, fără API', PAD + 110, H - PAD + 8);
  ctx.fillStyle = ORANGE;
  ctx.fillRect(W - PAD - 90, H - PAD - 4, 90, 3);

  return canvas;
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/** Numele fișierului: chordtab-<titlu-slug>.png */
export function pageFileName(title) {
  const slug = (title || 'melodie').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'melodie';
  return `chordtab-${slug}.png`;
}

/** Desenează foaia și o descarcă. Întoarce numele fișierului. */
export async function tearPage(model) {
  const canvas = await drawSheet(model);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = pageFileName(model.title);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return a.download;
}
