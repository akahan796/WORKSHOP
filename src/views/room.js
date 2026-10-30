// Live workshop room. Everyone's screen follows workshops.current_step; the
// organizer drives steps and the timer from the control bar.
import { html, useState, useEffect, cx, DISCIPLINES, ROLES, navigate } from '../lib.js';
import { backend } from '../backend/index.js';
import { activeSteps } from '../steps.js';
import { useWorkshop } from '../useWorkshop.js';
import { Header, Avatar, Empty, Modal } from './ui.js';
import { ResearchManager } from './research.js';
import { PreworkPanel } from './prework.js';
import { CoverStage, IntroStage, ResearchStage, HmwStage, ComingSoonStage } from './stages.js';
import { GridStage, VoteHmwStage } from './stages2.js';
import { Crazy8Stage, Share8Stage, SolutionStage, ReviewStage, VoteSolutionStage } from './stages3.js';
import { FlowStage, PrototypeStage, DesignReviewStage, ReleasedStage } from './stages4.js';
import { isSimulated } from '../ai.js';

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function Timer({ w, step, isOrganizer }) {
  const now = useNow(250);
  const paused = w.step_state.timer_paused_ms;
  const running = !!w.timer_ends_at;
  const left = running ? new Date(w.timer_ends_at).getTime() - now : paused != null ? paused : step.minutes * 60000;
  const set = (patch, statePatch) => Promise.all([
    backend.updateWorkshop(w.id, patch),
    statePatch && backend.setStepState(w.id, statePatch),
  ]);
  const start = () => set({ timer_ends_at: new Date(Date.now() + left).toISOString() }, { timer_paused_ms: null });
  const pause = () => set({ timer_ends_at: null }, { timer_paused_ms: left });
  const reset = () => set({ timer_ends_at: null }, { timer_paused_ms: null });
  const add = () => running
    ? set({ timer_ends_at: new Date(new Date(w.timer_ends_at).getTime() + 60000).toISOString() })
    : set({}, { timer_paused_ms: left + 60000 });

  return html`
    <div class=${cx('timer', running && 'timer-on', running && left <= 0 && 'timer-up', running && left > 0 && left < 60000 && 'timer-low')}>
      <span class="timer-clock" aria-live="polite">${running && left <= 0 ? "Time's up" : mmss(left)}</span>
      ${isOrganizer && html`
        <span class="timer-ctl">
          ${running ? html`<button class="icon-btn" title="Pause" onClick=${pause}>❚❚</button>` : html`<button class="icon-btn" title="Start timer" onClick=${start}>▶</button>`}
          <button class="icon-btn" title="Add 1 minute" onClick=${add}>+1</button>
          <button class="icon-btn" title="Reset" onClick=${reset}>↺</button>
        </span>`}
    </div>`;
}

