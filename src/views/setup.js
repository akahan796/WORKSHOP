// Organizer workshop setup: details, introduction, agenda, people & invites, research.
import { html, useState, navigate, nextColor, inviteUrl, DISCIPLINES, ROLES, cx, fmtDate } from '../lib.js';
import { backend } from '../backend/index.js';
import { STEPS, BUILT_PHASE, defaultAgenda, defaultIntro } from '../steps.js';
import { useWorkshop } from '../useWorkshop.js';
import { Field, SaveOnBlur, Avatar, useCopy, Empty, Modal } from './ui.js';
import { generateSynthetic, isSimulated } from '../ai.js';
import { ResearchManager } from './research.js';

const TABS = [['details', 'Details'], ['intro', 'Introduction'], ['agenda', 'Agenda'], ['people', 'People & invites'], ['research', 'Research'], ['skills', 'Skills']];

export function SetupView({ wsId, user }) {
  const data = useWorkshop(wsId, user);
  const [tab, setTab] = useState('details');
  const { workshop: w } = data;

  if (data.loading) return html`<main class="page"><p class="muted">Loading…</p></main>`;
  if (!w) return html`<main class="page"><${Empty} title="Workshop not found" /></main>`;
  if (!data.isOrganizer) return html`<main class="page"><${Empty} title="Only facilitators can set up this workshop" /></main>`;

  const save = (patch) => backend.updateWorkshop(w.id, patch);

  return html`
    <main class="page">
      ${data.isOwner ? html`<a class="back" href="#/">← All workshops</a>` : html`<a class="back" href=${'#/w/' + w.id}>← Back to the room</a>`}
      <div class="page-head">
        <div><h1>${w.title}</h1><p class="muted">${[w.project, fmtDate(w.starts_at)].filter(Boolean).join(' · ') || 'Workshop setup'}</p></div>
        <div class="row">
          ${data.isOwner && html`<button class="btn btn-ghost" onClick=${() => confirm('Delete this workshop and everything in it?') && backend.deleteWorkshop(w.id).then(() => navigate('/'))}>Delete</button>`}
          <button class="btn btn-primary" onClick=${() => navigate(`/w/${w.id}`)}>Open workshop room →</button>
        </div>
      </div>
      <nav class="tabs">
        ${TABS.map(([k, label]) => html`<button key=${k} class=${cx('tab', tab === k && 'tab-on')} onClick=${() => setTab(k)}>${label}${k === 'people' ? html` <span class="count">${data.members.length}</span>` : ''}</button>`)}
      </nav>
      <section class="card setup-panel">
        ${tab === 'details' && html`<${Details} w=${w} save=${save} />`}
        ${tab === 'intro' && html`<${Intro} w=${w} save=${save} />`}
        ${tab === 'agenda' && html`<${Agenda} w=${w} save=${save} />`}
        ${tab === 'people' && html`<${People} w=${w} data=${data} />`}
        ${tab === 'skills' && html`<${Skills} w=${w} save=${save} />`}
        ${tab === 'research' && html`<${ResearchManager} wsId=${w.id} research=${data.research} me=${data.me} canEdit=${true} />`}
      </section>
    </main>`;
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
}

function Details({ w, save }) {
  return html`
    <div class="form-grid">
      <${Field} label="Workshop title"><${SaveOnBlur} value=${w.title} onSave=${(title) => save({ title })} /><//>
      <${Field} label="Project / subject" hint="What the workshop is about, e.g. the product area."><${SaveOnBlur} value=${w.project} onSave=${(project) => save({ project })} /><//>
      <${Field} label="Date & time">
        <input type="datetime-local" value=${toLocalInput(w.starts_at)} onChange=${(e) => save({ starts_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
      <//>
      <${Field} label="AI mode" hint=${backend.mode === 'demo' ? 'Demo mode always uses simulated AI.' : 'Simulated runs the full flow with built-in stand-in results: free, no AI API needed. Everything else stays live.'}>
        <select disabled=${backend.mode === 'demo'} value=${isSimulated(w) ? 'simulated' : 'claude'} onChange=${(e) => backend.setStepState(w.id, { ai_mode: e.target.value })}>
          <option value="claude">Claude (real AI)</option>
          <option value="simulated">Simulated (no AI API)</option>
        </select>
      <//>
      <${Field} label="Voting" hint="By default the organizer facilitates and doesn't vote. Turn this on to get dots like everyone else in every voting step.">
        <label class="toggle"><input type="checkbox" checked=${!!(w.step_state || {}).organizer_votes} onChange=${(e) => backend.setStepState(w.id, { organizer_votes: e.target.checked })} /> Organizer votes too</label>
      <//>
      <div class="span-2"><${Field} label="Goal" hint="One or two sentences on what we want to leave with. Shown in the introduction and the invite email.">
        <${SaveOnBlur} multiline value=${w.description} onSave=${(description) => save({ description })} />
      <//></div>
    </div>`;
}

