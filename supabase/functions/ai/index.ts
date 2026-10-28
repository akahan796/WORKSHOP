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
async function callTool(system: string, content: Anthropic.Beta.BetaContentBlockParam[], tool: { name: string; description: string; input_schema: Record<string, unknown> }) {
  const response = await anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    // A declined request is retried server-side on Anthropic's recommended fallback model.
    ...(FALLBACK_MODELS.has(MODEL) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
    output_config: { effort: "medium" },
    system: system + `\n\nRespond by calling the ${tool.name} tool exactly once.`,
    tools: [{ ...tool, strict: true }],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content }],
  } as Anthropic.Beta.MessageCreateParamsNonStreaming);
  if (response.stop_reason === "refusal") throw new Error("The AI declined this request. Try rewording the workshop details, or try again.");
  const block = response.content.find((b) => b.type === "tool_use" && b.name === tool.name);
  if (!block || block.type !== "tool_use") throw new Error("The AI didn't return a result. Try again.");
  return block.input as Record<string, any>;
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
  return { text, blocks };
}

async function synthMembers(sb: any, wsId: string) {
  const { data } = await sb.from("members").select("id, name, discipline, persona, is_decider").eq("workshop_id", wsId).eq("is_synthetic", true);
  return data || [];
}

const personaList = (members: any[]) =>
  members.map((m) => `- member_id ${m.id}: ${m.name} (${DISCIPLINES[m.discipline] || "Participant"}${m.is_decider ? ", the Decider" : ""}). ${m.persona}`).join("\n");

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
    const dots = Math.max(1, Math.min(10, Number(body.dots) || 3));
    const candidates: { id: string; text: string; quadrant?: string }[] = body.candidates || [];
    if (!members.length || !candidates.length) return { ballots: [] };
    const ctx = await workshopContext(sb, ws, false);
    const out = await callTool(
      SYSTEM + " You play each synthetic participant dot-voting on HMW statements to pick the most important problem or opportunity.",
      [{ type: "text", text: `${ctx.text}\n\nEach participant has ${dots} dots. They may put several dots on one HMW, and may vote for their own. Vote from each person's perspective, considering the Impact/Effort placement.\n\nCandidates:\n${candidates.map((c) => `- sticky_id ${c.id}${c.quadrant ? ` [${c.quadrant}]` : ""}: ${c.text}`).join("\n")}\n\nParticipants:\n${personaList(members)}` }],
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
