/* ---------- geometry ---------- */

function geo(b) {
  const s = b.style;
  return { x: parseFloat(s.left) || 0, y: parseFloat(s.top) || 0, w: parseFloat(s.width) || 0, h: parseFloat(s.height) || 0 };
}
function setGeo(b, g) {
  if (isGroup(b)) {   // a group's children keep their place relative to it, scaled with it
    const o = geo(b), sx = o.w ? g.w / o.w : 1, sy = o.h ? g.h / o.h : 1;
    if (sx !== 1 || sy !== 1) kids(b).forEach(c => { const q = geo(c); setGeo(c, { x: q.x * sx, y: q.y * sy, w: q.w * sx, h: q.h * sy }); });
  }
  b.style.left = r1(g.x) + 'px'; b.style.top = r1(g.y) + 'px';
  b.style.width = r1(g.w) + 'px'; b.style.height = r1(g.h) + 'px';
  if (b.dataset.shape) renderShape(b);
  if (b.dataset.autofit === 'shrink') fitText(b);
}
function place(el, g) { Object.assign(el.style, { left: g.x + 'px', top: g.y + 'px', width: g.w + 'px', height: g.h + 'px' }); }
/* Rotation lives in the box's inline transform (rotate about the centre); 0 means no transform. */
const rot = b => parseFloat((b.style.transform.match(/rotate\((-?[\d.]+)deg\)/) || [])[1]) || 0;
/* The resize cursor for a handle, turned with the box as in Slides (rotation, then any flip). */
function resizeCursor(b, dir) {
  const [fx, fy] = flipXY(b);
  let a = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 }[dir] + rot(b);
  if (fx < 0) a = -a;
  if (fy < 0) a = 180 - a;
  return ['ns', 'nesw', 'ew', 'nwse'][Math.round((((a % 180) + 180) % 180) / 45) % 4] + '-resize';
}

/* Mirroring from data-flip: -1 on a flipped axis (the CSS `scale` applied after the box's rotate). */
const flipXY = b => [(b.dataset.flip || '').includes('h') ? -1 : 1, (b.dataset.flip || '').includes('v') ? -1 : 1];

/* Axis-aligned bounds of a box as drawn, i.e. after rotation (used for snapping and marquee). */
function aabb(b) {
  const g = geo(b), t = rot(b) * Math.PI / 180;
  if (!t) return g;
  const c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
  const w = g.w * c + g.h * s, h = g.w * s + g.h * c;
  return { x: g.x + g.w / 2 - w / 2, y: g.y + g.h / 2 - h / 2, w, h };
}
function setRot(b, deg) {
  deg = Math.round(((deg % 360) + 360) % 360 * 10) / 10;
  b.style.transform = deg ? `rotate(${deg}deg)` : '';
  shadeBox(b);
  if (!b.getAttribute('style')?.trim()) b.removeAttribute('style');
}
function bbox(gs) {
  const x = Math.min(...gs.map(g => g.x)), y = Math.min(...gs.map(g => g.y));
  return { x, y, w: Math.max(...gs.map(g => g.x + g.w)) - x, h: Math.max(...gs.map(g => g.y + g.h)) - y };
}
function toCanvas(e) {
  const r = frame.getBoundingClientRect();
  return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
}
/* Zoom as in Slides: null = fit the window; otherwise a factor where 1 (100%) shows the slide 960px
   wide, like a 10-inch Slides page. The stage scrolls when the slide is bigger than it. */
let zoom = null;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];
function fit() {
  const r = stage.getBoundingClientRect();
  const pad = PHONE ? 30 : 64;   // the phone fits the slide 15 from the sides (03-edit.png)
  scale = zoom ? zoom * 960 / W : Math.max(0.05, Math.min((r.width - pad) / W, (r.height - pad) / H));
  frame.style.width = W * scale + 'px'; frame.style.height = H * scale + 'px';
  canvas.style.transform = `scale(${scale})`;
  stage.classList.toggle('zoomed', !!zoom);
  $('#ed-zoom .zoom-label').textContent = zoom ? Math.round(zoom * 100) + '%' : 'Fit';
  extendStage();
  drawOverlay(); drawGuides(); drawRulers();
}
/* Rulers, as Slides: inches (1 in = 192 canvas px) with 1/8 in ticks and numbers at whole inches, 0 at the slide's
   top-left, a baseline along the slide, the selection marked by three blue ticks, and a blue mark following the pointer. Dragging out of
   the top ruler makes a horizontal guide, out of the left one a vertical guide. View → Show ruler hides them. */
