// Phase 2 stages: Impact/Effort grid and HMW dot voting with the Decider.
import { html, useState, useEffect, useRef, useMemo, cx, DECIDER_PURPLE } from '../lib.js';
import { backend } from '../backend/index.js';
import { Avatar, Empty, AiButton } from './ui.js';
import { QUADRANTS, quadrantOf, placeGrid, tally, synthVotes, aiDecide, DECIDER_WEIGHT } from '../ai.js';

const QUAD_ORDER = ['quick', 'big', 'fill', 'pit'];
const clampPct = (n) => Math.max(0, Math.min(100, n));

function useAuthors(members) {
  return useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members]);
}

// ── Step 4: Impact / Effort grid ──
export function GridStage({ w, data, isOrganizer }) {
  const authors = useAuthors(data.members);
  const hmws = data.stickies.filter((s) => s.kind === 'hmw');
  const placed = hmws.filter((s) => s.data && s.data.grid);
  const pile = hmws.filter((s) => !(s.data && s.data.grid));
  const [selected, setSelected] = useState(null);
  const [drag, setDragState] = useState(null); // { id, sx, sy, x, y, moved }
  const dragRef = useRef(null);
  const setDrag = (fn) => { dragRef.current = typeof fn === 'function' ? fn(dragRef.current) : fn; setDragState(dragRef.current); };
  const board = useRef(null);
  const pileRef = useRef(null);
  const sel = hmws.find((s) => s.id === selected);

  // Organizer drags stickies between the pile and the board.
  useEffect(() => {
    if (!drag) return;
    const move = (e) => setDrag((d) => d && { ...d, x: e.clientX, y: e.clientY, moved: d.moved || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4 });
    const up = async (e) => {
      const d = dragRef.current;
      setDrag(null);
      const s = hmws.find((x) => x.id === d.id);
      if (!s) return;
      if (!d.moved) { setSelected(s.id); return; }
      const r = board.current.getBoundingClientRect();
      const p = pileRef.current && pileRef.current.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        const x = Math.round(clampPct(((e.clientX - r.left) / r.width) * 100));
        const y = Math.round(clampPct(100 - ((e.clientY - r.top) / r.height) * 100));
        const prev = (s.data && s.data.grid) || {};
        await backend.updateSticky(s.id, { data: { ...s.data, grid: { ...prev, x, y, ai: false } } });
        setSelected(s.id);
      } else if (p && e.clientX >= p.left && e.clientX <= p.right && e.clientY >= p.top && e.clientY <= p.bottom) {
        const { grid, ...rest } = s.data || {};
        await backend.updateSticky(s.id, { data: rest });
      }
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up, { once: true });
    return () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
  }, [drag && drag.id]);

  const startDrag = (s) => (e) => {
    if (!isOrganizer) { setSelected(s.id); return; }
    e.preventDefault();
    setDrag({ id: s.id, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false });
  };

  const chip = (s, style) => html`
    <button key=${s.id} class=${cx('grid-chip', selected === s.id && 'on', drag && drag.id === s.id && drag.moved && 'ghosted')}
      style=${{ background: authors[s.member_id]?.color, ...style }} onPointerDown=${startDrag(s)} title=${s.text}>
      ${s.text.replace(/^How might we\s*/i, '')}
      ${s.data?.grid?.ai && html`<span class="chip-ai" title="Placed by AI">✨</span>`}
    </button>`;

  return html`
    <div class="grid-stage">
      <aside class="grid-side">
        <div class="pile" ref=${pileRef}>
          <h4>Unsorted <span class="muted">${pile.length}</span></h4>
          ${pile.length ? pile.map((s) => chip(s)) : html`<p class="muted small">${hmws.length ? 'Every HMW is on the grid.' : 'No HMWs yet. Write them in the How Might We step.'}</p>`}
        </div>
        ${isOrganizer && html`
          <div class="stack grid-tools">
            <${AiButton} label=${pile.length === hmws.length ? 'Place all with AI' : `Place ${pile.length} unsorted with AI`} disabled=${!pile.length}
              title="AI scores each HMW's impact and effort using the workshop context and research deck"
              run=${async () => `Placed ${await placeGrid(w, pile)} HMWs.`} />
            <p class="muted small">Drag stickies to adjust. Drag one back here to unsort it.</p>
            ${placed.length > 0 && html`<button class="btn btn-sm btn-ghost" onClick=${async () => {
              if (!confirm('Move every HMW back to Unsorted?')) return;
              for (const s of placed) { const { grid, ...rest } = s.data; await backend.updateSticky(s.id, { data: rest }); }
            }}>Reset grid</button>`}
          </div>`}
        ${sel && html`
          <div class="card grid-detail">
            <div class="row"><${Avatar} name=${authors[sel.member_id]?.name} color=${authors[sel.member_id]?.color} size=${22} /><b class="small">${authors[sel.member_id]?.name}</b></div>
            <p>${sel.text}</p>
            ${sel.data?.grid ? html`
              <p class="small"><span class="pill">${QUADRANTS[quadrantOf(sel.data.grid)].label}</span> Impact <b>${sel.data.grid.y}</b> · Effort <b>${sel.data.grid.x}</b></p>
              ${sel.data.grid.ai === false && html`<p class="muted small">Moved by the organizer.</p>`}
              ${sel.data.grid.rationale && html`<p class="muted small">✨ ${sel.data.grid.ai === false ? "AI's original reasoning: " : ''}${sel.data.grid.rationale}</p>`}`
            : html`<p class="muted small">Not placed yet.</p>`}
          </div>`}
      </aside>
      <div class="grid-main">
        <div class="axis-y">Impact →</div>
        <div class="board" ref=${board}>
          ${QUAD_ORDER.map((q) => html`<div key=${q} class=${'quad quad-' + q}><b>${QUADRANTS[q].label}</b><span>${QUADRANTS[q].hint}</span></div>`)}
          ${placed.map((s) => chip(s, { position: 'absolute', left: Math.min(92, Math.max(8, s.data.grid.x)) + '%', top: Math.min(94, Math.max(6, 100 - s.data.grid.y)) + '%' }))}
        </div>
        <div class="axis-x">Effort →</div>
      </div>
      ${drag && drag.moved && html`<div class="grid-chip drag-ghost" style=${{ left: drag.x, top: drag.y, background: authors[hmws.find((s) => s.id === drag.id)?.member_id]?.color }}>
        ${(hmws.find((s) => s.id === drag.id)?.text || '').replace(/^How might we\s*/i, '')}</div>`}
    </div>`;
}

