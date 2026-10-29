/* Shape picker, as Slides: Shapes / Arrows / Callouts / Equation, each a grid of outline pictures. Picking one
   arms drawing: drag on the slide to size it (⇧ keeps it square), or click to drop a 1-inch one there. */
/** @type {any[]} */
const SHAPE_GROUPS = [
  ['Shapes', 'crop_square', [['rect', 'Rectangle'], ['roundrect', 'Rounded rectangle'], ['snip1rect', 'Snip single corner rectangle'], ['snip2samerect', 'Snip same side corner rectangle'], ['snip2diagrect', 'Snip diagonal corner rectangle'], ['sniproundrect', 'Snip and round single corner rectangle'], ['round1rect', 'Round single corner rectangle'], ['round2samerect', 'Round same side corner rectangle'], ['round2diagrect', 'Round diagonal corner rectangle'], '-',
    ['ellipse', 'Oval'], ['triangle', 'Triangle'], ['rttriangle', 'Right triangle'], ['parallelogram', 'Parallelogram'], ['trapezoid', 'Trapezoid'], ['diamond', 'Diamond'], ['pentagon', 'Regular pentagon'], ['hexagon', 'Hexagon'], ['heptagon', 'Heptagon'], ['octagon', 'Octagon'], ['decagon', 'Decagon'], ['dodecagon', 'Dodecagon'], ['pie', 'Pie'], ['arc', 'Arc'], ['teardrop', 'Teardrop'], ['chord', 'Chord'], ['frame', 'Frame'], ['halfframe', 'Half frame'], ['corner', 'L-shape'], ['diagstripe', 'Diagonal stripe'], ['cross', 'Cross'], ['plaque', 'Plaque'], ['can', 'Can'], ['cube', 'Cube'], ['bevel', 'Bevel'], ['donut', 'Donut'], ['nosmoking', '"No" symbol'], ['blockarc', 'Block arc'], ['foldedcorner', 'Folded corner'], ['smileyface', 'Smiley face'], ['heart', 'Heart'], ['lightningbolt', 'Lightning bolt'], ['sun', 'Sun'], ['moon', 'Moon'], ['cloud', 'Cloud'], '-',
    ['flow-process', 'Flowchart: process'], ['flow-alternateprocess', 'Flowchart: alternate process'], ['flow-decision', 'Flowchart: decision'], ['flow-inputoutput', 'Flowchart: data'], ['flow-predefinedprocess', 'Flowchart: predefined process'], ['flow-internalstorage', 'Flowchart: internal storage'], ['flow-document', 'Flowchart: document'], ['flow-multidocument', 'Flowchart: multidocument'], ['flow-terminator', 'Flowchart: terminator'], ['flow-preparation', 'Flowchart: preparation'], ['flow-manualinput', 'Flowchart: manual input'], ['flow-manualoperation', 'Flowchart: manual operation'], ['flow-connector', 'Flowchart: connector'], ['flow-offpageconnector', 'Flowchart: off-page connector'], ['flow-punchedcard', 'Flowchart: card'], ['flow-punchedtape', 'Flowchart: punched tape'], ['flow-summingjunction', 'Flowchart: summing junction'], ['flow-or', 'Flowchart: or'], ['flow-collate', 'Flowchart: collate'], ['flow-sort', 'Flowchart: sort'], ['flow-extract', 'Flowchart: extract'], ['flow-merge', 'Flowchart: merge'], ['flow-onlinestorage', 'Flowchart: stored data'], ['flow-delay', 'Flowchart: delay'], ['flow-magnetictape', 'Flowchart: sequential access storage'], ['flow-magneticdisk', 'Flowchart: magnetic disk'], ['flow-magneticdrum', 'Flowchart: direct access storage'], ['flow-display', 'Flowchart: display']]],
  ['Arrows', 'arrow_right_alt', [['arrow', 'Right arrow'], ['leftarrow', 'Left arrow'], ['uparrow', 'Up arrow'], ['downarrow', 'Down arrow'], ['leftrightarrow', 'Left-right arrow'],
    ['updownarrow', 'Up-down arrow'], ['quadarrow', 'Quad arrow'], ['leftrightuparrow', 'Left-right-up arrow'], ['bentarrow', 'Bent arrow'], ['uturnarrow', 'U-turn arrow'],
    ['leftuparrow', 'Left-up arrow'], ['bentuparrow', 'Bent-up arrow'], ['curvedarrow', 'Curved right arrow'], ['curvedleftarrow', 'Curved left arrow'], ['curveduparrow', 'Curved up arrow'],
    ['curveddownarrow', 'Curved down arrow'], ['stripedarrow', 'Striped right arrow'], ['notchedarrow', 'Notched right arrow'], ['homeplate', 'Pentagon'], ['chevron', 'Chevron'],
    ['rightarrowcallout', 'Right arrow callout'], ['downarrowcallout', 'Down arrow callout'], ['leftarrowcallout', 'Left arrow callout'], ['uparrowcallout', 'Up arrow callout'],
    ['leftrightarrowcallout', 'Left-right arrow callout'], ['quadarrowcallout', 'Quad arrow callout'], ['circulararrow', 'Circular arrow']]],
  ['Callouts', 'chat_bubble', [['explosion1', 'Explosion 1'], ['explosion2', 'Explosion 2'], ['star4', '4-point star'], ['star', '5-point star'], ['star6', '6-point star'], ['star7', '7-point star'],
    ['star8', '8-point star'], ['star10', '10-point star'], ['star12', '12-point star'], ['star16', '16-point star'], ['star24', '24-point star'], ['star32', '32-point star'],
    ['ribbonup', 'Up ribbon'], ['ribbon', 'Down ribbon'], ['curvedribbonup', 'Curved up ribbon'], ['curvedribbon', 'Curved down ribbon'], ['vscroll', 'Vertical scroll'], ['hscroll', 'Horizontal scroll'],
    ['wave', 'Wave'], ['doublewave', 'Double wave'], '-',
    ['callout', 'Rectangular callout'], ['roundcallout', 'Rounded rectangular callout'], ['ovalcallout', 'Oval callout'], ['cloudcallout', 'Cloud callout']]],
  ['Equation', 'add', [['plus', 'Plus'], ['minus', 'Minus'], ['multiply', 'Multiply'], ['divide', 'Division'], ['equal', 'Equal'], ['notequal', 'Not equal'], ['brackets', 'Double bracket'], ['braces', 'Double brace'], ['leftbracket', 'Left bracket'], ['rightbracket', 'Right bracket'], ['leftbrace', 'Left brace'], ['rightbrace', 'Right brace']]],
];
const shapePic = (shape, extra = {}) => {
  const b = div('box'); b.dataset.shape = shape; Object.assign(b.dataset, extra.data || {});
  const [pw, ph] = /^(arrow|leftarrow|leftrightarrow|stripedarrow|notchedarrow|homeplate|chevron)$/.test(shape) ? [20, 14] : /^(uparrow|downarrow|updownarrow)$/.test(shape) ? [14, 20] : /^(left|right)(bracket|brace)$/.test(shape) ? [7, 20] : [20, 18];
  b.style.cssText = `width:${pw}px;height:${ph}px;--fill:transparent;--stroke:#1f1f1f;--sw:1.3px`;
  renderShape(b); const svg = b.querySelector('svg');
  const t = [extra.rot ? `rotate(${extra.rot} 10 10)` : '', extra.data?.flip ? 'translate(20 0) scale(-1 1)' : ''].join(' ');
  svg.setAttribute('viewBox', `${pw / 2 - 12} ${ph / 2 - 13} 24 26`); svg.setAttribute('width', '22'); svg.setAttribute('height', '22');
  if (t.trim()) svg.innerHTML = `<g transform="${t}">${svg.innerHTML}</g>`;
  return svg.outerHTML.replace('class="shape"', 'class="shape-pic"');
};
const shapeItems = () => SHAPE_GROUPS.map(([label, icon, list]) => ({ label, icon, items: () => list.map(it => it === '-' ? it : (([v, l, extra]) => ({ label: l, cell: true, svg: shapePic(v, extra), run: () => armShape(v, extra) }))(it)) }));
let drawing = null;   // the shape waiting to be drawn
function armShape(shape, extra) { stopEdit(); drawing = { shape, extra, pts: POINT_TOOLS.includes(shape) ? [] : null }; document.body.classList.add('drawing'); setStatus('Click or drag on the slide to draw'); }
function disarmShape() { drawing = null; document.body.classList.remove('drawing'); setStatus(''); }
stage.addEventListener('pointerdown', e => {
  if (!drawing || e.button !== 0) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (drawing.pts) {   // Curve / Polyline: each click adds a point, a double-click ends; as Keynote's Pen, dragging pulls out
    const p = toCanvas(e), q = drawing.pts.at(-1), first = drawing.pts[0];   // that point's curve handles, and a click on the first point closes the shape
    if (first && drawing.pts.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) * scale < 8) { drawing.closed = true; finishPoints(); return; }
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) * scale >= 6) {   // the second click of a double-click adds nothing
      const pt = { x: p.x, y: p.y }; drawing.pts.push(pt);
      drag(e, ev => { const c = toCanvas(ev); if (Math.hypot(c.x - pt.x, c.y - pt.y) * scale < 4) return; pt.out = c; pt.in = { x: 2 * pt.x - c.x, y: 2 * pt.y - c.y }; drawPreview(drawing.pts); }, () => {});
    }
    drawPreview(drawing.pts); return;
  }
  const { shape, extra } = drawing, p0 = toCanvas(e); disarmShape();
  if (shape === 'scribble') {   // freehand: every pointer move, thinned to 3 screen px
    const pts = [p0]; busy = true;
    drag(e, ev => { const p = toCanvas(ev), q = pts.at(-1); if (Math.hypot(p.x - q.x, p.y - q.y) * scale >= 3) { pts.push(p); drawPreview(pts); } },
      () => { busy = false; guides.querySelector('.draw-preview')?.remove(); finishPath(pts, true); });
    return;
  }
  if (isLine({ dataset: { shape } })) {   // a line or connector, from where the drag starts to where it ends; ends snap to connection points
    const s0 = snapAnchor(p0), P = { ...(s0 ? s0.q : p0), mark: 'none', at: s0?.ref || '' }, mark = shape === 'arrowline' ? 'fill-arrow' : 'none';
    const b = addShape(shape, { x: P.x, y: P.y, w: PX_IN, h: 0 });
    busy = true;
    drag(e, ev => {
      let p = toCanvas(ev);
      if (ev.shiftKey) { const a = Math.round(Math.atan2(p.y - P.y, p.x - P.x) / (Math.PI / 4)) * Math.PI / 4, r = Math.hypot(p.x - P.x, p.y - P.y); p = { x: P.x + Math.cos(a) * r, y: P.y + Math.sin(a) * r }; }
      const sn = ev.metaKey ? null : snapAnchor(p, b);
      setLineEnds(b, P, { ...(sn ? sn.q : p), mark, at: sn?.ref || '' }); drawOverlay();
    }, () => { busy = false; guides.querySelectorAll('.conn').forEach(e => e.remove()); drawOverlay(); commit(); });
    return;
  }
  const b = addShape(shape, { x: p0.x, y: p0.y, w: 1, h: 1 }, extra), k = 1 / scale;
  let moved = false;
  busy = true;
  drag(e, ev => {
    const p = toCanvas(ev); let w = p.x - p0.x, h = p.y - p0.y;
    if (!moved && Math.hypot(w, h) < 4 * k) return;
    moved = true;
    if (ev.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
    setGeo(b, { x: Math.min(p0.x, p0.x + w), y: Math.min(p0.y, p0.y + h), w: Math.abs(w), h: Math.abs(h) }); drawOverlay();
  }, () => { busy = false; if (!moved) setGeo(b, { x: p0.x, y: p0.y, w: PX_IN, h: PX_IN }); drawOverlay(); commit(); });
}, true);
addEventListener('keydown', e => {
  if (!drawing || (e.key !== 'Escape' && e.key !== 'Enter')) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (drawing.pts?.length >= 2) finishPoints(); else { guides.querySelector('.draw-preview')?.remove(); disarmShape(); }
}, true);
stage.addEventListener('pointermove', e => { if (drawing?.pts?.length) drawPreview([...drawing.pts, toCanvas(e)]); });
stage.addEventListener('dblclick', e => { if (drawing?.pts) { e.stopImmediatePropagation(); finishPoints(); } }, true);   // a double-click ends a Curve / Polyline
/* Line tool, as Slides: every kind is drawn on the slide. Line / Arrow / connectors: drag from one end to the other
   (a click makes a 1-inch line). Curve and Polyline: click each point, double-click or Enter to finish. Scribble: drag. */
