/* ---------- load / save / history ---------- */

function parseSlides(doc) {   // attached lines are fitted to their shapes as each slide comes in (shapes.js), as the viewer does
  const take = el => { const n = document.importNode(el, true); window.attachConnectors?.(n); return n; };
  return [...doc.querySelectorAll('.slides > section')].flatMap(s => {
    const kids = [...s.children].filter(c => c.tagName === 'SECTION');
    if (!kids.length) return [take(s)];
    const id = uid(); return kids.map(k => { const n = take(k); n.dataset.edStack = id; return n; });
  });
}
/* Each slide's id (data-sid on its <section>, kept in the deck), so edits made in two places merge slide by slide even
   when slides were added, removed or moved (mergeSlides). A slide that comes without one (an older deck, an agent's)
   gets one made from its place and content, the same in every editor that opens the same file; a new slide, or a
   copy of one, gets a fresh one. */
const hashStr = t => { let h = 2166136261; for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };
function ensureSids(fromFile = false) {
  const seen = new Set();
  slides.forEach((s, i) => {
    let id = s.dataset.sid;
    if (!id) id = fromFile ? 's' + hashStr(i + '\u0001' + s.outerHTML) : 's' + Math.random().toString(36).slice(2, 9);
    while (seen.has(id)) id = 's' + Math.random().toString(36).slice(2, 9);   // a copy keeps its original's id until here
    if (s.dataset.sid !== id) s.dataset.sid = id;
    seen.add(id);
  });
}
const sidOf = h => (h.match(/^<section\b[^>]*\sdata-sid="([^"]+)"/) || [])[1] || '';
/* Three versions of the slides (as sectionHTML lists): `base`, the last one this editor saved or loaded; `mine`, what it
   has now; `theirs`, what was saved elsewhere meanwhile. Merged slide by slide, and box by box in a slide both changed
   (lib/merge.js, which a library online merges with too): { html, both }, both being the slides both changed. */
const mergeSlides = (base, mine, theirs) => /** @type {{ html: string[], both: number[], bothIds: string[] }} */ (glideMerge.mergeSlides(base, mine, theirs));
/* Where a merge kept this editor's version of something the other side changed too (a box, a slide's settings), theirs
   is only in the version history: said in a bar over the slide that stays until dismissed (a status would be gone with
   the save that follows), the slides named and lit in the filmstrip, Version history a click away. */
function mergeNote(ids, by = '') {
  const at = ids.map(id => slides.findIndex(s => s.dataset.sid === id)).filter(i => i >= 0);
  if (!at.length || !$('#ed-merge-bar')) return;
  const n = at.map(i => i + 1), who = by || 'an edit made elsewhere';
  $('#ed-merge-what').textContent = `You and ${who} changed the same thing on slide${n.length > 1 ? 's' : ''} ${n.join(', ')}. Yours was kept; theirs is in Version history.`;
  $('#ed-merge-bar').hidden = false;
  if (!at.includes(cur)) go(at[0]);
  requestAnimationFrame(() => { for (const i of at) thumbs.children[i]?.animate([{ boxShadow: '0 0 0 3px #d93025' }, { boxShadow: '0 0 0 3px #d93025', offset: .8 }, { boxShadow: '0 0 0 0 transparent' }], { duration: 4000 }); });
}
/* Saved elsewhere while this editor has changes of its own: take theirs, merge mine in (mergeSlides), save the result. */
async function mergeIn() {
  const base = savedSnap, mine = slides.map(s => sectionHTML(s)), sid = slides[cur]?.dataset.sid, myTitle = $('#ed-title').value, baseTitle = deckDoc?.title;
  await load(true, true);
  const theirs = slides.map(s => sectionHTML(s)), { html, both, bothIds } = mergeSlides(base || [], mine, theirs);
  if (myTitle && myTitle !== baseTitle && $('#ed-title').value === baseTitle) $('#ed-title').value = myTitle;   // a title changed here, not there
  if (html.join('\0') !== theirs.join('\0') || $('#ed-title').value !== deckDoc.title) {
    restore({ html, cur: Math.max(0, html.findIndex(h => sidOf(h) === sid)) }); pushHistory();
  }
  const by = remoteBy;
  setStatus(`Merged your changes with an edit ${by ? 'by ' + by : 'made elsewhere'}`, 'merge');
  if (both.length) mergeNote(bothIds, by);
}
/* On glideshow.org a change someone else saved is not a step of this editor's undo: it goes into every state the undo
   history holds (each merged with it, as mergeSlides), so ⌘Z takes back only this editor's own changes and keeps
   theirs. A state that would undo theirs (one of this editor's later steps changed a slide they changed too, or removed)
   is marked, and undo stops there and says so rather than overwrite them. On the Mac a change from disk stays a step
   of its own, so an agent's edit can still be taken back with ⌘Z. */
