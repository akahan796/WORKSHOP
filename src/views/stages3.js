// Phase 3 stages: Crazy 8s, sharing them (per-sketch votes), solution sketches,
// review, and voting on a direction with the Decider.
import { html, useState, useEffect, useMemo, cx, uid, DECIDER_PURPLE, facilitates } from '../lib.js';
import { skillFor, sketchPrompt } from '../skills.js';
import { backend } from '../backend/index.js';
import { Avatar, Empty, AiButton, Modal, useCopy } from './ui.js';
import { tallyItems, DECIDER_WEIGHT, canMemberVote, synthCrazy8, synthSketchVotes, synthSolutions, synthComments, aiDecideSolution } from '../ai.js';

const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
const MAX_FRAMES = 6;

function useAuthors(members) {
  return useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members]);
}

// Signed/object URLs for sketch files, fetched as paths appear.
export function useSketchUrls(paths) {
  const [urls, setUrls] = useState({});
  const key = paths.filter(Boolean).sort().join('|');
  useEffect(() => {
    const need = paths.filter((p) => p && !urls[p]);
    if (!need.length) return;
    let alive = true;
    backend.sketchUrls(need).then((u) => alive && setUrls((cur) => ({ ...cur, ...u }))).catch(() => {});
    return () => { alive = false; };
  }, [key]);
  return urls;
}

// Always 8 cells; empty ones take ids from `ids` so they stay stable between renders.
const pad8 = (cells, ids = []) => Array.from({ length: 8 }, (_, i) => cells[i] || { id: ids[i] || uid(), file_path: null, caption: '' });
const allCrazyCells = (sheets) => sheets.filter((x) => x.kind === 'crazy8').flatMap((x) => x.cells.map((c, i) => ({ ...c, member_id: x.member_id, index: i }))).filter((c) => c.file_path || c.caption);

export function ChosenHmw({ w, data }) {
  const id = (w.step_state || {}).hmw_final?.sticky_id;
  const s = id && data.stickies.find((x) => x.id === id);
  return s
    ? html`<div class="chosen-hmw"><span class="eyebrow">Our HMW</span> ${s.text}</div>`
    : html`<div class="chosen-hmw muted">No HMW chosen yet. Sketch toward the group's top problem or opportunity.</div>`;
}

function SkillBox({ title, text, prompt }) {
  const [open, setOpen] = useState(false);
  const [copied, copy] = useCopy();
  if (!text && !prompt) return null;
  return html`
    <div class="skill-box">
      <div class="row between">
        <b class="small">${title}</b>
        <div class="row">
          ${prompt && html`<button class="btn btn-sm" onClick=${() => copy(prompt, 'p')}>${copied === 'p' ? 'Copied ✓' : 'Copy prompt'}</button>`}
          ${text && html`<button class="btn btn-sm" onClick=${() => copy(text, 's')}>${copied === 's' ? 'Copied ✓' : 'Copy skill'}</button>`}
          ${text && html`<button class="btn btn-sm btn-ghost" onClick=${() => setOpen(!open)}>${open ? 'Hide' : 'Show'} skill</button>`}
        </div>
      </div>
      ${open && html`<pre class="skill-text">${text}</pre>`}
    </div>`;
}

export function Lightbox({ src, caption, onClose }) {
  return html`<${Modal} title=${caption || 'Sketch'} onClose=${onClose} wide><img class="lightbox-img" src=${src} alt=${caption || ''} /><//>`;
}

