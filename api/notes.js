// Vercel Edge Function — shared store for the designer UX notes.
// GET  → any logged-in user reads the shared notes (returns `null` if none yet).
// POST → editors only; saves the notes so every user sees them.
//
// Storage is a Redis/KV store (Vercel KV or Upstash), reached over its REST API
// with plain fetch (no SDK). Reads env: KV_REST_API_URL/TOKEN (or the
// UPSTASH_REDIS_REST_* equivalents). If the store isn't configured, GET returns
// null and POST replies 501 so the client can fall back to local storage.

export const config = { runtime: 'edge' };

const KEY = 'workshop_comments';

function cookie(req, name){
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : '';
}

function kvCreds(){
  return {
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '',
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '',
  };
}

async function kv(command){
  const { url, token } = kvCreds();
  if (!url || !token) return { configured: false };
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!r.ok) return { configured: true, ok: false };
  const j = await r.json().catch(() => ({}));
  return { configured: true, ok: true, result: j.result };
}

const json = (body, status) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export default async function handler(request){
  // Must be a logged-in session (same gate as the rest of the app).
  const authed = cookie(request, 'workshop_auth') === process.env.SESSION_TOKEN && !!process.env.SESSION_TOKEN;
  if (!authed) return json({ error: 'unauthorized' }, 401);

  if (request.method === 'GET'){
    const res = await kv(['GET', KEY]);
    if (!res.configured) return json('null', 200);          // no store yet → client falls back
    return json(res.ok && res.result ? res.result : 'null', 200);
  }

  if (request.method === 'POST'){
    // Write access = editor. Prefer the HttpOnly EDIT_TOKEN cookie; if EDIT_TOKEN
    // isn't configured, fall back to the (login-issued) role cookie.
    const editToken = process.env.EDIT_TOKEN;
    const canWrite = editToken
      ? cookie(request, 'workshop_edit') === editToken
      : cookie(request, 'workshop_role') === 'editor';
    if (!canWrite) return json({ error: 'forbidden' }, 403);

    let text = '';
    try { text = await request.text(); } catch (e) {}
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { return json({ error: 'bad json' }, 400); }
    if (!Array.isArray(parsed)) return json({ error: 'expected array' }, 400);

    const res = await kv(['SET', KEY, JSON.stringify(parsed)]);
    if (!res.configured) return json({ error: 'store not configured' }, 501);
    return json({ ok: !!res.ok }, res.ok ? 200 : 502);
  }

  return json({ error: 'method not allowed' }, 405);
}