const rebaseUndo = () => !!window.GLIDESHOW_CLOUD && !(/** @type {any} */ (window.GLIDESHOW_CLOUD).local);
function rebaseHistory(base, theirs, by = '') {
  const same = (a, b) => a === b || (a !== undefined && b !== undefined && normHTML(a) === normHTML(b));
  const B = new Map(base.map(h => [sidOf(h), h])), T = new Map(theirs.map(h => [sidOf(h), h]));
  const touched = [...B.keys()].filter(id => !same(B.get(id), T.get(id)));   // slides they changed or removed
  hist.forEach((st, i) => {
    const M = new Map(st.html.map(h => [sidOf(h), h])), clash = i === hptr ? [] : touched.filter(id => !same(M.get(id), B.get(id)));
    st.html = mergeSlides(base, st.html, theirs).html;
    if (clash.length) { st.clash = [...new Set([...(st.clash || []), ...clash])]; st.by = by || st.by || ''; }
  });
}
/* Undo or redo to a state that would overwrite someone else's change: not done, and said why. */
function overwrites(to) {
  if (!to?.clash?.length) return false;
  const at = to.clash.map(id => slides.findIndex(s => s.dataset.sid === id) + 1).filter(n => n > 0);
  setStatus(`Can't undo past this: ${to.by || 'someone else'} has since changed ${at.length ? `slide${at.length > 1 ? 's' : ''} ${at.join(', ')}` : 'a slide it would change'}`, 'block');
  return true;
}
const unsaved = () => !!savedSnap && slides.map(s => sectionHTML(s)).join('\0') !== savedSnap.join('\0');

