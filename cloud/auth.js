/* Who is asking: sessions, and signing in with GitHub (owners and viewers) or Google (viewers).

   A session is a signed cookie naming the person: GitHub's user id and login, or a Google account's email, plus the
   email addresses they have proven. Owners are GitHub users on ALLOWED_USERS ('*' lets anyone in); everyone else who
   signs in is a viewer, who can open the decks shared with them and comment on them. The library itself is reached
   with the Glideshow GitHub App's installation token for the owner's repo (`installationToken`), so nothing of the
   person's own GitHub access is kept beyond the sign-in. */

import { Buffer } from 'node:buffer';

export const SESSION_DAYS = 90;
const enc = s => new TextEncoder().encode(s);

export const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
export const getCookie = (req, name) => (req.headers.get('cookie') || '').split(/;\s*/).find(c => c.startsWith(name + '='))?.slice(name.length + 1) || '';
export const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });
export const redirect = (location, headers = {}) => new Response(null, { status: 303, headers: { location, ...headers } });
export const safeNext = asked => /^\/(?![\/\\])/.test(asked || '') ? asked : '/';   // only a path on this site

async function hmac(env, msg) {
  const key = await crypto.subtle.importKey('raw', enc(env.SESSION_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Buffer.from(await crypto.subtle.sign('HMAC', key, enc(msg))).toString('base64url');
}
const same = (a, b) => a.length === b.length && crypto.subtle.timingSafeEqual(enc(a), enc(b));

/* A signed value: base64url(JSON).signature. */
export async function seal(env, obj) { const body = Buffer.from(JSON.stringify(obj)).toString('base64url'); return `${body}.${await hmac(env, body)}`; }
export async function unseal(env, value) {
  const [body, sig] = String(value || '').split('.');
  if (!body || !sig || !same(sig, await hmac(env, body))) return null;
  try { const o = JSON.parse(Buffer.from(body, 'base64url').toString()); return o.x && o.x < Date.now() / 1000 ? null : o; } catch { return null; }
}

/* An encrypted value, for what a page's own scripts may hold but not read (a shared deck's pass): AES-GCM under a key
   made from SESSION_KEY; base64url(iv + ciphertext). */
async function passKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc('glideshow pass ' + env.SESSION_KEY));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function lock(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await passKey(env), enc(JSON.stringify(obj))));
  return Buffer.concat([iv, ct]).toString('base64url');
}
export async function unlock(env, value) {
  try {
    const b = Buffer.from(String(value || ''), 'base64url'); if (b.length < 29) return null;
    const o = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12) }, await passKey(env), b.subarray(12))));
    return o.x && o.x < Date.now() / 1000 ? null : o;
  } catch { return null; }
}

/* The person signed in, or null: {p: 'github'|'google', u: id, l: login, n: name, e: [emails], x: expiry}. */
export async function session(req, env) { return unseal(env, getCookie(req, 'session')); }
const listed = (list, x) => (list || '').split(',').map(a => a.trim().toLowerCase()).some(a => a === '*' || a === x.toLowerCase());
/* Who may take shared decks down and suspend accounts (/admin): GitHub logins on ADMINS. */
export const isAdmin = (s, env) => s?.p === 'github' && !!env.ADMINS && listed(env.ADMINS.replace(/\*/g, ''), s.l);
/* Who may keep a library here: GitHub users on ALLOWED_USERS (in a repo), Google accounts on ALLOWED_GOOGLE (in Drive). */
export const isOwner = (s, env) => s?.p === 'github' ? listed(env.ALLOWED_USERS, s.l) : s?.p === 'google' ? (s.e || []).some(e => listed(env.ALLOWED_GOOGLE, e)) : false;
export const libraryFor = (env, who) => env.LIB.get(env.LIB.idFromName(who.p === 'google' ? 'user:g:' + who.u : 'user:' + who.u));
async function signIn(env, who, next) {
  const x = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  return redirect(next, { 'set-cookie': cookie('session', await seal(env, { ...who, x }), SESSION_DAYS * 86400) });
}

