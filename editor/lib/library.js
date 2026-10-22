/* A library of decks, as the local server's API (glideshow/server.py) answers for ~/decks: the code behind glideshow.org
   (cloud/library.js, a Durable Object per person, over a GitHub repo or a Drive folder) and behind a library kept in a
   browser (local/sw.js, in a service worker, over IndexedDB). Saves land in its storage at once and are committed
   together after 30 s of quiet (as the Mac does); library changes (move, rename, folders) are committed straight away.

   Plain modules, no build step: what differs by place comes in `deps` (the stores, sharing) and `ctx` (a Durable Object's
   storage and alarms, or the browser's stand-in for them). A store answers head / read / write / lastChange / history /
   readAt / filesAt (and pin / pinned / unpin for shared links): cloud/store-github.js, cloud/store-drive.js,
   lib/store-browser.js. */

export const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });
export const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
export const getCookie = (req, name) => (req.headers.get('cookie') || '').split(/;\s*/).find(c => c.startsWith(name + '='))?.slice(name.length + 1) || '';
import './merge.js';   // globalThis.glideMerge (a classic script too: the editor loads it)
const { mergeDecks } = /** @type {any} */ (globalThis).glideMerge;

const concat = parts => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

const QUIET_MS = 30_000, CHUNK = 100_000, MAX_FETCH = 25_000_000;
const MAC_ONLY = 'This works in the Mac app only.';

/* ---------- deck files: the same rules as decks.py ---------- */

