// Optional Warm-Up Exercise: 16 empty circles to turn into as many different
// drawings as possible (a flower, a wheel, a clock, a balloon…). Participants draw
// on screen with a pen in a few colors, or click a circle and type an idea for the
// AI to draw into it; they save each finished sheet as an image, and can instead
// print the 8.5×11 sheet and upload a photo. Saved sheets and uploads
// live on their 'warmup' sheet; "I'm done" works as in the sketch steps.
import { html, useState, useEffect, useRef, cx, uid, facilitates } from '../lib.js';
import { drawCircleIdea } from '../ai.js';
import { backend } from '../backend/index.js';
import { Avatar } from './ui.js';
import { IMAGE_TYPES, BulkUpload, DoneBar, doneStatus, useSketchUrls, Lightbox } from './stages3.js';

const SIZE = 1200;                // canvas resolution (square)
const GRID = 4, CELL = SIZE / GRID, RADIUS = CELL * 0.38;
const COLORS = ['#101828', '#E8505B', '#F79009', '#F5C55A', '#4FBE8C', '#0A5DFF', '#7B2FF7', '#8B5A3C'];
const WIDTHS = [['S', 4], ['M', 8], ['L', 16]];
const MAX_SHEETS = 20;

// AI doodles are SVG snippets in a 200×200 box around the circle. Only plain
// shape elements and drawing attributes are kept, and every doodle is turned into
// sketch line art: outlines only, in the ink color picked when it was drawn.
const ART_TAGS = new Set(['g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect']);
const ART_ATTRS = new Set(['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points', 'fill', 'stroke',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'transform']);
function cleanArt(svg, ink) {
  const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.querySelector('parsererror')) return '';
  const walk = (el) => [...el.children].forEach((c) => {
    if (!ART_TAGS.has(c.localName)) { c.remove(); return; }
    [...c.attributes].forEach((a) => { if (!ART_ATTRS.has(a.name) || /url\(|javascript:|expression/i.test(a.value)) c.removeAttribute(a.name); });
    if (c.localName !== 'g') {
      const sw = Math.min(5, Math.max(2.5, parseFloat(c.getAttribute('stroke-width')) || 3));
      c.setAttribute('fill', 'none'); c.setAttribute('stroke', ink); c.setAttribute('stroke-width', sw);
      c.setAttribute('stroke-linecap', 'round'); c.setAttribute('stroke-linejoin', 'round');
      ['opacity', 'fill-opacity', 'stroke-opacity'].forEach((n) => c.removeAttribute(n));
    }
    walk(c);
  });
  walk(root);
  return [...root.children].map((c) => new XMLSerializer().serializeToString(c)).join('');
}
const artImages = new Map(); // svg string → loaded Image
function artImage(svg, onLoad) {
  let img = artImages.get(svg);
  if (!img) {
    img = new Image();
    img.onload = onLoad;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${CELL}" height="${CELL}">${svg}</svg>`);
    artImages.set(svg, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

function drawScene(ctx, strokes, art = {}, onArtLoad) {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = '#98A2B3';
  ctx.lineWidth = 3;
  for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
    ctx.beginPath();
    ctx.arc(CELL * c + CELL / 2, CELL * r + CELL / 2, RADIUS, 0, Math.PI * 2);
    ctx.stroke();
  }
  // AI doodles, each scaled into its cell, with the idea as a small caption.
  ctx.font = '500 20px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  for (const [i, a] of Object.entries(art)) {
    const x = CELL * (i % GRID), y = CELL * Math.floor(i / GRID);
    const img = artImage(a.svg, onArtLoad);
    // A second, fainter pass slightly offset gives the hand-drawn pen look.
    if (img) { ctx.drawImage(img, x, y, CELL, CELL); ctx.globalAlpha = 0.35; ctx.drawImage(img, x + 2, y + 1.5, CELL, CELL); ctx.globalAlpha = 1; }
    const label = a.title.length > 26 ? a.title.slice(0, 25) + '…' : a.title;
    const lw = ctx.measureText(label).width + 16;
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.fillRect(x + (CELL - lw) / 2, y + CELL - 30, lw, 28);
    ctx.fillStyle = '#667085';
    ctx.fillText(label, x + CELL / 2, y + CELL - 9);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.beginPath();
    s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (s.points.length === 1) ctx.lineTo(s.points[0][0] + 0.1, s.points[0][1]);
    ctx.stroke();
  }
}

// Does the eraser at (x, y) touch this stroke?
const touches = (s, x, y, r) => s.points.some(([px, py]) => Math.hypot(px - x, py - y) <= r + s.width / 2);

// The sheet in progress (pen strokes and AI doodles by circle) is kept in this
// browser so a reload doesn't lose it.
function useBoard(key) {
  const [board, setBoard] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? { strokes: v, art: {} } : v || { strokes: [], art: {} }; } catch { return { strokes: [], art: {} }; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(board)); } catch {} }, [key, board]);
  return [board, setBoard];
}

