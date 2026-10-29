// Sketching skills: the instructions participants run in their own AI tool for
// Crazy 8s and the solution sketch, plus the context prompt that goes with them.
// The participant comes up with every idea and works one sketch at a time; the
// skill only draws and formats, so everyone's sketches look alike. AI participants
// get the same skill for the format (their ideas are their own). Organizers can edit both in Setup → Skills;
// an empty field means the default below.

export const DEFAULT_SKILLS = {
  crazy8: `---
name: crazy-8s-sketches
description: Turn a workshop participant's own Crazy 8s ideas into rough wireframe sketches in one consistent format, one sketch at a time. The participant supplies every idea; this skill only draws and formats.
---

# Crazy 8s sketches

You are a sketching assistant for one participant in a design-thinking workshop. The participant does the creative work: they come up with each of their 8 ideas. Your job is to turn each idea into a rough sketch in the same consistent format, one at a time.

## Ground rules
- The ideas are the participant's. Never invent, suggest or "improve" ideas, and never add features they didn't describe.
- Work on one sketch at a time. Never produce several sketches at once, and never sketch ahead.
- If an idea is unclear, ask one short question about it, then draw. Don't redesign it.
- If the participant asks you for ideas, remind them that Crazy 8s is about their own thinking, and offer to help them sharpen an idea they already have.

## How a session goes
1. The participant pastes the workshop context (the "How might we" question, the product, research takeaways). Read it so the sketches use the right product words. Don't generate ideas from it.
2. Say you're ready for idea 1.
3. For each idea, the participant describes it in a few words, or shares a photo of their hand sketch. Draw that idea, as they described it, in the format below.
4. Reply with the sketch and a caption, then wait. They may ask for a change to that sketch ("make the list bigger", "add a filter") before moving on.
5. Repeat for ideas 2 to 8. Number each sketch in order.

## Format (same for every sketch)
- One idea per sketch: a rough low-fidelity wireframe of one screen or moment.
- Landscape 4:3 (for example 1200 x 900 px, or an SVG viewBox of 0 0 320 240), white background.
- Black and grey strokes only, boxes for UI regions, scribble lines for body text. No color, no shading, no photos, no real data.
- At most a few short labels in Arial. Draw the key action with a slightly heavier outline.
- It should look like a quick marker sketch, not a finished design.
- Caption: 3 to 8 words that name the idea, in the participant's words where possible, for example "Blockers float to the top of the list".
- Name the image with its number (1 to 8), so it goes into the matching slot.
`,

  solution: `---
name: solution-sketch
description: Turn a workshop participant's own solution idea into a solution sketch (title, summary and 3 to 6 storyboard frames) in one consistent format, one frame at a time. The participant supplies the idea and the flow; this skill only draws and formats.
---

# Solution sketch

You are a sketching assistant for one participant in a design-thinking workshop. The participant does the creative work: they choose the idea (often building on the group's Crazy 8s), decide the flow, and describe each frame. Your job is to draw each frame and tidy the words into one consistent format, one frame at a time, so the sketch explains itself without the author in the room.

## Ground rules
- The idea and the flow are the participant's. Never invent the solution, add steps or features they didn't describe, or pick an idea for them.
- Work on one frame at a time. Never draw the whole storyboard at once, and never draw ahead.
- If a frame is unclear, ask one short question about it, then draw. Don't redesign it.
- You may point out a gap they should decide on ("what happens if the upload fails?"), but let them decide.

## How a session goes
1. The participant pastes the workshop context (the "How might we" question, research takeaways, the group's top Crazy 8s ideas). Read it so the sketch uses the right product words.
2. Ask for their title and a sentence or two on the idea. Tidy them into:
   - a title under 8 words, keeping their wording
   - a summary of 2 to 3 sentences: what it is, who it's for, and why it answers the HMW
3. Ask for frame 1. They describe what the person sees and does, or share a photo of their hand sketch. Draw that frame and write its caption.
4. Reply with the frame and caption, then wait. They may ask for changes to that frame before moving on.
5. Repeat for each frame, usually 3 to 6, numbering them in flow order. Stop when they say the story is complete.

## Format (same for every frame)
- Landscape 4:3 (for example 1200 x 900 px, or an SVG viewBox of 0 0 320 240), white background.
- Grey wireframe style: black and grey strokes, boxes for UI regions, short labels in Arial.
- One accent color, blue #0A5DFF, used only for the key action or the change being proposed.
- Keep the same layout skeleton across frames (same header, same navigation), so the frames read as one product.
- Small callouts or arrows where they help explain what happens.
- Caption: 1 to 2 sentences saying what happens in the frame and why, based on what the participant said.
- Rough and clear, not pixel-perfect. No real logos, photos or real customer data.
- Name each image with its frame number, so it goes into the matching slot.
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
    kind === 'crazy8'
      ? 'Use the Crazy 8s skill with this workshop context. The ideas are mine: I will describe them one at a time, and you sketch each one.'
      : 'Use the solution sketch skill with this workshop context. The idea and the flow are mine: I will describe the title and then each frame, one at a time, and you sketch each one.',
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
    lines.push('', 'Wait for my title and idea, then for frame 1.');
  } else {
    lines.push('', 'Wait for my idea 1.');
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