const lineItems = () => [['line', 'Line', 'pen_size_2'], ['arrowline', 'Arrow', 'arrow_right_alt'], ['elbow', 'Elbow Connector', 'turn_right'], ['curve', 'Curved Connector', 'conversion_path'],
  ['smooth', 'Curve', 'gesture'], ['polyline', 'Polyline', 'polyline'], ['scribble', 'Scribble', 'draw']].map(([v, label, icon]) => ({ label, icon, run: () => armShape(v) }));
const POINT_TOOLS = ['smooth', 'polyline'];
/* Points (canvas px) → a box with data-path in its own 0..1 units; smooth turns the points into a Catmull-Rom curve. */
function finishPath(pts, smooth) {
  if (pts.length < 2) return;
  const g = bbox(pts.map(p => ({ x: p.x, y: p.y, w: 0, h: 0 }))); g.w = Math.max(g.w, 1); g.h = Math.max(g.h, 1);
  const u = p => `${Math.round((p.x - g.x) / g.w * 1000) / 1000},${Math.round((p.y - g.y) / g.h * 1000) / 1000}`;
  let d = 'M' + u(pts[0]);
  for (let i = 1; i < pts.length; i++) {
    if (!smooth) { d += ' L' + u(pts[i]); continue; }
    const p0 = pts[i - 2] || pts[i - 1], p1 = pts[i - 1], p2 = pts[i], p3 = pts[i + 1] || p2;
    d += ` C${u({ x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 })} ${u({ x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 })} ${u(p2)}`;
  }
  const b = addShape('path', g); b.dataset.path = d; renderShape(b); drawOverlay(); commit();
}
function drawPreview(pts, smooth) {   // the path being drawn, in canvas units
  let svg = guides.querySelector('.draw-preview');
  if (!svg) { svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'draw-preview'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); guides.append(svg); }
  svg.innerHTML = !pts.length ? '' : pts.some(p => p.in || p.out) ? `<path d="${pathString({ nodes: pts, closed: false })}" />` : `<polyline points="${pts.map(p => p.x + ',' + p.y).join(' ')}" />`;
}
function finishPoints() {
  const d = drawing; if (!d?.pts) return;
  guides.querySelector('.draw-preview')?.remove(); disarmShape();
  if (d.closed || d.pts.some(p => p.in || p.out)) finishNodes(d.pts, !!d.closed);
  else finishPath(d.pts, d.shape === 'smooth');
}
/* A Pen path with handles (or closed): its points and handles as drawn, in 0..1 units of their bounds. */
function finishNodes(pts, closed) {
  if (pts.length < 2) return;
  const all = pts.flatMap(n => [n, n.in, n.out].filter(Boolean)), g = bbox(all.map(p => ({ x: p.x, y: p.y, w: 0, h: 0 }))); g.w = Math.max(g.w, 1); g.h = Math.max(g.h, 1);
  const u = q => q && { x: (q.x - g.x) / g.w, y: (q.y - g.y) / g.h };
  const nodes = pts.map(n => Object.assign({ ...u(n) }, n.in ? { in: u(n.in) } : {}, n.out ? { out: u(n.out) } : {}));
  if (nodes[0].in && !closed) delete nodes[0].in;
  const b = addShape('path', g); b.dataset.path = pathString({ nodes, closed }); if (closed) b.style.setProperty('--fill', '#4a86e8');
  renderShape(b); drawOverlay(); updateToolbar(); commit();
}

