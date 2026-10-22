/* Three-way merges of slides and of whole decks, on their HTML text (no DOM): the editor merges with them when a deck
   was saved elsewhere while it has changes of its own (storage.js mergeIn), and a library online does when a push from
   the Mac lands under a save of its own not yet committed (lib/library.js rebaseDecks).

   `base` is the version both sides started from; `mine` and `theirs` were made from it apart. A slide (by data-sid)
   comes from whichever side changed it. One both changed is merged box by box (by id): a box added on either side is
   kept, one removed on one side and left alone on the other goes, and one changed on both keeps mine. A slide or box
   one side removed and the other changed is kept, changed. The order is theirs, unless I moved things, then mine;
   what is new on one side goes after what it followed there.

   A classic script and a module at once (it exports nothing): the editor loads it with a <script>, lib/library.js
   imports it; both find it on globalThis.glideMerge. */
(() => {
  const normHTML = h => h.replace(/\sid="[^"]*"/g, '');   // ids the editor gives id-less boxes differ on every load
  const sameHTML = (a, b) => a === b || normHTML(a) === normHTML(b);
  const same = (a, b) => a !== undefined && b !== undefined && sameHTML(a, b);
  const sidOf = h => (h.match(/^<section\b[^>]*\sdata-sid="([^"]+)"/) || [])[1] || '';

  /* Keyed lists (key(item) → id), three ways. both(b, m, t) settles an item both sides changed (default: mine);
     val(item) is the HTML compared. */
  function mergeLists(base, mine, theirs, key, both = (b, m, t) => m, val = x => x) {
    const map = list => new Map(list.map(h => [key(h), h]));
    const same = (a, b) => a !== undefined && b !== undefined && sameHTML(val(a), val(b));
    const B = map(base), M = map(mine), T = map(theirs), clash = [], out = new Map();
    for (const id of new Set([...M.keys(), ...T.keys(), ...B.keys()])) {
      const b = B.get(id), m = M.get(id), t = T.get(id);
      if (m !== undefined && t !== undefined) {
        if (same(m, b)) out.set(id, t);
        else if (same(t, b) || same(t, m)) out.set(id, m);
        else { out.set(id, both(b, m, t)); clash.push(id); }
      }
      else if (m !== undefined) { if (b === undefined || !same(m, b)) out.set(id, m); }   // new here, or changed here though removed there
      else if (t !== undefined) { if (b === undefined || !same(t, b)) out.set(id, t); }
    }
    const ids = list => list.map(key);
    const moved = ids(mine).filter(id => B.has(id)).join() !== ids(base).filter(id => M.has(id)).join();
    const [lead, other] = moved ? [mine, theirs] : [theirs, mine];
    const order = ids(lead).filter(id => out.has(id));
    ids(other).forEach((id, i) => {   // what only the other side has: after what it follows there
      if (!out.has(id) || order.includes(id)) return;
      const prev = ids(other).slice(0, i).reverse().find(x => order.includes(x));
      order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, id);
    });
    for (const id of out.keys()) if (!order.includes(id)) order.push(id);
    return { list: order.map(id => out.get(id)), clash: clash.filter(id => order.includes(id)), order };
  }

  /* An element's parts, read off its text: what opens it, its top-level children (each whole), and what closes it.
     null when the tags don't pair up. Comments and raw-text elements (script, style, …) are taken whole. */
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const TOKEN = /<!--[\s\S]*?-->|<(script|style|textarea|title|xmp|noscript|template)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>|<(\/?)([a-zA-Z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>/g;
  function parts(html) {
    const open = html.match(/^\s*<([a-zA-Z][\w-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/);
    if (!open) return null;
    const close = html.match(/<\/\s*([a-zA-Z][\w-]*)\s*>\s*$/);
    if (!close || close[1].toLowerCase() !== open[1].toLowerCase()) return null;
    const body = html.slice(open[0].length, html.length - close[0].length), kids = [];
    let depth = 0, start = -1, last = 0;
    const text = (a, z) => { const t = body.slice(a, z).trim(); if (t) kids.push(t); };   // loose text between elements
    for (const m of body.matchAll(TOKEN)) {
      const at = m.index, end = at + m[0].length;
      const whole = m[0].startsWith('<!--') || m[1] || (!m[2] && (m[4] || VOID.has(m[3].toLowerCase())));
      if (depth === 0) text(last, at);
      if (whole) { if (depth === 0) { kids.push(m[0]); last = end; } continue; }
      if (m[2]) { if (--depth < 0) return null; if (depth === 0) { kids.push(body.slice(start, end)); last = end; } }
      else { if (depth === 0) start = at; depth++; }
    }
    if (depth) return null;
    text(last, body.length);
    return { open: open[0].trim(), kids, close: close[0].trim() };
  }
  /* A child's key: its id, else its tag and class with how many such came before it (a slide's notes, its style). */
  function keyer() {
    const seen = new Map();
    return h => {
      const id = h.match(/^<[a-zA-Z][\w-]*\b(?:[^>"']|"[^"]*"|'[^']*')*?\sid="([^"]+)"/);
      if (id) return 'id:' + id[1];
      const tag = (h.match(/^<([a-zA-Z][\w-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*?(?:\sclass="([^"]*)")?/) || []);
      const k = tag[1] ? tag[1].toLowerCase() + '.' + (tag[2] || '') : '#text', n = seen.get(k) || 0;
      seen.set(k, n + 1); return k + '#' + n;
    };
  }
  const keyed = list => { const k = keyer(); return list.map(h => [k(h), h]); };

  /* One slide both sides changed, box by box. Its own attributes (background, transition…) come from whichever side
     changed them, mine if both. A box without an id that was left as it was keeps its place by its content; when most
     of a side's boxes can't be matched (the slide was written anew), the slide is mine whole, as before. */
  function mergeBoxes(b, m, t, note = {}) {   // note.lost: something of theirs gave way to mine (a box, the slide's attributes, the slide)
    note.lost = true;
    const B = b === undefined ? null : parts(b), M = parts(m), T = parts(t);
    if (!B || !M || !T || /<section\b/i.test(B.kids.join('') + M.kids.join('') + T.kids.join(''))) return m;
    const bk = keyed(B.kids), base = new Map(bk);
    const match = side => {   // a side's children keyed as in base; id-less ones the editor numbered anew are found by content
      const out = keyed(side.kids), free = bk.filter(([k]) => !out.some(([o]) => o === k));
      let unmatched = 0;
      const res = out.map(([k, h]) => {
        if (base.has(k)) return [k, h];
        const i = free.findIndex(([, bh]) => normHTML(bh) === normHTML(h));
        if (i >= 0) { const [fk] = free.splice(i, 1); return [fk, h]; }
        unmatched++; return [k, h];
      });
      return { res, stale: bk.length > 1 && bk.filter(([k]) => !res.some(([o]) => o === k)).length > bk.length / 2 && unmatched > 0 };
    };
    const mm = match(M), tt = match(T);
    if (mm.stale || tt.stale) return m;
    const { list, clash } = mergeLists(bk, mm.res, tt.res, x => x[0], undefined, x => x[1]), kids = list.map(x => x[1]);
    const open = same(M.open, B.open) ? T.open : M.open;
    note.lost = clash.length > 0 || (!same(M.open, B.open) && !same(T.open, B.open) && !same(M.open, T.open));
    return `${open}\n${kids.map(k => '  ' + k).join('\n')}\n${M.close}`;
  }

  /* The editor's slides (each one <section>, as storage.js sectionHTML writes them), three ways: { html, both, bothIds },
     both being the slides (1-based, in the result) where something both sides changed kept mine, so theirs of it is
     only in the version history (said plainly to whoever kept theirs out: storage.js mergeNote). */
  function mergeSlides(base, mine, theirs) {
    const lost = new Set();
    const { list, order } = mergeLists(base, mine, theirs, sidOf, (b, m, t) => { const n = {}, h = mergeBoxes(b, m, t, n); if (n.lost) lost.add(sidOf(m)); return h; });
    const ids = [...lost].filter(id => order.includes(id));
    return { html: list, both: ids.map(id => order.indexOf(id) + 1), bothIds: ids };
  }

  /* A deck file's slides: what comes before the first one, each top-level <section> (a stack, of sections, is one), and
     what comes after. null when they don't pair up. */
  function splitDeck(html) {
    const re = /<!--[\s\S]*?-->|<(script|style|textarea|title|xmp|noscript|template)\b[\s\S]*?<\/\1\s*>|<section\b(?:[^>"']|"[^"]*"|'[^']*')*>|<\/section\s*>/gi;
    const slides = []; let depth = 0, start = -1, first = -1, end = -1;
    for (const m of html.matchAll(re)) {
      if (m[1] || m[0].startsWith('<!--')) continue;
      if (m[0][1] === '/') { if (--depth < 0) return null; if (!depth) { slides.push(html.slice(start, m.index + m[0].length)); end = m.index + m[0].length; } }
      else { if (!depth) { start = m.index; if (first < 0) first = start; } depth++; }
    }
    if (depth || first < 0) return null;
    return { head: html.slice(0, first), slides, tail: html.slice(end) };
  }
  /* Each version's top-level slides keyed: by data-sid (a stack by the first one inside it). A slide without one (an
     agent's, not yet opened in an editor) by its exact content: it takes the id of the one slide elsewhere with that
     same content (an editor has since given it an id), but only when that is unambiguous: one id goes with that
     content in all the versions and it is the only one without an id in its own. Otherwise (two identical slides, a
     candidate beside its hidden original) each keeps a key of its content and how many came before it, so nothing is
     paired with the wrong partner; at worst both are kept. Near-identical slides (Morph steps) never match: the
     content must be the same. A slide without an id that a side changed is that side removing it and adding another,
     which is what a three-way merge of it should do. */
  const hashStr = t => { let h = 2166136261; for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };
  const print = h => normHTML(h).replace(/\sdata-sid="[^"]*"/g, '').replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
  const innerSid = h => (h.match(/<section\b[^>]*\sdata-sid="([^"]+)"/) || [])[1];
  const ownKey = h => sidOf(h) || (innerSid(h) ? 'stack:' + innerSid(h) : '');
  function slideKeys(lists) {
    const owners = new Map(), loose = lists.map(() => new Map());   // print → the ids with it; print → how many without one, per version
    lists.forEach((l, i) => l.forEach(h => { const k = ownKey(h), f = print(h);
      if (k) owners.set(f, new Set([...(owners.get(f) || []), k])); else loose[i].set(f, (loose[i].get(f) || 0) + 1); }));
    const sure = f => owners.get(f)?.size === 1 && loose.every(m => (m.get(f) || 0) <= 1) ? [...owners.get(f)][0] : '';
    return lists.map(l => { const seen = new Map(); return l.map(h => {
      const k = ownKey(h); if (k) return [k, h];
      const f = print(h), id = sure(f); if (id) return [id, h];
      const n = seen.get(f) || 0; seen.set(f, n + 1); return ['c:' + hashStr(f) + ':' + n, h];
    }); });
  }
  const third = (b, m, t) => same(m, b) ? t : m;
  /* Whole deck files, three ways: { html, both } (both as in mergeSlides), or null when one can't be read as slides. */
  function mergeDecks(base, mine, theirs) {
    const [B, M, T] = [base, mine, theirs].map(splitDeck);
    if (!M || !T || (base && !B)) return null;
    const [kb, km, kt] = slideKeys([B ? B.slides : [], M.slides, T.slides]);
    const lost = new Set();
    const { list, order } = mergeLists(kb, km, kt, x => x[0], (b, m, t) => { const n = { lost: true }, h = sidOf(m[1]) ? mergeBoxes(b?.[1], m[1], t[1], n) : m[1]; if (n.lost) lost.add(m[0]); return [m[0], h]; }, x => x[1]);
    const ids = [...lost].filter(id => order.includes(id));
    return {
      html: third(B?.head, M.head, T.head) + list.map(x => x[1]).join('\n\n') + third(B?.tail, M.tail, T.tail),
      both: ids.map(id => order.indexOf(id) + 1), bothIds: ids,
    };
  }

  /** @type {any} */ (globalThis).glideMerge = { mergeSlides, mergeDecks, mergeBoxes, splitDeck, sidOf, normHTML };
})();
