/* ---------- phone: touching the slide ---------- */
/* As the Slides app: a tap selects (square blue handles, a knob above for rotating) and, a moment later, shows the
   iOS edit menu (Cut | Copy | Paste | Delete) under the box; a tap on the selected box edits its text; a tap on
   nothing deselects. Dragging a box moves a grey outline of it, with red guides where it lines up, and the box jumps
   there on release; dragging a handle does the same for its size. Runs before pointer.js's handler on the stage
   and stops it; rotation, yellow adjust handles and text being edited keep the desktop's handling. */
/** The edit menu's actions on the selection (also the landscape side rail's ⋯, phone-edit.js). @returns {[string, () => any][]} */
const phoneClipActions = () => [['Cut', () => document.execCommand('cut')], ['Copy', () => document.execCommand('copy')],
  ['Paste', async () => {   // iOS asks the clipboard, then the editor's own paste takes it
    const text = await navigator.clipboard.readText().catch(() => ''); if (!text) return;
    const dt = new DataTransfer(); dt.setData('text/plain', text); dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt }));
  }],
  ['Delete', () => deleteSelection()]];
if (PHONE) (() => {
  const TAP = 8;   // screen px a finger may wander and still tap
  const root = document.documentElement;
  const ghostAt = g => { const gh = div('ph-ghost'); place(gh, g); gh.style.setProperty('--k', 1 / scale + 'px'); guides.append(gh); return gh; };
  let menuTimer = 0, menu = null;
  function closeMenu_() { clearTimeout(menuTimer); menu?.remove(); menu = null; }

  /* ---- two fingers: a pinch zooms about them (1× to 4× the fitted size) and moving them pans (r06, 17-zoom.png) ---- */
  const fingers = new Map();   // pointerId → where it is
  let pinch = null, pinches = 0;   // pinches: bumped when one starts, so a one-finger gesture under way gives up
  const fitScale = () => { const r = stage.getBoundingClientRect(); return Math.max(0.05, Math.min((r.width - 30) / W, (r.height - 30) / H)); };
  const zoomed = () => scale / fitScale();
  function zoomTo(z, mx, my, c) {   // z × the fitted size, with canvas point c kept under the screen point (mx, my)
    zoom = z <= 1.001 ? null : z * fitScale() * W / 960;
    fit();
    const f = frame.getBoundingClientRect();
    stage.scrollLeft += f.left + c.x * scale - mx; stage.scrollTop += f.top + c.y * scale - my;
  }
  const two = () => { const [a, b] = [...fingers.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  stage.addEventListener('pointerdown', e => {
    if (e.isPrimary) fingers.clear();   // a new gesture: forget any finger whose lift we missed
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (fingers.size !== 2 || !root.classList.contains('ph-edit')) return;
    e.stopImmediatePropagation(); e.preventDefault();
    pinches++; closeMenu_();
    const t = two(); pinch = { d0: t.d, z0: zoomed(), c: toCanvas({ clientX: t.x, clientY: t.y }) };
  }, true);
  addEventListener('pointermove', e => {
    const f = fingers.get(e.pointerId); if (!f || f.type !== e.pointerType) return;   // (a mouse's id can match a finger's)
    f.x = e.clientX; f.y = e.clientY;
    if (!pinch || fingers.size < 2) return;
    const t = two(); zoomTo(Math.max(1, Math.min(4, pinch.z0 * t.d / pinch.d0)), t.x, t.y, pinch.c);
  }, true);
  const lift = e => {
    fingers.delete(e.pointerId);
    if (pinch && fingers.size < 2) { pinch = null; if (zoomed() < 1.05) { zoom = null; fit(); } }
  };
  addEventListener('pointerup', lift, true); addEventListener('pointercancel', lift, true);

  stage.addEventListener('pointerdown', e => {
    if (!root.classList.contains('ph-edit') || e.button !== 0 || drawing) return;   // drawing a curve or scribble: draw.js
    const t = /** @type {Element} */ (e.target), handle = t.closest('.handle'), b = topBox(t);
    closeMenu_();
    if (handle && !handle.dataset.dir) return;   // the rotation knob, a yellow diamond: pointer.js
    if (!handle && editing && b === editing) return;   // the caret and text selection: the browser and pointer.js
    const one = sel.size === 1 ? [...sel][0] : null;
    if (handle && (!one || isLine(one) || rot(one) || 'crop' in handle.dataset || flipXY(one).join() !== '1,1')) return;   // turned, flipped, lines, groups of boxes: pointer.js
    e.stopImmediatePropagation();
    if (handle) return ghostResize(e, one, handle.dataset.dir);
    tapOrMove(e, b);
  }, true);

  /* ---- a tap, or a drag that moves the box's outline ---- */
  let lastTap = { b: null, t: 0 };
  function tapOrMove(e, b) {
    const p0 = toCanvas(e), x0 = e.clientX, y0 = e.clientY, was = !!b && sel.size === 1 && sel.has(b), gen = pinches;
    let moved = false, ghost = null, items = [], g0 = null, others = [], d = { x: 0, y: 0 }, last = { x: x0, y: y0 };
    drag(e, ev => {
      if (pinches !== gen) { if (ghost) { ghost.remove(); ghost = null; showGuides(); busy = false; } return; }   // a second finger: it's a pinch now
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < TAP) return;
      if (!b) {   // one finger on nothing pans a zoomed-in slide
        moved = true; stage.scrollLeft -= ev.clientX - last.x; stage.scrollTop -= ev.clientY - last.y; last = { x: ev.clientX, y: ev.clientY };
        return;
      }
      if (!moved) {
        moved = true; busy = true;
        if (editing && editing !== b) stopEdit();
        if (!sel.has(b)) { sel = new Set([b]); drawOverlay(); updateToolbar(); }
        items = [...sel]; g0 = bbox(items.map(aabb)); others = boxes().filter(o => !sel.has(o)).map(aabb);
        ghost = ghostAt(g0);
      }
      const p = toCanvas(ev), at = { ...g0, x: g0.x + p.x - p0.x, y: g0.y + p.y - p0.y }, s = snap(at, others);
      d = { x: at.x + s.dx - g0.x, y: at.y + s.dy - g0.y };
      place(ghost, { ...g0, x: g0.x + d.x, y: g0.y + d.y });
      showGuides(s.gx, s.gy, { ...g0, x: g0.x + d.x, y: g0.y + d.y }, s.ox, s.oy, others);
    }, ev => {
      if (pinches !== gen || (moved && !b)) return;
      if (moved) {   // the box jumps to where its outline was let go
        busy = false; ghost.remove(); showGuides();
        for (const it of items) { const g = geo(it); setGeo(it, { ...g, x: g.x + d.x, y: g.y + d.y }); if (isLine(it)) { delete it.dataset.from; delete it.dataset.to; } }
        followConnectors(); drawOverlay(); commit();
        return;
      }
      if (!b) { stopEdit(); if (sel.size) { sel.clear(); drawOverlay(); updateToolbar(); } return; }   // a tap on nothing
      const twice = lastTap.b === b && Date.now() - lastTap.t < 350; lastTap = { b, t: Date.now() };
      if ((was || twice) && !isMedia(b) && !isLine(b) && content(b) && !isGroup(b)) { closeMenu_(); startEdit(b, { x: ev.clientX, y: ev.clientY }); drawOverlay(); return; }   // a second tap, or a double tap, types
      if (editing) stopEdit();
      sel = new Set([b]); drawOverlay(); updateToolbar();
      menuTimer = window.setTimeout(() => showMenu(b), 450);
    });
  }

  /* ---- a handle: the outline takes the new size, the box follows on release; the edge snaps to guides ---- */
  function ghostResize(e, b, dir) {
    const g0 = geo(b), p0 = toCanvas(e), others = boxes().filter(o => o !== b).map(aabb), { xs, ys } = snapLines(others), min = 20;
    const keep = dir.length === 2 && (isMedia(b) || b.dataset.lock === 'aspect'), ratio = g0.w / (g0.h || 1);
    const ghost = ghostAt(g0);
    let g = g0;
    busy = true; ui.classList.add('ph-sizing'); ui.querySelector(`.handle[data-dir="${dir}"]`)?.classList.add('on');
    drag(e, ev => {
      const p = toCanvas(ev), th = SNAP_PX / scale, dx = p.x - p0.x, dy = p.y - p0.y;
      let x0 = g0.x, x1 = g0.x + g0.w, y0 = g0.y, y1 = g0.y + g0.h, gx = null, gy = null;
      const near = (lines, v) => { const c = lines.reduce((m, l) => Math.abs(l - v) < Math.abs(m - v) ? l : m, Infinity); return Math.abs(c - v) < th ? c : null; };
      if (dir.includes('e')) { x1 += dx; const c = near(xs, x1); if (c != null && !keep) x1 = gx = c; }
      if (dir.includes('w')) { x0 += dx; const c = near(xs, x0); if (c != null && !keep) x0 = gx = c; }
      if (dir.includes('s')) { y1 += dy; const c = near(ys, y1); if (c != null && !keep) y1 = gy = c; }
      if (dir.includes('n')) { y0 += dy; const c = near(ys, y0); if (c != null && !keep) y0 = gy = c; }
      let w = Math.max(min, x1 - x0), h = Math.max(min, y1 - y0);
      if (keep) { if (w / g0.w > h / g0.h) h = w / ratio; else w = h * ratio; }
      g = { ...g0, w, h, x: dir.includes('w') ? g0.x + g0.w - w : g0.x, y: dir.includes('n') ? g0.y + g0.h - h : g0.y };
      place(ghost, g); showGuides(gx, gy);
    }, () => {
      busy = false; ghost.remove(); showGuides(); ui.classList.remove('ph-sizing');
      if (g !== g0) { setGeo(b, g); if (!b.dataset.shape && !isMedia(b) && /[ns]/.test(dir)) b.dataset.minh = String(g.h); if (b.dataset.shape) renderShape(b); fitText(b); followConnectors(); commit(); }
      drawOverlay();
    });
  }

  /* ---- the iOS edit menu under the selected box (above it when there's no room), as 04-select-text-box.png ---- */
  function showMenu(b) {
    if (!sel.has(b) || editing) return;
    const r = (ui.querySelector('.sel-box') || b).getBoundingClientRect(), s = stage.getBoundingClientRect();
    menu = div('ph-editmenu');
    const item = (label, run) => { const x = document.createElement('button'); x.textContent = label; x.onclick = ev => { ev.stopPropagation(); closeMenu_(); run(); }; return x; };
    menu.append(...phoneClipActions().map(([label, run]) => item(label, run)));
    document.body.append(menu);
    const below = r.bottom + 31 + menu.offsetHeight < s.bottom;
    menu.style.left = Math.max(s.left + 8, Math.min(r.left + r.width / 2 - menu.offsetWidth / 2, s.right - menu.offsetWidth - 8)) + 'px';   // over the slide's area: clear of the side rails
    menu.style.top = (below ? r.bottom + 31 : Math.max(s.top + 8, r.top - 31 - menu.offsetHeight)) + 'px';
  }
  addEventListener('pointerdown', e => { if (menu && !menu.contains(/** @type {Node} */ (e.target))) closeMenu_(); }, true);
})();
