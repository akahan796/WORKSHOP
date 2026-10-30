// Pre-work documents: the list facilitators manage in Setup → Pre-work, the
// request picker in People & invites, and the guest's own upload view in the room.
// A document is a placeholder until a file is uploaded to it.
import { html, useState, cx, fmtDate } from '../lib.js';
import { backend } from '../backend/index.js';
import { Field, SaveOnBlur, Modal } from './ui.js';

const ext = (name) => ((name || '').match(/\.([a-z0-9]{1,5})$/i) || [, 'FILE'])[1].toUpperCase();
const baseName = (name) => (name || '').replace(/\.[a-z0-9]{1,5}$/i, '');
export const fmtSize = (n) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
// Who can be asked for documents: invited people, not the owner or AI participants.
export const requestable = (members) => members.filter((m) => m.role !== 'organizer' && !m.is_synthetic);

async function openFile(d) {
  const url = await backend.preworkFileUrl(d);
  if (url) window.open(url, '_blank', 'noopener');
}

function StatusPill({ d }) {
  return d.file_path
    ? html`<span class="pill pill-live">Uploaded</span>`
    : html`<span class="pill pill-missing">Not uploaded</span>`;
}

// Upload control: a button that opens the file picker. Dropping a file on the
// surrounding row (see useDrop) does the same.
function UploadButton({ d, label, onUpload, busy }) {
  return html`
    <label class=${cx('btn btn-sm', !d.file_path && 'btn-primary', busy && 'disabled')}>
      <input type="file" hidden disabled=${busy} onChange=${(e) => { const f = e.target.files[0]; e.target.value = ''; f && onUpload(f); }} />
      ${busy ? 'Uploading…' : label || (d.file_path ? 'Replace' : 'Upload')}
    </label>`;
}

function useUpload() {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  async function upload(d, file) {
    setBusy(d.id); setError('');
    try { await backend.uploadPrework(d, file); }
    catch (e) { setError(`${file.name}: ${e.message}`); }
    setBusy(null);
  }
  return { busy, error, setError, upload };
}

function useDrop(onFile) {
  const [over, setOver] = useState(false);
  return [over, {
    onDragOver: (e) => { e.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; f && onFile(f); },
  }];
}

// ── Setup → Pre-work ──
export function PreworkManager({ w, data }) {
  const docs = data.prework;
  const people = requestable(data.members);
  const nameOf = Object.fromEntries(data.members.map((m) => [m.id, m.name]));
  const { busy, error, setError, upload } = useUpload();
  const [adding, setAdding] = useState(false);
  const [dropping, setDropping] = useState(false);

  // Dropped or picked files each become a document named after the file.
  async function addFiles(files) {
    setDropping(true); setError('');
    for (const f of files) {
      try { const d = await backend.addPrework(w.id, { title: baseName(f.name) }); await backend.uploadPrework(d, f); }
      catch (e) { setError(`${f.name}: ${e.message}`); }
    }
    setDropping(false);
  }

  const uploaded = docs.filter((d) => d.file_path).length;
  return html`
    <div class="stack">
      <p class="muted">Documents people should have before the workshop. Add a document with a file, or as a placeholder for one you're still waiting on. Request a placeholder from someone in <b>People & invites</b>, and they upload it from their guest link.</p>
      <div class="row between">
        <span class="muted small">${docs.length ? `${uploaded} of ${docs.length} uploaded` : 'No pre-work documents yet.'}</span>
        <button class="btn" onClick=${() => setAdding(true)}>+ Add a new document</button>
      </div>
      ${docs.length > 0 && html`
        <ul class="list prework-list">
          ${docs.map((d) => html`<${DocRow} key=${d.id} d=${d} people=${people} nameOf=${nameOf} busy=${busy === d.id} onUpload=${(f) => upload(d, f)} />`)}
        </ul>`}
      <label class="dropzone">
        <input type="file" multiple disabled=${dropping} onChange=${(e) => { const fs = [...e.target.files]; e.target.value = ''; addFiles(fs); }} />
        <b>${dropping ? 'Uploading…' : 'Choose files to upload'}</b>
        <span class="muted small">or drop them here. Each file becomes a document; any file type.</span>
      </label>
      ${error && html`<p class="error">${error}</p>`}
      ${adding && html`<${AddDocModal} w=${w} people=${people} onClose=${() => setAdding(false)} />`}
    </div>`;
}

