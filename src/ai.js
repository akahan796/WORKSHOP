// AI actions the organizer runs. Each one asks the backend's AI (the Claude edge
// function, or the demo stand-in) for plain results, then writes them as normal
// workshop data, so everyone's screen updates live.
import { backend } from './backend/index.js';
import { nextColor, hmwText, uid } from './lib.js';
import { demoAi } from './backend/demo-ai.js';

// Simulated AI: the built-in stand-in, no API call. Used in demo mode and for any
// workshop whose AI mode is set to "simulated" (workshop data still lives in Supabase).
export const isSimulated = (w) => backend.mode === 'demo' || (w.step_state || {}).ai_mode === 'simulated';

async function runAi(w, task, body) {
  if (!isSimulated(w)) {
    try { return await backend.ai(task, { workshop_id: w.id, ...body }); }
    catch (e) { throw new Error(e.message + ' Tip: to run without an AI API, set AI mode to Simulated in Setup → Details.'); }
  }
  const members = await backend.listMembers(w.id);
  return demoAi({ workshops: [w], members }, task, { workshop_id: w.id, ...body });
}

export const QUADRANTS = {
  quick: { label: 'Quick win', hint: 'High impact · low effort' },
  big: { label: 'Big bet', hint: 'High impact · high effort' },
  fill: { label: 'Fill-in', hint: 'Low impact · low effort' },
  pit: { label: 'Deprioritize', hint: 'Low impact · high effort' },
};

// Grid position → quadrant key (x = effort, y = impact, both 0–100).
export function quadrantOf(grid) {
  if (!grid) return null;
  const hi = grid.y >= 50, easy = grid.x < 50;
  return hi ? (easy ? 'quick' : 'big') : (easy ? 'fill' : 'pit');
}

export async function generateSynthetic(w, members, { count, disciplines, guidance }) {
  const { participants } = await runAi(w, 'synth_participants', { count, disciplines, guidance });
  const all = members.slice();
  for (const p of participants) {
    all.push(await backend.addMember(w.id, {
      name: p.name, email: '', role: 'participant', discipline: p.discipline, persona: p.persona,
      is_synthetic: true, joined_at: new Date().toISOString(), color: nextColor(all),
    }));
  }
  return participants.length;
}

async function addContributions(w, contributions, step, toStickies) {
  let n = 0;
  for (const c of contributions) {
    for (const s of toStickies(c)) {
      await backend.addSticky({ workshop_id: w.id, member_id: c.member_id, step, ...s });
      n++;
    }
  }
  return n;
}

export async function synthResearch(w) {
  const { contributions } = await runAi(w, 'synth_research', {});
  return addContributions(w, contributions, 'research', (c) => c.stickies.map((s) => ({ kind: s.kind, text: s.text })));
}

export async function synthHmw(w) {
  const { contributions } = await runAi(w, 'synth_hmw', {});
  return addContributions(w, contributions, 'hmw', (c) => c.hmws.map((t) => ({ kind: 'hmw', text: hmwText(t) })));
}

export async function placeGrid(w, hmws) {
  const { placements } = await runAi(w, 'place_grid', { items: hmws.map((s) => ({ id: s.id, text: s.text })) });
  const byId = Object.fromEntries(hmws.map((s) => [s.id, s]));
  for (const p of placements) {
    const s = byId[p.id];
    if (s) await backend.updateSticky(s.id, { data: { ...s.data, grid: { x: p.effort, y: p.impact, ai: true, rationale: p.rationale } } });
  }
  return placements.length;
}

// Who gets dots: everyone but the organizer, unless the workshop lets the organizer vote too.
export const canMemberVote = (w, me) => !!me && (me.role !== 'organizer' || !!(w.step_state || {}).organizer_votes);

// Weighted tally: the Decider's dots count double.
export const DECIDER_WEIGHT = 2;
export function tallyItems(items, votes, members) {
  const decider = members.find((m) => m.is_decider);
  return items.map((item) => {
    const mine = votes.filter((v) => v.target_id === item.id);
    const deciderDots = decider ? mine.filter((v) => v.member_id === decider.id).length : 0;
    return { item, sticky: item, dots: mine.length, deciderDots, score: mine.length + deciderDots * (DECIDER_WEIGHT - 1) };
  }).sort((a, b) => b.score - a.score);
}
export const tally = tallyItems;

