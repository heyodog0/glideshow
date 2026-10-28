/* Arrange → Align: to the selection's bounds, or to the slide when one object is selected (as Slides).
   `where` is 0 (left/top), .5 (center/middle) or 1 (right/bottom); bounds are as drawn, so rotated boxes line up visually. */
const anyLocked = () => [...sel].some(isLocked);
function alignSel(axis, where) {
  if (anyLocked()) return;
  const [p, s, size] = axis === 'h' ? ['x', 'w', W] : ['y', 'h', H];
  const g = sel.size === 1 ? { [p]: 0, [s]: size } : bbox([...sel].map(aabb));
  sel.forEach(b => { const a = aabb(b), o = geo(b), d = g[p] + (g[s] - a[s]) * where - a[p]; setGeo(b, { ...o, [p]: o[p] + d }); });
  drawOverlay(); commit();
}
/* Arrange → Distribute: equal gaps between three or more objects, keeping the outermost ones in place. */
function distributeSel(axis) {
  if (anyLocked()) return;
  const [p, s] = axis === 'h' ? ['x', 'w'] : ['y', 'h'];
  const items = [...sel].map(b => [b, aabb(b)]).sort((a, c) => (a[1][p] + a[1][s] / 2) - (c[1][p] + c[1][s] / 2));
  const first = items[0][1], last = items.at(-1)[1], used = items.reduce((t, [, a]) => t + a[s], 0);
  const gap = (last[p] + last[s] - first[p] - used) / (items.length - 1);
  let at = first[p];
  for (const [b, a] of items) { const o = geo(b); setGeo(b, { ...o, [p]: o[p] + at - a[p] }); at += a[s] + gap; }
  drawOverlay(); commit();
}
function rotateSel(d) { if (anyLocked()) return; sel.forEach(b => { if (!isLine(b)) setRot(b, rot(b) + d); }); drawOverlay(); commit(); }
function flipSel(axis) {
  if (anyLocked()) return;
  sel.forEach(b => {
    const f = new Set(b.dataset.flip || ''); f.has(axis) ? f.delete(axis) : f.add(axis);
    const v = ['h', 'v'].filter(a => f.has(a)).join(''); if (v) b.dataset.flip = v; else delete b.dataset.flip; shadeBox(b);
  });
  drawOverlay(); commit();
}
/* Arrange → Lock / Unlock, as Keynote: a locked object can still be selected by a click (dimmed handles) and copied,
   but not moved, resized, rotated, edited or deleted, and a drag-select passes over it. */
function lockSel(on) {
  stopEdit();
  sel.forEach(b => { if (on) b.setAttribute('data-locked', ''); else b.removeAttribute('data-locked'); });
  drawOverlay(); updateToolbar(); commit();
}
/* Slide → Skip slide: reveal.js leaves data-visibility="hidden" slides out of the slideshow. */
function skipSlides() {
  const on = !pickedIdx().every(i => slides[i].dataset.visibility === 'hidden');
  pickedIdx().forEach(i => { if (on) slides[i].dataset.visibility = 'hidden'; else delete slides[i].dataset.visibility; });
  commit();
}
/* Arrange → Group (⌥⌘G): the selection moves into one `.box.group` sized to its bounds, members keep
   their geometry relative to it. Ungroup (⇧⌥⌘G) puts them back, carrying the group's rotation. */
function groupSel() {
  const items = boxes().filter(b => sel.has(b));
  if (items.length < 2 || anyLocked()) return;
  stopEdit();
  const g = bbox(items.map(aabb)), grp = div('box group'); grp.id = uid(); setGeo(grp, g);
  items.at(-1).after(grp);
  for (const b of items) { const o = geo(b); setGeo(b, { ...o, x: o.x - g.x, y: o.y - g.y }); grp.append(b); }
  sel = new Set([grp]); drawOverlay(); updateToolbar(); commit();
}
function ungroupSel() {
  const out = [];
  for (const grp of boxes().filter(b => sel.has(b) && b.classList.contains('group'))) {
    const g = geo(grp), r = rot(grp), t = r * Math.PI / 180, cx = g.x + g.w / 2, cy = g.y + g.h / 2;
    for (const c of kids(grp)) {
      const o = geo(c), lx = g.x + o.x + o.w / 2 - cx, ly = g.y + o.y + o.h / 2 - cy;
      const nx = cx + lx * Math.cos(t) - ly * Math.sin(t), ny = cy + lx * Math.sin(t) + ly * Math.cos(t);
      setGeo(c, { x: nx - o.w / 2, y: ny - o.h / 2, w: o.w, h: o.h }); if (r) setRot(c, rot(c) + r);
      grp.before(c); out.push(c);
    }
    grp.remove();
  }
  if (!out.length) return;
  sel = new Set(out); drawOverlay(); updateToolbar(); commit();
}
function toFront() { boxes().filter(b => sel.has(b)).forEach(b => slides[cur].append(b)); commit(); }
function toBack() { boxes().filter(b => sel.has(b)).reverse().forEach(b => slides[cur].prepend(b)); commit(); }
function flipLines() { sel.forEach(b => { if (isLine(b)) { b.dataset.dir = b.dataset.dir === 'up' ? 'down' : 'up'; renderShape(b); } }); commit(); }
$('#ed-bg').oninput = e => { slides[cur].dataset.backgroundColor = e.target.value; paintBg(frame, slides[cur]); syncBgDialog(); };
$('#ed-bg').onchange = commit;
$('#ed-title').oninput = scheduleSave;
$('#ed-date').onchange = scheduleSave;

