/* ---------- rendering ---------- */

function render() {
  showNotes();
  queueMicrotask(() => updateTransPanel?.());
  queueMicrotask(refreshFind);   // highlights follow the shown slide
  canvas.querySelector(':scope > section')?.remove();
  const s = slides[cur];
  if (scope && !s.contains(scope)) scope = null;
  s.querySelectorAll(':scope > style').forEach(x => { x.classList.add('slide-css'); x.media = 'not all'; });   // a slide's style applies to it only (below), never to the editor
  canvas.prepend(s); if (zoom) queueMicrotask(extendStage);
  paintBg(frame, s);
  ($('#ed-slide-css') || document.head.appendChild(Object.assign(document.createElement('style'), { id: 'ed-slide-css' }))).textContent = slideCSS(s) ? `#ed-canvas > section { ${slideCSS(s)} }` : '';
  s.querySelectorAll('img, video').forEach(freshSrc); s.querySelectorAll('video').forEach(stillPoster);
  s.querySelectorAll('.box').forEach(b => { if (b.dataset.shape) renderShape(b); shadeBox(b); cropBox(b); if (b.dataset.adjust) adjustImage(b); if (((b.dataset.gradient || b.dataset.fillImage) && !b.dataset.shape) || b.dataset.textGradient) gradBox(b); fitText(b); });
  requestAnimationFrame(() => s.querySelectorAll('.box').forEach(fitTabs));   // tabs need the laid-out text
  highlightCode(s); renderMath(s);
  s.querySelectorAll('.box[data-placeholder] > .content').forEach(markPlaceholder);
  drawOverlay(); renderThumbs(); updateToolbar(); updateThemeBar();
}

/* An unfilled placeholder carries its prompt (data-ph, drawn by editor.css): no text, or only the lone <br> a deleted line
   leaves. Marked here, not matched in CSS, which can't see text: "line<br>line" also has a <br> as its only element. */
function markPlaceholder(c) {
  if (!c.textContent && (!c.firstChild || c.innerHTML === '<br>')) c.dataset.ph = c.parentElement.dataset.placeholder;
  else delete c.dataset.ph;
}

/* Animated GIFs play on the slide but sit still in the filmstrip, as Slides: a thumbnail shows the first frame. The frame
   is drawn once the GIF is decoded (Safari fires load before a large GIF's first frame is ready, and drew it blank); a
   GIF that fails is tried again on the next redraw; after a change on disk the GIF comes again (freshSrc, below), as it
   may have been rewritten under the same name, or caught half-written. */
const gifStills = new Map();
function stillGif(img) {
  const src = img.getAttribute('src') || '';
  if (!/\.gif(\?|$)|^data:image\/gif/i.test(src)) return;
  if (gifStills.has(src)) { if (gifStills.get(src)) img.src = gifStills.get(src); return; }
  gifStills.set(src, null);
  const im = new Image();
  im.src = src;
  im.decode().then(() => {   // drawImage takes the first frame of a freshly loaded GIF
    if (!im.naturalWidth) throw new Error('no picture');
    const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
    cv.getContext('2d').drawImage(im, 0, 0); gifStills.set(src, cv.toDataURL()); thumbEpoch++; renderThumbs();
  }).catch(() => { if (gifStills.get(src) === null) gifStills.delete(src); });
}
/* After a change on disk the pictures are fetched again (?gsv=n on the slide in the editor; cleanBox takes it off, so the
   deck never has it): a picture rewritten under the same name (a plot made again, a GIF) would otherwise come from the
   page's image cache, as it was. */
let imgGen = 0;
/* Online the deck comes with each file's version (lib/library.js /api/deck): after a change elsewhere only the files whose
   version changed are fetched again, each with a mark of its own (2026-10-21: every agent commit refetched every video of
   a 30-video deck, 20,000+ requests an hour). Without versions (the Mac), all of them, as before. */
