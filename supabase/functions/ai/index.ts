// ─────────────────────────────────────────────────────────────────────────────
// Workshop AI — Claude edge function (Supabase, Deno).
//
// POST { task, workshop_id, ... } with the organizer's Supabase session token.
// Returns plain JSON results; the app writes them to the database itself, so
// this function never needs elevated database access.
//
// Tasks:
//   place_grid          HMWs → impact/effort scores (0–100) + rationale
//   synth_participants  create AI participant personas
//   synth_research      research-share-out stickies from each AI participant
//   synth_hmw           HMW statements from each AI participant
//   synth_votes         dot votes from each AI participant
//   decide_hmw          the AI Decider's final pick among HMW candidates
//   synth_crazy8        one AI participant's Crazy 8s sketches (SVG wireframes); `count`/`angle`/`avoid` for batches
//   synth_solution      one AI participant's solution sketch (title, summary, 3–4 SVG frames)
//   synth_comments      AI participants' review comments on solution sketches
//   decide_solution     the AI Decider's final pick of a solution direction
//   draft_flow          the user flow for the chosen direction (steps, details, questions)
//   generate_prototype  a clickable, self-contained HTML prototype of the flow
//   revise_prototype    a new prototype version that addresses review feedback
//   synth_feedback      AI participants' design review feedback
// synth_votes takes `round` ('hmw' | 'crazy8' | 'solution'); sketch rounds
// send Claude the uploaded sketch images.
//
// Secrets (Edge Functions → Secrets): ANTHROPIC_API_KEY (required);
// AI_MODEL (optional, default claude-opus-5-5), e.g. claude-haiku-5-5 for a
// much cheaper, somewhat less sharp model. Changing a secret needs no redeploy.
// SUPABASE_URL / SUPABASE_ANON_KEY are provided by Supabase automatically.
// ─────────────────────────────────────────────────────────────────────────────
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const MODEL = (Deno.env.get("AI_MODEL") || "claude-opus-5-5").trim();
// Models that accept server-side refusal fallbacks. Others (e.g. Claude Haiku
// 5.5) have none, so the parameter is left off their requests.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);
const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const DISCIPLINES: Record<string, string> = { design: "Product Design", pm: "Product Management", eng: "Engineering" };

// One Claude call that must answer through a single strict tool. Forced
// tool_choice isn't available on Claude Opus 5.5, so the prompt names the tool
// and `strict: true` keeps the arguments schema-valid.
async function callTool(system: string, content: Anthropic.Beta.BetaContentBlockParam[], tool: { name: string; description: string; input_schema: Record<string, unknown> }, maxTokens = 16000, effort = "medium") {
  // Streamed (the SDK requires it for large max_tokens); finalMessage() returns the whole reply.
  const response = await anthropic.beta.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    // A declined request is retried server-side on Anthropic's recommended fallback model.
    ...(FALLBACK_MODELS.has(MODEL) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
    output_config: { effort },
    system: system + `\n\nRespond by calling the ${tool.name} tool exactly once.`,
    // No eager_input_streaming: nothing here reads partial tool input, and leaving it off keeps strict validation.
    tools: [{ ...tool, strict: true }],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content }],
  } as Anthropic.Beta.MessageCreateParamsStreaming).finalMessage();
  if (response.stop_reason === "max_tokens") throw new Error("The AI ran out of room before finishing. Try again.");
  if (response.stop_reason === "refusal") throw new Error("The AI declined this request. Try rewording the workshop details, or try again.");
  const block = response.content.find((b) => b.type === "tool_use" && b.name === tool.name);
  if (!block || block.type !== "tool_use" || !block.input || typeof block.input !== "object") throw new Error("The AI didn't return a result. Try again.");
  return block.input as Record<string, any>;
}

// A Claude call whose answer is one self-contained HTML document (too large to
// pass through a tool call comfortably). Returns the HTML, or throws.
async function callHtml(system: string, content: Anthropic.Beta.BetaContentBlockParam[]) {
  const response = await anthropic.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    ...(FALLBACK_MODELS.has(MODEL) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
    output_config: { effort: "low" }, // keeps generation inside the edge function's time limit
    system: system + "\n\nReply with only the complete HTML document, from <!doctype html> to </html>. No commentary, no code fences.",
    messages: [{ role: "user", content }],
  } as Anthropic.Beta.MessageCreateParamsStreaming).finalMessage();
  if (response.stop_reason === "max_tokens") throw new Error("The prototype was too large to finish. Try again, or simplify the flow.");
  if (response.stop_reason === "refusal") throw new Error("The AI declined this request. Try again.");
  const text = response.content.filter((b) => b.type === "text").map((b: any) => b.text).join("");
  const start = text.search(/<!doctype html|<html/i), end = text.toLowerCase().lastIndexOf("</html>");
  if (start < 0 || end < 0) throw new Error("The AI didn't return a complete prototype. Try again.");
  return text.slice(start, end + 7);
}

