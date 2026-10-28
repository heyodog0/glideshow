/* ---------- pointer interaction ---------- */

function drag(e, move, up) {
  e.preventDefault();
  const mm = ev => move(ev);
  const uu = ev => { removeEventListener('pointermove', mm); removeEventListener('pointerup', uu); up(ev); };
  addEventListener('pointermove', mm);
  addEventListener('pointerup', uu);
}

/* What objects snap to: the slide's edges and centre, user guides, and other boxes' edges and centres. */
// Snap distances in screen px, measured on Slides: alignment snaps at 5 px
// and not at 7, equal spacing at 2 and not at 3, a line end onto a connection point from about 7.
const SNAP_PX = 6, SPACE_PX = 2.5, CONNECT_PX = 7, ROT_SNAP = 2;
function snapLines(others) {
  const xs = [0, W / 2, W], ys = [0, H / 2, H];
  if (snapGuides() && guidesShown()) for (const [d, v] of userGuides()) (d === 'v' ? xs : ys).push(v);
  for (const o of others) { xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h); }
  return { xs, ys };
}
/* View → Snap to → Grid: a 1/8 in grid (24 canvas px); moves put the top-left corner on it, resizes the dragged edge. */
const GRID = 24, snapGrid = () => stored('slides-snap-grid') === '1', onGrid = v => Math.round(v / GRID) * GRID;
function snap(g, others) {
  if (snapGrid()) return { dx: onGrid(g.x) - g.x, dy: onGrid(g.y) - g.y };
  const th = SNAP_PX / scale, { xs, ys } = snapLines(others);
  const best = (cands, vals) => {
    let m = null;
    for (const c of cands) for (const v of vals) {
      const d = c - v;
      if (Math.abs(d) < th && (!m || Math.abs(d) < Math.abs(m.d))) m = { d, at: c };
    }
    return m;
  };
  const bx = best(xs, [g.x, g.x + g.w / 2, g.x + g.w]), by = best(ys, [g.y, g.y + g.h / 2, g.y + g.h]);
  // which box (if any) the snapped line belongs to, for the distance labels: the nearest one along the line
  const dist = (o, key, size) => Math.abs((o[key] + o[size] / 2) - (g[key] + g[size] / 2));
  const owner = (at, key, size) => at == null ? null : others.filter(o => [o[key], o[key] + o[size] / 2, o[key] + o[size]].includes(at))
    .sort((a, c) => dist(a, key === 'x' ? 'y' : 'x', key === 'x' ? 'h' : 'w') - dist(c, key === 'x' ? 'y' : 'x', key === 'x' ? 'h' : 'w'))[0] || null;
  return { dx: bx?.d ?? 0, dy: by?.d ?? 0, gx: bx?.at, gy: by?.at, ox: owner(bx?.at, 'x', 'w'), oy: owner(by?.at, 'y', 'h') };
}

/* Equal spacing, as Slides' smart guides: along an axis, the boxes sharing a row (or column) with m.
   Snaps m so its gap to a neighbour equals a gap already on the slide, or centres it between two
   neighbours; returns the shift and the gap size, or null. */