async function load(keep, outside = false) {
  const was = outside ? slides.map(s => sectionHTML(s)).join('\0') : '';
  const j = await (await fetch('/api/deck', { cache: 'no-store' })).json();
  // changed here while the deck was on its way: not replaced; the change's own save meets the newer version and merges with it
  if (outside && slides.map(s => sectionHTML(s)).join('\0') !== was) { pendingReload = true; return; }
  const ids = new Set([...sel].map(b => b.id)), before = outside ? slides.map(s => sectionHTML(s)) : null;
  mtime = j.mtime; pendingReload = false; editing = null;
  if (outside && j.files && fileVers) {   // online: only the files that changed are fetched again (render.js fresh)
    for (const [p, ver] of Object.entries(j.files)) if (fileVers[p] && fileVers[p] !== ver) {
      fileGen.set(p, (fileGen.get(p) || 0) + 1);
      for (const k of [...gifStills.keys()]) if (fileOf(k) === p) gifStills.delete(k);
      for (const k of [...videoStills.keys()]) if (fileOf(k) === p) videoStills.delete(k);
    }
    thumbEpoch++;
  } else if (outside) { gifStills.clear(); videoStills.clear(); imgGen++; thumbEpoch++; }   // pictures and videos rewritten beside the deck are fetched again (render.js)
  if (j.files) fileVers = j.files;
  deckDoc = new DOMParser().parseFromString(j.html, 'text/html'); savedCode = deckCode(j.html); deckId = j.id || deckId;
  applySize();
  $('#ed-deck-theme-live').textContent = deckDoc.querySelector('#deck-theme')?.textContent || '';
  syncEditorFonts();
  // reveal.js stacks (a <section> of <section>s) become consecutive slides marked data-ed-stack (editor only; regrouped on save)
  slides = parseSlides(deckDoc);
  if (!slides.length) slides.push(blankSlide());
  slides.forEach(s => s.querySelectorAll('.box').forEach(b => { if (!b.id) b.id = uid(); }));
  ensureSids(true);
  cur = keep ? Math.min(cur, slides.length - 1) : 0;
  sel = new Set(keep ? boxes().filter(b => ids.has(b.id)) : []);
  $('#ed-title').value = deckDoc.title || 'Untitled deck';
  $('#ed-date').value = deckDoc.head.querySelector('meta[name="date"]')?.content || '';

  isDraft = !!j.draft;   // untitled and not saved to the library until it has a title (server: decks.py new_draft)
  document.body.classList.toggle('draft', isDraft);
  if (isDraft) { $('#ed-title').value = ''; $('#ed-title').placeholder = 'Untitled presentation'; draftStatus(); }
  render(); drawGuides();
  // a change from disk is one undo step: ⌘Z takes it back (and saves that); on glideshow.org it goes into the undo history instead
  if (outside && rebaseUndo() && savedSnap && hist.length) rebaseHistory(savedSnap, slides.map(s => sectionHTML(s)), remoteBy); else pushHistory();
  savedSnap = slides.map(s => sectionHTML(s));
  if (before) showOutsideChanges(before);
}

function cleanBox(b) {
  const c = b.cloneNode(true);
  c.querySelectorAll('svg.shape, svg.adj').forEach(e => e.remove());
  c.querySelectorAll('img[style*="#adj-"]').forEach(e => { e.style.filter = ''; if (!e.getAttribute('style')) e.removeAttribute('style'); });   // derived from data-adjust
  unrenderMath(c);   // the deck keeps the equation source
  c.querySelectorAll('[contenteditable], [spellcheck]').forEach(e => { e.removeAttribute('contenteditable'); e.removeAttribute('spellcheck'); });
  [c, ...c.querySelectorAll('.box')].forEach(e => ['--shx', '--shy', '--shb', '--shc', '--grad', '--fimg', '--fsize', '--frep', '--fit', '--ct', '--cr', '--cb', '--cl', '--tx-l', '--tx-t', '--tx-r', '--tx-b'].forEach(k => e.style.removeProperty(k)));   // derived; shapes.js recomputes them
  c.querySelectorAll('[data-ph]').forEach(e => e.removeAttribute('data-ph'));   // the editor's copy of the placeholder prompt
  c.querySelectorAll('[src*="gsv="], [poster*="gsv="]').forEach(e => ['src', 'poster'].forEach(a => { const v = e.getAttribute(a); if (v) e.setAttribute(a, plainSrc(v)); }));   // the editor's fetch-again mark (render.js)
  c.querySelectorAll('video[data-ed-poster]').forEach(v => { v.removeAttribute('poster'); v.removeAttribute('data-ed-poster'); });   // the editor's first frame for a video without a poster
  c.classList.remove('on');   // stray toolbar state that older editors leaked onto boxes with data-valign
  if (!c.getAttribute('style')?.trim()) c.removeAttribute('style');
  return c;
}
function sectionHTML(s, save) {
  const shell = s.cloneNode(false);
  if (save) shell.removeAttribute('data-ed-stack');
  const open = shell.outerHTML.slice(0, -'</section>'.length);
  const inner = [...s.children].map(e => '  ' + (e.classList.contains('box') ? cleanBox(e) : e).outerHTML).join('\n');
  return `${open}\n${inner}\n</section>`;
}
function deckHTML() {
  const d = deckDoc.cloneNode(true);
  d.title = $('#ed-title').value.trim() || 'Untitled deck';
  let meta = d.head.querySelector('meta[name="date"]');   // the deck's date: <meta name="date" content="YYYY-MM-DD">
  if ($('#ed-date').value) { if (!meta) { meta = d.createElement('meta'); meta.name = 'date'; d.head.querySelector('title').after(meta); } meta.content = $('#ed-date').value; }
  else meta?.remove();
  const put = (id, tag, text, parent) => {
    let e = d.getElementById(id);
    if (!e) { e = d.createElement(tag); e.id = id; parent.append(e); }
    e.textContent = '\n' + text.trim() + '\n';
  };
  put('deck-base', 'style', BASE_CSS, d.head);
  put('deck-shapes', 'script', SHAPES_JS, d.body);
  put('deck-present', 'script', PRESENT_JS, d.body);
  d.querySelector('.slides').innerHTML = '\n' + stacks(themeStash?.slides).map(g => g.length > 1
    ? '<section>\n' + g.map(s => sectionHTML(s, true)).join('\n\n') + '\n</section>' : sectionHTML(g[0], true)).join('\n\n') + '\n';
  return '<!doctype html>\n' + d.documentElement.outerHTML + '\n';
}