function base64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Shared context: what the workshop is about, plus (optionally) the research deck as a PDF.
async function workshopContext(sb: any, ws: any, withDeck: boolean) {
  const intro = ws.intro || {};
  const text = [
    `Workshop: ${ws.title}`,
    ws.project && `Project / subject: ${ws.project}`,
    ws.description && `Goal: ${ws.description}`,
    intro.background && `Project background: ${intro.background}`,
  ].filter(Boolean).join("\n");
  let chosen = "";
  const finalId = ws.step_state?.hmw_final?.sticky_id;
  if (finalId) {
    const { data: st } = await sb.from("stickies").select("text").eq("id", finalId).maybeSingle();
    if (st) chosen = `\nThe HMW the group chose to carry forward: ${st.text}`;
  }
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (withDeck) {
    const { data: decks } = await sb.from("research").select("*").eq("workshop_id", ws.id).order("created_at").limit(1);
    if (decks && decks[0]) {
      const { data: file } = await sb.storage.from("research").download(decks[0].file_path);
      if (file) {
        blocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64(new Uint8Array(await file.arrayBuffer())) },
          title: decks[0].title,
        });
      }
    }
  }
  return { text: text + chosen, blocks };
}

async function synthMembers(sb: any, wsId: string) {
  const { data } = await sb.from("members").select("id, name, discipline, persona, is_decider").eq("workshop_id", wsId).eq("is_synthetic", true);
  return data || [];
}

const personaList = (members: any[]) =>
  members.map((m) => `- member_id ${m.id}: ${m.name} (${DISCIPLINES[m.discipline] || "Participant"}${m.is_decider ? ", the Decider" : ""}). ${m.persona}`).join("\n");

// Uploaded sketch images (PNG/JPEG/WebP/GIF) as image blocks, each labeled with
// its id. SVGs (AI-drawn) can't be sent as images, so they are described by caption.
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
async function sketchImages(sb: any, items: { id: string; label: string; image_paths?: string[] }[], cap = 40) {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  let n = 0;
  for (const it of items) {
    for (const path of it.image_paths || []) {
      const type = IMAGE_TYPES[(path.split(".").pop() || "").toLowerCase()];
      if (!type || n >= cap) continue;
      const { data: file } = await sb.storage.from("sketches").download(path);
      if (!file || file.size > 4.5e6) continue;
      blocks.push({ type: "text", text: `Image for ${it.label} (id ${it.id}):` });
      blocks.push({ type: "image", source: { type: "base64", media_type: type as "image/png", data: base64(new Uint8Array(await file.arrayBuffer())) } });
      n++;
    }
  }
  return blocks;
}

// Keep AI-drawn SVG to plain drawing: no scripts, event handlers, or external references.
function cleanSvg(svg: string) {
  let s = String(svg || "").trim();
  const i = s.indexOf("<svg");
  if (i < 0) return null;
  s = s.slice(i);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "").replace(/(href|xlink:href)\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, "");
  if (!/<\/svg>\s*$/.test(s)) return null; // cut off mid-drawing
  s = s.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/gi, "&amp;");
  if (!/xmlns=/.test(s)) s = s.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  return s.length < 60000 ? s : null;
}