const AXES = { x: ['x', 'w', 'y', 'h'], y: ['y', 'h', 'x', 'w'] };
function inRow(m, others, ax) {
  const [p, s, q, t] = AXES[ax];
  return others.filter(o => o[q] < m[q] + m[t] && o[q] + o[t] > m[q]).sort((a, b) => a[p] - b[p]);
}
function gapsOf(row, ax) {
  const [p, s] = AXES[ax], out = [];
  for (let i = 1; i < row.length; i++) { const g = row[i][p] - (row[i - 1][p] + row[i - 1][s]); if (g > 0) out.push(g); }
  return out;
}
function spaceSnap(m, others, ax) {
  const [p, s] = AXES[ax], th = SPACE_PX / scale, row = inRow(m, others, ax), mid = m[p] + m[s] / 2;
  const left = row.filter(o => o[p] + o[s] / 2 < mid).sort((a, b) => (b[p] + b[s]) - (a[p] + a[s]))[0];
  const right = row.filter(o => o[p] + o[s] / 2 > mid).sort((a, b) => a[p] - b[p])[0];
  const gaps = gapsOf(row, ax), cands = [];
  if (left) gaps.forEach(g => cands.push([left[p] + left[s] + g - m[p], g]));
  if (right) gaps.forEach(g => cands.push([right[p] - g - m[s] - m[p], g]));
  if (left && right) { const g = (right[p] - left[p] - left[s] - m[s]) / 2; if (g > 0) cands.push([left[p] + left[s] + g - m[p], g]); }
  const best = cands.filter(([d]) => Math.abs(d) < th).sort((a, b) => Math.abs(a[0]) - Math.abs(b[0]))[0];
  return best ? { d: best[0], gap: best[1] } : null;
}
/* Teal brackets under every gap of that size in m's row, as the reference shows. */
function showSpacing(m, others, ax, gap) {
  const [p, s, q, t] = AXES[ax], k = 1 / scale, row = inRow(m, others.concat([m]), ax).concat([m]).filter((o, i, a) => a.indexOf(o) === i).sort((a, b) => a[p] - b[p]);
  const off = Math.max(...row.map(o => o[q] + o[t])) + 12 * k;
  for (let i = 1; i < row.length; i++) {
    const from = row[i - 1][p] + row[i - 1][s], to = row[i][p];
    if (Math.abs(to - from - gap) > 0.5) continue;
    const r = (a, b, c, d) => { const e = div('space'); place(e, ax === 'x' ? { x: a, y: b, w: c, h: d } : { x: b, y: a, w: d, h: c }); guides.append(e); };
    r(from, off - k / 2, to - from, k); r(from - k / 2, off - 7 * k, k, 14 * k); r(to - k / 2, off - 7 * k, k, 14 * k);
  }
}

/* Drag the selection. ⇧ constrains to horizontal/vertical, ⌥ at the start drags a copy and leaves
   the original in place, ⌘ turns snapping off. */
function startMove(e, onClick) {
  const p0 = toCanvas(e), copy = e.altKey;
  if (anyLocked()) { drag(e, () => {}, () => onClick?.()); return; }   // a locked object stays where it is
  let items = [...sel].map(b => [b, geo(b)]);
  const b0 = bbox([...sel].map(aabb)), nested = [...sel].some(parentBox);   // members of a group move in its frame, without slide snapping
  const others = boxes().filter(b => copy || !sel.has(b)).map(aabb);
  let moved = false;
  busy = true;
  drag(e, ev => {
    const p = toCanvas(ev);
    let dx = p.x - p0.x, dy = p.y - p0.y;
    if (!moved && Math.hypot(dx, dy) * scale < 3) return;
    if (!moved && copy) {
      items = items.map(([b, g]) => { const c = cleanBox(b); c.id = uid(); b.after(c); if (c.dataset.shape) renderShape(c); return [c, g]; });
      sel = new Set(items.map(i => i[0]));
    }
    if (!moved && !nested) for (const [b] of items) { const gh = div('drag-ghost'); place(gh, aabb(b)); gh.style.setProperty('--k', 1 / scale + 'px'); guides.append(gh); }   // where it was, as Slides
    moved = true;
    const lock = ev.shiftKey ? (Math.abs(dx) >= Math.abs(dy) ? 'y' : 'x') : null;
    if (lock === 'x') dx = 0; else if (lock === 'y') dy = 0;
    if (!nested && !ev.metaKey && !ev.ctrlKey) {
      const at = { ...b0, x: b0.x + dx, y: b0.y + dy }, s = snap(at, others);
      const grid = snapGrid(), qx = !grid && spaceSnap(at, others, 'x'), qy = !grid && spaceSnap(at, others, 'y');   // equal spacing wins when it is the closer snap
      const ex = qx && (s.gx == null || Math.abs(qx.d) <= Math.abs(s.dx)), ey = qy && (s.gy == null || Math.abs(qy.d) <= Math.abs(s.dy));
      if (lock !== 'x') dx += ex ? qx.d : s.dx;
      if (lock !== 'y') dy += ey ? qy.d : s.dy;
      const m = { ...b0, x: b0.x + dx, y: b0.y + dy };
      showGuides(lock === 'x' || ex ? null : s.gx, lock === 'y' || ey ? null : s.gy, m, s.ox, s.oy, others);
      if (ex && lock !== 'x') showSpacing(m, others, 'x', qx.gap);
      if (ey && lock !== 'y') showSpacing(m, others, 'y', qy.gap);
      // equal size, as when resizing: every object as wide (or as tall) as the one moving is marked in teal with it
      if (items.length === 1) for (const key of ['w', 'h']) { const same = others.filter(o => Math.abs(o[key] - m[key]) < 0.5); if (same.length) for (const o of [m, ...same]) sizeMark(o, key); }
    } else showGuides();
    for (const [b, g] of items) { setGeo(b, { ...g, x: g.x + dx, y: g.y + dy }); if (isLine(b)) { delete b.dataset.from; delete b.dataset.to; } }
    followConnectors();
    drawOverlay();
  }, () => {
    busy = false; showGuides(); guides.querySelectorAll('.drag-ghost').forEach(e => e.remove());
    if (moved) { if (editing && sel.has(editing)) { const b = editing; editing = null; commit(); startEdit(b); } else commit(); }   // a dragged editing box stays in edit mode
    else if (onClick) onClick();
    else if (sel.size === 1 && [...sel][0].dataset.placeholder && !content([...sel][0]).textContent.trim()) startEdit([...sel][0]);   // Slides: one click on an empty placeholder starts typing
    else maybeReload();
  });
}

