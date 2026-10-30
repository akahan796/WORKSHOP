// Phase 4 stages: design details & user flow, AI prototype, design review.
import { html, useState, useEffect, useMemo, cx, uid, DISCIPLINES, Fragment } from '../lib.js';
import { backend } from '../backend/index.js';
import { Avatar, Empty, AiButton, SaveOnBlur } from './ui.js';
import { useSketchUrls, SolutionCard, Lightbox, ChosenHmw } from './stages3.js';
import { draftFlow, generatePrototype, revisePrototype, synthFeedback } from '../ai.js';

function useAuthors(members) {
  return useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members]);
}

export const latestFlow = (data) => data.artifacts.find((a) => a.kind === 'flow') || null;
export const prototypes = (data) => data.artifacts.filter((a) => a.kind === 'prototype').sort((a, b) => b.version - a.version);
export const chosenSheet = (w, data) => data.sheets.find((x) => x.id === (w.step_state || {}).solution_final?.sheet_id) || null;

// The chosen direction at the top of every phase 4 step.
export function ChosenDirection({ w, data, compact }) {
  const authors = useAuthors(data.members);
  const sheet = chosenSheet(w, data);
  const urls = useSketchUrls(sheet ? sheet.cells.map((c) => c.file_path) : []);
  const [box, setBox] = useState(null);
  if (!sheet) return html`<div class="chosen-hmw muted">No direction chosen yet. Pick one in "Vote on a Direction".</div>`;
  return html`
    <div class="stack">
      <${ChosenHmw} w=${w} data=${data} />
      <${SolutionCard} x=${sheet} authors=${authors} urls=${urls} data=${data} onOpen=${setBox} compact=${compact}>
        ${w.step_state?.solution_final?.rationale && html`<p class="muted small">Why: ${w.step_state.solution_final.rationale}</p>`}
      <//>
      ${box && html`<${Lightbox} src=${urls[box.file_path]} caption=${box.caption} onClose=${() => setBox(null)} />`}
    </div>`;
}

const ACTOR_COLORS = ['#EEF3FF', '#E3F5E8', '#FFF1E0', '#F5EEFF', '#FDE7E7', '#E6F7F6'];
const actorColor = (actor, actors) => ACTOR_COLORS[Math.max(0, actors.indexOf(actor)) % ACTOR_COLORS.length];

function EditableList({ items, edit, onChange, placeholder, empty }) {
  const [draft, setDraft] = useState('');
  return html`
    <ul class="flow-list">
      ${items.map((it, i) => html`<li key=${it.id}>
        ${edit ? html`<${SaveOnBlur} value=${it.text} onSave=${(text) => onChange(items.map((x) => (x.id === it.id ? { ...x, text } : x)))} />
          <button class="icon-btn" title="Remove" onClick=${() => onChange(items.filter((x) => x.id !== it.id))}>✕</button>` : html`<span>${it.text}</span>`}
      </li>`)}
      ${!items.length && !edit && html`<li class="muted small">${empty}</li>`}
      ${edit && html`<li><input placeholder=${placeholder} value=${draft} onInput=${(e) => setDraft(e.target.value)}
        onKeyDown=${(e) => { if (e.key === 'Enter' && draft.trim()) { onChange([...items, { id: uid(), text: draft.trim() }]); setDraft(''); } }} /></li>`}
    </ul>`;
}

