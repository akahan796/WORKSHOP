// ─────────────────────────────────────────────────────────────────────────────
// Vercel Edge Function — validates the password on the SERVER.
//
// Reads ACCESS_PASSWORD and SESSION_TOKEN from environment variables (set in the
// Vercel dashboard — never shipped to the browser). On a correct password it sets
// an HttpOnly, Secure, session cookie (no expiry → cleared when the browser
// session ends) and redirects to the landing page. Otherwise it bounces back to
// the login page with an error flag (?e=1).
// ─────────────────────────────────────────────────────────────────────────────

export const config = { runtime: 'edge' };

const COOKIE_NAME = 'workshop_auth';          // must match middleware.js / logout.js
const REDIRECT_AFTER_LOGIN = '/portal.html'; // where a successful login lands

export default async function handler(request) {
  const origin = new URL(request.url).origin;
  if (request.method !== 'POST') {
    return Response.redirect(origin + '/login.html', 302);
  }

  let password = '';
  let next = '';
  try {
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const body = await request.json();
      password = body.password || '';
      next = body.next || '';
    } else {
      const form = await request.formData();
      password = form.get('password') || '';
      next = form.get('next') || '';
    }
  } catch (e) { /* ignore malformed body */ }
  // Fall back to a ?next= query param if present.
  next = next || new URL(request.url).searchParams.get('next') || '';

  // Only allow a safe, same-origin relative path (blocks open-redirects).
  function safeNext(n) {
    if (typeof n === 'string' && /^\/[^/\\]/.test(n) && !n.startsWith('/login.html') && !n.startsWith('/api/')) return n;
    return REDIRECT_AFTER_LOGIN;
  }

  const token = process.env.SESSION_TOKEN;
  const viewerPw = process.env.ACCESS_PASSWORD;   // standard reviewer login
  const editorPw = process.env.EDITOR_PASSWORD;   // can add/move/remove UX notes

  let role = null;
  if (editorPw && password === editorPw) role = 'editor';
  else if (viewerPw && password === viewerPw) role = 'viewer';

  if (token && role) {
    const headers = new Headers({ 'Location': origin + safeNext(next), 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`);
    // Readable role hint (UI only) + HttpOnly write-gate for the shared notes store.
    headers.append('Set-Cookie', `workshop_role=${role}; Path=/; Secure; SameSite=Lax`);
    const editTok = process.env.EDIT_TOKEN;
    if (role === 'editor' && editTok) {
      headers.append('Set-Cookie', `workshop_edit=${editTok}; Path=/; HttpOnly; Secure; SameSite=Lax`);
    } else {
      headers.append('Set-Cookie', `workshop_edit=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    }
    return new Response(null, { status: 303, headers });
  }

  const errLoc = '/login.html?e=1' +
    (/^\/[^/\\]/.test(next) ? '&next=' + encodeURIComponent(next) : '');
  return new Response(null, {
    status: 303,
    headers: { 'Location': origin + errLoc, 'Cache-Control': 'no-store' },
  });
}