/* Resize a multi-selection from its bounding box: every object scales about the fixed side (or the
   centre with ⌥); ⇧ on a corner keeps the proportions. Text sizes don't change, as Slides. */
function startGroupResize(e, dir) {
  const items = [...sel].map(b => [b, geo(b)]), g0 = bbox([...sel].map(aabb)), p0 = toCanvas(e);
  busy = true;
  drag(e, ev => {
    const p = toCanvas(ev), k2 = ev.altKey ? 2 : 1, dx = (p.x - p0.x) * k2, dy = (p.y - p0.y) * k2;
    let sx = dir.includes('e') ? (g0.w + dx) / g0.w : dir.includes('w') ? (g0.w - dx) / g0.w : 1;
    let sy = dir.includes('s') ? (g0.h + dy) / g0.h : dir.includes('n') ? (g0.h - dy) / g0.h : 1;
    sx = Math.max(20 / g0.w, sx || 1); sy = Math.max(20 / g0.h, sy || 1);
    if (dir.length === 2 && ev.shiftKey) sx = sy = Math.max(sx, sy);
    const ox = ev.altKey ? g0.x + g0.w / 2 : dir.includes('w') ? g0.x + g0.w : g0.x;
    const oy = ev.altKey ? g0.y + g0.h / 2 : dir.includes('n') ? g0.y + g0.h : g0.y;
    for (const [b, o] of items) {
      const cx = ox + (o.x + o.w / 2 - ox) * sx, cy = oy + (o.y + o.h / 2 - oy) * sy, w = o.w * sx, h = o.h * sy;
      setGeo(b, { x: cx - w / 2, y: cy - h / 2, w, h });
    }
    drawOverlay();
  }, () => { busy = false; boxes().filter(b => sel.has(b)).forEach(fitHeight); drawOverlay(); commit(); });
}

/* A line's two ends, as Slides sees them: each has a marker (data-start / data-end) and may be attached to a shape's
   connection point (data-from / data-to = "boxId:t|r|b|l"). The attributes always describe the left end as the start. */
