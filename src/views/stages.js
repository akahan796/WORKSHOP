// The stage shown for each workshop step.
import { html, useState, useEffect, useMemo, cx, DISCIPLINES, ROLES, fmtDate, hmwText, facilitates } from '../lib.js';
import { backend } from '../backend/index.js';
import { activeSteps, defaultIntro, STICKY_KINDS } from '../steps.js';
import { Avatar, Empty, AiButton } from './ui.js';
import { synthResearch, synthHmw } from '../ai.js';
import { PdfSlide } from '../pdf.js';

// ── Shared sticky pieces ──
export function Sticky({ s, author, mine, onDelete, small, children }) {
  return html`
    <div class=${cx('sticky', small && 'sticky-sm')} style=${{ background: author ? author.color : '#FFE27A' }}>
      ${s.kind !== 'hmw' && html`<span class="sticky-kind">${STICKY_KINDS[s.kind]?.label}</span>`}
      <p>${s.text}</p>
      <div class="sticky-foot">
        <span class="sticky-author">${author ? author.name : ''}</span>
        ${children}
        ${mine && onDelete && html`<button class="sticky-x" aria-label="Delete sticky" onClick=${onDelete}>✕</button>`}
      </div>
    </div>`;
}

function Composer({ placeholder, prefix, onAdd, value, setValue }) {
  const submit = async () => {
    const t = value.trim();
    if (!t) return;
    await onAdd(t);
    setValue('');
  };
  return html`
    <div class="composer">
      ${prefix && html`<span class="composer-prefix">${prefix}</span>`}
      <textarea rows="3" placeholder=${placeholder} value=${value} onInput=${(e) => setValue(e.target.value)}
        onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}></textarea>
      <div class="row between"><span class="muted small">Enter to add · Shift+Enter for a new line</span><button class="btn btn-primary btn-sm" onClick=${submit}>Add sticky</button></div>
    </div>`;
}

function useAuthors(members) {
  return useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members]);
}

// The organizer shown to everyone: the facilitator(s) the owner assigned, or else the owner.
function workshopHosts(members) {
  const owner = members.find((m) => m.role === 'organizer');
  const assigned = members.filter((m) => m.role === 'facilitator');
  return { owner, assigned, hosts: assigned.length ? assigned : owner ? [owner] : [] };
}

// ── Cover: before step 1, shown while everyone joins (not an agenda step) ──
export function CoverStage({ w, data }) {
  const { hosts } = workshopHosts(data.members);
  const people = data.members.filter((m) => !facilitates(m));
  const here = people.filter((m) => m.joined_at);
  return html`
    <div class="cover">
      <div class="cover-card">
        <span class="eyebrow">${[w.project || 'Design thinking workshop', w.starts_at && fmtDate(w.starts_at)].filter(Boolean).join(' · ')}</span>
        <h1 class="cover-title">${w.title}</h1>
        ${w.description && html`<p class="cover-lead">${w.description}</p>`}
        ${hosts.length > 0 && html`<p class="cover-host">Facilitated by ${hosts.map((m) => m.name).join(' & ')}</p>`}
      </div>
      <div class="cover-wait">
        <div class="cover-wait-head"><span class="cover-pulse" aria-hidden="true"></span><b>${w.status === 'draft' ? 'Waiting for everyone to join' : 'Welcome'}</b>
          <span class="muted">${here.length} of ${people.length} here</span></div>
        <div class="cover-people">
          ${people.map((m) => html`<span key=${m.id} class=${cx('cover-person', !m.joined_at && 'absent')} title=${m.name + (m.joined_at ? '' : ' (not here yet)')}>
            <${Avatar} name=${m.name} color=${m.color} size=${36} /><span class="small">${m.name.split(' ')[0]}</span></span>`)}
        </div>
      </div>
    </div>`;
}

