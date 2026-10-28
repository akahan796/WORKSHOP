# Workshop AI

A OneStream app for organizing and running UX design-thinking workshops live.
Organizers set up the workshop and invite people; researchers share findings;
participants join from a personal guest link and contribute at each step.
Full spec and phase plan: [SPEC.md](SPEC.md).

**Phase 2 (built):** synthetic AI participants (generated personas that add
stickies, HMWs and votes on request; one can be the Decider), the Impact/Effort
grid with AI placement and drag-to-adjust, and HMW dot voting with the Decider
(purple dots, counted 2×, final call by a human or AI Decider).

**Phase 1 (built):** organizer accounts, workshop setup (details, intro, agenda,
people, research), guest invite links, a live room that keeps every screen on the
organizer's current step with a shared timer, and steps 1–3: Introductions,
UX Research Share Out (synced PDF slides + silent sticky capture + reveal wall),
How Might We.

## Stack

Build-less: static files, React 18 + `htm` from esm.sh, pdf.js from jsDelivr.
No Node or build step. Data lives in **Supabase**, or in the browser in **demo mode**.

| Path | Purpose |
|------|---------|
| `index.html`, `styles.css` | App shell and styles. |
| `config.js` | Supabase URL + anon key. Empty means demo mode. |
| `src/main.js` | Hash router and auth gate. |
| `src/backend/` | `supabase.js` (real) and `demo.js` (localStorage + BroadcastChannel), with the same API. |
| `src/views/` | Auth, dashboard, setup, join, live room, step stages. |
| `src/steps.js` | The 13-step agenda from the runbook. |
| `supabase/schema.sql` | Tables, row-level security, RPCs, realtime, storage bucket. |
| `supabase/migrations/` | Changes after phase 1, run in order (`002_phase2.sql`: votes, personas, Decider RPC). |
| `supabase/functions/ai/` | Claude edge function: grid placement, synthetic participants and their contributions, AI Decider. |
| `src/ai.js` | Organizer AI actions; writes the AI's results as normal workshop data. |

## Local preview

`python3 dev-server.py` (launch config **"workshop"**, port 4650; caching off so edits always load). With `config.js`
empty it runs in demo mode. Open invite links in other tabs to play the
researcher and participants side by side; each tab is its own user.

## Going live with Supabase

1. Create a Supabase project and run `supabase/schema.sql` in the SQL Editor.
2. In Authentication → Sign In / Providers, enable **Email** and **Allow anonymous sign-ins**.
   For quick testing, turn off "Confirm email".
3. Put the project URL and anon key in `config.js`, then push.

## AI (Claude) setup

The AI runs in the Supabase edge function `ai` (Claude Opus 5.5), so the API key
never reaches the browser. Only a workshop's organizer can call it.

1. In SQL Editor, run `supabase/migrations/002_phase2.sql`.
2. Edge Functions → **Deploy a new function** → **Via editor**. Name it `ai`,
   paste `supabase/functions/ai/index.ts`, and deploy.
3. Edge Functions → **Secrets**: add `ANTHROPIC_API_KEY` (from console.anthropic.com).

Without these steps the app still works; the AI buttons show a "not set up" message.
Add `?demo` to the URL (e.g. `http://localhost:4650/?demo`) to practice with a
built-in stand-in for the AI and in-browser data.

## Deploy

GitHub `akahan796/WORKSHOP` → `.github/workflows/deploy.yml` deploys to Vercel
production on every push to `main`. The workflow needs repo secrets `VERCEL_TOKEN`,
`VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`
(`bash /Users/akahan/Claude/setup-vercel-deploy.sh WORKSHOP`). There is no
site-wide password gate: guests reach the app straight from their invite link,
and Supabase RLS protects the data.