/* Point editing (Keynote's Edit Points): double-click a drawn path, or right-click → Edit points. Its anchors (squares)
   and curve handles (dots) show in the box's own frame: drag either; double-click an anchor to make it smooth or a corner;
   click the path to add an anchor; ⌫ removes the picked one; Esc or a click elsewhere ends. Right-click → Close path joins
   the ends into a filled shape (a trailing Z in data-path), Open path splits it again. */
let pointEdit = null, ptPick = -1;
function parsePath(d) {
  /** @typedef {{x: number, y: number}} Pt */ /** @type {(Pt & {in?: Pt, out?: Pt})[]} */ const nodes = []; const nums = s => s.trim().split(/[\s,]+/).map(Number); let closed = false;
  for (const [, cmd, args] of d.matchAll(/([MLCZmlcz])([^MLCZmlcz]*)/g)) {
    const v = nums(args);
    if (/[Zz]/.test(cmd)) { closed = true; continue; }
    if (/[ML]/i.test(cmd)) for (let i = 0; i + 1 < v.length; i += 2) nodes.push({ x: v[i], y: v[i + 1] });
    if (/C/i.test(cmd)) for (let i = 0; i + 5 < v.length; i += 6) {   // a control point sitting on its anchor is no handle (pathString writes one for a corner)
      const a = nodes.at(-1), n = { x: v[i + 4], y: v[i + 5] };
      if (a && (v[i] !== a.x || v[i + 1] !== a.y)) a.out = { x: v[i], y: v[i + 1] };
      nodes.push(v[i + 2] !== n.x || v[i + 3] !== n.y ? { ...n, in: { x: v[i + 2], y: v[i + 3] } } : n);
    }
  }
  if (closed && nodes.length > 2 && nodes.at(-1).x === nodes[0].x && nodes.at(-1).y === nodes[0].y) { const z = nodes.pop(); if (z.in) nodes[0].in = z.in; }   // the curved closing side's end is the first point
  return { nodes, closed };
}
function pathString({ nodes, closed }) {
  const r = v => Math.round(v * 1000) / 1000, p = q => `${r(q.x)},${r(q.y)}`;
  let d = 'M' + p(nodes[0]);
  for (let i = 1; i < nodes.length; i++) { const a = nodes[i - 1], n = nodes[i]; d += a.out || n.in ? ` C${p(a.out || a)} ${p(n.in || n)} ${p(n)}` : ` L${p(n)}`; }
  if (closed) { const a = nodes.at(-1), n = nodes[0]; if (a.out || n.in) d += ` C${p(a.out || a)} ${p(n.in || n)} ${p(n)}`; }   // a curved closing side
  return d + (closed ? ' Z' : '');
}
const isPath = b => b?.dataset.shape === 'path';
function enterPointEdit(b) { if (!isPath(b) || isLocked(b)) return; stopEdit(); pointEdit = b; ptPick = -1; sel = new Set([b]); drawOverlay(); updateToolbar(); }
function endPointEdit() { if (!pointEdit) return; pointEdit = null; ptPick = -1; drawOverlay(); }
const toLocal = (b, ev) => {   // a pointer in the box's own frame (rotation and flips undone), in px
  const g = geo(b), t = rot(b) * Math.PI / 180, [fx, fy] = flipXY(b), p = toCanvas(ev), dx = p.x - (g.x + g.w / 2), dy = p.y - (g.y + g.h / 2);
  return { x: fx * (dx * Math.cos(t) + dy * Math.sin(t)) + g.w / 2, y: fy * (-dx * Math.sin(t) + dy * Math.cos(t)) + g.h / 2 };
};
function drawPoints(wrap, b, g, k) {   // render.js drawOverlay: the anchors and handles of the path being edited
  const P = parsePath(b.dataset.path || ''), at = q => ({ x: q.x * g.w, y: q.y * g.h }), s = 9 * k;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'pt-lines');
  P.nodes.forEach((n, i) => {
    for (const side of ['in', 'out']) if (n[side]) {
      const a = at(n), c = at(n[side]); svg.insertAdjacentHTML('beforeend', `<line x1="${a.x}" y1="${a.y}" x2="${c.x}" y2="${c.y}" stroke-width="${k}"/>`);
      const h = div('handle ctl'); h.dataset.i = String(i); h.dataset.side = side; h.style.cssText = `left:${c.x - s / 2.6}px;top:${c.y - s / 2.6}px;width:${s / 1.3}px;height:${s / 1.3}px;--k:${k}px`; wrap.append(h);
    }
    const a = at(n), h = div('handle pt' + (i === ptPick ? ' on' : '')); h.dataset.i = String(i);
    h.style.cssText = `left:${a.x - s / 2}px;top:${a.y - s / 2}px;width:${s}px;height:${s}px;--k:${k}px`; h.title = 'Drag; double-click: smooth / corner'; wrap.append(h);
  });
  wrap.prepend(svg);
}
function startPoint(e, h) {
  const b = pointEdit, i = +h.dataset.i, side = h.dataset.side, g = geo(b), P = parsePath(b.dataset.path), n = P.nodes[i];
  if (!side) ptPick = i;
  const o = { x: n.x, y: n.y, in: n.in && { ...n.in }, out: n.out && { ...n.out } };
  busy = true;
  drag(e, ev => {
    const l = toLocal(b, ev), u = { x: l.x / g.w, y: l.y / g.h };
    if (side) { n[side] = u; const other = side === 'in' ? 'out' : 'in'; if (n[other] && !ev.altKey) n[other] = { x: 2 * n.x - u.x, y: 2 * n.y - u.y }; }   // smooth: the other handle mirrors (⌥ breaks it)
    else { const dx = u.x - o.x, dy = u.y - o.y; n.x = u.x; n.y = u.y; if (o.in) n.in = { x: o.in.x + dx, y: o.in.y + dy }; if (o.out) n.out = { x: o.out.x + dx, y: o.out.y + dy }; }
    b.dataset.path = pathString(P); renderShape(b); drawOverlay();
  }, () => { busy = false; refitPath(b); commit(); });
}
function refitPath(b) {   // after an edit, the box hugs the path again (unrotated boxes; a rotated one keeps its frame)
  if (rot(b)) return;
  const P = parsePath(b.dataset.path), g = geo(b), xs = P.nodes.flatMap(n => [n, n.in, n.out].filter(Boolean)).map(q => q.x), ys = P.nodes.flatMap(n => [n, n.in, n.out].filter(Boolean)).map(q => q.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), w = Math.max(1e-3, x1 - x0), h = Math.max(1e-3, y1 - y0);
  if (Math.abs(x0) < 1e-3 && Math.abs(y0) < 1e-3 && Math.abs(x1 - 1) < 1e-3 && Math.abs(y1 - 1) < 1e-3) return;
  const m = q => q && { x: (q.x - x0) / w, y: (q.y - y0) / h };
  P.nodes.forEach(n => { const a = m(n); n.x = a.x; n.y = a.y; n.in = m(n.in); n.out = m(n.out); if (!n.in) delete n.in; if (!n.out) delete n.out; });
  setGeo(b, { x: g.x + x0 * g.w, y: g.y + y0 * g.h, w: Math.max(1, w * g.w), h: Math.max(1, h * g.h) }); b.dataset.path = pathString(P); renderShape(b); drawOverlay();
}
function togglePointSmooth(i) {
  const b = pointEdit, P = parsePath(b.dataset.path), n = P.nodes[i], a = P.nodes[i - 1] || (P.closed && P.nodes.at(-1)), z = P.nodes[i + 1] || (P.closed && P.nodes[0]);
  if (n.in || n.out) { delete n.in; delete n.out; }
  else { const dx = ((z || n).x - (a || n).x) / 6, dy = ((z || n).y - (a || n).y) / 6; if (i > 0) n.in = { x: n.x - dx, y: n.y - dy }; if (i < P.nodes.length - 1) n.out = { x: n.x + dx, y: n.y + dy }; }
  b.dataset.path = pathString(P); renderShape(b); refitPath(b); drawOverlay(); commit();
}
function addPointAt(ev) {   // a click on the path: a new anchor on the nearest segment
  const b = pointEdit, P = parsePath(b.dataset.path), g = geo(b), l = toLocal(b, ev), u = { x: l.x / g.w, y: l.y / g.h };
  let best = 1, bd = Infinity;
  for (let i = 1; i < P.nodes.length; i++) { const a = P.nodes[i - 1], c = P.nodes[i], vx = c.x - a.x, vy = c.y - a.y, t = Math.max(0, Math.min(1, ((u.x - a.x) * vx + (u.y - a.y) * vy) / (vx * vx + vy * vy || 1)));
    const d = Math.hypot(a.x + t * vx - u.x, a.y + t * vy - u.y); if (d < bd) { bd = d; best = i; } }
  P.nodes.splice(best, 0, { x: u.x, y: u.y }); ptPick = best; b.dataset.path = pathString(P); renderShape(b); drawOverlay(); commit();
}
function deletePoint() {
  const b = pointEdit, P = parsePath(b.dataset.path); if (ptPick < 0 || P.nodes.length <= 2) return;
  P.nodes.splice(ptPick, 1); ptPick = -1; b.dataset.path = pathString(P); renderShape(b); refitPath(b); drawOverlay(); commit();
}
function setPathClosed(b, on) { const P = parsePath(b.dataset.path); P.closed = on; b.dataset.path = pathString(P); if (on && !b.style.getPropertyValue('--fill')) b.style.setProperty('--fill', '#4a86e8'); renderShape(b); drawOverlay(); updateToolbar(); commit(); }

