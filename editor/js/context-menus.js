/* Right-click menus, as Slides: on an object, on the empty slide, and on a filmstrip thumbnail. Items are
   shared with the menu bar where they exist (Arrange submenus, Edit commands). */
const arrangeItem = label => MENUS.Arrange.find(it => typeof it === 'object' && it.label === label);
const editItem = label => MENUS.Edit.find(it => typeof it === 'object' && it.label === label);
function objectMenu() {
  const one = sel.size === 1 ? [...sel][0] : null, text = one && !isLine(one) && !isGroup(one) && !isMedia(one);
  return [
    editItem('Cut'), editItem('Copy'), editItem('Paste'), editItem('Paste without formatting'), editItem('Delete'),
    '-',
    ...(text ? [{ label: 'Edit text', icon: 'format_shapes', run: () => startEdit(one) }] : []),
    { label: 'Alt text', icon: 'accessibility_new', run: openAltText, off: () => sel.size !== 1 },
    ...(codeOf(one) ? [{ label: 'Code language', icon: 'code', items: () => codeLangItems(setCodeLang, v => codeOf(one).classList.contains('language-' + v)) }] : []),
    ...(one?.dataset.shape && !isPath(one) && !isLine(one) && !/^(wordart|icon)$/.test(one.dataset.shape) ? [{ label: 'Make editable', icon: 'polyline', run: () => makeEditable(one) }] : []),
    ...(isPath(one) ? [{ label: pointEdit === one ? 'Done editing points' : 'Edit points', icon: 'polyline', run: () => pointEdit === one ? endPointEdit() : enterPointEdit(one) },
      { label: /z\s*$/i.test(one.dataset.path || '') ? 'Open path' : 'Close path', icon: 'pentagon', run: () => setPathClosed(one, !/z\s*$/i.test(one.dataset.path || '')) }] : []),
    ...(/^(elbow|curve)$/.test(one?.dataset.shape) && one.dataset.bend ? [{ label: 'Reroute connector', icon: 'route', run: () => { delete one.dataset.bend; renderShape(one); drawOverlay(); commit(); } }] : []),
    '-',
    arrangeItem('Order'), arrangeItem('Rotate'), arrangeItem('Center on page'),
    ...(sel.size > 1 ? [arrangeItem('Align'), arrangeItem('Distribute')] : []),
    ...(sel.size > 1 ? [{ label: 'Group', icon: 'group_work', key: '⌥⌘G', run: groupSel }] : []),
    ...([...sel].some(isGroup) ? [{ label: 'Ungroup', key: '⇧⌥⌘G', run: ungroupSel }] : []),
    anyLocked() ? arrangeItem('Unlock') : arrangeItem('Lock'),
    '-', { label: 'Link', icon: 'link', key: '⌘K', run: linkText, off: () => sel.size !== 1 },   // pictures too, as Keynote
    '-',
    { label: 'Animate', icon: 'animation', run: () => $('#ed-animate').click() },
    ...(animSel() ? [editItem('Copy animation')] : []), ...(copiedAnim ? [editItem('Paste animation')] : []),
    '-',
    { label: 'Format options', icon: 'format_paint', run: () => setPanel(true) },
    ...(one?.classList.contains('image') ? ['-', ...IMAGE_ITEMS(), { label: 'Set image as background', icon: 'wallpaper', run: () => imageToBackground(one) }] : []),
  ];
}
const slideMenu = () => [
  editItem('Cut'), editItem('Copy'), editItem('Paste'), editItem('Paste without formatting'), editItem('Delete'),
  '-',
  { label: 'Change background', icon: 'opacity', run: () => showBgDialog(true) },
  { label: 'Apply layout', icon: 'view_quilt', items: layoutItems },
  '-',
  { label: 'Transition', icon: 'animation', run: () => setTransPanel(true) },
];
const thumbMenu = () => [
  { label: 'New slide', icon: 'add', key: '⌃M', run: () => $('#ed-new-slide').click() },
  { label: 'Duplicate slide', icon: 'control_point_duplicate', run: () => $('#ed-dup-slide').click() },
  { label: 'Delete', icon: 'delete', run: () => $('#ed-del-slide').click() },
  { label: 'Skip slide', icon: 'visibility_off', on: () => slides[cur]?.dataset.visibility === 'hidden', run: skipSlides },
  { label: 'Indent slide', icon: 'format_indent_increase', run: () => indentSlides(1), off: () => isSub(cur) },
  { label: 'Outdent slide', icon: 'format_indent_decrease', run: () => indentSlides(-1), off: () => !groupLevel(slides[cur]) },
  { label: 'Move slide', icon: 'swap_vert', items: () => [
    { label: 'Move slide to beginning', icon: 'vertical_align_top', key: '⇧⌘↑', run: () => moveSlides('start') },
    { label: 'Move slide to end', icon: 'vertical_align_bottom', key: '⇧⌘↓', run: () => moveSlides('end') },
  ] },
  '-',
  { label: 'Change background', icon: 'opacity', run: () => showBgDialog(true) },
  { label: 'Apply layout', icon: 'view_quilt', items: layoutItems },
  '-',
  { label: 'Transition', icon: 'animation', run: () => setTransPanel(true) },
];
/* The picture commands, as Slides' Format → Image and the image right-click menu. Reset image drops crop, opacity
   and size changes. Set image as background moves the picture onto the slide background. */
