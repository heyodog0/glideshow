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
/* View → Object list (Keynote's): the slide's objects front to back, groups with their members under them. A click
   selects (⌘ / ⇧ for several), dragging a row restacks the object above or below another, the lock toggles Arrange → Lock. */
const objPanel = $('#ed-objects');
function setObjectsPanel(open) { objPanel.hidden = !open; if (open) { fmt.hidden = true; $('#ed-trans').hidden = true; $('#ed-theme').hidden = true; $('#ed-comments').hidden = true; } fit(); renderObjects(); }
$('#ed-objects-close').onclick = () => setObjectsPanel(false);
const OBJ_ICON = b => isGroup(b) ? 'group_work' : isLine(b) ? 'pen_size_2' : b.dataset.shape === 'path' ? 'draw' : b.classList.contains('image') ? 'image' : b.classList.contains('video') ? 'movie'
  : b.classList.contains('table') ? 'table_chart' : b.classList.contains('embed') || b.classList.contains('live') ? 'web' : b.dataset.shape ? 'shapes' : 'text_fields';
const objName = b => content(b)?.textContent.trim().slice(0, 40) || (isGroup(b) ? 'Group' : b.classList.contains('image') ? 'Image' : b.classList.contains('video') ? 'Video'
  : b.classList.contains('table') ? 'Table' : isLine(b) ? 'Line' : b.dataset.shape === 'path' ? 'Drawing' : b.dataset.shape ? b.dataset.shape[0].toUpperCase() + b.dataset.shape.slice(1) : 'Text box');
function renderObjects() {
  if (objPanel.hidden || !slides[cur]) return;
  const rows = [], walk = (parent, depth) => { [...parent.children].filter(e => e.classList.contains('box') && !e.classList.contains('note')).reverse().forEach(b => { rows.push([b, depth]); if (isGroup(b)) walk(b, depth + 1); }); };
  walk(slides[cur], 0);
  $('#ed-obj-list').replaceChildren(...rows.map(([b, depth]) => {
    const r = div('obj-row' + (sel.has(b) ? ' on' : '')); r.draggable = !depth; r.style.paddingLeft = 12 + depth * 20 + 'px';
    r.innerHTML = `<span class="icon kind"></span><span class="name"></span><button class="lk" title="${isLocked(b) ? 'Unlock' : 'Lock'}"><span class="icon">${isLocked(b) ? 'lock' : 'lock_open'}</span></button>`;
    r.querySelector('.kind').textContent = OBJ_ICON(b); r.querySelector('.name').textContent = objName(b);
    r.onclick = e => {
      if (/** @type {Element} */ (e.target).closest('.lk')) { sel = new Set([b]); lockSel(!isLocked(b)); return; }
      stopEdit(); if (depth) scope = parentBox(b);
      if (e.metaKey || e.ctrlKey || e.shiftKey) { if (sel.has(b)) sel.delete(b); else sel.add(b); } else sel = new Set([b]);
      drawOverlay(); updateToolbar();
    };
    r.ondragstart = e => { e.dataTransfer.setData('text/x-obj', b.id); };
    r.ondragover = e => { e.preventDefault(); const up = e.offsetY < r.offsetHeight / 2; r.classList.toggle('drop-up', up); r.classList.toggle('drop-down', !up); };
    r.ondragleave = () => r.classList.remove('drop-up', 'drop-down');
    r.ondrop = e => {
      e.preventDefault(); const up = r.classList.contains('drop-up'); r.classList.remove('drop-up', 'drop-down');
      const m = slides[cur].querySelector('#' + CSS.escape(e.dataTransfer.getData('text/x-obj'))); if (!m || m === b || depth) return;
      if (up) b.after(m); else b.before(m);   // the list runs front to back, the slide back to front
      sel = new Set([m]); drawOverlay(); commit();
    };
    return r;
  }));
}
/* Arrange → Combine shapes (Keynote's Unite, Intersect, Subtract, Exclude) and Break apart. Each shape's drawn outline,
   in slide coordinates (curves sampled every few px), goes through polygon-clipping; the result is one path box in the
   back shape's style (Subtract takes the others from the back one). Break apart splits a path of several outlines. */