/* An SVG arc (rx ry rotation large sweep x y, from p0) as cubic Béziers of at most 90° each: [[c1, c2, end], …]. */
function arcCubics(p0, [rx, ry, rotDeg, large, sweep, x, y]) {
  if (!rx || !ry) return [[p0, { x, y }, { x, y }]];
  const phi = rotDeg * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi), dx = (p0.x - x) / 2, dy = (p0.y - y) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy, l = x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry);
  if (l > 1) { rx *= Math.sqrt(l); ry *= Math.sqrt(l); }
  const s = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1) / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cx1 = s * rx * y1 / ry, cy1 = -s * ry * x1 / rx, cx = cos * cx1 - sin * cy1 + (p0.x + x) / 2, cy = sin * cx1 + cos * cy1 + (p0.y + y) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry); let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9), h = dt / n, k = 4 / 3 * Math.tan(h / 4), out = [];
  const pt = (a, r = 1) => ({ x: cx + rx * r * Math.cos(a) * cos - ry * r * Math.sin(a) * sin, y: cy + rx * r * Math.cos(a) * sin + ry * r * Math.sin(a) * cos });
  const d = a => ({ x: -rx * Math.sin(a) * cos - ry * Math.cos(a) * sin, y: -rx * Math.sin(a) * sin + ry * Math.cos(a) * cos });   // the tangent
  for (let i = 0; i < n; i++) { const a = t1 + i * h, b = a + h, A = pt(a), B = pt(b), da = d(a), db = d(b);
    out.push([{ x: A.x + k * da.x, y: A.y + k * da.y }, { x: B.x - k * db.x, y: B.y - k * db.y }, i === n - 1 ? { x, y } : B]); }
  return out;
}
/* Make editable (Keynote's Format → Shapes and Lines → Make Editable): a preset shape becomes a closed path with the
   same outline (its first outline; arcs and curves become Bézier handles), then Edit points. */