/* ---------- GitHub: sign in through the Glideshow app ---------- */

export async function githubStart(env, url) {
  const state = await seal(env, { next: safeNext(url.searchParams.get('next')), x: Math.floor(Date.now() / 1000) + 600, n: crypto.randomUUID() });
  const to = new URL('https://github.com/login/oauth/authorize');
  to.searchParams.set('client_id', env.GITHUB_CLIENT_ID); to.searchParams.set('redirect_uri', url.origin + '/auth/github/callback'); to.searchParams.set('state', state);
  return redirect(to.href, { 'set-cookie': cookie('oauth', state, 600) });
}

export async function githubCallback(req, env, url) {
  const state = url.searchParams.get('state') || '', st = await unseal(env, state);
  if (!st || state !== getCookie(req, 'oauth')) return page('Sign-in expired', '<p>That sign-in took too long or came from elsewhere. <a href="/login">Try again</a>.</p>', 400);
  const r = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: url.searchParams.get('code'), redirect_uri: url.origin + '/auth/github/callback' }) });
  const tok = (await r.json().catch(() => ({}))).access_token;
  if (!tok) return page('Sign-in failed', '<p>GitHub didn\'t confirm the sign-in. <a href="/login">Try again</a>.</p>', 400);
  const gh = p => fetch('https://api.github.com' + p, { headers: { authorization: `Bearer ${tok}`, accept: 'application/vnd.github+json', 'user-agent': 'glideshow' } }).then(r => r.ok ? r.json() : null);
  const user = await gh('/user');   // the app reads no private email addresses: a GitHub viewer is matched by login, or their public email
  if (!user) return page('Sign-in failed', '<p>GitHub didn\'t say who you are. <a href="/login">Try again</a>.</p>', 400);
  const who = { p: 'github', u: String(user.id), l: user.login, n: user.name || user.login, e: user.email ? [user.email.toLowerCase()] : [] };
  const res = await signIn(env, who, st.next);
  res.headers.append('set-cookie', cookie('oauth', '', 0));
  if (isOwner(who, env)) await libraryFor(env, who).signedIn(who, tok);   // the token lists the repos it may use, for setup
  return res;
}

/* ---------- Google: sign in to view decks shared with your address ---------- */

/* Someone signing in to make decks (the sign-in page, not a shared link) is asked in one go who they are and for
   drive.file (drive=1), with lasting (offline) access so Glideshow can save while they're away. A viewer of a shared link
   is asked only who they are; if they later keep decks, /setup asks for Drive then. */
export async function googleStart(env, url) {
  const drive = url.searchParams.get('drive') === '1';
  const state = await seal(env, { next: safeNext(url.searchParams.get('next')), x: Math.floor(Date.now() / 1000) + 600, n: crypto.randomUUID(), drive });
  const to = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  const params = { client_id: env.GOOGLE_CLIENT_ID, redirect_uri: url.origin + '/auth/google/callback', response_type: 'code', state,
    ...(drive ? { scope: 'openid email profile https://www.googleapis.com/auth/drive.file', access_type: 'offline', prompt: url.searchParams.get('hint') ? 'consent' : 'select_account consent', include_granted_scopes: 'true', login_hint: url.searchParams.get('hint') || '' }
              : { scope: 'openid email profile', prompt: 'select_account' }) };
  for (const [k, v] of Object.entries(params)) if (v) to.searchParams.set(k, v);
  return redirect(to.href, { 'set-cookie': cookie('oauth', state, 600) });
}

