/* ---------- slides ---------- */

/* Slides picked in the filmstrip (always including the current one); slide operations act on all of them. */
let picked = new Set(), slideAnchor = 0;
function go(i, keepPicked) {
  stopEdit();
  cur = Math.max(0, Math.min(slides.length - 1, i));
  if (!keepPicked) { picked = new Set([slides[cur]]); slideAnchor = cur; }
  sel.clear(); render();
}
const pickedIdx = () => slides.map((s, i) => picked.has(s) ? i : -1).filter(i => i >= 0);
function extendTo(i) {
  i = Math.max(0, Math.min(slides.length - 1, i));
  const [a, b] = [Math.min(slideAnchor, i), Math.max(slideAnchor, i)];
  picked = new Set(slides.slice(a, b + 1)); go(i, true);
}
function toggleSlide(i) {
  const s = slides[i];
  if (picked.has(s) && picked.size > 1) { picked.delete(s); go(slides.indexOf([...picked][0]), true); }
  else { picked.add(s); slideAnchor = i; go(i, true); }
}
/* Drag thumbnails to reorder, as Slides: the picked slides (or the one grabbed) follow the pointer as a ghost and
   drop between thumbnails at the blue line. Dropped between two slides of one stack, they join it. */
let thumbDragged = false;
function startThumbDrag(e, i) {
  const t0 = thumbs.children[i], x0 = e.clientX, y0 = e.clientY;
  let ghost = null, line = null, at = null;
  const move = ev => {
    if (!ghost && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
    if (!ghost) {
      if (!picked.has(slides[i])) { picked = new Set([slides[i]]); }
      ghost = t0.querySelector('.thumb-view').cloneNode(true); ghost.className += ' thumb-ghost'; document.body.append(ghost);
      line = div('thumb-drop'); thumbs.append(line); document.body.classList.add('thumb-dragging'); t0.classList.add('dragged');
    }
    Object.assign(ghost.style, { left: ev.clientX - 40 + 'px', top: ev.clientY - 20 + 'px' });
    const ts = [...thumbs.querySelectorAll('.thumb')];
    at = ts.findIndex(t => { const r = t.getBoundingClientRect(); return gridOn ? ev.clientY < r.bottom && (ev.clientY < r.top || ev.clientX < r.left + r.width / 2) : ev.clientY < r.top + r.height / 2; }); if (at < 0) at = ts.length;
    const ref = ts[at] || ts.at(-1), r = ref.getBoundingClientRect(), tr = thumbs.getBoundingClientRect();
    if (gridOn) {   // a vertical line before the target thumbnail (or after the last)
      Object.assign(line.style, { left: (ts[at] ? r.left - 8 : r.right + 8) - tr.left + 'px', top: r.top - tr.top + thumbs.scrollTop + 'px', height: r.height + 'px' });
    } else line.style.top = (ts[at] ? r.top - 8 : r.bottom + 8) - tr.top + thumbs.scrollTop + 'px';
  };
  const cancel = e => { if (e.key !== 'Escape' || !ghost) return; e.preventDefault(); e.stopImmediatePropagation(); end(); ghost = null; };   // Esc drops nothing
  const end = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('keydown', cancel, true);
    if (ghost) { ghost.remove(); line.remove(); document.body.classList.remove('thumb-dragging'); t0.classList.remove('dragged'); } };
  addEventListener('keydown', cancel, true);
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('keydown', cancel, true);
    if (!ghost) return;
    ghost.remove(); line.remove(); document.body.classList.remove('thumb-dragging'); t0.classList.remove('dragged'); thumbDragged = true; setTimeout(() => { thumbDragged = false; });   // only the click that ends this drag is ignored
    dropSlides(at);
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
}
function dropSlides(at) {
  slideOp(() => {
    const block = slides.filter(s => picked.has(s)), keep = slides[cur];
    const before = slides.slice(0, at).filter(s => !picked.has(s)), after = slides.slice(at).filter(s => !picked.has(s));
    const stack = before.at(-1)?.dataset.edStack;
    block.forEach(s => { if (stack && after[0]?.dataset.edStack === stack) s.dataset.edStack = stack; else delete s.dataset.edStack; });
    slides = [...before, ...block, ...after];
    cur = slides.indexOf(picked.has(keep) ? keep : block[0]);
  });
}
/* View → Grid view (⌘⌥1), as Slides: every slide as a large thumbnail in a grid in place of the slide editor; click / ⌘ / ⇧
   select, drag reorders, double-click opens; − / + at the bottom change the size. */