function makeEditable(b) {
  const svg = b.querySelector(':scope > svg.shape'), f = svg && [...svg.querySelectorAll('.f')].find(e => /** @type {SVGElement} */ (e).style.fill !== 'none'); if (!f) return;
  const w = parseFloat(b.style.width) || 1, h = parseFloat(b.style.height) || 1; /** @type {any[]} */ const nodes = [];
  if (f.tagName === 'rect') nodes.push({ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h });
  else if (f.tagName === 'polygon') f.getAttribute('points').trim().split(/\s+/).forEach(s => { const [x, y] = s.split(',').map(Number); nodes.push({ x, y }); });
  else if (f.tagName === 'ellipse') { const cx = +f.getAttribute('cx'), cy = +f.getAttribute('cy'), rx = +f.getAttribute('rx'), ry = +f.getAttribute('ry'), k = 0.5523;
    nodes.push({ x: cx, y: cy - ry, in: { x: cx - rx * k, y: cy - ry }, out: { x: cx + rx * k, y: cy - ry } }, { x: cx + rx, y: cy, in: { x: cx + rx, y: cy - ry * k }, out: { x: cx + rx, y: cy + ry * k } },
      { x: cx, y: cy + ry, in: { x: cx + rx * k, y: cy + ry }, out: { x: cx - rx * k, y: cy + ry } }, { x: cx - rx, y: cy, in: { x: cx - rx, y: cy + ry * k }, out: { x: cx - rx, y: cy - ry * k } }); }
  else {
    const d = f.getAttribute('d') || '';
    let started = false;
    for (const [, cmd, args] of d.matchAll(/([MLQCAZ])([^MLQCAZ]*)/g)) {
      const v = args.trim().split(/[\s,]+/).filter(Boolean).map(Number), last = /** @type {any} */ (nodes.at(-1));
      if (cmd === 'M') { if (started) break; started = true; nodes.push({ x: v[0], y: v[1] }); }
      else if (cmd === 'L') nodes.push({ x: v[0], y: v[1] });
      else if (cmd === 'C') { last.out = { x: v[0], y: v[1] }; nodes.push({ x: v[4], y: v[5], in: { x: v[2], y: v[3] } }); }
      else if (cmd === 'Q') { last.out = { x: last.x + 2 / 3 * (v[0] - last.x), y: last.y + 2 / 3 * (v[1] - last.y) }; nodes.push({ x: v[2], y: v[3], in: { x: v[2] + 2 / 3 * (v[0] - v[2]), y: v[3] + 2 / 3 * (v[1] - v[3]) } }); }
      else if (cmd === 'A') for (const [c1, c2, e] of arcCubics(last, v)) { nodes.at(-1).out = c1; nodes.push({ ...e, in: c2 }); }
    }
    if (nodes.length > 1 && Math.hypot(nodes.at(-1).x - nodes[0].x, nodes.at(-1).y - nodes[0].y) < 0.5) { const z = nodes.pop(); if (z.in) nodes[0].in = z.in; }   // the closing point repeats the first
  }
  if (nodes.length < 2) return;
  const un = q => q && { x: Math.round(q.x / w * 1000) / 1000, y: Math.round(q.y / h * 1000) / 1000 };
  const P = { nodes: nodes.map(n => Object.assign(un(n), n.in ? { in: un(n.in) } : {}, n.out ? { out: un(n.out) } : {})), closed: true };
  for (const k of Object.keys(b.dataset)) if (/^adj/.test(k)) delete b.dataset[k];
  if (!b.style.getPropertyValue('--fill')) b.style.setProperty('--fill', getComputedStyle(f).fill);
  b.dataset.shape = 'path'; b.dataset.path = pathString(P); renderShape(b); commit(); enterPointEdit(b);
}
