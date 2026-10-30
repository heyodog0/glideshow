/* The Thermal look's shorter toolbar: each control lives in one place and the toolbar shows only what fits the selection.
   Inserting stays in the insert bar at the bottom, so the toolbar's copies of it go; Print and Paint format move to the menus;
   related controls fold behind one ▾ button each (text style, paragraph, border). The controls themselves are the toolbar's
   own buttons moved into small trays, so their ids, handlers, menus and shortcuts are unchanged. Only with ?look=thermal. */
const GROUPED = document.documentElement.dataset.look === 'thermal';
let openTray = null;
function closeTray() { openTray?.tray.classList.remove('open'); openTray?.btn.classList.remove('open'); openTray = null; }
/** @param {string} id @param {string} icon @param {string} tip @param {string[]} ids @param {{ bar?: boolean }} [opts] */
function makeTray(id, icon, tip, ids, { bar = false } = {}) {
  const btn = document.createElement('button');
  btn.id = id; btn.className = 'tray-btn'; btn.dataset.tip = tip;
  btn.innerHTML = bar ? `<span class="sw"><span class="icon">${icon}</span><i class="bar"></i></span><span class="icon caret">arrow_drop_down</span>`
    : `<span class="icon glyph">${icon}</span><span class="icon caret">arrow_drop_down</span>`;
  const tray = div('tray'); tray.id = id + '-tray';
  ids.forEach(i => { const el = $(i); if (el) { const input = el.nextElementSibling?.classList.contains('color-input') ? el.nextElementSibling : null; tray.append(el); if (input) tray.append(input); } });
  btn.onclick = () => {
    if (openTray?.btn === btn) return closeTray();
    closeTray(); closeMenu();
    const r = btn.getBoundingClientRect();
    tray.classList.add('open'); btn.classList.add('open'); openTray = { btn, tray };
    tray.style.left = Math.max(8, Math.min(r.left, innerWidth - tray.offsetWidth - 8)) + 'px'; tray.style.top = r.bottom + 6 + 'px';
  };
  return { btn, tray };
}
if (GROUPED) {
  document.documentElement.classList.add('tb-grouped');
  const g = i => $(`#ed-toolbar > .grp[data-i="${i}"]`);
  // text style: underline, text color, highlight, clear formatting; paragraph: align, spacing, lists, indent; border: color, weight, dash
  const style = makeTray('ed-textstyle', 'format_color_text', 'Text style', ['#ed-underline', '.swatch[data-for=color]', '.swatch[data-for=hilite]', '#ed-clear-fmt'], { bar: true });
  const para = makeTray('ed-para', 'format_align_left', 'Paragraph', ['#ed-align', '#ed-lh', '#ed-ul', '#ed-ol', '#ed-indent-less', '#ed-indent-more']);
  const border = makeTray('ed-border', 'border_color', 'Border', ['.swatch[data-for=stroke]', '#ed-sw', '#ed-dash'], { bar: true });
  const ends = makeTray('ed-ends', 'arrow_right_alt', 'Arrowheads', ['#ed-lstart', '#ed-lend']);
  ends.btn.classList.add('line-only');
  $('#ed-italic').after(style.btn, para.btn);
  $('.swatch[data-for=fill]').nextElementSibling.after(border.btn, ends.btn);
  // the trays sit in the toolbar (so its button styles apply), shown as small cards under their button
  [style, para, border, ends].forEach(t => $('#ed-toolbar').append(t.tray));
  // Format options as an icon; Replace image shorter; Animate is Insert → Animation
  const fo = $('#ed-format-options'); fo.classList.remove('text'); fo.innerHTML = '<span class="icon">tune</span>';
  $('#ed-replace-image').textContent = 'Replace';
  g(5).prepend($('#ed-crop')); $('#ed-crop').after($('#ed-mask'));
  FORMAT_MENU.push('-', /** @type {any} */ ({ label: 'Paint format', icon: 'format_paint', run: () => $('#ed-paint-format').click() }));
  addEventListener('pointerdown', e => {
    if (openTray && ![openTray.tray, openTray.btn, openMenuEl, ...subMenus].some(el => el?.contains(e.target))) closeTray();
  }, true);
  addEventListener('keydown', e => { if (e.key === 'Escape' && openTray && !openMenuEl) closeTray(); }, true);
  addEventListener('resize', closeTray);
  // the ▾ buttons show what's inside: the text and border colors, the alignment
  const sync = () => {
    style.btn.querySelector('.bar').style.background = $('#ed-color').value;
    border.btn.querySelector('.bar').style.background = $('#ed-stroke').value;
    para.btn.querySelector('.glyph').textContent = $('#ed-align .icon').textContent;
  };
  const paintBars0 = paintBars; window['paintBars'] = () => { paintBars0(); sync(); };
  let lastSel = '';
  const updateToolbar0 = updateToolbar; window['updateToolbar'] = () => {
    updateToolbar0();
    const key = [...sel].map(x => x.id).join(); if (key !== lastSel) closeTray(); lastSel = key;   // a tray stays open while its selection does
    // a plain text box (no shape) shows fill and border only once it has one; shapes always do
    const b = [...sel][0], plain = !!b && [...sel].every(x => !x.dataset.shape && !x.classList.contains('image') && !isStroke(x) && !isGroup(x)
      && !/\S/.test((x.style.getPropertyValue('--fill') + x.style.getPropertyValue('--stroke')).replace(/transparent|none/g, '')));
    document.body.classList.toggle('sel-plaintext', plain);
    sync();
  };
  sync();
}