function outlineOf(b) {   // [[ [x, y], … ], …]: the shape's fill outlines on the slide
  const svg = b.querySelector(':scope > svg.shape'); if (!svg) { const g = aabb(b); return [[[g.x, g.y], [g.x + g.w, g.y], [g.x + g.w, g.y + g.h], [g.x, g.y + g.h]]]; }
  const g = geo(b), t = rot(b) * Math.PI / 180, [fx, fy] = flipXY(b), cx = g.x + g.w / 2, cy = g.y + g.h / 2;
  const toSlide = (x, y) => { const lx = fx * (x - g.w / 2), ly = fy * (y - g.h / 2); return [cx + lx * Math.cos(t) - ly * Math.sin(t), cy + lx * Math.sin(t) + ly * Math.cos(t)]; };
  const rings = [];
  for (const f of /** @type {SVGGeometryElement[]} */ ([...svg.querySelectorAll('.f')]).filter(e => e.style.fill !== 'none')) {
    const ds = f.tagName === 'path' ? (f.getAttribute('d') || '').split(/(?=M)/).filter(s => s.trim()) : [null];
    for (const d of ds) {
      let el = f; if (d) { el = /** @type {SVGPathElement} */ (document.createElementNS('http://www.w3.org/2000/svg', 'path')); el.setAttribute('d', d); svg.append(el); }
      const L = el.getTotalLength(), n = Math.max(8, Math.min(600, Math.ceil(L / 4))), ring = [];
      for (let i = 0; i < n; i++) { const p = el.getPointAtLength(L * i / n); ring.push(toSlide(p.x, p.y)); }
      if (d) el.remove();
      if (ring.length > 2) rings.push(ring);
    }
  }
  return rings;
}
const combinable = b => !!b && !isMedia(b) && !isLine(b) && !isGroup(b) && !(b.dataset.shape === 'path' && !/z\s*$/i.test(b.dataset.path || '')) && !/^(wordart|icon)$/.test(b.dataset.shape || '');
function pathFromRings(rings, like) {   // a path box drawing these slide-coordinate outlines, styled as `like`
  const pts = rings.flat(), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), g = { x: Math.min(...xs), y: Math.min(...ys), w: 0, h: 0 };
  g.w = Math.max(1, Math.max(...xs) - g.x); g.h = Math.max(1, Math.max(...ys) - g.y);
  const r = v => Math.round(v * 10000) / 10000;
  const d = rings.map(ring => 'M' + ring.map(([x, y]) => `${r((x - g.x) / g.w)},${r((y - g.y) / g.h)}`).join(' L') + ' Z').join(' ');
  const b = makeBox({ ...g, shape: 'path' }); b.dataset.path = d;
  for (const k of ['--fill', '--stroke', '--sw']) { const v = like.style.getPropertyValue(k) || (k === '--fill' ? getComputedStyle(like.querySelector('svg.shape .f') || like).fill : ''); if (v) b.style.setProperty(k, v); }
  if (like.dataset.dash) b.dataset.dash = like.dataset.dash;
  return b;
}
function combineSel(op) {
  const items = boxes().filter(b => sel.has(b) && combinable(b)); if (items.length < 2 || anyLocked()) return;
  stopEdit();
  const geo2 = items.map(b => outlineOf(b));
  let res = op === 'union' ? polygonClipping.union(geo2[0], ...geo2.slice(1)) : op === 'intersect' ? polygonClipping.intersection(geo2[0], ...geo2.slice(1))
    : op === 'subtract' ? polygonClipping.difference(geo2[0], ...geo2.slice(1)) : polygonClipping.xor(geo2[0], ...geo2.slice(1));
  const rings = res.flatMap(poly => poly.map(ring => ring.slice(0, -1)));   // polygon-clipping repeats each ring's first point at its end
  if (!rings.length) return setStatus('Those shapes have nothing in common');
  const b = pathFromRings(rings, items[0]); items[0].before(b); items.forEach(x => x.remove());
  renderShape(b); sel = new Set([b]); drawOverlay(); updateToolbar(); commit();
}
function breakApart() {
  const b = [...sel].find(x => isPath(x) && (x.dataset.path.match(/M/g) || []).length > 1); if (!b || isLocked(b)) return;
  const g = geo(b), parts = b.dataset.path.split(/(?=M)/).filter(s => s.trim()), out = [];
  for (const part of parts) {
    const ring = [...part.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(m => [g.x + +m[1] * g.w, g.y + +m[2] * g.h]);
    if (ring.length > 2) { const n = pathFromRings([ring], b); b.before(n); renderShape(n); out.push(n); }
  }
  b.remove(); sel = new Set(out); drawOverlay(); updateToolbar(); commit();
}
/* Slide → Skip slide: reveal.js leaves data-visibility="hidden" slides out of the slideshow. */
function skipSlides() {
  const on = !pickedIdx().every(i => slides[i].dataset.visibility === 'hidden');
  pickedWithGroups().forEach(i => { if (on) slides[i].dataset.visibility = 'hidden'; else delete slides[i].dataset.visibility; });   // a folded group: all of it (slides.js)
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
$('#ed-bg').oninput = e => { slides[cur].dataset.backgroundColor = e.target.value; delete slides[cur].dataset.backgroundGradient; delete slides[cur].dataset.backgroundImage; paintBg(frame, slides[cur]); syncBgDialog(); };
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
  f.src = `deck.html?embedded${opts.rehearse ? '&rehearse' : ''}#/` + hv(from).join('/'); f.allow = 'fullscreen';   // Rehearse: the presenter view over the show (present.js)
  ov.replaceChildren(f); ov.hidden = false;
  f.addEventListener('load', () => f.contentWindow.focus());
  if (opts.fullscreen) ov.requestFullscreen?.().catch(() => {});
}
function endPresent(h, v) {
  const ov = $('#ed-show');
  if (ov.hidden) return;
  if (rec) { stopRecording(); return; }   // Esc while recording: stop and save
  ov.hidden = true; ov.replaceChildren();
  if (document.fullscreenElement) document.exitFullscreen();
  if (h != null) go(indexOf(h, v || 0));
}
const presenting = () => !$('#ed-show').hidden;
addEventListener('message', e => {
  if (e.data?.slides === 'exit') endPresent(e.data.h, e.data.v);
  if (e.data?.slides === 'at' && rec) rec.steps.push([(performance.now() - rec.t0 - rec.paused) / 1000, e.data.h, e.data.v || 0, e.data.f ?? -1]);   // Record slideshow: where the show is, when
  if (e.data?.slides === 'note') addNote(indexOf(e.data.h, e.data.v), e.data.x, e.data.y, e.data.text);   // M while presenting
});
/* Slideshow ▾ → Record slideshow (Keynote's): presents from the first slide with a recording bar on top; the microphone
   is recorded while each slide and build is noted with its time. Stop (or Esc) saves both with the deck:
   data-narration (the sound) and data-narration-steps ("seconds:h.v.f" each) on .slides; Slideshow settings → Recorded
   plays them back. */
let rec = null;
async function recordSlideshow() {
  let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return setStatus('No microphone: allow it to record a slideshow', 'error'); }
  const mr = new MediaRecorder(stream), chunks = []; mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec = { mr, stream, chunks, t0: performance.now(), paused: 0, pausedAt: 0, steps: [[0, 0, 0, -1]] };
  await present(0); mr.start(1000);
  const bar = div('rec-bar'); bar.id = 'ed-rec-bar';
  bar.innerHTML = '<span class="dot"></span><span class="t">0:00</span><button class="pause" title="Pause"><span class="icon">pause</span></button><button class="stop" title="Stop and save"><span class="icon">stop</span></button>';
  document.body.append(bar);
  const tick = setInterval(() => { if (!rec) return clearInterval(tick); const s = Math.floor((performance.now() - rec.t0 - rec.paused - (rec.pausedAt ? performance.now() - rec.pausedAt : 0)) / 1000); bar.querySelector('.t').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 250);
  bar.querySelector('.pause').onclick = () => {
    if (!rec) return;
    if (rec.pausedAt) { rec.paused += performance.now() - rec.pausedAt; rec.pausedAt = 0; mr.resume(); bar.classList.remove('paused'); bar.querySelector('.pause .icon').textContent = 'pause'; }
    else { rec.pausedAt = performance.now(); mr.pause(); bar.classList.add('paused'); bar.querySelector('.pause .icon').textContent = 'fiber_manual_record'; }
    $('#ed-show iframe')?.contentWindow?.focus();
  };
  bar.querySelector('.stop').onclick = () => stopRecording();
}
async function stopRecording() {
  const r = rec; if (!r) return; rec = null; $('#ed-rec-bar')?.remove();
  const done = new Promise(ok => { r.mr.onstop = ok; }); if (r.mr.state !== 'inactive') r.mr.stop(); await done; r.stream.getTracks().forEach(t => t.stop());
  endPresent();
  const blob = new Blob(r.chunks, { type: r.mr.mimeType || 'audio/webm' }); if (!blob.size) return setStatus('Nothing was recorded');
  setStatus('Saving the recording…');
  const { src } = await (await fetch('/api/upload?ext=' + (/mp4/.test(blob.type) ? 'm4a' : 'weba'), { method: 'POST', body: blob })).json();
  const d = deckDoc.querySelector('.slides').dataset;
  d.narration = src; d.narrationSteps = r.steps.map(([t, h, v, f]) => `${Math.round(t * 100) / 100}:${h}.${v}.${f}`).join(' '); d.play = 'recorded';
  scheduleSave(); setStatus('Recording saved: Slideshow settings → Recorded plays it', 'check');
}
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
/* The standalone deck in a new tab (a second screen), optionally with the presenter view (present.js). */
async function openDeckTab(from = cur, notes = false) {
  await flushSave();
  const w = window.open('deck.html#/' + hv(from).join('/'), '_blank');
  if (!notes || !w) return;
  setStatus('Presenter view: press S in the slideshow if it doesn\'t open');
  const t0 = Date.now(), poll = setInterval(() => {
    const open = w.closed ? null : /** @type {any} */ (w).gsPresenter;   // present.js's presenter view, once the deck is ready
    if (open || w.closed || Date.now() - t0 > 5000) { clearInterval(poll); open?.(); }
  }, 100);
}
$('#ed-present').onclick = () => present();