let fileVers = /** @type {Record<string, string> | null} */ (null);
const fileGen = new Map();
const fileOf = (/** @type {string} */ src) => plainSrc(src).split('#')[0].split('?')[0].replace(/^(\.\/|\/deck\/)/, '');
const plainSrc = (/** @type {string} */ src) => src.replace(/[?&]gsv=\d+(?=#|$)/, '');
/** A file of the deck's, as it is now: the URL with this session's fetch-again mark (a media fragment, #t=…, kept last). */
function fresh(/** @type {string} */ src) {
  if (!src || /^(data|blob|https?):/i.test(src)) return src;
  const n = imgGen + (fileGen.get(fileOf(src)) || 0);
  if (!n) return plainSrc(src);
  const [path, hash] = plainSrc(src).split(/(?=#)/);
  return `${path}${path.includes('?') ? '&' : '?'}gsv=${n}${hash || ''}`;
}
function freshSrc(/** @type {Element} */ el) {
  for (const a of ['src', 'poster']) { const v = el.getAttribute(a); if (v && fresh(v) !== v) el.setAttribute(a, fresh(v)); }
}
/* Videos sit still in the filmstrip, as a picture: the poster, or else the video's first frame, taken once (a <video> in
   every thumbnail is heavy, and Safari draws one without a poster black). On the slide a video without a poster shows
   that frame until it plays (as its poster in the editor only: data-ed-poster, which cleanBox takes off). */
const videoStills = new Map();   // src → a picture's data URL; null while it's taken; '' when it can't be (another site's video)
function videoStill(/** @type {string} */ src) {
  if (!src) return '';
  if (videoStills.has(src)) return videoStills.get(src);
  videoStills.set(src, null);
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.src = src.includes('#') ? src : src + '#t=0.001';   // a frame at the start (or the trim's), which Safari then draws
  const grab = () => {
    try {
      const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight;
      cv.getContext('2d').drawImage(v, 0, 0); videoStills.set(src, cv.toDataURL('image/jpeg', .85));
    } catch { videoStills.set(src, ''); }
    v.removeAttribute('src'); v.load();
    thumbEpoch++; renderThumbs(); canvas.querySelectorAll('video').forEach(stillPoster);
  };
  v.addEventListener('loadeddata', () => v.seeking ? v.addEventListener('seeked', grab, { once: true }) : grab(), { once: true });
  v.addEventListener('error', () => videoStills.set(src, ''), { once: true });
  return null;
}
function stillPoster(/** @type {HTMLVideoElement} */ v) {
  if (v.getAttribute('poster') && !v.dataset.edPoster) return;
  const still = videoStill(v.getAttribute('src') || '');
  if (still) { v.poster = still; v.dataset.edPoster = '1'; }
}
function stillVideo(/** @type {HTMLVideoElement} */ v) {   // in a thumbnail: the video as a picture
  const img = document.createElement('img'), pic = (!v.dataset.edPoster && v.getAttribute('poster')) || videoStill(v.getAttribute('src') || '');
  img.alt = ''; img.style.cssText = 'display: block; width: 100%; height: 100%; object-fit: contain; background: #000;';
  if (pic) img.src = pic;
  v.replaceWith(img);
}
/* Thumbnail pictures are rebuilt only for slides whose HTML changed (a 150-slide deck re-renders in well under a frame). */
const thumbViews = new WeakMap();
let thumbEpoch = 0, thumbCSS = 0;   // bumped when something outside the slide's HTML changes how thumbnails draw (GIF stills)
function thumbView(s) {
  const key = `${s.outerHTML}\0${gridOn ? gridW : THUMB_W}\0${thumbEpoch}`, hit = thumbViews.get(s);
  if (hit?.key === key) return hit.view;
  const view = div('thumb-view reveal');
  const inner = div('thumb-canvas slides');
  inner.style.transform = `scale(${(gridOn ? gridW : THUMB_W) / W})`;
  paintBg(inner, s);
  const c = s.cloneNode(true);
  c.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
  c.querySelectorAll('.box[data-shape]').forEach(renderShape);
  c.querySelectorAll('.box[data-shadow]').forEach(shadeBox);
  c.querySelectorAll('.box[data-crop], .box[data-mask]').forEach(cropBox);
  c.querySelectorAll('img').forEach(i => { freshSrc(i); stillGif(i); });
  c.querySelectorAll('video').forEach(v => { freshSrc(v); stillVideo(v); });
  c.querySelectorAll('.box.live > .content').forEach(x => { x.innerHTML = '<div class="live-still"><span class="icon">play_circle</span></div>'; });   // a thumbnail doesn't run the demo
  c.querySelectorAll('img').forEach(i => { i.loading = 'lazy'; i.decoding = 'async'; });   // pictures fetched and decoded as thumbnails come into view
  inner.append(c); view.append(inner);
  if (slideCSS(s)) { inner.dataset.cssScope = String(++thumbCSS); view.append(Object.assign(document.createElement('style'), { textContent: `.thumb-canvas[data-css-scope="${thumbCSS}"] > section { ${slideCSS(s)} }` })); }
  if (s.dataset.visibility === 'hidden') {   // reveal skips these; Slides veils the thumbnail behind a crossed-out eye
    const veil = div('skipped'); veil.innerHTML = '<span class="icon">visibility_off</span>'; veil.dataset.tip = 'Skipped in slideshow'; view.append(veil);
  }
  thumbViews.set(s, { key, view });
  return view;
}
const thumbEls = new WeakMap(), thumbSlide = new WeakMap();   // slide → its filmstrip entry, updated in place; and back
/* A redrawn thumbnail replaces the old one once its pictures are decoded (half a second at most), so the strip never
   shows a slide without its pictures for a moment. The newest redraw wins if several are waiting. */
function swapView(t, view) {
  const imgs = [...view.querySelectorAll('img')];
  if (imgs.every(i => i.complete && i.naturalWidth)) return t.children[1].replaceWith(view);   // no pictures, or already loaded
  t.dataset.next = String((+(t.dataset.next || 0)) + 1); const mine = t.dataset.next;
  imgs.forEach(i => { i.loading = 'eager'; });
  Promise.race([Promise.all(imgs.map(i => i.decode().catch(() => {}))), new Promise(r => setTimeout(r, 500))])
    .then(() => { if (t.dataset.next === mine && t.children[1] !== view) t.children[1]?.replaceWith(view); });
}
/* Stacks draw as a tree, as a file browser: sub-slides smaller and indented under a rail from their main slide, which
   has a ▾ / ▸ to fold them (a folded main slide shows "+2"). Grid view keeps one cell per main slide, as reveal's
   overview: a stack's sub-slides sit in its main slide's cell, below it, so only that row grows. The DOM stays one
   thumbnail per slide in order (keys, drag). Folds are remembered per deck (localStorage), by main-slide number. */
const foldKey = () => 'slides-folded:' + deckPath;
const foldedH = () => { try { return new Set(JSON.parse(stored(foldKey()) || '[]')); } catch { return new Set(); } };
function setFolded(h, on) { const f = foldedH(); on ? f.add(h) : f.delete(h); store(foldKey(), f.size ? JSON.stringify([...f]) : undefined); }
const subsOf = i => { let n = 0; while (slides[i + n + 1] && isSub(i + n + 1)) n++; return n; };
function renderThumbs() {
  numberSlides(slides, deckDoc?.querySelector('.slides')?.dataset.slideNumbers);   // slide numbers follow every change of order, skipping and layout
  picked = new Set([...picked].filter(s => slides.includes(s))); if (slides[cur]) picked.add(slides[cur]);
  if (isSub(cur) && foldedH().has(hv(cur)[0])) setFolded(hv(cur)[0], false);   // never hide the slide being edited
  const fold = foldedH();
  thumbs.style.setProperty("--grid-w", gridW + "px");
  const cols = Math.max(1, Math.floor((thumbs.clientWidth - 80 + 24) / (gridW + 24)));
  thumbs.style.setProperty('--cols', cols);
  let hh = -1, vv = 0;
  const live = new Set(slides), taken = new Set();
  // a slide that is new to the strip (an undo's restored copy, a reload) takes over the entry of a slide that left at its
  // place, so the old picture stays up until the new one is ready (swapView)
  const reuse = i => { const o = thumbs.children[i]; return o && !live.has(thumbSlide.get(o)) && !taken.has(o) ? o : null; };
  const els = slides.map((s, i) => {
    if (isSub(i)) vv++; else { hh++; vv = 0; }
    const t = thumbEls.get(s) || reuse(i) || div('thumb'); thumbEls.set(s, t); thumbSlide.set(t, s); taken.add(t);
    const n = vv ? 0 : subsOf(i), folded = fold.has(hh);
    t.className = 'thumb' + (i === cur ? ' active' : '') + (picked.has(s) ? ' picked' : '') + (vv ? ' sub' : '')
      + (vv && !(slides[i + 1] && isSub(i + 1)) ? ' stack-last' : '') + (vv && folded ? ' folded' : '');
    t.style.gridColumn = gridOn ? (hh % cols) + 1 : ''; t.style.gridRow = gridOn ? Math.floor(hh / cols) + 1 : '';
    t.style.setProperty('--v', vv);
    const num = div('num'); num.textContent = s.dataset.edTheme ? '' : vv ? `${hh + 1}.${vv}` : String(hh + 1);   // reveal's convention: main slide 3, its sub-slides 3.1, 3.2; theme slides unnumbered
    if (n) {
      const f = document.createElement('button'); f.className = 'fold icon'; f.textContent = folded ? 'arrow_right' : 'arrow_drop_down';
      f.dataset.tip = folded ? `Show ${n} sub-slide${n > 1 ? 's' : ''}` : 'Hide sub-slides'; num.append(f);
      if (folded) { const c = document.createElement('span'); c.className = 'fold-count'; c.textContent = '+' + n; num.append(c); }
    }

    const trans = s.dataset.transition && s.dataset.transition !== 'none' || s.hasAttribute('data-auto-animate'), anims = s.querySelector('.fragment, [data-build]');
    if (trans || anims) {   // Slides marks slides with a transition or animated objects under the number
      const m = document.createElement('span'); m.className = 'icon has-trans'; m.textContent = 'animation';
      m.dataset.tip = trans && anims ? 'Transition and animations' : trans ? 'Transition' : 'Animations'; num.append(m);
    }
    const view = thumbView(s);
    if (t.firstChild?.outerHTML !== num.outerHTML) (t.firstChild ? t.firstChild.replaceWith(num) : t.append(num));
    if (t.children[1] !== view) (t.children[1] ? swapView(t, view) : t.append(view));
    t.ondblclick = () => { if (gridOn) { setGrid(false); go(i); } };   // grid view: double-click opens the slide
    t.onpointerdown = e => { if (e.target.closest('.fold')) return; if (e.button === 0 && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); startThumbDrag(e, i); } };   // no text selection while dragging
    t.onclick = e => {   // ⇧-click extends the slide selection, ⌘-click toggles; the filmstrip then has keyboard focus
      if (e.target.closest('.fold')) { const h = hv(i)[0]; setFolded(h, !foldedH().has(h)); renderThumbs(); return; }

      if (thumbDragged) { thumbDragged = false; return; }

      if (e.shiftKey) extendTo(i); else if (e.metaKey || e.ctrlKey) toggleSlide(i); else go(i);
      thumbs.focus({ preventScroll: true });
    };
    return t;
  });
  // only the entries that changed move: re-inserting every thumbnail made the whole strip blink
  const keep = new Set(els);
  [...thumbs.children].forEach(c => { if (!keep.has(c)) c.remove(); });
  els.forEach((t, i) => { if (thumbs.children[i] !== t) thumbs.insertBefore(t, thumbs.children[i] || null); });
  thumbs.children[cur]?.scrollIntoView({ block: 'nearest' });
  drawPeople();   // who else is here, on which slide (people.js)
}

/* Overlay elements for a box inside groups live in frames that repeat the groups' position and rotation. */
function frameFor(b) {
  const gs = []; for (let p = parentBox(b); p; p = parentBox(p)) gs.unshift(p);
  let host = ui;
  for (const g of gs) { const f = div('sel-frame'); place(f, geo(g)); f.style.transform = g.style.transform; f.style.scale = flipXY(g).join(' '); host.append(f); host = f; }
  return host;
}
function drawOverlay() {
  ui.replaceChildren(); queueRulers(); drawPeopleOn();
  const k = 1 / scale;
  if (scope?.isConnected) {   // the entered group: a dashed outline, as Slides
    const o = div('sel-box scope'); place(o, geo(scope)); o.style.transform = scope.style.transform; o.style.setProperty('--k', k + 'px'); frameFor(scope).append(o);
  }
  for (const b of sel) {
    const o = div('sel-box' + (b === editing ? ' editing' : '') + (sel.size > 1 ? ' thin' : ''));
    place(o, geo(b)); o.style.setProperty('--k', k + 'px');   // stroke = 1 screen px (box-shadow: borders get rounded)
    o.style.transform = b.style.transform; o.style.scale = flipXY(b).join(' ');
    frameFor(b).append(o);
    if (isGroup(b) && b !== editing) for (const m of kids(b)) {   // Slides outlines each member of a selected group
      const t = div('sel-box thin'); place(t, geo(m)); t.style.setProperty('--k', k + 'px'); t.style.transform = m.style.transform; frameFor(m).append(t);
    }
  }
  drawMovePath();   // a Move action's ghost and path (motion.js)
  if (editing || !sel.size) return;
  const locked = [...sel].some(isLocked);   // Keynote: grey handles that can't be dragged
  if (sel.size > 1) {   // Slides: one box with resize handles around the whole selection (no rotation knob)
    const g = bbox([...sel].map(aabb)), wrap = div('sel-wrap' + (locked ? ' locked' : '')), box = div('sel-box');
    place(wrap, g); place(box, { x: 0, y: 0, w: g.w, h: g.h }); box.style.setProperty('--k', k + 'px'); wrap.append(box);
    const cur = { n: 'ns', s: 'ns', e: 'ew', w: 'ew', ne: 'nesw', sw: 'nesw', nw: 'nwse', se: 'nwse' };
    addHandles(wrap, g, ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], d => cur[d] + '-resize', k, false);
    ui.append(wrap); return;
  }
  const b = [...sel][0], g = geo(b), sz = 10 * k;   // Slides: 10px round corner handles, pill-shaped side handles
  const wrap = div('sel-wrap' + (locked ? ' locked' : '')); place(wrap, g); wrap.style.transform = b.style.transform; wrap.style.scale = flipXY(b).join(' ');   // handles rotate and flip with the box
  const dirs = !isLine(b) ? ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] : b.dataset.dir === 'up' ? ['sw', 'ne'] : ['nw', 'se'];
  if (cropping === b) {   // Slides' crop marks: black L corners and bars, dragged to cut the picture
    for (const d of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      const h = div('handle crop ' + d); h.dataset.dir = d; h.dataset.crop = '';
      const hx = d.includes('w') ? 0 : d.includes('e') ? g.w : g.w / 2, hy = d.includes('n') ? 0 : d.includes('s') ? g.h : g.h / 2, L = 16 * k;
      h.style.cssText = `left:${hx - (d.includes('w') ? 0 : d.includes('e') ? L : L / 2)}px;top:${hy - (d.includes('n') ? 0 : d.includes('s') ? L : L / 2)}px;width:${L}px;height:${L}px;--k:${k}px;cursor:${resizeCursor(b, d)}`;
      wrap.append(h);
    }
    drawCropExtras(b, g, k, frameFor(b)); frameFor(b).append(wrap); return;
  }
  if (pointEdit === b) { drawPoints(wrap, b, g, k); frameFor(b).append(wrap); return; }   // Edit points: anchors and handles instead
  addHandles(wrap, g, dirs, d => resizeCursor(b, d), k, isLine(b));
  if (locked) { frameFor(b).append(wrap); return; }
  if (isLine(b)) [b.dataset.from, b.dataset.to].forEach((at, i) => at && wrap.querySelector(`.handle[data-dir="${dirs[i]}"]`)?.classList.add('linked'));   // attached ends: filled, as Slides
  const host = frameFor(b);
  (shapeAdjust(b) || []).forEach((adj, i) => {   // Slides' yellow diamonds, where the OOXML preset puts its handles
    const a = div('handle adjust'), as = 10 * k; a.dataset.i = i;
    a.style.cssText = `left:${adj.x - as / 2}px;top:${adj.y - as / 2}px;width:${as}px;height:${as}px;--k:${k}px`;
    wrap.append(a);
  });
  if (!isLine(b)) {
    const L = (PHONE ? 33 : 18) * k, rs = (PHONE ? 15 : 16) * k;   // a 16 px filled knob with a ↻ glyph on an 18 px stem (the phone: 15 px, centred 40 above)
    const stem = div('rot-stem'); stem.style.cssText = `left:${g.w / 2 - k / 2}px;top:${-L}px;width:${k}px;height:${L}px`;
    const r = div('handle rotate');
    r.style.cssText = `left:${g.w / 2 - rs / 2}px;top:${-L - rs}px;width:${rs}px;height:${rs}px;--k:${k}px;font-size:${12 * k}px`;
    r.innerHTML = '<span class="icon">refresh</span>';
    wrap.append(stem, r);
  }
  host.append(wrap);
}

function addHandles(wrap, g, dirs, cursor, k, line) {
  const sz = 12 * k;   // measured on Google Slides: ~13 px corner circles, 22 × 8 px side pills
  // a box too small on screen for the middle handles as well as room to grab it: those go, as in Slides (corners resize)
  if (!line) dirs = dirs.filter(d => !(('ns'.includes(d) && d.length === 1 && g.w / k < 50) || ('ew'.includes(d) && d.length === 1 && g.h / k < 40)));
  for (const d of dirs) {
    const hx = d.includes('w') ? 0 : d.includes('e') ? g.w : g.w / 2;
    const hy = d.includes('n') ? 0 : d.includes('s') ? g.h : g.h / 2;
    const side = d.length === 1 && !line && !PHONE, [w, h2] = !side ? [sz, sz] : 'ns'.includes(d) ? [22 * k, 8 * k] : [8 * k, 22 * k];
    const h = div('handle' + (side ? ' side' : '') + (busy && d === dragDir ? ' on' : '')); h.dataset.dir = d;   // the one being dragged is solid
    h.style.cssText = `left:${hx - w / 2}px;top:${hy - h2 / 2}px;width:${w}px;height:${h2}px;--k:${k}px;cursor:${cursor(d)}`;
    wrap.append(h);
  }
}

/* Pink alignment lines, as in Slides. When a line comes from another box (ox/oy), also show the
   gap between that box and the moving one (m) along the line, with its distance in px. */
/* Slides' alignment lines: 1 px, dark red, running from the farthest box on that line to the moving one (across the
   slide only for the slide's own edges / centre and user guides, which have no box); no distance numbers. */
function showGuides(gx, gy, m, ox, oy, others = []) {
  guides.querySelectorAll('.guide, .measure, .measure-label, .space').forEach(e => e.remove());
  const k = 1 / scale, on = (o, key, size, at) => [o[key], o[key] + o[size] / 2, o[key] + o[size]].some(v => Math.abs(v - at) < 0.5);
  const span = (at, key, size, ckey, csize) => {   // the extent along the line of every box sitting on it, plus m
    const hit = m ? others.filter(o => on(o, key, size, at)).concat([m]) : [];
    return hit.length > 1 ? [Math.min(...hit.map(o => o[ckey])), Math.max(...hit.map(o => o[ckey] + o[csize]))] : null;
  };
  if (gx != null) { const sp = span(gx, 'x', 'w', 'y', 'h') || [0, H], l = div('guide'); place(l, { x: gx - k / 2, y: sp[0], w: k, h: sp[1] - sp[0] }); guides.append(l); }
  if (gy != null) { const sp = span(gy, 'y', 'h', 'x', 'w') || [0, W], l = div('guide'); place(l, { x: sp[0], y: gy - k / 2, w: sp[1] - sp[0], h: k }); guides.append(l); }
}
function sizeMark(o, key) {   // a teal bracket along the bottom (width) or right side (height) of a box of matching size
  const k = 1 / scale, r = g => { const e = div('space'); place(e, g); guides.append(e); };
  if (key === 'w') { const y = o.y + o.h + 10 * k; r({ x: o.x, y: y - k / 2, w: o.w, h: k }); r({ x: o.x - k / 2, y: y - 4 * k, w: k, h: 8 * k }); r({ x: o.x + o.w - k / 2, y: y - 4 * k, w: k, h: 8 * k }); }
  else { const x = o.x + o.w + 10 * k; r({ x: x - k / 2, y: o.y, w: k, h: o.h }); r({ x: x - 4 * k, y: o.y - k / 2, w: 8 * k, h: k }); r({ x: x - 4 * k, y: o.y + o.h - k / 2, w: 8 * k, h: k }); }
}
function measure(dir, at, a0, a1, b0, b1) {
  const [from, to] = a0 >= b1 ? [b1, a0] : b0 >= a1 ? [a1, b0] : [];
  if (from == null || to - from < 1) return;
  const k = 1 / scale, line = div('measure'), label = div('measure-label');
  place(line, dir === 'v' ? { x: at - k / 2, y: from, w: k, h: to - from } : { x: from, y: at - k / 2, w: to - from, h: k });
  label.textContent = String(Math.round(to - from));
  label.style.cssText = `font-size:${11 * k}px;padding:${1 * k}px ${4 * k}px;border-radius:${2 * k}px;` +
    (dir === 'v' ? `left:${at + 4 * k}px;top:${(from + to) / 2}px;translate:0 -50%` : `left:${(from + to) / 2}px;top:${at + 4 * k}px;translate:-50% 0`);
  const caps = [from, to].map(t => { const c = div('measure'); place(c, dir === 'v' ? { x: at - 4 * k, y: t - k / 2, w: 8 * k, h: k } : { x: t - k / 2, y: at - 4 * k, w: k, h: 8 * k }); return c; });
  guides.append(line, ...caps, label);
}

const toHex = (() => {
  const ctx = document.createElement('canvas').getContext('2d');
  return (v, def) => {
    if (!v || v === 'transparent' || v === 'none') return def;
    ctx.fillStyle = def; ctx.fillStyle = v.trim();
    const f = String(ctx.fillStyle), m = f.match(/^rgba\((\d+), (\d+), (\d+)/);   // translucent colours come back as rgba(): keep the colour
    return f.startsWith('#') ? f : m ? '#' + m.slice(1, 4).map(n => (+n).toString(16).padStart(2, '0')).join('') : def;
  };
})();
/* Alpha (0..1) of a CSS colour, and a colour with a new alpha as #rrggbbaa (#rrggbb when opaque). */
const alphaOf = v => {
  v = (v || '').trim();
  const hex = v.match(/^#[0-9a-f]{6}([0-9a-f]{2})$/i); if (hex) return parseInt(hex[1], 16) / 255;
  const rgba = v.match(/rgba\([^)]*,\s*([\d.]+)\)/); return rgba ? +rgba[1] : 1;
};
const withAlpha = (hex, a) => a >= 1 ? hex : hex + Math.round(a * 255).toString(16).padStart(2, '0');

function updateToolbar() {
  const b = [...sel][0];
  document.body.classList.toggle('has-sel', !!b);
  // As Slides, images and lines have no text or fill controls, and a mixed selection shows only what all kinds share
  const kind = x => isStroke(x) ? 'line' : isMedia(x) ? 'image' : isGroup(x) ? 'group' : 'text', kinds = new Set([...sel].map(kind));
  document.body.classList.toggle('sel-notext', !!b && (!kinds.has('text') || kinds.size > 1));
  document.body.classList.toggle('sel-line', !!b && [...sel].every(isLine));
  document.body.classList.toggle('edit-table', !!editing?.querySelector('table'));   // Select borders, for the picked cells
  document.body.classList.toggle('sel-image', sel.size === 1 && !!b?.classList.contains('image'));   // Replace image button   // line start / end buttons
  renderObjects();
  layoutToolbar();
  $('#ed-undo').disabled = hptr <= 0;
  $('#ed-redo').disabled = hptr >= hist.length - 1;
  $('#ed-bg').value = toHex(slides[cur]?.dataset.backgroundColor, '#ffffff');
  if (!b) return;
  if (isGroup(b)) { paintBars(); updatePanel(); renderAnims?.(); return; }   // a group: no text or fill state
  const c = content(b), cs = getComputedStyle(c);
  $('#ed-fill').value = toHex(b.style.getPropertyValue('--fill'), '#4a86e8');
  $('#ed-stroke').value = toHex(b.style.getPropertyValue('--stroke'), '#333333');
  $('#ed-color').value = toHex(cs.color, '#222222');
  paintBars();
  updatePanel();
  renderAnims?.();
  showTextStyle(b);
  $('#ed-bold').classList.toggle('on', c.style.fontWeight === 'bold');
  $('#ed-italic').classList.toggle('on', c.style.fontStyle === 'italic');
  $('#ed-underline').classList.toggle('on', c.style.textDecoration === 'underline');
  $('#ed-ul').classList.toggle('on', !!c.querySelector(':scope > ul'));
  $('#ed-ol').classList.toggle('on', !!c.querySelector(':scope > ol'));
  $('#ed-align .icon').textContent = ALIGNS.find(a => a[0] === curAlign())?.[1] || 'format_align_left';
}
