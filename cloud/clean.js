/* What a collaborator writes into someone else's deck, made safe.

   The editor isn't sandboxed: a deck's slides are put into the page as they are, on glideshow.org, as whoever is signed
   in. So the slides a collaborator saves are cleaned before they're written, and the deck they open is cleaned too (so
   the owner's own scripts don't run as the collaborator either). The cleaning keeps an allow-list, never a block-list:
   the tags and attributes the editor itself writes, with URLs, styles and data-* values checked. It runs on
   HTMLRewriter (Cloudflare's lol-html, which tokenises as the HTML standard does), so what it keeps is what a browser
   will see.

   What a collaborator can't add or change: scripts, event handlers, javascript: and other non-web URLs, frames,
   objects, forms, SVG that can script or link out, CSS that imports or loads from other sites. A frame (a live box, an
   embedded video) or a slide's own <style> already in the deck stays, unchanged: kept only if it is exactly one the
   owner's version has.

   cleanSlides(html, approved): the slides' HTML (<section>s), cleaned. approved: approvedFrom(the owner's deck).
   composeDeck(ownerDeck, slidesHtml, { title, same, count }): the owner's deck with its slides replaced (cleaned) and its
   title set; everything outside the slides (head, theme, the deck's scripts) stays the owner's, and so does every slide
   the collaborator left as it was (`same`), exactly, scripts and all. */

const TAGS = new Set(['section', 'div', 'span', 'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'sub', 'sup',
  'small', 'mark', 'a', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'col', 'colgroup', 'caption',
  'pre', 'code', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'img', 'video', 'source', 'aside', 'figure',
  'figcaption', 'font',
  // SVG drawn by the editor (shapes, connectors, icons): drawing only
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs',
  'lineargradient', 'radialgradient', 'stop', 'clippath', 'marker']);
/* Gone with everything inside them. (Anything else not in TAGS goes but keeps its content.) */
const DROP = new Set(['script', 'noscript', 'template', 'object', 'embed', 'applet', 'frame', 'frameset', 'base', 'link', 'meta',
  'title', 'form', 'input', 'button', 'textarea', 'select', 'option', 'math', 'foreignobject', 'animate', 'animatemotion',
  'animatetransform', 'set', 'use', 'image', 'feimage', 'xmp', 'listing', 'plaintext', 'noembed', 'noframes', 'portal',
  'dialog', 'slot', 'audio', 'track', 'canvas', 'head', 'html', 'body']);
const GLOBAL = new Set(['id', 'class', 'style', 'title', 'lang', 'dir', 'hidden', 'role', 'tabindex']);
const PER_TAG = {
  a: ['href', 'target', 'rel'], img: ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
  video: ['src', 'poster', 'controls', 'playsinline', 'muted', 'loop', 'autoplay', 'preload', 'width', 'height'], source: ['src', 'type'],
  td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan', 'scope'], col: ['span', 'width'], colgroup: ['span'], ol: ['start', 'type', 'reversed'],
  font: ['color', 'size', 'face'], aside: [], section: [],
  svg: ['viewbox', 'preserveaspectratio', 'width', 'height', 'xmlns', 'fill', 'stroke', 'overflow'],
};
const SVG_ATTRS = ['d', 'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linejoin', 'stroke-linecap', 'stroke-dasharray',
  'stroke-opacity', 'stroke-miterlimit', 'opacity', 'transform', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height',
  'points', 'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'markerwidth', 'markerheight', 'refx', 'refy', 'orient',
  'markerunits', 'viewbox', 'preserveaspectratio', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline', 'vector-effect',
  'clip-path', 'marker-start', 'marker-end', 'marker-mid', 'clip-rule'];
