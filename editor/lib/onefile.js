/* A deck as one .html file, and back (File → Download → Glideshow deck, File → Open a deck file…). Packing puts the
   deck's pictures, fonts and videos in the file as data: addresses and reveal.js itself in <style> / <script>, so it
   opens and presents in any browser, offline. Unpacking undoes both: data: addresses become files under assets/ (named by
   content, as the editor names what it stores) and reveal.js goes back to its address.

   A file can come from anyone, and slides run in the editor on glideshow.org with the reader's session, so unpacking also
   takes out what could run there (`safe`): every script but reveal.js and the deck's own two (put back as the editor's
   own copies), event-handler attributes, javascript: and data:text/html addresses, srcdoc, forms, objects and <base>. */

const REVEAL = /https:\/\/cdn\.jsdelivr\.net\/npm\/reveal\.js@[^"']+/;
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', avif: 'image/avif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', pdf: 'application/pdf',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };
const EXT = Object.fromEntries(Object.entries(TYPES).map(([e, t]) => [t, e === 'jpeg' ? 'jpg' : e]));

/* Bring a deck into the library the editor talks to: deck.html first, then each other file raw. Returns its path, or
   {error}. `files` maps paths in the deck (assets/…) to their bytes. */
/** @param {{ name: string, folder: string, html: string, files: Record<string, Uint8Array> }} deck */
export async function bringIn({ name, folder, html, files }) {
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'X-Glideshow': '1' }, body }).then(r => r.json()).catch(() => ({ error: 'network' }));
  const made = await post('/api/importdeck', JSON.stringify({ name, folder, html }));
  if (made.error) return made;
  const queue = Object.entries(files); let failed = '';
  const send = async () => {   // four at a time
    while (queue.length && !failed) {
      const [p, bytes] = /** @type {[string, Uint8Array]} */ (queue.shift());
      const r = await post(`/api/importfile?deck=${encodeURIComponent(made.path)}&file=${encodeURIComponent(p)}`, bytes);
      if (r.error) failed ||= `${p}: ${r.error}`;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, send));
  if (failed) { await post('/api/deckop', JSON.stringify({ path: made.path, op: 'delete' })); return { error: failed }; }   // all or nothing
  return { path: made.path };
}
/** @param {number} c */
const isB64 = c => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 47 && c <= 57) || c === 43 || c === 61;   // A-Z a-z / 0-9 + =
/** @param {Uint8Array} b */
export function toB64(b) { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); }
/** @param {string} s */
export const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/** @param {string} html @param {(path: string) => Promise<Uint8Array | null>} read  a deck file by its path in the deck */
export async function pack(html, read) {
  const refs = [...new Set([...html.matchAll(/(?<=["'(])assets\/[^"')\s]+/g)].map(m => m[0]))], inline = {};
  for (const p of refs) {
    const b = await read(p).catch(() => null);
    if (b) inline[p] = `data:${TYPES[p.split('.').pop().toLowerCase()] || 'application/octet-stream'};base64,${toB64(b)}`;
  }
  html = html.replace(/(?<=["'(])assets\/[^"')\s]+/g, p => inline[p] || p);
  const text = async u => { try { const r = await fetch(u); return r.ok ? r.text() : null; } catch { return null; } };   // offline as it can be
  for (const m of [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].filter(m => REVEAL.test(m[1]))) {
    const css = await text(m[1]); if (css) html = html.replace(m[0], () => `<style data-glideshow-src="${m[1]}">${css}</style>`);
  }
  for (const m of [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].filter(m => REVEAL.test(m[1]))) {
    const js = await text(m[1]); if (js) html = html.replace(m[0], () => `<script data-glideshow-src="${m[1]}">${js.replace(/<\/script/gi, '<\\/script')}</script>`);
  }
  return html;
}

/** @param {string} html @returns {Promise<{html: string, files: Record<string, Uint8Array>}>} */
export async function unpack(html) {
  html = await safe(html.replace(/<style data-glideshow-src="([^"]+)">[\s\S]*?<\/style>/g, (_, u) => `<link rel="stylesheet" href="${u}">`)
             .replace(/<script data-glideshow-src="([^"]+)">[\s\S]*?<\/script>/g, (_, u) => `<script src="${u}"></script>`));
  // data: addresses out into files. A scan, not a regular expression: a pattern over one picture's megabytes of base64
  // overflows the browser's regex engine (about 5 MB and up).
  const /** @type {Record<string, Uint8Array>} */ files = {}, /** @type {Record<string, string>} */ named = {};
  let out = '', at = 0, i = html.indexOf('data:');
  while (i >= 0) {
    const mark = html.indexOf(';base64,', i), type = mark > 0 && mark - i < 200 ? html.slice(i + 5, mark) : '';   // a stray "data:" in text: not one
    if (!/^[\w.+-]+\/[\w.+-]+$/.test(type)) { i = html.indexOf('data:', i + 5); continue; }
    let j = mark + 8; while (j < html.length && isB64(html.charCodeAt(j))) j++;
    if (j - mark - 8 >= 2000) {   // small ones (icons in the deck's own CSS) stay inline
      const uri = html.slice(i, j);
      if (!named[uri]) {
        const bytes = fromB64(html.slice(mark + 8, j));
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-1', bytes))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
        named[uri] = `assets/${hash}.${EXT[type] || 'bin'}`; files[named[uri]] = bytes;
      }
      out += html.slice(at, i) + named[uri]; at = j;
    }
    i = html.indexOf('data:', j);
  }
  html = out + html.slice(at);
  return { html, files };
}

/* A deck from elsewhere, with nothing left in it that could run as the person opening it. */
const URLISH = new Set(['href', 'src', 'xlink:href', 'action', 'data', 'poster', 'background', 'from', 'to', 'values', 'dynsrc', 'lowsrc']);
const GOES = new Set(['href', 'xlink:href', 'action', 'data']);   // opened as a page (an SVG there runs its scripts), not shown as a picture
/** @param {string} html */
export async function safe(html) {
  const d = new DOMParser().parseFromString(html, 'text/html');
  const own = async f => { try { const r = await fetch('/editor/deck/' + f); return r.ok ? (await r.text()).trim() : ''; } catch { return ''; } };
  for (const el of [...d.querySelectorAll('script')]) {
    if (el.id === 'deck-shapes' || el.id === 'deck-present') {   // the deck's own: the editor's copies, nothing else
      const fresh = d.createElement('script'); fresh.id = el.id; fresh.textContent = '\n' + await own(el.id === 'deck-shapes' ? 'shapes.js' : 'present.js') + '\n'; el.replaceWith(fresh);
    } else if (!(REVEAL.test(el.getAttribute('src') || '') && /^https:\/\/cdn\.jsdelivr\.net\/npm\/reveal\.js@[\w.]+\/dist\/reveal\.js$/.test(el.getAttribute('src') || '') && !el.textContent.trim())) el.remove();
  }
  d.querySelectorAll('object, embed, applet, form, base, frame, frameset, portal, meta[http-equiv], link[rel="import"]').forEach(e => e.remove());
  d.querySelectorAll('iframe').forEach(f => { if (!/^https?:\/\//i.test((f.getAttribute('src') || '').trim())) f.remove(); });
  d.querySelectorAll('animate, set, animateMotion, animateTransform').forEach(e => { if (/href/i.test(e.getAttribute('attributeName') || '')) e.remove(); });
  for (const el of d.querySelectorAll('*')) for (const a of [...el.attributes]) {
    const n = a.name.toLowerCase(), v = a.value.replace(/[\s\u0000-\u001f]+/g, '').toLowerCase();
    if (n.startsWith('on') || n === 'srcdoc' || n === 'formaction' || (URLISH.has(n) && /^(javascript|vbscript|data:text\/html|data:application\/xhtml)/.test(v))
        || (GOES.has(n) && /^data:image\/svg/.test(v))) el.removeAttribute(a.name);
  }
  return '<!doctype html>\n' + d.documentElement.outerHTML + '\n';
}
