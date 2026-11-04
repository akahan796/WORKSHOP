// The workshop agenda, from the Design Thinking Workshop Runbook. `phase` is the
// build phase that implements the step's interactive stage (see SPEC.md).
// `optional` steps are off unless the organizer turns them on, and a workshop
// length (below) leaves them as they are.
export const STEPS = [
  { key: 'intro', title: 'Introduction', minutes: 15, phase: 1,
    blurb: 'Open with introductions and orient the group: who we are, the project, the workshop overview, rules and what to expect.' },
  { key: 'warmup', title: 'Warm-Up Exercise', minutes: 10, phase: 1, optional: true,
    blurb: 'A creative warm-up: turn 16 empty circles into as many different drawings as you can (a flower, a wheel, a clock, a balloon…), on screen or on a printed sheet.' },
  { key: 'research', title: 'UX Research Share Out', minutes: 60, phase: 1,
    blurb: 'Research presents the findings. Everyone else silently captures pain points, opportunities and observations, one idea per sticky. Q&A at the end.' },
  { key: 'hmw', title: 'How Might We', minutes: 20, phase: 1,
    blurb: 'Using your color-coded stickies, turn what you heard into "How might we…" statements, one per sticky.' },
  { key: 'grid', title: 'Impact / Effort Grid', minutes: 20, phase: 2,
    blurb: 'All HMWs start in one pile. AI places each one on the Impact/Effort grid, then the group adjusts.' },
  { key: 'vote_hmw', title: 'Vote on HMWs', minutes: 15, phase: 2,
    blurb: 'Dot vote to narrow down to the most important problem or opportunity. The Decider votes in purple and breaks ties. Align on one HMW.' },
  { key: 'crazy8', title: 'Crazy 8s', minutes: 8, phase: 3,
    blurb: 'Eight sketches in eight minutes, one per cell, made with your Crazy 8s AI skill.' },
  { key: 'share8', title: 'Share Crazy 8s', minutes: 30, phase: 3,
    blurb: 'Each person takes 3 minutes to share and answer questions. Everyone gets 3 votes for individual sketches; voting for your own is fine.' },
  { key: 'solution', title: 'Solution Sketch', minutes: 60, phase: 3,
    blurb: 'Pick the strongest idea and develop it with the solution-sketch skill: a clear title, 3+ frames, pictures and words. Riffing is encouraged.' },
  { key: 'review', title: 'Review Solution Sketches', minutes: 20, phase: 3,
    blurb: "Review each other's sketches and finalize your own." },
  { key: 'vote_solution', title: 'Vote on a Direction', minutes: 20, phase: 3,
    blurb: 'Dot vote on the most compelling solution sketches and share your reasoning. The Decider makes the final call; it may take two rounds.' },
  { key: 'flow', title: 'Design Details & User Flow', minutes: 45, phase: 4,
    blurb: 'The group aligns on implementation details and maps the user flow. AI drafts the flow from the chosen sketch. Non-design participants are released after this.' },
  { key: 'prototype', title: 'AI Prototype', minutes: 30, phase: 4,
    blurb: 'AI generates an interactive prototype from the chosen direction and user flow.' },
  { key: 'design_review', title: 'Design Review', minutes: 30, phase: 4,
    blurb: 'Review the prototype together and capture feedback.' },
];

// Steps with phase <= BUILT_PHASE have their interactive stage.
export const BUILT_PHASE = 4;

export const STEP_BY_KEY = Object.fromEntries(STEPS.map((s) => [s.key, s]));

// Workshop lengths, picked with the slider at the top of the Agenda & Time tab. A day is
// about 5 hours of activities (the rest is breaks, lunch and changeovers). Each
// length sets every step's minutes; 0 drops the step because it doesn't fit.
// Crazy 8s is always 8 minutes: one per sketch.
export const DAY_MINUTES = 300;
export const DURATIONS = [
  { key: 'focused', name: 'Focused', days: 1.5, blurb: 'Every step, at a brisk pace. A good fit when the problem is already well understood.' },
  { key: 'standard', name: 'Standard', days: 2, blurb: 'The full workshop with room to discuss: deeper research share-outs and more time to sketch.' },
  { key: 'extended', name: 'Extended', days: 2.5, blurb: 'More time for Q&A, sharing and the user flow, for bigger groups or a fuzzier problem.' },
  { key: 'immersive', name: 'Immersive', days: 3, blurb: 'The deep dive: long research and sketching sessions, and a thorough design review at the end.' },
];
const DURATION_MINUTES = {
  //              focused standard extended immersive
  intro:         [15, 20, 30, 30],
  warmup:        [10, 10, 15, 15],
  research:      [60, 90, 120, 150],
  hmw:           [30, 40, 45, 60],
  grid:          [20, 30, 40, 45],
  vote_hmw:      [15, 20, 25, 30],
  crazy8:        [8, 8, 8, 8],
  share8:        [30, 45, 60, 60],
  solution:      [60, 90, 120, 150],
  review:        [20, 30, 40, 45],
  vote_solution: [20, 30, 30, 40],
  flow:          [60, 75, 90, 120],
  prototype:     [45, 60, 75, 75],
  design_review: [45, 60, 75, 90],
};
export const DEFAULT_DURATION = 1; // Standard

// The agenda for a length: every step, the ones that don't fit switched off
// (they keep their usual minutes for when they're switched back on). Optional
// steps stay on or off as they are in `current`.
export function durationAgenda(i, current = []) {
  return STEPS.map((s) => {
    const m = DURATION_MINUTES[s.key][i];
    const enabled = s.optional ? !!current.find((a) => a.key === s.key)?.enabled : m > 0;
    return { key: s.key, enabled, minutes: m || s.minutes };
  });
}

