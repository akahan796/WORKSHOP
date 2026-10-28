// Demo-mode stand-in for the Claude edge function (supabase/functions/ai).
// Same tasks and result shapes, produced by simple deterministic rules, so the
// whole flow can be tried without an API key. Results are labeled as demo.

const DISC = { design: 'Product Design', pm: 'Product Management', eng: 'Engineering' };
const NAMES = {
  design: ['Maya Ortiz', 'Jonah Weiss', 'Leila Haddad', 'Sam Okafor'],
  pm: ['Rachel Kim', 'Owen Patel', 'Grace Liu', 'Daniel Moreau'],
  eng: ['Victor Novak', 'Aisha Rahman', 'Ben Carter', 'Nadia Petrova'],
};
const PERSONAS = {
  design: (p) => `Senior product designer on ${p}. Cares about reducing clicks and making status obvious at a glance; pushes for patterns that already exist in the OneStream design system.`,
  pm: (p) => `Product manager for ${p}. Thinks in terms of customer outcomes and adoption; wants to know which problems block the most users at month-end.`,
  eng: (p) => `Engineer on the ${p} platform team. Pragmatic about data model and performance limits; flags where an idea needs new integrations versus reusing what exists.`,
};

function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295; }

const tasks = {
  place_grid(db, ws, body) {
    return {
      placements: (body.items || []).map((i) => {
        const t = i.text.toLowerCase();
        let impact = 30 + hash(i.text) * 60, effort = 20 + hash(i.text + 'e') * 70;
        if (/status|one place|at a glance|block|know/.test(t)) impact += 15;
        if (/automat|integrat|ai|real-time|sync/.test(t)) effort += 15;
        impact = Math.min(95, Math.round(impact)); effort = Math.min(95, Math.round(effort));
        return { id: i.id, impact, effort, rationale: `Demo placement (AI not connected): impact ${impact}, effort ${effort}.` };
      }),
    };
  },

  synth_participants(db, ws, body) {
    const used = new Set(db.members.filter((m) => m.workshop_id === ws.id).map((m) => m.name));
    const disc = (body.disciplines && body.disciplines.length ? body.disciplines : ['design', 'pm', 'eng']);
    const out = [];
    for (let i = 0; i < (body.count || 3); i++) {
      const d = disc[i % disc.length];
      const name = NAMES[d].find((n) => !used.has(n)) || `${DISC[d]} Guest ${i + 1}`;
      used.add(name);
      out.push({ name, discipline: d, persona: PERSONAS[d](ws.project || 'the product') });
    }
    return { participants: out };
  },

  synth_research(db, ws) {
    const p = ws.project || 'the product';
    const lines = {
      design: [['pain', `Status for ${p} is spread across screens; nothing shows the whole picture`], ['opportunity', 'One overview that highlights what needs attention first'], ['observation', 'Users screenshot statuses to share them in chat']],
      pm: [['pain', 'Reviewers chase preparers by email to find out what is blocked'], ['opportunity', 'Surface blockers before the close deadline, not after'], ['question', 'How many customers already build their own status trackers?']],
      eng: [['observation', 'Supporting documents live outside the system, so we cannot link them'], ['pain', 'Bulk actions time out on large workspaces'], ['opportunity', 'Reuse the existing notification service for reminders']],
    };
    return { contributions: synth(db, ws).map((m) => ({ member_id: m.id, stickies: (lines[m.discipline] || lines.pm).map(([kind, text]) => ({ kind, text })) })) };
  },

  synth_hmw(db, ws) {
    const p = ws.project || 'the product';
    const lines = {
      design: ['help reviewers see every item\'s status in one place?', `make what needs attention in ${p} impossible to miss?`],
      pm: ['let preparers flag blockers before they cause a late close?', 'cut the back-and-forth emails between preparers and reviewers?'],
      eng: ['keep supporting documents attached to the item they support?', 'make bulk review fast on the largest workspaces?'],
    };
    return { contributions: synth(db, ws).map((m) => ({ member_id: m.id, hmws: lines[m.discipline] || lines.pm })) };
  },

  synth_votes(db, ws, body) {
    const dots = body.dots || 3;
    const c = body.candidates || [];
    return {
      ballots: synth(db, ws).map((m) => {
        const ranked = c.slice().sort((a, b) => hash(m.id + b.id) - hash(m.id + a.id) + (b.quadrant === 'Quick win' ? 0.3 : 0) - (a.quadrant === 'Quick win' ? 0.3 : 0));
        const votes = [];
        for (let i = 0; i < dots && ranked.length; i++) {
          const t = ranked[i % Math.min(2, ranked.length)];
          const v = votes.find((x) => x.sticky_id === t.id);
          if (v) v.dots++; else votes.push({ sticky_id: t.id, dots: 1 });
        }
        return { member_id: m.id, votes, reasoning: 'Demo vote (AI not connected).' };
      }),
    };
  },

  decide_hmw(db, ws, body) {
    const top = (body.candidates || [])[0];
    if (!top) throw new Error('No candidates to decide between.');
    return { sticky_id: top.id, rationale: `Demo decision (AI not connected): "${top.text}" had the strongest support, so we carry it forward.` };
  },
};

function synth(db, ws) { return db.members.filter((m) => m.workshop_id === ws.id && m.is_synthetic); }

export async function demoAi(db, task, body) {
  const ws = db.workshops.find((w) => w.id === body.workshop_id);
  if (!tasks[task]) throw new Error('Unknown AI task: ' + task);
  await new Promise((r) => setTimeout(r, 600)); // feel like a network call
  return tasks[task](db, ws, body);
}
