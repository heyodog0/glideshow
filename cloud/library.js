/* One person's library on glideshow.org: a Durable Object per person (user:<GitHub id>, user:g:<Google id>), over their
   GitHub repo (store-github.js) or the Glideshow folder in their Drive (store-drive.js). The logic is the editor's
   lib/library.js, which a library kept in a browser runs too (editor/local/sw.js); this adds the Durable Object, the two
   stores and sharing (share.js). The Mac pulls the commits it makes (history.py `sync`), and this side picks up pushes
   within seconds. */

import { DurableObject } from 'cloudflare:workers';
import { LibraryCore } from '../editor/lib/library.js';
import { GitHubStore } from './store-github.js';
import { DriveStore, makeRoot } from './store-drive.js';
import { shareRoutes, publishAPI, commentsAPI, collabRoutes, collabDeck } from './share.js';
export * from '../editor/lib/library.js';

/* Every editor open on a deck holds a WebSocket here, tagged with the deck's file (the Durable Object sleeps with them open);
   a save of that file, here or come from GitHub or Drive, sends them its new version (editor/js/boot.js remoteVersion). */
const notify = (lib, path, v, here = false) => {   // by: who saved it here (the owner, or the collaborator share.js names); none for a push or Drive
  const both = lib.merged?.[path]?.v === v ? lib.merged[path].both : undefined;   // a save merged with a push: where the save's version was kept
  const msg = JSON.stringify({ deck: path.slice(0, -'/deck.html'.length), v, by: here ? lib.by || lib.cfg.user?.n || lib.cfg.user?.l || '' : '', ...(both?.length ? { both } : {}) });
  for (const ws of lib.ctx.getWebSockets(path)) try { ws.send(msg); } catch {}
};
const deps = { store: lib => lib.cfg.kind === 'drive' ? new DriveStore(lib) : new GitHubStore(lib), makeRoot, share: { shareRoutes, publishAPI, commentsAPI, collabRoutes }, notify };

/* Requests a day, per library (every HTTP request here, an alarm, a WebSocket message as the 1/20 Cloudflare bills it):
   the free plan allows 100,000 Durable Object requests a day for the whole account, so one runaway editor (2026-10-21: a
   video slide downloading every video on each edit) could stop Glideshow for everyone. Past LIB_SLOW (20,000 by
   default) responses say `x-glideshow-load: slow` and the editor checks for changes once a minute instead of every
   8 s; past LIB_PAUSE (50,000) the background traffic (the poll, the live socket, selection reports) is refused, and
   the Worker refuses it too for a minute without asking here (worker.js). Saving, opening and viewing still work. Every
   5,000 the count goes to the Directory, which adds up the account's day for /admin and its alert (worker.js). */
const DAY = () => new Date().toISOString().slice(0, 10);
const BACKGROUND = /(^|\/)api\/(events|live|selection)$/;
async function meter(lib, w = 1) {
  if (!lib.use) lib.use = (await lib.ctx.storage.get('use')) || { day: '', n: 0, saved: 0, told: 0 };
  const u = lib.use, day = DAY();
  if (u.day !== day) Object.assign(u, { day, n: 0, saved: 0, told: 0 });
  u.n += w;
  const step = Math.floor(u.n / 5000);
  if (u.n - u.saved >= 100 || step > u.told) { u.saved = u.n; lib.ctx.waitUntil(lib.ctx.storage.put('use', u)); }
  if (step > u.told) {
    u.told = step;
    const who = lib.cfg?.user?.l || lib.cfg?.repo || lib.ctx.id.toString().slice(0, 12);
    lib.ctx.waitUntil(lib.env.DIR?.get(lib.env.DIR.idFromName('directory')).usage(lib.ctx.id.toString(), who, day, Math.round(u.n)).catch(() => {}));
  }
  return load(lib);
}
function load(lib) {
  const n = lib.use?.day === DAY() ? lib.use.n : 0;
  return n >= (+lib.env.LIB_PAUSE || 50_000) ? 'paused' : n >= (+lib.env.LIB_SLOW || 20_000) ? 'slow' : '';
}
const marked = (res, level) => {   // the load level on a response (not on a WebSocket's)
  if (!level || res.status === 101) return res;
  const h = new Headers(res.headers); h.set('x-glideshow-load', level);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
};
const pausedResponse = () => new Response(JSON.stringify({ error: 'paused', load: 'paused' }), { status: 429, headers: { 'content-type': 'application/json', 'x-glideshow-load': 'paused', 'retry-after': '3600' } });

export class Library extends DurableObject {
  constructor(ctx, env) { super(ctx, env); LibraryCore.prototype.init.call(this, ctx, env, deps); }
}
// LibraryCore's methods become the Durable Object's own: its RPC methods and its fetch and alarm handlers
for (const k of Object.getOwnPropertyNames(LibraryCore.prototype)) {
  if (k !== 'constructor') Object.defineProperty(Library.prototype, k, /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(LibraryCore.prototype, k)));
}
/* /api/live: the editor's WebSocket, for the deck this browser has open (its cookie, as /api/deck reads it); a
   collaborator's (/e/…/api/live), for the deck they may edit. */
