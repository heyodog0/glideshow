/* Sharing and comments.

   A shared deck has an entry in the library's published.json (the same ledger the Mac's `glideshow publish` keeps):
     "Lab/talk": {"slug": "talk-k3x9…", "rev": "<commit>", "access": "link" | "people", "people": ["a@b.org", "@harvard.edu", "octocat"],
                  "expires": "2026-12-31", "title": …, "url": "https://glideshow.org/p/<owner>/<slug>/"}
   The link shows the deck as it is now: its latest saved files (on a Mac, once a save has reached GitHub; `rev` is only the
   version it was shared at). "people" lets in only those listed:
   an email address, everyone at a domain (@harvard.edu), or a GitHub login, proven by signing in with Google or
   GitHub. The owner always gets in.

   Comments live beside the deck as comments.json, so they are in the repo's history and an agent can read them:
     {"comments": [{"id", "slide": 3, "box": "b1x2y3", "x": 840, "y": 410, "text", "by": {"n", "e"}, "at", "resolved": false,
                    "replies": [{"id", "text", "by", "at"}]}]}
   Anyone who can open a shared deck can read and add comments once signed in; the owner sees them in the editor.

   A shared deck is HTML its owner wrote, scripts and all, so it is served sandboxed (worker.js: a Content-Security-Policy
   sandbox, an origin of its own): its scripts can't use the viewer's glideshow.org session. The viewer comes back on a
   pass instead, encrypted so the page can carry it but not read it: in the path of the deck's files (its <base> is
   …/~<pass>/) and in a header for comments. A pass is good for one deck, for 12 hours. */

import { json, page, esc, lock, unlock } from './auth.js';
import { baseOf, enc, dec, typeOf, clean, titleOf } from './library.js';
import { composeDeck, deckForCollaborator } from './clean.js';

const rand = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
const nowISO = () => new Date().toISOString().slice(0, 16) + 'Z';

export async function ledger(lib) { try { return JSON.parse(await lib.text('published.json') || '{}'); } catch { return {}; } }
async function saveLedger(lib, led, message) { await lib.put('published.json', enc(JSON.stringify(led, null, 2) + '\n')); await lib.libraryChange(message); }

const people = list => [...new Set((Array.isArray(list) ? list : String(list || '').split(/[\s,;]+/)).map(x => x.trim().toLowerCase()).filter(Boolean))].slice(0, 200);
function allowed(entry, viewer, owner, kind) {
  if (viewer && viewer.u === owner.u && viewer.p === (kind === 'drive' ? 'google' : 'github')) return true;
  if ((entry.access || 'link') === 'link') return true;
  if (canEdit(entry, viewer, owner, kind)) return true;   // whoever may edit may open it too
  if (!viewer) return false;
  const emails = viewer.e || [], login = viewer.p === 'github' ? viewer.l.toLowerCase() : null;
  return (entry.people || []).some(x => x.startsWith('@') ? emails.some(e => e.endsWith(x)) : x.includes('@') ? emails.includes(x) : x === login);
}
/* Who may edit: the owner, and the people listed under "Can edit" (the same forms as above). */
function canEdit(entry, viewer, owner, kind) {
  if (!viewer) return false;
  if (viewer.u === owner.u && viewer.p === (kind === 'drive' ? 'google' : 'github')) return true;
  const emails = viewer.e || [], login = viewer.p === 'github' ? viewer.l.toLowerCase() : null;
  return (entry.editors || []).some(x => x.startsWith('@') ? emails.some(e => e.endsWith(x)) : x.includes('@') ? emails.includes(x) : x === login);
}
const expired = e => e.expires && new Date(e.expires + 'T23:59:59Z') < new Date();
const MAX_SHARES = 500, MAX_COMMENTS = 2000;   // per library, per deck: plenty for real use, a ceiling for abuse
const PASS_HOURS = 12;
/* Comments as a viewer gets them: names only (commenters' addresses stay with the owner), each marked if it's theirs. */
const forViewer = (doc, who, isOwner) => isOwner ? { comments: doc.comments.map(c => ({ ...c, mine: true })) } : {
  comments: doc.comments.map(c => ({ ...c, by: { n: c.by?.n || '' }, mine: !!who.e && c.by?.e === who.e,
    replies: (c.replies || []).map(r => ({ ...r, by: { n: r.by?.n || '' } })) })) };