/* Present in place, as Slides but windowed (like Keynote's Play in Window): the real deck.html fills the
   editor window over the chrome, so it behaves exactly like the shared deck. Esc comes back to the slide
   you stopped on. Fullscreen is opt-in (F while presenting, or Slideshow ▾ → Present fullscreen). */
async function flushSave() { if (saveTimer) { clearTimeout(saveTimer); await save(); } }
async function present(from = cur, opts = {}) {
  await flushSave();
  if (savedCode !== currentCode() && !(/** @type {any} */ (window.GLIDESHOW_CLOUD)?.collab)) await save();   // the deck's slideshow code is this editor's (storage.js deckCode)
  stopEdit(); closeMenu();
  const ov = $('#ed-show'), f = document.createElement('iframe');
  f.src = 'deck.html?embedded#/' + hv(from).join('/'); f.allow = 'fullscreen';
  ov.replaceChildren(f); ov.hidden = false;
  f.addEventListener('load', () => f.contentWindow.focus());
  if (opts.fullscreen) ov.requestFullscreen?.().catch(() => {});
}
function endPresent(h, v) {
  const ov = $('#ed-show');
  if (ov.hidden) return;
  ov.hidden = true; ov.replaceChildren();
  if (document.fullscreenElement) document.exitFullscreen();
  if (h != null) go(indexOf(h, v || 0));
}
const presenting = () => !$('#ed-show').hidden;
addEventListener('message', e => {
  if (e.data?.slides === 'exit') endPresent(e.data.h, e.data.v);
  if (e.data?.slides === 'note') addNote(indexOf(e.data.h, e.data.v), e.data.x, e.data.y, e.data.text);   // M while presenting
});
/* A note for the AI (AGENTS.md): yellow in the editor, hidden in the deck, stamped with its time. */
function addNote(i, x, y, text) {
  const s = slides[i]; if (!s) return;
  if (!stickiesShown()) setStickies(true);   // a note just added is seen (notes.js)
  const b = makeBox({ x: Math.max(0, Math.min(W - 500, x)), y: Math.max(0, Math.min(H - 220, y)), w: 500, h: 220, cls: 'note' });
  b.dataset.valign = 'top'; b.dataset.time = new Date().toISOString().slice(0, 16); content(b).textContent = text || '';
  s.append(b); if (i === cur) render(); commit(); return b;
}
addEventListener('keydown', e => { if (presenting() && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); endPresent(); } }, true);
/* Live reloads keep applying while presenting (the deck's URL hash keeps the slide). */
/* The slideshow brought up to date (a change saved elsewhere, an agent's), where it was: the slide and the step. The
   deck doesn't keep its place in its address, so a plain reload went back to the slide it was opened on. */
function refreshPresent() {
  const f = /** @type {HTMLIFrameElement | null} */ ($('#ed-show iframe')); if (!f) return;
  const w = /** @type {any} */ (f.contentWindow), at = w?.Reveal?.getIndices?.();
  if (at) f.src = `deck.html?embedded&t=${Date.now()}#/${at.h}/${at.v || 0}${at.f != null && at.f >= 0 ? '/' + at.f : ''}`;
  else w?.location.reload();
}
/* The standalone deck in a new tab (a second screen), optionally with reveal's speaker window. */
async function openDeckTab(from = cur, notes = false) {
  await flushSave();
  const w = window.open('deck.html#/' + hv(from).join('/'), '_blank');
  if (!notes || !w) return;
  setStatus('Presenter view: press S in the slideshow if it doesn\'t open');
  const t0 = Date.now(), poll = setInterval(() => {
    const plugin = w.closed ? null : w.Reveal?.getPlugin?.('notes');
    if (plugin || w.closed || Date.now() - t0 > 5000) { clearInterval(poll); plugin?.open(); }
  }, 100);
}
$('#ed-present').onclick = () => present();
