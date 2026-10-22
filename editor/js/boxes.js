/* ---------- creating boxes ---------- */

/** @param {{ x: any, y: any, w: any, h: any, shape?: string, html?: string, cls?: string }} o */
function makeBox({ x, y, w, h, shape, html = '', cls = '' }) {
  const b = div(('box ' + cls).trim());
  b.id = uid();
  if (shape) b.dataset.shape = shape;
  const c = div('content'); c.innerHTML = html; b.append(c);
  // Slides' default text insets: 0.1 in left / right, 0.05 in top / bottom (base.css keeps 16 / 8 px, so older decks don't move)
  if (!/\b(image|video)\b/.test(cls) && !/^(line|arrowline|elbow|curve|path)$/.test(shape || '')) c.style.padding = INSET;
  setGeo(b, { x, y, w, h });
  return b;
}
const INSET = "9.6px 19.2px";   // 0.05 in, 0.1 in at 192 px per inch
function insert(...bs) {
  slides[cur].append(...bs);
  sel = new Set(bs);
  drawOverlay(); commit();
}
function blankSlide(layout) {
  const s = document.createElement('section');
  s.dataset.backgroundColor = theme().bg;
  if (layout) applyLayout(s, layout);
  return s;
}
