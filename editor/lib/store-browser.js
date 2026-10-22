/* A library kept in this browser: the store behind local/sw.js, with the interface of cloud/store-github.js and
   cloud/store-drive.js. Each commit is a whole tree of paths -> file ids, kept in IndexedDB with the files themselves
   (browser-db.js), so version history and restore work as they do online. Nothing leaves the browser: shared links need
   a library in Drive or GitHub. */

import { get, put, del, keys } from './browser-db.js';
import { dec } from './library.js';

const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const KEEP = 100, EVERY = 25;   // versions kept; how often (in commits) the older ones and their files are cleared out
export const SIGN_IN_TO_SHARE = 'Sign in to share decks: shared decks live in your Google Drive or GitHub.';

export class BrowserStore {
  /** @param {any} lib */
  constructor(lib) { this.lib = lib; }

  /* The newest commit's tree (made empty the first time), or null when it is the one the library already has. */
  async head(prev) {
    let at = await get('commits', 'head');
    if (!at) { at = 'root'; await put('commits', [['root', { id: 'root', parent: null, time: Date.now(), message: 'library: start', tree: {} }], ['head', 'root']]); }
    if (prev?.id === at) return null;
    const c = await get('commits', at);
    return { id: at, sig: at, tree: c.tree };
  }
  async read(e) {
    const b = await get('blobs', e.bv || e.v || e.ref);
    if (!b) throw new Error('A file of this library is missing from the browser.');
    return new Uint8Array(b);
  }
  async write(base, changes, message) {
    const tree = { ...base.tree }, now = Date.now(), /** @type {[string, Uint8Array][]} */ blobs = [];
    for (const c of changes) {
      if (c.del) { delete tree[c.path]; continue; }
      if (c.ref) { tree[c.path] = { ref: c.ref, v: c.bv || c.ref, t: now }; continue; }
      const f = id(); blobs.push([f, c.bytes]); tree[c.path] = { ref: f, v: f, t: now };
    }
    const at = id(), n = ((await get('commits', base.id))?.n || 0) + 1;
    if (blobs.length) await put('blobs', blobs);
    await put('commits', [[at, { id: at, parent: base.id, n, time: now, message, tree }], ['head', at]]);
    if (n % EVERY === 0) await this.prune(at).catch(e => console.warn('glideshow: clearing old versions', e));
    const versions = {}; for (const c of changes) if (!c.del && tree[c.path]) versions[c.path] = tree[c.path].v;
    return { base: { id: at, sig: at, tree }, versions };
  }

  /* The newest KEEP versions stay; older ones go, and every file none of the kept ones uses. */
  async prune(head) {
    const kept = [];
    for (let c = await get('commits', head); c && kept.length < KEEP; c = c.parent && await get('commits', c.parent)) kept.push(c);
    const keep = new Set(kept.map(c => c.id)), used = new Set(kept.flatMap(c => Object.values(c.tree).map(e => e.v)));
    await del('commits', (await keys('commits')).filter(k => k !== 'head' && !keep.has(k)));
    await del('blobs', (await keys('blobs')).filter(k => !used.has(k)));
  }
  async lastChange(path) { return (this.lib.base.tree[path]?.t || 0) / 1000; }
  /* The commits that changed a file, newest first. */
  async history(path, n = 100) {
    const out = [];
    for (let at = await get('commits', 'head'), c = at && await get('commits', at); c && out.length < n; c = c.parent && await get('commits', c.parent)) {
      const before = c.parent ? (await get('commits', c.parent))?.tree[path]?.v : undefined;
      if (c.tree[path] && c.tree[path].v !== before) out.push({ rev: c.id, time: c.time / 1000, author: 'You', message: c.message, name: '', url: '' });
    }
    return out;
  }
  async readAt(rev, path) {
    const e = (await get('commits', rev))?.tree[path];
    return e ? dec(await this.read(e)) : '';
  }
  async filesAt(rev) {
    const c = await get('commits', rev);
    return c ? Object.fromEntries(Object.entries(c.tree).map(([p, e]) => [p, { ref: e.ref, v: e.v }])) : null;
  }

  async pin() { throw new Error(SIGN_IN_TO_SHARE); }
  async pinned() { return {}; }
  async unpin() {}
}