export async function googleCallback(req, env, url) {
  const state = url.searchParams.get('state') || '', st = await unseal(env, state);
  if (!st || state !== getCookie(req, 'oauth')) return page('Sign-in expired', '<p>That sign-in took too long or came from elsewhere. <a href="/login">Try again</a>.</p>', 400);
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: url.searchParams.get('code') || '', client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: url.origin + '/auth/google/callback', grant_type: 'authorization_code' }) });
  const tokens = await r.json().catch(() => ({})), idToken = tokens.id_token;
  // straight from Google over TLS with our client secret, so its claims can be read without checking the signature
  let claims = null; try { claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString()); } catch {}
  if (!claims?.email || !claims.email_verified) return page('Sign-in failed', '<p>Google didn\'t confirm an email address. <a href="/login">Try again</a>.</p>', 400);
  const who = { p: 'google', u: claims.sub, l: claims.email, n: claims.name || claims.email, e: [claims.email.toLowerCase()] };
  let next = st.next;
  if (isOwner(who, env)) {   // a library in Drive: connect it now (drive=1 came back with access), or ask for that access
    const lib = libraryFor(env, who);
    const gotDrive = String(tokens.scope || '').includes('/auth/drive.file');   // Google lets people untick it on the consent screen
    if (st.drive && gotDrive) { const c = await lib.driveConnected(who, tokens); if (c.error) return page('Google Drive', `<p class="err">${esc(c.error)}</p><a class="btn" href="/logout">Back</a>`, 400); }
    else if (st.drive && !(await lib.info()).ready) next = '/setup';   // signed in, but without Drive: /setup explains and asks again
    else if (next === '/' && !(await lib.info()).ready) next = `/setup`;   // only someone who came to make decks, not a viewer of a link
  }
  const res = await signIn(env, who, next);
  res.headers.append('set-cookie', cookie('oauth', '', 0));
  return res;
}

/* Local development only (wrangler dev on localhost with DEV_LOGIN set): sign in as anyone, for tests. */
export async function devLogin(env, url) {
  if (!env.DEV_LOGIN) return new Response('not found', { status: 404 });   // DEV_LOGIN is only ever in .dev.vars
  const q = url.searchParams, who = { p: q.get('p') || 'github', u: q.get('u') || '1', l: q.get('l') || 'dev', n: q.get('n') || q.get('l') || 'Dev', e: (q.get('e') || '').split(',').filter(Boolean) };
  if (isOwner(who, env)) {
    const lib = libraryFor(env, who);
    if (who.p === 'google' && env.DEV_DRIVE) { if (safeNext(q.get('next')) === '/') await lib.driveConnected(who, { refresh_token: 'dev', access_token: 'dev' }); }   // the fake Drive (test/fake_drive.py), as Google's sign-in: only for someone who came to make decks
    else await lib.signedIn(who, '');
  }
  return signIn(env, who, safeNext(q.get('next')));
}

/* ---------- the Glideshow app's own access to a repo ---------- */

async function appJWT(env) {
  const now = Math.floor(Date.now() / 1000), b = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${b({ alg: 'RS256', typ: 'JWT' })}.${b({ iat: now - 60, exp: now + 540, iss: String(env.GITHUB_APP_ID) })}`;
  const der = Buffer.from(env.GITHUB_APP_KEY.replace(/-----[^-]+-----|\s+/g, ''), 'base64');
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  return `${data}.${Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc(data))).toString('base64url')}`;
}
/* A token for one repo, good for an hour: {token, expires}. Throws when the app isn't installed there. */
export async function installationToken(env, repo) {
  const h = { authorization: `Bearer ${await appJWT(env)}`, accept: 'application/vnd.github+json', 'user-agent': 'glideshow' };
  const inst = await fetch(`https://api.github.com/repos/${repo}/installation`, { headers: h });
  if (!inst.ok) throw new Error(`Glideshow isn't installed on ${repo}: add it at https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`);
  const r = await fetch(`https://api.github.com/app/installations/${(await inst.json()).id}/access_tokens`, { method: 'POST', headers: h, body: JSON.stringify({ repositories: [repo.split('/')[1]] }) });
  const j = await r.json();
  if (!r.ok) throw new Error(`GitHub: no token for ${repo} (${r.status} ${j.message || ''})`);
  return { token: j.token, expires: Date.parse(j.expires_at) };
}