/* The slideshow's own code a deck carries (base.css, shapes.js, present.js: deckHTML writes this editor's copies on every
   save), as last saved or loaded. A deck last saved by an older editor, or written by an agent since, runs that older
   code when presented: a slideshow from the editor saves it first when it differs (arrange.js present), so a fix to the
   slideshow (2026-10-22: videos left paused coming back to their slide) reaches it at once. */
let savedCode = '', deckId = '';   // deckId: this deck's files are also /library/<id>/… (slides copied to another deck, keyboard.js)
const deckCode = (/** @type {string} */ html) => ['deck-base', 'deck-shapes', 'deck-present']
  .map(id => (html.match(new RegExp(`<(?:style|script) id="${id}">([\\s\\S]*?)</(?:style|script)>`)) || [])[1]?.trim() || '').join('\u0000');
const currentCode = () => [BASE_CSS, SHAPES_JS, PRESENT_JS].map(t => (t || '').trim()).join('\u0000');

function scheduleSave() {
  if (themeStash || histView) return;   // Edit theme's stand-in slides and history previews are never the deck   // Edit theme: the stand-in slides are never the deck
  clearTimeout(saveTimer);
  setStatus('Saving…', 'sync');
  saveTimer = setTimeout(save, 400);
}
let isDraft = false, savedSnap = null;   // savedSnap: each slide's HTML as last saved or loaded (what a clash merges against)
const normHTML = h => h.replace(/\sid="[^"]*"/g, '');   // ids the editor gives id-less boxes differ on every load
const draftStatus = () => { setStatus('Not saved: add a title', 'cloud_off'); $('#ed-status').dataset.tip = 'Untitled presentations are not kept. Give it a title to save it to your library.'; };
const draftEdited = () => isDraft && hptr > 0;   // something was done in it, so leaving would lose work
async function save() {

  if (saving) { saveTimer = setTimeout(save, 200); return; }
  saveTimer = null; saving = true;
  try {
    const snap = slides.map(s => sectionHTML(s));
    const html = deckHTML(), collab = /** @type {any} */ (window.GLIDESHOW_CLOUD)?.collab;
    // a collaborator's save is their slides (and title): the server puts them, cleaned, into the owner's deck (cloud/share.js),
    // keeping the owner's own copy of each slide left as it was in the version this save starts from (cloud/clean.js keepUntouched)
    const base = new Map((savedSnap || []).map((h, i) => [sidOf(h), { h, i }]));
    const r = await fetch('/api/save', { method: 'POST', body: JSON.stringify({ html, mtime, ...(collab ? { slides: new DOMParser().parseFromString(html, 'text/html').querySelector('.slides')?.innerHTML || '',
      same: snap.flatMap(h => { const b = base.get(sidOf(h)); return b && b.h === h ? [{ sid: sidOf(h), at: b.i }] : []; }), count: savedSnap?.length ?? -1 } : {}) }) });
    const j = await r.json();
    if (r.status === 409) {   // saved elsewhere meanwhile (an agent, another editor): merged slide by slide, then saved
      saving = false;
      await mergeIn();
      return;
    }
    mtime = j.mtime; savedSnap = snap; savedCode = deckCode(html);
    if (presenting()) refreshPresent();
    if (j.moved) { isDraft = false; deckPath = j.moved; $('#ed-title').placeholder = ''; document.body.classList.remove('draft'); if (window.GLIDESHOW_CLOUD && !/** @type {any} */ (window.GLIDESHOW_CLOUD).local) live(); }   // (the live link follows the deck it became)

    if (isDraft) { draftStatus(); saving = false; return; }
    setStatus('All changes saved', 'cloud_done');
    $('#ed-status').dataset.tip = 'Saved to disk at ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    setStatus('Save failed: is the server running?', 'cloud_off');
  }
  saving = false;
}