let gridOn = false, gridW = 300;
function setGrid(on) {
  stopEdit(); gridOn = on; document.body.classList.toggle('grid-mode', on);
  $('#ed-grid-toggle .icon').textContent = on ? 'view_sidebar' : 'grid_view'; $('#ed-grid-toggle').title = on ? 'Back to the slide (⌘⌥1)' : 'Grid view (⌘⌥1)';
  renderThumbs(); if (!on) fit();
}
$('#ed-grid-toggle').onclick = () => setGrid(!gridOn);
addEventListener('resize', () => { if (gridOn) renderThumbs(); });   // the grid's column count

$('#ed-grid-in').onclick = () => { gridW = Math.min(520, gridW + 60); renderThumbs(); };
$('#ed-grid-out').onclick = () => { gridW = Math.max(160, gridW - 60); renderThumbs(); };
addEventListener('keydown', e => { if (e.metaKey && e.altKey && e.code === 'Digit1') { e.preventDefault(); setGrid(!gridOn); } }, true);

function slideOp(fn) { stopEdit(); fn(); sel.clear(); render(); commit(); }
function dupSlides() {
  slideOp(() => {
    const idx = pickedIdx(), copies = idx.map(i => { const c = slides[i].cloneNode(true); boxes(c).forEach(b => { b.dataset.morph ||= b.id; b.id = uid(); }); return c; });   // data-morph: Morph pairs each copy with its original
    slides.splice(idx.at(-1) + 1, 0, ...copies);
    cur = slides.indexOf(copies.at(-1)); picked = new Set(copies);
  });
}
function deleteSlides() {
  slideOp(() => {
    const idx = pickedIdx(); if (idx.length >= slides.length) idx.shift();   // always keep one slide
    if (!idx.length) return;
    idx.reverse().forEach(i => { slides[i].remove(); slides.splice(i, 1); });
    cur = Math.min(idx.at(-1), slides.length - 1); picked = new Set([slides[cur]]);
  });
}
/* Move the picked slides as a block: 'up' / 'down' by one, or to the 'start' / 'end'. */
function moveSlides(to) {
  slideOp(() => {
    const idx = pickedIdx(), block = idx.map(i => slides[i]), rest = slides.filter(s => !picked.has(s)), first = idx[0];
    const at = { up: first - 1, down: first + 1, start: 0, end: rest.length }[to];
    const keep = slides[cur];
    slides = [...rest.slice(0, Math.max(0, Math.min(rest.length, at))), ...block, ...rest.slice(Math.max(0, Math.min(rest.length, at)))];
    cur = slides.indexOf(keep);
  });
}

/* A new main slide after the current stack: Title and body after a Title slide, else the current slide's layout (as
   Slides); the toolbar's + ▾ and Slide → New slide with layout pick one. */
function newSlideWith(layout) {
  slideOp(() => { let i = cur; while (slides[i + 1] && isSub(i + 1)) i++; slides.splice(i + 1, 0, blankSlide(layout)); cur = i + 1; picked = new Set([slides[cur]]); });   // only the new slide is picked
}
$('#ed-new-slide').onclick = () => { const l = slides[cur]?.dataset.layout; newSlideWith(l === 'title' ? 'title-body' : l); };
const newSlideItems = () => LAYOUTS.map(([name, label]) => ({ label, run: () => newSlideWith(name) }));
function newSlideBelow() {   // ⇧⌘M: a sub-slide under the current one (reveal.js vertical stack; not in Google Slides)
  slideOp(() => { const s = slides[cur], n = blankSlide(); s.dataset.edStack ||= uid(); n.dataset.edStack = s.dataset.edStack; slides.splice(cur + 1, 0, n); cur++; picked = new Set([n]); });
}
$('#ed-dup-slide').onclick = dupSlides;
$('#ed-del-slide').onclick = deleteSlides;
$('#ed-up-slide').onclick = () => moveSlides('up');
$('#ed-down-slide').onclick = () => moveSlides('down');