// The prompt that opens over a circle: what should it become?
function IdeaPrompt({ index, current, onDraw, onRemove, onClose }) {
  const [text, setText] = useState(current?.idea || '');
  const input = useRef(null);
  // Focus after the click that opened it has finished (it would take focus back).
  useEffect(() => { const t = setTimeout(() => input.current && input.current.focus(), 0); return () => clearTimeout(t); }, []);
  const col = index % GRID, row = Math.floor(index / GRID);
  const style = { left: `${((col + 0.5) / GRID) * 100}%`, top: `${((row + 0.5) / GRID) * 100}%` };
  const submit = (e) => { e.preventDefault(); if (text.trim()) onDraw(text.trim()); };
  return html`
    <form class=${cx('idea-prompt', col === GRID - 1 && 'edge-right', col === 0 && 'edge-left', row === GRID - 1 && 'edge-bottom')} style=${style} onSubmit=${submit}
      onKeyDown=${(e) => e.key === 'Escape' && onClose()} onPointerDown=${(e) => e.stopPropagation()}>
      <label class="small"><b>What should this circle become?</b></label>
      <input ref=${input} maxLength="80" value=${text} placeholder="a sunflower, a bike wheel, a clock…" onInput=${(e) => setText(e.target.value)} />
      <div class="row">
        <button class="btn btn-sm btn-primary" disabled=${!text.trim()}>${current ? 'Redraw' : 'Draw it'}</button>
        ${current && html`<button type="button" class="btn btn-sm btn-ghost" onClick=${onRemove}>Remove</button>`}
        <span class="grow"></span>
        <button type="button" class="btn btn-sm btn-ghost" onClick=${onClose}>Cancel</button>
      </div>
    </form>`;
}