// The direction the group chose (solution_final), with its frames and review comments.
async function chosenSolution(sb: any, ws: any) {
  const id = ws.step_state?.solution_final?.sheet_id;
  if (!id) return null;
  const { data: sheet } = await sb.from("sheets").select("*").eq("id", id).maybeSingle();
  if (!sheet) return null;
  const { data: author } = await sb.from("members").select("name").eq("id", sheet.member_id).maybeSingle();
  const { data: comments } = await sb.from("stickies").select("text, data").eq("workshop_id", ws.id).eq("step", "review");
  const notes = (comments || []).filter((c: any) => c.data?.sheet_id === id).map((c: any) => c.text);
  const text = `Chosen direction: "${sheet.title}" by ${author?.name || "a participant"}.\n${sheet.summary}\nFrames:\n${sheet.cells.map((c: any, i: number) => `${i + 1}. ${c.caption}`).join("\n")}${notes.length ? `\nReview comments on the sketches:\n${notes.map((n: string) => `- ${n}`).join("\n")}` : ""}${ws.step_state?.solution_final?.rationale ? `\nWhy it was chosen: ${ws.step_state.solution_final.rationale}` : ""}`;
  const images = await sketchImages(sb, [{ id: sheet.id, label: `"${sheet.title}"`, image_paths: sheet.cells.map((c: any) => c.file_path).filter(Boolean) }], 8);
  return { sheet, text, images };
}

const flowText = (flow: any) => flow ? `User flow "${flow.title || ""}":\n${(flow.steps || []).map((s: any, i: number) => `${i + 1}. [${s.actor}] ${s.title}${s.screen ? ` (screen: ${s.screen})` : ""}: ${s.detail || ""}`).join("\n")}${(flow.details || []).length ? `\nImplementation details:\n${flow.details.map((d: any) => `- ${typeof d === "string" ? d : d.text}`).join("\n")}` : ""}` : "";

const PROTOTYPE_RULES = "Build a clickable, high-fidelity prototype of a OneStream enterprise web app as ONE self-contained HTML file: inline CSS and vanilla JavaScript only, no external scripts, fonts, images or network requests. Use Arial, brand blue #0A5DFF, neutral greys, 8px radius cards, and realistic sample data for the product described. Show each screen of the flow, wired with working buttons and links that move between screens (show one screen at a time), plus a small fixed 'Screens' menu to jump to any screen. Keep it under about 600 lines.";

const SVG_RULES = 'Each sketch is a rough, low-fidelity UI wireframe drawn as one self-contained SVG: viewBox="0 0 320 240", white background rect, black and grey strokes, boxes for UI regions, and a few short text labels (font-family Arial, font-size 10–14). Keep each under about 30 elements. No images, scripts, links, or foreignObject.';

const SYSTEM = "You support a OneStream UX design-thinking workshop. Be concrete, specific to the product and users described, and write like a thoughtful practitioner, not a consultant.";