/* ---------- the owner's side: /api/publish (Share), /api/comments ---------- */

export async function publishAPI(lib, method, r, url, deck, isDraft) {
  const led = await ledger(lib), e = led[deck];
  const state = x => ({ url: x?.url || '', access: x?.access || 'link', people: x?.people || [], editors: x?.editors || [], expires: x?.expires || '', inLibrary: !isDraft, online: true });
  if (method === 'GET') return json(state(e));
  if (isDraft) return json({ error: 'Give the presentation a title first.' });
  if (r.op === 'unpublish') {
    if (!e) return json(state(null));
    delete led[deck]; await lib.store.unpin(e.slug); await saveLedger(lib, led, `library: stop sharing ${baseOf(deck)}`); return json(state(null));
  }
  if (!e && Object.keys(led).length >= MAX_SHARES) return json({ error: `A library can share up to ${MAX_SHARES} decks. Stop sharing some first.` });
  const owner = lib.shareOwner();
  const next = { ...(e || { slug: `${baseOf(deck).slice(0, 40)}-${rand(10)}` }) };
  if ('access' in r) next.access = r.access === 'people' ? 'people' : 'link';
  if ('people' in r) next.people = people(r.people);
  if ('editors' in r) next.editors = people(r.editors);
  if ('expires' in r) next.expires = /^\d{4}-\d{2}-\d{2}$/.test(r.expires || '') ? r.expires : '';
  next.access ||= 'link'; next.people ||= []; next.editors ||= [];
  if (r.op === 'publish' || !e) {   // what's waiting committed, so the link has it from the start (it always shows the latest)
    await lib.flush();
    next.rev = lib.base?.id || '';
  }
  next.title = (await lib.meta(deck, lib.view()[deck + '/deck.html'])).title;
  next.url = `${url.origin}/p/${owner}/${next.slug}/`;
  led[deck] = next;
  await saveLedger(lib, led, `library: share ${baseOf(deck)}${next.access === 'people' ? ' with ' + next.people.length + ' people' : ''}`);
  return json(state(next));
}

export async function commentsAPI(lib, method, r, deck) {
  const me = { n: lib.cfg.user?.n || lib.cfg.user?.l || 'Owner', e: lib.cfg.user?.l || '', owner: true };
  if (method === 'GET') return json(await comments(lib, deck));
  return json(await changeComments(lib, deck, r, me, true));
}