/* ---------- pages ---------- */

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c]);
export { esc };
/* The light / dark switch, as in the editor (editor/js/theme-toggle.js): the choice is the same one, and the new theme
   spreads from the button in a circle. */
const THEME_SWITCH = `<button id="theme-toggle" type="button" aria-label="Switch light or dark">
<svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
<svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></g></svg></button>
<script>{
  const root = document.documentElement, btn = document.getElementById('theme-toggle');
  const dark = () => root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  btn.onclick = () => {
    const on = !dark(), apply = () => { root.dataset.theme = on ? 'dark' : 'light'; try { localStorage.setItem('slides-dark', on ? '1' : '0'); } catch {} };
    if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return apply();
    const r = btn.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.classList.add('turning');
    const t = document.startViewTransition(apply);
    t.ready.then(() => root.animate({ clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + end + 'px at ' + x + 'px ' + y + 'px)'] },
      { duration: 700, easing: 'cubic-bezier(.65, 0, .35, 1)', pseudoElement: '::view-transition-new(root)' })).catch(() => {});
    t.finished.finally(() => root.classList.remove('turning'));
  };
}</script>`;

const DARK = `--card: #1d1e25; --ink: #ececee; --muted: #a1a3aa; --line: #3a3b40; --accent: #8aaeff; --on-accent: #121314; --err: #f2b8b5; --hover: #2a2b2f;
  --sky: radial-gradient(120% 140% at 88% 130%, rgba(226, 140, 112, .5) 0%, rgba(226, 140, 112, 0) 58%), radial-gradient(140% 70% at 15% 120%, rgba(150, 88, 140, .45) 0%, rgba(150, 88, 140, 0) 70%), linear-gradient(180deg, #18182c 0%, #221e41 50%, #2f2749 100%);
  --grain-blend: overlay; --grain: .2; color-scheme: dark;`;   // dusk: the system's dark mode, or the switch in the corner