const lineEnds = b => {
  const g = geo(b), up = b.dataset.dir === 'up';
  return [{ x: g.x, y: up ? g.y + g.h : g.y, mark: b.dataset.start || 'none', at: b.dataset.from || '' },
          { x: g.x + g.w, y: up ? g.y : g.y + g.h, mark: b.dataset.end || (b.dataset.shape === 'arrowline' ? 'fill-arrow' : 'none'), at: b.dataset.to || '' }];
};
function setLineEnds(b, P, Q) {   // P, Q: {x, y, mark, at}, in any order
  const [l, r] = P.x <= Q.x ? [P, Q] : [Q, P];
  if (b.dataset.shape === 'arrowline') b.dataset.shape = 'line';   // ends are explicit from now on
  const put = (k, v, none) => { if (v && v !== none) b.dataset[k] = v; else delete b.dataset[k]; };
  put('start', l.mark, 'none'); put('end', r.mark, 'none'); put('from', l.at); put('to', r.at);
  if (r.y < l.y) b.dataset.dir = 'up'; else delete b.dataset.dir;
  setGeo(b, { x: l.x, y: Math.min(l.y, r.y), w: r.x - l.x, h: Math.abs(r.y - l.y) });
}
/* Connection points, as Slides: the middle of each side of a shape (turned with it). */
function anchorPoint(b, side) {
  const g = geo(b), t = rot(b) * Math.PI / 180, [fx, fy] = flipXY(b);
  const [ox, oy] = { t: [0, -g.h / 2], r: [g.w / 2, 0], b: [0, g.h / 2], l: [-g.w / 2, 0] }[side];
  const x = ox * fx, y = oy * fy;
  return { x: g.x + g.w / 2 + x * Math.cos(t) - y * Math.sin(t), y: g.y + g.h / 2 + x * Math.sin(t) + y * Math.cos(t) };
}
const anchorOf = ref => { const [id, side] = (ref || '').split(':'), b = id && document.getElementById(id); return b && slides[cur].contains(b) && 'trbl'.includes(side) ? anchorPoint(b, side) : null; };
/* The connection point near p (within 12 screen px), and dots on the shape under the pointer, as Slides shows while drawing. */
function snapAnchor(p, line) {
  guides.querySelectorAll('.conn').forEach(e => e.remove());
  const k = 1 / scale, near = boxes().filter(o => o !== line && !isStroke(o) && !isGroup(o)).filter(o => { const a = aabb(o); return p.x > a.x - 24 * k && p.x < a.x + a.w + 24 * k && p.y > a.y - 24 * k && p.y < a.y + a.h + 24 * k; });
  let best = null;
  for (const o of near) for (const side of 'trbl') {
    const q = anchorPoint(o, side), d = Math.hypot(q.x - p.x, q.y - p.y), dot = div('conn');
    place(dot, { x: q.x - 4 * k, y: q.y - 4 * k, w: 8 * k, h: 8 * k }); dot.style.setProperty('--k', k + 'px'); guides.append(dot);
    if (d < CONNECT_PX * k && (!best || d < best.d)) best = { d, q, ref: o.id + ':' + side, dot };
  }
  best?.dot.classList.add('on');
  return best;
}
/* Attached lines follow their shapes (after a move, resize or rotate) and lose attachments to deleted shapes. */
function followConnectors() {
  for (const b of boxes().filter(x => isLine(x) && (x.dataset.from || x.dataset.to))) {
    const [P, Q] = lineEnds(b), a = anchorOf(P.at), c = anchorOf(Q.at);
    if (P.at && !a) P.at = ''; if (Q.at && !c) Q.at = '';
    // only one end attached: the whole line moves with the shape, as Slides (the free end doesn't stay behind)
    const shift = (E, to) => to && !(a && c) ? { ...E, x: E.x + to.x - (to === a ? P : Q).x, y: E.y + to.y - (to === a ? P : Q).y } : E;
    setLineEnds(b, { ...shift(P, c), ...(a || {}) }, { ...shift(Q, a), ...(c || {}) });
  }
}

/* Drag one end of a line, as Slides: the other end stays put and the line may swing past it (its box, data-dir and
   the ends' markers / attachments follow). Near a shape the end snaps to its connection points. ⇧ keeps 45° steps. */
function startLineEnd(e, dir) {
  const b = [...sel][0], [S, E] = lineEnds(b), movingEnd = dir === 'ne' || dir === 'se', fixed = movingEnd ? S : E, moving = movingEnd ? E : S;
  busy = true;
  drag(e, ev => {
    let p = toCanvas(ev);
    if (ev.shiftKey) {   // 45° steps
      const a = Math.round(Math.atan2(p.y - fixed.y, p.x - fixed.x) / (Math.PI / 4)) * Math.PI / 4, r = Math.hypot(p.x - fixed.x, p.y - fixed.y);
      p = { x: fixed.x + Math.cos(a) * r, y: fixed.y + Math.sin(a) * r };
    }
    const snap = ev.metaKey ? null : snapAnchor(p, b);
    setLineEnds(b, fixed, { ...moving, ...(snap ? snap.q : p), at: snap ? snap.ref : '' });
    drawOverlay();
  }, () => { busy = false; guides.querySelectorAll('.conn').forEach(e => e.remove()); commit(); });
}

/* Drag a yellow handle (in the box's own frame, so rotated / flipped boxes work): its preset adj values follow the pointer. */
function startAdjust(e, i) {
  const b = [...sel][0], g = geo(b), t = rot(b) * Math.PI / 180, [fx, fy] = flipXY(b), c = { x: g.x + g.w / 2, y: g.y + g.h / 2 };
  busy = true;
  drag(e, ev => {
    const p = toCanvas(ev), dx = p.x - c.x, dy = p.y - c.y;
    const lx = fx * (dx * Math.cos(t) + dy * Math.sin(t)) + g.w / 2, ly = fy * (-dx * Math.sin(t) + dy * Math.cos(t)) + g.h / 2;
    Object.assign(b.dataset, shapeAdjust(b)[i].set(lx, ly)); renderShape(b); drawOverlay();
  }, () => { busy = false; commit(); });
}

