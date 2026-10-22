/* A library kept in a folder on this computer (glideshow.org's "Use a folder on this computer", Chrome and Edge): the
   browser library (store-browser.js) whose files are also the files of a folder the person picked, so the decks are real
   folders they can see, back up, put in Dropbox or hand to an agent. Version history stays in the browser, as it does for
   a library kept only there.

   Both ways: every save is written into the folder, and on each look at the library (`head`, at most every few seconds)
   files changed, added or removed in the folder from outside (an agent, a text editor) come in as one version,
   "outside the editor". What was last written or read is remembered per file (its version and the file's modified
   time), so a file that changed on neither side is left alone. Paths starting with a dot (drafts, the library's own
   state) stay in the browser only. If the browser has dropped its permission for the folder (a new session), the
   library keeps working in the browser and `needsPermission` says so; once the page has asked again, the next look
   writes out what the folder missed. */

import { get, put } from './browser-db.js';
import { BrowserStore } from './store-browser.js';
import { dec } from './library.js';

const HANDLE = 'folder:handle', MAP = 'folder:map', EVERY = 3000;
/** The folder this browser keeps its library in, or null. @returns {Promise<any>} */
export const getFolder = () => get('kv', HANDLE).catch(() => null);
/** @param {any} h */
export const setFolder = h => put('kv', [[HANDLE, h]]);
/** @param {any} dir @param {boolean} [ask] whether to ask (a page, with the person's click); a worker can only look */
export async function folderAllowed(dir, ask = false) {
  const o = { mode: 'readwrite' };
  if (await dir.queryPermission(o) === 'granted') return true;
  return ask ? await dir.requestPermission(o) === 'granted' : false;
}
const hidden = (/** @type {string} */ p) => p.split('/').some(s => s.startsWith('.'));

export class FolderStore extends BrowserStore {
  /** @param {any} lib @param {any} dir a FileSystemDirectoryHandle */
  constructor(lib, dir) { super(lib); this.dir = dir; this.last = 0; this.needsPermission = false; /** @type {Promise<any>} */ this.queue = Promise.resolve(); }
  /* Saves and folder syncs take turns, so neither moves the library's newest version from under the other. */
  /** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  turn(fn) { const p = this.queue.then(fn); this.queue = p.then(() => {}, () => {}); return p; }

  /** @param {any} prev @param {boolean} [force] */
  async head(prev, force) {
    if (force || Date.now() - this.last > EVERY) await this.turn(() => this.sync()).finally(() => { this.last = Date.now(); });
    return super.head(prev);
  }
  /** @param {any} base @param {any[]} changes @param {string} message */
  write(base, changes, message) { return this.turn(() => this.save(base, changes, message)); }
  /** @param {any} base @param {any[]} changes @param {string} message */
  async save(base, changes, message) {
    const now = await super.head(null);
    if (now && now.id !== base.id) base = now;   // a change from the folder came in since the library last looked: build on it, not over it
    const out = await super.write(base, changes, message);
    if (await this.allowed()) {
      const map = await this.map();
      for (const c of changes) if (!hidden(c.path)) await this.out(c.path, out.base.tree[c.path], map).catch(e => console.warn('glideshow: writing to the folder', c.path, e));
      await put('kv', [[MAP, map]]);
    }
    return out;
  }

  async allowed() { this.needsPermission = !(await folderAllowed(this.dir).catch(() => false)); return !this.needsPermission; }
  /** @returns {Promise<Record<string, { v: string, m: number }>>} */
  async map() { return (await get('kv', MAP)) || {}; }

  /* Every file of the folder, by path (dot files and folders left out). */
  async files(dir = this.dir, at = '', /** @type {Map<string, any>} */ out = new Map()) {
    for await (const [name, h] of dir.entries()) {
      if (name.startsWith('.')) continue;
      if (h.kind === 'directory') await this.files(h, at + name + '/', out); else out.set(at + name, h);
    }
    return out;
  }
  /** @param {string} path @param {boolean} [make] */
  async parent(path, make = false) {
    let d = this.dir; const parts = path.split('/'); parts.pop();
    for (const p of parts) d = await d.getDirectoryHandle(p, { create: make });
    return d;
  }
  /* The library's version of `path` into the folder (or its removal), remembered in `map`. */
  async out(path, e, map) {
    const name = path.split('/').pop();
    if (!e) { await (await this.parent(path)).removeEntry(name).catch(() => {}); delete map[path]; return; }
    const fh = await (await this.parent(path, true)).getFileHandle(name, { create: true }), w = await fh.createWritable();
    await w.write(await this.read(e)); await w.close();
    map[path] = { v: e.v, m: (await fh.getFile()).lastModified };
  }

  /* Folder and library made the same: outside changes come in as one version, then what the folder lacks goes out. */
  async sync() {
    if (!(await this.allowed())) return;
    const head = await super.head(null), tree = head?.tree || {}, map = await this.map(), files = await this.files();
    /** @type {any[]} */ const changes = [], came = new Set();
    for (const [path, fh] of files) {
      const f = await fh.getFile(), known = map[path];
      if (known && known.m === f.lastModified && tree[path]?.v === known.v) continue;   // unchanged on both sides
      if (known && known.m === f.lastModified) continue;   // only the library changed it: goes out below
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (tree[path] && dec(await this.read(tree[path]).catch(() => new Uint8Array())) === dec(bytes)) { map[path] = { v: tree[path].v, m: f.lastModified }; continue; }
      changes.push({ path, bytes }); came.add(path); map[path] = { v: '', m: f.lastModified };
    }
    for (const path of Object.keys(map)) if (!files.has(path) && tree[path]) { changes.push({ path, del: true }); came.add(path); delete map[path]; }   // removed outside
    let now = head;
    if (changes.length) {
      const names = [...new Set([...came].map(p => p.split('/').slice(0, -1).join('/') || p))].slice(0, 3).join(', ');
      now = (await super.write(head, changes, `outside the editor: ${names}`)).base;
      for (const p of came) if (map[p]) map[p].v = now.tree[p]?.v || '';
    }
    for (const [path, e] of Object.entries(now?.tree || {}))   // what the folder lacks or has older: written out
      if (!hidden(path) && !came.has(path) && map[path]?.v !== e.v) await this.out(path, e, map).catch(err => console.warn('glideshow: writing to the folder', path, err));
    await put('kv', [[MAP, map]]);
  }
}
