// Research deck manager (setup page + researcher's panel in the room).
import { html, useState } from '../lib.js';
import { backend } from '../backend/index.js';

export function ResearchManager({ wsId, research, me, canEdit }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function upload(e) {
    const files = [...e.target.files];
    e.target.value = '';
    setBusy(true); setError('');
    try {
      for (const f of files) {
        if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) throw new Error(`${f.name} is not a PDF. Export your PowerPoint or doc to PDF first.`);
        await backend.uploadResearch(wsId, f, '', me && me.id);
      }
    } catch (err) { setError(err.message); }
    setBusy(false);
  }

  return html`
    <div class="stack">
      <p class="muted">Upload the research share-out as a PDF (in PowerPoint: File → Export → PDF). During the workshop it's shown as slides that follow the presenter.</p>
      ${research.length ? html`
        <ul class="list">
          ${research.map((r) => html`
            <li key=${r.id} class="list-row">
              <span class="file-icon">PDF</span>
              <span class="grow">${r.title}</span>
              ${canEdit && html`<button class="btn btn-ghost btn-sm" onClick=${() => confirm(`Remove "${r.title}"?`) && backend.deleteResearch(r)}>Remove</button>`}
            </li>`)}
        </ul>` : html`<p class="muted small">No research decks yet.</p>`}
      ${canEdit && html`
        <label class="dropzone">
          <input type="file" accept="application/pdf,.pdf" multiple onChange=${upload} disabled=${busy} />
          <b>${busy ? 'Uploading…' : 'Choose PDF to upload'}</b>
          <span class="muted small">or drop it here</span>
        </label>`}
      ${error && html`<p class="error">${error}</p>`}
    </div>`;
}