/* Slides grouped into reveal.js stacks: consecutive slides with the same data-ed-stack form one vertical stack. */
function stacks(list = slides) {
  const out = [];
  for (const s of list) { const last = out.at(-1); if (last && s.dataset.edStack && last[0].dataset.edStack === s.dataset.edStack) last.push(s); else out.push([s]); }
  return out;
}
const isSub = i => i > 0 && slides[i].dataset.edStack && slides[i - 1].dataset.edStack === slides[i].dataset.edStack;
/* A slide's position as reveal.js counts it: [h, v] (0-based), and back. */
function hv(i) { let h = -1, v = 0; for (let j = 0; j <= i; j++) { if (isSub(j)) v++; else { h++; v = 0; } } return [h, v]; }
function indexOf(h, v = 0) { for (let i = 0; i < slides.length; i++) { const [a, b] = hv(i); if (a === h && b === v) return i; } return Math.min(slides.length - 1, Math.max(0, h)); }
const snapshot = () => ({ html: slides.map(s => sectionHTML(s)), cur });
function pushHistory() {
  if (themeStash || histView) return false;
  ensureSids();
  const s = snapshot(), top = hist[hptr];
  if (top && top.html.join('\0') === s.html.join('\0')) { top.cur = s.cur; return false; }
  hist = hist.slice(0, hptr + 1);
  hist.push(s);
  if (hist.length > 300) hist.shift();
  hptr = hist.length - 1;
  return true;
}
function commit() {
  fitGroups(); followConnectors(); showAINotes();
  if (pushHistory()) scheduleSave();
  refreshFind();
  renderThumbs(); updateToolbar(); if (zoom) extendStage();
}
// `at` is the slide to show: the slide where the undone/redone change was made, as in Slides.
function restore(s, at = s.cur) {
  const ids = new Set([...sel].map(b => b.id));
  const t = document.createElement('template'), same = new Map();   // slides the step didn't change stay the same elements,
  slides.forEach(x => { const h = sectionHTML(x); same.set(h, [...(same.get(h) || []), x]); });   // so their thumbnails aren't redrawn
  slides = s.html.map(h => { const kept = same.get(h)?.shift(); if (kept) return kept; t.innerHTML = h; return t.content.firstElementChild; });
  cur = Math.min(at, slides.length - 1);
  sel = new Set(boxes().filter(b => ids.has(b.id)));
  render(); scheduleSave();
}
function undo() { stopEdit(); if (hptr > 0 && !overwrites(hist[hptr - 1])) { const at = hist[hptr].cur; restore(hist[--hptr], at); } }
function redo() { stopEdit(); if (hptr < hist.length - 1 && !overwrites(hist[hptr + 1])) restore(hist[++hptr]); }
function maybeReload() { if (pendingReload && !busy && !editing) { pendingReload = false; unsaved() || saveTimer ? (clearTimeout(saveTimer), saveTimer = null, mergeIn()) : load(true, true); } }   // with changes of its own, merged (mergeIn)