// ── Step 1: Introductions ──
export function IntroStage({ w, data }) {
  const intro = { ...defaultIntro(), ...w.intro };
  const { owner, assigned, hosts } = workshopHosts(data.members);
  // A welcome written in the owner's name ("I'm Alex Kahan…") is shown in the facilitator's.
  const welcome = assigned.length && owner?.name ? (intro.welcome || '').split(owner.name).join(assigned[0].name) : intro.welcome;
  const steps = activeSteps(w);
  const people = data.members.filter((m) => !facilitates(m));
  return html`
    <div class="intro">
      <section class="intro-hero">
        <span class="eyebrow">${w.project || 'Design thinking workshop'}${w.starts_at ? ' · ' + fmtDate(w.starts_at) : ''}</span>
        <h1>${w.title}</h1>
        ${w.description && html`<p class="lead">${w.description}</p>`}
      </section>
      <div class="intro-grid">
        <section class="card">
          <h3>Your organizer${hosts.length > 1 ? 's' : ''}</h3>
          <div class="stack-sm">${hosts.map((m) => html`<div key=${m.id} class="row"><${Avatar} name=${m.name} color=${m.color} size=${44} /><div><b>${m.name}</b><div class="muted small">Organizer & facilitator</div></div></div>`)}</div>
          ${welcome && html`<p>${welcome}</p>`}
        </section>
        <section class="card">
          <h3>About the project</h3>
          <p>${intro.background || html`<span class="muted">The organizer hasn't added background yet.</span>`}</p>
        </section>
        <section class="card">
          <h3>Workshop overview</h3>
          <p>${intro.overview}</p>
          <ol class="intro-agenda">${steps.map((s) => html`<li key=${s.key}><span>${s.title}</span><span class="muted">${s.minutes} min</span></li>`)}</ol>
        </section>
        <section class="card">
          <h3>Ground rules</h3>
          <ul class="rules">${(intro.rules || []).map((r, i) => html`<li key=${i}>${r}</li>`)}</ul>
          <h3>What to expect</h3>
          <p>${intro.expectations}</p>
        </section>
        <section class="card span-2">
          <h3>Who's here</h3>
          <div class="people-grid">
            ${people.map((m) => html`
              <div key=${m.id} class=${cx('person', !m.joined_at && 'absent')}>
                <${Avatar} name=${m.name} color=${m.color} size=${40} />
                <div><b>${m.name}</b>${m.is_synthetic && html` <span class="pill pill-ai">AI</span>`}<div class="muted small">${m.role === 'participant' ? DISCIPLINES[m.discipline] : ROLES[m.role]}${m.is_decider ? ' · Decider' : ''}</div>
                ${!m.joined_at && html`<div class="muted small">Not joined yet</div>`}</div>
              </div>`)}
          </div>
        </section>
      </div>
    </div>`;
}

// ── Step 2: UX Research Share Out ──
export function ResearchStage({ w, data, me, isOrganizer, isResearcher }) {
  const st = w.step_state || {};
  const canPresent = isOrganizer || isResearcher;
  const docs = data.research;
  const sharedDoc = docs.find((d) => d.id === st.research_doc) || docs[0];
  const sharedPage = st.research_page || 1;
  const [local, setLocal] = useState(null); // viewer browsing on their own: { docId, page }
  const [pages, setPages] = useState(null); // unknown until the PDF loads
  const [url, setUrl] = useState(null);
  const [view, setView] = useState('slides');
  const revealed = !!st.research_reveal;

  // Presenter's own pending change, shown immediately until the server echoes it back.
  const [pending, setPending] = useState(null); // { docId, page }
  useEffect(() => {
    if (pending && sharedDoc && pending.docId === sharedDoc.id && pending.page === sharedPage) setPending(null);
  }, [sharedDoc && sharedDoc.id, sharedPage]);

  const view0 = local || pending;
  const doc = view0 ? docs.find((d) => d.id === view0.docId) || sharedDoc : sharedDoc;
  const page = view0 ? view0.page : sharedPage;

  useEffect(() => {
    let alive = true;
    setUrl(null); setPages(null);
    if (doc) backend.researchFileUrl(doc).then((u) => alive && setUrl(u));
    return () => { alive = false; };
  }, [doc && doc.id]);

  const go = (p, d = doc) => {
    p = Math.min(Math.max(1, p), d.id === doc.id && pages ? pages : 1e4);
    if (canPresent) { setPending({ docId: d.id, page: p }); backend.setStepState(w.id, { research_doc: d.id, research_page: p }); }
    else setLocal({ docId: d.id, page: p });
  };

  useEffect(() => {
    const on = (e) => {
      if (view !== 'slides' || !doc || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') go(page + 1);
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(page - 1);
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  });

  const showWall = revealed || isOrganizer;
  return html`
    <div class="research">
      <div class="research-main">
        <div class="row between stage-head">
          <div class="seg">
            <button class=${cx(view === 'slides' && 'on')} onClick=${() => setView('slides')}>Slides</button>
            <button class=${cx(view === 'wall' && 'on')} disabled=${!showWall} title=${showWall ? '' : 'The organizer reveals the wall after the share out'} onClick=${() => setView('wall')}>
              Sticky wall ${showWall ? `(${data.stickies.filter((s) => s.step === 'research').length})` : '🔒'}
            </button>
          </div>
          ${isOrganizer && html`
            <label class="toggle"><input type="checkbox" checked=${revealed} onChange=${(e) => backend.setStepState(w.id, { research_reveal: e.target.checked })} /> Reveal sticky wall to everyone</label>`}
        </div>
        ${view === 'slides' ? (doc ? html`
          <div class="slides">
            <${PdfSlide} url=${url} page=${page} onPageCount=${setPages} />
            <div class="slide-bar">
              ${docs.length > 1 && html`<select value=${doc.id} onChange=${(e) => go(1, docs.find((d) => d.id === e.target.value))}>
                ${docs.map((d) => html`<option key=${d.id} value=${d.id}>${d.title}</option>`)}</select>`}
              <button class="btn btn-sm" disabled=${page <= 1} onClick=${() => go(page - 1)}>←</button>
              <span class="small">Slide ${page}${pages ? ' / ' + pages : ''}</span>
              <button class="btn btn-sm" disabled=${!!pages && page >= pages} onClick=${() => go(page + 1)}>→</button>
              ${canPresent ? html`<span class="pill pill-live">You're presenting</span>`
                : local ? html`<button class="btn btn-sm btn-primary" onClick=${() => setLocal(null)}>Back to presenter</button>`
                : html`<span class="muted small">Following the presenter</span>`}
            </div>
          </div>`
          : html`<${Empty} title=${canPresent ? 'Upload the research deck to start' : 'Waiting for the research deck'}>${canPresent ? 'Use "Manage research decks" in the left panel.' : 'The researcher will share their slides here.'}<//>`)
        : html`<${StickyWall} stickies=${data.stickies.filter((s) => s.step === 'research')} members=${data.members} />`}
      </div>
      <${CapturePanel} w=${w} data=${data} me=${me} isOrganizer=${isOrganizer} />
    </div>`;
}

function CapturePanel({ w, data, me, isOrganizer }) {
  const [kind, setKind] = useState('pain');
  const [text, setText] = useState('');
  const authors = useAuthors(data.members);
  const mine = me ? data.stickies.filter((s) => s.step === 'research' && s.member_id === me.id).reverse() : [];
  const all = data.stickies.filter((s) => s.step === 'research');
  const contributors = new Set(all.map((s) => s.member_id)).size;

  return html`
    <aside class="capture">
      <h3>Capture as you listen</h3>
      <p class="muted small">Silently note pain points, opportunities and observations. One idea per sticky. Your stickies stay private until the organizer reveals the wall.</p>
      ${isOrganizer && html`<p class="notice small"><b>${all.length}</b> stickies from <b>${contributors}</b> ${contributors === 1 ? 'person' : 'people'} so far.</p>`}
      ${isOrganizer && data.members.some((m) => m.is_synthetic) && html`
        <${AiButton} label="Add AI participants' stickies" title="Each synthetic participant writes stickies from the research deck"
          run=${async () => `Added ${await synthResearch(w)} stickies.`} />`}
      ${me && html`
        <div class="kind-chips">
          ${Object.entries(STICKY_KINDS).map(([k, v]) => html`<button key=${k} class=${cx('chip', kind === k && 'on')} onClick=${() => setKind(k)}>${v.label}</button>`)}
        </div>
        <${Composer} placeholder=${kind === 'question' ? 'A question to ask at the end…' : 'What did you notice?'} value=${text} setValue=${setText}
          onAdd=${(t) => backend.addSticky({ workshop_id: w.id, member_id: me.id, step: 'research', kind, text: t })} />
        <div class="my-stickies">
          <h4>Your stickies (${mine.length})</h4>
          ${mine.map((s) => html`<${Sticky} key=${s.id} s=${s} author=${authors[s.member_id]} mine small onDelete=${() => backend.deleteSticky(s.id)} />`)}
        </div>`}
    </aside>`;
}

function StickyWall({ stickies, members }) {
  const authors = useAuthors(members);
  const groups = Object.entries(STICKY_KINDS).map(([k, v]) => [k, v, stickies.filter((s) => s.kind === k)]);
  if (!stickies.length) return html`<${Empty} title="No stickies yet" />`;
  return html`
    <div class="wall">
      ${groups.map(([k, v, list]) => html`
        <section key=${k} class="wall-col">
          <h4>${v.label} <span class="muted">${list.length}</span></h4>
          ${list.map((s) => html`<${Sticky} key=${s.id} s=${s} author=${authors[s.member_id]} small />`)}
        </section>`)}
    </div>`;
}

// ── Step 3: How Might We ──
export function HmwStage({ w, data, me, isOrganizer }) {
  const [text, setText] = useState('');
  const [source, setSource] = useState(null); // research sticky this HMW is based on
  const authors = useAuthors(data.members);
  const revealed = !!(w.step_state || {}).hmw_reveal;
  const myResearch = me ? data.stickies.filter((s) => s.step === 'research' && s.member_id === me.id) : [];
  const hmws = data.stickies.filter((s) => s.kind === 'hmw');
  const mine = me ? hmws.filter((s) => s.member_id === me.id) : [];
  const showAll = revealed || isOrganizer;
  const byPerson = data.members.map((m) => [m, hmws.filter((s) => s.member_id === m.id)]).filter(([, l]) => l.length);

  const add = (t) => {

    const data = source ? { source_id: source.id } : {};
    setSource(null);
    return backend.addSticky({ workshop_id: w.id, member_id: me.id, step: 'hmw', kind: 'hmw', text: hmwText(t), data });
  };

  return html`
    <div class="hmw">
      ${me && html`
        <aside class="hmw-ref">
          <h3>Your research notes</h3>
          <p class="muted small">Turn each insight into an opportunity. Click ↳ to start an HMW from a note.</p>
          ${myResearch.length ? myResearch.map((s) => html`
            <${Sticky} key=${s.id} s=${s} author=${authors[s.member_id]} small>
              <button class="sticky-x" title="Start an HMW from this note" onClick=${() => { setSource(s); document.querySelector('.hmw .composer textarea')?.focus(); }}>↳</button>
            <//>`) : html`<p class="muted small">You didn't capture notes during the share out.</p>`}
        </aside>`}
      <div class="hmw-main">
        ${me && html`
          <section class="card">
            <h3>Write your How Might We statements</h3>
            <p class="muted small">Frame each one as an opportunity: broad enough for many solutions, narrow enough to act on. One per sticky.</p>
            ${source && html`<div class="source-quote"><span class="muted small">Based on your note:</span> “${source.text}” <button class="sticky-x" aria-label="Clear" onClick=${() => setSource(null)}>✕</button></div>`}
            <${Composer} prefix="How might we…" placeholder="help reviewers see close status at a glance?" value=${text} setValue=${setText} onAdd=${add} />
          </section>
          <h4>Your HMWs (${mine.length})</h4>
          <div class="sticky-grid">
            ${mine.map((s) => html`<${Sticky} key=${s.id} s=${s} author=${authors[s.member_id]} mine onDelete=${() => backend.deleteSticky(s.id)} />`)}
          </div>`}
        <div class="row between stage-head">
          <h3>Everyone's HMWs ${showAll ? `(${hmws.length})` : ''}</h3>
          ${isOrganizer && html`<div class="row">
            ${data.members.some((m) => m.is_synthetic) && html`<${AiButton} label="Add AI participants' HMWs" run=${async () => `Added ${await synthHmw(w)} HMWs.`} />`}
            <label class="toggle"><input type="checkbox" checked=${revealed} onChange=${(e) => backend.setStepState(w.id, { hmw_reveal: e.target.checked })} /> Reveal to everyone</label>
          </div>`}
        </div>
        ${showAll
          ? byPerson.length ? html`<div class="hmw-board">${byPerson.map(([m, list]) => html`
              <section key=${m.id} class="hmw-col"><div class="row"><${Avatar} name=${m.name} color=${m.color} size=${24} /><b class="small">${m.name}</b><span class="muted small">${list.length}</span></div>
                ${list.map((s) => html`<${Sticky} key=${s.id} s=${s} author=${m} small />`)}</section>`)}</div>`
            : html`<${Empty} title="No HMWs yet" />`
          : html`<p class="muted">The organizer will reveal everyone's HMWs when time is up.</p>`}
      </div>
    </div>`;
}

// ── Later-phase steps ──
export function ComingSoonStage({ step }) {
  return html`
    <div class="coming">
      <span class="pill pill-soon">Coming in phase ${step.phase}</span>
      <h1>${step.title}</h1>
      <p class="lead">${step.blurb}</p>
      <p class="muted">This step's interactive board isn't built yet. The organizer can still run it here as a timed step.</p>
    </div>`;
}
