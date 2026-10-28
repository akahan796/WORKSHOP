// Shared UI pieces.
import { html, useState, useEffect, initials, cx, navigate } from '../lib.js';
import { backend } from '../backend/index.js';

export function Header({ user, children }) {
  return html`
    <header class="app-header">
      <a class="brand" href="#/" onClick=${(e) => { if (!user || !user.isStaff) e.preventDefault(); }}>
        <img src="brandmark.svg" alt="" />
        <span>Workshop <b>AI</b></span>
      </a>
      ${backend.mode === 'demo' && html`<span class="pill pill-demo" title="No Supabase configured: data is stored in this browser only">Demo mode</span>`}
      <div class="header-mid">${children}</div>
      ${user && html`
        <div class="header-user">
          <${Avatar} name=${user.name || user.email || 'Guest'} />
          <span class="header-user-name">${user.name || user.email || 'Guest'}</span>
          <button class="btn btn-ghost btn-sm" onClick=${async () => { await backend.signOut(); navigate('/login'); }}>Sign out</button>
        </div>`}
    </header>`;
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
