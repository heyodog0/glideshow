/* A library kept in a GitHub repo (cfg.repo, cfg.branch), reached with the Glideshow app's installation token.

   The interface library.js uses (store-drive.js has the same one):
     head(prev, force)       the files now: {id, tree: {path: {ref, v, t?}}}, or null when nothing changed since `prev`
     read(entry)             a file's bytes ({ref, bv})
     write(base, changes, message)   apply [{path, bytes} | {path, ref, bv} | {path, del}] in one go; returns {base, versions: {path: v}}
     lastChange(path)        when the file last changed (seconds)
     history(path, n) / readAt(rev, path) / filesAt(rev)   versions of a file, one of them, all files as of a version
     pin(deck, slug) / pinned(entry, deck) / unpin(slug)   a shared link's frozen copy of a deck */

import { installationToken } from './auth.js';
import { Buffer } from 'node:buffer';

export class GitHubStore {
  constructor(lib) { this.lib = lib; this.env = lib.env; this.tok = null; this.trees = new Map(); }
  get repo() { return this.lib.cfg.repo; }
  get branch() { return this.lib.cfg.branch; }

  async token() {
    if (!this.tok || this.tok.expires - Date.now() < 300_000) this.tok = await installationToken(this.env, this.repo);
    return this.tok.token;
  }
  /** @param {string} path @param {{ method?: string, body?: any, accept?: string, headers?: Record<string, string> }} [o] */
  async gh(path, { method = 'GET', body, accept = 'application/vnd.github+json', headers = {} } = {}) {
    return fetch(`https://api.github.com/repos/${this.repo}${path}`, { method, body: body && JSON.stringify(body),
      headers: { authorization: `Bearer ${await this.token()}`, 'user-agent': 'glideshow', accept, 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}), ...headers } });
  }
  async ghJSON(path, method = 'GET', body) {
    const r = await this.gh(path, { method, body }), j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`GitHub ${method} ${path.split('?')[0]}: ${r.status} ${j.message || ''}`);
    return j;
  }

  /* The branch head and its file tree (the head is a conditional request, which GitHub doesn't count). */
  async head(prev, force = false) {
    const r = await this.gh(`/git/ref/heads/${this.branch}`, { headers: prev?.etag && !force ? { 'if-none-match': prev.etag } : {} });
    if (r.status === 304) return null;
    if (!r.ok) throw new Error(`GitHub: can't read ${this.repo}@${this.branch} (${r.status})`);
    const sha = (await r.json()).object.sha, etag = r.headers.get('etag');
    if (prev?.id === sha) { prev.etag = etag; return null; }
    return { ...(await this.filesAtCommit(sha)), etag };
  }
  async filesAtCommit(sha) {
    const c = await this.ghJSON(`/git/commits/${sha}`), t = await this.ghJSON(`/git/trees/${c.tree.sha}?recursive=1`);
    if (t.truncated) throw new Error('the library repo is too large to list');
    const tree = {}; for (const e of t.tree) if (e.type === 'blob') tree[e.path] = { ref: e.sha, v: e.sha };
    return { id: sha, treeSha: c.tree.sha, tree };
  }

  async read(e) {   // content-addressed, so cached for good
    const sha = e.ref, key = new Request(`https://blob.cache/${this.repo}/${sha}`);
    const hit = await caches.default.match(key).catch(() => null);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
    const r = await this.gh(`/git/blobs/${sha}`, { accept: 'application/vnd.github.raw' });
    if (!r.ok) throw new Error(`GitHub: blob ${sha.slice(0, 7)} (${r.status})`);
    const buf = await r.arrayBuffer();
    await caches.default.put(key, new Response(buf, { headers: { 'cache-control': 'public, max-age=31536000, immutable' } })).catch(() => {});
    return new Uint8Array(buf);
  }

  /* One commit with every change, on top of the branch (again on top, if the Mac pushed meanwhile). */
  async write(base, changes, message) {
    const shas = {};
    for (const c of changes) if (!c.del) shas[c.path] = c.ref || (await this.ghJSON('/git/blobs', 'POST', { content: Buffer.from(c.bytes).toString('base64'), encoding: 'base64' })).sha;
    for (let attempt = 0; ; attempt++) {
      const tree = changes.filter(c => !c.del || base.tree[c.path]).map(c => ({ path: c.path, mode: '100644', type: 'blob', sha: c.del ? null : shas[c.path] }));
      if (!tree.length) return { base, versions: {} };
      const t = await this.ghJSON('/git/trees', 'POST', { base_tree: base.treeSha, tree });
      const c = await this.ghJSON('/git/commits', 'POST', { message: message.slice(0, 72) + (message.length > 72 ? '…' : '') + '\n\nfrom glideshow.org', tree: t.sha, parents: [base.id], author: this.lib.author() });
      const r = await this.gh(`/git/refs/heads/${this.branch}`, { method: 'PATCH', body: { sha: c.sha, force: false } });
      if (r.ok) {
        const next = { id: c.sha, treeSha: t.sha, tree: { ...base.tree }, etag: null };
        for (const ch of changes) { if (ch.del) delete next.tree[ch.path]; else next.tree[ch.path] = { ref: shas[ch.path], v: shas[ch.path] }; }
        return { base: next, versions: shas };
      }
      if (r.status !== 422 || attempt > 2) throw new Error(`GitHub: couldn't update ${this.branch} (${r.status})`);
      const was = base; base = await this.head(null, true);   // the Mac pushed meanwhile: commit on top of its work,
      if (changes.some(c => c.path.endsWith('/deck.html') && base.tree[c.path]?.v !== was.tree[c.path]?.v))   // unless it changed a deck this
        throw Object.assign(new Error('a deck changed in GitHub meanwhile'), { conflict: true });           // writes: that one is merged first
    }
  }

  async lastChange(path) {
    const c = await this.ghJSON(`/commits?sha=${this.branch}&per_page=1&path=${encodeURIComponent(path)}`).catch(() => []);
    return c[0] ? Date.parse(c[0].commit.committer.date) / 1000 : 0;
  }
  async history(path, n = 100) {
    const list = await this.ghJSON(`/commits?sha=${this.branch}&per_page=${n}&path=${encodeURIComponent(path)}`).catch(() => []);
    return list.map(c => ({ rev: c.sha, time: Date.parse(c.commit.committer.date) / 1000, author: c.commit.author.name, message: c.commit.message.split('\n')[0], name: '', url: c.html_url }));
  }
  async readAt(rev, path) {
    const r = await this.gh(`/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${rev}`, { accept: 'application/vnd.github.raw' });
    return r.ok ? r.text() : '';
  }
  async filesAt(rev) {   // a commit never changes, so kept
    if (!this.trees.has(rev)) { this.trees.set(rev, (await this.filesAtCommit(rev)).tree); if (this.trees.size > 30) this.trees.delete(this.trees.keys().next().value); }
    return this.trees.get(rev);
  }

  /* A shared link pins the commit it was made at (the Mac's `glideshow publish` does the same). */
  async pin() { return this.lib.base.id; }
  async pinned(entry, deck) {
    const all = await this.filesAt(entry.rev || this.lib.base.id), out = {};
    for (const [p, e] of Object.entries(all)) if (p.startsWith(deck + '/')) out[p.slice(deck.length + 1)] = e;
    return out;
  }
  async unpin() {}
}
