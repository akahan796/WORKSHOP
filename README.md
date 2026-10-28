# Workshop AI

A OneStream app for organizing and running UX design-thinking workshops live.
Organizers set up the workshop and invite people; researchers share findings;
participants join from a personal guest link and contribute at each step.
Full spec and phase plan: [SPEC.md](SPEC.md).

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

## Local preview

`python3 -m http.server 4650` (launch config **"workshop"**). With `config.js`
empty it runs in demo mode. Open invite links in other tabs to play the
researcher and participants side by side; each tab is its own user.

## Going live with Supabase

1. Create a Supabase project and run `supabase/schema.sql` in the SQL Editor.
2. In Authentication → Sign In / Providers, enable **Email** and **Allow anonymous sign-ins**.
   For quick testing, turn off "Confirm email".
3. Put the project URL and anon key in `config.js`, then push.

## Deploy

GitHub `akahan796/WORKSHOP` → `.github/workflows/deploy.yml` deploys to Vercel
production on every push to `main`. The workflow needs repo secrets `VERCEL_TOKEN`,
`VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`
(`bash /Users/akahan/Claude/setup-vercel-deploy.sh WORKSHOP`). There is no
site-wide password gate: guests reach the app straight from their invite link,
and Supabase RLS protects the data.