// One sketch slot: click, drag & drop, or paste (Ctrl/Cmd+V) an image.
function CellEditor({ cell, url, label, onFile, onCaption, onClear }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [caption, setCaption] = useState(cell.caption || '');
  useEffect(() => setCaption(cell.caption || ''), [cell.caption]);

  async function take(file) {
    if (!file) return;
    setError('');
    const ext = IMAGE_TYPES[file.type];
    if (!ext) { setError('Use a PNG, JPG, WebP, GIF or SVG image.'); return; }
    if (file.size > 10e6) { setError('Images must be under 10 MB.'); return; }
    setBusy(true);
    try { await onFile(file, ext); } catch (e) { setError(e.message); }
    setBusy(false);
  }
  const fromClipboard = (e) => {
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); take(f); }
  };

  return html`
    <div class="cell-edit">
      <label class=${cx('cell-drop', cell.file_path && 'has-img')} tabIndex="0" onPaste=${fromClipboard}
        onDragOver=${(e) => e.preventDefault()} onDrop=${(e) => { e.preventDefault(); take(e.dataTransfer.files[0]); }}
        title="Click to choose, drop, or paste an image">
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange=${(e) => { take(e.target.files[0]); e.target.value = ''; }} />
        ${cell.file_path ? (url ? html`<img src=${url} alt=${caption} />` : html`<span class="muted small">Loading…</span>`)
          : html`<span class="cell-hint"><b>${label}</b><span class="muted small">${busy ? 'Uploading…' : 'Click, drop or paste'}</span></span>`}
      </label>
      <div class="row nowrap">
        <input class="cell-caption" placeholder="Caption" value=${caption} onInput=${(e) => setCaption(e.target.value)} onBlur=${() => caption !== (cell.caption || '') && onCaption(caption)} />
        ${(cell.file_path || cell.caption) && onClear && html`<button class="icon-btn" title="Clear" onClick=${onClear}>✕</button>`}
      </div>
      ${error && html`<span class="error small">${error}</span>`}
    </div>`;
}

// Dots on a vote target: mine always, everyone's when revealed (Decider in purple).
function Dots({ votes, me, show, authors }) {
  const list = show ? votes : votes.filter((v) => v.member_id === me?.id);
  return html`<div class="dots" onClick=${(e) => e.stopPropagation()}>
    ${list.map((v) => html`<button key=${v.id} class="dot" style=${{ background: authors[v.member_id]?.is_decider ? DECIDER_PURPLE : '#141414' }}
      title=${(authors[v.member_id]?.name || '') + (v.member_id === me?.id ? ' (click to remove)' : '')} onClick=${() => v.member_id === me?.id && backend.deleteVote(v.id)}></button>`)}
    ${show && votes.length > 0 && html`<span class="small muted">${votes.length}</span>`}
  </div>`;
}

function VoteHeader({ left, dots, canVote, isDecider, decider, what }) {
  return html`<p class="muted small">
    ${canVote ? html`You have <b>${left}</b> of ${dots} votes left. Click ${what} to add a dot; click your dot to take it back. Voting for your own is fine.` : 'Participants are voting.'}
    ${isDecider ? html` <b style=${{ color: DECIDER_PURPLE }}>You're the Decider: your dots are purple and count ${DECIDER_WEIGHT}×.</b>` : decider ? html` Purple dots are ${decider.name}'s (the Decider), counting ${DECIDER_WEIGHT}×.` : ''}
  </p>`;
}

function OrganizerVoteTools({ w, dotsKey, revealKey, dots, revealed, round, votes, aiLabel, aiRun }) {
  return html`<div class="row">
    <label class="minutes">Votes each <input type="number" min="1" max="10" value=${dots} onChange=${(e) => backend.setStepState(w.id, { [dotsKey]: Number(e.target.value) })} /></label>
    ${aiRun && html`<${AiButton} label=${aiLabel} run=${aiRun} />`}
    <label class="toggle"><input type="checkbox" checked=${revealed} onChange=${(e) => backend.setStepState(w.id, { [revealKey]: e.target.checked })} /> Reveal votes</label>
    <button class="btn btn-sm btn-ghost" disabled=${!votes.length} onClick=${() => confirm('Clear every vote in this round?') && backend.deleteVotes(w.id, round)}>Clear votes</button>
  </div>`;
}

