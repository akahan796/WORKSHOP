// Organizer sign in / create account. Guests never sign in here: they use their invite link.
import { html, useState, navigate } from '../lib.js';
import { backend } from '../backend/index.js';
import { Field } from './ui.js';

export function AuthView({ guest }) {
  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      if (mode === 'signup') await backend.signUp(form); else await backend.signIn(form);
      if (location.hash.startsWith('#/login') || !location.hash) navigate('/');
    } catch (err) { setError(err.message); }
    setBusy(false);
  }

  return html`
    <main class="auth">
      <div class="auth-card card">
        <h1>${mode === 'signup' ? 'Create organizer account' : 'Sign in'}</h1>
        <p class="muted">Organizers set up and run workshops. Researchers and participants join from the invite link in their email, with no account needed.</p>
        ${guest && html`<p class="notice">You're signed in as a workshop guest. Open your workshop from your invite link.</p>`}
        <form onSubmit=${submit} class="stack">
          ${mode === 'signup' && html`<${Field} label="Full name"><input required value=${form.name} onInput=${set('name')} autocomplete="name" /><//>`}
          <${Field} label="Work email"><input required type="email" value=${form.email} onInput=${set('email')} autocomplete="email" /><//>
          <${Field} label="Password"><input required type="password" minlength="6" value=${form.password} onInput=${set('password')} autocomplete=${mode === 'signup' ? 'new-password' : 'current-password'} /><//>
          ${error && html`<p class="error">${error}</p>`}
          <button class="btn btn-primary" disabled=${busy}>${mode === 'signup' ? 'Create account' : 'Sign in'}</button>
        </form>
        <p class="auth-switch">
          ${mode === 'signup' ? 'Already have an account? ' : 'New organizer? '}
          <a href="#" onClick=${(e) => { e.preventDefault(); setMode(mode === 'signup' ? 'signin' : 'signup'); setError(''); }}>
            ${mode === 'signup' ? 'Sign in' : 'Create an account'}
          </a>
        </p>
        ${backend.mode === 'demo' && html`<p class="field-hint">Demo mode: accounts and workshops are stored only in this browser.</p>`}
      </div>
    </main>`;
}
