/* Glideshow (glideshow.org): the slide editor online. The same editor/ files as the local app, with each person's
   library kept in their own GitHub repo instead of ~/decks (docs/self-hosting.md).

     auth.js      signing in (GitHub for owners and viewers, Google for viewers), sessions, the GitHub App's repo tokens
     library.js   a person's library: the local server's API over their repo (one Durable Object each)
     share.js     shared links (/p/<owner>/<slug>/) and comments

   Owners are the GitHub users on ALLOWED_USERS; what they reach is their own library only. A shared link is open to
   whoever its deck is shared with, sandboxed (share.js). Anyone can report a shared deck (/report); people on ADMINS
   take decks down and suspend accounts (/admin). Nothing here is for search engines or AI crawlers. */

import { DurableObject } from 'cloudflare:workers';
import { approvedFrom, cleanSlides, composeDeck, deckForCollaborator } from './clean.js';
import { session, isOwner, isAdmin, libraryFor, githubStart, githubCallback, googleStart, googleCallback, devLogin, loginPage, page, esc, json, redirect, cookie, safeNext } from './auth.js';
import { landing, privacy, terms, robots } from './pages.js';
export { Library } from './library.js';

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname;
    if (url.hostname === 'www.glideshow.org' || url.hostname === 'edit.ryanvt.com') return Response.redirect('https://glideshow.org' + path + url.search, 301);   // one address
    if (url.hostname === 'slides.ryanvt.com' && env.OLD_SHARE_OWNER) return Response.redirect(`https://glideshow.org/p/${env.OLD_SHARE_OWNER}${path}`, 301);   // links made before Glideshow
    const res = await route(req, env, url, path).catch(e => json({ error: String(e.message || e) }, 500));
    if (res.status === 101 || /** @type {any} */ (res).webSocket) return res;   // an editor's live WebSocket (cloud/library.js): passed on as it is
    const h = new Headers(res.headers);
    h.set('x-robots-tag', ['/', '/privacy', '/terms'].includes(path) && res.status === 200 && !res.headers.get('set-cookie') ? 'noai, noimageai' : 'noindex, nofollow, noai, noimageai');   // only the public pages may be indexed
    h.set('x-frame-options', 'SAMEORIGIN'); h.set('referrer-policy', 'same-origin');   // (these two were inside the comment above until 2026-10-15, so never sent)
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  },
};

/* A shared deck's pages and files: their own origin (no allow-same-origin), so the deck's scripts can't act as the viewer
   on glideshow.org; no forms, and scripts may send data only to glideshow.org (the comments), so a deck can't collect a
   fake sign-in and post it elsewhere. */
const SANDBOX = 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals allow-presentation allow-downloads';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type, x-glideshow, x-glideshow-view', 'access-control-max-age': '86400' };
const dir = env => env.DIR.get(env.DIR.idFromName('directory'));
/* Whether an owner's account is suspended, asked of the Directory at most once a minute per account in each isolate:
   every request an editor makes passed through here, and asking each time doubled the Durable Object requests. */
const SUSPENDED = new Map();
async function suspended(env, key) {
  const hit = SUSPENDED.get(key);
  if (hit && Date.now() - hit.t < 60_000) return hit.v;
  const v = await dir(env).blocked(key); SUSPENDED.set(key, { v, t: Date.now() }); return v;
}
const ip = req => req.headers.get('cf-connecting-ip') || 'local';
/* Rate limits (wrangler.toml [[ratelimits]]): writes per person, reports per address. Missing bindings let everything through. */
const limited = async (limiter, key) => !!limiter && !(await limiter.limit({ key }).catch(() => ({ success: true }))).success;
const slow = () => json({ error: 'Too many changes at once. Wait a minute and try again.' }, 429);

const WHY = { shared: 'This deck is shared with specific people. Sign in to open it.', comment: 'Sign in to see and add comments.', edit: 'Sign in to edit this deck.' };