let dragDir = '';
function startResize(e, dir) {
  dragDir = dir;

  if (sel.size > 1) return startGroupResize(e, dir);
  if (isLine([...sel][0])) return startLineEnd(e, dir);
  const b = [...sel][0], g0 = geo(b), p0 = toCanvas(e), ratio = g0.w / (g0.h || 1);
  const image = isMedia(b), line = isLine(b), min = line ? 0 : 20;
  const t = rot(b) * Math.PI / 180, cos = Math.cos(t), sin = Math.sin(t), [fx, fy] = flipXY(b);
  // The handle opposite the dragged one stays put: (sx, sy) is its side in box-local units of half-size.
  const sx = dir.includes('w') ? 1 : dir.includes('e') ? -1 : 0, sy = dir.includes('n') ? 1 : dir.includes('s') ? -1 : 0;
  const c0 = { x: g0.x + g0.w / 2, y: g0.y + g0.h / 2 };
  const anchor = { x: c0.x + fx * (cos * sx * g0.w / 2 - sin * sy * g0.h / 2), y: c0.y + fy * (sin * sx * g0.w / 2 + cos * sy * g0.h / 2) };
  busy = true;
  drag(e, ev => {
    const p = toCanvas(ev), wx = fx * (p.x - p0.x), wy = fy * (p.y - p0.y);
    const dx = cos * wx + sin * wy, dy = -sin * wx + cos * wy;   // pointer delta in the box's (unflipped, unrotated) frame
    let w = g0.w, h = g0.h;
    const k2 = ev.altKey ? 2 : 1;   // ⌥: resize from the centre (both sides move)
    if (dir.includes('e')) w = g0.w + dx * k2;
    if (dir.includes('w')) w = g0.w - dx * k2;
    if (dir.includes('s')) h = g0.h + dy * k2;
    if (dir.includes('n')) h = g0.h - dy * k2;
    w = Math.max(min, w); h = Math.max(min, h);
    const keep = dir.length === 2 && g0.h > 0 && (image || b.dataset.lock === 'aspect') !== ev.shiftKey;
    if (keep) {   // images and locked boxes keep aspect unless ⇧; others keep it with ⇧
      if (w / g0.w > h / g0.h) h = w / ratio; else w = h * ratio;
    }
    // Equal size, as Slides: an edge being dragged snaps the size to another box's, which is marked in teal;
    // or, when closer, the dragged edge snaps to another box's edge / centre or the slide's (a red line, as when moving)
    const same = { w: null, h: null }, line2 = { x: null, y: null };
    if (snapGrid() && !t && !keep && !ev.altKey && !line && fx === 1 && fy === 1) {   // the dragged edge lands on the grid
      if (/[ew]/.test(dir)) w = dir.includes('e') ? onGrid(g0.x + w) - g0.x : g0.x + g0.w - onGrid(g0.x + g0.w - w);
      if (/[ns]/.test(dir)) h = dir.includes('s') ? onGrid(g0.y + h) - g0.y : g0.y + g0.h - onGrid(g0.y + g0.h - h);
      w = Math.max(min, w); h = Math.max(min, h);
    } else if (!t && !keep && !ev.altKey && !ev.metaKey && !line) {
      const others = boxes().filter(o => o !== b).map(aabb), th = SNAP_PX / scale, { xs, ys } = snapLines(others);
      const near = (vals, v) => vals.reduce((m, c) => Math.abs(c - v) < Math.abs(m - v) ? c : m, Infinity);
      for (const [d, key] of /** @type {[RegExp, string][]} */ ([[/[ew]/, 'w'], [/[ns]/, 'h']])) {
        if (!d.test(dir)) continue;
        const size = key === 'w' ? w : h, o = others.filter(o => Math.abs(o[key] - size) < th).sort((a, c) => Math.abs(a[key] - size) - Math.abs(c[key] - size))[0];
        let best = o ? Math.abs(o[key] - size) : th;
        if (fx === 1 && fy === 1) {   // the moving edge, in slide units
          const [lo, len, lines] = key === 'w' ? [g0.x, g0.w, xs] : [g0.y, g0.h, ys], grow = key === 'w' ? dir.includes('e') : dir.includes('s');
          const edge = grow ? lo + size : lo + len - size, c = near(lines, edge);
          if (Math.abs(c - edge) < best) { best = Math.abs(c - edge); const ns = grow ? c - lo : lo + len - c; if (key === 'w') w = ns; else h = ns; line2[key === 'w' ? 'x' : 'y'] = c; continue; }
        }
        if (o) { if (key === 'w') w = o.w; else h = o.h; same[key] = others.filter(x => Math.abs(x[key] - o[key]) < 0.5); }
      }
    }
    const [cx, cy] = ev.altKey ? [c0.x, c0.y]
      : [anchor.x - fx * (cos * sx * w / 2 - sin * sy * h / 2), anchor.y - fy * (sin * sx * w / 2 + cos * sy * h / 2)];
    setGeo(b, { x: cx - w / 2, y: cy - h / 2, w, h });
    showGuides(line2.x, line2.y);
    for (const key of ['w', 'h']) if (same[key]) for (const o of [geo(b), ...same[key]]) sizeMark(o, key);
    drawOverlay();
  }, () => {
    busy = false; showGuides();
    if (!b.dataset.shape && !image && /[ns]/.test(dir)) b.dataset.minh = geo(b).h;
    if (!image) fitHeight(b);   // as Slides, a box that fits its text never ends shorter than the text: it grows back to it on release
    commit();
  });
}