function Intro({ w, save }) {
  const intro = { ...defaultIntro(), ...w.intro };
  const set = (k) => (v) => save({ intro: { ...intro, [k]: v } });
  return html`
    <div class="stack">
      <p class="muted">This is what everyone sees in step 1. It's prefilled; edit it to fit your session.</p>
      <${Field} label="About me (organizer intro)" hint="Who you are and your role in this workshop."><${SaveOnBlur} multiline value=${intro.welcome} onSave=${set('welcome')} /><//>
      <${Field} label="Project background" hint="The problem space and why we're here."><${SaveOnBlur} multiline rows="4" value=${intro.background} onSave=${set('background')} /><//>
      <${Field} label="Workshop overview"><${SaveOnBlur} multiline value=${intro.overview} onSave=${set('overview')} /><//>
      <${Field} label="Ground rules" hint="One rule per line.">
        <${SaveOnBlur} multiline rows="6" value=${(intro.rules || []).join('\n')} onSave=${(v) => set('rules')(v.split('\n').map((s) => s.trim()).filter(Boolean))} />
      <//>
      <${Field} label="What to expect"><${SaveOnBlur} multiline value=${intro.expectations} onSave=${set('expectations')} /><//>
    </div>`;
}

function Skills({ w, save }) {
  const intro = { ...defaultIntro(), ...w.intro };
  const set = (k) => (v) => save({ intro: { ...intro, [k]: v } });
  return html`
    <div class="stack">
      <p class="muted">Paste the AI skill files (Markdown) you share with participants before the workshop, or a link to them. During Crazy 8s and Solution Sketch, everyone can view and copy them next to their sketch slots.</p>
      <${Field} label="Crazy 8s skill" hint="Used in step: Crazy 8s. Participants run it in their own AI tool and upload the 8 sketches.">
        <${SaveOnBlur} multiline rows="8" value=${intro.skill_crazy8 || ''} onSave=${set('skill_crazy8')} placeholder="# Crazy 8s skill…" /><//>
      <${Field} label="Solution sketch skill" hint="Used in step: Solution Sketch, for a uniform, consistent look.">
        <${SaveOnBlur} multiline rows="8" value=${intro.skill_solution || ''} onSave=${set('skill_solution')} placeholder="# Solution sketch skill…" /><//>
    </div>`;
}

function Agenda({ w, save }) {
  const agenda = w.agenda && w.agenda.length ? w.agenda : defaultAgenda();
  const update = (key, patch) => save({ agenda: agenda.map((a) => (a.key === key ? { ...a, ...patch } : a)) });
  const total = agenda.filter((a) => a.enabled).reduce((n, a) => n + Number(a.minutes || 0), 0);
  const byKey = Object.fromEntries(STEPS.map((s) => [s.key, s]));
  return html`
    <div class="stack">
      <div class="row between"><p class="muted">Turn steps on or off and set how long each runs. Total: <b>${Math.floor(total / 60)}h ${total % 60}m</b></p></div>
      <ol class="agenda-edit">
        ${agenda.map((a, i) => { const s = byKey[a.key]; return html`
          <li key=${a.key} class=${cx('agenda-row', !a.enabled && 'off')}>
            <input type="checkbox" checked=${a.enabled} onChange=${(e) => update(a.key, { enabled: e.target.checked })} aria-label=${'Include ' + s.title} />
            <span class="step-num">${i + 1}</span>
            <div class="grow"><b>${s.title}</b>${s.phase > BUILT_PHASE && html` <span class="pill pill-soon">Coming in phase ${s.phase}</span>`}<div class="muted small">${s.blurb}</div></div>
            <label class="minutes"><input type="number" min="1" max="240" value=${a.minutes} onChange=${(e) => update(a.key, { minutes: Number(e.target.value) })} /> min</label>
          </li>`; })}
      </ol>
    </div>`;
}

