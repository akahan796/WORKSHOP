// Organizer workshop setup: details, introduction, agenda, people & invites, research.
import { html, useState, navigate, nextColor, inviteUrl, DISCIPLINES, roleLabel, cx, fmtDate, uid } from '../lib.js';
import { backend } from '../backend/index.js';
import { STEPS, BUILT_PHASE, defaultAgenda, defaultIntro, introSlideOrder } from '../steps.js';
import { useWorkshop } from '../useWorkshop.js';
import { Field, SaveOnBlur, Avatar, useCopy, Empty, Modal } from './ui.js';
import { generateSynthetic, isSimulated } from '../ai.js';
import { ResearchManager } from './research.js';
import { PreworkManager, RequestDocsModal } from './prework.js';
import { DEFAULT_SKILLS, skillFor, isDefaultSkill, downloadSkill } from '../skills.js';

const TABS = [['details', 'Details'], ['intro', 'Introduction'], ['agenda', 'Agenda'], ['people', 'People & invites'], ['research', 'Research'], ['prework', 'Pre-work'], ['skills', 'Skills']];

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
      ${user.isStaff ? html`<a class="back" href="#/">← All workshops</a>` : html`<a class="back" href=${'#/w/' + w.id}>← Back to the room</a>`}
      <div class="page-head">
        <div><h1>${w.title}</h1><p class="muted">${[w.project, fmtDate(w.starts_at)].filter(Boolean).join(' · ') || 'Workshop setup'}</p></div>
        <div class="row">
          ${user.isStaff && html`<button class="btn btn-ghost" title="Start over: clear everything the session produced and keep the setup"
            onClick=${() => confirm('Reset this workshop so it can run again from the start?\n\nDeletes all stickies, HMWs, votes, sketches, the user flow, prototypes and decisions. Keeps the details, introduction, agenda, people and research decks. This can\'t be undone.') && backend.resetWorkshop(w.id)}>Reset</button>`}
          ${data.isOwner && html`<button class="btn btn-ghost" onClick=${() => confirm('Delete this workshop and everything in it?') && backend.deleteWorkshop(w.id).then(() => navigate('/'))}>Delete</button>`}
          <button class="btn btn-primary" onClick=${() => navigate(`/w/${w.id}`)}>Open workshop room →</button>
        </div>
      </div>
      <nav class="tabs">
        ${TABS.map(([k, label]) => html`<button key=${k} class=${cx('tab', tab === k && 'tab-on')} onClick=${() => setTab(k)}>${label}${k === 'people' ? html` <span class="count">${data.members.length}</span>` : k === 'prework' && data.prework.length ? html` <span class="count">${data.prework.filter((d) => d.file_path).length}/${data.prework.length}</span>` : ''}</button>`)}
      </nav>
      <section class="card setup-panel">
        ${tab === 'details' && html`<${Details} w=${w} save=${save} />`}
        ${tab === 'intro' && html`<${Intro} w=${w} save=${save} />`}
        ${tab === 'agenda' && html`<${Agenda} w=${w} save=${save} />`}
        ${tab === 'people' && html`<${People} w=${w} data=${data} />`}
        ${tab === 'skills' && html`<${Skills} w=${w} save=${save} />`}
        ${tab === 'prework' && html`<${PreworkManager} w=${w} data=${data} />`}
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
  return html`
    <div class="stack">
      <p class="muted">This is what everyone sees in step 1, one slide per section. It's prefilled; edit it to fit your session.
        Drag the tiles to reorder them, hide the ones you don't need, and expand a tile to edit its text.</p>
      <${IntroSlides} intro=${intro} save=${(patch) => save({ intro: { ...intro, ...patch } })} />
    </div>`;
}