// ── Step 11: Design details & user flow ──
export function FlowStage({ w, data, me, isOrganizer }) {
  const authors = useAuthors(data.members);
  const flow = latestFlow(data);
  const f = flow ? flow.data : null;
  const [edit, setEdit] = useState(false);
  const [noteDraft, setNoteDraft] = useState({});
  const notes = data.stickies.filter((s) => s.step === 'flow' && s.kind === 'note');
  const steps = f?.steps || [];
  const actors = [...new Set(steps.map((s) => s.actor))];
  const save = (patch) => backend.saveArtifact(w.id, 'flow', 1, { data: { ...f, ...patch } });
  const setSteps = (next) => save({ steps: next });
  const move = (i, d) => { const next = steps.slice(); const [x] = next.splice(i, 1); next.splice(i + d, 0, x); setSteps(next); };
  const addNote = async (stepId) => {
    const t = (noteDraft[stepId] || '').trim();
    if (!t) return;
    await backend.addSticky({ workshop_id: w.id, member_id: me.id, step: 'flow', kind: 'note', text: t, data: { step_id: stepId } });
    setNoteDraft({ ...noteDraft, [stepId]: '' });
  };

  return html`
    <div class="stack">
      <${ChosenDirection} w=${w} data=${data} compact />
      ${!f ? html`
        <section class="card stack">
          <h3>User flow</h3>
          ${isOrganizer ? html`<p class="muted">Start from an AI draft built from the chosen sketch, its frames and review comments, or map it from scratch with the group.</p>
            <div class="row"><${AiButton} label="Draft the user flow with AI" disabled=${!chosenSheet(w, data)} run=${() => draftFlow(w)} />
              <button class="btn btn-sm" onClick=${() => backend.saveArtifact(w.id, 'flow', 1, { data: { title: 'User flow', steps: [], details: [], questions: [], source: 'manual' } }).then(() => setEdit(true))}>Start a blank flow</button></div>`
            : html`<p class="muted">The organizer will share the user flow here.</p>`}
        </section>` : html`
        <section class="card stack">
          <div class="row between">
            <h3>${edit && isOrganizer ? html`<${SaveOnBlur} value=${f.title} onSave=${(title) => save({ title })} />` : f.title}</h3>
            ${isOrganizer && html`<label class="toggle"><input type="checkbox" checked=${edit} onChange=${(e) => setEdit(e.target.checked)} /> Edit flow</label>`}
          </div>
          <div class="flow-row">
            ${steps.map((s, i) => html`<${Fragment} key=${s.id}>
              <div class="flow-step-wrap">
                <div class="flow-step" style=${{ background: actorColor(s.actor, actors) }}>
                  <div class="row between"><span class="step-num">${i + 1}</span>
                    ${edit ? html`<${SaveOnBlur} class="flow-actor" value=${s.actor} onSave=${(actor) => setSteps(steps.map((x) => (x.id === s.id ? { ...x, actor } : x)))} />` : html`<span class="pill">${s.actor}</span>`}</div>
                  ${edit ? html`
                    <${SaveOnBlur} value=${s.title} placeholder="Step" onSave=${(title) => setSteps(steps.map((x) => (x.id === s.id ? { ...x, title } : x)))} />
                    <${SaveOnBlur} multiline rows="2" value=${s.detail} placeholder="What happens" onSave=${(detail) => setSteps(steps.map((x) => (x.id === s.id ? { ...x, detail } : x)))} />
                    <${SaveOnBlur} value=${s.screen} placeholder="Screen" onSave=${(screen) => setSteps(steps.map((x) => (x.id === s.id ? { ...x, screen } : x)))} />
                    <div class="row">
                      <button class="icon-btn" disabled=${i === 0} onClick=${() => move(i, -1)}>←</button>
                      <button class="icon-btn" disabled=${i === steps.length - 1} onClick=${() => move(i, 1)}>→</button>
                      <button class="icon-btn" onClick=${() => setSteps([...steps.slice(0, i + 1), { id: uid(), actor: s.actor, title: 'New step', detail: '', screen: s.screen }, ...steps.slice(i + 1)])}>+ after</button>
                      <button class="icon-btn" onClick=${() => setSteps(steps.filter((x) => x.id !== s.id))}>✕</button>
                    </div>` : html`
                    <b>${s.title}</b><p class="small">${s.detail}</p>${s.screen && html`<span class="muted small">▢ ${s.screen}</span>`}`}
                </div>
                <ul class="comments">${notes.filter((n) => n.data?.step_id === s.id).map((n) => html`<li key=${n.id} class="small"><b>${authors[n.member_id]?.name.split(' ')[0]}:</b> ${n.text}</li>`)}</ul>
                ${me && html`<input class="note-input" placeholder="Add a note" value=${noteDraft[s.id] || ''} onInput=${(e) => setNoteDraft({ ...noteDraft, [s.id]: e.target.value })} onKeyDown=${(e) => e.key === 'Enter' && addNote(s.id)} />`}
              </div>
              ${i < steps.length - 1 && html`<span class="flow-arrow">→</span>`}
            <//>`)}
            ${!steps.length && html`<p class="muted">No steps yet.${isOrganizer ? ' Turn on "Edit flow" and add one.' : ''}</p>`}
            ${edit && !steps.length && html`<button class="btn btn-sm" onClick=${() => setSteps([{ id: uid(), actor: 'User', title: 'First step', detail: '', screen: '' }])}>+ Add step</button>`}
          </div>
        </section>
        <div class="form-grid">
          <section class="card"><h3>Implementation details</h3><p class="muted small">What the team agrees on before design work begins.</p>
            <${EditableList} items=${f.details || []} edit=${edit && isOrganizer} onChange=${(details) => save({ details })} placeholder="Add a detail and press Enter" empty="None yet." /></section>
          <section class="card"><h3>Open questions</h3>
            <${EditableList} items=${f.questions || []} edit=${edit && isOrganizer} onChange=${(questions) => save({ questions })} placeholder="Add a question and press Enter" empty="None yet." /></section>
        </div>
        ${isOrganizer && f && html`<div class="row"><${AiButton} label="Redraft the flow with AI" run=${() => confirm('Replace the current flow with a new AI draft? Notes stay.') ? draftFlow(w) : false} /></div>`}`}
      ${isOrganizer && html`<${ReleasePanel} w=${w} data=${data} />`}
    </div>`;
}