/* Drag the handle above the box to rotate it about its centre; ⇧ snaps to 15°. As Slides, the box stays put
   while a grey outline shows the new angle with a degree label, and the rotation applies on release. */
function startRotate(e) {
  const b = [...sel][0], g = geo(b), cx = g.x + g.w / 2, cy = g.y + g.h / 2;
  const r0 = rot(b), p0 = toCanvas(e), a0 = Math.atan2(p0.y - cy, p0.x - cx), k = 1 / scale;
  const ghost = b.cloneNode(true), label = div('rot-label');
  ghost.removeAttribute('id'); ghost.classList.add('rot-ghost'); ghost.style.setProperty('--k', k);
  Object.assign(label.style, { left: g.x + g.w - 6 * k + 'px', top: g.y + 2 * k + 'px', fontSize: 11 * k + 'px', translate: '-100%' });   // inside the top-right corner, as Slides
  let deg = r0;
  busy = true;
  drag(e, ev => {
    const p = toCanvas(ev);
    const [fx, fy] = flipXY(b);   // a mirrored box turns the other way
    deg = r0 + fx * fy * (Math.atan2(p.y - cy, p.x - cx) - a0) * 180 / Math.PI;
    if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
    else { const m = Math.round(deg / 45) * 45; if (Math.abs(deg - m) < ROT_SNAP) deg = m; }   // clicks into 0°, 45°, 90°… as Slides (±2°)
    setRot(ghost, deg); label.textContent = (PHONE ? Math.round(rot(ghost)) : rot(ghost)) + '°';   // the phone app shows whole degrees (r02)
    if (!ghost.isConnected) guides.append(ghost, label);
  }, () => { busy = false; ghost.remove(); label.remove(); if (deg !== r0) { setRot(b, deg); drawOverlay(); commit(); } });
}

function startMarquee(e) {
  const p0 = toCanvas(e), m = div('marquee');
  guides.append(m);
  busy = true;
  drag(e, ev => {
    const p = toCanvas(ev);
    const r = { x: Math.min(p0.x, p.x), y: Math.min(p0.y, p.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) };
    place(m, r); m.style.borderWidth = 1 / scale + 'px';
    sel = new Set(pickable().filter(b => {
      if (isLocked(b)) return false;
      const g = aabb(b);
      return g.x < r.x + r.w && g.x + g.w > r.x && g.y < r.y + r.h && g.y + g.h > r.y;
    }));
    drawOverlay();
  }, () => { busy = false; m.remove(); updateToolbar(); maybeReload(); });
}

