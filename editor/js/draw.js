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
  if (drawing.pts) {   // Curve / Polyline: each click adds a point, a double-click ends
    const p = toCanvas(e), q = drawing.pts.at(-1);
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) * scale >= 6) drawing.pts.push(p);   // the second click of a double-click adds nothing
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
  svg.innerHTML = pts.length ? `<polyline points="${pts.map(p => p.x + ',' + p.y).join(' ')}" />` : '';
}
function finishPoints() {
  const d = drawing; if (!d?.pts) return;
  guides.querySelector('.draw-preview')?.remove(); disarmShape();
  finishPath(d.pts, d.shape === 'smooth');
}