/* View → Floating toolbar (this look only, remembered in this browser): the toolbar becomes a small bar over the selection,
   above it, or below it when there's no room; with nothing selected there's none. The menu bar folds into Menus (click to
   browse File, Edit, …, type to search, ⌥/), and Menus, undo, redo and zoom move to the top row. ⌥/ and every shortcut stay. */
const FLOAT_KEY = 'glideshow-toolbar';
const floatOn = () => document.documentElement.classList.contains('tb-float');
function placeFloat() {
  const bar = $('#ed-toolbar');
  if (!floatOn()) { bar.style.left = bar.style.top = ''; bar.classList.remove('shown'); return; }
  const rs = [...document.querySelectorAll('.sel-box:not(.scope)')].map(e => e.getBoundingClientRect()).filter(r => r.width || r.height);
  if (!sel.size || !rs.length || document.body.classList.contains('tb-moving')) { bar.classList.remove('shown'); closeTray(); return; }
  const r = { left: Math.min(...rs.map(x => x.left)), right: Math.max(...rs.map(x => x.right)), top: Math.min(...rs.map(x => x.top)), bottom: Math.max(...rs.map(x => x.bottom)) };
  const st = $('#ed-stage').getBoundingClientRect(), knob = sel.size === 1 && !editing && !isLine([...sel][0]) ? 26 : 0, gap = 10;   // clear of the rotation knob
  bar.classList.add('shown');
  const ruler = $('#ed-ruler-h').getBoundingClientRect(), top = Math.max(st.top, ruler.height ? ruler.bottom : 0);   // the bar never covers the ruler
  const w = bar.offsetWidth, h = bar.offsetHeight, above = r.top - knob - gap - h >= top + 4;
  bar.classList.toggle('below', !above);
  bar.style.left = Math.max(st.left + 8, Math.min((r.left + r.right) / 2 - w / 2, st.right - w - 8)) + 'px';
  bar.style.top = Math.max(top + 4, Math.min(above ? r.top - knob - gap - h : r.bottom + gap, st.bottom - h - 8)) + 'px';
}
function setFloat(on) {
  document.documentElement.classList.toggle('tb-float', on);
  try { on ? localStorage.setItem(FLOAT_KEY, 'float') : localStorage.removeItem(FLOAT_KEY); } catch {}
  closeTray(); closeMenu();
  if (on) $('#ed-deckrow').append($('#ed-menus'), $('#ed-undo'), $('#ed-redo'), $('#ed-zoom'));
  else { $('#ed-toolbar').prepend($('#ed-menus')); $('#ed-print').before($('#ed-undo'), $('#ed-redo')); $('#ed-paint-format').after($('#ed-zoom')); }
  layoutToolbar(); placeFloat();
}
if (GROUPED) {
  const row = div('deckrow'); row.id = 'ed-deckrow'; $('#ed-comments-btn').before(row);
  MENUS.View.push('-', { label: 'Floating toolbar', icon: 'web_asset', on: floatOn, run: () => setFloat(!floatOn()) });
  const drawOverlay0 = drawOverlay; window['drawOverlay'] = () => { drawOverlay0(); placeFloat(); };
  const updateToolbar1 = updateToolbar; window['updateToolbar'] = () => { updateToolbar1(); placeFloat(); };
  $('#ed-stage').addEventListener('scroll', placeFloat, { passive: true }); addEventListener('resize', placeFloat);
  // while a box is dragged or resized the bar steps aside, and comes back where the box lands
  $('#ed-stage').addEventListener('pointerdown', e => { if (floatOn() && e.button === 0 && e.target.closest('.box, .sel-wrap, .handle')) document.body.classList.add('tb-moving'); }, true);
  addEventListener('pointerup', () => { if (document.body.classList.contains('tb-moving')) { document.body.classList.remove('tb-moving'); placeFloat(); } }, true);
  // Menus, empty: the menu bar's menus as a list
  const browse = () => { if (floatOn() && !menuInput.value.trim()) openMenu($('#ed-menus'), Object.keys(MENUS).map(k => ({ label: k, items: MENUS[k] }))); };
  menuInput.addEventListener('focus', browse); menuInput.addEventListener('input', browse); menuInput.addEventListener('click', () => { if (!openMenuEl) browse(); });
  let on = false; try { on = localStorage.getItem(FLOAT_KEY) === 'float'; } catch {}
  if (on) setFloat(true);
}