function CircleCanvas({ w, storageKey, onSave }) {
  const canvas = useRef(null);
  const live = useRef(null); // the stroke being drawn
  const [board, setBoard] = useBoard(storageKey);
  const { strokes, art } = board;
  const setStrokes = (fn) => setBoard((b) => ({ ...b, strokes: fn(b.strokes) }));
  const [tool, setTool] = useState('idea');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(8);
  const [prompt, setPrompt] = useState(null); // circle index with the idea prompt open
  const [drawing, setDrawing] = useState({}); // circle index → true while the AI draws
  const [saved, setSaved] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [tick, setTick] = useState(0); // redraw once an AI doodle's image has loaded

  const redraw = (extra) => drawScene(canvas.current.getContext('2d'), extra ? [...strokes, extra] : strokes, art, () => setTick((t) => t + 1));
  useEffect(() => redraw(), [strokes, art, tick]);

  const at = (e) => {
    const r = canvas.current.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * SIZE), Math.round(((e.clientY - r.top) / r.height) * SIZE)];
  };
  const erase = (x, y) => setStrokes((cur) => { const next = cur.filter((s) => !touches(s, x, y, 18)); if (next.length !== cur.length) setSaved(false); return next; });
  const down = (e) => {
    e.preventDefault();
    const [x, y] = at(e);
    if (tool === 'idea') { setPrompt(Math.floor(y / CELL) * GRID + Math.floor(x / CELL)); return; }
    canvas.current.setPointerCapture(e.pointerId);
    if (tool === 'eraser') { live.current = { erasing: true }; erase(x, y); return; }
    live.current = { color, width, points: [[x, y]] };
    redraw(live.current);
  };
  const move = (e) => {
    if (!live.current) return;
    const [x, y] = at(e);
    if (live.current.erasing) { erase(x, y); return; }
    const pts = live.current.points, [lx, ly] = pts[pts.length - 1];
    if (Math.hypot(x - lx, y - ly) < 2) return;
    pts.push([x, y]);
    redraw(live.current);
  };
  const up = () => {
    const s = live.current;
    live.current = null;
    if (s && !s.erasing) { setStrokes((cur) => [...cur, s]); setSaved(false); }
  };

  async function drawIdea(i, idea) {
    setPrompt(null); setMsg('');
    setDrawing((d) => ({ ...d, [i]: true }));
    try {
      const r = await drawCircleIdea(w, idea);
      const svg = cleanArt(r.svg, color);
      if (!svg) throw new Error('The AI couldn\'t draw that one. Try describing it another way.');
      setBoard((b) => ({ ...b, art: { ...b.art, [i]: { idea, title: r.title || idea, svg } } }));
      setSaved(false);
    } catch (e) { setMsg(e.message); }
    setDrawing((d) => { const n = { ...d }; delete n[i]; return n; });
  }
  const removeIdea = (i) => { setPrompt(null); setBoard((b) => { const a = { ...b.art }; delete a[i]; return { ...b, art: a }; }); setSaved(false); };

  async function save() {
    setBusy(true); setMsg('');
    try {
      redraw();
      const blob = await new Promise((res) => canvas.current.toBlob(res, 'image/png'));
      await onSave(blob);
      setSaved(true);
      setMsg('Saved to your warm-up sheets.');
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  }
  const empty = !strokes.length && !Object.keys(art).length;
  const fresh = () => {
    if (!empty && !saved && !confirm('Start a new sheet? Your current drawing hasn\'t been saved.')) return;
    setBoard({ strokes: [], art: {} }); setSaved(true); setMsg(''); setPrompt(null);
  };
  // Colors and widths keep the "Type an idea" tool (its doodles use the color);
  // from the eraser they switch back to the pen.
  const pickPen = (patch) => { patch(); if (tool === 'eraser') setTool('pen'); };

  return html`
    <div class="warmup-board">
      <div class="warmup-tools" role="toolbar" aria-label="Drawing tools">
        <div class="seg">
          <button class=${cx(tool === 'idea' && 'on')} aria-pressed=${tool === 'idea'} onClick=${() => setTool('idea')} title="Click a circle and type what it should become">✦ Type an idea</button>
          <button class=${cx(tool === 'pen' && 'on')} aria-pressed=${tool === 'pen'} onClick=${() => { setTool('pen'); setPrompt(null); }}>✎ Pen</button>
          <button class=${cx(tool === 'eraser' && 'on')} aria-pressed=${tool === 'eraser'} onClick=${() => { setTool('eraser'); setPrompt(null); }} title="Erase whole pen strokes">⌫ Eraser</button>
        </div>
        <div class="warmup-colors">
          ${COLORS.map((c) => html`<button key=${c} class=${cx('warmup-color', color === c && tool !== 'eraser' && 'on')} style=${{ background: c }}
            aria-label=${'Color ' + c} aria-pressed=${color === c} onClick=${() => pickPen(() => setColor(c))}></button>`)}
        </div>
        <div class="seg warmup-widths">
          ${WIDTHS.map(([label, wd]) => html`<button key=${label} class=${cx(width === wd && tool !== 'eraser' && 'on')} aria-pressed=${width === wd} title=${`Line width ${label}`} onClick=${() => pickPen(() => setWidth(wd))}>
            <span class="warmup-dot" style=${{ width: wd / 2 + 3 + 'px', height: wd / 2 + 3 + 'px' }}></span></button>`)}
        </div>
        <span class="grow"></span>
        <button class="btn btn-sm btn-ghost" disabled=${!strokes.length} onClick=${() => { setStrokes((cur) => cur.slice(0, -1)); setSaved(false); }} title="Undo the last pen stroke">Undo</button>
        <button class="btn btn-sm btn-ghost" onClick=${fresh}>New sheet</button>
        <button class="btn btn-sm btn-primary" disabled=${busy || empty || saved} onClick=${save}>${busy ? 'Saving…' : saved && !empty ? 'Saved ✓' : 'Save drawing'}</button>
      </div>
      <p class="small muted warmup-hint">${tool === 'idea' ? 'Click a circle and type what it should become. The AI sketches it in, in the pen color you picked. Switch to the pen to add your own touches.' : tool === 'pen' ? 'Draw on the circles. Switch to "Type an idea" to have the AI draw one for you.' : 'Click or drag over a pen stroke to erase it.'}</p>
      <div class="warmup-stage">
        <canvas ref=${canvas} class=${cx('warmup-canvas', tool === 'eraser' && 'erasing', tool === 'idea' && 'picking')} width=${SIZE} height=${SIZE}
          onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}
          aria-label="Sixteen empty circles to draw on"></canvas>
        ${Object.keys(drawing).map((i) => html`<span key=${i} class="idea-busy" style=${{ left: `${((i % GRID) + 0.5) / GRID * 100}%`, top: `${(Math.floor(i / GRID) + 0.5) / GRID * 100}%` }}>Drawing…</span>`)}
        ${prompt != null && html`<${IdeaPrompt} key=${prompt} index=${prompt} current=${art[prompt]} onDraw=${(idea) => drawIdea(prompt, idea)} onRemove=${() => removeIdea(prompt)} onClose=${() => setPrompt(null)} />`}
      </div>
      ${msg && html`<span class="small muted">${msg}</span>`}
    </div>`;
}