export const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', json: 'application/json', md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', pdf: 'application/pdf',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };
export const typeOf = p => TYPES[p.split('.').pop().toLowerCase()] || 'application/octet-stream';
export const dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
export const baseOf = p => p.slice(p.lastIndexOf('/') + 1);
export const join = (...ps) => ps.filter(Boolean).join('/');
export const enc = s => new TextEncoder().encode(s), dec = b => new TextDecoder().decode(b);
export const b64url = s => btoa(String.fromCharCode(...enc(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64url = s => dec(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
const UNTITLED = 'Untitled deck';

/* A library path from the editor: relative to the library, no '..' out of it, nothing hidden. */
export function clean(p) {
  const out = [];
  for (const part of String(p || '').replace(/^~\/decks\/?/, '').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!out.length) throw new Error(`${p} is outside the library`); out.pop(); continue; }
    if (part.startsWith('.')) throw new Error(`${p}: hidden folders can't be used`);
    out.push(part);
  }
  return out.join('/');
}
export const unhtml = s => s.replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", nbsp: ' ' })[e]);
export const escHTML = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c]);
export function titleOf(html, fallback = '') { const m = html.match(/<title>([\s\S]*?)<\/title>/); return (m ? unhtml(m[1].trim()) : '') || fallback; }
export function dateOf(html) { return html.slice(0, 20000).match(/<meta name="date" content="(\d{4}-\d{2}-\d{2})"/)?.[1] || ''; }
export function setTitle(html, title) { return html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escHTML(title)}</title>`); }
/* What the home screen calls an untitled deck: the first line of text on its first slide (decks.py shown_title). */
export function shownTitle(html, title) {
  if (!/^\s*untitled( deck| presentation)?\s*$/i.test(title)) return title;
  let first = html.slice(Math.max(0, html.indexOf('<section'))).slice(0, 200000);
  if (first.includes('</section>')) first = first.slice(0, first.indexOf('</section>'));
  for (const m of first.matchAll(/<div class="box(?![^"]*\bnote\b)[^"]*"[^>]*>\s*<div class="content"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g)) {
    const lines = m[1].replace(/<(br|\/div|\/p|\/li)[^>]*>/g, '\n').replace(/<[^>]+>/g, ' ').split('\n').map(l => l.replace(/\s+/g, ' ').trim());
    const line = lines.find(Boolean); if (line) return unhtml(line).slice(0, 80);
  }
  return '';
}
/* history.py commit_message: the first changed slide and its new words. */
export function commitMessage(old, neu) {
  if (!old) return `deck: ${titleOf(neu) || 'first save'}`.slice(0, 72);
  const split = h => { const i = h.indexOf('class="slides"'); return (i < 0 ? h : h.slice(i + 14)).split(/<section\b/).slice(1).map(x => x.includes('>') ? x.slice(x.indexOf('>') + 1) : x); };
  const words = h => h.replace(/<(svg|script|style)\b[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').split(' ').filter(Boolean);
  const a = split(old), b = split(neu);
  for (let i = 0; i < b.length; i++) {
    if (i >= a.length || b[i] !== a[i]) {
      const before = i < a.length ? words(a[i]) : [], after = words(b[i]), fresh = after.filter(w => !before.includes(w));
      return `slide ${i + 1}: ${(fresh.length ? fresh : after).slice(0, 6).join(' ') || 'edit'}`.slice(0, 72);
    }
  }
  return b.length < a.length ? `slide ${b.length}: removed` : 'deck: edit';
}

/* ---------- the library ---------- */

export class LibraryCore {
  /** @param {any} ctx @param {any} env @param {any} deps */
  constructor(ctx, env, deps) { this.init(ctx, env, deps); }
  /** @param {any} ctx @param {any} env @param {any} deps */
  init(ctx, env, deps) {
    /** @type {any} */ this.ctx = ctx; /** @type {any} */ this.env = env; /** @type {any} */ this.deps = deps;
    this.base = null; this.checked = 0; this.gen = 0; this.mem = new Map(); this.memBytes = 0; this.flushing = null; this._store = null;
    this.loaded = ctx.blockConcurrencyWhile(async () => {
      const s = await ctx.storage.get(['pending', 'msgs', 'recent', 'drafts', 'alias', 'cfg']);
      this.cfg = s.get('cfg') || {};           // {user: {u, l, n}} and where the library is: {repo, branch} (GitHub) or {kind: 'drive', drive: {root, refresh}, handle}
      this.pending = s.get('pending') || {};   // path -> {data, n} (bytes kept here) | {ref, bv} (a file already in the store) | {del: 1}; each with v (its version) and t
      for (const e of Object.values(this.pending)) if (e.sha && !e.ref) { e.ref = e.bv = e.sha; delete e.sha; }   // kept before stores had refs
      this.msgs = s.get('msgs') || [];         // commit messages for library changes not yet committed
      this.recent = s.get('recent') || [];     // decks opened here, newest first
      this.drafts = s.get('drafts') || {};     // draft id -> {folder, t}
      this.alias = s.get('alias') || {};       // a stored version -> the version it had before it was written, so an open editor's version still matches
    });
  }

  /* --- whose library, and which repo (auth.js signs in; /setup picks the repo) --- */
  async signedIn(who, userToken) {
    this.cfg.user = { u: who.u, l: who.l, n: who.n };
    if (!this.cfg.repo && this.env.DEV_REPO) {   // wrangler dev: the test library, without /setup
      Object.assign(this.cfg, { repo: this.env.DEV_REPO, branch: this.env.DEV_BRANCH || 'main' });
      await this.env.DIR.get(this.env.DIR.idFromName('directory')).claim(this.env.DEV_REPO.split('/')[0].toLowerCase(), who.u);   // first come: another test login can't take the owner's links
    }
    await this.ctx.storage.put({ cfg: this.cfg, userToken: { token: userToken, t: Date.now() } });
  }
  async setupInfo() {   // the repos this person can reach that the Glideshow app is installed on
    const ut = await this.ctx.storage.get('userToken');
    if (!ut || Date.now() - ut.t > 7 * 3600_000) { if (ut) await this.ctx.storage.delete('userToken'); return { repos: [], current: this.cfg.repo || '', stale: true }; }   // GitHub's user tokens last 8 hours
    const h = { authorization: `Bearer ${ut.token}`, accept: 'application/vnd.github+json', 'user-agent': 'glideshow' };
    const inst = await fetch('https://api.github.com/user/installations?per_page=100', { headers: h }).then(r => r.json()).catch(() => ({}));
    const repos = [];
    for (const i of inst.installations || []) {
      const r = await fetch(`https://api.github.com/user/installations/${i.id}/repositories?per_page=100`, { headers: h }).then(r => r.json()).catch(() => ({}));
      for (const x of r.repositories || []) repos.push({ repo: x.full_name, private: x.private, branch: x.default_branch, writable: !!x.permissions?.push });
    }
    return { repos, current: this.cfg.repo || '' };
  }
  async chooseRepo(repo) {
    const pick = (await this.setupInfo()).repos.find(r => r.repo === repo && r.writable);
    if (!pick) return { error: `You can't write to ${repo} through Glideshow.` };
    if (this.cfg.repo !== pick.repo) {   // a different library: start clean
      if (Object.keys(this.pending).some(p => !p.startsWith('.drafts/'))) await this.flush();
      Object.assign(this, { base: null, pending: {}, msgs: [], recent: [], drafts: {}, alias: {}, _store: null });
    }
    // the <owner> in its share links: the repo's owner, unless another person's library has it (two people with repos in
    // one organisation): then <owner>--2, which no GitHub name can be (GitHub allows no double hyphens)
    const dir = this.env.DIR.get(this.env.DIR.idFromName('directory')), owner = pick.repo.split('/')[0].toLowerCase();
    let handle = owner;
    for (let n = 2; !(await dir.claim(handle, this.cfg.user.u)); n++) handle = `${owner}--${n}`;
    const branch = this.env.DEV_BRANCH && pick.repo === this.env.DEV_REPO ? this.env.DEV_BRANCH : pick.branch;   // staging keeps the test branch (wrangler.toml env.dev)
    Object.assign(this.cfg, { kind: 'github', repo: pick.repo, branch, handle });
    await this.savePending(); await this.ctx.storage.put('cfg', this.cfg);
    await this.ctx.storage.delete('userToken');   // only setup uses the person's own GitHub token; the app's token does the rest
    return { ok: true };
  }
  /* A Google account's library: the Glideshow folder in their Drive, made on first sign-in (auth.js asks for drive.file). */
  async driveConnected(who, tokens) {
    this.cfg.user = { u: who.u, l: who.l, n: who.n, e: who.e?.[0] };
    const drive = { ...(this.cfg.drive || {}) };
    if (tokens.refresh_token) drive.refresh = tokens.refresh_token;
    if (!drive.refresh) return { error: 'Google gave no lasting access: remove Glideshow at myaccount.google.com/permissions and sign in again.' };
    if (!drive.root) drive.root = await this.deps.makeRoot(this.env, tokens.access_token);
    Object.assign(this.cfg, { kind: 'drive', drive, handle: this.cfg.handle || await this.claimHandle(who) });
    this._store = null; this.base = null;
    await this.ctx.storage.put('cfg', this.cfg);
    return { ok: true };
  }
  async claimHandle(who) {   // the <owner> in this library's share links: g.<name>, unique
    const dir = this.env.DIR.get(this.env.DIR.idFromName('directory')), stem = 'g.' + ((who.e?.[0] || who.l).split('@')[0].toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'user');
    for (let n = 1; ; n++) { const h = n === 1 ? stem : `${stem}${n}`; if (await dir.claim(h, who.u)) return h; }
  }
  async info() { return { ...this.cfg, drive: this.cfg.drive ? { root: this.cfg.drive.root, connected: !!this.cfg.drive.refresh } : undefined, ready: this.ready(), label: this.label() }; }
  ready() { return this.cfg.kind === 'browser' || (this.cfg.kind === 'drive' ? !!(this.cfg.drive?.root && this.cfg.drive?.refresh) : !!this.cfg.repo); }
  label() { return this.cfg.kind === 'browser' ? 'This browser' : this.cfg.kind === 'drive' ? 'Google Drive › Glideshow' : this.cfg.repo || ''; }
  shareOwner() { return this.cfg.handle || this.cfg.repo.split('/')[0].toLowerCase(); }   // share links' <owner>
  get store() { return this._store ??= this.deps.store(this); }

  /* The library's files now, checked at most every 5 s. */
  async refresh(force = false) {
    if (this.base && !force && Date.now() - this.checked < 5000) return;
    this.checked = Date.now();
    const gen = this.gen, next = await this.store.head(this.base, force);   // a write made here while this was reading wins over what it read
    if (next && gen === this.gen) {
      const was = this.base?.tree || {};
      this.base = next;
      if (this.deps.notify) for (const [p, e] of Object.entries(next.tree)) if (p.endsWith('/deck.html') && was[p]?.v !== e.v && !this.pending[p]) this.deps.notify(this, p, e.v);   // a push from the Mac, a change in Drive
      await this.rebaseDecks();
    }
  }
  /* A deck saved here and not yet committed whose file changed in the store meanwhile (the Mac pushed an agent's edit):
     the save is merged with that change (merge.js mergeDecks), three ways from the version it was made from, rather
     than committed over it. Each saved deck keeps that version (`from`: its v and its bytes) until it is committed.
     When the two can't be merged (a deck whose slides can't be told apart in its text), theirs stays the deck and this save is kept beside
     it as deck-conflict-<time>.html. */
  async rebaseDecks() {
    for (const [p, e] of Object.entries(this.pending)) {
      const now = this.base.tree[p];
      if (!p.endsWith('/deck.html') || !e.data || !e.from || !now || now.v === e.from.v) continue;
      const theirs = await this.read({ ref: now.ref, bv: now.v, v: now.v }), b = e.from.data ? await this.read({ data: e.from.data, n: e.from.n, v: e.from.data }) : enc('');
      const merged = mergeDecks(dec(b), dec(await this.read(e)), dec(theirs)), from = { v: now.v, ...(await this.keep(theirs)) };
      if (this.pending[p] !== e) continue;   // saved again while this was reading: the next refresh takes that one
      if (merged) {
        const mine = await this.keep(enc(merged.html));
        if (this.pending[p] !== e) continue;
        this.pending[p] = { ...mine, v: mine.data, t: Date.now(), from };
        this.merged = { ...this.merged, [p]: { v: mine.data, both: merged.bothIds } };   // which slides kept this side's over theirs (cloud/library.js notify)
        this.deps.notify?.(this, p, mine.data);   // (not as a save made here: it brings in the Mac's)
      } else {
        delete this.pending[p];
        this.set(join(dirOf(p), `deck-conflict-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}.html`), { data: e.data, n: e.n, v: e.v, t: Date.now() });
        this.deps.notify?.(this, p, now.v);
      }
    }
    await this.savePending();
  }

  /* --- the working tree: the branch's files with the changes not yet committed on top --- */
  view() {
    const v = {};
    for (const [p, x] of Object.entries(this.base.tree)) v[p] = { ref: x.ref, bv: x.v, v: this.alias[x.v] || x.v, t: x.t, folder: x.folder };
    for (const [p, e] of Object.entries(this.pending)) if (e.del) delete v[p]; else v[p] = e;
    return v;
  }
  async read(e) {
    if (!e) return null;
    if (this.mem.has(e.v)) return this.mem.get(e.v);
    let bytes;
    if (e.data) {
      const keys = Array.from({ length: e.n }, (_, i) => `d:${e.data}:${i}`), parts = [];
      for (let i = 0; i < keys.length; i += 128) { const got = await this.ctx.storage.get(keys.slice(i, i + 128)); parts.push(...keys.slice(i, i + 128).map(k => got.get(k))); }
      bytes = concat(parts.map(p => new Uint8Array(p)));
    } else bytes = await this.store.read(e);
    this.mem.set(e.v, bytes); this.memBytes += bytes.length;
    for (const [k, b] of this.mem) { if (this.memBytes < 40e6) break; this.mem.delete(k); this.memBytes -= b.length; }
    return bytes;
  }
  async text(path) { const b = await this.read(this.view()[path]); return b && dec(b); }
  async keep(bytes) {   // bytes kept in storage, in chunks: {data, n}
    const data = crypto.randomUUID().replace(/-/g, '').slice(0, 16), n = Math.max(1, Math.ceil(bytes.length / CHUNK)), obj = {};
    for (let i = 0; i < n; i++) obj[`d:${data}:${i}`] = bytes.slice(i * CHUNK, (i + 1) * CHUNK);
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i += 128) await this.ctx.storage.put(Object.fromEntries(keys.slice(i, i + 128).map(k => [k, obj[k]])));
    this.mem.set(data, bytes); this.memBytes += bytes.length;
    return { data, n };
  }
  async put(path, bytes) {   // a file changed here: kept in storage until the next commit
    // a deck remembers the committed version its saves started from (rebaseDecks merges against it)
    const was = this.pending[path], at = this.base?.tree[path];
    const from = !path.endsWith('/deck.html') ? undefined : was ? was.from : at ? { v: at.v, ...(await this.keep(await this.read({ ref: at.ref, bv: at.v, v: at.v }))) } : { v: '' };
    const { data, n } = await this.keep(bytes), v = data;
    this.set(path, { data, n, v, t: Date.now(), ...(from ? { from } : {}) });
    return v;
  }
  set(path, e) { this.pending[path] = e; if (path.endsWith('/deck.html')) this.deps.notify?.(this, path, e.v, true); }   // a deck saved: every editor open on it hears (cloud/library.js)
  remove(path) { if (this.base.tree[path]) this.pending[path] = { del: 1, v: 'del', t: Date.now() }; else delete this.pending[path]; }
  /* Copy (or move) everything under a folder to another; versions are shared, so nothing is uploaded again. */
  copyTree(from, to, move = false) {
    const v = this.view();
    for (const p of Object.keys(v)) if (p.startsWith(from + '/')) { this.set(to + p.slice(from.length), { ...v[p], t: Date.now() }); if (move) this.remove(p); }
  }
  async savePending() {
    const live = new Set(Object.values(this.pending).flatMap(e => [e.data, e.from?.data]).filter(Boolean)), dead = [];   // chunks no change refers to any more
    const known = (await this.ctx.storage.get('chunks')) || {};
    for (const [id, n] of Object.entries(known)) if (!live.has(id)) { for (let i = 0; i < n; i++) dead.push(`d:${id}:${i}`); delete known[id]; }
    for (const e of Object.values(this.pending)) { if (e.data) known[e.data] = e.n; if (e.from?.data) known[e.from.data] = e.from.n; }
    for (let i = 0; i < dead.length; i += 128) await this.ctx.storage.delete(dead.slice(i, i + 128));
    await this.ctx.storage.put({ pending: this.pending, msgs: this.msgs, recent: this.recent, drafts: this.drafts, alias: this.alias, chunks: known });
  }

  /* Decks and folders, as decks.py walk_library: a folder holding deck.html is a deck (not looked inside); hidden
     folders and stray assets/ are skipped. */
  walk(v = this.view()) {
    const decks = new Set(), dirs = new Set();
    for (const p of Object.keys(v)) {
      const parts = p.split('/');
      if (parts.some(x => x.startsWith('.') && x !== '.keep')) continue;
      if (parts.at(-1) === 'deck.html' && parts.length > 1) decks.add(parts.slice(0, -1).join('/'));
      for (let i = 1; i < parts.length && i <= 6; i++) dirs.add(parts.slice(0, i).join('/'));
    }
    const inDeck = d => { const parts = d.split('/'); for (let i = 1; i < parts.length; i++) if (decks.has(parts.slice(0, i).join('/'))) return true; return false; };
    const deckList = [...decks].filter(d => !inDeck(d)).sort();
    const folders = [...dirs].filter(d => !decks.has(d) && !inDeck(d) && !d.split('/').includes('assets')).sort();
    return { decks: deckList, folders };
  }
  async meta(deck, e) {   // title, shown title, date and last change of a deck, kept per version of its deck.html
    const key = 'm:' + e.v;
    let m = await this.ctx.storage.get(key);
    if (!m) {
      const html = dec(await this.read(e)), title = titleOf(html, baseOf(deck));
      let time = e.t ? e.t / 1000 : 0;
      if (!time) time = await this.store.lastChange(deck + '/deck.html');
      m = { title, shown: shownTitle(html, title), date: dateOf(html), time };
      await this.ctx.storage.put(key, m);
    }
    return m;
  }

  current(req) {   // the deck this browser has open (a cookie), else the most recently opened one
    const v = this.view(), has = d => d && v[d + '/deck.html'];
    let d = ''; try { d = decodeURIComponent(getCookie(req, 'deck')); } catch {}
    if (has(d)) return d;
    return this.recent.find(has) || this.walk(v).decks.map(x => [x, v[x + '/deck.html']]).sort((a, b) => (b[1].t || 0) - (a[1].t || 0))[0]?.[0] || '';
  }
  open(deck, res) {
    if (!deck.startsWith('.drafts/')) { this.recent = [deck, ...this.recent.filter(d => d !== deck)].slice(0, 12); this.ctx.storage.put('recent', this.recent); }
    res.headers.append('set-cookie', cookie('deck', encodeURIComponent(deck), 365 * 86400));
    return res;
  }
  async newDeck(title = '') {   // decks.py new_deck: the template with base.css, shapes.js and present.js inline, dated today
    const get = f => this.env.ASSETS.fetch(new Request('https://assets.local/deck/' + f)).then(r => r.text());
    const [tpl, base, shapes, present] = await Promise.all(['template.html', 'base.css', 'shapes.js', 'present.js'].map(get));
    let html = tpl.replace('{{BASE}}', () => base.trim()).replace('{{SHAPES}}', () => shapes.trim()).replace('{{PRESENT}}', () => present.trim());
    if (title) html = setTitle(html, title);
    return html.replace('</title>', `</title>\n<meta name="date" content="${new Date().toISOString().slice(0, 10)}">`);
  }
  agentsDoc() {   // AGENTS.md for a new deck: the one the library's decks already carry
    const n = {}; for (const [p, e] of Object.entries(this.view())) if (p.endsWith('/AGENTS.md') && e.ref && !e.data) (n[e.bv] ||= [e, 0])[1]++;
    const best = Object.values(n).sort((a, b) => b[1] - a[1])[0]?.[0];
    return best ? { ref: best.ref, bv: best.bv, v: best.bv, t: Date.now() } : null;
  }
  async makeDeck(dir, title = '') {
    await this.put(dir + '/deck.html', enc(await this.newDeck(title)));
    const a = this.agentsDoc(); if (a) this.set(dir + '/AGENTS.md', a);
  }
  unique(path) { const v = this.view(), taken = p => Object.keys(v).some(k => k === p || k.startsWith(p + '/')); let p = path, n = 2; while (taken(p)) p = `${path}-${n++}`; return p; }

  /* --- commits --- */
  schedule() { return this.ctx.storage.setAlarm(Date.now() + QUIET_MS); }
  async alarm() { await this.flush(); }
  async flush() {   // one commit at a time
    const prev = this.flushing, p = (async () => { await prev?.catch(() => {}); await this.commit(); })();
    this.flushing = p;
    try { return await p; } finally { if (this.flushing === p) this.flushing = null; }
  }
  async commit(retry = 0) {
    await this.refresh(true);
    const snap = Object.fromEntries(Object.entries(this.pending).filter(([p]) => !p.startsWith('.drafts/')));
    const paths = Object.keys(snap); if (!paths.length) return;
    const msgs = this.msgs.slice(), changes = [];
    for (const p of paths) {
      const e = snap[p];
      changes.push(e.del ? { path: p, del: true } : e.data ? { path: p, bytes: await this.read(e) } : { path: p, ref: e.ref, bv: e.bv });
    }
    let message = msgs.join('; ');
    if (!message) {
      const decks = paths.filter(p => p.endsWith('/deck.html') && !snap[p].del);
      if (decks.length) {
        const was = this.base.tree[decks[0]], old = was ? dec(await this.store.read({ ref: was.ref, bv: was.v })) : '';
        message = commitMessage(old, dec(await this.read(snap[decks[0]]))) + (decks.length > 1 ? ` (+${decks.length - 1} more)` : '');
      } else {
        const notes = paths.filter(p => p.endsWith('/comments.json')).map(p => baseOf(dirOf(p)));
        message = notes.length === paths.length ? `comments: ${notes.join(', ')}` : 'deck: assets';
      }
    }
    let wrote;
    try { wrote = await this.store.write(this.base, changes, message); }
    catch (err) {   // a deck changed in the store since this read it (the Mac pushed): merged in (refresh → rebaseDecks), then again
      if (!err.conflict || retry > 2) throw err;
      return this.commit(retry + 1);
    }
    const { base, versions } = wrote;
    this.base = base; this.gen++;
    for (const p of paths) if (this.pending[p] && this.pending[p] !== snap[p] && this.pending[p].from && !snap[p].del && snap[p].data) this.pending[p].from = { v: base.tree[p]?.v, data: snap[p].data, n: snap[p].n };
    for (const p of paths) if (!snap[p].del && versions[p] && snap[p].v !== versions[p]) this.alias[versions[p]] = snap[p].v;
    const live = new Set(Object.values(this.base.tree).map(x => x.v)); for (const k of Object.keys(this.alias)) if (!live.has(k)) delete this.alias[k];
    for (const p of paths) if (this.pending[p] === snap[p]) delete this.pending[p];   // left alone if it changed during the commit
    this.msgs = this.msgs.slice(msgs.length);
    await this.savePending();
  }
  author() { const u = this.cfg.user || {}; return { name: u.n || u.l || 'Glideshow', email: u.u ? `${u.u}+${u.l}@users.noreply.github.com` : 'glideshow@users.noreply.github.com' }; }
  async libraryChange(message) { this.msgs.push(message); await this.savePending(); await this.flush(); }

  /* ---------- the local server's API ---------- */
  async fetch(req) {
    try {
      if (!this.ready()) return json({ error: 'No library yet: set it up at /setup.' }, 409);
      await this.refresh();
      const url = new URL(req.url);
      if (url.pathname.startsWith('/__share/')) return await this.deps.share.shareRoutes(this, req, url);   // the Worker's call for a viewer (share.js)
      if (url.pathname.startsWith('/__collab/') && this.deps.share.collabRoutes) return await this.deps.share.collabRoutes(this, req, url);   // a collaborator's editor (share.js)
      return await this.handle(req, url);
    }
    catch (e) { return json({ error: String(e.message || e) }, 500); }
  }
  async handle(req, url) {
    const path = decodeURIComponent(url.pathname), q = url.searchParams;
    const body = req.method === 'POST' ? await req.arrayBuffer() : null, j = () => { try { return JSON.parse(dec(new Uint8Array(body))); } catch { return {}; } };
    const deck = this.current(req), deckFile = deck + '/deck.html', v = this.view();
    const isDraft = deck.startsWith('.drafts/');
    if (path === '/api/selection') return json({ ok: true });   // the Mac's `glideshow selection`; nothing online asks for it
    if (path === '/api/publish') return this.deps.share.publishAPI(this, req.method, j(), url, deck, isDraft);   // Share (share.js)
    if (path === '/api/comments') return this.deps.share.commentsAPI(this, req.method, j(), deck);
    // a deck's files; all but deck.html itself sandboxed, so a picture or page in it (an SVG with a script) opened on its own can't act as you
    // every file but the deck is sandboxed; a live box's page (an .html in assets/) may still run its own script
    const csp = p => p.endsWith('/deck.html') ? {} : { 'content-security-policy': /\/assets\/.*\.html?$/i.test(p) ? 'sandbox allow-scripts allow-pointer-lock' : 'sandbox' };
    /* deck.html is never kept; a deck's other files are, by the browser, for 5 minutes, then asked again with their version
       (304 when unchanged), and come in parts when asked (Range): a looping video sent whole with no-store was fetched
       again on every loop, every few seconds per video (2026-10-21: the day's free Durable Object requests in 3 hours).
       The editor fetches a file again after a change elsewhere anyway (render.js freshSrc). */
    const file = async p => {
      const e = v[p]; if (!e) return new Response('not found', { status: 404 });
      const deck = p.endsWith('/deck.html'), tag = `"${e.v}"`;
      const head = { 'content-type': typeOf(p), 'x-content-type-options': 'nosniff', ...csp(p), ...(deck ? { 'cache-control': 'no-store' } : { 'cache-control': 'private, max-age=300', etag: tag, 'accept-ranges': 'bytes' }) };
      if (!deck && req.headers.get('if-none-match') === tag) return new Response(null, { status: 304, headers: head });
      const b = await this.read(e); if (!b) return new Response('not found', { status: 404 });
      const range = !deck && /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
      if (range && (range[1] || range[2])) {
        const n = b.length, start = range[1] ? +range[1] : Math.max(0, n - +range[2]), end = range[1] && range[2] ? Math.min(+range[2], n - 1) : n - 1;
        if (start >= n || start > end) return new Response(null, { status: 416, headers: { ...head, 'content-range': `bytes */${n}` } });
        return new Response(b.slice(start, end + 1), { status: 206, headers: { ...head, 'content-range': `bytes ${start}-${end}/${n}` } });
      }
      return new Response(b, { headers: head });
    };

    if (req.method === 'GET') {
      if (path === '/api/ping') return json({ app: 'glideshow', cloud: true, library: this.label(), user: this.cfg.user?.l, deck });
      if (path === '/api/deck') {   // with each of the deck's files' versions: the editor fetches again only the ones that changed (render.js fresh)
        const files = {}; for (const [p, e] of Object.entries(v)) if (p.startsWith(deck + '/') && p !== deckFile && !e.folder) files[p.slice(deck.length + 1)] = e.v;
        return json({ html: await this.text(deckFile) || '', mtime: v[deckFile]?.v || '', draft: isDraft, files, id: b64url(deck) });   // id: its files under /library/<id>/
      }
      if (path === '/api/events') return new Response(`retry: 8000\ndata: ${v[deckFile]?.v || ''}\n\n`, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });   // one event per reconnect: a poll every 8 s
      if (path.startsWith('/deck/')) return file(join(deck, clean(path.slice(6))));
      if (path.startsWith('/library/')) {   // home-screen thumbnails: a file in any deck, by the deck's id
        const [id, ...rest] = path.slice(9).split('/');
        let d = ''; try { d = clean(unb64url(id)); } catch { return new Response('not found', { status: 404 }); }
        return file(join(d, clean(rest.join('/'))));
      }
      if (path === '/api/decks') {
        const out = (await Promise.all(this.walk(v).decks.map(async d => {
          const m = await this.meta(d, v[d + '/deck.html']).catch(() => null);   // gone since the last look (deleted in Drive, say): left out
          if (!m) { this.checked = 0; return null; }
          return { path: d, id: b64url(d), name: baseOf(d), folder: dirOf(d), title: m.title, shown: m.shown, date: m.date, mtime: m.time, current: d === deck };
        }))).filter(Boolean);
        return json(out.sort((a, b) => b.mtime - a.mtime));
      }
      if (path === '/api/folders') return json(this.walk(v).folders);
      if (path === '/api/recent') return json(await Promise.all(this.recent.filter(d => v[d + '/deck.html']).map(async d => ({ path: d, title: (await this.meta(d, v[d + '/deck.html'])).title, current: d === deck }))));
      if (path === '/api/localfonts') return json([]);
      if (path === '/api/history') return json(await this.history(deck, q.get('slide') ? +q.get('slide') : null));
      if (path === '/api/version') {
        if (!/^[\w.:-]{1,200}$/.test(q.get('rev') || '')) return json({ error: 'bad version' }, 400);
        return json({ html: await this.at(q.get('rev'), deckFile) });
      }
      return new Response('not found', { status: 404 });
    }

    if (path === '/api/save') {
      const r = j();
      if (r.mtime !== (v[deckFile]?.v || '')) return json({ error: 'conflict', mtime: v[deckFile]?.v || '' }, 409);
      const mtime = await this.put(deckFile, enc(r.html));
      if (isDraft) {   // decks.py name_draft: into the library once it has a title
        const title = titleOf(r.html), id = deck.slice(8);
        if (!title || title === UNTITLED || title === baseOf(deck)) { await this.savePending(); return json({ mtime, draft: true }); }
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'deck';
        const dst = this.unique(join(clean(this.drafts[id]?.folder || ''), slug));
        this.copyTree(deck, dst, true); delete this.drafts[id];
        const a = this.agentsDoc(); if (a) this.set(dst + '/AGENTS.md', a);
        await this.savePending(); await this.schedule();
        return this.open(dst, json({ mtime, moved: dst }));
      }
      await this.savePending(); await this.schedule();
      return json({ mtime });
    }
    if (path === '/api/discard') {
      if (isDraft) { for (const p of Object.keys(v)) if (p.startsWith(deck + '/')) this.remove(p); delete this.drafts[deck.slice(8)]; await this.savePending(); }
      return json({ ok: true }, 200, { 'set-cookie': cookie('deck', '', 0) });
    }
    if (path === '/api/open') {
      const r = j();
      try {
        if (r.new) {   // a draft, kept out of the library until it has a title
          for (const [id, d] of Object.entries(this.drafts)) if (Date.now() - d.t > 86400_000) { for (const p of Object.keys(v)) if (p.startsWith(`.drafts/${id}/`)) this.remove(p); delete this.drafts[id]; }
          const folder = clean(r.folder), id = `draft-${Date.now()}`;
          this.drafts[id] = { folder, t: Date.now() };
          await this.put(`.drafts/${id}/deck.html`, enc(await this.newDeck()));
          await this.savePending();
          return this.open(`.drafts/${id}`, json({ path: `.drafts/${id}` }));
        }
        if (r.copy) {
          const dst = join(dirOf(deck), clean(r.copy));
          if (Object.keys(v).some(p => p.startsWith(dst + '/'))) return json({ error: `${baseOf(dst)} already exists` });
          this.copyTree(deck, dst);
          await this.libraryChange(`library: copy ${baseOf(deck)} to ${dst}`);
          return this.open(dst, json({ path: dst }));
        }
        const asked = clean(r.path), target = v[asked + '/deck.html'] ? asked : join(dirOf(deck), asked);
        if (!v[target + '/deck.html']) {
          if (!r.create) return json({ error: `no deck.html in ${target}` });
          await this.makeDeck(target);
          await this.libraryChange(`library: new deck ${target}`);
        }
        return this.open(target, json({ path: target }));
      } catch (e) { return json({ error: String(e.message || e) }); }
    }
    if (path === '/api/deckop') {
      const r = j(), d = this.walk(v).decks.find(x => x === r.path);
      if (!d) return json({ error: 'unknown deck' });
      if (r.op === 'rename') {
        await this.put(d + '/deck.html', enc(setTitle(dec(await this.read(v[d + '/deck.html'])), String(r.title || '').trim() || baseOf(d))));
        await this.libraryChange(`library: rename ${baseOf(d)}`);
      } else if (r.op === 'duplicate') {
        const dst = this.unique(d + '-copy');
        this.copyTree(d, dst);
        await this.put(dst + '/deck.html', enc(setTitle(dec(await this.read(v[d + '/deck.html'])), 'Copy of ' + titleOf(dec(await this.read(v[d + '/deck.html'])), baseOf(d)))));
        await this.libraryChange(`library: duplicate ${baseOf(d)}`);
      } else if (r.op === 'delete') {
        for (const p of Object.keys(v)) if (p.startsWith(d + '/')) this.remove(p);
        await this.unshare(d);
        this.recent = this.recent.filter(x => x !== d);
        await this.libraryChange(`library: remove ${baseOf(d)}`);
      } else if (r.op === 'move') {
        let folder; try { folder = clean(r.folder); } catch (e) { return json({ error: e.message }); }
        if (folder === dirOf(d)) return json({ ok: true });
        const dst = this.unique(join(folder, baseOf(d)));
        this.copyTree(d, dst, true); await this.rekey(d, dst);
        this.recent = this.recent.map(x => x === d ? dst : x);
        await this.libraryChange(`library: move ${baseOf(d)} to ${folder || 'the top'}`);
        if (d === deck) return this.open(dst, json({ ok: true }));
      } else return json({ error: r.op === 'reveal' ? MAC_ONLY : 'unknown op' });
      return json({ ok: true });
    }
    if (path === '/api/folder') {
      const r = j();
      try {
        const at = clean(r.path), name = String(r.name || '').replace(/[/\\:]+/g, '-').trim(), inside = p => Object.keys(v).filter(k => k.startsWith(p + '/'));
        if (r.op === 'create') {
          if (!name || name.startsWith('.')) return json({ error: 'a folder needs a name' });
          if (inside(join(at, name)).length) return json({ error: `${name} already exists` });
          await this.put(join(at, name, '.keep'), new Uint8Array());
        } else if (r.op === 'rename') {
          if (!at || !name) return json({ error: 'nothing to rename' });
          const dst = join(dirOf(at), name);
          if (inside(dst).length) return json({ error: `${name} already exists` });
          this.copyTree(at, dst, true); await this.rekey(at, dst);
          this.recent = this.recent.map(x => x.startsWith(at + '/') ? dst + x.slice(at.length) : x);
          if (deck.startsWith(at + '/')) { await this.libraryChange(`library: rename folder ${at} ${name}`); return this.open(dst + deck.slice(at.length), json({ ok: true })); }
        } else if (r.op === 'delete') {
          if (!at || inside(at).some(p => baseOf(p) !== '.keep')) return json({ error: 'only an empty folder can be removed' });
          for (const p of inside(at)) this.remove(p);
        } else return json({ error: 'unknown folder op' });
        await this.libraryChange(['library:', r.op, 'folder', r.path, name].filter(Boolean).join(' '));
        return json({ ok: true });
      } catch (e) { return json({ error: String(e.message || e) }); }
    }
    if ((path === '/api/upload' || path === '/api/font' || path === '/api/save' || path === '/api/importdeck') && body?.byteLength > MAX_FETCH) return json({ error: 'That file is too large (25 MB at most).' });
    // a deck from elsewhere (a downloaded .html, or one moved from a browser's library): its deck.html makes the deck, then
    // /api/importfile brings each of its other files, raw, one request each (small requests: Workers' CPU limits)
    if (path === '/api/importdeck') {
      const r = j();
      if (typeof r.html !== 'string' || !/<section[\s>]/.test(r.html)) return json({ error: "That isn't a Glideshow deck." });
      let folder; try { folder = clean(r.folder || ''); } catch (e) { return json({ error: e.message }); }
      const dst = this.unique(join(folder, String(r.name || 'deck').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'deck'));
      await this.put(dst + '/deck.html', enc(r.html));
      const a = this.agentsDoc(); if (a) this.set(dst + '/AGENTS.md', a);
      await this.libraryChange(`library: bring in ${baseOf(dst)}`);
      return json({ ok: true, path: dst });
    }
    if (path === '/api/importfile') {
      let d = '', rel = ''; try { d = clean(q.get('deck') || ''); rel = clean(q.get('file') || ''); } catch (e) { return json({ error: e.message }); }
      if (!d || !rel || rel === 'deck.html' || !v[d + '/deck.html']) return json({ error: 'no such deck' });
      if (body.byteLength > MAX_FETCH) return json({ error: `${baseOf(rel)} is too large (25 MB at most).` });
      await this.put(join(d, rel), new Uint8Array(body)); await this.savePending(); await this.schedule();
      return json({ ok: true });
    }
    if (path === '/api/upload') return json({ src: await this.storeAsset(deck, new Uint8Array(body), (q.get('ext') || 'png').toLowerCase()) });
    if (path === '/api/fetch') {   // a pasted image address: the picture is copied into the deck
      const src = j().url || '';
      if (!/^https?:\/\//.test(src)) return json({ error: 'not a web address' });
      let r; try { r = await fetch(src, { headers: { 'user-agent': 'glideshow' } }); } catch (e) { return json({ error: String(e) }); }
      const kind = (r.headers.get('content-type') || '').split(';')[0].trim(), size = +r.headers.get('content-length') || 0;
      if (!kind.startsWith('image/')) return json({ error: 'not an image' });
      if (size > MAX_FETCH) return json({ error: 'too large' });
      const data = new Uint8Array(await r.arrayBuffer());
      if (data.length > MAX_FETCH) return json({ error: 'too large' });
      return json({ src: await this.storeAsset(deck, data, { 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' }[kind] || kind.split('/')[1]) });
    }
    if (path === '/api/font') {   // a dropped font file into assets/fonts/
      if (q.has('path')) return json({ error: MAC_ONLY });
      const name = q.get('name') || '', ext = (name.match(/\.[^.]+$/)?.[0] || '').toLowerCase(), data = new Uint8Array(body);
      if (!['.ttf', '.otf', '.woff', '.woff2'].includes(ext) || !data.length) return json({ error: 'not a font file' });
      const stem = name.slice(0, -ext.length).replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/ /g, '-') || 'font';
      await this.put(`${deck}/assets/fonts/${stem}${ext}`, data); await this.savePending(); await this.schedule();
      return json({ src: `assets/fonts/${stem}${ext}`, family: stem.replace(/[-_]/g, ' ') });
    }
    if (path === '/api/restore') {   // Version history → Restore: that deck.html and the pictures it used, back
      const rev = j().rev || '';
      if (!/^[\w.:-]{1,200}$/.test(rev)) return json({ error: 'bad version' });
      const html = await this.at(rev, deckFile); if (!html) return json({ error: 'no such version' });
      const then = await this.store.filesAt(rev).catch(() => null) || {};   // the pictures that version used (GitHub; Drive versions are per file)
      for (const [p, e] of Object.entries(then)) if (p.startsWith(deck + '/assets/') && !v[p]) this.set(p, { ref: e.ref, bv: e.v, v: e.v, t: Date.now() });
      const mtime = await this.put(deckFile, enc(html));
      this.msgs.push(`deck: restore a version of ${baseOf(deck)}`); await this.savePending(); await this.flush();
      return json({ mtime });
    }
    if (path === '/api/name') return json({ error: 'Naming versions works in the Mac app only.' });
    if (['/api/importpptx', '/api/importgslides', '/api/quit'].includes(path)) return json({ error: MAC_ONLY });
    return new Response('not found', { status: 404 });
  }

  async storeAsset(deck, data, ext) {   // server.py store: assets/ under a content hash
    if (!/^[a-z0-9]{1,5}$/.test(ext)) ext = 'png';
    const name = `${hex(await crypto.subtle.digest('SHA-1', data)).slice(0, 12)}.${ext}`, p = `${deck}/assets/${name}`;
    if (!this.view()[p]) { await this.put(p, data); await this.savePending(); await this.schedule(); }
    return `assets/${name}`;
  }
  async rekey(from, to) {   // publish.py rekey: published links follow a moved deck or folder
    let led; try { led = JSON.parse(await this.text('published.json') || ''); } catch { return; }
    const moved = Object.fromEntries(Object.entries(led).map(([k, x]) => [k === from || k.startsWith(from + '/') ? to + k.slice(from.length) : k, x]));
    if (JSON.stringify(moved) !== JSON.stringify(led)) await this.put('published.json', enc(JSON.stringify(moved, null, 2) + '\n'));
  }
  async unshare(d) {   // publish.py drop: a removed deck stops being shared, its frozen copy (Drive) gone too
    let led; try { led = JSON.parse(await this.text('published.json') || ''); } catch { return; }
    const gone = Object.keys(led).filter(k => k === d || k.startsWith(d + '/'));
    if (!gone.length) return;
    for (const k of gone) { await this.store.unpin(led[k].slug).catch(() => {}); delete led[k]; }
    await this.put('published.json', enc(JSON.stringify(led, null, 2) + '\n'));
  }
  async at(rev, path) { return this.store.readAt(rev, path); }   // a file as of one version
  async history(deck, slide) {   // history.py history: the store's versions of the deck's deck.html
    let out = await this.store.history(deck + '/deck.html', slide ? 40 : 100).catch(() => []);
    if (slide) {
      const sec = h => { const i = h.indexOf('class="slides"'); return [...(i < 0 ? h : h.slice(i)).split(/<section\b/).slice(1), ...Array(slide).fill('')][slide - 1]; };
      const texts = [...await Promise.all(out.map(c => this.at(c.rev, deck + '/deck.html'))), ''];
      out = out.filter((c, i) => sec(texts[i]) !== sec(texts[i + 1]));
    }
    return out;
  }
}