// ── Step 5: Vote on HMWs ──
export function VoteHmwStage({ w, data, me, isOrganizer }) {
  const st = w.step_state || {};
  const authors = useAuthors(data.members);
  const dots = st.vote_dots || 3;
  const revealed = !!st.vote_reveal;
  const final = st.hmw_final;
  const decider = data.members.find((m) => m.is_decider);
  const canVote = me && me.role !== 'organizer';
  const isDecider = me && me.is_decider;
  const votes = data.votes.filter((v) => v.round === 'hmw');
  const mine = me ? votes.filter((v) => v.member_id === me.id) : [];
  const left = dots - mine.length;
  const showAll = revealed || isOrganizer;

  const hmws = data.stickies.filter((s) => s.kind === 'hmw');
  const ordered = hmws.slice().sort((a, b) => {
    const qa = QUAD_ORDER.indexOf(quadrantOf(a.data?.grid)), qb = QUAD_ORDER.indexOf(quadrantOf(b.data?.grid));
    return (qa < 0 ? 9 : qa) - (qb < 0 ? 9 : qb) || (b.data?.grid?.y || 0) - (a.data?.grid?.y || 0);
  });
  const ranked = tally(hmws, votes, data.members);
  const finalSticky = final && hmws.find((s) => s.id === final.sticky_id);

  const addDot = (s) => left > 0 && backend.addVotes([{ workshop_id: w.id, member_id: me.id, target_id: s.id, round: 'hmw' }]);
  const dotColor = (v) => (authors[v.member_id]?.is_decider ? DECIDER_PURPLE : '#141414');
  const choose = (s, by) => backend.setDecision(w.id, 'hmw_final', { sticky_id: s.id, by, rationale: '' });

  return html`
    <div class="vote">
      ${finalSticky && html`
        <section class="final-hmw">
          <span class="eyebrow">The HMW we carry forward</span>
          <h2>${finalSticky.text}</h2>
          ${final.rationale && html`<p>${final.rationale}</p>`}
          <p class="muted small">Decided by ${final.by === 'ai' ? `${decider?.name || 'the AI Decider'} (AI Decider)` : final.by === 'decider' ? decider?.name || 'the Decider' : 'the organizer'}.
            ${isOrganizer && html` <a href="#" onClick=${(e) => { e.preventDefault(); backend.setDecision(w.id, 'hmw_final', null); }}>Undo</a>`}</p>
        </section>`}

      <div class="row between stage-head">
        <div>
          <h3>Dot vote on the most important problem or opportunity</h3>
          <p class="muted small">
            ${canVote ? html`You have <b>${left}</b> of ${dots} dots left. Click a card to add a dot; click your dot to take it back. Several dots on one HMW is fine.` : 'Participants are voting.'}
            ${isDecider ? html` <b style=${{ color: DECIDER_PURPLE }}>You're the Decider: your dots are purple and count ${DECIDER_WEIGHT}×.</b>` : decider ? html` Purple dots are ${decider.name}'s (the Decider), counting ${DECIDER_WEIGHT}×.` : ''}
          </p>
        </div>
        ${isOrganizer && html`
          <div class="row">
            <label class="minutes">Dots each <input type="number" min="1" max="10" value=${dots} onChange=${(e) => backend.setStepState(w.id, { vote_dots: Number(e.target.value) })} /></label>
            ${data.members.some((m) => m.is_synthetic) && html`<${AiButton} label="Cast AI participants' votes" disabled=${!hmws.length}
              run=${async () => { const b = await synthVotes(w, hmws, data.members, dots); return `${b.length} AI ballots cast.`; }} />`}
            <label class="toggle"><input type="checkbox" checked=${revealed} onChange=${(e) => backend.setStepState(w.id, { vote_reveal: e.target.checked })} /> Reveal votes</label>
            <button class="btn btn-sm btn-ghost" disabled=${!votes.length} onClick=${() => confirm('Clear every vote in this round?') && backend.deleteVotes(w.id, 'hmw')}>Clear votes</button>
          </div>`}
      </div>

      ${!hmws.length ? html`<${Empty} title="No HMWs to vote on yet" />` : html`
        <div class="vote-layout">
          <div class="vote-cards">
            ${ordered.map((s) => {
              const myDots = mine.filter((v) => v.target_id === s.id);
              const allDots = votes.filter((v) => v.target_id === s.id);
              const q = quadrantOf(s.data?.grid);
              return html`
                <article key=${s.id} class=${cx('vote-card', canVote && left > 0 && 'can-vote', finalSticky && finalSticky.id === s.id && 'is-final')}
                  style=${{ borderLeftColor: authors[s.member_id]?.color }} onClick=${() => canVote && addDot(s)}>
                  <div class="row between">${q ? html`<span class=${'pill quad-pill-' + q}>${QUADRANTS[q].label}</span>` : html`<span class="pill">Unplaced</span>`}<span class="muted small">${authors[s.member_id]?.name}</span></div>
                  <p>${s.text}</p>
                  <div class="dots" onClick=${(e) => e.stopPropagation()}>
                    ${(showAll ? allDots : myDots).map((v) => html`
                      <button key=${v.id} class="dot" style=${{ background: dotColor(v) }} title=${authors[v.member_id]?.name + (v.member_id === me?.id ? ' (click to remove)' : '')}
                        onClick=${() => v.member_id === me?.id && backend.deleteVote(v.id)}></button>`)}
                    ${showAll && allDots.length > 0 && html`<span class="small muted">${allDots.length} dot${allDots.length > 1 ? 's' : ''}</span>`}
                  </div>
                </article>`;
            })}
          </div>
          ${showAll && html`
            <aside class="card results">
              <h3>Results ${!revealed && html`<span class="muted small">(only you can see these until you reveal)</span>`}</h3>
              <ol class="ranking">
                ${ranked.filter((r) => r.dots > 0).slice(0, 5).map((r, i) => html`
                  <li key=${r.sticky.id}>
                    <div class="row between"><b class="small">${i + 1}. ${r.sticky.text.replace(/^How might we\s*/i, 'HMW ')}</b><span class="small">${r.score}</span></div>
                    <div class="bar"><span style=${{ width: (r.score / Math.max(1, ranked[0].score)) * 100 + '%' }}></span></div>
                    ${r.deciderDots > 0 && html`<span class="small" style=${{ color: DECIDER_PURPLE }}>Decider: ${r.deciderDots} dot${r.deciderDots > 1 ? 's' : ''}</span>`}
                    ${!finalSticky && ((isDecider && revealed) || isOrganizer) && html`
                      <button class="btn btn-sm" onClick=${() => choose(r.sticky, isDecider ? 'decider' : 'organizer')}>Choose this HMW</button>`}
                  </li>`)}
              </ol>
              ${!ranked.some((r) => r.dots > 0) && html`<p class="muted small">No votes yet.</p>`}
              ${!finalSticky && isOrganizer && decider?.is_synthetic && ranked.some((r) => r.dots > 0) && html`
                <${AiButton} label=${`Ask ${decider.name} (AI Decider) to decide`} run=${async () => { await aiDecide(w, ranked); return 'Decision made.'; }} />`}
              ${!finalSticky && isOrganizer && !decider && html`<p class="muted small">No Decider is set, so you make the final call.</p>`}
              ${!finalSticky && isOrganizer && decider && !decider.is_synthetic && html`<p class="muted small">${decider.name} (the Decider) makes the final call after you reveal the votes. You can also choose to override.</p>`}
            </aside>`}
        </div>`}
    </div>`;
}
