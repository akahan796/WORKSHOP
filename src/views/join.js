// Guest invite landing page: confirm name (and discipline), then enter the room.
import { html, useState, useEffect, navigate, DISCIPLINES, ROLES } from '../lib.js';
import { backend } from '../backend/index.js';
import { Header, Field, Empty } from './ui.js';

export function JoinView({ token, user }) {
  const [invite, setInvite] = useState(undefined);
  const [name, setName] = useState('');
  const [discipline, setDiscipline] = useState('design');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    backend.peekInvite(token).then((inv) => {
      setInvite(inv);
      if (inv) { setName(inv.member_name || ''); setDiscipline(inv.member_discipline || 'design'); }
    }).catch(() => setInvite(null));
  }, [token]);

  async function join(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try { const wsId = await backend.claimInvite(token, name, discipline); navigate(`/w/${wsId}`); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  if (invite === undefined) return html`<${Header} /><main class="auth"><p class="muted">Checking your invite…</p></main>`;
  if (!invite) return html`<${Header} /><main class="auth"><${Empty} title="This invite link isn't valid">Ask the workshop organizer for a new link.<//></main>`;

  return html`
    <${Header} />
    <main class="auth">
      <form class="auth-card card stack" onSubmit=${join}>
        <span class="eyebrow">You're invited as ${invite.member_discipline === 'researcher' ? 'the UX researcher' : 'a ' + (ROLES[invite.member_role] || 'Participant').toLowerCase()}</span>
        <h1>${invite.workshop_title}</h1>
        <p class="muted">Confirm your details to join. Your link is personal, so don't share it.</p>
        ${user && user.isStaff && html`<p class="notice">You're signed in as an organizer (${user.email}). Joining switches only this tab to the guest; you stay signed in as organizer in your other tabs.</p>`}
        <${Field} label="Your name"><input required value=${name} onInput=${(e) => setName(e.target.value)} autocomplete="name" /><//>
        ${invite.member_role === 'participant' && html`
          <${Field} label="Your discipline">
            <select value=${discipline} onChange=${(e) => setDiscipline(e.target.value)}>
              ${Object.entries(DISCIPLINES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}
            </select>
          <//>`}
        ${error && html`<p class="error">${error}</p>`}
        <button class="btn btn-primary" disabled=${busy}>${busy ? 'Joining…' : 'Join workshop'}</button>
      </form>
    </main>`;
}