const TASKS: Record<string, (sb: any, ws: any, body: any) => Promise<unknown>> = {
  async place_grid(sb, ws, body) {
    const items: { id: string; text: string }[] = body.items || [];
    if (!items.length) return { placements: [] };
    const ctx = await workshopContext(sb, ws, true);
    const out = await callTool(
      SYSTEM + " You are placing How Might We (HMW) statements on an Impact/Effort grid.",
      [...ctx.blocks, { type: "text", text: `${ctx.text}\n\nScore each HMW below.\n- impact: 0–100, how much solving it would improve outcomes for the users and business described.\n- effort: 0–100, how hard it would likely be to deliver (design, engineering, data, change management).\nUse the full range so the statements spread across all four quadrants where justified. 50 is the quadrant boundary, so never give exactly 50: commit to one side. Give a one-sentence rationale for each.\n\nHMWs:\n${items.map((i) => `- id ${i.id}: ${i.text}`).join("\n")}` }],
      {
        name: "place_on_grid",
        description: "Record an impact and effort score for every HMW.",
        input_schema: {
          type: "object", additionalProperties: false, required: ["placements"],
          properties: { placements: { type: "array", items: {
            type: "object", additionalProperties: false, required: ["id", "impact", "effort", "rationale"],
            properties: { id: { type: "string" }, impact: { type: "integer" }, effort: { type: "integer" }, rationale: { type: "string" } },
          } } },
        },
      },
    );
    const ids = new Set(items.map((i) => i.id));
    const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
    return { placements: (out.placements || []).filter((p: any) => ids.has(p.id)).map((p: any) => ({ ...p, impact: clamp(p.impact), effort: clamp(p.effort) })) };
  },

  async synth_participants(sb, ws, body) {
    const count = Math.max(1, Math.min(8, Number(body.count) || 3));
    const disciplines: string[] = (body.disciplines || ["design", "pm", "eng"]).filter((d: string) => DISCIPLINES[d]);
    const { data: existing } = await sb.from("members").select("name").eq("workshop_id", ws.id);
    const ctx = await workshopContext(sb, ws, false);
    const out = await callTool(
      SYSTEM + " You create realistic synthetic workshop participants: OneStream colleagues who will contribute stickies, HMWs and votes alongside the real team.",
      [{ type: "text", text: `${ctx.text}\n\nCreate ${count} synthetic participant(s). Spread them across these disciplines: ${disciplines.map((d) => `${d} (${DISCIPLINES[d]})`).join(", ")}.\nFor each, give a realistic full name (not any of: ${(existing || []).map((e: any) => e.name).join(", ") || "none"}), a discipline, and a 2–3 sentence persona: their role, what they care about, and the perspective they bring to this subject.${body.guidance ? `\nOrganizer guidance: ${body.guidance}` : ""}` }],
      {
        name: "create_participants",
        description: "Create the synthetic participants.",
        input_schema: {
          type: "object", additionalProperties: false, required: ["participants"],
          properties: { participants: { type: "array", items: {
            type: "object", additionalProperties: false, required: ["name", "discipline", "persona"],
            properties: { name: { type: "string" }, discipline: { type: "string", enum: disciplines }, persona: { type: "string" } },
          } } },
        },
      },
    );
    return { participants: (out.participants || []).slice(0, count) };
  },

  async synth_research(sb, ws) {
    const members = await synthMembers(sb, ws.id);
    if (!members.length) return { contributions: [] };
    const ctx = await workshopContext(sb, ws, true);
    const out = await callTool(
      SYSTEM + " You play each synthetic participant listening to the UX research share-out and silently capturing sticky notes.",
      [...ctx.blocks, { type: "text", text: `${ctx.text}\n\nThe attached deck is the research being presented${ctx.blocks.length ? "" : " (no deck was uploaded, so work from the context above)"}.\nFor each participant below, write 3–5 stickies in their own voice, one idea per sticky, each under 20 words. Kinds: pain (pain point), opportunity, observation, question (for Q&A). Ground them in the research and in each person's perspective.\n\nParticipants:\n${personaList(members)}` }],
      {
        name: "add_stickies",
        description: "Add each participant's research stickies.",
        input_schema: {
          type: "object", additionalProperties: false, required: ["contributions"],
          properties: { contributions: { type: "array", items: {
            type: "object", additionalProperties: false, required: ["member_id", "stickies"],
            properties: { member_id: { type: "string" }, stickies: { type: "array", items: {
              type: "object", additionalProperties: false, required: ["kind", "text"],
              properties: { kind: { type: "string", enum: ["pain", "opportunity", "observation", "question"] }, text: { type: "string" } },
            } } },
          } } },
        },
      },
    );
    const ids = new Set(members.map((m: any) => m.id));
    return { contributions: (out.contributions || []).filter((c: any) => ids.has(c.member_id)) };
  },

  async synth_hmw(sb, ws) {
    const members = await synthMembers(sb, ws.id);
    if (!members.length) return { contributions: [] };
    const ctx = await workshopContext(sb, ws, false);
    const { data: notes } = await sb.from("stickies").select("kind, text").eq("workshop_id", ws.id).eq("step", "research");
    const out = await callTool(
      SYSTEM + ' You play each synthetic participant writing "How might we…" statements.',
      [{ type: "text", text: `${ctx.text}\n\nStickies the group captured during the research share-out:\n${(notes || []).map((n: any) => `- [${n.kind}] ${n.text}`).join("\n") || "(none)"}\n\nFor each participant below, write 2–4 HMW statements from their perspective. Each must be broad enough to allow many solutions and narrow enough to act on. Write only the part after "How might we" (e.g. "help reviewers see close status at a glance?").\n\nParticipants:\n${personaList(members)}` }],
      {
        name: "add_hmws",
        description: "Add each participant's HMW statements.",
        input_schema: {
          type: "object", additionalProperties: false, required: ["contributions"],
          properties: { contributions: { type: "array", items: {
            type: "object", additionalProperties: false, required: ["member_id", "hmws"],
            properties: { member_id: { type: "string" }, hmws: { type: "array", items: { type: "string" } } },
          } } },
        },
      },
    );
    const ids = new Set(members.map((m: any) => m.id));
    return { contributions: (out.contributions || []).filter((c: any) => ids.has(c.member_id)) };
  },

  async synth_votes(sb, ws, body) {
    const members = await synthMembers(sb, ws.id);
    const round = ["crazy8", "solution"].includes(body.round) ? body.round : "hmw";
    const dots = Math.max(1, Math.min(10, Number(body.dots) || 3));
    const candidates: { id: string; text: string; quadrant?: string; image_paths?: string[] }[] = body.candidates || [];
    if (!members.length || !candidates.length) return { ballots: [] };
    const ctx = await workshopContext(sb, ws, false);
    const what = { hmw: "HMW statements to pick the most important problem or opportunity", crazy8: "individual Crazy 8s sketches (single sketches, not whole sheets)", solution: "solution sketches to choose a direction" }[round];
    const extra = { hmw: " Consider the Impact/Effort placement.", crazy8: " Look at the sketch images where provided.", solution: " Look at the sketch images where provided, and judge how well each answers the chosen HMW." }[round];
    const images = round === "hmw" ? [] : await sketchImages(sb, candidates.map((c) => ({ id: c.id, label: c.text.slice(0, 80), image_paths: c.image_paths })));
    const out = await callTool(
      SYSTEM + ` You play each synthetic participant dot-voting on ${what}.`,
      [...images, { type: "text", text: `${ctx.text}\n\nEach participant has ${dots} dots. They may put several dots on one candidate, and may vote for their own.${extra} Vote from each person's perspective.\n\nCandidates:\n${candidates.map((c) => `- id ${c.id}${c.quadrant ? ` [${c.quadrant}]` : ""}: ${c.text}`).join("\n")}\n\nParticipants:\n${personaList(members)}` }],
      {
        name: "cast_votes",
        description: "Record each participant's dot votes and a one-sentence reason.",
        input_schema: {
          type: "object", additionalProperties: false, required: ["ballots"],
          properties: { ballots: { type: "array", items: {
            type: "object", additionalProperties: false, required: ["member_id", "votes", "reasoning"],
            properties: {
              member_id: { type: "string" },
              votes: { type: "array", items: { type: "object", additionalProperties: false, required: ["sticky_id", "dots"], properties: { sticky_id: { type: "string" }, dots: { type: "integer" } } } },
              reasoning: { type: "string" },
            },
          } } },
        },
      },
    );
    const ids = new Set(members.map((m: any) => m.id));
    const valid = new Set(candidates.map((c) => c.id));
    // Enforce the dot budget: valid targets only, at most `dots` per ballot.
    const ballots = (out.ballots || []).filter((b: any) => ids.has(b.member_id)).map((b: any) => {
      let left = dots;
      const votes = (b.votes || []).filter((v: any) => valid.has(v.sticky_id)).map((v: any) => {
        const n = Math.max(0, Math.min(left, Math.round(Number(v.dots) || 0)));
        left -= n;
        return { sticky_id: v.sticky_id, dots: n };
      }).filter((v: any) => v.dots > 0);
      return { member_id: b.member_id, votes, reasoning: b.reasoning };
    });
    return { ballots };
  },

  async decide_hmw(sb, ws, body) {
    const candidates: { id: string; text: string; score: number; quadrant?: string }[] = body.candidates || [];
    if (!candidates.length) throw new Error("No candidates to decide between.");
    const { data: decider } = await sb.from("members").select("name, discipline, persona").eq("workshop_id", ws.id).eq("is_decider", true).maybeSingle();
    const ctx = await workshopContext(sb, ws, false);
    const out = await callTool(
      SYSTEM + ` You are the workshop's Decider${decider ? `, ${decider.name} (${DISCIPLINES[decider.discipline] || "Participant"}). ${decider.persona}` : ""}. You make the final call on which HMW the group carries forward.`,
      [{ type: "text", text: `${ctx.text}\n\nThe group dot-voted (the Decider's dots count double). Pick ONE HMW to carry forward. Weigh the votes, the Impact/Effort placement, and what will matter most to users; you may overrule the vote if you can say why. Explain your call in 2–3 sentences addressed to the group.\n\nCandidates (highest score first):\n${candidates.map((c) => `- sticky_id ${c.id} · score ${c.score}${c.quadrant ? ` · ${c.quadrant}` : ""}: ${c.text}`).join("\n")}` }],
      {
        name: "make_decision",
        description: "Record the chosen HMW and the reasoning.",
        input_schema: {
          type: "object", additionalProperties: false, required: ["sticky_id", "rationale"],
          properties: { sticky_id: { type: "string", enum: candidates.map((c) => c.id) }, rationale: { type: "string" } },
        },
      },
    );
    return { sticky_id: out.sticky_id, rationale: out.rationale };
  },

  async synth_crazy8(sb, ws, body) {
    const members = (await synthMembers(sb, ws.id)).filter((m: any) => m.id === body.member_id);
    if (!members.length) throw new Error("Unknown AI participant.");
    const ctx = await workshopContext(sb, ws, false);
    const tool = {
      name: "add_sketches",
      description: "Add the Crazy 8s sketches.",
      input_schema: {
        type: "object", additionalProperties: false, required: ["sketches"],
        properties: { sketches: { type: "array", items: {
          type: "object", additionalProperties: false, required: ["caption", "svg"],
          properties: { caption: { type: "string" }, svg: { type: "string" } },
        } } },
      },
    };
    // The app asks in parallel batches (e.g. 2 × 4) with a different angle each, so
    // participants finish sooner. If fewer usable sketches come back, ask once more.
    const target = Math.max(1, Math.min(8, Number(body.count) || 8));
    const angle = body.angle ? `\nFor this batch: ${String(body.angle).slice(0, 300)}` : "";
    const avoid: string[] = (body.avoid || []).map(String).slice(0, 16);
    const cells: { caption: string; svg: string }[] = [];
    for (let attempt = 0; attempt < 2 && cells.length < target; attempt++) {
      const need = target - cells.length;
      const done = [...avoid, ...cells.map((c) => c.caption)];
      const have = done.length ? `\nAlready sketched: ${done.join("; ")}. Make ${need} more that are different from these.` : "";
      const out = await callTool(
        SYSTEM + " You play one synthetic participant doing Crazy 8s: eight quick, genuinely different ideas in eight minutes.",
        [{ type: "text", text: `${ctx.text}\n\nYou are:\n${personaList(members)}\n\nSketch exactly ${need} different ideas that answer the chosen HMW, from your perspective. Go wide: vary the approach, not just the layout. ${SVG_RULES} Give each a caption under 12 words.${angle}${have}` }],
        tool, 32000,
      );
      for (const c of out.sketches || []) {
        const svg = cleanSvg(c.svg);
        if (svg && c.caption && cells.length < target) cells.push({ caption: c.caption, svg });
      }
    }
    return { cells };
  },

  async synth_solution(sb, ws, body) {
    const members = (await synthMembers(sb, ws.id)).filter((m: any) => m.id === body.member_id);
    if (!members.length) throw new Error("Unknown AI participant.");
    const ideas: { id: string; caption: string; author: string; votes?: number }[] = body.ideas || [];
    const ctx = await workshopContext(sb, ws, false);
    const out = await callTool(
      SYSTEM + " You play one synthetic participant turning the strongest Crazy 8s idea into a detailed solution sketch.",
      [{ type: "text", text: `${ctx.text}\n\nYou are:\n${personaList(members)}\n\nCrazy 8s ideas from the group (with votes):\n${ideas.map((i) => `- id ${i.id} · ${i.votes || 0} votes · by ${i.author}: ${i.caption}`).join("\n") || "(none)"}\n\nPick the idea you think is strongest (yours or anyone's; riffing on someone else's is encouraged), or "none". Develop it into a solution sketch: a clear title, a 2–3 sentence summary, and 3–4 frames that show a flow or interaction, each a picture plus a caption that explains what happens. ${SVG_RULES}` }],
      {
        name: "create_solution",
        description: "Create the solution sketch.",
        input_schema: {
          type: "object", additionalProperties: false, required: ["title", "summary", "based_on", "frames"],
          properties: {
            title: { type: "string" }, summary: { type: "string" },
            based_on: { type: "string", enum: [...ideas.map((i) => i.id), "none"] },
            frames: { type: "array", items: { type: "object", additionalProperties: false, required: ["caption", "svg"], properties: { caption: { type: "string" }, svg: { type: "string" } } } },
          },
        },
      },
      32000,
    );
    return {
      title: out.title, summary: out.summary, based_on: out.based_on === "none" ? null : out.based_on,
      frames: (out.frames || []).slice(0, 6).map((f: any) => ({ caption: f.caption, svg: cleanSvg(f.svg) })),
    };
  },

  async synth_comments(sb, ws, body) {
    const members = await synthMembers(sb, ws.id);
    const solutions: { id: string; member_id: string; author: string; title: string; summary: string; captions: string[]; image_paths?: string[] }[] = body.solutions || [];
    if (!members.length || !solutions.length) return { comments: [] };
    const ctx = await workshopContext(sb, ws, false);
    const images = await sketchImages(sb, solutions.map((x) => ({ id: x.id, label: `"${x.title}"`, image_paths: x.image_paths })), 30);
    const out = await callTool(
      SYSTEM + " You play each synthetic participant reviewing the group's solution sketches.",
      [...images, { type: "text", text: `${ctx.text}\n\nSolution sketches:\n${solutions.map((x) => `- id ${x.id} · "${x.title}" by ${x.author} (member ${x.member_id}): ${x.summary}\n  Frames: ${x.captions.join(" → ")}`).join("\n")}\n\nFor each participant below, write 1–2 short, constructive review comments (under 30 words each) on other people's sketches, never their own: a strength, a question, or a build-on idea, from their perspective.\n\nParticipants:\n${personaList(members)}` }],
      {
        name: "add_comments",
        description: "Add the review comments.",
        input_schema: {
          type: "object", additionalProperties: false, required: ["comments"],
          properties: { comments: { type: "array", items: {
            type: "object", additionalProperties: false, required: ["member_id", "sheet_id", "text"],
            properties: { member_id: { type: "string" }, sheet_id: { type: "string" }, text: { type: "string" } },
          } } },
        },
      },
    );
    const ids = new Set(members.map((m: any) => m.id));
    const owner = Object.fromEntries(solutions.map((x) => [x.id, x.member_id]));
    return { comments: (out.comments || []).filter((c: any) => ids.has(c.member_id) && owner[c.sheet_id] && owner[c.sheet_id] !== c.member_id) };
  },

  async decide_solution(sb, ws, body) {
    const candidates: { id: string; text: string; score: number; image_paths?: string[] }[] = body.candidates || [];
    if (!candidates.length) throw new Error("No solution sketches to decide between.");
    const { data: decider } = await sb.from("members").select("name, discipline, persona").eq("workshop_id", ws.id).eq("is_decider", true).maybeSingle();
    const ctx = await workshopContext(sb, ws, false);
    const images = await sketchImages(sb, candidates.map((c) => ({ id: c.id, label: c.text.slice(0, 80), image_paths: c.image_paths })), 30);
    const out = await callTool(
      SYSTEM + ` You are the workshop's Decider${decider ? `, ${decider.name} (${DISCIPLINES[decider.discipline] || "Participant"}). ${decider.persona}` : ""}. You make the final call on which solution direction moves into design.`,
      [...images, { type: "text", text: `${ctx.text}\n\nThe group dot-voted on solution sketches (the Decider's dots count double). Pick ONE direction to carry into design. Weigh the votes, how well it answers the chosen HMW, and feasibility; you may overrule the vote if you can say why, and you may name one element from another sketch to fold in. Explain your call in 2–4 sentences addressed to the group.\n\nCandidates (highest score first):\n${candidates.map((c) => `- id ${c.id} · score ${c.score}: ${c.text}`).join("\n")}` }],
      {
        name: "make_decision",
        description: "Record the chosen solution and the reasoning.",
        input_schema: {
          type: "object", additionalProperties: false, required: ["sheet_id", "rationale"],
          properties: { sheet_id: { type: "string", enum: candidates.map((c) => c.id) }, rationale: { type: "string" } },
        },
      },
    );
    return { sheet_id: out.sheet_id, rationale: out.rationale };
  },

  async draft_flow(sb, ws) {
    const sol = await chosenSolution(sb, ws);
    if (!sol) throw new Error("Choose a direction in the previous step first.");
    const ctx = await workshopContext(sb, ws, false);
    const out = await callTool(
      SYSTEM + " You map the user flow for the solution direction the group chose, as the starting point for the group's design-details discussion.",
      [...sol.images, { type: "text", text: `${ctx.text}\n\n${sol.text}\n\nDraft the end-to-end user flow for this direction: 6–12 steps in order, each with the actor (a user role or "System"), a short title, one sentence of detail, and the screen it happens on. Then list 4–8 implementation details the team should agree on (data, states, edge cases, permissions, performance) and 2–5 open questions.` }],
      {
        name: "record_flow",
        description: "Record the user flow.",
        input_schema: {
          type: "object", additionalProperties: false, required: ["title", "steps", "details", "questions"],
          properties: {
            title: { type: "string" },
            steps: { type: "array", items: { type: "object", additionalProperties: false, required: ["actor", "title", "detail", "screen"], properties: { actor: { type: "string" }, title: { type: "string" }, detail: { type: "string" }, screen: { type: "string" } } } },
            details: { type: "array", items: { type: "string" } },
            questions: { type: "array", items: { type: "string" } },
          },
        },
      },
    );
    return out;
  },

  async generate_prototype(sb, ws, body) {
    const sol = await chosenSolution(sb, ws);
    const ctx = await workshopContext(sb, ws, false);
    const html = await callHtml(
      SYSTEM + " You are a senior product designer who prototypes in code.",
      [...(sol?.images || []), { type: "text", text: `${ctx.text}\n\n${sol ? sol.text : ""}\n\n${flowText(body.flow)}\n\n${PROTOTYPE_RULES}` }],
    );
    return { html };
  },

  async revise_prototype(sb, ws, body) {
    const feedback: { kind: string; text: string }[] = body.feedback || [];
    if (!body.html) throw new Error("There's no prototype to revise yet.");
    if (!feedback.length) throw new Error("Add some feedback first.");
    const ctx = await workshopContext(sb, ws, false);
    const html = await callHtml(
      SYSTEM + " You are a senior product designer who prototypes in code, revising a prototype after a design review.",
      [{ type: "text", text: `${ctx.text}\n\n${flowText(body.flow)}\n\nCurrent prototype:\n${String(body.html).slice(0, 120000)}\n\nDesign review feedback:\n${feedback.map((f) => `- [${f.kind}] ${f.text}`).join("\n")}\n\nRevise the prototype to address the "change" feedback and answer the questions in the design where you can, keeping what works. ${PROTOTYPE_RULES}` }],
    );
    return { html };
  },

  async synth_feedback(sb, ws, body) {
    const members = await synthMembers(sb, ws.id);
    if (!members.length || !body.html) return { feedback: [] };
    const ctx = await workshopContext(sb, ws, false);
    const out = await callTool(
      SYSTEM + " You play each synthetic participant in the design review of the prototype the workshop produced.",
      [{ type: "text", text: `${ctx.text}\n\n${flowText(body.flow)}\n\nPrototype source (HTML):\n${String(body.html).slice(0, 60000)}\n\nFor each participant below, give 2–3 short pieces of feedback (under 30 words each) from their perspective. Kinds: works (what works), change (what to change), question.\n\nParticipants:\n${personaList(members)}` }],
      {
        name: "add_feedback",
        description: "Add each participant's design review feedback.",
        input_schema: {
          type: "object", additionalProperties: false, required: ["feedback"],
          properties: { feedback: { type: "array", items: {
            type: "object", additionalProperties: false, required: ["member_id", "kind", "text"],
            properties: { member_id: { type: "string" }, kind: { type: "string", enum: ["works", "change", "question"] }, text: { type: "string" } },
          } } },
        },
      },
    );
    const ids = new Set(members.map((m: any) => m.id));
    return { feedback: (out.feedback || []).filter((f: any) => ids.has(f.member_id)) };
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await sb.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
    if (!user || user.is_anonymous) return json({ error: "Only signed-in organizers can use AI." }, 401);

    const body = await req.json();
    const task = TASKS[body.task];
    if (!task) return json({ error: `Unknown task: ${body.task}` }, 400);
    const { data: ws } = await sb.from("workshops").select("*").eq("id", body.workshop_id).maybeSingle();
    if (!ws || ws.organizer_id !== user.id) return json({ error: "Only this workshop's organizer can use AI." }, 403);

    return json(await task(sb, ws, body));
  } catch (e) {
    if (e instanceof Anthropic.NotFoundError) return json({ error: `Unknown AI model "${MODEL}". Check the AI_MODEL secret (e.g. claude-opus-5-5 or claude-haiku-5-5).` }, 500);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "The Anthropic API key is missing or invalid (Edge Function secret ANTHROPIC_API_KEY)." }, 500);
    // Billing problems arrive as a 400 whose message names the credit balance.
    if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message)) return json({ error: "The Anthropic account is out of credits. Add credits in the Anthropic Console (Plans & Billing), then try again." }, 402);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "The AI is rate limited right now. Try again in a minute." }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: `AI error ${e.status}: ${e.message}` }, 502);
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