function DocRow({ d, people, nameOf, busy, onUpload }) {
  const [open, setOpen] = useState(false);
  const [over, drop] = useDrop(onUpload);
  const requested = d.requested_from && nameOf[d.requested_from];
  return html`
    <li class=${cx('prework-row', over && 'drop-over')} ...${drop}>
      <div class="list-row">
        <span class=${cx('file-icon', !d.file_path && 'file-icon-empty')}>${d.file_path ? ext(d.file_name) : '—'}</span>
        <div class="grow prework-main">
          <div class="row"><b>${d.title || '(untitled document)'}</b><${StatusPill} d=${d} /></div>
          ${d.description && !open && html`<div class="muted small prework-desc">${d.description}</div>`}
          <div class="muted small">
            ${d.file_path ? html`${d.file_name} · ${fmtSize(d.file_size)}${d.uploaded_by && nameOf[d.uploaded_by] ? ` · uploaded by ${nameOf[d.uploaded_by]}` : ''}${d.uploaded_at ? ` · ${fmtDate(d.uploaded_at)}` : ''}` : requested ? `Requested from ${requested}` : 'Not requested from anyone'}
          </div>
        </div>
        <div class="row nowrap">
          ${d.file_path && html`<button class="btn btn-sm" onClick=${() => openFile(d)}>Download</button>`}
          <${UploadButton} d=${d} busy=${busy} onUpload=${onUpload} />
          <button class="btn btn-ghost btn-sm" aria-expanded=${open} onClick=${() => setOpen(!open)}>${open ? 'Done' : 'Edit'}</button>
        </div>
      </div>
      ${open && html`
        <div class="prework-edit form-grid">
          <${Field} label="Name"><${SaveOnBlur} value=${d.title} onSave=${(title) => backend.updatePrework(d.id, { title })} /><//>
          <${Field} label="Requested from" hint="They'll see it when they open their guest link.">
            <select value=${d.requested_from || ''} onChange=${(e) => backend.updatePrework(d.id, { requested_from: e.target.value || null })}>
              <option value="">No one</option>
              ${people.map((m) => html`<option key=${m.id} value=${m.id}>${m.name}</option>`)}
            </select>
          <//>
          <div class="span-2"><${Field} label="Description (optional)"><${SaveOnBlur} multiline rows=${2} value=${d.description} onSave=${(description) => backend.updatePrework(d.id, { description })} /><//></div>
          <div class="span-2 row between">
            ${d.file_path ? html`<button class="btn btn-ghost btn-sm" onClick=${() => confirm(`Remove the file from "${d.title}"? The document stays as a placeholder.`) && backend.removePreworkFile(d)}>Remove file</button>` : html`<span></span>`}
            <button class="btn btn-ghost btn-sm danger" onClick=${() => confirm(`Delete "${d.title}"${d.file_path ? ' and its file' : ''}?`) && backend.deletePrework(d)}>Delete document</button>
          </div>
        </div>`}
    </li>`;
}

function AddDocModal({ w, people, onClose }) {
  const [f, setF] = useState({ title: '', description: '', requested_from: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const d = await backend.addPrework(w.id, { title: f.title.trim(), description: f.description.trim(), requested_from: f.requested_from || null });
      if (file) await backend.uploadPrework(d, file);
      onClose();
    } catch (err) { setError(err.message); setBusy(false); }
  }
  return html`
    <${Modal} title="Add a new document" onClose=${onClose}>
      <form class="stack" onSubmit=${save}>
        <${Field} label="Name"><input required autofocus value=${f.title} onInput=${(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Current approval policy" /><//>
        <${Field} label="Description (optional)"><textarea rows="2" value=${f.description} onInput=${(e) => setF({ ...f, description: e.target.value })} placeholder="What it is and why people should read it"></textarea><//>
        <${Field} label="File (optional)" hint="Leave it empty to add a placeholder that shows as Not uploaded.">
          <label class="dropzone dropzone-sm">
            <input type="file" onChange=${(e) => { const x = e.target.files[0]; setFile(x || null); if (x && !f.title) setF({ ...f, title: baseName(x.name) }); }} />
            <b>${file ? file.name : 'Choose a file'}</b>
            <span class="muted small">${file ? fmtSize(file.size) : 'or drop it here'}</span>
          </label>
        <//>
        ${!file && people.length > 0 && html`
          <${Field} label="Request it from (optional)">
            <select value=${f.requested_from} onChange=${(e) => setF({ ...f, requested_from: e.target.value })}>
              <option value="">No one yet</option>
              ${people.map((m) => html`<option key=${m.id} value=${m.id}>${m.name}</option>`)}
            </select>
          <//>`}
        ${error && html`<p class="error">${error}</p>`}
        <div class="row between"><button type="button" class="btn btn-ghost" onClick=${onClose}>Cancel</button>
          <button class="btn btn-primary" disabled=${busy || !f.title.trim()}>${busy ? 'Saving…' : file ? 'Add document' : 'Add placeholder'}</button></div>
      </form>
    <//>`;
}

