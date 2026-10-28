// A small PDF writer for generated research decks: one 16:9 slide per page with a
// title and bullets, in Helvetica. Plain text only (non-Latin-1 characters are
// simplified), which is all the research viewer and the AI need.

const W = 960, H = 540;
const clean = (s) => String(s || '')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
  .replace(/[^\x20-\x7E]/g, '');
const esc = (s) => s.replace(/[\\()]/g, (c) => '\\' + c);

// Wrap to a width, estimating Helvetica's average glyph width at about half the font size.
function wrap(text, size, width) {
  const max = Math.floor(width / (size * 0.5));
  const lines = [];
  let line = '';
  for (const word of clean(text).split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > max) { lines.push(line); line = word; } else line = line ? line + ' ' + word : word;
  }
  if (line) lines.push(line);
  return lines;
}

function page(slide, i, total, deckTitle) {
  const ops = [];
  const text = (x, y, size, s, font = 'F1', rgb = '0.13 0.13 0.13') => ops.push(`BT ${rgb} rg /${font} ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET`);
  ops.push('0.039 0.365 1 rg 0 0 18 540 re f'); // brand bar
  let y = H - 90;
  const cover = i === 0;
  for (const l of wrap(slide.title, cover ? 40 : 30, W - 140)) { text(70, y, cover ? 40 : 30, l, 'F2'); y -= cover ? 50 : 40; }
  y -= 20;
  for (const b of slide.bullets || []) {
    wrap(b, 20, W - 180).forEach((l, j) => {
      if (j === 0 && !cover) ops.push(`0.039 0.365 1 rg 76 ${y + 5} 7 7 re f`);
      text(cover ? 70 : 100, y, 20, l, 'F1', cover ? '0.35 0.35 0.35' : '0.13 0.13 0.13');
      y -= 28;
    });
    y -= 10;
  }
  text(70, 28, 11, `${clean(deckTitle)}   ${i + 1} / ${total}`, 'F1', '0.55 0.55 0.55');
  return ops.join('\n');
}

export function deckPdf(title, slides) {
  const objs = [];
  const add = (s) => objs.push(s) + 2; // object numbers start at 3 (1 = catalog, 2 = pages)
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = slides.map((s, i) => {
    const content = page(s, i, slides.length, title);
    const c = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    return add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`);
  });
  const all = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`, ...objs];
  let out = '%PDF-1.4\n';
  const offsets = all.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${all.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  out += `trailer\n<< /Size ${all.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([out], { type: 'application/pdf' });
}