async function route(req, env, url, path) {
  if (path === '/robots.txt') return new Response(robots, { headers: { 'content-type': 'text/plain' } });
  if (path === '/favicon.svg' || path === '/favicon.ico') return env.ASSETS.fetch(new Request(new URL('/glideshow.svg', url.origin)));   // the mascot, for every page (/editor/ is behind sign-in)
  if (path === '/apple-touch-icon.png') return env.ASSETS.fetch(new Request(new URL(path, url.origin)));
  if (path === '/privacy') return privacy();
  if (path === '/terms') return terms();
  if (!env.SESSION_KEY || !env.GITHUB_CLIENT_ID || !env.GITHUB_APP_KEY) return new Response('Not set up yet: run cloud/setup.sh (docs/self-hosting.md).', { status: 503 });   // closed until it has its secrets
  if (path === '/github/webhook') return githubWebhook(req, env);
  if (path === '/login') return loginPage(env, url, WHY[url.searchParams.get('why')]);
  if (path === '/logout') return redirect(safeNext(url.searchParams.get('next')) === '/' ? '/login' : safeNext(url.searchParams.get('next')), { 'set-cookie': cookie('session', '', 0) });
  if (path === '/auth/github') return githubStart(env, url);
  if (path === '/auth/github/callback') return githubCallback(req, env, url);
  if (path === '/auth/google' && env.GOOGLE_CLIENT_ID) return googleStart(env, url);
  if (path === '/auth/google/callback' && env.GOOGLE_CLIENT_ID) return googleCallback(req, env, url);
  if (path === '/auth/dev') return devLogin(env, url);
  if (path === '/__dev/clean' && env.DEV_LOGIN && req.method === 'POST') {   // wrangler dev only: the collaborator cleaning (clean.js), for test/coedit.py
    const r = await req.json(), out = r.op === 'compose' ? await composeDeck(r.owner, r.html, { title: r.title, same: r.same, count: r.count })
      : r.op === 'collab' ? await deckForCollaborator(r.html) : await cleanSlides(r.html, r.owner ? await approvedFrom(r.owner) : undefined);
    return new Response(out, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  if (path.startsWith('/share/')) return env.ASSETS.fetch(new Request(new URL(path, url.origin)));   // the shared-deck page's own script and style
  if (path === '/editor/local/sw.js') {   // browser mode's service worker, allowed all of glideshow.org (scope /)
    const r = await env.ASSETS.fetch(new Request(new URL('/local/sw.js', url.origin))), h = new Headers(r.headers);
    h.set('service-worker-allowed', '/'); h.set('cache-control', 'no-cache');
    return new Response(r.body, { status: r.status, headers: h });
  }
  if (path.startsWith('/editor/')) return env.ASSETS.fetch(new Request(new URL(path.slice(7), url.origin), req));   // the editor's own files: anyone's, as browser mode loads them signed out
  if (path === '/start') return await session(req, env) ? redirect('/') : start();   // signed in already: their own decks, not a second library in the browser
  const comments = path.startsWith('/p/') && path.endsWith('/__comments');   // from a sandboxed deck: Origin null, a pass instead of cookies
  if (req.method === 'OPTIONS' && comments) return new Response(null, { status: 204, headers: CORS });
  if (path === '/report') return report(req, env, url);
  if (req.method === 'POST' && path !== '/setup' && path !== '/admin') {   // as the local server: a POST needs X-Glideshow, which another site can't send without a preflight
    const origin = req.headers.get('origin');
    if (req.headers.get('x-glideshow') !== '1' || (origin && origin !== url.origin && !(comments && origin === 'null'))) return json({ error: 'not from this editor' }, 403);
  }
  const who = await session(req, env);
  if (req.method === 'POST' && await limited(env.WRITES, who ? `${who.p}:${who.u}` : ip(req))) return slow();
  if (path.startsWith('/p/')) {
    const res = await shared(req, env, url, comments ? null : who), h = new Headers(res.headers);
    h.set('content-security-policy', `${SANDBOX}; connect-src ${url.origin}; form-action 'none'`); h.set('x-content-type-options', 'nosniff'); h.set('referrer-policy', 'same-origin');
    if (comments) for (const [k, v] of Object.entries(CORS)) h.set(k, v);
    return new Response(res.body, { status: res.status, headers: h });
  }
  if (path.startsWith('/e/')) return collab(req, env, url, who);   // a collaborator's editor for one shared deck
  if (path === '/admin') return isAdmin(who, env) ? admin(req, env, url) : page('Not found', '<p>There is nothing here.</p>', 404);

  if (!who && path === '/') return landing();   // public: what Glideshow is (Google asks for a public home page)
  if (!who) return path.startsWith('/api/') ? json({ error: 'Signed out: reload the page to sign in again.' }, 401) : redirect('/login?next=' + encodeURIComponent(path + url.search));
  if (path === '/api/selection' && req.method === 'POST') return json({ ok: true });   // the Mac's `glideshow selection`; nothing online asks (and it came on every click)
  if (isOwner(who, env) && await suspended(env, `acct:${who.p}:${who.u}`)) return path.startsWith('/api/') ? json({ error: 'This account is suspended.' }, 403)
    : page('Account suspended', `<p>This account can't keep decks on Glideshow any more. If you think that's a mistake, write to the address in the <a href="/terms">terms</a>.</p><a class="btn" href="/logout">Sign out</a>`, 403);
  if (!isOwner(who, env)) return path.startsWith('/api/') ? json({ error: 'not allowed' }, 403)
    : page('Not open yet', `<p>Glideshow isn't open to everyone yet, so <b>${esc(who.l)}</b> can't make decks here. Decks shared with you open from their links.</p><a class="btn" href="/logout">Sign out</a>`, 403);
  const lib = libraryFor(env, who);
  if (path === '/setup') return who.p === 'google' ? driveSetup(lib) : setup(req, env, url, lib);
  if (path === '/' || path === '/home' || path === '/edit' || path === '/index.html') {
    const cfg = await lib.info();
    if (!cfg.ready) return redirect('/setup');
    // how the editor hears of changes made elsewhere (boot.js watchChanges): GitHub's push webhook, Drive once a minute
    const changes = cfg.kind === 'drive' ? 'minute' : env.GITHUB_WEBHOOK_SECRET ? 'push' : '';
    return editorPage(env, url, path === '/edit' || path === '/index.html' ? '/index.html' : '/home.html', { user: who.l, name: who.n, repo: cfg.label, changes });
  }
  if (path === '/api/fonts') return env.ASSETS.fetch(new Request(new URL('/data/fonts.json', url.origin)));
  const key = `${who.p}:${who.u}`, bg = /^\/api\/(events|live|selection)$/.test(path);
  if (bg && Date.now() - (PAUSED.get(key) || 0) < 60_000) return json({ error: 'paused', load: 'paused' }, 429, { 'x-glideshow-load': 'paused', 'retry-after': '3600' });
  const h = new Headers(req.headers); h.delete('x-viewer');
  const res = await lib.fetch(new Request(req, { headers: h }));
  if (res.headers.get('x-glideshow-load') === 'paused') PAUSED.set(key, Date.now()); else PAUSED.delete(key);
  return res;
}
/* Libraries past their day's pause (library.js meter), by owner, as this isolate last heard: their background requests
   are refused here for a minute without reaching the Durable Object. */
const PAUSED = new Map();

/* /github/webhook: the Glideshow GitHub App's push events (its webhook, with GITHUB_WEBHOOK_SECRET). A push to a repo
   reaches every library kept in it (the Directory knows which), which looks at its branch now (refresh) and tells the
   editors open on a changed deck over their WebSockets: the Mac's pushes arrive in a second, and open editors need no
   8 s poll to hear of them (2026-10-21: that poll was most of an idle day's Durable Object requests). */
async function githubWebhook(req, env) {
  if (req.method !== 'POST' || !env.GITHUB_WEBHOOK_SECRET) return new Response('not found', { status: 404 });
  const body = await req.arrayBuffer(), sig = req.headers.get('x-hub-signature-256') || '';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.GITHUB_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const want = 'sha256=' + [...new Uint8Array(await crypto.subtle.sign('HMAC', key, body))].map(b => b.toString(16).padStart(2, '0')).join('');
  if (sig.length !== want.length || !crypto.subtle.timingSafeEqual(new TextEncoder().encode(sig), new TextEncoder().encode(want))) return new Response('bad signature', { status: 401 });
  if (req.headers.get('x-github-event') !== 'push') return new Response('ok');   // ping, installation, …
  let p; try { p = JSON.parse(new TextDecoder().decode(body)); } catch { return new Response('bad payload', { status: 400 }); }
  const repo = String(p.repository?.full_name || '').toLowerCase(), branch = String(p.ref || '').replace(/^refs\/heads\//, '');
  if (!repo || !branch) return new Response('ok');
  const ids = await dir(env).repoLibraries(repo);
  await Promise.all(ids.map(id => env.LIB.get(env.LIB.idFromString(id)).pushed(branch).catch(() => {})));
  return new Response(`ok: ${ids.length}`);
}

/* The editor's pages, told they are online (window.GLIDESHOW_CLOUD) so they hide what only the Mac can do. */
async function editorPage(env, url, file, info) {
  const r = await env.ASSETS.fetch(new Request(new URL(file, url.origin)));
  let html = (await r.text()).replace('<head>', `<head>\n<script>window.GLIDESHOW_CLOUD = ${JSON.stringify(info).replace(/</g, '\\u003c')}</script>`);
  if (info.collab) {   // a collaborator's editor: its calls to /api/ and /deck/, and the deck's pictures, under /e/<owner>/<slug>/
    const b = JSON.stringify(info.collab.base);
    html = html.replace('<base href="/deck/">', `<base href="${info.collab.base}deck/">`).replace('</script>', `</script>\n<script>(() => { const B = ${b}, fix = u => typeof u === 'string' && /^\\/(api|deck)\\//.test(u) ? B + u.slice(1) : u;
  const f = window.fetch.bind(window); window.fetch = (u, o) => f(fix(u), o);
  const ES = window.EventSource; window.EventSource = class extends ES { constructor(u, o) { super(fix(u), o); } };
  const WS = window.WebSocket; window.WebSocket = class extends WS { constructor(u, p) { super(String(u).replace(/^(wss?:\\/\\/[^/]+)\\/api\\//, '$1' + B + 'api/'), p); } };
  document.documentElement.classList.add('collab');
  addEventListener('DOMContentLoaded', () => { const a = document.getElementById('ed-app-icon'); if (a) a.href = ${JSON.stringify(info.collab.view || '/')}; });
})();</script>`);
  }
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

/* /setup: which repo holds this person's library. The Glideshow app has to be installed on it first. */
async function setup(req, env, url, lib) {
  if (req.method === 'POST') {
    if (req.headers.get('origin') && req.headers.get('origin') !== url.origin) return new Response('forbidden', { status: 403 });
    const r = await lib.chooseRepo(String((await req.formData()).get('repo') || ''));
    if (r.error) return page('Choose your library', `<p class="err">${esc(r.error)}</p><a class="btn" href="/setup">Back</a>`, 400);
    return redirect('/');
  }
  const info = await lib.setupInfo(), install = `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`;
  if (info.stale) return redirect('/auth/github?next=/setup');   // listing repos needs a fresh sign-in
  const writable = info.repos.filter(r => r.writable);
  // Back from installing the app (GitHub returns here, the app's setup URL) with one repo to choose: that's the library.
  if (!info.current && writable.length === 1 && (await lib.chooseRepo(writable[0].repo)).ok) return redirect('/');
  const rows = writable.map(r => `<li><button class="btn" name="repo" value="${esc(r.repo)}">${esc(r.repo)}${r.private ? ' <small>private</small>' : ''}${r.repo === info.current ? ' <small>· current</small>' : ''}</button></li>`).join('');
  if (rows) return page('Choose your library', `<p>Your decks live in one of your GitHub repos. Which one?</p>
<form class="pick" method="post"><ul>${rows}</ul></form>
<a class="btn" href="${install}">Use another repo…</a><small>Glideshow sees only the repos you install it on.</small>`);
  const repo = 'https://github.com/new?name=glideshow-decks&visibility=private&description=' + encodeURIComponent('Slides, made with glideshow.org');
  return page('Keep your decks in GitHub', `<p>Your decks live in a GitHub repo of your own, so you keep them and every version. Two steps, once:</p>
<a class="btn primary" href="${repo}" target="_blank" rel="noopener">1. Make a private repo for your decks</a>
<a class="btn" href="${install}">2. Let Glideshow use it</a>
<small>In step 2, choose <b>Only select repositories</b> and pick the repo from step 1; GitHub then brings you back here. Already have a repo for decks? Skip step 1.</small>`);
}

/* /setup for a Google account: its library is a Glideshow folder in its Drive, once Glideshow may use it. */
async function driveSetup(lib) {
  const cfg = await lib.info();
  if (cfg.ready) return page('Your library', `<p>Your decks are in your Google Drive, in <b>My Drive › Glideshow</b>. Glideshow can see only the files it makes there.</p>
<a class="btn primary" href="/">Open your decks</a><a class="btn" href="https://drive.google.com/drive/folders/${esc(cfg.drive.root)}" target="_blank" rel="noopener">Show the folder in Drive</a>`);
  return page('Keep your decks in Google Drive', `<p>Glideshow saves your decks in a <b>Glideshow</b> folder in your Google Drive. Google will ask to let Glideshow
see, edit, create and delete <b>only the files it makes</b> there; the rest of your Drive stays out of its reach.</p>
<a class="btn primary" href="/auth/google?drive=1&next=%2F&hint=${encodeURIComponent(cfg.user?.e || '')}">Connect Google Drive</a><a class="btn" href="/logout">Not now</a>`);
}

/* /p/<owner>/<slug>/<file>: a shared deck, handed to its owner's library with who is looking. */
async function shared(req, env, url, who) {
  const [, , owner = '', slug = '', ...rest] = url.pathname.split('/');
  if (!slug) return page('Link not found', "<p>This link isn't complete.</p>", 404);
  if (rest.length === 0) return redirect(`/p/${owner}/${slug}/${url.search}`);
  const uid = await dir(env).get(owner.toLowerCase());
  if (!uid) return page('Link not found', "<p>This link doesn't lead to a deck any more.</p>", 404);
  const down = await dir(env).blocked(owner.toLowerCase()) || await dir(env).blocked(`${owner.toLowerCase()}/${slug}`);
  if (down) return page('Taken down', "<p>This deck was taken down because it broke Glideshow's <a href=\"/terms\">terms</a>.</p>", 451);
  const lib = env.LIB.get(env.LIB.idFromName(owner.startsWith('g.') ? 'user:g:' + uid : 'user:' + uid));   // g.<name>: a Drive library
  const inner = new URL(`https://library/__share/${encodeURIComponent(slug)}/${rest.map(encodeURIComponent).join('/')}`);
  inner.searchParams.set('base', `/p/${owner}/${slug}/`);
  const h = new Headers({ 'x-viewer': JSON.stringify(who), 'content-type': req.headers.get('content-type') || '', 'x-glideshow-view': req.headers.get('x-glideshow-view') || '', range: req.headers.get('range') || '', 'if-none-match': req.headers.get('if-none-match') || '' })   // (Range: a video loops only if its file comes in parts)
  return lib.fetch(new Request(inner, { method: req.method, headers: h, body: req.method === 'POST' ? await req.arrayBuffer() : undefined, redirect: 'manual' }));
}

/* /e/<owner>/<slug>/…: a collaborator's editor for one shared deck. The page is the
   editor itself (its calls to /api/ and /deck/ sent under this address: editorPage); everything under it goes to the
   owner's library, which allows that one deck and only to the people listed under "Can edit" (share.js collabRoutes). */
async function collab(req, env, url, who) {
  const [, , owner = '', slug = '', ...rest] = url.pathname.split('/'), base = `/e/${owner}/${slug}/`;
  if (!slug) return page('Link not found', "<p>This link isn't complete.</p>", 404);
  if (rest.length === 0) return redirect(base + url.search);
  if (!who) return redirect(`/login?why=edit&next=${encodeURIComponent(base)}`);
  const uid = await dir(env).get(owner.toLowerCase());
  if (!uid) return page('Link not found', "<p>This link doesn't lead to a deck any more.</p>", 404);
  if (await dir(env).blocked(owner.toLowerCase()) || await dir(env).blocked(`${owner.toLowerCase()}/${slug}`)) return page('Taken down', "<p>This deck was taken down because it broke Glideshow's <a href=\"/terms\">terms</a>.</p>", 451);
  const sub = rest.join('/');
  if (sub === 'api/fonts') return env.ASSETS.fetch(new Request(new URL('/data/fonts.json', url.origin)));
  const lib = env.LIB.get(env.LIB.idFromName(owner.startsWith('g.') ? 'user:g:' + uid : 'user:' + uid));
  const inner = new URL(`https://library/__collab/${encodeURIComponent(slug)}/${sub ? rest.map(encodeURIComponent).join('/') : '__can'}${url.search}`);
  inner.searchParams.set('base', base);
  const h = new Headers(req.headers); h.delete('cookie'); h.set('x-viewer', JSON.stringify(who));   // (Upgrade stays: the live WebSocket)
  const res = await lib.fetch(new Request(inner, { method: req.method, headers: h, body: req.method === 'POST' ? await req.arrayBuffer() : undefined, redirect: 'manual' }));
  if (sub || !res.ok) return res;
  const info = await res.json();
  return editorPage(env, url, '/index.html', { user: who.l, name: who.n, collab: { base, view: info.view, title: info.title } });
}

/* /start: Glideshow without an account. It installs the service worker that keeps a library in this browser
   (editor/local/sw.js), then opens the home screen through it. */
function start() {
  return page('Glideshow', `<p id="st">Setting up a library in this browser…</p>
<script>(async () => {
  try {
    await navigator.serviceWorker.register('/editor/local/sw.js', { type: 'module', scope: '/' });
    navigator.storage?.persist?.().catch(() => false);   // ask the browser not to clear the decks when space runs low (Firefox asks the person: not waited for)
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 15000))]);
    reg.active?.postMessage({ type: 'library-changed' });   // a folder picked on the front page: the worker starts again over it
    await new Promise(r => setTimeout(r, 300));
    location.replace('/');
  } catch (e) {
    document.getElementById('st').textContent = "This browser can't keep decks by itself. Sign in to keep them in Google Drive or GitHub instead.";
    document.getElementById('st').insertAdjacentHTML('afterend', '<a class="btn primary" href="/login">Sign in</a>');
  }
})();</script>`);
}

/* /report?link=…: anyone can report a shared deck; reports wait in the Directory for /admin. */
const REASONS = { phishing: 'Phishing, scam or malware', illegal: 'Illegal content', abuse: 'Harassment or hate', rights: "Someone else's work (copyright)", other: 'Something else' };
async function report(req, env, url) {
  if (req.method === 'POST') {
    if (req.headers.get('origin') && req.headers.get('origin') !== url.origin) return new Response('forbidden', { status: 403 });
    if (await limited(env.REPORTS, ip(req))) return page('Report a deck', '<p>Too many reports from here just now. Try again in a minute.</p>', 429);
    const f = await req.formData(), who = await session(req, env), link = String(f.get('link') || '').slice(0, 300);
    if (!/^\/p\/[^/]+\/[^/]+\//.test(link)) return page('Report a deck', '<p class="err">That isn\'t a Glideshow link.</p><a class="btn" href="/">Back</a>', 400);
    await dir(env).report({ link, why: REASONS[String(f.get('why'))] ? String(f.get('why')) : 'other', text: String(f.get('text') || '').slice(0, 2000),
      from: String(f.get('from') || '').slice(0, 200), by: who ? `${who.p}:${who.l}` : '', ip: ip(req) });
    return page('Thanks', '<p>Thanks for the report. Someone will look at it soon.</p>');
  }
  const link = (url.searchParams.get('link') || '').replace(/^https?:\/\/[^/]+/, '');
  const opts = Object.entries(REASONS).map(([k, v], i) => `<label><input type="radio" name="why" value="${k}"${i ? '' : ' checked'}> ${esc(v)}</label>`).join('');
  return page('Report a deck', `<p>What's wrong with <b>${esc(link || 'this deck')}</b>?</p>
<form method="post" style="display:grid;gap:10px"><input type="hidden" name="link" value="${esc(link)}">${opts}
<textarea name="text" rows="4" placeholder="Anything that helps (optional)" style="font:inherit;padding:8px;border-radius:8px;border:1px solid var(--line);background:none;color:inherit"></textarea>
<input name="from" type="email" placeholder="Your email, if you'd like an answer (optional)" style="font:inherit;padding:8px;border-radius:8px;border:1px solid var(--line);background:none;color:inherit">
<button class="btn primary">Send report</button></form>`);
}

/* /admin (ADMINS only): the reports, taking a link down, suspending its owner, and undoing either. */
async function admin(req, env, url) {
  const d = dir(env);
  if (req.method === 'POST') {
    if (req.headers.get('origin') && req.headers.get('origin') !== url.origin) return new Response('forbidden', { status: 403 });
    const f = await req.formData(), op = String(f.get('op')), key = String(f.get('key') || '').toLowerCase();
    if (op === 'dismiss') await d.dismiss(String(f.get('id')));
    else if (op === 'down' && key) await d.block(key, 'taken down');                          // <owner>/<slug>: one link
    else if (op === 'suspend' && key) {                                                         // <owner>: every link, and the account
      await d.block(key, 'suspended');
      const uid = await d.get(key); if (uid) await d.block(`acct:${key.startsWith('g.') ? 'google' : 'github'}:${uid}`, 'suspended');
    } else if (op === 'restore' && key) {
      await d.unblock(key);
      const uid = await d.get(key); if (uid) await d.unblock(`acct:${key.startsWith('g.') ? 'google' : 'github'}:${uid}`);
    }
    SUSPENDED.clear();   // this isolate sees it at once; others within the minute they keep an answer (suspended())
    return redirect('/admin');
  }
  const btn = (op, label, extra) => `<form method="post" style="display:inline"><input type="hidden" name="op" value="${op}">${extra}<button class="btn" style="display:inline-flex;padding:4px 10px">${label}</button></form>`;
  const hidden = (k, v) => `<input type="hidden" name="${k}" value="${esc(v)}">`;
  const reports = (await d.reports()).map(r => {
    const [, , owner = '', slug = ''] = r.link.split('/');
    return `<li><a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.link)}</a> <small>${esc(new Date(r.t).toISOString().slice(0, 16))}</small><br>
<b>${esc(REASONS[r.why] || r.why)}</b> ${esc(r.text)}<br><small>${esc([r.by, r.from, r.ip].filter(Boolean).join(' · '))}</small><br>
${btn('down', 'Take down link', hidden('key', `${owner}/${slug}`))} ${btn('suspend', `Suspend ${esc(owner)}`, hidden('key', owner))} ${btn('dismiss', 'Dismiss', hidden('id', r.id))}</li>`;
  }).join('');
  const blocked = (await d.blockedList()).filter(b => !b.key.startsWith('acct:')).map(b => `<li>${esc(b.key)} <small>${esc(b.why)}</small> ${btn('restore', 'Restore', hidden('key', b.key))}</li>`).join('');
  const u = await d.usageToday();
  const usage = `<p><b>Requests today</b> <small>(${esc(u.day)}, Durable Objects, each library counted to the last 5,000; the free plan stops at 100,000)</small></p>
${u.alert ? `<p style="color:#d93025"><b>Past ${(+env.ACCOUNT_ALERT || 50_000).toLocaleString()} today</b> (${u.total.toLocaleString()} at ${esc(new Date(u.alert.t).toISOString().slice(11, 16))} UTC)</p>` : ''}
<ul>${u.rows.map(r => `<li>${esc(r.who)} <small>${r.n.toLocaleString()}</small></li>`).join('') || '<li><small>Under 5,000 everywhere.</small></li>'}</ul>`;
  return page('Admin', `${usage}<p><b>Reports</b></p><ul>${reports || '<li><small>None.</small></li>'}</ul><p><b>Taken down and suspended</b></p><ul>${blocked || '<li><small>None.</small></li>'}</ul>`);
}

/* Which person's library a share link's <owner> (the repo's GitHub owner) points to; reports and what was taken down. */
export class Directory extends DurableObject {
  async set(owner, uid) { await this.ctx.storage.put('o:' + owner, uid); }
  async claim(owner, uid) { const had = await this.get(owner); if (had && had !== uid) return false; await this.set(owner, uid); return true; }
  async get(owner) { return (await this.ctx.storage.get('o:' + owner)) || null; }
  async report(r) {
    const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    await this.ctx.storage.put('r:' + id, { ...r, id, t: Date.now() });
    const all = await this.ctx.storage.list({ prefix: 'r:' });   // the newest 500
    if (all.size > 500) await this.ctx.storage.delete([...all.keys()].slice(0, all.size - 500));
  }
  async reports() { return [...(await this.ctx.storage.list({ prefix: 'r:', reverse: true, limit: 200 })).values()]; }
  async dismiss(id) { await this.ctx.storage.delete('r:' + id); }
  async block(key, why) { await this.ctx.storage.put('b:' + key, { key, why, t: Date.now() }); }
  async unblock(key) { await this.ctx.storage.delete('b:' + key); }
  async blocked(key) { return !!(await this.ctx.storage.get('b:' + key)); }
  async blockedList() { return [...(await this.ctx.storage.list({ prefix: 'b:' })).values()]; }
  /* Each library's requests today (library.js meter, every 5,000) and the account's total: past ACCOUNT_ALERT (50,000,
     half the free plan's day) the day is marked, /admin says so at the top, and the Worker logs it (Workers Logs). */
  /* Which libraries are kept in a GitHub repo (library.js registers its own), for the push webhook. */
  async watchRepo(repo, id, was = '') {
    if (was && was !== repo) { const old = (await this.ctx.storage.get('repo:' + was)) || []; await this.ctx.storage.put('repo:' + was, old.filter(x => x !== id)); }
    const ids = (await this.ctx.storage.get('repo:' + repo)) || [];
    if (!ids.includes(id)) await this.ctx.storage.put('repo:' + repo, [...ids, id]);
  }
  async repoLibraries(repo) { return (await this.ctx.storage.get('repo:' + repo)) || []; }
  async usage(id, who, day, n) {
    await this.ctx.storage.put(`u:${day}:${id}`, { who, n, t: Date.now() });
    const all = await this.ctx.storage.list({ prefix: 'u:' }), old = [...all.keys()].filter(k => k.slice(2, 12) < day);
    if (old.length) await this.ctx.storage.delete(old.filter(k => k.slice(2, 12) < new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10)));
    const total = [...all.entries()].filter(([k]) => k.startsWith(`u:${day}:`)).reduce((s, [, v]) => s + v.n, 0);
    if (total >= (+this.env.ACCOUNT_ALERT || 50_000) && !(await this.ctx.storage.get('alert:' + day))) {
      await this.ctx.storage.put('alert:' + day, { total, t: Date.now() });
      console.error(`glideshow usage alert: ${total} Durable Object requests today (${day}), past ${+this.env.ACCOUNT_ALERT || 50_000}`);
    }
    return total;
  }
  async usageToday() {
    const day = new Date().toISOString().slice(0, 10), rows = [...(await this.ctx.storage.list({ prefix: `u:${day}:` })).values()];
    return { day, rows: rows.sort((a, b) => b.n - a.n), total: rows.reduce((s, r) => s + r.n, 0), alert: await this.ctx.storage.get('alert:' + day) };
  }
}