// ── Step 6: Crazy 8s ──
export function Crazy8Stage({ w, data, me, isOrganizer }) {
  const authors = useAuthors(data.members);
  const sheets = data.sheets.filter((x) => x.kind === 'crazy8');
  const mine = me && sheets.find((x) => x.member_id === me.id);
  const blankIds = useMemo(() => Array.from({ length: 8 }, () => uid()), []);
  const cells = pad8(mine ? mine.cells : [], blankIds);
  const urls = useSketchUrls(cells.map((c) => c.file_path));
  const sketchers = data.members.filter((m) => !facilitates(m));
  const hmw = data.stickies.find((x) => x.id === (w.step_state || {}).hmw_final?.sticky_id);
  const prompt = sketchPrompt('crazy8', { w, hmw: hmw?.text, stickies: data.stickies });

  const save = (i, patch) => {
    const next = cells.map((c, j) => (j === i ? { ...c, ...patch } : c));
    return backend.saveSheet(w.id, me.id, 'crazy8', { cells: next });
  };

  return html`
    <div class="stack">
      <${ChosenHmw} w=${w} data=${data} />
      ${me && !facilitates(me) ? html`
        <${SkillBox} title="Crazy 8s skill: run it in your AI tool with the prompt, then add each sketch below" text=${skillFor(w, 'crazy8')} prompt=${prompt} />
        <div class="row between"><h3>Your Crazy 8s <span class="muted small">${cells.filter((c) => c.file_path).length}/8</span></h3><span class="muted small">Only you can see your sheet until the share-out.</span></div>
        <div class="crazy8-grid">
          ${cells.map((c, i) => html`<${CellEditor} key=${c.id} cell=${c} url=${urls[c.file_path]} label=${String(i + 1)}
            onFile=${async (f, ext) => save(i, { file_path: await backend.uploadSketch(w.id, me.id, f, ext) })}
            onCaption=${(caption) => save(i, { caption })} onClear=${() => save(i, { file_path: null, caption: '' })} />`)}
        </div>` : html`<p class="muted">Participants are sketching. Sheets stay private until the share-out.</p>`}
      ${isOrganizer && html`
        <section class="card">
          <div class="row between"><h3>Progress</h3>
            ${data.members.some((m) => m.is_synthetic) && html`<${AiButton} label="AI participants sketch their Crazy 8s" busyHint="AI sketching takes 2–3 minutes. You can keep working meanwhile." run=${(progress) => {
              const redo = data.members.some((m) => m.is_synthetic && sheets.some((x) => x.member_id === m.id && x.cells.some((c) => c.file_path)));
              if (redo && !confirm("The AI participants already have Crazy 8s. Replace them with new sketches?")) return false;
              return synthCrazy8(w, data.members, progress);
            }} />`}</div>
          <ul class="progress-list">
            ${sketchers.map((m) => { const x = sheets.find((s) => s.member_id === m.id); const n = x ? x.cells.filter((c) => c.file_path).length : 0; return html`
              <li key=${m.id}><${Avatar} name=${m.name} color=${m.color} size=${22} /><span class="grow">${m.name}${m.is_synthetic ? ' (AI)' : ''}</span>
                <span class="bar small-bar"><span style=${{ width: (n / 8) * 100 + '%' }}></span></span><span class="small">${n}/8</span></li>`; })}
          </ul>
        </section>`}
    </div>`;
}

function SheetGrid({ sheet, urls, votes, me, show, authors, canVote, onVote, onOpen }) {
  return html`<div class="crazy8-grid view">
    ${pad8(sheet.cells).map((c, i) => html`
      <div key=${i} class=${cx('cell-view', canVote && 'can-vote')} onClick=${() => canVote && (c.file_path || c.caption) && onVote(c)}>
        <div class="cell-img">${c.file_path ? html`<img src=${urls[c.file_path]} alt=${c.caption} onClick=${(e) => { e.stopPropagation(); onOpen(c); }} />` : html`<span class="muted small">${i + 1}</span>`}</div>
        <div class="cell-cap small">${c.caption}</div>
        <${Dots} votes=${votes.filter((v) => v.target_id === c.id)} me=${me} show=${show} authors=${authors} />
      </div>`)}
  </div>`;
}