export function RoomView({ wsId, user }) {
  const data = useWorkshop(wsId, user);
  const [showResearch, setShowResearch] = useState(false);
  const [showPrework, setShowPrework] = useState(false);
  // Agenda sidebar: collapsed by default for participants, open for facilitators;
  // each viewer's own choice is remembered in this browser.
  const [railPref, setRailPref] = useState(() => { try { return localStorage.getItem('wai_rail_' + user.id); } catch { return null; } });
  const { workshop: w, me, isOrganizer } = data;

  if (data.loading) return html`<${Header} user=${user} /><main class="page"><p class="muted">Loading…</p></main>`;
  if (!w || (!me && !isOrganizer)) return html`<${Header} user=${user} /><main class="page"><${Empty} title="You don't have access to this workshop">Use the invite link from your email.<//></main>`;

  const steps = activeSteps(w);
  // The cover comes first: always while the workshop is in draft, and whenever the
  // facilitator goes back to it. It isn't an agenda step.
  const onCover = w.status === 'draft' || w.current_step === 'cover';
  const idx = onCover ? -1 : Math.max(0, steps.findIndex((s) => s.key === w.current_step));
  const step = steps[idx] || steps[0];
  const isResearcher = me && me.role === 'participant' && me.discipline === 'researcher';

  async function goTo(i) {
    if (!isOrganizer) return;
    if (i === -1) return backend.updateWorkshop(w.id, { current_step: 'cover', timer_ends_at: null });
    const s = steps[i];
    if (!s) return;
    await backend.updateWorkshop(w.id, { current_step: s.key, timer_ends_at: null, status: w.status === 'draft' ? 'live' : w.status });
    await backend.setStepState(w.id, { timer_paused_ms: null });
  }

  const railCollapsed = railPref ? railPref === 'collapsed' : !isOrganizer;
  const setRail = (collapsed) => { const v = collapsed ? 'collapsed' : 'open'; setRailPref(v); try { localStorage.setItem('wai_rail_' + user.id, v); } catch {} };
  const props = { w, data, me, user, step, isOrganizer, isResearcher };
  const Stage = { intro: IntroStage, research: ResearchStage, hmw: HmwStage, grid: GridStage, vote_hmw: VoteHmwStage,
    crazy8: Crazy8Stage, share8: Share8Stage, solution: SolutionStage, review: ReviewStage, vote_solution: VoteSolutionStage,
    flow: FlowStage, prototype: PrototypeStage, design_review: DesignReviewStage }[step.key] || ComingSoonStage;
  // Participants released after the flow step see a thank-you screen from then on.
  const flowIdx = steps.findIndex((s) => s.key === 'flow');
  const released = me && ((w.step_state || {}).released || []).includes(me.id) && flowIdx >= 0 && idx > flowIdx;
  // Documents requested from this person that they haven't uploaded yet.
  const todo = me ? data.prework.filter((d) => d.requested_from === me.id && !d.file_path) : [];
  const StageToShow = onCover ? CoverStage : released ? ReleasedStage : Stage;

  return html`
    <div class="room">
      <${Header} user=${user} menu=${[
        isOrganizer && { label: 'Workshop setup', onClick: () => navigate(`/w/${w.id}/setup`) },
        (isOrganizer || isResearcher) && { label: 'Manage research decks', onClick: () => setShowResearch(true) },
        data.prework.length > 0 && { label: 'Pre-work documents', onClick: () => setShowPrework(true) },
        { label: 'Workshop summary', onClick: () => navigate(`/w/${w.id}/summary`) },
      ]}>
        <div class="room-title">
          <b>${w.title}</b>
          <span class="muted">${onCover ? 'Cover' : `Step ${idx + 1} of ${steps.length} · ${step.title}`}</span>
        </div>
        ${isOrganizer && isSimulated(w) && backend.mode !== 'demo' && html`<span class="pill pill-ai" title="AI results come from the built-in stand-in (Setup → Details → AI mode)">Simulated AI</span>`}
        ${!onCover && html`<${Timer} w=${w} step=${step} isOrganizer=${isOrganizer} />`}
      <//>
      ${todo.length > 0 && html`<div class="banner banner-prework">
        <span>You're asked to upload ${todo.length === 1 ? `"${todo[0].title}"` : `${todo.length} documents`} before the workshop.</span>
        <button class="btn btn-sm btn-primary" onClick=${() => setShowPrework(true)}>Upload now</button></div>`}
      ${w.status === 'draft' && html`<div class="banner">${isOrganizer ? 'Everyone sees the cover while they join. Click Start workshop when everyone is here.' : "The workshop hasn't started yet. Hang tight: this page updates automatically."}</div>`}
      <div class="room-body">
        ${railCollapsed ? html`
        <aside class="rail rail-mini" aria-label="Agenda">
          <button class="icon-btn rail-toggle" title="Show agenda and people" aria-expanded="false" onClick=${() => setRail(false)}>»</button>
          <ol class="rail-mini-steps">
            <li><button class=${cx('step-num', onCover && 'on', !onCover && 'done')} title="Cover" disabled=${!isOrganizer || w.status === 'draft'} onClick=${() => goTo(-1)}>◆</button></li>
            ${steps.map((s, i) => html`<li key=${s.key}><button class=${cx('step-num', i === idx && 'on', i < idx && 'done')} title=${`${i + 1}. ${s.title}`} disabled=${!isOrganizer} onClick=${() => goTo(i)}>${i < idx ? '✓' : i + 1}</button></li>`)}
          </ol>
          <span class="rail-mini-people muted small" title="People here">${data.members.filter((m) => m.joined_at).length}/${data.members.length}</span>
        </aside>` : html`
        <aside class="rail">
          <div class="rail-head"><h4>Agenda</h4><button class="icon-btn rail-toggle" title="Hide sidebar" aria-expanded="true" onClick=${() => setRail(true)}>«</button></div>
          <ol class="rail-steps">
            <li><button class=${cx('rail-step', onCover && 'on', !onCover && 'done')} disabled=${!isOrganizer || w.status === 'draft'} onClick=${() => goTo(-1)}>
              <span class="step-num">◆</span><span class="grow">Cover</span></button></li>
            ${steps.map((s, i) => html`
              <li key=${s.key}>
                <button class=${cx('rail-step', i === idx && 'on', i < idx && 'done')} disabled=${!isOrganizer} onClick=${() => goTo(i)}>
                  <span class="step-num">${i < idx ? '✓' : i + 1}</span><span class="grow">${s.title}</span><span class="muted small">${s.minutes}m</span>
                </button>
              </li>`)}
          </ol>
          <h4>People <span class="muted">${data.members.filter((m) => m.joined_at).length}/${data.members.length}</span></h4>
          <ul class="rail-people">
            ${data.members.map((m) => html`
              <li key=${m.id} class=${cx(!m.joined_at && 'absent')}>
                <${Avatar} name=${m.name} color=${m.color} size=${24} />
                <span class="grow">${m.name}${me && m.id === me.id ? ' (you)' : ''}${m.is_synthetic ? html` <span class="pill pill-ai">AI</span>` : ''}</span>
                <span class="muted small">${m.is_decider ? 'Decider' : m.role === 'participant' ? (DISCIPLINES[m.discipline] || '').replace('Product ', '') : ROLES[m.role]}</span>
              </li>`)}
          </ul>
        </aside>`}
        <main class="stage"><${StageToShow} ...${props} /></main>
      </div>
      ${isOrganizer && html`
        <footer class="control-bar">
          <span class="muted small">Facilitator controls</span>
          <div class="row">
            <button class="btn" disabled=${onCover} onClick=${() => goTo(idx - 1)}>← Previous</button>
            ${w.status === 'draft'
              ? html`<button class="btn btn-primary" onClick=${() => goTo(0)}>Start workshop</button>`
              : idx < steps.length - 1
                ? html`<button class="btn btn-primary" onClick=${() => goTo(idx + 1)}>Next: ${steps[idx + 1].title} →</button>`
                : html`<button class="btn btn-primary" disabled=${w.status === 'done'} onClick=${() => backend.updateWorkshop(w.id, { status: 'done', timer_ends_at: null })}>${w.status === 'done' ? 'Workshop completed' : 'Finish workshop'}</button>`}
          </div>
        </footer>`}
      ${showPrework && html`
        <${Modal} title="Pre-work" onClose=${() => setShowPrework(false)}>
          <${PreworkPanel} data=${data} me=${me} />
        <//>`}
      ${showResearch && html`
        <${Modal} title="Research decks" onClose=${() => setShowResearch(false)}>
          <${ResearchManager} wsId=${w.id} research=${data.research} me=${me} canEdit=${true} />
        <//>`}
    </div>`;
}