for (const t of ['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'marker'])
  PER_TAG[t] = SVG_ATTRS;
PER_TAG.svg = [...PER_TAG.svg, ...SVG_ATTRS];
const URL_ATTRS = new Set(['href', 'src', 'poster']);

/* Attribute values come as written in the source (entities not decoded), so anything that isn't plainly one of these
   safe forms is refused: an entity or control character hiding a scheme fails closed. */
function safeURL(value, attr, tag) {
  const v = value.replace(/[\u0000- \u007f-\u009f]/g, '');
  if (!v) return true;
  if (/^(#|\/(?!\/)|\.{1,2}\/|[\w.-]+(\/|$|\?|#))/i.test(v) && !/^[a-z][\w+.-]*:/i.test(v)) return true;   // relative: assets/…, #id
  if (/^https?:\/\//i.test(v)) return true;
  if (attr === 'href' && tag === 'a' && /^mailto:/i.test(v)) return true;
  if (attr === 'src' && tag === 'img' && /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(v)) return true;
  return false;
}
/* A style attribute or a CSS text: declarations that could load from elsewhere or run anything dropped. */
const BAD_CSS = /expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|@import|\\|&|<\/?\s*\w/i;   // (& too: an entity, decoded by the browser, could spell any of these)
function cleanStyle(css) {
  const keep = css.split(';').filter(d => !d.trim() || ok(d)), all = css.split(';');
  return keep.length === all.length ? css : keep.filter(d => d.trim()).join(';');   // untouched unless something goes
}
function ok(d) {
  return [d].filter(d => d.trim() && !BAD_CSS.test(d) && [...d.matchAll(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi)].every(m => /^(#|assets\/|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(m[2].trim())) && !/url\s*\(/i.test(d.replace(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi, ''))).length > 0;
}
const SAFE_DATA = v => v.length <= 4000 && !/[<>"'`&]|javascript:|vbscript:|data:text/i.test(v);
const CLASS_OK = v => /^[\w\s-]*$/.test(v);
const ID_OK = v => /^[A-Za-z][\w:.-]{0,80}$/.test(v);
const sig = attrs => attrs.map(([k, v]) => `${k}=${v}`).sort().join('\u0001');

/** What in the owner's deck may stay as it is: its frames (by every attribute) and its slides' <style> texts. */
export async function approvedFrom(html) {
  const iframes = new Set(), styles = new Set();
  let buf = '';
  await new HTMLRewriter()
    .on('iframe', { element(e) { iframes.add(sig([...e.attributes])); } })
    .on('section style', { element() { buf = ''; }, text(t) { buf += t.text; if (t.lastInTextNode) { styles.add(buf); buf = ''; } } })
    .transform(new Response(html)).text();
  return { iframes, styles };
}

/* The handlers that clean, for HTMLRewriter: on every element under `scope` ('' for a whole fragment). */
function cleaning(rw, approved, scope = '') {
  let style = null;   // the <style> being read: its text kept only if the owner's deck has exactly it
  const el = scope ? `${scope} *` : '*', st = scope ? `${scope} style` : 'style';
  return rw
    .on(el, {
      element(e) {
        const tag = e.tagName.toLowerCase();
        if (tag === 'iframe') {   // a live box or an embed the owner made, exactly as it was; nothing else
          if (!approved.iframes.has(sig([...e.attributes]))) e.remove();
          return;
        }
        if (tag === 'style') {   // a slide's own style, as the owner wrote it; otherwise its text goes
          for (const [k] of [...e.attributes]) if (k !== 'class' && k !== 'media') e.removeAttribute(k);
          style = { text: '' };
          return;
        }
        if (DROP.has(tag)) { e.remove(); return; }
        if (!TAGS.has(tag)) { e.removeAndKeepContent(); return; }
        const own = new Set(PER_TAG[tag] || []);
        for (const [name, value] of [...e.attributes]) {
          const k = name.toLowerCase();
          let ok = GLOBAL.has(k) || own.has(k) || (/^data-[a-z0-9-]+$/.test(k) && SAFE_DATA(value)) || /^aria-[a-z]+$/.test(k);
          if (ok && URL_ATTRS.has(k)) ok = safeURL(value, k, tag);
          if (ok && k === 'class') ok = CLASS_OK(value);
          if (ok && k === 'id') ok = ID_OK(value);
          if (ok && (k === 'fill' || k === 'stroke' || k === 'clip-path' || k.startsWith('marker-'))) ok = !/url\s*\(\s*['"]?(?!#)/i.test(value) && !/[<>"&]|javascript:/i.test(value);
          if (ok && k === 'xmlns') ok = value === 'http://www.w3.org/2000/svg';
          if (ok && k === 'target') ok = /^_(blank|self)$/.test(value);
          if (!ok) { e.removeAttribute(name); continue; }
          if (k === 'style') { const c = cleanStyle(value); if (c !== value) c ? e.setAttribute(name, c) : e.removeAttribute(name); }
        }
        if (tag === 'a' && e.getAttribute('target') === '_blank') e.setAttribute('rel', 'noopener noreferrer');
      },
    })
    .on(st, {
      text(t) {
        if (!style) { t.remove(); return; }
        style.text += t.text; t.remove();
        if (t.lastInTextNode) { if (approved.styles.has(style.text)) t.replace(style.text, { html: true }); style = null; }
      },
    });
}

/** The slides' HTML (a fragment of <section>s), cleaned (see the top of this file). */
export async function cleanSlides(html, approved = { iframes: new Set(), styles: new Set() }) {
  const rw = cleaning(new HTMLRewriter().onDocument({ comments(c) { c.remove(); } }), approved);
  return rw.transform(new Response(html)).text();
}

/* The slides of a deck (the innermost <section>s, as the editor counts them), each with where it is in the text; null
   if the sections don't pair up. Scripts, styles and comments are stepped over whole. */
function leaves(html) {
  const re = /<!--[\s\S]*?-->|<(script|style|textarea|title|xmp|noscript|template)\b[\s\S]*?<\/\1\s*>|<section\b(?:[^>"']|"[^"]*"|'[^']*')*>|<\/section\s*>/gi;
  const out = [], open = [];
  for (let m; (m = re.exec(html));) {
    if (m[1] || m[0].startsWith('<!--')) continue;
    if (m[0][1] === '/') { const o = open.pop(); if (!o) return null; if (!o.kids) out.push({ start: o.start, end: re.lastIndex }); continue; }
    if (open.length) open[open.length - 1].kids = true;
    open.push({ start: m.index, kids: false });
  }
  return open.length ? null : out;
}
const sidIn = (html, at) => (html.slice(at, at + 2000).match(/^<section\b(?:[^>"']|"[^"]*"|'[^']*')*?\sdata-sid="([\w-]{1,40})"/) || [])[1] || '';
/* Slides the collaborator didn't touch: the owner's own, exactly as they are. `same` ({sid, at}: the slide's id and its
   place in the version their editor started from, which the save's version check makes the owner's deck now) comes from
   their editor; it can only bring back the owner's slides, never add anything of theirs, so it needn't be trusted. */
function keepUntouched(cleaned, ownerDeck, same, count) {
  const mine = leaves(ownerDeck), theirs = leaves(cleaned);
  if (!mine || !theirs || mine.length !== count || !Array.isArray(same)) return cleaned;
  const want = new Map();
  for (const s of same.slice(0, 5000)) {
    const at = s?.at, sid = typeof s?.sid === 'string' && /^[\w-]{1,40}$/.test(s.sid) ? s.sid : '';
    if (!sid || !Number.isInteger(at) || at < 0 || at >= mine.length) continue;
    const own = sidIn(ownerDeck, mine[at].start);
    if (own && own !== sid) continue;   // not the slide they say
    let raw = ownerDeck.slice(mine[at].start, mine[at].end);
    if (!own) raw = raw.replace(/^<section\b/i, `<section data-sid="${sid}"`);   // (an older slide, given the id their editor made for it)
    if (!want.has(sid)) want.set(sid, raw);
  }
  let out = '', from = 0;
  for (const l of theirs) {
    const sid = sidIn(cleaned, l.start), raw = want.get(sid);
    if (raw === undefined) continue;
    out += cleaned.slice(from, l.start) + raw; from = l.end; want.delete(sid);
  }
  return out + cleaned.slice(from);
}

/** The owner's deck with the collaborator's slides (cleaned, or the owner's own where untouched) in place of its own, and its title; nothing else of theirs. */
/** @param {string} ownerDeck @param {string} slidesHtml @param {{ title?: string, same?: {sid: string, at: number}[], count?: number }} [opts] */
export async function composeDeck(ownerDeck, slidesHtml, { title, same, count } = {}) {
  const slides = keepUntouched(await cleanSlides(slidesHtml, await approvedFrom(ownerDeck)), ownerDeck, same, count);
  let rw = new HTMLRewriter().on('div.slides', { element(e) { e.setInnerContent(slides, { html: true }); } });
  if (typeof title === 'string' && title.trim()) rw = rw.on('title', { element(e) { e.setInnerContent(title.trim().slice(0, 200)); } });
  return rw.transform(new Response(ownerDeck)).text();
}

/** The owner's deck as a collaborator's editor gets it: its slides cleaned the same way (the owner's frames and slide
    styles stay) and none of the owner's scripts or handlers anywhere, so nothing in it runs as the collaborator. Their
    saves go back into the owner's own deck (composeDeck), which keeps the owner's own copy of every slide they didn't
    change, so what's left out here is lost only from a slide they edit. */
export async function deckForCollaborator(ownerDeck) {
  const rw = cleaning(new HTMLRewriter(), await approvedFrom(ownerDeck), 'div.slides')
    .on('script', { element(e) { e.remove(); } })
    .on('*', { element(e) { for (const [k, v] of [...e.attributes]) if (/^on/i.test(k) || /^\s*javascript:/i.test(v)) e.removeAttribute(k); } });
  return rw.transform(new Response(ownerDeck)).text();
}
