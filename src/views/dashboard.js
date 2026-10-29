// Organizer home: list of workshops, create new (blank or with demo content).
import { html, useState, useEffect, navigate, fmtDate, nextColor } from '../lib.js';
import { backend } from '../backend/index.js';
import { defaultAgenda, defaultIntro } from '../steps.js';
import { Empty, Modal, Field } from './ui.js';
import { demoContent, generateSynthetic, isSimulated } from '../ai.js';
import { deckPdf } from '../deck-pdf.js';

const STATUS = { draft: 'Draft', live: 'Live', done: 'Completed' };

// A new workshop filled with demo content: details, intro, team, a generated
// research deck and optional AI participants. `useAi` asks Claude to write it about
// `topic`; otherwise (or if the AI fails) the built-in template is used.
export async function createDemoWorkshop(user, opts, onProgress = () => {}) {
  const { topic, team, deck, aiCount, useAi } = opts;
  onProgress('Creating the workshop…');
  let ws = await backend.createWorkshop({ agenda: defaultAgenda(), intro: defaultIntro() });
  const simulated = { ...ws, step_state: { ...ws.step_state, ai_mode: 'simulated' } };
  const asked = useAi && !isSimulated(ws);
  let content, notice = '';
  onProgress(asked ? 'Claude is writing the demo content…' : 'Filling in demo content…');
  try { content = await demoContent(asked ? ws : simulated, { topic, participants: 4 }); }
  catch (e) {
    if (!asked) throw e;
    notice = `Claude couldn't write the content, so the built-in demo template was used. Reason: ${e.message.split(' Tip:')[0]}`;
    content = await demoContent(simulated, { topic, participants: 4 });
  }
  ws = await backend.updateWorkshop(ws.id, {
    title: content.title, project: content.project, description: content.goal,
    starts_at: new Date(Date.now() + 2 * 864e5).toISOString(),
    intro: { ...defaultIntro(), background: content.background,
      welcome: `Hi everyone, I'm ${user.name || 'your organizer'}, and I'll be facilitating today. Thanks for carving out the time.` },
  });
  const members = await backend.listMembers(ws.id);
  let researcher = null;
  if (team) {
    onProgress('Adding the team…');
    let decider = false;
    for (const p of content.people || []) {
      const isDecider = p.role === 'participant' && p.is_decider && !decider;
      decider = decider || isDecider;
      const m = await backend.addMember(ws.id, {
        name: p.name, email: p.email, role: p.role, discipline: p.role === 'participant' ? p.discipline : null,
        is_decider: isDecider, color: nextColor(members),
      });
      members.push(m);
      if (p.role === 'researcher' && !researcher) researcher = m;
    }
  }
  if (deck && content.deck?.slides?.length) {
    onProgress('Generating the research deck…');
    const me = members.find((m) => m.role === 'organizer');
    await backend.uploadResearch(ws.id, deckPdf(content.deck.title, content.deck.slides), content.deck.title, (researcher || me)?.id);
  }
  if (aiCount > 0) {
    onProgress(`Adding ${aiCount} AI participant${aiCount > 1 ? 's' : ''}…`);
    const ctx = { ...ws, step_state: asked && !notice ? ws.step_state : simulated.step_state };
    await generateSynthetic(ctx, members, { count: aiCount, disciplines: ['design', 'pm', 'eng'] });
  }
  return { ws, notice };
}