// ── Step 7: Share Crazy 8s + per-sketch votes ──
export function Share8Stage({ w, data, me, isOrganizer }) {
  const st = w.step_state || {};
  const authors = useAuthors(data.members);
  const sheets = data.sheets.filter((x) => x.kind === 'crazy8' && x.cells.some((c) => c.file_path || c.caption));
  const [local, setLocal] = useState(null);
  const [box, setBox] = useState(null);
  const spotId = local || st.share8_member || sheets[0]?.member_id;
  const spot = sheets.find((x) => x.member_id === spotId);
  const urls = useSketchUrls(sheets.flatMap((x) => x.cells.map((c) => c.file_path)));
  const dots = st.vote8_dots || 3;
  const revealed = !!st.vote8_reveal;
  const votes = data.votes.filter((v) => v.round === 'crazy8');
  const mine = me ? votes.filter((v) => v.member_id === me.id) : [];
  const left = dots - mine.length;
  const canVote = canMemberVote(w, me) && left > 0;
  const decider = data.members.find((m) => m.is_decider);
  const cells = allCrazyCells(data.sheets);
  const ranked = tallyItems(cells, votes, data.members).filter((r) => r.dots > 0);

  const vote = (c) => backend.addVotes([{ workshop_id: w.id, member_id: me.id, target_id: c.id, round: 'crazy8' }]);
  const spotlight = (memberId) => (isOrganizer ? backend.setStepState(w.id, { share8_member: memberId }) : setLocal(memberId));

  if (!sheets.length) return html`<${Empty} title="No Crazy 8s yet">Sheets appear here once people add sketches.<//>`;
  return html`
    <div class="stack">
      <${ChosenHmw} w=${w} data=${data} />
      <div class="row between stage-head">
        <div><h3>Sharing: ${authors[spotId]?.name || ''} ${local && html`<button class="btn btn-sm btn-primary" onClick=${() => setLocal(null)}>Back to presenter</button>`}</h3>
          <${VoteHeader} left=${left} dots=${dots} canVote=${canMemberVote(w, me)} isDecider=${me?.is_decider} decider=${decider} what="a single sketch" /></div>
        ${isOrganizer && html`<${OrganizerVoteTools} w=${w} dotsKey="vote8_dots" revealKey="vote8_reveal" dots=${dots} revealed=${revealed} round="crazy8" votes=${votes}
          aiLabel="Cast AI participants' votes" aiRun=${data.members.some((m) => m.is_synthetic) ? async () => {
            const b = await synthSketchVotes(w, 'crazy8', cells.map((c) => ({ id: c.id, text: `${c.caption || 'Untitled sketch'} (by ${authors[c.member_id]?.name})`, image_paths: c.file_path ? [c.file_path] : [] })), data.members, dots);
            return `${b.length} AI ballots cast.`; } : null} />`}
      </div>
      <div class="share-layout">
        <div class="grow">${spot && html`<${SheetGrid} sheet=${spot} urls=${urls} votes=${votes} me=${me} show=${revealed || isOrganizer} authors=${authors} canVote=${canVote} onVote=${vote} onOpen=${(c) => setBox(c)} />`}</div>
        ${(revealed || isOrganizer) && html`
          <aside class="card results">
            <h3>Top sketches ${!revealed && html`<span class="muted small">(only you see this until you reveal)</span>`}</h3>
            ${ranked.length ? html`<ol class="ranking">${ranked.slice(0, 8).map((r) => html`
              <li key=${r.item.id} class="rank-sketch">${r.item.file_path && html`<img src=${urls[r.item.file_path]} alt="" />`}
                <div><b class="small">${r.item.caption || 'Sketch ' + (r.item.index + 1)}</b><div class="muted small">${authors[r.item.member_id]?.name} · ${r.score}</div></div></li>`)}</ol>`
              : html`<p class="muted small">No votes yet.</p>`}
          </aside>`}
      </div>
      <div class="sheet-strip">
        ${sheets.map((x) => html`
          <button key=${x.id} class=${cx('sheet-thumb', x.member_id === spotId && 'on')} onClick=${() => spotlight(x.member_id)}
            title=${isOrganizer ? 'Spotlight this sheet for everyone' : 'Look at this sheet'}>
            <${Avatar} name=${authors[x.member_id]?.name} color=${authors[x.member_id]?.color} size=${22} />
            <span class="small">${authors[x.member_id]?.name}</span>
          </button>`)}
      </div>
      ${box && html`<${Lightbox} src=${urls[box.file_path]} caption=${box.caption} onClose=${() => setBox(null)} />`}
    </div>`;
}

const checklist = (x) => [
  ['Clear title', !!(x && x.title.trim())],
  ['At least 3 frames', !!(x && x.cells.filter((c) => c.file_path).length >= 3)],
  ['Pictures and words in every frame', !!(x && x.cells.length && x.cells.every((c) => !c.file_path || c.caption.trim()))],
];

