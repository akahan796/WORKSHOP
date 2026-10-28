// ─────────────────────────────────────────────────────────────────────────────
// Vercel Edge Middleware — server-side access gate + UX Portal SSO hand-off.
//
// A request passes if it carries `workshop_auth` == SESSION_TOKEN (a server-only
// secret). Otherwise it is redirected to /login.html.
//
// Portal SSO: a logged-in UX Portal user arriving with a valid, short-lived
// `?__sso=` token (HMAC-signed with the shared SSO_SECRET) is logged in silently
// — the auth cookie is set and the token stripped — so no password is re-entered.
// Without SSO_SECRET configured the token is ignored and behaviour is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

const PREFIX = 'workshop'; // cookie prefix — must match api/login.js / api/logout.js

export const config = {
  matcher: ['/((?!api/|login\\.html|fonts/|brandmark\\.svg|logo\\.png|favicon\\.ico|robots\\.txt|assets/).*)'],
};

async function hmacHex(msg, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function verifySso(token, secret) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const exp = parts[0], role = parts[1] === 'editor' ? 'editor' : 'viewer', sig = parts[2];
  if (!/^\d+$/.test(exp) || Date.now() > parseInt(exp, 10)) return null;
  const expect = await hmacHex(exp + '.' + role, secret);
  if (sig.length !== expect.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expect.charCodeAt(i);
  return diff === 0 ? { role: role } : null;
}

export default async function middleware(request) {
  const secret = process.env.SESSION_TOKEN;
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + PREFIX + '_auth=([^;]+)'));
  const token = m ? m[1] : '';
  const url = new URL(request.url);

  // Portal single sign-on hand-off.
  const ssoSecret = process.env.SSO_SECRET;
  const sso = url.searchParams.get('__sso');
  if (sso && secret && ssoSecret) {
    const ok = await verifySso(sso, ssoSecret);
    if (ok) {
      url.searchParams.delete('__sso');
      const headers = new Headers({ 'Location': url.toString(), 'Cache-Control': 'no-store' });
      headers.append('Set-Cookie', `${PREFIX}_auth=${secret}; Path=/; HttpOnly; Secure; SameSite=Lax`);
      headers.append('Set-Cookie', `${PREFIX}_role=${ok.role}; Path=/; Secure; SameSite=Lax`);
      const editTok = process.env.EDIT_TOKEN;
      if (ok.role === 'editor' && editTok) headers.append('Set-Cookie', `${PREFIX}_edit=${editTok}; Path=/; HttpOnly; Secure; SameSite=Lax`);
      return new Response(null, { status: 302, headers });
    }
  }

  if (secret && token && token === secret) return; // authenticated — allow
  if (!secret) return;                             // not configured → stay public (no lock-out)

  const loginUrl = new URL('/login.html', request.url);
  const dest = url.pathname + url.search;
  if (dest && dest !== '/' && !dest.startsWith('/login.html')) loginUrl.searchParams.set('next', dest);
  return Response.redirect(loginUrl, 302);
}