// AI participants vote in a round; re-running replaces their earlier votes in it.
async function castSynthVotes(w, round, candidates, members, dots) {
  const synthIds = members.filter((m) => m.is_synthetic).map((m) => m.id);
  const { ballots } = await runAi(w, 'synth_votes', { round: round === 'solution2' ? 'solution' : round, dots, candidates });
  await backend.deleteVotes(w.id, round, synthIds);
  const rows = [];
  for (const b of ballots) for (const v of b.votes) for (let i = 0; i < v.dots; i++) rows.push({ workshop_id: w.id, member_id: b.member_id, target_id: v.sticky_id, round });
  if (rows.length) await backend.addVotes(rows);
  return ballots;
}

export async function synthVotes(w, hmws, members, dots) {
  const candidates = hmws.map((s) => ({ id: s.id, text: s.text, quadrant: QUADRANTS[quadrantOf(s.data?.grid)]?.label, impact: s.data?.grid?.y, effort: s.data?.grid?.x }));
  return castSynthVotes(w, 'hmw', candidates, members, dots);
}

// Sketch rounds: candidates are [{ id, text, image_paths }].
export const synthSketchVotes = (w, round, candidates, members, dots) => castSynthVotes(w, round, candidates, members, dots);

export async function aiDecide(w, ranked) {
  const candidates = ranked.slice(0, 5).map((r) => ({ id: r.sticky.id, text: r.sticky.text, score: r.score, quadrant: QUADRANTS[quadrantOf(r.sticky.data?.grid)]?.label }));
  const d = await runAi(w, 'decide_hmw', { candidates });
  await backend.setDecision(w.id, 'hmw_final', { sticky_id: d.sticky_id, rationale: d.rationale, by: 'ai' });
  return d;
}

export async function aiDecideSolution(w, ranked) {
  const candidates = ranked.slice(0, 5).map((r) => ({ id: r.item.id, text: `"${r.item.title}": ${r.item.summary}`, score: r.score, image_paths: r.item.cells.map((c) => c.file_path).filter(Boolean) }));
  const d = await runAi(w, 'decide_solution', { candidates });
  await backend.setDecision(w.id, 'solution_final', { sheet_id: d.sheet_id, rationale: d.rationale, by: 'ai' });
  return d;
}

// ── AI participants' sketches ──
const svgBlob = (svg) => new Blob([svg], { type: 'image/svg+xml' });

async function saveCells(w, memberId, cells) {
  const out = [];
  for (const c of cells) {
    const file_path = c.svg ? await backend.uploadSketch(w.id, memberId, svgBlob(c.svg), 'svg') : null;
    out.push({ id: uid(), file_path, caption: c.caption || '' });
  }
  return out;
}

// Runs one AI call per synthetic participant, in parallel. Returns a summary line.
async function perSynth(members, fn, onProgress) {
  const synth = members.filter((m) => m.is_synthetic);
  let done = 0;
  onProgress && onProgress(`0 of ${synth.length} done`);
  const results = await Promise.allSettled(synth.map(async (m) => {
    try { return await fn(m); } finally { done++; onProgress && onProgress(`${done} of ${synth.length} done`); }
  }));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length === results.length && failed.length) throw failed[0].reason;
  return `${results.length - failed.length} of ${results.length} AI participants done${failed.length ? ` (${failed[0].reason.message})` : ''}.`;
}

export function synthCrazy8(w, members, onProgress) {
  return perSynth(members, async (m) => {
    const { cells } = await runAi(w, 'synth_crazy8', { member_id: m.id });
    await backend.saveSheet(w.id, m.id, 'crazy8', { cells: await saveCells(w, m.id, cells), ready: true });
  }, onProgress);
}

// ideas: [{ id, caption, author, votes }] (Crazy 8s cells)
export function synthSolutions(w, members, ideas, onProgress) {
  return perSynth(members, async (m) => {
    const r = await runAi(w, 'synth_solution', { member_id: m.id, ideas });
    await backend.saveSheet(w.id, m.id, 'solution', { title: r.title, summary: r.summary, based_on: r.based_on, cells: await saveCells(w, m.id, r.frames), ready: true });
  }, onProgress);
}

export async function synthComments(w, solutions, members) {
  const name = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const { comments } = await runAi(w, 'synth_comments', {
    solutions: solutions.map((x) => ({ id: x.id, member_id: x.member_id, author: name[x.member_id], title: x.title, summary: x.summary, captions: x.cells.map((c) => c.caption), image_paths: x.cells.map((c) => c.file_path).filter(Boolean) })),
  });
  for (const c of comments) await backend.addSticky({ workshop_id: w.id, member_id: c.member_id, step: 'review', kind: 'comment', text: c.text, data: { sheet_id: c.sheet_id } });
  return `Added ${comments.length} comments.`;
}
