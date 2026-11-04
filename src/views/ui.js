// Shared UI pieces.
import { html, useState, useEffect, initials, cx, navigate, voteColor } from '../lib.js';
import { backend } from '../backend/index.js';

// `menu`: extra items for the user dropdown, [{ label, onClick }] (falsy entries skipped).
export function Header({ user, children, menu = [] }) {
  return html`
    <header class="app-header">
      <a class="brand" href="#/" onClick=${(e) => { if (!user || !user.isStaff) e.preventDefault(); }}>
        <img src="brandmark.svg" alt="" />
        <span>Product Innovation <b>Workshop</b></span>
      </a>
      ${backend.mode === 'demo' && html`<span class="pill pill-demo" title="No Supabase configured: data is stored in this browser only">Demo mode</span>`}
      <div class="header-mid">${children}</div>
      ${user && html`<${UserMenu} user=${user} items=${menu.filter(Boolean)} />`}
    </header>`;
}

// Color themes, picked from the user menu. Each is a palette (an accent and a
// neutral ramp) over the one look in refined.css. The pick is per browser and is
// applied before first paint by index.html.
export const PALETTES = [
  { key: 'blue', label: 'OneStream blue', hint: 'The default', swatch: ['#0A5DFF', '#F2F4F7'] },
  { key: 'indigo', label: 'Indigo', hint: 'Indigo on slate', swatch: ['#4F46E5', '#F1F5F9'] },
  { key: 'teal', label: 'Teal', hint: 'Teal on cool gray', swatch: ['#0E9384', '#F2F4F7'] },
  { key: 'graphite', label: 'Graphite', hint: 'Near-black on zinc', swatch: ['#18181B', '#F4F4F5'] },
  { key: 'terracotta', label: 'Terracotta', hint: 'Warm clay on stone', swatch: ['#B9562F', '#F3F0EB'] },
];
const PALETTE_KEY = 'workshop-palette';
function currentPalette() {
  let p = null;
  try { p = localStorage.getItem(PALETTE_KEY); } catch {}
  return PALETTES.some((x) => x.key === p) ? p : 'blue';
}
function applyPalette(key) {
  if (key === 'blue') document.documentElement.removeAttribute('data-palette');
  else document.documentElement.setAttribute('data-palette', key);
  try { localStorage.setItem(PALETTE_KEY, key); } catch {}
}

function UserMenu({ user, items }) {
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(currentPalette);
  const choose = (key) => { applyPalette(key); setPalette(key); };
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
          ${user.isStaff && html`<div class="user-menu-label">Color theme</div>
          ${PALETTES.map((t) => html`<button key=${t.key} role="menuitemradio" aria-checked=${palette === t.key} class=${cx('user-menu-item theme-item', palette === t.key && 'on')} onClick=${() => choose(t.key)}>
            <span class="theme-swatch" style=${{ background: `linear-gradient(135deg, ${t.swatch[1]} 50%, ${t.swatch[0]} 50%)` }} aria-hidden="true"></span>
            <span class="grow"><span class="theme-name">${t.label}</span><span class="theme-hint">${t.hint}</span></span>
            <span class="theme-check" aria-hidden="true">${palette === t.key ? '✓' : ''}</span></button>`)}
          <div class="user-menu-sep" />`}
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

// A "More" link that shows `text` in a tooltip on hover or keyboard focus. The tip
// is fixed to the window so a scrolling container (e.g. a wide table) can't clip it.
export function MoreTip({ text, label = 'More' }) {
  const [pos, setPos] = useState(null);
  const show = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const width = Math.min(360, innerWidth - 32);
    setPos({ left: Math.max(16, Math.min(r.left, innerWidth - width - 16)), top: r.bottom + 6, width });
  };
  return html`<span class="more-tip">
    <a href="#" class="more-link" aria-label=${text} onClick=${(e) => e.preventDefault()}
      onMouseEnter=${show} onMouseLeave=${() => setPos(null)} onFocus=${show} onBlur=${() => setPos(null)}>${label}</a>
    ${pos && html`<span class="more-tip-box" role="tooltip" style=${pos}>${text}</span>`}
  </span>`;
}

// The voter's dots. Drag one onto anything marked data-vote-target="<id>" to vote;
// onDrop gets that id. Pointer events, so it works with a mouse, a pen or a finger.
export function VoteTray({ me, total, left, what, onDrop, onClear }) {
  if (!me) return null;
  const color = voteColor(me);
  function start(e) {
    if (e.button > 0) return;
    e.preventDefault();
    const src = e.currentTarget;
    const ghost = src.cloneNode();
    ghost.className = 'vdot vdot-ghost';
    document.body.appendChild(ghost);
    src.classList.add('dragging');
    document.body.classList.add('voting-drag');
    let over = null;
    const place = (ev) => {
      ghost.style.transform = `translate(${ev.clientX - 15}px, ${ev.clientY - 15}px)`;
      ghost.style.display = 'none';
      const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-vote-target]') || null;
      ghost.style.display = '';
      if (t !== over) { over?.classList.remove('drop-over'); t?.classList.add('drop-over'); over = t; }
    };
    const end = (ev) => {
      removeEventListener('pointermove', place); removeEventListener('pointerup', end); removeEventListener('pointercancel', end);
      over?.classList.remove('drop-over');
      ghost.remove(); src.classList.remove('dragging'); document.body.classList.remove('voting-drag');
      if (over && ev.type === 'pointerup') onDrop(over.dataset.voteTarget);
    };
    addEventListener('pointermove', place); addEventListener('pointerup', end); addEventListener('pointercancel', end);
    place(e);
  }
  return html`
    <div class="vote-tray" aria-label="Your voting dots">
      <${Avatar} name=${me.name} color=${me.color} size=${30} />
      <div class="vote-tray-dots">
        ${Array.from({ length: total }, (_, i) => i < left
          ? html`<span key=${i} class="vdot vdot-drag" style=${{ background: color }} onPointerDown=${start} title="Drag onto ${what}"></span>`
          : html`<span key=${i} class="vdot vdot-used" style=${{ borderColor: color }} title="Placed"></span>`)}
      </div>
      <div class="vote-tray-text">
        <span class="vote-tray-count"><b>${left} of ${total}</b> dot${total === 1 ? '' : 's'} left</span>
        <span class="muted small">${left > 0 ? `Drag a dot onto ${what}, or just click ${what}.` : `All placed. Click one of your dots on ${what} to take it back.`}</span>
      </div>
      ${total - left > 0 && onClear && html`<button class="btn btn-sm btn-ghost vote-clear"
        onClick=${() => (total - left < 2 || confirm(`Clear all ${total - left} of your votes?`)) && onClear()}>Clear my votes</button>`}
    </div>`;
}