// After the flow step, non-design participants are typically released.
function ReleasePanel({ w, data }) {
  const released = (w.step_state || {}).released || [];
  const people = data.members.filter((m) => m.role === 'participant' && m.discipline !== 'researcher' && !m.is_synthetic);
  const [pick, setPick] = useState(() => new Set(people.filter((m) => m.discipline !== 'design' && !m.is_decider).map((m) => m.id)));
  if (!people.length) return null;
  return html`
    <section class="card stack">
      <h3>Release participants</h3>
      <p class="muted small">This is the final checkpoint before design work. Non-design participants (most of Engineering and some PM) are usually released here; released people see a thank-you screen from the next step on.</p>
      <div class="row">${people.map((m) => html`<label key=${m.id} class="toggle small"><input type="checkbox" checked=${released.includes(m.id) || pick.has(m.id)} disabled=${released.includes(m.id)}
        onChange=${(e) => { const n = new Set(pick); e.target.checked ? n.add(m.id) : n.delete(m.id); setPick(n); }} /> ${m.name} <span class="muted">(${DISCIPLINES[m.discipline] || ''})</span></label>`)}</div>
      <div class="row">
        <button class="btn btn-sm" onClick=${() => backend.setStepState(w.id, { released: [...new Set([...released, ...pick])] })}>Release selected</button>
        ${released.length > 0 && html`<span class="muted small">Released: ${released.map((id) => data.members.find((m) => m.id === id)?.name).filter(Boolean).join(', ')}</span>
          <button class="btn btn-sm btn-ghost" onClick=${() => backend.setStepState(w.id, { released: [] })}>Undo release</button>`}
      </div>
    </section>`;
}

export function ReleasedStage({ w }) {
  return html`<div class="coming"><span class="pill pill-live">You're all set</span><h1>Thanks for joining!</h1>
    <p class="lead">You've been released from "${w.title}". The design team takes it from here with the prototype and design review.</p>
    <p><a href=${'#/w/' + w.id + '/summary'}>See the workshop summary</a></p></div>`;
}

