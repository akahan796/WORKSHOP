// Shared UI pieces.
import { html, useState, useEffect, initials, cx, navigate } from '../lib.js';
import { backend } from '../backend/index.js';

// `menu`: extra items for the user dropdown, [{ label, onClick }] (falsy entries skipped).
export function Header({ user, children, menu = [] }) {
  return html`
    <header class="app-header">
      <a class="brand" href="#/" onClick=${(e) => { if (!user || !user.isStaff) e.preventDefault(); }}>
        <img src="brandmark.svg" alt="" />
        <span>Workshop <b>AI</b></span>
      </a>
      ${backend.mode === 'demo' && html`<span class="pill pill-demo" title="No Supabase configured: data is stored in this browser only">Demo mode</span>`}
      <div class="header-mid">${children}</div>
      ${user && html`<${UserMenu} user=${user} items=${menu.filter(Boolean)} />`}
    </header>`;
}

function UserMenu({ user, items }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (e.type === 'mousedown' ? !e.target.closest('.header-user') : e.key === 'Escape') setOpen(false); };
    addEventListener('mousedown', close); addEventListener('keydown', close);
    return () => { removeEventListener('mousedown', close); removeEventListener('keydown', close); };
  }, [open]);
  const name = user.name || user.email || 'Guest';
  const pick = (fn) => () => { setOpen(false); fn(); };
  return html`
    <div class="header-user">
      <button class="user-trigger" aria-haspopup="menu" aria-expanded=${open} onClick=${() => setOpen(!open)}>
        <${Avatar} name=${name} />
        <span class="header-user-name">${name}</span>
        <span class="caret" aria-hidden="true">▾</span>
      </button>
      ${open && html`
        <div class="user-menu" role="menu">
          ${items.map((it) => html`<button key=${it.label} role="menuitem" class="user-menu-item" onClick=${pick(it.onClick)}>${it.label}</button>`)}
          ${items.length > 0 && html`<div class="user-menu-sep" />`}
          <button role="menuitem" class="user-menu-item" onClick=${pick(async () => { await backend.signOut(); navigate('/login'); })}>Sign out</button>
        </div>`}
    </div>`;
}

export function Avatar({ name, color, size = 28, title }) {
  return html`<span class="avatar" title=${title || name} style=${{ width: size, height: size, fontSize: size * 0.4, background: color || '#E6EDFF' }}>${initials(name)}</span>`;
}

export function Field({ label, hint, children }) {
  return html`<label class="field"><span class="field-label">${label}</span>${children}${hint && html`<span class="field-hint">${hint}</span>`}</label>`;
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const on = (e) => e.key === 'Escape' && onClose();
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [onClose]);
  return html`
    <div class="modal-backdrop" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
      <div class=${cx('modal', wide && 'modal-wide')} role="dialog" aria-label=${title}>
        <div class="modal-head"><h2>${title}</h2><button class="icon-btn" aria-label="Close" onClick=${onClose}>✕</button></div>
        <div class="modal-body">${children}</div>
      </div>
    </div>`;
}

export function Empty({ title, children }) {
  return html`<div class="empty"><h3>${title}</h3>${children && html`<p>${children}</p>`}</div>`;
}

// Text input/textarea that saves on blur (and keeps local edits while typing).
export function SaveOnBlur({ value, onSave, multiline, rows = 3, ...rest }) {
  const [v, setV] = useState(value || '');
  useEffect(() => setV(value || ''), [value]);
  const commit = () => { if ((value || '') !== v) onSave(v); };
  return multiline
    ? html`<textarea rows=${rows} value=${v} onInput=${(e) => setV(e.target.value)} onBlur=${commit} ...${rest}></textarea>`
    : html`<input value=${v} onInput=${(e) => setV(e.target.value)} onBlur=${commit} onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()} ...${rest} />`;
}

export function useCopy() {
  const [copied, setCopied] = useState(null);
  const copy = async (text, key) => {
    try { await navigator.clipboard.writeText(text); } catch { prompt('Copy this link:', text); }
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };
  return [copied, copy];
}

// A button that runs an async action, showing progress and any error inline.
// `run` gets a progress callback for long actions, e.g. progress('1 of 3 done').
// Returning false (e.g. after a declined confirm) cancels quietly.
export function AiButton({ label, run, disabled, title, busyHint }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [msg, setMsg] = useState(null); // { error?: string, ok?: string }
  async function go() {
    setBusy(true); setMsg(null); setProgress('');
    try { const ok = await run(setProgress); setMsg(ok ? { ok } : null); }
    catch (e) { setMsg({ error: e.message }); }
    setBusy(false);
  }
  return html`
    <span class="ai-action">
      <button class="btn btn-sm ai-btn" disabled=${busy || disabled} title=${title} onClick=${go}>${busy ? 'Working…' + (progress ? ' ' + progress : '') : '✨ ' + label}</button>
      ${busy && busyHint && html`<span class="muted small">${busyHint}</span>`}
      ${msg && msg.error && html`<span class="error small">${msg.error}</span>`}
      ${msg && msg.ok && html`<span class="muted small">${msg.ok}</span>`}
    </span>`;
}
