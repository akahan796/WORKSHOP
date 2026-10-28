// Organizer home: list of workshops, create new, load a sample.
import { html, useState, useEffect, navigate, fmtDate, nextColor } from '../lib.js';
import { backend } from '../backend/index.js';
import { defaultAgenda, defaultIntro } from '../steps.js';
import { Empty } from './ui.js';

const STATUS = { draft: 'Draft', live: 'Live', done: 'Completed' };

export async function createSampleWorkshop(user) {
  const ws = await backend.createWorkshop({
    title: 'Reconciliation Workspace: Discovery Workshop',
    project: 'Account Reconciliations',
    description: 'Find the biggest friction points preparers and reviewers hit at month-end close, and align on one direction to prototype.',
    starts_at: new Date(Date.now() + 2 * 864e5).toISOString(),
    agenda: defaultAgenda(),
    intro: {
      ...defaultIntro(),
      welcome: `Hi everyone, I'm ${user.name || 'your organizer'}, and I'll be facilitating today. Thanks for carving out the time.`,
      background: 'Account Reconciliations is used by preparers and reviewers during month-end close. Research shows reviewers spend a large share of close chasing status and supporting documentation across tools.',
    },
  });
  const people = [
    { name: 'Priya Shah', email: 'priya.shah@example.com', role: 'researcher' },
    { name: 'Dana Lee', email: 'dana.lee@example.com', role: 'participant', discipline: 'design' },
    { name: 'Marcus Chen', email: 'marcus.chen@example.com', role: 'participant', discipline: 'pm', is_decider: true },
    { name: 'Sofia Alvarez', email: 'sofia.alvarez@example.com', role: 'participant', discipline: 'eng' },
    { name: 'Tom Becker', email: 'tom.becker@example.com', role: 'participant', discipline: 'eng' },
  ];
  const members = await backend.listMembers(ws.id);
  for (const p of people) members.push(await backend.addMember(ws.id, { ...p, color: nextColor(members) }));
  return ws;
}

export function Dashboard({ user }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const refresh = () => backend.listMyWorkshops().then(setList).catch((e) => setError(e.message));
  useEffect(() => { refresh(); }, [user.id]);

  async function create() {
    const ws = await backend.createWorkshop({ agenda: defaultAgenda(), intro: defaultIntro() });
    navigate(`/w/${ws.id}/setup`);
  }
  async function sample() {
    try { const ws = await createSampleWorkshop(user); navigate(`/w/${ws.id}/setup`); } catch (e) { setError(e.message); }
  }

  return html`
    <main class="page">
      <div class="page-head">
        <div><h1>Your workshops</h1><p class="muted">Set up a workshop, invite your team, and run it live.</p></div>
        <div class="row">
          <button class="btn" onClick=${sample}>Load sample workshop</button>
          <button class="btn btn-primary" onClick=${create}>+ New workshop</button>
        </div>
      </div>
      ${error && html`<p class="error">${error}</p>`}
      ${list && !list.length && html`<${Empty} title="No workshops yet">Create one, or load the sample to see how it works.<//>`}
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
