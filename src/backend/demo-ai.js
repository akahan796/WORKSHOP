// Simulated AI: a stand-in for the Claude edge function (supabase/functions/ai),
// used in demo mode and by workshops set to "Simulated AI".
// Same tasks and result shapes, produced by simple deterministic rules, so the
// whole flow can be run without an AI API. Results are labeled as simulated.

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
        return { id: i.id, impact, effort, rationale: `Simulated AI: impact ${impact}, effort ${effort}.` };
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

  // Each persona favors high-impact, low-effort HMWs, with a little personal variation.
  synth_votes(db, ws, body) {
    const dots = body.dots || 3;
    const c = body.candidates || [];
    const value = (m, x) => (x.impact ?? 40) - 0.5 * (x.effort ?? 50) + hash(m.id + x.id) * 25;
    return {
      ballots: synth(db, ws).map((m) => {
        const ranked = c.slice().sort((a, b) => value(m, b) - value(m, a));
        const plan = dots >= 3 ? [Math.ceil(dots / 2), dots - Math.ceil(dots / 2)] : [dots];
        const votes = plan.map((n, i) => ranked[i] && { sticky_id: ranked[i].id, dots: n }).filter((v) => v && v.dots > 0);
        return { member_id: m.id, votes, reasoning: 'Simulated vote: favors high impact for reasonable effort.' };
      }),
    };
  },

  synth_crazy8(db, ws, body) {
    const m = db.members.find((x) => x.id === body.member_id);
    const count = Math.max(1, Math.min(8, body.count || 8));
    // Batches pick different ideas: the second angle starts halfway round the list.
    const off = Math.floor(hash(m ? m.id : '') * 8) + (/bolder/i.test(body.angle || '') ? 4 : 0);
    const avoid = new Set(body.avoid || []);
    const pool = IDEAS.map((_, i) => (i + off) % 8).filter((i) => !avoid.has(IDEAS[i]));
    return { cells: pool.slice(0, count).map((i) => ({ caption: IDEAS[i], svg: wireframe(i, IDEAS[i]) })) };
  },

  synth_solution(db, ws, body) {
    const ideas = (body.ideas || []).slice().sort((a, b) => (b.votes || 0) - (a.votes || 0));
    const pick = ideas[Math.floor(hash(body.member_id) * Math.min(3, ideas.length || 1))];
    const name = pick ? pick.caption : 'Reviewer status hub';
    const steps = ['Reviewer opens the hub and sees what needs attention', 'Opens an item; blockers and documents are on one screen', 'Requests the missing document; the preparer is notified'];
    return { title: name, summary: `Simulated solution building on "${name}". Reviewers see what's blocked, act on it in place, and the preparer gets a clear request.`, based_on: pick ? pick.id : null, frames: steps.map((c, i) => ({ caption: c, svg: wireframe([0, 3, 5][i], c.split(' ').slice(0, 3).join(' ')) })) };
  },

  synth_comments(db, ws, body) {
    const lines = ['Love that blockers are visible without opening each item.', 'How does this scale to thousands of items in one period?', 'Could the request-docs step reuse the existing notification service?'];
    const out = [];
    synth(db, ws).forEach((m, i) => {
      const target = (body.solutions || []).find((x, j) => x.member_id !== m.id && (j + i) % 2 === 0) || (body.solutions || []).find((x) => x.member_id !== m.id);
      if (target) out.push({ member_id: m.id, sheet_id: target.id, text: lines[i % lines.length] });
    });
    return { comments: out };
  },

  draft_flow(db, ws) {
    const id = ws.step_state?.solution_final?.sheet_id;
    const sheet = (db.sheets || []).find((x) => x.id === id);
    if (!sheet) throw new Error('Choose a direction in the previous step first.');
    const frames = sheet.cells.filter((c) => c.caption);
    const steps = [
      { actor: 'Preparer', title: 'Opens their reconciliation', detail: 'Lands on the reconciliation they own for this period.', screen: 'Reconciliation' },
      ...frames.map((c, i) => ({ actor: i % 2 ? 'Reviewer' : 'Preparer', title: c.caption, detail: `From the solution sketch "${sheet.title}", frame ${i + 1}.`, screen: i === 0 ? 'Reconciliation' : i === frames.length - 1 ? 'Reviewer queue' : 'Blocker panel' })),
      { actor: 'System', title: 'Records the change in the audit trail', detail: 'Every status change and comment is logged.', screen: 'Audit trail' },
    ];
    return {
      title: `${sheet.title}: user flow`,
      steps,
      details: ['Which blocker types exist and who can set them', 'Permissions: who can resolve or override a blocker', 'Performance with thousands of reconciliations per period', 'How blockers appear in existing reports'],
      questions: ['Should reviewers be notified immediately or in a daily digest?', 'Can a blocker be resolved without resubmitting?'],
    };
  },

  generate_prototype(db, ws, body) {
    const flow = body.flow || { title: 'Prototype', steps: [] };
    const screens = [...new Set(flow.steps.map((s) => s.screen || 'Screen'))];
    const esc = (t) => String(t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const sections = screens.map((name, i) => {
      const steps = flow.steps.filter((s) => (s.screen || 'Screen') === name);
      return `<section class="screen" id="s${i}"${i ? ' hidden' : ''}><header><b>OneStream</b><span>${esc(ws.project || ws.title)}</span></header>
<main><h1>${esc(name)}</h1><div class="cards">${steps.map((s) => `<div class="card"><span class="pill">${esc(s.actor)}</span><h3>${esc(s.title)}</h3><p>${esc(s.detail)}</p></div>`).join('')}</div>
<div class="nav">${i ? `<button onclick="go(${i - 1})">← Back</button>` : '<span></span>'}${i < screens.length - 1 ? `<button class="primary" onclick="go(${i + 1})">Continue →</button>` : '<button class="primary" onclick="go(0)">Start over</button>'}</div></main></section>`;
    }).join('\n');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(flow.title)}</title><style>
body{margin:0;font-family:Arial,sans-serif;background:#F4F5F7;color:#141414}header{display:flex;gap:16px;align-items:center;background:#fff;border-bottom:1px solid #E2E4E9;padding:12px 20px}
main{max-width:960px;margin:24px auto;padding:0 20px}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}.card{background:#fff;border:1px solid #E2E4E9;border-radius:8px;padding:14px}
.pill{font-size:11px;font-weight:700;background:#EEF3FF;color:#0A5DFF;border-radius:99px;padding:2px 8px}.nav{display:flex;justify-content:space-between;margin-top:20px}
button{font:inherit;font-weight:700;border:1px solid #CDD1D8;background:#fff;border-radius:6px;padding:8px 14px;cursor:pointer}button.primary{background:#0A5DFF;border-color:#0A5DFF;color:#fff}
#menu{position:fixed;right:12px;bottom:12px;background:#fff;border:1px solid #E2E4E9;border-radius:8px;padding:8px;font-size:12px}#menu a{display:block;color:#0A5DFF;cursor:pointer;padding:2px 0}
.banner{background:#FFF6DA;padding:6px 20px;font-size:12px}</style></head><body><div class="banner">Simulated prototype generated from the user flow (no AI).</div>
${sections}<div id="menu"><b>Screens</b>${screens.map((n, i) => `<a onclick="go(${i})">${esc(n)}</a>`).join('')}</div>
<script>function go(i){document.querySelectorAll('.screen').forEach(function(s,j){s.hidden=j!==i});scrollTo(0,0)}</script></body></html>`;
    return { html };
  },

  revise_prototype(db, ws, body) {
    const n = (body.feedback || []).length;
    const note = `<div class="banner" style="background:#E3F5E8">Simulated revision: ${n} pieces of feedback noted (no AI, so the design itself is unchanged).</div>`;
    return { html: String(body.html || '').replace(/<body([^>]*)>/i, (m) => m + note), summary: 'Simulated: feedback noted on the prototype.', applied: 1, skipped: 0 };
  },

  synth_feedback(db, ws) {
    const lines = { works: 'The blocker list is clear and easy to act on.', change: 'Show the blocker count in the queue so reviewers can sort by it.', question: 'What happens when a blocker owner is out of office?' };
    return { feedback: synth(db, ws).flatMap((m, i) => [['works', lines.works], [i % 2 ? 'question' : 'change', i % 2 ? lines.question : lines.change]].map(([kind, text]) => ({ member_id: m.id, kind, text }))) };
  },

  decide_solution(db, ws, body) {
    const top = (body.candidates || [])[0];
    if (!top) throw new Error('No solution sketches to decide between.');
    return { sheet_id: top.id, rationale: `Simulated AI decision: this sketch had the strongest support (score ${top.score}), so it moves into design.` };
  },

  decide_hmw(db, ws, body) {
    const top = (body.candidates || [])[0];
    if (!top) throw new Error('No candidates to decide between.');
    const second = (body.candidates || [])[1];
    return { sticky_id: top.id, rationale: `Simulated AI decision: this had the strongest support (score ${top.score}${second ? ` vs ${second.score}` : ''})${top.quadrant ? ` and sits in ${top.quadrant}` : ''}, so we carry it forward.` };
  },
};

// Simple wireframe SVGs for simulated sketches (8 layouts).
const T = (x, y, t, size = 11) => `<text x="${x}" y="${y}" font-family="Arial" font-size="${size}" fill="#333">${t.replace(/[<&>]/g, '')}</text>`;
const R = (x, y, w, h, fill = 'none') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${fill}" stroke="#555" stroke-width="1.5"/>`;
const L = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#999" stroke-width="1.5"/>`;
const LAYOUTS = [
  (t) => R(10, 10, 300, 30, '#eee') + T(20, 30, t, 12) + [0, 1, 2, 3, 4].map((i) => R(10, 50 + i * 36, 300, 28) + L(20, 64 + i * 36, 150, 64 + i * 36) + R(260, 56 + i * 36, 40, 16, '#ddd')).join(''),
  (t) => T(12, 24, t, 12) + [0, 1, 2].map((i) => R(10 + i * 102, 36, 94, 90) + L(20 + i * 102, 60, 90 + i * 102, 60) + T(20 + i * 102, 110, '##', 18)).join('') + R(10, 136, 300, 94),
  (t) => T(12, 24, t, 12) + R(10, 34, 300, 196) + [40, 90, 70, 130, 110, 160].map((h, i) => R(30 + i * 45, 220 - h, 26, h, '#ddd')).join(''),
  (t) => R(10, 10, 190, 220) + R(210, 10, 100, 220, '#f2f2f2') + T(218, 30, 'Panel') + [0, 1, 2, 3].map((i) => L(218, 50 + i * 24, 300, 50 + i * 24)).join('') + T(20, 30, t, 12),
  (t) => T(12, 24, t, 12) + L(30, 60, 30, 220) + [0, 1, 2, 3].map((i) => `<circle cx="30" cy="${70 + i * 45}" r="6" fill="#fff" stroke="#555" stroke-width="1.5"/>` + R(50, 58 + i * 45, 250, 26)).join(''),
  (t) => R(10, 10, 300, 220, '#f4f4f4') + R(50, 50, 220, 140, '#fff') + T(64, 74, t, 12) + L(64, 96, 250, 96) + L(64, 116, 220, 116) + R(190, 158, 64, 22, '#ddd') + T(204, 173, 'OK'),
  (t) => T(12, 24, t, 12) + [0, 1, 2].map((c) => R(10 + c * 102, 36, 94, 194, '#f4f4f4') + [0, 1, 2].map((i) => R(18 + c * 102, 50 + i * 52, 78, 42, '#fff')).join('')).join(''),
  (t) => R(10, 10, 90, 220, '#f2f2f2') + [0, 1, 2, 3, 4].map((i) => L(20, 34 + i * 30, 88, 34 + i * 30)).join('') + R(110, 10, 200, 220) + T(120, 32, t, 12) + L(120, 50, 290, 50) + L(120, 70, 270, 70) + L(120, 90, 280, 90),
];
const wireframe = (i, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"><rect width="320" height="240" fill="#fff"/>${LAYOUTS[i % LAYOUTS.length](label)}</svg>`;
const IDEAS = ['Status board by owner', 'Due-today summary cards', 'Close progress chart', 'Item with blocker panel', 'Approval timeline', 'Request-docs dialog', 'Kanban by state', 'Reviewer inbox'];

function synth(db, ws) { return db.members.filter((m) => m.workshop_id === ws.id && m.is_synthetic); }

export async function demoAi(db, task, body) {
  const ws = db.workshops.find((w) => w.id === body.workshop_id);
  if (!ws) throw new Error('Workshop not found.');
  if (!tasks[task]) throw new Error('Unknown AI task: ' + task);
  await new Promise((r) => setTimeout(r, 600)); // feel like a network call
  return tasks[task](db, ws, body);
}