const theImage = () => sel.size === 1 && [...sel][0].classList.contains('image') ? [...sel][0] : null;
const IMAGE_ITEMS = () => [
  { label: 'Crop image', icon: 'crop', run: () => enterCrop(theImage()), off: () => !theImage() },
  { label: 'Replace image', icon: 'image', run: () => $('#ed-replace-file').click(), off: () => !theImage() },
  { label: 'Refresh figure', icon: 'refresh', run: () => refreshFigure(theImage()), off: () => !theImage()?.dataset.source },   // a figure made by a script
  { label: 'Remove background', icon: 'auto_fix_high', run: () => removeBackground(theImage()), off: () => !theImage() },
  { label: 'Reset image', icon: 'reset_image', run: () => resetImage(theImage()), off: () => !theImage() },
];
function resetImage(b) {
  if (!b) return;
  const img0 = b.querySelector('.content > img'); if (b.dataset.original && img0) { img0.setAttribute('src', b.dataset.original); delete b.dataset.original; }   // before Remove background
  delete b.dataset.crop; delete b.dataset.adjust; adjustImage(b); cropBox(b); const img = b.querySelector('.content > img'); if (img) { img.style.opacity = ''; if (!img.getAttribute('style')) img.removeAttribute('style'); }
  resetImageSize(b);
}
function imageToBackground(b) {
  const src = b.querySelector('.content > img')?.getAttribute('src'); if (!src) return;
  slides[cur].dataset.backgroundImage = plainSrc(src); b.remove(); sel.clear(); render(); commit();
}
function openAltText() {
  setPanel(true);
  const d = [...fmt.querySelectorAll('details')].find(d => d.querySelector('summary').textContent.trim() === 'Alt Text');
  if (d) { d.open = true; F('alt').focus(); }
}
function openContextMenu(e, items) {
  e.preventDefault(); closeMenu();
  const m = buildMenu(items); placeMenu(m, e.clientX, e.clientY); openMenuEl = m;
}
stage.addEventListener('contextmenu', e => {
  if (editing && topBox(e.target) === editing && e.target.closest('td, th')) {   // in a table cell: Slides' table menu
    const td = e.target.closest('td, th'); if (!cellSel.has(td) && !td.contains(getSelection().anchorNode)) focusCell(td);
    openContextMenu(e, [editItem('Cut'), editItem('Copy'), editItem('Paste'), '-', ...tableItems()]); return;
  }
  if (editing && topBox(e.target) === editing) return;   // the browser's own menu while editing text (spelling suggestions)
  const b = topBox(e.target);
  if (b && !sel.has(b)) { stopEdit(); sel = new Set([b]); drawOverlay(); updateToolbar(); }
  if (!b && !e.target.closest('#ed-ui .handle, #ed-ui .sel-wrap')) { stopEdit(); sel.clear(); drawOverlay(); updateToolbar(); }
  openContextMenu(e, sel.size ? objectMenu() : slideMenu());
});
thumbs.addEventListener('contextmenu', e => {
  const t = e.target.closest('.thumb'); if (!t) return;
  const i = [...thumbs.children].indexOf(t);
  if (!picked.has(slides[i])) go(i);
  thumbs.focus({ preventScroll: true });
  openContextMenu(e, thumbMenu());
});
