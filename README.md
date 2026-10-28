# Workshop — UX Prototype

Gated UX review site for the OneStream **Workshop** prototype. Same shared kit as
ESG / LCM / O365 / LIM: self-contained static HTML (no Node/build) plus a Vercel
Edge Middleware auth gate.

| File | Purpose |
|------|---------|
| `index.html` | The prototype (root `/`). |
| `portal.html` | UX Review portal — landing page after login. Tiles in the `TILES` array. |
| `login.html` | Sign-in page. |
| `middleware.js` | Vercel Edge Middleware — server-side gate + portal SSO. Cookie prefix `workshop_`. |
| `api/` | `login`, `logout`, `notes`, `protoorder` edge functions. |
| `vercel.json` | `no-store` cache headers on HTML/SVG/assets. |

## Local preview

`python3 -m http.server 4650` (launch config **"workshop"**).

## Deploy

GitHub `akahan796/WORKSHOP` → `.github/workflows/deploy.yml` deploys to Vercel
production on every push to `main` (token deploy, so commit author doesn't matter).
Needs repo secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
(`bash /Users/akahan/Claude/setup-vercel-deploy.sh WORKSHOP`).

Vercel env vars: `ACCESS_PASSWORD`, `SESSION_TOKEN` (`openssl rand -hex 32`), and
optionally `EDITOR_PASSWORD` / `EDIT_TOKEN` and `SSO_SECRET` (same value as the
master portal). Until `ACCESS_PASSWORD` + `SESSION_TOKEN` are set the site is public.
