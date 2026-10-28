// Workshop summary: one printable page with everything the workshop produced.
import { html, useMemo, fmtDate, DISCIPLINES, ROLES } from '../lib.js';
import { useWorkshop } from '../useWorkshop.js';
import { Avatar, Empty } from './ui.js';
import { tallyItems, QUADRANTS, quadrantOf } from '../ai.js';
import { useSketchUrls, SolutionCard } from './stages3.js';
import { latestFlow, prototypes, chosenSheet, PrototypeViewer } from './stages4.js';
import { useState } from '../lib.js';

export function SummaryView({ wsId, user }) {
  const data = useWorkshop(wsId, user);
  const { workshop: w, me, isOrganizer } = data;
  const authors = useMemo(() => Object.fromEntries(data.members.map((m) => [m.id, m])), [data.members]);
  const st = (w && w.step_state) || {};
  const hmws = data.stickies.filter((s) => s.kind === 'hmw');
  const finalHmw = hmws.find((s) => s.id === st.hmw_final?.sticky_id);
  const topHmws = tallyItems(hmws, data.votes.filter((v) => v.round === 'hmw'), data.members).filter((r) => r.dots > 0).slice(0, 5);
  const crazyCells = data.sheets.filter((x) => x.kind === 'crazy8').flatMap((x) => x.cells.map((c) => ({ ...c, member_id: x.member_id }))).filter((c) => c.file_path);
  const topSketches = tallyItems(crazyCells, data.votes.filter((v) => v.round === 'crazy8'), data.members).filter((r) => r.dots > 0).slice(0, 6);
  const solutions = data.sheets.filter((x) => x.kind === 'solution');
  const solRound = st.solution_round === 2 ? 'solution2' : 'solution';
  const solRanked = tallyItems(solutions, data.votes.filter((v) => v.round === solRound), data.members);
  const chosen = w ? chosenSheet(w, data) : null;
  const flow = latestFlow(data);
  const protos = prototypes(data);
  const [version, setVersion] = useState(null);
  const feedback = data.stickies.filter((s) => s.step === 'design_review' && s.kind === 'feedback');
  const urls = useSketchUrls([...topSketches.map((r) => r.item.file_path), ...solutions.flatMap((x) => x.cells.map((c) => c.file_path))]);

  if (data.loading) return html`<main class="page"><p class="muted">Loading…</p></main>`;
  if (!w || (!me && !isOrganizer)) return html`<main class="page"><${Empty} title="You don't have access to this workshop" /></main>`;

  return html`
    <main class="page summary">
      <div class="row between no-print">
        <a class="back" href=${'#/w/' + w.id}>← Back to the room</a>
        <button class="btn" onClick=${() => window.print()}>Print / save as PDF</button>
      </div>
      <header class="summary-head">
        <span class="eyebrow">Workshop summary${w.status === 'done' ? ' · Completed' : ''}</span>
        <h1>${w.title}</h1>
        <p class="muted">${[w.project, fmtDate(w.starts_at)].filter(Boolean).join(' · ')}</p>
        ${w.description && html`<p class="lead">${w.description}</p>`}
      </header>

      <section><h2>People</h2>
        <div class="people-grid">${data.members.map((m) => html`<div key=${m.id} class="person"><${Avatar} name=${m.name} color=${m.color} size=${32} />
          <div><b>${m.name}</b>${m.is_synthetic ? ' (AI)' : ''}<div class="muted small">${m.role === 'participant' ? DISCIPLINES[m.discipline] : ROLES[m.role]}${m.is_decider ? ' · Decider' : ''}</div></div></div>`)}</div>
      </section>

      <section><h2>The problem we chose</h2>
        ${finalHmw ? html`<div class="final-hmw"><h3>${finalHmw.text}</h3>${st.hmw_final?.rationale && html`<p>${st.hmw_final.rationale}</p>`}</div>` : html`<p class="muted">No HMW was chosen.</p>`}
        ${topHmws.length > 0 && html`<h4>Top-voted HMWs</h4><ol>${topHmws.map((r) => html`<li key=${r.item.id}>${r.item.text} <span class="muted small">· ${r.score} · ${QUADRANTS[quadrantOf(r.item.data?.grid)]?.label || 'Unplaced'} · ${authors[r.item.member_id]?.name}</span></li>`)}</ol>`}
        <p class="muted small">${data.stickies.filter((s) => s.step === 'research').length} research stickies · ${hmws.length} HMWs</p>
      </section>

      ${topSketches.length > 0 && html`<section><h2>Strongest Crazy 8s</h2>
        <div class="summary-sketches">${topSketches.map((r) => html`<figure key=${r.item.id}><img src=${urls[r.item.file_path]} alt="" /><figcaption class="small"><b>${r.item.caption}</b> · ${authors[r.item.member_id]?.name} · ${r.score} votes</figcaption></figure>`)}</div>
      </section>`}

      <section><h2>The direction we chose</h2>
        ${chosen ? html`<${SolutionCard} x=${chosen} authors=${authors} urls=${urls} data=${data} onOpen=${() => {}}>
          ${st.solution_final?.rationale && html`<p class="small"><b>Why:</b> ${st.solution_final.rationale}</p>`}<//>` : html`<p class="muted">No direction was chosen.</p>`}
        ${solRanked.length > 1 && html`<h4>All solution sketches</h4><ul>${solRanked.map((r) => html`<li key=${r.item.id}>${r.item.title || 'Untitled'} <span class="muted small">· ${authors[r.item.member_id]?.name} · ${r.score} votes</span></li>`)}</ul>`}
      </section>

      ${flow && html`<section><h2>${flow.data.title}</h2>
        <ol class="summary-flow">${flow.data.steps.map((s) => html`<li key=${s.id}><b>${s.actor}:</b> ${s.title}${s.screen ? html` <span class="muted">(${s.screen})</span>` : ''}${s.detail && html`<div class="small muted">${s.detail}</div>`}</li>`)}</ol>
        <div class="form-grid">
          <div><h4>Implementation details</h4><ul>${(flow.data.details || []).map((d) => html`<li key=${d.id}>${d.text}</li>`)}</ul></div>
          <div><h4>Open questions</h4><ul>${(flow.data.questions || []).map((q) => html`<li key=${q.id}>${q.text}</li>`)}</ul></div>
        </div>
      </section>`}

      ${protos.length > 0 && html`<section><h2>Prototype</h2>
        <div class="no-print"><${PrototypeViewer} w=${w} data=${data} version=${version || protos[0].version} setVersion=${setVersion} /></div>
        <p class="print-only small">${protos.length} prototype version(s). Open the workshop to view them.</p>
      </section>`}

      ${feedback.length > 0 && html`<section><h2>Design review feedback</h2>
        ${[['works', 'What works'], ['change', 'Change'], ['question', 'Questions']].map(([k, label]) => { const items = feedback.filter((f) => (f.data?.kind || 'change') === k); return items.length > 0 && html`
          <div key=${k}><h4>${label}</h4><ul>${items.map((f) => html`<li key=${f.id}>${f.text} <span class="muted small">· ${authors[f.member_id]?.name} · v${f.data?.version}</span></li>`)}</ul></div>`; })}
      </section>`}
    </main>`;
}