const coreFetch = /** @type {(req: Request) => Promise<Response>} */ (/** @type {any} */ (Library.prototype).fetch);
Object.defineProperty(Library.prototype, 'fetch', { value: async function (req) {
  const path = new URL(req.url).pathname, level = await meter(this);
  if (level === 'paused' && BACKGROUND.test(path)) return pausedResponse();
  if (path === '/api/__usage' && this.env.DEV_LOGIN && req.method === 'POST') {   // tests (wrangler dev only): set today's count
    await meter(this, 0); this.use.n = this.use.saved = +(await req.json()).n || 0; this.use.told = Math.floor(this.use.n / 5000); await this.ctx.storage.put('use', this.use); return new Response(JSON.stringify({ n: this.use.n, load: load(this) }), { headers: { 'x-glideshow-load': load(this) } });
  }
  if (this.cfg?.repo && this.cfg.kind !== 'drive' && this.cfg.hooked !== this.cfg.repo.toLowerCase()) {   // once per repo: the webhook finds this library by it
    const repo = this.cfg.repo.toLowerCase(), was = this.cfg.hooked || '';
    this.cfg.hooked = repo; this.ctx.waitUntil(this.env.DIR.get(this.env.DIR.idFromName('directory')).watchRepo(repo, this.ctx.id.toString(), was).then(() => this.ctx.storage.put('cfg', this.cfg)).catch(() => { this.cfg.hooked = was; }));
  }
  return marked(await libraryFetch.call(this, req, path), level);
} });
/* A push to this library's repo (worker.js githubWebhook): look now, merging saves waiting for their commit with it and
   telling the open editors (refresh → rebaseDecks, notify). */
Object.defineProperty(Library.prototype, 'pushed', { value: async function (branch) {
  await meter(this); await this.loaded;
  if (!this.ready() || this.cfg.kind === 'drive' || (branch && branch !== this.cfg.branch)) return false;
  await this.refresh(true); return true;
} });
const libraryFetch = async function (req, path) {
  const collab = path.match(/^\/__collab\/([^/]+)\/api\/live$/);
  if ((path === '/api/live' || collab) && req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
    await this.loaded; if (!this.ready()) return new Response('no library', { status: 409 });
    await this.refresh();
    let deck = '';
    if (collab) { const c = await collabDeck(this, req, collab[1]); if (c.error) return c.error; deck = c.deck; }   // a collaborator: the deck they may edit
    else deck = this.current(req);
    if (!deck) return new Response('no deck', { status: 404 });
    const pair = new WebSocketPair(), [client, server] = [pair[0], pair[1]], tag = deck + '/deck.html';
    this.ctx.acceptWebSocket(server, [tag]);
    const v = collab ? JSON.parse(req.headers.get('x-viewer') || '{}') : null, me = this.cfg.user || {};
    const id = crypto.randomUUID().slice(0, 8);
    server.serializeAttachment({ id, tag, k: v ? `${v.p}:${v.u}` : 'owner', n: String((v ? v.n || v.l : me.n || me.l) || '').slice(0, 80), sid: '', box: '', sel: [] });
    server.send(JSON.stringify({ you: id }));
    tellPeople(this, tag);
    return new Response(null, { status: 101, webSocket: client });
  }
  return coreFetch.call(this, req);
};
const coreAlarm = /** @type {() => Promise<void>} */ (/** @type {any} */ (Library.prototype).alarm);
Object.defineProperty(Library.prototype, 'alarm', { value: async function () { await meter(this); return coreAlarm.call(this); } });
/* Who else has the deck open, and where: each editor's socket carries who it is and the slide
   and box it is on (its attachment, kept while the Durable Object sleeps); an editor says when that changes, and every
   editor of the deck then gets the list (editor/js/people.js). */
function tellPeople(lib, tag, gone = '') {
  const people = lib.ctx.getWebSockets(tag).map(ws => ws.deserializeAttachment()).filter(a => a && a.id !== gone)
    .map(({ id, k, n, sid, box, sel }) => ({ id, k, n, sid, box, sel }));
  const msg = JSON.stringify({ people });
  for (const ws of lib.ctx.getWebSockets(tag)) try { if (ws.deserializeAttachment()?.id !== gone) ws.send(msg); } catch {}
}
Object.defineProperty(Library.prototype, 'webSocketMessage', { async value(ws, data) {
  if (await meter(this, 1 / 20) === 'paused') { try { ws.close(4429, 'paused'); } catch {} return; }
  const a = ws.deserializeAttachment(); if (!a || typeof data !== 'string' || data.length > 4000) return;
  let here; try { here = JSON.parse(data).here; } catch { return; }
  if (!here || typeof here !== 'object') return;
  const id = x => typeof x === 'string' && /^[\w:.-]{1,80}$/.test(x) ? x : '';
  ws.serializeAttachment({ ...a, sid: id(here.sid), box: id(here.box), sel: (Array.isArray(here.sel) ? here.sel : []).map(id).filter(Boolean).slice(0, 20) });
  tellPeople(this, a.tag);
} });
Object.defineProperty(Library.prototype, 'webSocketClose', { value(ws) {
  const a = ws.deserializeAttachment();
  try { ws.close(); } catch {}
  if (a) tellPeople(this, a.tag, a.id);
} });