stage.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  if (document.activeElement?.matches('input, select') || filmFocused()) document.activeElement.blur();   // keys now act on the canvas, not the filmstrip
  const handle = e.target.closest('.handle');
  const target = topBox(e.target);
  if (paint && target && target !== editing && !handle) {   // paint format: apply to the clicked box
    e.preventDefault(); stopEdit();
    paintBox(target); sel = new Set([target]); drawOverlay(); commit();
    if (!paint.locked) endPaint();
    return;
  }
  if (handle?.classList.contains('rotate')) return startRotate(e);
  if (handle?.classList.contains('adjust')) return startAdjust(e, +handle.dataset.i);
  if (handle && 'crop' in handle.dataset) return startCrop(e, handle.dataset.dir);
  if (handle) return startResize(e, handle.dataset.dir);
  if (cropping && topBox(e.target) !== cropping) endCrop();
  const b = topBox(e.target);
  if (scope && !(b && b !== scope && scope.contains(b))) scope = null;   // a click outside the entered group leaves it
  if (editing) {
    if (b === editing) {   // let the browser place the caret / select text
      // An empty box (just the placeholder prompt) has no text to select, so pressing and dragging on it moves
      // it, as Slides; a plain click keeps the caret. Dragging near the edge moves a box with text too, but only in
      // its margin: over the text itself (a title's first letter sits a few px in) a drag selects.
      const g = aabb(b), p = toCanvas(e), edge = 14 / scale;
      const c = content(b), cr = c.getBoundingClientRect(), cs = getComputedStyle(c), k = cr.width / (c.offsetWidth || 1);
      const overText = e.clientX >= cr.left + parseFloat(cs.paddingLeft) * k - 2 && e.clientX <= cr.right - parseFloat(cs.paddingRight) * k + 2
        && e.clientY >= cr.top + parseFloat(cs.paddingTop) * k - 2 && e.clientY <= cr.bottom - parseFloat(cs.paddingBottom) * k + 2;
      const nearEdge = !overText && (p.x < g.x + edge || p.x > g.x + g.w - edge || p.y < g.y + edge || p.y > g.y + g.h - edge);
      if (!content(b).textContent.trim() || nearEdge) {
        e.preventDefault();
        sel = new Set([b]);
        const keep = b;
        startMove(e, () => { if (editing === keep) content(keep).focus(); });   // not moved: stay in edit mode with the caret
        return;
      }
      if (!e.target.closest('.content')) {   // empty part of the box: caret to the end, as Slides
        e.preventDefault();
        const r = document.createRange(); r.selectNodeContents(content(b)); r.collapse(false);
        getSelection().removeAllRanges(); getSelection().addRange(r);
      }
      return;
    }
    stopEdit();
  }
  if (b) {
    if (e.shiftKey) {
      sel.has(b) ? sel.delete(b) : sel.add(b);
      drawOverlay(); updateToolbar(); e.preventDefault();
      return;
    }
    if (!sel.has(b)) sel = new Set([b]);
    drawOverlay(); updateToolbar();
    startMove(e);
  } else {
    sel.clear(); drawOverlay(); updateToolbar();
    startMarquee(e);
  }
});
/* Thin outline on the box under the pointer, as Slides does for unselected boxes. */
const hoverEl = div('hover-box');
canvas.addEventListener('pointermove', e => {
  const b = busy ? null : topBox(e.target);
  if (!b || sel.has(b) || b === editing) { hoverEl.remove(); return; }
  place(hoverEl, geo(b)); hoverEl.style.transform = b.style.transform; hoverEl.style.scale = flipXY(b).join(' ');
  hoverEl.style.setProperty('--k', 1 / scale + 'px');
  guides.append(hoverEl);
});
canvas.addEventListener('pointerleave', () => hoverEl.remove());
canvas.addEventListener('pointerdown', () => hoverEl.remove());

const caretAt = (x, y) => {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  const p = document.caretPositionFromPoint?.(x, y);
  if (!p) return null;
  const r = document.createRange(); r.setStart(p.offsetNode, p.offset); return r;
};
canvas.addEventListener('dblclick', e => {
  const b = topBox(e.target);
  if (b && isLocked(b)) return;
  if (b && b.classList.contains('image')) { enterCrop(b); return; }   // double-click a picture: crop it, as Slides
  if (b && b.classList.contains('live')) { editLive(b); return; }   // a live box: its page
  if (b && isGroup(b)) {   // enter the group: the member under the pointer gets selected (Esc goes back out)
    scope = b; const m = topBox(e.target);
    if (m && m !== b) { sel = new Set([m]); drawOverlay(); updateToolbar(); }
    return;
  }
  if (b && b !== editing) startEdit(b, { x: e.clientX, y: e.clientY });
});
