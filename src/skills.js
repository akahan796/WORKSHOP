// Sketching skills: the instructions participants run in their own AI tool for
// Crazy 8s and the solution sketch, plus the context prompt that goes with them.
// The same skill text is sent to the AI participants, so human and AI sketches
// follow the same rules and look alike. Organizers can edit both in Setup → Skills;
// an empty field means the default below.

export const DEFAULT_SKILLS = {
  crazy8: `---
name: crazy-8s-sketches
description: Sketch 8 quick, genuinely different UI ideas (Crazy 8s) for a design-thinking workshop problem, as 8 rough wireframe images with short captions.
---

# Crazy 8s sketches

You help a workshop participant do Crazy 8s: eight different ideas for one problem, sketched fast and rough. Quantity and range matter more than polish.

## Input
The participant pastes a workshop context prompt: the "How might we" (HMW) question, the product and its users, and research takeaways. If something is missing, ask once, then proceed.

## Ideas
- Make exactly 8 ideas that each answer the HMW.
- Make them genuinely different. Vary the approach, not just the layout. Spread them across:
  - where it happens (a dashboard, inside the item, a notification, an assistant, a mobile moment)
  - how much is automated (fully manual, suggested, automatic with review)
  - the interaction model (list, board, timeline, wizard, inline action, conversation)
  - who acts (the person, a reviewer, the team, the system)
- Include at least one bold or unexpected idea and at least one small, quick win.
- Ground each idea in a research takeaway where you can.

## Look (same for all 8)
- One idea per sketch, as a rough low-fidelity wireframe of a screen or moment.
- Landscape 4:3 (for example 1200 x 900 px, or an SVG viewBox of 0 0 320 240), white background.
- Black and grey strokes only, boxes for UI regions, scribble lines for text. No color, no real data, no shading, no photos.
- At most a few short labels in Arial. Put the key action in a slightly heavier outline.
- It should look like a quick marker sketch, not a finished design.

## Output
1. 8 separate images, named 1 to 8 in order (PNG or SVG).
2. A numbered list of 8 captions, each 3 to 8 words, saying the idea (not the screen), for example "Blockers float to the top of the list".

The participant uploads image 1 with caption 1 into slot 1, and so on.
`,

  solution: `---
name: solution-sketch
description: Turn the strongest Crazy 8s idea into a solution sketch for a design-thinking workshop: a title, a short summary and 3 to 6 storyboard frames that mix pictures and words.
---

# Solution sketch

You help a workshop participant turn an idea into a solution sketch that explains itself: someone should understand it without the author in the room.

## Input
The participant pastes a workshop context prompt: the "How might we" (HMW) question, the product and its users, research takeaways, and the group's strongest Crazy 8s ideas (with votes). Building on someone else's idea is encouraged. If something is missing, ask once, then proceed.

## The sketch
- A catchy, specific title (under 8 words).
- A 2 to 3 sentence summary: what it is, who it's for, and why it answers the HMW.
- 3 to 6 frames that walk through a flow or interaction in order, like a storyboard: where the person starts, what they do, what the system does, and the outcome.
- Each frame mixes pictures and words: a wireframe plus a caption of 1 to 2 sentences saying what happens and why. Add small callouts or arrows on the frame where they help.

## Look (same for every frame)
- Landscape 4:3 (for example 1200 x 900 px, or an SVG viewBox of 0 0 320 240), white background.
- Grey wireframe style: black and grey strokes, boxes for UI regions, short labels in Arial.
- Use one accent color, blue #0A5DFF, and only for the key action or the change being proposed.
- Keep the same layout skeleton across frames (same header, same navigation), so the frames read as one product.
- Rough and clear, not pixel-perfect. No real logos, photos or real customer data.

## Output
1. The title and the summary, as text.
2. 3 to 6 separate images, named 1 to N in flow order (PNG or SVG).
3. A numbered list of captions, one per frame.

The participant uploads the frames in order and pastes the title, summary and captions next to them.
`,
};

const KEYS = { crazy8: 'skill_crazy8', solution: 'skill_solution' };

// The skill a workshop uses: what the organizer set, or the default.
export function skillFor(w, kind) {
  const own = ((w && w.intro && w.intro[KEYS[kind]]) || '').trim();
  return own || DEFAULT_SKILLS[kind];
}

export const isDefaultSkill = (w, kind) => !((w && w.intro && w.intro[KEYS[kind]]) || '').trim();

// The workshop context participants paste into their AI tool along with the skill.
// `ideas`: ranked Crazy 8s ideas [{ caption, author, votes }] for the solution sketch;
// `mine`: the participant's own Crazy 8s captions.
export function sketchPrompt(kind, { w, hmw, stickies = [], ideas = [], mine = [] }) {
  const intro = w.intro || {};
  const research = (k) => stickies.filter((s) => s.step === 'research' && s.kind === k).slice(0, 6).map((s) => `- ${s.text}`);
  const lines = [
    kind === 'crazy8' ? 'Use the Crazy 8s skill with this workshop context.' : 'Use the solution sketch skill with this workshop context.',
    '',
    `How might we: ${hmw || '(the group has not chosen an HMW yet)'}`,
    '',
    `Workshop: ${w.title}`,
    w.project ? `Product / area: ${w.project}` : null,
    w.description ? `Goal: ${w.description}` : null,
    intro.background ? `Background: ${intro.background}` : null,
  ];
  const pains = research('pain'), opps = research('opportunity'), obs = research('observation');
  if (pains.length || opps.length || obs.length) {
    lines.push('', 'Research takeaways from the share-out:');
    if (pains.length) lines.push('Pain points:', ...pains);
    if (opps.length) lines.push('Opportunities:', ...opps);
    if (obs.length) lines.push('Observations:', ...obs);
  }
  if (kind === 'solution') {
    if (ideas.length) lines.push('', 'Strongest Crazy 8s ideas from the group (votes):', ...ideas.slice(0, 10).map((i) => `- ${i.caption} (${i.author || 'someone'}, ${i.votes || 0} votes)`));
    if (mine.length) lines.push('', 'My own Crazy 8s ideas:', ...mine.map((c) => `- ${c}`));
    lines.push('', 'Pick the strongest idea (mine or anyone else\'s, or a mix) and develop it into a solution sketch.');
  } else {
    lines.push('', 'Sketch 8 different ideas that answer the HMW.');
  }
  return lines.filter((l) => l != null).join('\n');
}

export function downloadSkill(w, kind) {
  const text = skillFor(w, kind);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  a.download = kind === 'crazy8' ? 'crazy-8s-sketches.md' : 'solution-sketch.md';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