function mailtoInvite(w, m, link) {
  const subject = `You're invited: ${w.title}`;
  const when = w.starts_at ? `\nWhen: ${fmtDate(w.starts_at)}` : '';
  const body = `Hi ${m.name.split(' ')[0] || 'there'},\n\nYou're invited to join "${w.title}" as a ${ROLES[m.role].toLowerCase()}.${when}\n\n${w.description || ''}\n\nJoin here (no account needed):\n${link}\n\nSee you there!`;
  return `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function People({ w, data }) {
  const [form, setForm] = useState({ name: '', email: '', role: 'participant', discipline: 'design' });
  const [copied, copy] = useCopy();
  const [showSynth, setShowSynth] = useState(false);
  // The owner is always a facilitator and is listed first, without a role picker or invite.
  const owner = data.members.find((m) => m.role === 'organizer');
  const people = data.members.filter((m) => m.role !== 'organizer');
  const roleOptions = html`<option value="participant">Participant</option><option value="researcher">Researcher</option><option value="facilitator">Facilitator</option>`;

  async function add(e) {
    e.preventDefault();
    await backend.addMember(w.id, { ...form, name: form.name.trim(), email: form.email.trim(),
      discipline: form.role === 'participant' ? form.discipline : null, color: nextColor(data.members) });
    setForm({ ...form, name: '', email: '' });
  }

  return html`
    <div class="stack">
      <p class="muted">Each person gets a personal guest link. It takes them straight to this workshop, with no account needed. <b>Send invite</b> opens a prefilled email in your mail app.${' '}<b>Facilitators</b> get the facilitator controls: they run the steps and timer, use the AI actions and can edit this setup. They don't sketch or vote.</p>
      <table class="table">
        <thead><tr><th>Person</th><th>Role</th><th>Discipline</th><th title="The Decider votes in purple and makes the final call">Decider</th><th>Status</th><th>Invite</th><th></th></tr></thead>
        <tbody>
          ${owner && html`<tr key=${owner.id}>
            <td><div class="row"><${Avatar} name=${owner.name} color=${owner.color} /><div><b>${owner.name || '(no name)'}</b><div class="muted small">${owner.email}</div></div></div></td>
            <td><span class="pill pill-facilitator">Facilitator</span> <span class="muted small">Owner</span></td>
            <td><span class="muted">—</span></td><td></td>
            <td><span class="pill pill-live">Joined</span></td>
            <td><span class="muted small">Signed in with an account</span></td><td></td>
          </tr>`}
          ${people.map((m) => { const link = data.invites[m.id] ? inviteUrl(data.invites[m.id]) : ''; return html`
            <tr key=${m.id}>
              <td><div class="row"><${Avatar} name=${m.name} color=${m.color} /><div><div><b>${m.name || '(no name)'}</b>${m.is_synthetic && html` <span class="pill pill-ai" title="Synthetic participant generated by AI">AI</span>`}</div><div class="muted small persona" title=${m.persona || ''}>${m.is_synthetic ? m.persona : m.email}</div></div></div></td>
              <td>${m.is_synthetic ? html`<span class="muted">Participant</span>` : html`<select value=${m.role} onChange=${(e) => backend.updateMember(m.id, { role: e.target.value, discipline: e.target.value === 'participant' ? m.discipline || 'design' : null, ...(e.target.value === 'facilitator' ? { is_decider: false } : {}) })}>
                ${roleOptions}</select>`}</td>
              <td>${m.role === 'participant' ? html`<select value=${m.discipline || ''} onChange=${(e) => backend.updateMember(m.id, { discipline: e.target.value })}>
                ${Object.entries(DISCIPLINES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select>` : html`<span class="muted">—</span>`}</td>
              <td>${m.role !== 'facilitator' && html`<input type="radio" name="decider" checked=${m.is_decider} onChange=${() => backend.updateMember(m.id, { is_decider: true })} aria-label=${'Make ' + m.name + ' the Decider'} />`}</td>
              <td>${m.is_synthetic ? html`<span class="pill pill-ai">Synthetic</span>` : m.joined_at ? html`<span class="pill pill-live">Joined</span>` : html`<span class="pill">Invited</span>`}</td>
              <td>${m.is_synthetic ? html`<span class="muted small">No invite needed</span>` : html`<div class="row nowrap">
                <button class="btn btn-sm" disabled=${!link} onClick=${() => copy(link, m.id)}>${copied === m.id ? 'Copied ✓' : 'Copy link'}</button>
                <a class=${cx('btn btn-sm', !m.email && 'disabled')} href=${m.email && link ? mailtoInvite(w, m, link) : undefined}>Send invite</a>
              </div>`}</td>
              <td><button class="btn btn-ghost btn-sm" aria-label=${'Remove ' + m.name} onClick=${() => confirm(`Remove ${m.name}? Their stickies are removed too.`) && backend.removeMember(m.id)}>✕</button></td>
            </tr>`; })}
        </tbody>
      </table>
      ${!people.length && html`<p class="muted small">No one invited yet.</p>`}
      <form class="add-person" onSubmit=${add}>
        <input required placeholder="Full name" value=${form.name} onInput=${(e) => setForm({ ...form, name: e.target.value })} />
        <input type="email" placeholder="Email" value=${form.email} onInput=${(e) => setForm({ ...form, email: e.target.value })} />
        <select value=${form.role} onChange=${(e) => setForm({ ...form, role: e.target.value })}>${roleOptions}</select>
        ${form.role === 'participant' && html`<select value=${form.discipline} onChange=${(e) => setForm({ ...form, discipline: e.target.value })}>
          ${Object.entries(DISCIPLINES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select>`}
        <button class="btn btn-primary">Add</button>
      </form>
      <div class="row"><button class="btn" onClick=${() => setShowSynth(true)}>✨ Generate synthetic participants</button><span class="muted small">AI participants fill empty seats: they add stickies, HMWs and votes when a facilitator asks them to. One can be the Decider.</span></div>
      ${showSynth && html`<${SynthModal} w=${w} members=${data.members} onClose=${() => setShowSynth(false)} />`}
    </div>`;
}

function SynthModal({ w, members, onClose }) {
  const [count, setCount] = useState(3);
  const [disc, setDisc] = useState({ design: true, pm: true, eng: true });
  const [guidance, setGuidance] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const disciplines = Object.keys(disc).filter((k) => disc[k]);

  async function go() {
    setBusy(true); setError('');
    try { await generateSynthetic(w, members, { count, disciplines, guidance }); onClose(); }
    catch (e) { setError(e.message); setBusy(false); }
  }
  return html`
    <${Modal} title="Generate synthetic participants" onClose=${onClose}>
      <div class="stack">
        <p class="muted">AI creates realistic OneStream colleagues with their own perspective on ${w.project || 'this project'}. They join immediately and contribute only when a facilitator asks them to in the room.</p>
        <${Field} label="How many"><input type="number" min="1" max="8" value=${count} onInput=${(e) => setCount(Number(e.target.value))} /><//>
        <div class="field"><span class="field-label">Disciplines</span>
          <div class="row">${Object.entries(DISCIPLINES).map(([k, v]) => html`<label key=${k} class="toggle"><input type="checkbox" checked=${disc[k]} onChange=${(e) => setDisc({ ...disc, [k]: e.target.checked })} /> ${v}</label>`)}</div>
        </div>
        <${Field} label="Guidance (optional)" hint="e.g. 'one skeptical senior engineer', 'a PM who owns the close process'"><textarea rows="2" value=${guidance} onInput=${(e) => setGuidance(e.target.value)}></textarea><//>
        ${error && html`<p class="error">${error}</p>`}
        <div class="row between"><span class="muted small">${isSimulated(w) ? 'Simulated AI: built-in stand-in, no API call.' : 'Uses Claude.'}</span>
          <button class="btn btn-primary" disabled=${busy || !disciplines.length || count < 1} onClick=${go}>${busy ? 'Generating…' : `Generate ${count}`}</button></div>
      </div>
    <//>`;
}