async function comments(lib, deck) {
  try { const c = JSON.parse(await lib.text(deck + '/comments.json') || '{}'); return { comments: Array.isArray(c.comments) ? c.comments : [] }; } catch { return { comments: [] }; }
}
async function changeComments(lib, deck, r, by, isOwner) {
  const doc = await comments(lib, deck), list = doc.comments, find = id => list.find(c => c.id === id);
  const text = String(r.text || '').trim().slice(0, 4000), who = { n: String(by.n || '').slice(0, 100), e: String(by.e || '').slice(0, 200) };
  const mine = c => isOwner || (c.by?.e && c.by.e === who.e);
  if (r.op === 'add') {
    if (!text) return { ...doc, error: 'empty comment' };
    if (list.length >= MAX_COMMENTS) return { ...doc, error: 'This deck has as many comments as it can hold.' };
    const sid = /^[\w-]{1,40}$/.test(String(r.sid || '')) ? String(r.sid) : '';   // the slide's data-sid: it finds the slide after slides move
    list.push({ id: rand(8), slide: Math.max(1, Math.floor(+r.slide || 1)), ...(sid ? { sid } : {}), box: String(r.box || '').slice(0, 40), x: Math.round(+r.x || 0), y: Math.round(+r.y || 0),
                quote: String(r.quote || '').slice(0, 200), text, by: who, at: nowISO(), resolved: false, replies: [] });
  } else if (r.op === 'reply') {
    const c = find(r.id); if (!c || !text) return { ...doc, error: 'nothing to reply to' };
    c.replies.push({ id: rand(8), text, by: who, at: nowISO() });
  } else if (r.op === 'edit') {   // your own comment or reply (by your email)
    const c = find(r.id), t = c && (r.reply ? c.replies.find(x => x.id === r.reply) : c);
    if (!t || t.event || !text || !(t.by?.e && t.by.e === who.e)) return { ...doc, error: "you can only edit your own comments" };
    t.text = text; t.edited = nowISO();
  } else if (r.op === 'resolve') {
    const c = find(r.id); if (!c) return { ...doc, error: 'no such comment' };
    c.resolved = !!r.resolved; c.replies.push({ id: rand(8), text: r.resolved ? '(resolved)' : '(reopened)', by: who, at: nowISO(), event: true });
  } else if (r.op === 'delete') {
    const c = find(r.id); if (!c || !mine(c)) return { ...doc, error: "you can't remove that" };
    list.splice(list.indexOf(c), 1);
  } else return { ...doc, error: 'unknown op' };
  await lib.put(deck + '/comments.json', enc(JSON.stringify({ comments: list }, null, 2) + '\n'));
  await lib.savePending(); await lib.schedule();
  return { comments: list };
}

/* ---------- a viewer's side: /p/<owner>/<slug>/… (the Worker passes the viewer's session in x-viewer) ---------- */