// The text each built-in slide shows, edited inside its tile.
function SlideFields({ s, intro, save }) {
  const set = (k) => (v) => save({ [k]: v });
  if (s.key === 'organizer') return html`<${Field} label="About me (organizer intro)" hint="Who you are and your role in this workshop. If you assign a facilitator in People & invites, the slide shows them as the organizer, with your name in this text replaced by theirs."><${SaveOnBlur} multiline value=${intro.welcome} onSave=${set('welcome')} /><//>`;
  if (s.key === 'project') return html`<${Field} label="Project background" hint="The problem space and why we're here."><${SaveOnBlur} multiline rows="4" value=${intro.background} onSave=${set('background')} /><//>`;
  if (s.key === 'overview') return html`<${Field} label="Workshop overview" hint="The agenda from the Agenda tab is listed beside it."><${SaveOnBlur} multiline value=${intro.overview} onSave=${set('overview')} /><//>`;
  if (s.key === 'rules') return html`<${Field} label="Ground rules" hint="One rule per line.">
    <${SaveOnBlur} multiline rows="6" value=${(intro.rules || []).join('\n')} onSave=${(v) => save({ rules: v.split('\n').map((x) => x.trim()).filter(Boolean) })} /><//>`;
  if (s.key === 'expectations') return html`<${Field} label="What to expect"><${SaveOnBlur} multiline value=${intro.expectations} onSave=${set('expectations')} /><//>`;
  if (s.key === 'people') return html`<p class="muted small">Shows everyone invited in People & invites, with who has joined. Nothing to edit here.</p>`;
  return null;
}