// ── Step 8: Solution sketch ──
export function SolutionStage({ w, data, me, isOrganizer }) {
  const authors = useAuthors(data.members);
  const mine = me && data.sheets.find((x) => x.kind === 'solution' && x.member_id === me.id);
  const blankFrames = useMemo(() => [0, 1, 2].map(() => ({ id: uid(), file_path: null, caption: '' })), []);
  const frames = mine && mine.cells.length ? mine.cells : blankFrames;
  const votes8 = data.votes.filter((v) => v.round === 'crazy8');
  const ideas = tallyItems(allCrazyCells(data.sheets), votes8, data.members);
  const urls = useSketchUrls([...frames.map((c) => c.file_path), ...ideas.slice(0, 12).map((r) => r.item.file_path)]);
  const [title, setTitle] = useState(mine?.title || '');
  const [summary, setSummary] = useState(mine?.summary || '');
  useEffect(() => { setTitle(mine?.title || ''); setSummary(mine?.summary || ''); }, [mine?.id]);
  const solutions = data.sheets.filter((x) => x.kind === 'solution');
  const sketchers = data.members.filter((m) => !facilitates(m));

  const save = (patch) => backend.saveSheet(w.id, me.id, 'solution', { cells: frames, ...patch });
  const saveFrame = (i, patch) => save({ cells: frames.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  return html`
    <div class="stack">
      <${ChosenHmw} w=${w} data=${data} />
      ${me && !facilitates(me) ? html`
        <${SkillBox} title="Solution sketch skill: run it in your AI tool with the prompt for a consistent look" text=${skillFor(w, 'solution')}
          prompt=${sketchPrompt('solution', { w, hmw: data.stickies.find((x) => x.id === w.step_state?.hmw_final?.sticky_id)?.text, stickies: data.stickies,
            ideas: ideas.filter((r) => r.item.caption).map((r) => ({ caption: r.item.caption, author: authors[r.item.member_id]?.name, votes: r.score })),
            mine: (data.sheets.find((x) => x.kind === 'crazy8' && x.member_id === me.id)?.cells || []).map((c) => c.caption).filter(Boolean) })} />
        <section class="card stack">
          <div class="form-grid">
            <label class="field"><span class="field-label">Title</span><input value=${title} placeholder="A clear, memorable name" onInput=${(e) => setTitle(e.target.value)} onBlur=${() => title !== (mine?.title || '') && save({ title })} /></label>
            <label class="field"><span class="field-label">Status</span>
              <label class="toggle"><input type="checkbox" checked=${!!mine?.ready} onChange=${(e) => save({ ready: e.target.checked })} /> Ready for review</label></label>
            <label class="field span-2"><span class="field-label">Summary</span><textarea rows="2" value=${summary} placeholder="What it is and why it answers the HMW" onInput=${(e) => setSummary(e.target.value)} onBlur=${() => summary !== (mine?.summary || '') && save({ summary })}></textarea></label>
          </div>
          <div class="field"><span class="field-label">Builds on (optional): pick the strongest Crazy 8s idea, yours or anyone's</span>
            <div class="idea-pick">${ideas.slice(0, 12).map((r) => html`
              <button key=${r.item.id} class=${cx('idea', mine?.based_on === r.item.id && 'on')} onClick=${() => save({ based_on: mine?.based_on === r.item.id ? null : r.item.id })}>
                ${r.item.file_path ? html`<img src=${urls[r.item.file_path]} alt="" />` : html`<span class="muted small">No image</span>`}
                <span class="small">${r.item.caption || 'Sketch'}</span><span class="muted small">${authors[r.item.member_id]?.name.split(' ')[0]} · ${r.score} votes</span>
              </button>`)}</div>
          </div>
          <div class="row between"><h4>Frames</h4><ul class="checklist">${checklist(mine).map(([t, ok]) => html`<li key=${t} class=${ok ? 'ok' : ''}>${ok ? '✓' : '○'} ${t}</li>`)}</ul></div>
          <div class="frames">
            ${frames.map((c, i) => html`<${CellEditor} key=${c.id} cell=${c} url=${urls[c.file_path]} label=${'Frame ' + (i + 1)}
              onFile=${async (f, ext) => saveFrame(i, { file_path: await backend.uploadSketch(w.id, me.id, f, ext) })}
              onCaption=${(caption) => saveFrame(i, { caption })}
              onClear=${frames.length > 3 ? () => save({ cells: frames.filter((_, j) => j !== i) }) : () => saveFrame(i, { file_path: null, caption: '' })} />`)}
            ${frames.length < MAX_FRAMES && html`<button class="add-frame" onClick=${() => save({ cells: [...frames, { id: uid(), file_path: null, caption: '' }] })}>+ Add frame</button>`}
          </div>
        </section>` : html`<p class="muted">Participants are developing their solution sketches.</p>`}
      ${isOrganizer && html`
        <section class="card">
          <div class="row between"><h3>Progress</h3>
            ${data.members.some((m) => m.is_synthetic) && html`<${AiButton} label="AI participants create solution sketches" busyHint="AI sketching takes 2–3 minutes. You can keep working meanwhile."
              run=${(progress) => {
                const redo = data.members.some((m) => m.is_synthetic && solutions.some((x) => x.member_id === m.id));
                if (redo && !confirm("The AI participants already have solution sketches. Replace them with new ones?")) return false;
                return synthSolutions(w, data.members, ideas.slice(0, 15).map((r) => ({ id: r.item.id, caption: r.item.caption, author: authors[r.item.member_id]?.name, votes: r.score })), progress);
              }} />`}</div>
          <ul class="progress-list">${sketchers.map((m) => { const x = solutions.find((s) => s.member_id === m.id); return html`
            <li key=${m.id}><${Avatar} name=${m.name} color=${m.color} size=${22} /><span class="grow">${m.name}${m.is_synthetic ? ' (AI)' : ''}</span>
              <span class="small">${x ? `${x.title || 'Untitled'} · ${x.cells.filter((c) => c.file_path).length} frames` : 'Not started'}</span>
              ${x?.ready ? html`<span class="pill pill-live">Ready</span>` : html`<span class="pill">Draft</span>`}</li>`; })}</ul>
        </section>`}
    </div>`;
}

export function SolutionCard({ x, authors, urls, data, onOpen, children, compact }) {
  const base = x.based_on && allCrazyCells(data.sheets).find((c) => c.id === x.based_on);
  return html`
    <article class=${cx('card solution-card', compact && 'compact')}>
      <div class="row between"><div class="row"><${Avatar} name=${authors[x.member_id]?.name} color=${authors[x.member_id]?.color} size=${24} /><b>${x.title || 'Untitled'}</b></div>
        ${x.ready ? html`<span class="pill pill-live">Final</span>` : html`<span class="pill">Draft</span>`}</div>
      <p class="small">${x.summary}</p>
      <div class="frame-strip">${x.cells.filter((c) => c.file_path || c.caption).map((c, i) => html`
        <figure key=${c.id} onClick=${(e) => { e.stopPropagation(); c.file_path && onOpen(c); }}>
          ${c.file_path ? html`<img src=${urls[c.file_path]} alt=${c.caption} />` : html`<div class="no-img muted small">No image</div>`}
          <figcaption class="small"><b>${i + 1}.</b> ${c.caption}</figcaption></figure>`)}</div>
      ${base && !compact && html`<p class="muted small">Builds on "${base.caption || 'a sketch'}" by ${authors[base.member_id]?.name}</p>`}
      ${children}
    </article>`;
}

// ── Step 9: Review and finalize ──
export function ReviewStage({ w, data, me, isOrganizer }) {
  const authors = useAuthors(data.members);
  const solutions = data.sheets.filter((x) => x.kind === 'solution');
  const urls = useSketchUrls(solutions.flatMap((x) => x.cells.map((c) => c.file_path)));
  const [box, setBox] = useState(null);
  const [drafts, setDrafts] = useState({});
  const comments = data.stickies.filter((s) => s.step === 'review' && s.kind === 'comment');

  async function post(x) {
    const text = (drafts[x.id] || '').trim();
    if (!text) return;
    await backend.addSticky({ workshop_id: w.id, member_id: me.id, step: 'review', kind: 'comment', text, data: { sheet_id: x.id } });
    setDrafts({ ...drafts, [x.id]: '' });
  }

  if (!solutions.length) return html`<${Empty} title="No solution sketches yet" />`;
  return html`
    <div class="stack">
      <div class="row between stage-head">
        <p class="muted">Review each other's sketches: leave a strength, a question, or a build-on idea. Owners mark their sketch Final when done.</p>
        ${isOrganizer && data.members.some((m) => m.is_synthetic) && html`<${AiButton} label="AI participants comment" run=${() => synthComments(w, solutions, data.members)} />`}
      </div>
      <div class="solution-grid">
        ${solutions.map((x) => html`
          <${SolutionCard} key=${x.id} x=${x} authors=${authors} urls=${urls} data=${data} onOpen=${setBox}>
            ${me && x.member_id === me.id && html`<label class="toggle small"><input type="checkbox" checked=${x.ready} onChange=${(e) => backend.saveSheet(w.id, me.id, 'solution', { ready: e.target.checked })} /> Mark my sketch final</label>`}
            <ul class="comments">${comments.filter((c) => c.data?.sheet_id === x.id).map((c) => html`
              <li key=${c.id}><b class="small">${authors[c.member_id]?.name}:</b> <span class="small">${c.text}</span>
                ${me && c.member_id === me.id && html`<button class="sticky-x" onClick=${() => backend.deleteSticky(c.id)}>✕</button>`}</li>`)}</ul>
            ${me && html`<div class="row nowrap"><input placeholder="Add a comment" value=${drafts[x.id] || ''} onInput=${(e) => setDrafts({ ...drafts, [x.id]: e.target.value })} onKeyDown=${(e) => e.key === 'Enter' && post(x)} />
              <button class="btn btn-sm" onClick=${() => post(x)}>Post</button></div>`}
          <//>`)}
      </div>
      ${box && html`<${Lightbox} src=${urls[box.file_path]} caption=${box.caption} onClose=${() => setBox(null)} />`}
    </div>`;
}

// ── Step 10: Vote on a direction (up to two rounds) ──
export function VoteSolutionStage({ w, data, me, isOrganizer }) {
  const st = w.step_state || {};
  const authors = useAuthors(data.members);
  const round = st.solution_round === 2 ? 2 : 1;
  const voteRound = round === 2 ? 'solution2' : 'solution';
  const all = data.sheets.filter((x) => x.kind === 'solution');
  const solutions = round === 2 && st.solution_finalists ? all.filter((x) => st.solution_finalists.includes(x.id)) : all;
  const urls = useSketchUrls(all.flatMap((x) => x.cells.map((c) => c.file_path)));
  const [box, setBox] = useState(null);
  const dots = st.vote_sol_dots || 3;
  const revealed = !!st.vote_sol_reveal;
  const votes = data.votes.filter((v) => v.round === voteRound);
  const mine = me ? votes.filter((v) => v.member_id === me.id) : [];
  const left = dots - mine.length;
  const canVote = canMemberVote(w, me);
  const decider = data.members.find((m) => m.is_decider);
  const isDecider = me?.is_decider;
  const ranked = tallyItems(solutions, votes, data.members);
  const final = st.solution_final;
  const finalSheet = final && all.find((x) => x.id === final.sheet_id);
  const showAll = revealed || isOrganizer;
  const reasons = data.stickies.filter((s) => s.step === 'vote_solution' && s.kind === 'reason' && s.data?.round === round);
  const myReason = me && reasons.find((r) => r.member_id === me.id);
  const [reason, setReason] = useState('');
  useEffect(() => setReason(myReason?.text || ''), [myReason?.id]);

  const saveReason = async () => {
    const t = reason.trim();
    if (myReason) await backend.updateSticky(myReason.id, { text: t });
    else if (t) await backend.addSticky({ workshop_id: w.id, member_id: me.id, step: 'vote_solution', kind: 'reason', text: t, data: { round } });
  };
  const startRound2 = () => backend.setStepState(w.id, { solution_round: 2, solution_finalists: ranked.filter((r) => r.dots > 0).slice(0, 3).map((r) => r.item.id), vote_sol_reveal: false });

  return html`
    <div class="stack">
      ${finalSheet && html`
        <section class="final-hmw">
          <span class="eyebrow">The direction we're taking into design</span>
          <h2>${finalSheet.title}</h2>
          ${final.rationale && html`<p>${final.rationale}</p>`}
          <p class="muted small">Decided by ${final.by === 'ai' ? `${decider?.name || 'the AI Decider'} (AI Decider)` : final.by === 'decider' ? decider?.name || 'the Decider' : 'the organizer'}.
            ${isOrganizer && html` <a href="#" onClick=${(e) => { e.preventDefault(); backend.setDecision(w.id, 'solution_final', null); }}>Undo</a>`}</p>
        </section>`}
      <div class="row between stage-head">
        <div><h3>Vote on the most compelling solution ${round === 2 && html`<span class="pill pill-soon">Round 2 · finalists</span>`}</h3>
          <${VoteHeader} left=${left} dots=${dots} canVote=${canVote} isDecider=${isDecider} decider=${decider} what="a sketch" /></div>
        ${isOrganizer && html`<${OrganizerVoteTools} w=${w} dotsKey="vote_sol_dots" revealKey="vote_sol_reveal" dots=${dots} revealed=${revealed} round=${voteRound} votes=${votes}
          aiLabel="Cast AI participants' votes" aiRun=${data.members.some((m) => m.is_synthetic) ? async () => {
            const b = await synthSketchVotes(w, voteRound, solutions.map((x) => ({ id: x.id, text: `"${x.title}" by ${authors[x.member_id]?.name}: ${x.summary} Frames: ${x.cells.map((c) => c.caption).join(' → ')}`, image_paths: x.cells.map((c) => c.file_path).filter(Boolean) })), data.members, dots);
            return `${b.length} AI ballots cast.`; } : null} />`}
      </div>
      ${!solutions.length ? html`<${Empty} title="No solution sketches to vote on" />` : html`
        <div class="vote-layout">
          <div class="solution-grid grow">
            ${solutions.map((x) => html`
              <div key=${x.id} class=${cx('vote-wrap', canVote && left > 0 && 'can-vote', finalSheet?.id === x.id && 'is-final')}
                onClick=${() => canVote && left > 0 && backend.addVotes([{ workshop_id: w.id, member_id: me.id, target_id: x.id, round: voteRound }])}>
                <${SolutionCard} x=${x} authors=${authors} urls=${urls} data=${data} onOpen=${setBox} compact>
                  <${Dots} votes=${votes.filter((v) => v.target_id === x.id)} me=${me} show=${showAll} authors=${authors} />
                <//>
              </div>`)}
          </div>
          <aside class="stack results-col">
            ${canVote && html`<section class="card"><h4>Your reasoning</h4><p class="muted small">Briefly share why you voted the way you did.</p>
              <textarea rows="3" value=${reason} onInput=${(e) => setReason(e.target.value)} onBlur=${saveReason}></textarea></section>`}
            ${showAll && html`
              <section class="card results">
                <h3>Results ${!revealed && html`<span class="muted small">(only you can see these until you reveal)</span>`}</h3>
                <ol class="ranking">${ranked.filter((r) => r.dots > 0).map((r, i) => html`
                  <li key=${r.item.id}>
                    <div class="row between"><b class="small">${i + 1}. ${r.item.title || 'Untitled'}</b><span class="small">${r.score}</span></div>
                    <div class="bar"><span style=${{ width: (r.score / Math.max(1, ranked[0].score)) * 100 + '%' }}></span></div>
                    ${r.deciderDots > 0 && html`<span class="small" style=${{ color: DECIDER_PURPLE }}>Decider: ${r.deciderDots} dot${r.deciderDots > 1 ? 's' : ''}</span>`}
                    ${!finalSheet && ((isDecider && revealed) || isOrganizer) && html`<button class="btn btn-sm" onClick=${() => backend.setDecision(w.id, 'solution_final', { sheet_id: r.item.id, by: isDecider ? 'decider' : 'organizer', rationale: '' })}>Choose this direction</button>`}
                  </li>`)}</ol>
                ${!ranked.some((r) => r.dots > 0) && html`<p class="muted small">No votes yet.</p>`}
                ${!finalSheet && isOrganizer && round === 1 && revealed && ranked.filter((r) => r.dots > 0).length > 1 && html`<button class="btn btn-sm" onClick=${startRound2}>Run round 2 with the top 3</button>`}
                ${!finalSheet && isOrganizer && decider?.is_synthetic && ranked.some((r) => r.dots > 0) && html`
                  <${AiButton} label=${`Ask ${decider.name} (AI Decider) to decide`} run=${async () => { await aiDecideSolution(w, ranked.filter((r) => r.dots > 0)); return 'Decision made.'; }} />`}
                ${!finalSheet && isOrganizer && decider && !decider.is_synthetic && html`<p class="muted small">${decider.name} (the Decider) makes the final call after you reveal. You can also choose to override.</p>`}
              </section>
              ${reasons.length > 0 && html`<section class="card"><h4>Reasoning</h4><ul class="comments">${reasons.map((r) => html`<li key=${r.id}><b class="small">${authors[r.member_id]?.name}:</b> <span class="small">${r.text}</span></li>`)}</ul></section>`}`}
          </aside>
        </div>`}
      ${box && html`<${Lightbox} src=${urls[box.file_path]} caption=${box.caption} onClose=${() => setBox(null)} />`}
    </div>`;
}
