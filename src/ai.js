// AI actions the organizer runs. Each one asks the backend's AI (the Claude edge
// function, or the demo stand-in) for plain results, then writes them as normal
// workshop data, so everyone's screen updates live.
import { backend } from './backend/index.js';
import { nextColor, hmwText } from './lib.js';

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
  const { participants } = await backend.ai('synth_participants', { workshop_id: w.id, count, disciplines, guidance });
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
  const { contributions } = await backend.ai('synth_research', { workshop_id: w.id });
  return addContributions(w, contributions, 'research', (c) => c.stickies.map((s) => ({ kind: s.kind, text: s.text })));
}

export async function synthHmw(w) {
  const { contributions } = await backend.ai('synth_hmw', { workshop_id: w.id });
  return addContributions(w, contributions, 'hmw', (c) => c.hmws.map((t) => ({ kind: 'hmw', text: hmwText(t) })));
}

export async function placeGrid(w, hmws) {
  const { placements } = await backend.ai('place_grid', { workshop_id: w.id, items: hmws.map((s) => ({ id: s.id, text: s.text })) });
  const byId = Object.fromEntries(hmws.map((s) => [s.id, s]));
  for (const p of placements) {
    const s = byId[p.id];
    if (s) await backend.updateSticky(s.id, { data: { ...s.data, grid: { x: p.effort, y: p.impact, ai: true, rationale: p.rationale } } });
  }
  return placements.length;
}

// Weighted tally: the Decider's dots count double.
export const DECIDER_WEIGHT = 2;
export function tally(hmws, votes, members) {
  const decider = members.find((m) => m.is_decider);
  return hmws.map((s) => {
    const mine = votes.filter((v) => v.target_id === s.id);
    const deciderDots = decider ? mine.filter((v) => v.member_id === decider.id).length : 0;
    return { sticky: s, dots: mine.length, deciderDots, score: mine.length + deciderDots * (DECIDER_WEIGHT - 1) };
  }).sort((a, b) => b.score - a.score);
}

export async function synthVotes(w, hmws, members, dots) {
  const synthIds = members.filter((m) => m.is_synthetic).map((m) => m.id);
  const candidates = hmws.map((s) => ({ id: s.id, text: s.text, quadrant: QUADRANTS[quadrantOf(s.data?.grid)]?.label }));
  const { ballots } = await backend.ai('synth_votes', { workshop_id: w.id, dots, candidates });
  await backend.deleteVotes(w.id, 'hmw', synthIds); // re-running replaces earlier AI votes
  const rows = [];
  for (const b of ballots) for (const v of b.votes) for (let i = 0; i < v.dots; i++) rows.push({ workshop_id: w.id, member_id: b.member_id, target_id: v.sticky_id, round: 'hmw' });
  if (rows.length) await backend.addVotes(rows);
  return ballots;
}

export async function aiDecide(w, ranked) {
  const candidates = ranked.slice(0, 5).map((r) => ({ id: r.sticky.id, text: r.sticky.text, score: r.score, quadrant: QUADRANTS[quadrantOf(r.sticky.data?.grid)]?.label }));
  const d = await backend.ai('decide_hmw', { workshop_id: w.id, candidates });
  await backend.setDecision(w.id, 'hmw_final', { sticky_id: d.sticky_id, rationale: d.rationale, by: 'ai' });
  return d;
}