export function page(title, body, status = 200) {
  // Thermal's front page: the sky is the page itself (dusk in dark mode), one plain card, the mascot gliding above it
  const grain = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.5'/%3E%3C/svg%3E")`;
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><title>${esc(title)} · Glideshow</title>
<script>try { const v = localStorage.getItem('slides-dark'); if (v) document.documentElement.dataset.theme = v === '1' ? 'dark' : 'light'; } catch {}</script>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@300;400;500;600&display=swap"><style>
.stage { display: inline-block; margin-left: .5em; padding: .15em .55em; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-size: .32em; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; vertical-align: .55em; }   /* alpha (the front page) */
:root { --card: #fff; --ink: #14204a; --muted: #5c6b87; --line: #dbe2ea; --accent: #2f6bff; --on-accent: #fff; --err: #b3261e; --hover: #f1f4f9;
  --sky: radial-gradient(120% 140% at 88% 130%, #ffe1a8 0%, rgba(255, 225, 168, 0) 58%), linear-gradient(180deg, #a9c8ff 0%, #d4e3ff 48%, #f3f6fb 100%); --grain-blend: multiply; --grain: .14; }
@media (prefers-color-scheme: dark) { :root:not([data-theme=light]) { ${DARK} } }
:root[data-theme=dark] { ${DARK} }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: clamp(24px, 9vw, 96px) 16px 32px; background: var(--sky) fixed; color: var(--ink); font: 15px/1.45 "Hanken Grotesk", system-ui, -apple-system, sans-serif; }
body::after { content: ""; position: fixed; inset: 0; pointer-events: none; opacity: var(--grain); mix-blend-mode: var(--grain-blend); background-image: ${grain}; }
.ride { position: relative; z-index: 1; width: 84px; margin: 0 0 14px; animation: drift 7s ease-in-out infinite; }
@keyframes drift { 0%, 100% { transform: translate(0, 0) rotate(0deg); } 50% { transform: translate(-5px, -6px) rotate(-2deg); } }
@media (prefers-reduced-motion: reduce) { .ride { animation: none; } }
main { position: relative; z-index: 1; background: var(--card); border-radius: 16px; padding: 28px; width: min(440px, 100%); display: grid; gap: 14px; }
h1 { margin: 0; font-size: 22px; font-weight: 500; letter-spacing: -.01em; } p { margin: 0; color: var(--muted); } a { color: var(--accent); }
.tag { margin-top: -8px; } .tag em { font-style: normal; color: var(--accent); }
.btn { display: flex; align-items: center; justify-content: center; gap: 10px; font: inherit; font-weight: 500; padding: 11px 16px; border: 1px solid var(--line); border-radius: 22px; background: none; color: var(--ink); text-decoration: none; cursor: pointer; }
.btn:hover { background: var(--hover); } .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
[hidden] { display: none !important; }   /* .btn's display: flex would otherwise show a hidden button */
.err { color: var(--err); } ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
form.pick button { width: 100%; justify-content: flex-start; } small { color: var(--muted); font-size: 13px; }
#theme-toggle { position: fixed; top: 16px; right: 16px; z-index: 2; width: 40px; height: 40px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 50%; background: var(--card); color: var(--ink); cursor: pointer; }
#theme-toggle:hover { background: var(--hover); } #theme-toggle svg { width: 20px; height: 20px; }
#theme-toggle .sun, :root[data-theme=dark] #theme-toggle .moon { display: none; } :root[data-theme=dark] #theme-toggle .sun { display: block; }
@media (prefers-color-scheme: dark) { :root:not([data-theme=light]) #theme-toggle .moon { display: none; } :root:not([data-theme=light]) #theme-toggle .sun { display: block; } }
::view-transition-old(root), ::view-transition-new(root) { animation: none; mix-blend-mode: normal; }
@keyframes turn { from { transform: rotate(-120deg) scale(.5); opacity: 0; } to { transform: none; opacity: 1; } }
.turning #theme-toggle svg { animation: turn .7s cubic-bezier(.65, 0, .35, 1); }
</style></head><body>${THEME_SWITCH}<img class="ride" src="/editor/looks/glider.svg" alt=""><main><h1>${esc(title)}${title === 'Glideshow' ? '<span class="stage" title="Glideshow is in alpha: still changing week to week">alpha</span>' : ''}</h1>${body}</main></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

const GH_ICON = '<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
const G_ICON = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 2.9-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.5z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg>';

/* The sign-in page: GitHub (and Google, when it is set up). `why` says what the sign-in is for. */
export function loginPage(env, url, why = '') {
  const to = safeNext(url.searchParams.get('next')), next = encodeURIComponent(to);
  const drive = to.startsWith('/p/') ? '' : '&drive=1';   // signing in to make decks: Drive in the same step; to open a shared link: who you are only
  const google = env.GOOGLE_CLIENT_ID ? `<a class="btn" href="/auth/google?next=${next}${drive}">${G_ICON}Continue with Google</a>` : '';
  // signing in leaves browser mode (editor/local/sw.js): its decks stay in the browser for the next visit to /start
  const leave = `<script>try { navigator.serviceWorker?.getRegistrations().then(rs => rs.forEach(r => r.unregister())) } catch {}</script>`;   // (a shared link's sign-in page is sandboxed: no service workers to ask)
  const without = drive ? `<small>Or <a href="/start">start without an account</a>: your decks stay in this browser.</small>` : '';
  return page('Glideshow', `${leave}<p>${esc(why || 'Sign in to open your decks.')}</p>${google}<a class="btn" href="/auth/github?next=${next}">${GH_ICON}Continue with GitHub</a>${without}<small><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></small>`);
}
