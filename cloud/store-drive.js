/* A library kept in Google Drive: a "Glideshow" folder in the person's My Drive (cfg.drive.root), with a folder per
   library folder and deck, as on disk. Glideshow asks only for drive.file, so it sees nothing in their Drive but what it
   made there. The same interface as store-github.js. Drive keeps each file's past versions (its revisions), which are
   the version history; a shared link's frozen copy of a deck is a copy of its files under .shares/<slug>/. */

import { Buffer } from 'node:buffer';
import { typeOf, dirOf, baseOf } from './library.js';

const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,parents,md5Checksum,modifiedTime,trashed';
const KEEP_DAYS = 50;   // kept-forever versions of a deck (Drive allows 200 a file)

export class DriveStore {
  constructor(lib) { this.lib = lib; this.env = lib.env; this.tok = null; }
  get root() { return this.lib.cfg.drive.root; }
  get apiBase() { return this.env.DRIVE_API || 'https://www.googleapis.com'; }

  async token() {
    if (this.tok && this.tok.expires - Date.now() > 120_000) return this.tok.token;
    const r = await fetch(this.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.lib.cfg.drive.refresh, client_id: this.env.GOOGLE_CLIENT_ID, client_secret: this.env.GOOGLE_CLIENT_SECRET }) });
    const j = await r.json().catch(() => ({}));
    if (!j.access_token) throw new Error('Google Drive: access was withdrawn. Sign in again to reconnect Drive.');
    this.tok = { token: j.access_token, expires: Date.now() + (j.expires_in || 3600) * 1000 };
    return this.tok.token;
  }
  /** @param {string} path @param {{ method?: string, json?: any, raw?: any, type?: string, headers?: Record<string, string> }} [o] */
  async api(path, { method = 'GET', json: body, raw, type, headers = {} } = {}) {
    const r = await fetch(this.apiBase + path, { method, body: raw ?? (body && JSON.stringify(body)),
      headers: { authorization: `Bearer ${await this.token()}`, ...(body ? { 'content-type': 'application/json' } : type ? { 'content-type': type } : {}), ...headers } });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(`Google Drive ${method} ${path.split('?')[0]}: ${r.status} ${j.error?.message || ''}`); }
    return r;
  }
  apiJSON(path, opts) { return this.api(path, opts).then(r => r.json()); }

  /* Every file under the Glideshow folder: one listing (drive.file shows only what Glideshow made), checked every few
     seconds. Empty folders show as <folder>/.keep, as the GitHub library keeps them. */
  async head(prev) {
    const items = []; let page = '';
    do {
      const j = await this.apiJSON(`/drive/v3/files?q=${encodeURIComponent('trashed = false')}&spaces=drive&pageSize=1000&fields=${encodeURIComponent(`nextPageToken,files(${FIELDS})`)}${page ? '&pageToken=' + page : ''}`);
      items.push(...j.files); page = j.nextPageToken || '';
    } while (page);
    if (!items.some(f => f.id === this.root)) {   // the Glideshow folder was deleted (or trashed) in Drive: start a new one
      const f = await this.apiJSON('/drive/v3/files?fields=id', { method: 'POST', json: { name: 'Glideshow', mimeType: FOLDER } });
      this.lib.cfg.drive.root = f.id; await this.lib.ctx.storage.put('cfg', this.lib.cfg);
      items.push({ id: f.id, name: 'Glideshow', mimeType: FOLDER });
    }
    const byId = new Map(items.map(f => [f.id, f])), paths = new Map([[this.root, '']]);
    const pathOf = id => {
      if (paths.has(id)) return paths.get(id);
      const f = byId.get(id); if (!f || !f.parents?.length) return null;
      const up = pathOf(f.parents[0]); const p = up == null ? null : (up ? up + '/' : '') + f.name;
      paths.set(id, p); return p;
    };
    const tree = {}, folders = { '': this.root }, used = new Set();
    for (const f of items) {
      const p = pathOf(f.id); if (p == null || f.id === this.root) continue;
      if (f.mimeType === FOLDER) folders[p] = f.id;
      else { tree[p] = { ref: f.id, v: `${f.id}:${f.md5Checksum || f.modifiedTime}`, t: Date.parse(f.modifiedTime) }; used.add(dirOf(p)); }
    }
    for (const [p, id] of Object.entries(folders)) if (p && !Object.keys(tree).some(k => k.startsWith(p + '/'))) tree[p + '/.keep'] = { ref: id, v: id + ':folder', folder: true };
    const sig = Object.entries(tree).map(([p, e]) => p + '=' + e.v).sort().join('|');
    if (prev?.sig === sig) return null;
    return { id: String(Date.now()), sig, tree, folders };
  }

  async read(e) {
    const key = new Request(`https://drive.cache/${e.bv || e.v}`);
    const hit = await caches.default.match(key).catch(() => null);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
    const buf = await (await this.api(`/drive/v3/files/${e.ref}?alt=media`)).arrayBuffer();
    await caches.default.put(key, new Response(buf, { headers: { 'cache-control': 'private, max-age=86400' } })).catch(() => {});
    return new Uint8Array(buf);
  }

  async folder(path, folders) {   // a library folder's Drive folder, made (with its parents) when missing
    if (folders[path]) return folders[path];
    const parent = await this.folder(dirOf(path), folders);
    const f = await this.apiJSON('/drive/v3/files?fields=id', { method: 'POST', json: { name: baseOf(path), mimeType: FOLDER, parents: [parent] } });
    return (folders[path] = f.id);
  }
  async upload(path, bytes, id, folders) {
    if (id) return this.api(`/upload/drive/v3/files/${id}?uploadType=media&fields=id`, { method: 'PATCH', raw: bytes, type: typeOf(path) });
    const boundary = 'glideshow' + crypto.randomUUID().replace(/-/g, ''), meta = JSON.stringify({ name: baseOf(path), parents: [await this.folder(dirOf(path), folders)] });
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: ${typeOf(path)}\r\n\r\n`), Buffer.from(bytes), Buffer.from(`\r\n--${boundary}--`)]);
    return this.api('/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', raw: body, type: `multipart/related; boundary=${boundary}` });
  }

  /* Each change straight to Drive: a file moved keeps its id (and its history); one copied is copied by Drive; removed
     files go to the Drive trash; folders left empty by a move are trashed too. */
  async write(base, changes) {
    const folders = { ...base.folders }, moved = new Set();
    const gone = new Map(changes.filter(c => c.del && base.tree[c.path] && !base.tree[c.path].folder).map(c => [base.tree[c.path].ref, c.path]));
    for (const c of changes.filter(c => c.ref && gone.has(c.ref) && !moved.has(c.ref))) {   // a move: the file itself goes
      const from = gone.get(c.ref), to = await this.folder(dirOf(c.path), folders), was = folders[dirOf(from)];
      await this.api(`/drive/v3/files/${c.ref}?addParents=${to}&removeParents=${was}&fields=id`, { method: 'PATCH', json: { name: baseOf(c.path) } });
      moved.add(c.ref); c.done = true;
      changes.find(d => d.path === from && d.del).done = true;
    }
    for (const c of changes) {
      if (c.done) continue;
      const have = base.tree[c.path];
      if (c.del) { if (have) await this.api(`/drive/v3/files/${have.ref}?fields=id`, { method: 'PATCH', json: { trashed: true } }); continue; }
      if (baseOf(c.path) === '.keep') { await this.folder(dirOf(c.path), folders); continue; }   // a folder, nothing in it
      if (c.ref) await this.api(`/drive/v3/files/${c.ref}/copy?fields=id`, { method: 'POST', json: { name: baseOf(c.path), parents: [await this.folder(dirOf(c.path), folders)] } });
      else {
        if (have && !have.folder && baseOf(c.path) === 'deck.html') await this.keepDay(have.ref).catch(() => {});   // history is a nicety: never stop a save
        await this.upload(c.path, c.bytes, have && !have.folder ? have.ref : null, folders);
      }
    }
    // folders a removal left empty go to the trash too. Which ones is worked out from the changes, not from a fresh
    // listing: Drive goes on listing files it has just trashed for a moment, which kept emptied folders alive.
    const after = new Set(Object.keys(base.tree).filter(p => !base.tree[p].folder));
    for (const c of changes) if (c.del) after.delete(c.path); else if (baseOf(c.path) !== '.keep') after.add(c.path);
    const keepsFolder = d => changes.some(c => !c.del && c.path === d + '/.keep');
    const emptied = new Set(changes.filter(c => c.del).flatMap(c => { const out = []; for (let d = dirOf(c.path); d; d = dirOf(d)) out.push(d); return out; }));
    const trash = [...emptied].filter(d => folders[d] && !keepsFolder(d) && ![...after].some(p => p.startsWith(d + '/')));
    for (const d of trash.sort((a, b) => b.length - a.length)) await this.api(`/drive/v3/files/${folders[d]}?fields=id`, { method: 'PATCH', json: { trashed: true } }).catch(() => {});
    let next = await this.head(null);
    const versions = {}; for (const c of changes) if (!c.del && next.tree[c.path]) versions[c.path] = next.tree[c.path].v;
    return { base: next, versions };
  }

  /* Drive drops a file's past versions after 30 days, or past the newest 100, unless they are kept forever. So before a
     deck's first save of a new day (UTC), its last version from the day before is kept forever: past the last 30 days,
     its history is the end of each day it was edited, at most KEEP_DAYS of them (letting go of the oldest but the first). */
  async keepDay(id) {
    const j = await this.apiJSON(`/drive/v3/files/${id}/revisions?pageSize=1000&fields=${encodeURIComponent('revisions(id,modifiedTime,keepForever)')}`);
    const revs = j.revisions || [], head = revs[revs.length - 1];
    if (!head || head.keepForever || head.modifiedTime.slice(0, 10) === new Date().toISOString().slice(0, 10)) return;
    await this.api(`/drive/v3/files/${id}/revisions/${head.id}?fields=id`, { method: 'PATCH', json: { keepForever: true } });
    const kept = [...revs.filter(r => r.keepForever), head];
    for (const r of kept.slice(1, 1 + Math.max(0, kept.length - KEEP_DAYS)))
      await this.api(`/drive/v3/files/${id}/revisions/${r.id}?fields=id`, { method: 'PATCH', json: { keepForever: false } });
  }

  async lastChange(path) { return (this.lib.base.tree[path]?.t || 0) / 1000; }
  async history(path, n = 100) {
    const id = this.lib.base.tree[path]?.ref; if (!id) return [];
    const j = await this.apiJSON(`/drive/v3/files/${id}/revisions?pageSize=200&fields=${encodeURIComponent('revisions(id,modifiedTime,lastModifyingUser/displayName)')}`).catch(() => ({ revisions: [] }));
    return (j.revisions || []).reverse().slice(0, n).map(r => ({ rev: r.id, time: Date.parse(r.modifiedTime) / 1000, author: r.lastModifyingUser?.displayName || '', message: 'Saved', name: '', url: '' }));
  }
  async readAt(rev, path) {
    const id = this.lib.base.tree[path]?.ref; if (!id) return '';
    return this.api(`/drive/v3/files/${id}/revisions/${encodeURIComponent(rev)}?alt=media`).then(r => r.text()).catch(() => '');
  }
  async filesAt() { return null; }   // Drive versions are per file: a restore brings back deck.html only

  /* A shared link's frozen copy: the deck's files copied (by Drive) under .shares/<slug>/. */
  async pin(deck, slug) {
    await this.unpin(slug);
    const folders = { ...this.lib.base.folders };
    for (const [p, e] of Object.entries(this.lib.base.tree)) {
      if (!p.startsWith(deck + '/') || e.folder) continue;
      const to = `.shares/${slug}/${p.slice(deck.length + 1)}`;
      await this.api(`/drive/v3/files/${e.ref}/copy?fields=id`, { method: 'POST', json: { name: baseOf(to), parents: [await this.folder(dirOf(to), folders)] } });
    }
    this.lib.base = await this.head(null); this.lib.gen++;
    return 'copy:' + new Date().toISOString();
  }
  async pinned(entry) {
    const pre = `.shares/${entry.slug}/`, out = {};
    for (const [p, e] of Object.entries(this.lib.base.tree)) if (p.startsWith(pre)) out[p.slice(pre.length)] = e;
    return out;
  }
  async unpin(slug) {
    const id = this.lib.base.folders?.[`.shares/${slug}`];
    if (id) { await this.api(`/drive/v3/files/${id}?fields=id`, { method: 'PATCH', json: { trashed: true } }); this.lib.base = await this.head(null); this.lib.gen++; }
  }
}

/* The Glideshow folder in someone's My Drive, made on their first sign-in. */
export async function makeRoot(env, accessToken) {
  const r = await fetch((env.DRIVE_API || 'https://www.googleapis.com') + '/drive/v3/files?fields=id', { method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Glideshow', mimeType: FOLDER }) });
  const j = await r.json().catch(() => ({}));
  if (!j.id) throw new Error(`Google Drive: couldn't make the Glideshow folder (${r.status})`);
  return j.id;
}
