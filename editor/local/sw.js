/* Glideshow without an account: the editor at glideshow.org with its library kept in this browser. glideshow.org/start
   installs this service worker (scope /, which the Worker allows it); from then on it answers the editor's own requests here, as the local server
   (glideshow/server.py) and a signed-in library (cloud/library.js) do: the pages, /api/…, the open deck's files under
   /deck/ and the home screen's thumbnails under /library/. The library is lib/library.js itself, over IndexedDB
   (lib/store-browser.js). Everything else (sign-in, shared links, the editor's own files) goes to glideshow.org as
   usual. Signing in (/login) unregisters it; the decks stay in the browser for the next visit to /start. */

import { LibraryCore, json } from '../lib/library.js';
import { BrowserStore, SIGN_IN_TO_SHARE } from '../lib/store-browser.js';
import { FolderStore, getFolder } from '../lib/store-folder.js';
import { storage } from '../lib/browser-db.js';

const sw = /** @type {any} */ (self);
const PASS = /^\/(p|share|editor|auth)\/|^\/(login|logout|setup|admin|report|privacy|terms|start|robots\.txt|favicon\.svg|favicon\.ico|apple-touch-icon\.png)$/;
const PAGES = { '/': '/editor/home.html', '/home': '/editor/home.html', '/edit': '/editor/index.html', '/index.html': '/editor/index.html' };

class BrowserLibrary extends LibraryCore {
  /* The deck this browser has open: kept in the library's storage (a service worker's responses can't set cookies). */
  current(req) { const v = this.view(); return this.cur && v[this.cur + '/deck.html'] ? this.cur : super.current(req); }
  open(deck, res) { this.cur = deck; this.ctx.storage.put('cur', deck); return super.open(deck, res); }
  schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush().catch(e => console.error('glideshow: commit', e)), 1500); }   // commits are local and cheap
}
let folder = null;   // the folder picked on glideshow.org ("Use a folder on this computer"), when there is one
const deps = {
  store: lib => folder ? new FolderStore(lib, folder) : new BrowserStore(lib),
  share: {
    publishAPI: (lib, method) => json(method === 'GET' ? { url: '', access: 'link', people: [], expires: '', inLibrary: false, online: true, error: SIGN_IN_TO_SHARE } : { error: SIGN_IN_TO_SHARE }),
    commentsAPI: () => json({ comments: [] }),
    shareRoutes: () => json({ error: 'not found' }, 404),
  },
};
const env = { ASSETS: { fetch: req => fetch('/editor' + new URL(req.url).pathname) } };   // the deck template, as the Worker's static files

const init = async () => {
  folder = await getFolder();
  const lib = new BrowserLibrary({ storage, blockConcurrencyWhile: fn => fn() }, env, deps);
  await lib.loaded;
  if (lib.cfg.kind !== 'browser') { lib.cfg = { kind: 'browser', user: { n: 'You' } }; await storage.put('cfg', lib.cfg); }
  lib.cur = await storage.get('cur');
  if (Object.keys(lib.pending).some(p => !p.startsWith('.drafts/'))) lib.schedule();   // saved but not committed when the browser last stopped this worker
  return lib;
};
let ready = init();
/* A page picked a folder, or gave its permission back: the library starts again over it. */
sw.addEventListener('message', e => { if (e.data?.type === 'library-changed') { ready = init(); e.waitUntil?.(ready); } });
let queue = Promise.resolve();   // one request at a time, as a Durable Object takes them
const answer = req => { const p = queue.then(async () => (await ready).fetch(req)); queue = p.catch(() => {}); return p; };

/* The editor's pages, told they are online in this browser (the editor hides what only the Mac or an account can do). */
async function page(file) {
  const html = await (await fetch(file, { cache: 'no-cache' })).text();
  const lib = await ready.catch(() => null), store = /** @type {any} */ (lib)?.store;
  const info = { local: true, user: '', name: '', repo: folder ? folder.name : 'This browser',
    folder: folder ? { name: folder.name, ok: store instanceof FolderStore ? await store.allowed() : false } : null };
  return new Response(html.replace('<head>', `<head>\n<script>window.GLIDESHOW_CLOUD = ${JSON.stringify(info)}</script>`), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

sw.addEventListener('install', () => sw.skipWaiting());
sw.addEventListener('activate', e => e.waitUntil(sw.clients.claim()));
sw.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || PASS.test(url.pathname)) return;   // glideshow.org's, as usual
  if (PAGES[url.pathname] && e.request.mode === 'navigate') return e.respondWith(page(PAGES[url.pathname]));
  if (url.pathname === '/api/fonts') return e.respondWith(fetch('/editor/data/fonts.json'));
  if (/^\/(api|deck|library)\//.test(url.pathname)) return e.respondWith(answer(e.request).catch(err => json({ error: String(err?.message || err) }, 500)));
});