// The length an agenda was set to, or -1 once a step has been changed by hand.
// Turning an optional step on or off doesn't count as a change.
export function durationOf(agenda) {
  return DURATIONS.findIndex((_, i) => durationAgenda(i, agenda).every((t) => {
    const a = agenda.find((x) => x.key === t.key);
    return a && a.enabled === t.enabled && (!t.enabled || Number(a.minutes) === t.minutes);
  }));
}

// Which day each step falls on: the day its midpoint lands in.
export function agendaDays(agenda) {
  let t = 0;
  return agenda.map((a) => {
    if (!a.enabled) return null;
    const day = Math.floor((t + Number(a.minutes || 0) / 2) / DAY_MINUTES) + 1;
    t += Number(a.minutes || 0);
    return day;
  });
}

export function defaultAgenda() {
  return durationAgenda(DEFAULT_DURATION);
}

export const fmtMinutes = (n) => (n >= 60 ? `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}m` : ''}` : `${n}m`);

// A workshop's saved agenda with every step in it: steps added in a later version
// go in their place in STEPS order, optional ones switched off.
export function normalizeAgenda(saved) {
  if (!saved || !saved.length) return defaultAgenda();
  const byKey = Object.fromEntries(saved.map((a) => [a.key, a]));
  const list = saved.filter((a) => STEP_BY_KEY[a.key]);
  STEPS.forEach((s, i) => {
    if (byKey[s.key]) return;
    const prev = i ? list.findIndex((a) => a.key === STEPS[i - 1].key) : -1;
    list.splice(prev + 1, 0, { key: s.key, enabled: !s.optional, minutes: s.minutes });
  });
  return list;
}

// The enabled steps in order, each merged with its definition.
export function activeSteps(workshop) {
  return normalizeAgenda(workshop.agenda).filter((a) => a.enabled).map((a) => ({ ...STEP_BY_KEY[a.key], minutes: a.minutes }));
}

export const DEFAULT_RULES = [
  'One idea per sticky.',
  'Quantity over quality: go wide before we go deep.',
  'Build on the ideas of others ("yes, and…").',
  'Stay on topic, and on time. The timer is the boss.',
  'Laptops for the workshop only; notifications off.',
  'The Decider has the final call when the group is split.',
];

export function defaultIntro() {
  return {
    welcome: '',
    background: '',
    overview: 'Over this session we will hear the latest UX research, turn what we learn into "How might we" opportunities, prioritize them together, sketch solutions, and leave with one aligned direction and a prototype.',
    rules: DEFAULT_RULES.slice(),
    approach: 'First we go wide to understand the problem, then narrow it down to one. Then we go wide on ideas, and narrow down to one direction.',
    expectations: 'Come curious. Everyone sketches, and no drawing skills are needed: you will use the AI skills shared before the workshop. Expect short timed activities with breaks in between.',
  };
}

export const STICKY_KINDS = {
  pain: { label: 'Pain point', short: 'Pain' },
  opportunity: { label: 'Opportunity', short: 'Opp.' },
  observation: { label: 'Observation', short: 'Obs.' },
  question: { label: 'Question for Q&A', short: 'Q' },
};

// The Introduction step is a short deck: one slide per section, shown in the order
// saved in intro.slides ([{ key, enabled }]); sections it doesn't list follow, on.
// Custom slides live only in intro.slides: { key: 'custom-…', enabled, title, text }.
export const INTRO_SLIDES = [
  { key: 'organizer', title: 'Your organizer' },
  { key: 'project', title: 'About the project' },
  { key: 'overview', title: 'Workshop overview' },
  { key: 'approach', title: 'Our approach' },
  { key: 'rules', title: 'Working agreement' },
  { key: 'expectations', title: 'What to expect' },
  { key: 'people', title: "Who's here" },
];
export function introSlideOrder(intro) {
  const known = Object.fromEntries(INTRO_SLIDES.map((s) => [s.key, s]));
  const isCustom = (key) => String(key).startsWith('custom-');
  const saved = ((intro && intro.slides) || []).filter((s) => known[s.key] || isCustom(s.key));
  // A built-in slide the saved order doesn't list yet (added in a later version)
  // goes right after the built-in slide before it, or first.
  const list = saved.slice();
  INTRO_SLIDES.forEach((s, i) => {
    if (list.some((x) => x.key === s.key)) return;
    const prev = i ? list.findIndex((x) => x.key === INTRO_SLIDES[i - 1].key) : -1;
    list.splice(prev + 1, 0, { key: s.key, enabled: true });
  });
  return list.map((s) => isCustom(s.key)
    ? { key: s.key, custom: true, title: s.title || '', text: s.text || '', enabled: s.enabled !== false }
    : { ...known[s.key], enabled: s.enabled !== false });
}

// The double diamond: every step after the introduction sits in one of its four
// stages. Research = the first diamond (the problem), Design = the second (the solution).
export const DIAMOND = [
  { key: 'discover', title: 'Discover', half: 'Research', caption: 'Insight into the problem', color: '#E8505B' },
  { key: 'define', title: 'Define', half: 'Research', caption: 'Scope down the focus', color: '#F5C55A' },
  { key: 'develop', title: 'Develop', half: 'Design', caption: 'Potential solutions', color: '#4FBE8C' },
  { key: 'deliver', title: 'Deliver', half: 'Design', caption: 'Solutions that work & feedback', color: '#8B5A3C' },
];
export const STEP_DIAMOND = {
  research: 'discover', hmw: 'discover',
  grid: 'define', vote_hmw: 'define',
  crazy8: 'develop', share8: 'develop', solution: 'develop', review: 'develop',
  vote_solution: 'deliver', flow: 'deliver', prototype: 'deliver', design_review: 'deliver',
};