// Prototype HTML runs in a sandboxed iframe (no same-origin access) with a CSP that blocks network requests.
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; form-action 'none'">`;
export const safeHtml = (doc) => (/<head[^>]*>/i.test(doc) ? doc.replace(/<head[^>]*>/i, (m) => m + CSP) : CSP + doc);

function openInTab(proto) {
  const win = window.open('', '_blank');
  if (!win) return alert('Allow pop-ups to open the prototype in a new tab.');
  win.document.title = `Prototype v${proto.version}`;
  const frame = win.document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts allow-forms');
  frame.srcdoc = safeHtml(proto.content);
  frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0';
  win.document.body.style.margin = '0';
  win.document.body.appendChild(frame);
}

function download(proto, title) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([proto.content], { type: 'text/html' }));
  a.download = `${(title || 'prototype').replace(/[^\w-]+/g, '-').toLowerCase()}-v${proto.version}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function PrototypeViewer({ w, data, version, setVersion }) {
  const list = prototypes(data);
  const proto = list.find((p) => p.version === version) || list[0];
  if (!proto) return html`<${Empty} title="No prototype yet" />`;
  return html`
    <div class="proto">
      <div class="row between proto-bar">
        <div class="row">
          <select value=${proto.version} onChange=${(e) => setVersion(Number(e.target.value))}>
            ${list.map((p) => html`<option key=${p.version} value=${p.version}>Version ${p.version}${p.data?.source === 'upload' ? ' (uploaded)' : p.data?.source === 'ai-revision' ? ' (revised)' : ''}</option>`)}
          </select>
          <span class="muted small">${proto.data?.notes || ''}</span>
        </div>
        <div class="row"><button class="btn btn-sm" onClick=${() => openInTab(proto)}>Open in new tab</button>
          <button class="btn btn-sm" onClick=${() => download(proto, w.title)}>Download HTML</button></div>
      </div>
      <iframe class="proto-frame" title=${'Prototype version ' + proto.version} sandbox="allow-scripts allow-forms" srcdoc=${safeHtml(proto.content)}></iframe>
    </div>`;
}

// ── Step 12: AI prototype ──
export function PrototypeStage({ w, data, isOrganizer }) {
  const flow = latestFlow(data);
  const list = prototypes(data);
  const [version, setVersion] = useState(null);
  useEffect(() => { if (list[0]) setVersion(list[0].version); }, [list[0]?.version]);
  const [error, setError] = useState('');

  async function upload(e) {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setError('');
    if (!/\.html?$/i.test(f.name) && f.type !== 'text/html') { setError('Choose an .html file.'); return; }
    const content = await f.text();
    const v = Math.max(0, ...list.map((p) => p.version)) + 1;
    await backend.saveArtifact(w.id, 'prototype', v, { content, data: { source: 'upload', notes: `Uploaded: ${f.name}` } });
  }

  return html`
    <div class="stack">
      <${ChosenDirection} w=${w} data=${data} compact />
      ${flow && html`<details class="card"><summary><b>${flow.data.title}</b> <span class="muted small">${flow.data.steps.length} steps</span></summary>
        <ol class="small">${flow.data.steps.map((s) => html`<li key=${s.id}><b>${s.actor}:</b> ${s.title}${s.screen ? html` <span class="muted">(${s.screen})</span>` : ''}</li>`)}</ol></details>`}
      ${isOrganizer && html`
        <div class="row">
          <${AiButton} label=${list.length ? 'Generate a new version with AI' : 'Generate the prototype with AI'} busyHint="Building a prototype takes 1–3 minutes."
            title=${flow ? 'Builds a clickable prototype from the user flow' : 'Works best after the user flow step'} run=${() => generatePrototype(w, data.artifacts, flow?.data)} />
          <label class="btn btn-sm upload-btn">Upload HTML<input type="file" accept=".html,.htm,text/html" onChange=${upload} /></label>
          ${error && html`<span class="error small">${error}</span>`}
        </div>`}
      ${list.length ? html`<${PrototypeViewer} w=${w} data=${data} version=${version} setVersion=${setVersion} />`
        : html`<${Empty} title="No prototype yet">${isOrganizer ? 'Generate one with AI from the user flow, or upload an HTML prototype.' : 'The organizer will share the prototype here.'}<//>`}
    </div>`;
}

const FEEDBACK_KINDS = { works: 'What works', change: 'Change', question: 'Question' };

// ── Step 13: Design review ──
export function DesignReviewStage({ w, data, me, isOrganizer }) {
  const authors = useAuthors(data.members);
  const list = prototypes(data);
  const flow = latestFlow(data);
  const [version, setVersion] = useState(null);
  useEffect(() => { if (list[0]) setVersion(list[0].version); }, [list[0]?.version]);
  const proto = list.find((p) => p.version === version) || list[0];
  const [kind, setKind] = useState('works');
  const [text, setText] = useState('');
  const feedback = data.stickies.filter((s) => s.step === 'design_review' && s.kind === 'feedback' && (!proto || s.data?.version === proto.version));
  const changes = feedback.filter((f) => f.data?.kind !== 'works');

  const add = async () => {
    const t = text.trim();
    if (!t) return;
    await backend.addSticky({ workshop_id: w.id, member_id: me.id, step: 'design_review', kind: 'feedback', text: t, data: { kind, version: proto?.version } });
    setText('');
  };

  if (!proto) return html`<${Empty} title="No prototype to review yet">Generate or upload one in the AI Prototype step.<//>`;
  return html`
    <div class="review-layout">
      <div class="grow stack">
        <${PrototypeViewer} w=${w} data=${data} version=${proto.version} setVersion=${setVersion} />
        <p class="row between"><span class="muted small">Walk through the prototype together, then capture what works, what to change, and open questions.</span>
          <a class="btn btn-sm" href=${'#/w/' + w.id + '/summary'}>Workshop summary →</a></p>
      </div>
      <aside class="capture">
        <h3>Feedback on v${proto.version}</h3>
        ${me && html`
          <div class="kind-chips">${Object.entries(FEEDBACK_KINDS).map(([k, v]) => html`<button key=${k} class=${cx('chip', kind === k && 'on')} onClick=${() => setKind(k)}>${v}</button>`)}</div>
          <textarea rows="3" value=${text} placeholder="One point per note" onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(); } }}></textarea>
          <div class="row between"><span class="muted small">Enter to add</span><button class="btn btn-primary btn-sm" onClick=${add}>Add</button></div>`}
        ${isOrganizer && html`<div class="stack">
          ${data.members.some((m) => m.is_synthetic) && html`<${AiButton} label="AI participants give feedback" run=${() => synthFeedback(w, proto, flow?.data)} />`}
          <${AiButton} label=${`Revise the prototype with AI (${changes.length} notes)`} disabled=${!changes.length} busyHint="Revising takes 1–3 minutes."
            run=${() => revisePrototype(w, data.artifacts, proto, flow?.data, changes)} />
        </div>`}
        ${Object.entries(FEEDBACK_KINDS).map(([k, v]) => { const items = feedback.filter((f) => (f.data?.kind || 'change') === k); return items.length > 0 && html`
          <div key=${k}><h4>${v} <span class="muted">${items.length}</span></h4>
            <ul class="comments">${items.map((f) => html`<li key=${f.id} class="small"><b>${authors[f.member_id]?.name}:</b> ${f.text}
              ${me && f.member_id === me.id && html`<button class="sticky-x" onClick=${() => backend.deleteSticky(f.id)}>✕</button>`}</li>`)}</ul></div>`; })}
        ${!feedback.length && html`<p class="muted small">No feedback on this version yet.</p>`}
      </aside>
    </div>`;
}
