// The workshop agenda, from the Design Thinking Workshop Runbook. `phase` is the
// build phase that implements the step's interactive stage (see SPEC.md).
export const STEPS = [
  { key: 'intro', title: 'Introductions', minutes: 15, phase: 1,
    blurb: 'Open with introductions and orient the group: who we are, the project, the workshop overview, rules and what to expect.' },
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

export function defaultAgenda() {
  return STEPS.map((s) => ({ key: s.key, enabled: true, minutes: s.minutes }));
}

// The enabled steps in order, each merged with its definition.
export function activeSteps(workshop) {
  const agenda = workshop.agenda && workshop.agenda.length ? workshop.agenda : defaultAgenda();
  return agenda.filter((a) => a.enabled && STEP_BY_KEY[a.key]).map((a) => ({ ...STEP_BY_KEY[a.key], minutes: a.minutes }));
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
    expectations: 'Come curious. Everyone sketches, and no drawing skills are needed: you will use the AI skills shared before the workshop. Expect short timed activities with breaks in between.',
  };
}

export const STICKY_KINDS = {
  pain: { label: 'Pain point', short: 'Pain' },
  opportunity: { label: 'Opportunity', short: 'Opp.' },
  observation: { label: 'Observation', short: 'Obs.' },
  question: { label: 'Question for Q&A', short: 'Q' },
};