function NewWorkshopModal({ user, onClose }) {
  const [kind, setKind] = useState('blank');
  const [topic, setTopic] = useState('');
  const [team, setTeam] = useState(true);
  const [deck, setDeck] = useState(true);
  const [aiCount, setAiCount] = useState(2);
  const [useAi, setUseAi] = useState(backend.mode !== 'demo');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  async function create() {
    setError('');
    try {
      if (kind === 'blank') {
        setBusy('Creating…');
        const ws = await backend.createWorkshop({ agenda: defaultAgenda(), intro: defaultIntro() });
        return navigate(`/w/${ws.id}/setup`);
      }
      const r = await createDemoWorkshop(user, { topic, team, deck, aiCount: Number(aiCount), useAi }, setBusy);
      if (r.notice) { setDone(r); setBusy(''); } else navigate(`/w/${r.ws.id}/setup`);
    } catch (e) { setError(e.message); setBusy(''); }
  }

  if (done) return html`<${Modal} title="Demo workshop created" onClose=${() => navigate(`/w/${done.ws.id}/setup`)}>
    <div class="stack"><p class="notice">${done.notice}</p>
      <div class="row end"><button class="btn btn-primary" onClick=${() => navigate(`/w/${done.ws.id}/setup`)}>Continue to setup</button></div></div><//>`;

  return html`<${Modal} title="New workshop" onClose=${() => !busy && onClose()}>
    <div class="stack">
      <div class="choice-cards">
        <label class=${'choice-card' + (kind === 'blank' ? ' on' : '')}><input type="radio" name="kind" checked=${kind === 'blank'} onChange=${() => setKind('blank')} />
          <b>Blank workshop</b><span class="muted small">Start empty and fill in the details yourself.</span></label>
        <label class=${'choice-card' + (kind === 'demo' ? ' on' : '')}><input type="radio" name="kind" checked=${kind === 'demo'} onChange=${() => setKind('demo')} />
          <b>With demo content</b><span class="muted small">Details, intro, team and a research deck, ready to run as a demo.</span></label>
      </div>
      ${kind === 'demo' && html`
        <${Field} label="What is the workshop about?" hint="Optional. Leave empty for the Account Reconciliations sample.">
          <textarea rows="3" value=${topic} onInput=${(e) => setTopic(e.target.value)} placeholder="e.g. Approving journal entries faster in OneStream" /><//>
        <div class="stack-sm">
          <label class="check"><input type="checkbox" checked=${team} onChange=${(e) => setTeam(e.target.checked)} /> Team: a researcher and 4 participants, one of them the Decider</label>
          <label class="check"><input type="checkbox" checked=${deck} onChange=${(e) => setDeck(e.target.checked)} /> Research deck (a generated PDF of findings)</label>
          <label class="check">AI participants
            <select value=${aiCount} onChange=${(e) => setAiCount(e.target.value)} style=${{ width: "auto" }}>${[0, 1, 2, 3, 4].map((n) => html`<option key=${n} value=${n}>${n}</option>`)}</select></label>
        </div>
        ${backend.mode !== 'demo' && html`<${Field} label="Write the content with">
          <select value=${useAi ? 'ai' : 'template'} onChange=${(e) => setUseAi(e.target.value === 'ai')}>
            <option value="ai">Claude (about your topic, takes up to a minute)</option>
            <option value="template">Built-in template (instant, no AI)</option>
          </select><//>`}`}
      ${error && html`<p class="error">${error}</p>`}
      <div class="row end">
        ${busy && html`<span class="muted small grow">${busy}</span>`}
        <button class="btn" onClick=${onClose} disabled=${!!busy}>Cancel</button>
        <button class="btn btn-primary" onClick=${create} disabled=${!!busy}>${busy ? 'Working…' : kind === 'demo' ? 'Create with demo content' : 'Create workshop'}</button>
      </div>
    </div><//>`;
}

export function Dashboard({ user }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const refresh = () => backend.listMyWorkshops().then(setList).catch((e) => setError(e.message));
  useEffect(() => { refresh(); }, [user.id]);

  const [creating, setCreating] = useState(false);

  return html`
    <main class="page">
      <div class="page-head">
        <div><h1>Your workshops</h1><p class="muted">Set up a workshop, invite your team, and run it live.</p></div>
        <div class="row">
          <button class="btn btn-primary" onClick=${() => setCreating(true)}>+ New workshop</button>
        </div>
      </div>
      ${error && html`<p class="error">${error}</p>`}
      ${creating && html`<${NewWorkshopModal} user=${user} onClose=${() => setCreating(false)} />`}
      ${list && !list.length && html`<${Empty} title="No workshops yet">Create one. Choose “With demo content” to see how a workshop runs.<//>`}
      <div class="grid-cards">
        ${(list || []).map((w) => html`
          <article class="card ws-card" key=${w.id}>
            <div class="row between"><span class=${'pill pill-' + w.status}>${STATUS[w.status]}</span><span class="muted small">${fmtDate(w.starts_at)}</span></div>
            <h3>${w.title}</h3>
            <p class="muted small">${w.project}</p>
            <div class="row">
              ${w.organizer_id === user.id && html`<button class="btn btn-sm" onClick=${() => navigate(`/w/${w.id}/setup`)}>Set up</button>`}
              <button class="btn btn-sm btn-primary" onClick=${() => navigate(`/w/${w.id}`)}>${w.status === 'live' ? 'Join room' : 'Open room'}</button>
            </div>
          </article>`)}
      </div>
    </main>`;
}