function IntroSlides({ intro, save }) {
  const order = introSlideOrder(intro);
  const [open, setOpen] = useState(() => new Set());
  const [drag, setDrag] = useState(null); // { from, over } while a tile is dragged by its handle
  const commit = (list) => save({ slides: list.map(({ key, enabled, custom, title, text }) => (custom ? { key, enabled, title, text } : { key, enabled })) });
  const patch = (key, p) => commit(order.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const moveTo = (from, to) => { if (from === to) return; const l = order.slice(); const [m] = l.splice(from, 1); l.splice(to, 0, m); commit(l); };
  const toggle = (key) => setOpen((o) => { const n = new Set(o); n.has(key) ? n.delete(key) : n.add(key); return n; });
  function addSlide() {
    const key = 'custom-' + uid();
    commit([...order, { key, custom: true, enabled: true, title: 'New slide', text: '' }]);
    setOpen((o) => new Set(o).add(key));
  }
  // Pointer-based drag (mouse, pen or touch): the drop slot follows the pointer
  // across the tiles' midpoints; releasing moves the tile there.
  function startDrag(e, from) {
    e.preventDefault();
    const list = e.currentTarget.closest('.slide-tiles');
    const slotAt = (y) => {
      const tiles = [...list.children];
      const i = tiles.findIndex((t) => { const r = t.getBoundingClientRect(); return y < r.top + r.height / 2; });
      return i === -1 ? tiles.length - 1 : i > from ? i - 1 : i;
    };
    let over = from;
    setDrag({ from, over });
    const move = (ev) => { const o = slotAt(ev.clientY); if (o !== over) { over = o; setDrag({ from, over }); } };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      setDrag(null); moveTo(from, over);
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }
  const hidden = order.filter((s) => !s.enabled).length;
  let n = 0;
  return html`
    <div class="stack-sm">
      <ol class="slide-tiles">
        ${order.map((s, i) => { const isOpen = open.has(s.key); const name = s.title || 'Untitled slide'; return html`
          <li key=${s.key} class=${cx('slide-tile', !s.enabled && 'off', drag && drag.over === i && drag.from !== i && (drag.from < i ? 'drop-after' : 'drop-before'), drag && drag.from === i && 'dragging')}>
            <div class="slide-tile-head">
              <span class="drag-handle" title="Drag to reorder" aria-hidden="true" onPointerDown=${(e) => startDrag(e, i)}>⋮⋮</span>
              <span class="step-num">${s.enabled ? ++n : '–'}</span>
              <button class="slide-tile-title" aria-expanded=${isOpen} onClick=${() => toggle(s.key)}>
                <b>${name}</b>${s.custom && html` <span class="pill">Custom</span>`}${!s.enabled && html` <span class="pill pill-hidden">Hidden</span>`}
              </button>
              <button class=${cx('btn btn-sm', s.enabled ? 'btn-ghost' : '')} title=${s.enabled ? 'Hide this slide from the Introduction' : 'Show this slide again'}
                aria-pressed=${!s.enabled} onClick=${() => patch(s.key, { enabled: !s.enabled })}>${s.enabled ? 'Hide' : 'Show'}</button>
              <button class="btn btn-ghost btn-sm" disabled=${i === 0} aria-label=${'Move ' + name + ' up'} onClick=${() => moveTo(i, i - 1)}>↑</button>
              <button class="btn btn-ghost btn-sm" disabled=${i === order.length - 1} aria-label=${'Move ' + name + ' down'} onClick=${() => moveTo(i, i + 1)}>↓</button>
              <button class="icon-btn slide-tile-caret" aria-label=${(isOpen ? 'Collapse ' : 'Expand ') + name} onClick=${() => toggle(s.key)}>${isOpen ? '▴' : '▾'}</button>
            </div>
            ${isOpen && html`<div class="slide-tile-body">
              ${s.custom ? html`
                <${Field} label="Slide title"><${SaveOnBlur} value=${s.title} onSave=${(title) => patch(s.key, { title })} /><//>
                <${Field} label="Text" hint="Line breaks are kept on the slide."><${SaveOnBlur} multiline rows="5" value=${s.text} onSave=${(text) => patch(s.key, { text })} /><//>
                <div class="row end"><button class="btn btn-ghost btn-sm" onClick=${() => confirm(`Delete the slide "${name}"?`) && commit(order.filter((x) => x.key !== s.key))}>Delete slide</button></div>`
              : html`<${SlideFields} s=${s} intro=${intro} save=${save} />`}
            </div>`}
          </li>`; })}
      </ol>
      <div class="row between"><button class="btn" onClick=${addSlide}>+ Add slide</button>
        <span class="muted small">${order.length - hidden} shown${hidden ? ` · ${hidden} hidden (skipped in the workshop)` : ''}</span></div>
    </div>`;
}

function Skills({ w, save }) {
  const intro = { ...defaultIntro(), ...w.intro };
  const field = (kind, key, label, hint) => {
    const custom = !isDefaultSkill(w, kind);
    return html`
      <div class="field"><div class="row between"><span class="field-label">${label} ${custom ? html`<span class="pill">Edited</span>` : html`<span class="pill pill-live">Default</span>`}</span>
        <div class="row">
          <button class="btn btn-sm btn-ghost" onClick=${() => downloadSkill(w, kind)}>Download .md</button>
          ${custom && html`<button class="btn btn-sm btn-ghost" onClick=${() => confirm('Replace your edits with the default skill?') && save({ intro: { ...intro, [key]: '' } })}>Reset to default</button>`}
        </div></div>
        <${SaveOnBlur} multiline rows="14" class="mono" value=${skillFor(w, kind)} onSave=${(v) => save({ intro: { ...intro, [key]: v.trim() === DEFAULT_SKILLS[kind].trim() ? '' : v } })} />
        <span class="field-hint">${hint}</span>
      </div>`;
  };
  return html`
    <div class="stack">
      <p class="muted">The skills participants use in their own AI tool (Claude, ChatGPT, Copilot…) to sketch. The ideas come from the participant: they describe one idea or frame at a time, and the skill turns each into a sketch in the same format, so everyone's sketches look alike. It never comes up with ideas for them. Each is a standard skill file (SKILL.md) that works pasted as a prompt or installed as a skill. During the step, participants copy the skill and a context prompt with the HMW and research. AI participants use the same skill for the format, with their own ideas. Edit to fit your session.</p>
      ${field('crazy8', 'skill_crazy8', 'Crazy 8s skill', 'Used in step: Crazy 8s. The participant describes each of their 8 ideas; the skill draws each as a rough wireframe with a short caption.')}
      ${field('solution', 'skill_solution', 'Solution sketch skill', 'Used in step: Solution Sketch. The participant gives the title and describes each frame; the skill tidies the words and draws each frame in one consistent look.')}
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

function mailtoInvite(w, m, link, docs = []) {
  const subject = `You're invited: ${w.title}`;
  const when = w.starts_at ? `\nWhen: ${fmtDate(w.starts_at)}` : '';
  const ask = docs.length ? `\n\nBefore the workshop, please upload these documents from the same link:\n${docs.map((d) => `- ${d.title}`).join('\n')}` : '';
  const body = `Hi ${m.name.split(' ')[0] || 'there'},\n\nYou're invited to join "${w.title}" as ${m.is_decider || m.discipline === 'researcher' ? 'the' : 'a'} ${roleLabel(m).replace(/^(?!UX|Decider)./, (c) => c.toLowerCase())}.${when}\n\n${w.description || ''}\n\nJoin here (no account needed):\n${link}${ask}\n\nSee you there!`;
  return `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function People({ w, data }) {
  const [form, setForm] = useState({ name: '', email: '', role: 'participant', discipline: 'design' });
  const [copied, copy] = useCopy();
  const [showSynth, setShowSynth] = useState(false);
  const [requesting, setRequesting] = useState(null);
  const requestsFor = (m) => data.prework.filter((d) => d.requested_from === m.id);
  // The owner is always a facilitator and is listed first, without a role picker or invite.
  const owner = data.members.find((m) => m.role === 'organizer');
  const people = data.members.filter((m) => m.role !== 'organizer');
  // Decider is shown as a role, but it's a participant with the is_decider flag
  // (there's one per workshop: picking it for someone moves it from whoever had it).
  const roleOptions = html`<option value="participant">Participant</option><option value="decider">Decider</option><option value="facilitator">Facilitator</option>`;
  const synthRoleOptions = html`<option value="participant">Participant</option><option value="decider">Decider</option>`;
  const roleOf = (m) => (m.is_decider ? 'decider' : m.role);
  const hasDiscipline = (role) => role === 'participant' || role === 'decider';
  const setRole = (m, role) => backend.updateMember(m.id, role === 'facilitator'
    ? { role, discipline: null, is_decider: false }
    : { role: 'participant', discipline: m.discipline || 'design', is_decider: role === 'decider' });

  async function add(e) {
    e.preventDefault();
    const { role, ...rest } = form;
    const m = await backend.addMember(w.id, { ...rest, role: role === 'facilitator' ? 'facilitator' : 'participant', name: form.name.trim(), email: form.email.trim(),
      discipline: hasDiscipline(role) ? form.discipline : null, color: nextColor(data.members) });
    if (role === 'decider') await backend.updateMember(m.id, { is_decider: true });
    setForm({ ...form, name: '', email: '' });
  }

  return html`
    <div class="stack">
      <p class="muted">Each person gets a personal guest link. It takes them straight to this workshop, with no account needed. <b>Send invite</b> opens a prefilled email in your mail app.${' '}<b>Facilitators</b> get the facilitator controls: they run the steps and timer, use the AI actions and can edit this setup. They don't sketch or vote.${' '}<b>The Decider</b> takes part like a participant, but their votes show in purple, count double, and they make the final call. There's one Decider: choosing it for someone else moves it to them.</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Person</th><th>Role</th><th>Discipline</th><th>Status</th><th title="Documents this person is asked to upload">Pre-work</th><th>Invite</th><th></th></tr></thead>
        <tbody>
          ${owner && html`<tr key=${owner.id}>
            <td><div class="row"><${Avatar} name=${owner.name} color=${owner.color} /><div><b>${owner.name || '(no name)'}</b><div class="muted small">${owner.email}</div></div></div></td>
            <td><span class="pill pill-facilitator">Facilitator</span> <span class="muted small">Owner</span></td>
            <td><span class="muted">—</span></td>
            <td><span class="pill pill-live">Joined</span></td><td></td>
            <td><span class="muted small">Signed in with an account</span></td><td></td>
          </tr>`}
          ${people.map((m) => { const link = data.invites[m.id] ? inviteUrl(data.invites[m.id]) : ''; return html`
            <tr key=${m.id}>
              <td><div class="row"><${Avatar} name=${m.name} color=${m.color} /><div><div><b>${m.name || '(no name)'}</b>${m.is_synthetic && html` <span class="pill pill-ai" title="Synthetic participant generated by AI">AI</span>`}</div><div class="muted small persona" title=${m.persona || ''}>${m.is_synthetic ? m.persona : m.email}</div></div></div></td>
              <td><select class=${cx(m.is_decider && 'select-decider')} value=${roleOf(m)} onChange=${(e) => setRole(m, e.target.value)}>
                ${m.is_synthetic ? synthRoleOptions : roleOptions}</select></td>
              <td>${m.role === 'participant' ? html`<select value=${m.discipline || ''} onChange=${(e) => backend.updateMember(m.id, { discipline: e.target.value })}>
                ${Object.entries(DISCIPLINES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select>` : html`<span class="muted">—</span>`}</td>
              <td>${m.is_synthetic ? html`<span class="pill pill-ai">Synthetic</span>` : m.joined_at ? html`<span class="pill pill-live">Joined</span>` : html`<span class="pill">Invited</span>`}</td>
              <td>${m.is_synthetic ? html`<span class="muted">—</span>` : (() => { const r = requestsFor(m), done = r.filter((d) => d.file_path).length; return html`
                <button class="btn btn-sm" title="Request documents for this person to upload" onClick=${() => setRequesting(m)}>${r.length ? `Requested ${r.length}` : 'Request docs'}</button>
                ${r.length > 0 && html`<div class="muted small">${done} of ${r.length} uploaded</div>`}`; })()}</td>
              <td>${m.is_synthetic ? html`<span class="muted small">No invite needed</span>` : html`<div class="row nowrap">
                <button class="btn btn-sm" disabled=${!link} onClick=${() => copy(link, m.id)}>${copied === m.id ? 'Copied ✓' : 'Copy link'}</button>
                <a class=${cx('btn btn-sm', !m.email && 'disabled')} href=${m.email && link ? mailtoInvite(w, m, link, requestsFor(m).filter((d) => !d.file_path)) : undefined}>Send invite</a>
              </div>`}</td>
              <td><button class="btn btn-ghost btn-sm" aria-label=${'Remove ' + m.name} onClick=${() => confirm(`Remove ${m.name}? Their stickies are removed too.`) && backend.removeMember(m.id)}>✕</button></td>
            </tr>`; })}
        </tbody>
      </table></div>
      ${!people.length && html`<p class="muted small">No one invited yet.</p>`}
      <form class="add-person" onSubmit=${add}>
        <input required placeholder="Full name" value=${form.name} onInput=${(e) => setForm({ ...form, name: e.target.value })} />
        <input type="email" placeholder="Email" value=${form.email} onInput=${(e) => setForm({ ...form, email: e.target.value })} />
        <select value=${form.role} onChange=${(e) => setForm({ ...form, role: e.target.value })}>${roleOptions}</select>
        ${hasDiscipline(form.role) && html`<select value=${form.discipline} onChange=${(e) => setForm({ ...form, discipline: e.target.value })}>
          ${Object.entries(DISCIPLINES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select>`}
        <button class="btn btn-primary">Add</button>
      </form>
      <div class="row"><button class="btn" onClick=${() => setShowSynth(true)}>✨ Generate synthetic participants</button><span class="muted small">AI participants fill empty seats: they add stickies, HMWs and votes when a facilitator asks them to. One can be the Decider.</span></div>
      ${requesting && html`<${RequestDocsModal} w=${w} data=${data} member=${requesting} onClose=${() => setRequesting(null)} />`}
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
          <div class="row">${Object.entries(DISCIPLINES).filter(([k]) => k in disc).map(([k, v]) => html`<label key=${k} class="toggle"><input type="checkbox" checked=${disc[k]} onChange=${(e) => setDisc({ ...disc, [k]: e.target.checked })} /> ${v}</label>`)}</div>
        </div>
        <${Field} label="Guidance (optional)" hint="e.g. 'one skeptical senior engineer', 'a PM who owns the close process'"><textarea rows="2" value=${guidance} onInput=${(e) => setGuidance(e.target.value)}></textarea><//>
        ${error && html`<p class="error">${error}</p>`}
        <div class="row between"><span class="muted small">${isSimulated(w) ? 'Simulated AI: built-in stand-in, no API call.' : 'Uses Claude.'}</span>
          <button class="btn btn-primary" disabled=${busy || !disciplines.length || count < 1} onClick=${go}>${busy ? 'Generating…' : `Generate ${count}`}</button></div>
      </div>
    <//>`;
}