export async function shareRoutes(lib, req, url) {
  const [, , slug = '', ...restParts] = url.pathname.split('/'), base = url.searchParams.get('base') || '/';
  let viewer = JSON.parse(req.headers.get('x-viewer') || 'null');
  const pass = (restParts[0]?.startsWith('~') ? restParts.shift()?.slice(1) : '') || req.headers.get('x-glideshow-view') || '';
  if (pass) { const p = await unlock(lib.env, pass); if (p?.k === 'view' && p.s === slug) viewer = p.v; }   // the sandboxed deck's own requests
  const rest = restParts.join('/');
  const led = await ledger(lib), [deck, entry] = Object.entries(led).find(([, e]) => e.slug === slug) || [];
  if (!entry || !lib.view()[deck + '/deck.html']) return page('Link not found', "<p>This link doesn't lead to a deck any more. Ask the person who sent it for a new one.</p>", 404);
  if (expired(entry)) return page('Link expired', '<p>This link has expired. Ask the person who sent it for a new one.</p>', 410);
  if (!allowed(entry, viewer, lib.cfg.user || {}, lib.cfg.kind)) {
    if (!viewer) return new Response(null, { status: 303, headers: { location: `/login?why=shared&next=${encodeURIComponent(base)}` } });
    return page('No access', `<p>You're signed in as <b>${esc(viewer.l)}</b>, which this deck isn't shared with.</p><p>Ask ${esc(lib.cfg.user?.n || 'its owner')} to add you, or use another account.</p><a class="btn" href="/logout?next=${encodeURIComponent(base)}">Use another account</a>`, 403);
  }
  if (rest === '__comments') {   // reading and adding comments needs a name to put on them
    if (!viewer) return json({ error: 'Sign in to see and add comments.', signin: true }, 401);
    const isOwner = viewer.u === lib.cfg.user?.u && viewer.p === (lib.cfg.kind === 'drive' ? 'google' : 'github');
    const who = { n: viewer.n, e: viewer.p === 'github' ? viewer.l : viewer.e[0] };
    if (req.method === 'GET') return json(forViewer(await comments(lib, deck), who, isOwner));
    const r = /** @type {{comments: any[], error?: string}} */ (await changeComments(lib, deck, await req.json().catch(() => ({})), who, isOwner));
    return json({ ...forViewer(r, who, isOwner), ...(r.error ? { error: r.error } : {}) });
  }
  const file = clean(rest || 'deck.html');
  let f = lib.base.tree[deck + '/' + file];   // the deck's latest saved files (the library checks for newer ones every few seconds)
  if (!f || f.folder) return new Response('not found', { status: 404 });
  const etag = `"${f.v}"`;   // a file's version: one changed under the same name (a plot made again) comes new, one that didn't costs a 304
  const keep = file === 'deck.html' ? 'private, no-cache' : 'private, max-age=300';   // a deck's files kept 5 minutes: a looping video asked again every loop otherwise
  if (file !== 'deck.html' && req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag, 'cache-control': keep } });
  let body;
  try { body = await lib.store.read({ ref: f.ref, bv: f.v }); }
  catch {   // read just as the file was replaced (Drive changes a file in place): once more, from the library as it is now
    await lib.refresh(true); f = lib.base.tree[deck + '/' + file];
    if (!f || f.folder) return new Response('not found', { status: 404 });
    body = await lib.store.read({ ref: f.ref, bv: f.v });
  }
  const headers = { 'content-type': typeOf(file), 'cache-control': keep, etag };
  if (file === 'deck.html') {   // the deck, with the comments panel on top
    const pass = viewer ? await lock(lib.env, { k: 'view', s: slug, v: viewer, x: Math.floor(Date.now() / 1000) + PASS_HOURS * 3600 }) : '';
    const boot = { comments: base + '__comments', pass, me: viewer ? { n: viewer.n } : null, report: '/report?link=' + encodeURIComponent(base),
                   signin: `/login?why=comment&next=${encodeURIComponent(base)}`, owner: lib.cfg.user?.n || '', title: entry.title || '',
                   edit: canEdit(entry, viewer, lib.cfg.user || {}, lib.cfg.kind) ? base.replace(/^\/p\//, '/e/') : '' };   // an Edit button for whoever may edit
    const inject = `<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/share/share.css"><script>window.GLIDESHOW = ${JSON.stringify(boot).replace(/</g, '\\u003c')}</script><script src="/share/share.js" defer></script>\n`;
    // first in <head>, so before any key handler of the deck's own (older decks' present.js takes Enter, N, P… at window
    // capture): keys typed into the comments panel's fields go to the field alone, and Esc closes the panel (gsEscape)
    // rather than leaving the slideshow. A signed-in viewer's pass rides in
    // the address of every file the deck loads (its <base>), since the sandboxed page sends no cookies.
    // The sandbox (no same origin) makes localStorage / sessionStorage throw, and reveal.js reads sessionStorage when a
    // phone turns the deck into its scroll view: it stopped halfway, a black screen. Both are stood in for by storage in
    // memory, for this visit, before any of the deck's scripts run.
    const storage = `<script>for (const k of ['localStorage', 'sessionStorage']) { try { window[k].length } catch { const m = new Map(); Object.defineProperty(window, k, { configurable: true, value: { get length() { return m.size }, key: i => [...m.keys()][i] ?? null, getItem: x => m.has(String(x)) ? m.get(String(x)) : null, setItem: (x, v) => { m.set(String(x), String(v)) }, removeItem: x => { m.delete(String(x)) }, clear: () => m.clear() } }) } }</script>`;
    const keys = storage + `<script>addEventListener('keydown', e => { const t = e.target; if (t.gsKey && t.closest('.gs-panel')) { e.stopImmediatePropagation(); t.gsKey(e); } else if (e.key === 'Escape' && window.gsEscape?.()) { e.preventDefault(); e.stopImmediatePropagation(); } }, true)</script>`
               + (pass ? `<base href="${esc(base)}~${pass}/">` : '');
    let html = dec(body); const at = html.lastIndexOf('</body>');
    html = at < 0 ? html + inject : html.slice(0, at) + inject + html.slice(at);
    body = enc(html.replace(/<head[^>]*>/, m => m + keys));
    headers['cache-control'] = 'no-store';
  }
  return file === 'deck.html' ? new Response(body, { headers }) : ranged(req, body, headers);
}
/* A deck's file in parts when asked (Range), as the owner's editor sends them (lib/library.js file): a video loops by
   seeking back to its start, which Chrome does only on a server that answers ranges. A shared link sent the whole file
   every time, and its videos stopped at their end once Chrome no longer held their start (2026-10-21, presenting). */
function ranged(req, body, headers) {
  const h = { ...headers, 'accept-ranges': 'bytes' }, m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
  if (!m || (!m[1] && !m[2])) return new Response(body, { headers: h });
  const n = body.length, start = m[1] ? +m[1] : Math.max(0, n - +m[2]), end = m[1] && m[2] ? Math.min(+m[2], n - 1) : n - 1;
  if (start >= n || start > end) return new Response(null, { status: 416, headers: { ...h, 'content-range': `bytes */${n}` } });
  return new Response(body.slice(start, end + 1), { status: 206, headers: { ...h, 'content-range': `bytes ${start}-${end}/${n}` } });
}

/* ---------- a collaborator's editor: /e/<owner>/<slug>/… (the Worker passes who is signed in, in x-viewer) ----------
   The editor (editor/index.html, its calls to /api/ and /deck/ sent under /e/<owner>/<slug>/) works on this one deck and
   nothing else: its file (cleaned both ways: clean.js), its pictures and videos, its comments. No listing, no other
   decks, no Share, no history, no restores; uploads only pictures and videos. */
const UPLOADS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'webm', 'mov']);
/** The deck this request may edit, or why not. @returns {Promise<{deck?: string, entry?: any, viewer?: any, error?: Response}>} */
export async function collabDeck(lib, req, slug) {
  const viewer = JSON.parse(req.headers.get('x-viewer') || 'null');
  const led = await ledger(lib), [deck, entry] = Object.entries(led).find(([, e]) => e.slug === slug) || [];
  if (!entry || !lib.view()[deck + '/deck.html']) return { error: page('Link not found', "<p>This link doesn't lead to a deck any more. Ask the person who sent it for a new one.</p>", 404) };
  if (expired(entry)) return { error: page('Link expired', '<p>This link has expired. Ask the person who sent it for a new one.</p>', 410) };
  if (!canEdit(entry, viewer, lib.cfg.user || {}, lib.cfg.kind))
    return { error: page("Can't edit", `<p>${viewer ? `<b>${esc(viewer.l)}</b> isn't` : "You aren't"} one of the people who can edit this deck.</p><p>Ask ${esc(lib.cfg.user?.n || 'its owner')} to add you under “Can edit”, or use another account.</p>`, 403) };
  return { deck, entry, viewer };
}
export async function collabRoutes(lib, req, url) {
  const [, , slug = '', ...rest] = url.pathname.split('/'), path = rest.join('/');
  const c = await collabDeck(lib, req, slug); if (c.error) return c.error;
  const { deck, entry, viewer } = c, deckFile = deck + '/deck.html', v = lib.view(), version = v[deckFile]?.v || '';
  const who = { n: viewer.n, e: viewer.p === 'github' ? viewer.l : viewer.e[0] };
  const body = req.method === 'POST' ? await req.arrayBuffer() : null, j = () => { try { return JSON.parse(dec(new Uint8Array(body))); } catch { return {}; } };
  if (path === '__can') return json({ ok: true, title: entry.title || '', view: url.searchParams.get('base')?.replace(/^\/e\//, '/p/') || '' });
  if (req.method === 'GET') {
    if (path === 'api/deck') return json({ html: await deckForCollaborator(await lib.text(deckFile) || ''), mtime: version, draft: false });
    if (path === 'api/events') return new Response(`retry: 8000\ndata: ${version}\n\n`, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
    if (path === 'api/ping') return json({ app: 'glideshow', cloud: true, collab: true, deck });
    if (path === 'api/recent' || path === 'api/history') return json([]);
    if (path === 'api/comments') return json(forViewer(await comments(lib, deck), who, false));
    if (path.startsWith('deck/')) {   // the deck's own files; deck.html (presenting) sandboxed, as a shared link is, its scripts the owner's
      const file = clean(path.slice(5) || 'deck.html');
      let f = v[deck + '/' + file];
      if (!f || f.folder) return new Response('not found', { status: 404 });
      const etag = `"${f.v}"`, keep = file === 'deck.html' ? { 'cache-control': 'no-store' } : { 'cache-control': 'private, max-age=300', etag };   // (as the owner's editor: library.js file)
      if (file !== 'deck.html' && req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: keep });
      let b; try { b = await lib.read(f); } catch { await lib.refresh(true); f = lib.view()[deck + '/' + file]; if (!f || f.folder) return new Response('not found', { status: 404 }); b = await lib.read(f); }   // (as above)
      const sandbox = file === 'deck.html' ? 'sandbox allow-scripts allow-popups allow-modals' : /^assets\/.*\.html?$/i.test(file) ? 'sandbox allow-scripts allow-pointer-lock' : 'sandbox';
      if (file === 'deck.html') b = enc(dec(b).replace(/<head[^>]*>/, m => m + `<script>for (const k of ['localStorage', 'sessionStorage']) { try { window[k].length } catch { const m = new Map(); Object.defineProperty(window, k, { configurable: true, value: { get length() { return m.size }, key: i => [...m.keys()][i] ?? null, getItem: x => m.has(String(x)) ? m.get(String(x)) : null, setItem: (x, v) => { m.set(String(x), String(v)) }, removeItem: x => { m.delete(String(x)) }, clear: () => m.clear() } }) } }</script>`));
      const fh = { 'content-type': typeOf(file), ...keep, 'x-content-type-options': 'nosniff', 'content-security-policy': sandbox };
      return file === 'deck.html' ? new Response(b, { headers: fh }) : ranged(req, b, fh);
    }
    return new Response('not found', { status: 404 });
  }
  if (path === 'api/save') {   // the owner's deck with this person's slides, cleaned, and their title; saved as the owner's would be
    const r = j();
    if (r.mtime !== version) return json({ error: 'conflict', mtime: version }, 409);
    if (typeof r.slides !== 'string') return json({ error: 'nothing to save' }, 400);
    const out = await composeDeck(await lib.text(deckFile) || '', r.slides, { title: titleOf(String(r.html || '')), same: r.same, count: r.count });
    if ((lib.view()[deckFile]?.v || '') !== version) return json({ error: 'conflict', mtime: lib.view()[deckFile]?.v || '' }, 409);   // saved by someone else while this one was being cleaned
    lib.by = who.n || who.e || ''; let mtime; try { mtime = await lib.put(deckFile, enc(out)); } finally { lib.by = ''; }
    lib.msgs.push(`${baseOf(deck)}: edited by ${who.n || who.e || 'a collaborator'}`);
    await lib.savePending(); await lib.schedule();
    return json({ mtime });
  }
  if (path === 'api/upload') {   // pictures and videos only (never an SVG or a page, which could carry a script)
    const ext = (url.searchParams.get('ext') || '').toLowerCase();
    if (!UPLOADS.has(ext)) return json({ error: 'Only pictures (PNG, JPEG, GIF, WebP) and videos (MP4, WebM, MOV) can be added here.' }, 415);
    if (!body || body.byteLength > 25_000_000) return json({ error: 'That file is too large (25 MB at most).' }, 413);
    return json({ src: await lib.storeAsset(deck, new Uint8Array(body), ext === 'jpeg' ? 'jpg' : ext) });
  }
  if (path === 'api/comments') { const r = /** @type {{comments: any[], error?: string}} */ (await changeComments(lib, deck, j(), who, false)); return json({ ...forViewer(r, who, false), ...(r.error ? { error: r.error } : {}) }); }
  if (path === 'api/selection') return json({ ok: true });
  return json({ error: 'not available here' }, 404);
}