let rulerPtr = null, rulerQueued = false;
const rulersShown = () => stored('slides-ruler-off') !== '1';
function setRulersShown(on) { store('slides-ruler-off', on ? undefined : '1'); document.body.classList.toggle('ruler-off', !on); drawRulers(); }
function queueRulers() { if (!rulerQueued) { rulerQueued = true; requestAnimationFrame(() => { rulerQueued = false; drawRulers(); }); } }
function drawRulers() {
  if (!rulersShown() || !slides.length) return;
  const css = getComputedStyle(document.body), tok = k => css.getPropertyValue(k).trim();   // body: dark mode overrides the tokens there
  const fr = frame.getBoundingClientRect(), dpr = devicePixelRatio || 1, step = 192 * scale / 8;
  const span = sel.size && !themeStash ? bbox([...sel].map(aabb)) : null;
  for (const horiz of [true, false]) {
    const cv = $(horiz ? '#ed-ruler-h' : '#ed-ruler-v'), r = cv.getBoundingClientRect(), w = r.width, h = r.height;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const o = horiz ? fr.left - r.left : fr.top - r.top, len = (horiz ? W : H) * scale, along = horiz ? w : h, across = horiz ? h : w;
    g.strokeStyle = '#9aa0a6'; g.fillStyle = '#444'; g.font = `11px ${tok('--font')}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 1;
    g.beginPath();   // the 1 px baseline along the slide's side
    if (horiz) { g.moveTo(o, across - 0.5); g.lineTo(o + len, across - 0.5); } else { g.moveTo(across - 0.5, o); g.lineTo(across - 0.5, o + len); }
    const last = (horiz ? W : H) / 192 * 8;
    for (let i = Math.floor(-o / step); i <= Math.ceil((along - o) / step); i++) {
      const p = Math.round(o + i * step) + 0.5;
      if (i % 8 === 0) {   // a whole inch: its number, as Slides (none at 0 or at the slide's far edge)
        if (i > 0 && i < last) { g.save(); g.translate(horiz ? p : across / 2 - 2, horiz ? across / 2 - 2 : p); if (!horiz) g.rotate(-Math.PI / 2); g.fillText(String(i / 8), 0, 0); g.restore(); }
        continue;
      }
      const t = i % 4 === 0 ? 8 : i % 2 === 0 ? 5 : 3;   // ½ in 8 px, ¼ in 5 px, ⅛ in 3 px
      if (horiz) { g.moveTo(p, across - t); g.lineTo(p, across); } else { g.moveTo(across - t, p); g.lineTo(across, p); }
    }
    g.stroke();
    if (span) {   // the selection: three 2 px blue ticks at its start, centre and end
      const a0 = o + (horiz ? span.x : span.y) * scale, l = (horiz ? span.w : span.h) * scale;
      g.fillStyle = tok('--blue');
      for (const p of [a0, a0 + l / 2, a0 + l]) horiz ? g.fillRect(Math.round(p) - 1, 0, 2, across) : g.fillRect(0, Math.round(p) - 1, across, 2);
    }
    if (rulerPtr) {
      const p = Math.round(horiz ? rulerPtr.x - r.left : rulerPtr.y - r.top) + 0.5;
      if (p > 0 && p < along) { g.strokeStyle = tok('--blue'); g.beginPath(); if (horiz) { g.moveTo(p, 0); g.lineTo(p, across); } else { g.moveTo(0, p); g.lineTo(across, p); } g.stroke(); }
    }
  }
}
$('#ed-stage').addEventListener('pointermove', e => { rulerPtr = { x: e.clientX, y: e.clientY }; queueRulers(); });
$('#ed-stage').addEventListener('pointerleave', () => { rulerPtr = null; queueRulers(); });
$('#ed-stage').addEventListener('scroll', queueRulers);
/* Drag a guide out of a ruler, as Slides. It starts only once the pointer has left the ruler by a few pixels, so a click
   on the ruler does nothing; while dragging the line is blue with where it is (inches, as the ruler counts), and it is
   kept only if let go over the slide. */
for (const [id, d] of [['#ed-ruler-h', 'h'], ['#ed-ruler-v', 'v']]) {
  $(id).title = d === 'h' ? 'Drag down onto the slide for a guide' : 'Drag right onto the slide for a guide';
  $(id).addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const start = d === 'h' ? e.clientY : e.clientX, k = 1 / scale;
    let r = /** @type {HTMLElement | null} */ (null), label = /** @type {HTMLElement | null} */ (null);
    const at = ev => { const p = toCanvas(ev); return d === 'v' ? p.x : p.y; };
    const on = v => v >= 0 && v <= (d === 'v' ? W : H);
    const show = v => {
      place(r, d === 'v' ? { x: v - 4 * k, y: 0, w: 8 * k, h: H } : { x: 0, y: v - 4 * k, w: W, h: 8 * k });
      label.textContent = on(v) ? `${(v / 192).toFixed(2)} in` : 'Let go to cancel';
      r.classList.toggle('off', !on(v));
    };
    drag(e, ev => {
      if (!r) {
        if (Math.abs((d === 'h' ? ev.clientY : ev.clientX) - start) < 6) return;   // not yet: a click, or a wobble on the ruler
        setGuidesShown(true);
        r = div('rule new ' + d); r.style.setProperty('--k', k + 'px'); label = div('rule-at'); r.append(label); $('#ed-rules').append(r);
      }
      show(at(ev));
    }, ev => { if (!r) return; const v = at(ev); r.remove(); if (on(v)) setGuides([...userGuides(), [d, v]]); });
  });
}
/* Set the zoom, keeping the slide point under (cx, cy) (or the stage centre) where it was. */
function setZoom(z, cx, cy) {
  const sr = stage.getBoundingClientRect();
  cx ??= sr.left + sr.width / 2; cy ??= sr.top + sr.height / 2;
  const p = toCanvas({ clientX: cx, clientY: cy });
  zoom = z && Math.max(0.25, Math.min(4, z));
  fit();
  const fr = frame.getBoundingClientRect();
  stage.scrollLeft += fr.left + p.x * scale - cx; stage.scrollTop += fr.top + p.y * scale - cy;
}
const fitZoom = () => scale * W / 960;
/* Keynote's extended canvas: zoomed in, the stage scrolls as far as the objects that sit off the slide (a margin on
   that side of the frame), keeping the slide where it was on screen. */
function extendStage() {
  const fr0 = frame.getBoundingClientRect(), m = ['', '', '', ''];   // top right bottom left
  if (zoom && slides[cur]) {
    const g = bbox([{ x: 0, y: 0, w: W, h: H }, ...boxes().map(aabb)]), cs = getComputedStyle(stage);
    const [t, r, b, l] = [-g.y, g.x + g.w - W, g.y + g.h - H, -g.x].map(v => Math.max(0, v) * scale + (v > 0 ? 24 : 0));
    if (W * scale + l + r > stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) { if (l) m[3] = l + 'px'; if (r) m[1] = r + 'px'; }
    if (H * scale + t + b > stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) { if (t) m[0] = t + 'px'; if (b) m[2] = b + 'px'; }
  }
  const st = frame.style; if ([st.marginTop, st.marginRight, st.marginBottom, st.marginLeft].join() === m.join()) return;
  [st.marginTop, st.marginRight, st.marginBottom, st.marginLeft] = m;
  const fr = frame.getBoundingClientRect(); stage.scrollLeft += fr.left - fr0.left; stage.scrollTop += fr.top - fr0.top;
}
/* View → Zoom to selection (⇧⌘0) and Zoom to fit content (⌥⇧⌘0, the slide and everything off it), as Keynote. */
function zoomTo(g) {
  const cs = getComputedStyle(stage), sw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 32, sh = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 32;
  setZoom(Math.min(sw / Math.max(g.w, 1), sh / Math.max(g.h, 1)) * W / 960);
  const fr = frame.getBoundingClientRect(), sr = stage.getBoundingClientRect();
  stage.scrollLeft += fr.left + (g.x + g.w / 2) * scale - (sr.left + sr.width / 2); stage.scrollTop += fr.top + (g.y + g.h / 2) * scale - (sr.top + sr.height / 2);
  drawOverlay(); drawRulers();
}
const zoomToSelection = () => { if (sel.size) zoomTo(bbox([...sel].map(aabb))); };
const zoomToContent = () => zoomTo(bbox([{ x: 0, y: 0, w: W, h: H }, ...boxes().map(aabb)]));
const zoomStep = dir => {
  const z = fitZoom();
  setZoom(dir > 0 ? ZOOMS.find(v => v > z + 0.01) ?? 2 : [...ZOOMS].reverse().find(v => v < z - 0.01) ?? 0.5);
};