// ── People & invites → Request documents ──
export function RequestDocsModal({ w, data, member, onClose }) {
  const nameOf = Object.fromEntries(data.members.map((m) => [m.id, m.name]));
  const open = data.prework.filter((d) => !d.file_path);
  const [picked, setPicked] = useState(() => new Set(open.filter((d) => d.requested_from === member.id).map((d) => d.id)));
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (id) => { const s = new Set(picked); s.has(id) ? s.delete(id) : s.add(id); setPicked(s); };

  async function addPlaceholder(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    const d = await backend.addPrework(w.id, { title: newName.trim() });
    setNewName('');
    setPicked((s) => new Set([...s, d.id]));
  }
  async function save() {
    setBusy(true);
    for (const d of data.prework.filter((x) => !x.file_path)) {
      const want = picked.has(d.id);
      if (want && d.requested_from !== member.id) await backend.updatePrework(d.id, { requested_from: member.id });
      if (!want && d.requested_from === member.id) await backend.updatePrework(d.id, { requested_from: null });
    }
    onClose();
  }
  return html`
    <${Modal} title=${`Request documents from ${member.name}`} onClose=${onClose}>
      <div class="stack">
        <p class="muted">Pick the documents ${member.name.split(' ')[0]} should upload. They'll see them, with an upload button, when they open their guest link. Only documents that aren't uploaded yet are listed.</p>
        ${data.prework.length && !open.length ? html`<p class="muted small">Every pre-work document is already uploaded. Add a placeholder below.</p>` : ''}
        <ul class="list">
          ${data.prework.filter((d) => !d.file_path).map((d) => html`
            <li key=${d.id} class="list-row">
              <label class="toggle grow"><input type="checkbox" checked=${picked.has(d.id)} onChange=${() => toggle(d.id)} />
                <span><b>${d.title || '(untitled document)'}</b>${d.description && html`<span class="muted small prework-req-desc"> · ${d.description}</span>`}</span></label>
              ${d.requested_from && d.requested_from !== member.id && html`<span class="muted small" title="Checking it moves the request">Requested from ${nameOf[d.requested_from] || 'someone else'}</span>`}
            </li>`)}
        </ul>
        <form class="row nowrap" onSubmit=${addPlaceholder}>
          <input class="grow" placeholder="New placeholder, e.g. Last quarter's close checklist" value=${newName} onInput=${(e) => setNewName(e.target.value)} />
          <button class="btn" disabled=${!newName.trim()}>+ Add</button>
        </form>
        <div class="row between"><span class="muted small">${picked.size} selected</span>
          <button class="btn btn-primary" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save requests'}</button></div>
      </div>
    <//>`;
}

// ── Room: the guest's requested documents, then everything already uploaded ──
export function PreworkPanel({ data, me }) {
  const { busy, error, upload } = useUpload();
  const mine = me ? data.prework.filter((d) => d.requested_from === me.id) : [];
  const others = data.prework.filter((d) => d.file_path && !mine.includes(d));
  return html`
    <div class="stack">
      ${mine.length > 0 && html`
        <h3 class="prework-h">Requested from you</h3>
        <p class="muted small">The facilitator asked you to upload these before the workshop. Drop a file on a document or click Upload.</p>
        <ul class="list prework-list">${mine.map((d) => html`<${MyDocRow} key=${d.id} d=${d} busy=${busy === d.id} onUpload=${(f) => upload(d, f)} />`)}</ul>`}
      <h3 class="prework-h">Pre-work documents</h3>
      ${others.length ? html`
        <ul class="list prework-list">${others.map((d) => html`
          <li key=${d.id} class="prework-row"><div class="list-row">
            <span class="file-icon">${ext(d.file_name)}</span>
            <div class="grow prework-main"><b>${d.title}</b>${d.description && html`<div class="muted small prework-desc">${d.description}</div>`}<div class="muted small">${d.file_name} · ${fmtSize(d.file_size)}</div></div>
            <button class="btn btn-sm" onClick=${() => openFile(d)}>Download</button>
          </div></li>`)}</ul>` : html`<p class="muted small">Nothing to read yet.</p>`}
      ${error && html`<p class="error">${error}</p>`}
    </div>`;
}

function MyDocRow({ d, busy, onUpload }) {
  const [over, drop] = useDrop(onUpload);
  return html`
    <li class=${cx('prework-row', over && 'drop-over')} ...${drop}><div class="list-row">
      <span class=${cx('file-icon', !d.file_path && 'file-icon-empty')}>${d.file_path ? ext(d.file_name) : '—'}</span>
      <div class="grow prework-main">
        <div class="row"><b>${d.title}</b><${StatusPill} d=${d} /></div>
        ${d.description && html`<div class="muted small prework-desc">${d.description}</div>`}
        ${d.file_path && html`<div class="muted small">${d.file_name} · ${fmtSize(d.file_size)}</div>`}
      </div>
      <${UploadButton} d=${d} busy=${busy} onUpload=${onUpload} />
    </div></li>`;
}