// The 8.5×11 printable sheet: a PDF (jsPDF, loaded on demand), or an SVG of the
// same page if the PDF library can't load.
async function downloadPrintable(title) {
  const cols = 4, size = 126, r = 50, left = 54, top = 168;
  try {
    const { jsPDF } = await import('https://esm.sh/jspdf@2.5.1');
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text('Warm-Up: 16 circles', 54, 72);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(90);
    doc.text(title, 54, 92);
    doc.text('Turn as many circles as you can into different drawings: a flower, a wheel, a clock, a balloon…', 54, 116);
    doc.text('Name: ______________________________', 54, 140);
    doc.setDrawColor(150); doc.setLineWidth(1.2);
    for (let i = 0; i < 16; i++) doc.circle(left + size * (i % cols) + size / 2, top + size * Math.floor(i / cols) + size / 2, r);
    doc.setFontSize(9); doc.text('When you are done, take a photo and upload it in the workshop.', 54, 750);
    doc.save('warm-up-16-circles.pdf');
  } catch {
    const circles = Array.from({ length: 16 }, (_, i) => `<circle cx="${left + size * (i % cols) + size / 2}" cy="${top + size * Math.floor(i / cols) + size / 2}" r="${r}" fill="none" stroke="#969696" stroke-width="1.2"/>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8.5in" height="11in" viewBox="0 0 612 792"><rect width="612" height="792" fill="#fff"/>
<text x="54" y="72" font-family="Arial" font-size="20" font-weight="bold">Warm-Up: 16 circles</text>
<text x="54" y="116" font-family="Arial" font-size="11" fill="#5a5a5a">Turn as many circles as you can into different drawings: a flower, a wheel, a clock, a balloon…</text>
<text x="54" y="140" font-family="Arial" font-size="11" fill="#5a5a5a">Name: ______________________________</text>${circles}</svg>`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    a.download = 'warm-up-16-circles.svg';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}

// ── Optional step: Warm-Up Exercise ──
export function WarmupStage({ w, data, me, isOrganizer }) {
  const sheets = data.sheets.filter((x) => x.kind === 'warmup');
  const mine = me && sheets.find((x) => x.member_id === me.id);
  const cells = mine ? mine.cells : [];
  const doers = data.members.filter((m) => !facilitates(m) && !m.is_synthetic);
  const urls = useSketchUrls((isOrganizer ? sheets.flatMap((x) => x.cells) : cells).map((c) => c.file_path));
  const [box, setBox] = useState(null);
  const [upload, setUpload] = useState({ busy: false, msg: '', error: '' });
  const [printing, setPrinting] = useState(false);

  const save = (patch) => backend.saveSheet(w.id, me.id, 'warmup', { cells, ...patch });
  const add = async (blobs) => {
    const paths = await Promise.all(blobs.map(([b, ext]) => backend.uploadSketch(w.id, me.id, b, ext)));
    return save({ cells: [...cells, ...paths.map((file_path) => ({ id: uid(), file_path, caption: '' }))] });
  };
  async function uploadFiles(list) {
    const files = [...list].filter((f) => IMAGE_TYPES[f.type] && f.size <= 10e6);
    const skipped = list.length - files.length, room = MAX_SHEETS - cells.length, take = files.slice(0, Math.max(0, room));
    const notes = [skipped && `${skipped} skipped (not an image, or over 10 MB)`, files.length > take.length && `${files.length - take.length} didn't fit: ${MAX_SHEETS} sheets at most`].filter(Boolean);
    if (!take.length) { setUpload({ busy: false, msg: '', error: notes.join('. ') || 'No images to upload.' }); return; }
    setUpload({ busy: true, msg: `Uploading ${take.length}…`, error: '' });
    try {
      await add(take.map((f) => [f, IMAGE_TYPES[f.type]]));
      setUpload({ busy: false, msg: `Added ${take.length}.`, error: notes.join('. ') });
    } catch (e) { setUpload({ busy: false, msg: '', error: e.message }); }
  }
  const print = async () => { setPrinting(true); await downloadPrintable(w.title); setPrinting(false); };

  return html`
    <div class="stack">
      <div class="warmup-intro">
        <p>Turn the circles into as many different things as you can: a flower, a wheel, a clock, a balloon, a face… Go for quantity, not polish. When a sheet is full, save it and start a new one.</p>
        <button class="btn btn-sm" disabled=${printing} onClick=${print}>${printing ? 'Preparing…' : '⤓ Printable sheet (8.5×11)'}</button>
      </div>
      ${me && !facilitates(me) ? html`
        <${CircleCanvas} w=${w} storageKey=${`warmup:${w.id}:${me.id}`} onSave=${(blob) => (cells.length >= MAX_SHEETS ? Promise.reject(new Error(`${MAX_SHEETS} sheets at most.`)) : add([[blob, 'png']]))} />
        <div class="row between"><h3>Your warm-up sheets <span class="muted small">${cells.length}</span></h3><span class="muted small">Drawn here or photos of the printed sheet.</span></div>
        <${BulkUpload} status=${upload} onFiles=${uploadFiles} hint="Drew on paper? Take a photo and choose or drop it here. You can add several at once." />
        ${cells.length > 0 && html`<div class="warmup-gallery">
          ${cells.map((c, i) => html`<figure key=${c.id} class="warmup-thumb">
            ${urls[c.file_path] ? html`<img src=${urls[c.file_path]} alt=${`Warm-up sheet ${i + 1}`} onClick=${() => setBox(c)} />` : html`<span class="muted small">Loading…</span>`}
            <button class="icon-btn warmup-remove" title="Remove" aria-label=${`Remove sheet ${i + 1}`} onClick=${() => confirm('Remove this sheet?') && save({ cells: cells.filter((x) => x.id !== c.id) })}>✕</button>
          </figure>`)}
        </div>`}
        <${DoneBar} sheet=${mine} count=${cells.length} what="the warm-up" onChange=${(ready) => save({ ready })} />`
      : html`<p class="muted">Participants are drawing. Their sheets show up below as they save them.</p>`}
      ${isOrganizer && html`
        <section class="card">
          <h3>Progress</h3>
          <ul class="progress-list">${doers.map((m) => { const x = sheets.find((s) => s.member_id === m.id); const n = x ? x.cells.length : 0; return html`
            <li key=${m.id}><${Avatar} name=${m.name} color=${m.color} size=${22} /><span class="grow">${m.name}</span>
              <span class="small muted">${n} ${n === 1 ? 'sheet' : 'sheets'}</span>${doneStatus(x, n)}</li>`; })}</ul>
          <p class="muted small">${sheets.filter((x) => x.ready && doers.some((m) => m.id === x.member_id)).length} of ${doers.length} done</p>
          ${sheets.some((x) => x.cells.length) && html`<div class="warmup-gallery">
            ${sheets.flatMap((x) => x.cells.map((c) => ({ ...c, member: data.members.find((m) => m.id === x.member_id) }))).map((c) => html`
              <figure key=${c.id} class="warmup-thumb">
                ${urls[c.file_path] && html`<img src=${urls[c.file_path]} alt="" onClick=${() => setBox(c)} />`}
                <figcaption class="small">${c.member?.name}</figcaption>
              </figure>`)}
          </div>`}
        </section>`}
      ${box && html`<${Lightbox} src=${urls[box.file_path]} caption=${box.member?.name || 'Warm-up sheet'} onClose=${() => setBox(null)} />`}
    </div>`;
}
