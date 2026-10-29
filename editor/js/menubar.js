const FORMAT_MENU = [
    { label: 'Text', icon: 'format_bold', items: [
      { label: 'Bold', icon: 'format_bold', key: '⌘B', run: () => $('#ed-bold').click(), off: noSel },
      { label: 'Italic', icon: 'format_italic', key: '⌘I', run: () => $('#ed-italic').click(), off: noSel },
      { label: 'Underline', icon: 'format_underlined', key: '⌘U', run: () => $('#ed-underline').click(), off: noSel },
      { label: 'Strikethrough', icon: 'strikethrough_s', key: '⇧⌘X', run: strike, off: noSel },
      { label: 'Superscript', icon: 'superscript', key: '⌘.', run: superscript, off: noSel },
      { label: 'Subscript', icon: 'subscript', key: '⌘,', run: subscript, off: noSel },
      '-',
      { label: 'Letter spacing', icon: 'format_letter_spacing', items: () => LETTER_SPACING.map(([label, v]) => ({ label, on: () => sel.size && curLs() === v, run: () => spanStyle('letter-spacing', v), off: noSel })) },
      { label: 'Size', items: [
        { label: 'Increase font size', key: '⇧⌘.', run: () => stepSize(1), off: noSel },
        { label: 'Decrease font size', key: '⇧⌘,', run: () => stepSize(-1), off: noSel },
      ] },
      { label: 'Color', run: () => openPalette(document.querySelector('.swatch[data-for=color]')), off: noSel },
      { label: 'Highlight color', run: () => openPalette(document.querySelector('.swatch[data-for=hilite]')), off: noSel },
      { label: 'Underline style', icon: 'format_underlined', items: () => UNDERLINES.map(([v, label]) => ({ label, on: () => sel.size && curUnderline() === v, run: () => setUnderline(v), off: noSel })) },
      { label: 'Drop cap', icon: 'format_size', on: () => sel.size && [...sel].every(b => 'dropcap' in b.dataset), run: toggleDropcap, off: noSel },
      { label: 'Capitalization', items: [['lowercase', 'lower'], ['UPPERCASE', 'upper'], ['Title Case', 'title']].map(([label, m]) => ({ label, run: () => recase(m), off: noSel })) },
      { label: 'Columns', icon: 'view_column', items: () => [1, 2, 3].map(n => ({ label: ['One', 'Two', 'Three'][n - 1] + (n > 1 ? ' columns' : ' column'), on: () => sel.size && curCols() === n, run: () => setColumns(n), off: noSel })) },
    ] },
    { label: 'Align & indent', icon: 'format_align_left', items: () => [
      ...ALIGNS.map(([v, icon, label, key]) => ({ label: label.replace(' align', ''), icon, key, on: () => sel.size && curAlign() === v, run: () => setAlign(v), off: noSel })),
      '-',
      ...VALIGNS.map(([v, icon, label]) => ({ label, icon, on: () => sel.size && curValign() === v, run: () => setValign(v), off: noSel })),
      '-',
      { label: 'Increase indent', icon: 'format_indent_increase', key: '⌘]', run: () => indentText(1), off: noSel },
      { label: 'Decrease indent', icon: 'format_indent_decrease', key: '⌘[', run: () => indentText(-1), off: noSel },
      '-',
      { label: 'Indentation options', run: () => showIndentDialog(true), off: noSel },
    ] },
    { label: 'Line & paragraph spacing', icon: 'format_line_spacing', items: lhItems },
    { label: 'Bullets & numbering', icon: 'format_list_bulleted', items: () => [
      { label: 'Numbered list menu', icon: 'format_list_numbered', off: noSel,   // as Slides: numbered first; indent lives in Align & indent
        items: NUMBERS.map(([t, label]) => ({ label, run: () => setListStyle('ol', t) })) },
      { label: 'Bulleted list menu', icon: 'format_list_bulleted', off: noSel,
        items: BULLETS.map(([t, label]) => ({ label, style: 'letter-spacing: .1em', run: () => setListStyle('ul', t) })) },
    ] },
    '-',
    { label: 'Image', icon: 'image', items: () => IMAGE_ITEMS(), off: () => !theImage() },
    { label: 'Borders & lines', icon: 'border_style', items: () => [
      { label: 'Border color', icon: 'border_color', run: () => openPalette(document.querySelector('.swatch[data-for=stroke]')), off: noSel },
      { label: 'Border weight', icon: 'line_weight', items: () => [1, 2, 3, 4, 8, 12, 16, 24].map(v => ({ label: v + 'px', on: () => curSw() === v, run: () => { setVar('--sw', v + 'px'); commit(); } })), off: noSel },
    ] },
    '-',
    { label: 'Format options', icon: 'format_paint', on: () => !fmt.hidden, run: () => setPanel(fmt.hidden) },
    { label: 'Clear formatting', icon: 'format_clear', key: '⌘\\', run: clearFormat, off: noSel },
  ];
// Online (glideshow.org, cloud/worker.js) there is no Mac behind the editor: what needs it is left out (mac: true).
const CLOUD = !!window.GLIDESHOW_CLOUD, onThisSide = list => list.filter(it => !(CLOUD && it.mac) && !(!CLOUD && it.online));
const MENUS = {
  File: onThisSide([   // New / Open / Make a copy switch the server to another deck folder (siblings of this one unless a path is given)
    { label: 'New', icon: 'add_box', run: () => askURL('New deck: folder name', name => switchDeck({ path: name, create: true }), 'untitled-' + new Date().toISOString().slice(0, 10)) },
    { label: 'Open', icon: 'folder_open', items: async () => [...(await fetch('/api/recent').then(r => r.json()).catch(() => [])).map(d => ({ label: d.title, on: () => d.current, run: () => d.current || switchDeck({ path: d.path }), tip: d.path })),
      '-', { label: 'Open a folder…', icon: 'folder', run: () => askURL('Open deck: folder path', p => switchDeck({ path: p })) }] },
    { label: 'Open a deck file…', icon: 'upload_file', run: openDeckFile, online: true },
    { label: 'Import slides', icon: 'upload_file', run: () => $('#ed-pptx-file').click(), mac: true },
    { label: 'Import from Google Slides', icon: 'cloud_download', run: () => askURL('Import from Google Slides: link to the deck', importGoogle), mac: true },
    { label: 'Make a copy', icon: 'file_copy', run: () => askURL('Make a copy: folder name', name => switchDeck({ copy: name }), deckName() + '-copy') },
    '-',
    { label: 'Download', icon: 'download', items: onThisSide([{ label: 'Glideshow deck, one file (.html)', run: downloadOneFile }, { label: 'PDF document (.pdf)', run: printDeck }, { label: 'PNG image (.png, current slide)', run: downloadSlidePNG }, { label: 'Microsoft PowerPoint (.pptx)', run: async () => { await flushSave(); setStatus('Making the PowerPoint file…'); location.href = '/api/pptx'; }, mac: true }, { label: 'Web page folder (.zip)', run: () => { location.href = '/api/zip'; }, mac: true }]) },   // the print dialog's Save as PDF
    '-',
    { label: 'Rename', icon: 'edit', run: () => { $('#ed-title').focus(); $('#ed-title').select(); } },
    { label: 'Move to trash', icon: 'delete', run: trashDeck },
    { label: 'Share… (publish to the web)', icon: 'public', run: () => showShare(true) },
    { label: 'Version history', icon: 'history', run: () => showHistory(true) },

    '-',
    { label: 'Page setup', icon: 'aspect_ratio', run: pageSetup },
    { label: 'Print preview', icon: 'plagiarism', run: async () => { await flushSave(); window.open('deck.html?print-pdf', '_blank'); } },
    { label: 'Print', icon: 'print', key: '⌘P', run: printDeck },
  ]),
  Edit: [
    { label: 'Undo', icon: 'undo', key: '⌘Z', run: undo, off: () => hptr <= 0 },
    { label: 'Redo', icon: 'redo', key: '⌘Y', run: redo, off: () => hptr >= hist.length - 1 },
    '-',
    { label: 'Cut', icon: 'content_cut', key: '⌘X', run: () => document.execCommand('cut'), off: noText },
    { label: 'Copy', icon: 'content_copy', key: '⌘C', run: () => document.execCommand('copy'), off: noText },
    { label: 'Paste', icon: 'content_paste', key: '⌘V', run: () => setStatus('Press ⌘V to paste') },
    { label: 'Paste without formatting', icon: 'content_paste_off', key: '⇧⌘V', run: () => setStatus('Press ⇧⌘V to paste without formatting') },
    '-',
    { label: 'Select all', icon: 'select_all', key: '⌘A', run: () => { stopEdit(); sel = new Set(pickable()); drawOverlay(); updateToolbar(); } },
    { label: 'Delete', icon: 'delete', run: deleteSelection, off: noSel },
    { label: 'Duplicate', icon: 'control_point_duplicate', key: '⌘D', run: duplicateSelection, off: noSel },
    '-',
    { label: 'Copy animation', icon: 'animation', run: copyAnim, off: () => !animSel() },
    { label: 'Paste animation', run: pasteAnim, off: () => !copiedAnim || !sel.size },
    '-',
    { label: 'Find and replace', icon: 'find_replace', key: '⇧⌘H', run: openFind },
  ],
  View: [   // Slides' order: Slideshow, Motion, Theme builder | Grid view, Show ruler | Guides, Snap to | notes, filmstrip | zoom
    { label: 'Slideshow', icon: 'slideshow', key: '⌘↵', run: () => present() },
    { label: 'Motion', icon: 'animation', key: '⌥⇧⌘B', on: () => !$('#ed-trans').hidden, run: () => setTransPanel($('#ed-trans').hidden) },
    { label: 'Theme builder', icon: 'palette', run: () => enterThemeEdit() },
    { label: 'Object list', icon: 'layers', on: () => !$('#ed-objects').hidden, run: () => setObjectsPanel($('#ed-objects').hidden) },
    '-',
    { label: 'Grid view', key: '⌥⌘1', on: () => gridOn, run: () => setGrid(!gridOn) },
    { label: 'Show ruler', on: rulersShown, run: () => setRulersShown(!rulersShown()) },
    '-',
    { label: 'Guides', icon: 'grid_4x4', items: () => [
      { label: 'Show guides', key: '⌃⌘E ⌃⌘G', on: guidesShown, run: () => setGuidesShown(!guidesShown()) },
      '-',
      { label: 'Add vertical guide', key: '⌃⌘E ⌃⌘V', run: () => addGuide('v') },
      { label: 'Add horizontal guide', key: '⌃⌘E ⌃⌘H', run: () => addGuide('h') },
      '-',
      { label: 'Clear guides', run: () => setGuides([]), off: () => !userGuides().length },
    ] },
    { label: 'Snap to', icon: 'keyboard_tab', items: () => [{ label: 'Grid', on: snapGrid, run: () => store('slides-snap-grid', snapGrid() ? undefined : '1') },
      { label: 'Guides', on: snapGuides, run: () => { store('slides-snap-guides', snapGuides() ? '0' : undefined); } }] },
    '-',
    { label: 'Show speaker notes', on: () => !document.body.classList.contains('notes-off'), run: () => setNotesVisible(document.body.classList.contains('notes-off')) },
    { label: 'Show sticky notes', on: stickiesShown, run: () => setStickies(!stickiesShown()) },
    { label: 'Show filmstrip', on: () => !document.body.classList.contains('film-off'), run: () => $('#ed-film-toggle').click() },
    { label: 'Show insert bar', on: () => dockShown(), run: () => setDock(!dockShown()) },   // dock.js loads after this file
    '-',
    { label: 'Zoom menu', icon: 'zoom_in', items: () => zoomItems() },
    { label: 'Full screen', icon: 'fullscreen', key: '⌃⇧F', on: () => document.body.classList.contains('compact'), run: toggleCompact },
    { label: 'Dark mode', icon: 'dark_mode', on: darkOn, run: () => setDark(!darkOn()) },   // ours: Slides has none
  ],
  Insert: [
    { label: 'Image', icon: 'image', items: [{ label: 'Upload from computer', icon: 'upload', run: () => $('#ed-file').click() }] },
    { label: 'Text box', icon: 'text_fields', run: () => $('#ed-add-text').click() },   // Slides' order
    { label: 'Shape', icon: 'shapes', items: shapeItems },
    { label: 'Line', icon: 'pen_size_2', items: lineItems },
    { label: 'Word art', icon: 'format_shapes', run: addWordArt },
    { label: 'Icon', icon: 'emoji_symbols', run: () => showIcons(true) },
    { label: 'Table', icon: 'table_chart', items: () => [{ el: tableGrid }] },
    { label: 'Code block', icon: 'code', items: () => codeLangItems(addCode) },
    { label: 'Equation', icon: 'function', run: addEquation },
    { label: 'Note for AI', icon: 'sticky_note_2', run: () => { const b = addNote(cur, W - 620, 60, ''); sel = new Set([b]); startEdit(b); } },
    '-',
    { label: 'Video', icon: 'movie', items: [{ label: 'Upload from computer', icon: 'upload', run: () => $('#ed-video-file').click() }, { label: 'By URL (YouTube, Vimeo)', icon: 'link', run: () => askURL('Insert video by URL', addEmbed) }] },
    { label: 'Embed', icon: 'web', run: () => askURL('Embed a web page', addEmbed) },
    { label: 'Live box', icon: 'play_circle', run: () => addLive() },   // ours: a page with its own script, on the slide
    '-',
    { label: 'Special characters', icon: 'special_character', run: () => showChars(true) },
    { label: 'Slide numbers', icon: 'tag', run: () => showNumDialog(true) },
    { label: 'Animation', icon: 'animation', run: () => { setTransPanel(true); addAnim(); }, off: noSel },
    '-',
    { label: 'Link', icon: 'link', key: '⌘K', run: linkText, off: () => !editing && sel.size !== 1 },
    '-',
    { label: 'New slide', icon: 'add', key: '⌃M', run: () => $('#ed-new-slide').click() },
  ],
  Format: FORMAT_MENU,
  Slide: [
    { label: 'New slide', icon: 'add', key: '⌃M', run: () => $('#ed-new-slide').click() },
    { label: 'New slide with layout', icon: 'add_box', items: newSlideItems },

    { label: 'New slide below', icon: 'vertical_align_bottom', key: '⇧⌘M', run: newSlideBelow },
    '-',
    { label: 'Duplicate slide', icon: 'control_point_duplicate', run: () => $('#ed-dup-slide').click() },
    { label: 'Slide style (CSS)', icon: 'css', run: () => editSlideCSS() },   // ours: styles for this slide only
    { label: 'Delete slide', icon: 'delete', run: () => $('#ed-del-slide').click() },
    { label: 'Skip slide', icon: 'visibility_off', on: () => slides[cur]?.dataset.visibility === 'hidden', run: skipSlides },
    { label: 'Move slide', icon: 'swap_vert', items: [
      { label: 'Move slide up', icon: 'arrow_upward', key: '⌘↑', run: () => $('#ed-up-slide').click() },
      { label: 'Move slide down', icon: 'arrow_downward', key: '⌘↓', run: () => $('#ed-down-slide').click() },
      { label: 'Move slide to beginning', icon: 'vertical_align_top', key: '⇧⌘↑', run: () => moveSlides('start') },
      { label: 'Move slide to end', icon: 'vertical_align_bottom', key: '⇧⌘↓', run: () => moveSlides('end') },
    ] },
    { label: 'Go to slide', icon: 'switch_access_shortcut', key: '⌃⌘G', run: () => showGoto(true) },
    '-',
    { label: 'Change background', icon: 'opacity', run: () => showBgDialog(true) },
    { label: 'Apply layout', icon: 'view_quilt', items: layoutItems },
    { label: 'Edit theme', icon: 'palette', run: enterThemeEdit },
    { label: 'Change theme', icon: 'palette', on: () => !$('#ed-theme').hidden, run: () => setThemePanel($('#ed-theme').hidden) },
    { label: 'Transition', icon: 'animation', on: () => !$('#ed-trans').hidden, run: () => setTransPanel($('#ed-trans').hidden) },
  ],
  Arrange: [
    { label: 'Order', icon: 'flip_to_front', items: [
      { label: 'Bring to front', icon: 'flip_to_front', key: '⇧⌘↑', run: toFront, off: noSel },
      { label: 'Bring forward', key: '⌘↑', run: stepForward, off: noSel },
      { label: 'Send backward', key: '⌘↓', run: stepBackward, off: noSel },
      { label: 'Send to back', icon: 'flip_to_back', key: '⇧⌘↓', run: toBack, off: noSel },
    ] },
    { label: 'Align', icon: 'align_horizontal_left', items: [
      { label: 'Left', icon: 'align_horizontal_left', run: () => alignSel('h', 0), off: noSel },
      { label: 'Center', icon: 'align_horizontal_center', run: () => alignSel('h', .5), off: noSel },
      { label: 'Right', icon: 'align_horizontal_right', run: () => alignSel('h', 1), off: noSel },
      '-',
      { label: 'Top', icon: 'align_vertical_top', run: () => alignSel('v', 0), off: noSel },
      { label: 'Middle', icon: 'align_vertical_center', run: () => alignSel('v', .5), off: noSel },
      { label: 'Bottom', icon: 'align_vertical_bottom', run: () => alignSel('v', 1), off: noSel },
    ] },
    { label: 'Distribute', icon: 'horizontal_distribute', items: [
      { label: 'Horizontally', icon: 'horizontal_distribute', run: () => distributeSel('h'), off: () => sel.size < 3 },
      { label: 'Vertically', icon: 'vertical_distribute', run: () => distributeSel('v'), off: () => sel.size < 3 },
    ] },
    { label: 'Center on page', icon: 'center_focus_strong', items: [
      { label: 'Horizontally', run: () => centerOnPage('h'), off: noSel },
      { label: 'Vertically', run: () => centerOnPage('v'), off: noSel },
    ] },
    { label: 'Rotate', icon: 'rotate_right', items: [
      { label: 'Rotate clockwise 90°', icon: 'rotate_right', run: () => rotateSel(90), off: noSel },
      { label: 'Rotate counter-clockwise 90°', icon: 'rotate_left', run: () => rotateSel(-90), off: noSel },
      '-',
      { label: 'Flip horizontally', icon: 'flip', run: () => flipSel('h'), off: noSel },
      { label: 'Flip vertically', run: () => flipSel('v'), off: noSel },
    ] },
    '-',
    { label: 'Group', icon: 'group_work', key: '⌥⌘G', run: groupSel, off: () => sel.size < 2 || anyLocked() },
    { label: 'Ungroup', key: '⇧⌥⌘G', run: ungroupSel, off: () => ![...sel].some(b => b.classList.contains('group')) || anyLocked() },
    '-',
    { label: 'Lock', icon: 'lock', run: () => lockSel(true), off: () => !sel.size || [...sel].every(isLocked) },
    { label: 'Unlock', icon: 'lock_open', run: () => lockSel(false), off: () => !anyLocked() },
    '-',
    { label: 'Flip line direction', icon: 'swap_horiz', run: flipLines, off: () => ![...sel].some(isLine) },
    '-',
    { label: 'Stack as a sequence', icon: 'stacks', run: () => stackSequence(), off: () => [...sel].filter(b => isMedia(b)).length < 2 },   // pictures shown one after another in one place
  ],
  Tools: [{ label: 'Spelling', icon: 'spellcheck', items: () => [{ label: 'Show spelling suggestions', key: '⌥⌘X', on: spellOn, run: () => setSpelling(!spellOn()) }] },
    { label: 'Convert LaTeX shortcuts', icon: 'function', on: latexOn, run: () => store('slides-latex', latexOn() ? '0' : undefined) },
    { label: 'Use smart quotes', icon: 'format_quote', on: smartQuotesOn, run: () => store('slides-smart-quotes', smartQuotesOn() ? '0' : undefined) },
    { label: 'Automatically detect lists', icon: 'format_list_bulleted', on: autoListsOn, run: () => store('slides-auto-lists', autoListsOn() ? '0' : undefined) }],
  Help: [
    { label: 'Search the menus', icon: 'search', key: '⌥/', run: () => menuInput.focus() },
    '-',
    { label: 'Keyboard shortcuts', icon: 'keyboard', key: '⌘/', run: () => showShortcuts(true) },
  ],
};
/* A collaborator's editor (glideshow.org/e/…): one deck of someone else's, so nothing about decks or
   the library (new, open, copy, rename, trash, Share, history), and not its theme or page size, which stay the owner's. */
const COLLAB = !!(/** @type {any} */ (window.GLIDESHOW_CLOUD))?.collab;
if (COLLAB) {
  const keep = (list, out) => list.filter(it => typeof it !== 'object' || !out.includes(it.label));
  MENUS.File = MENUS.File.filter(it => typeof it === 'object' && ['Download', 'Print preview', 'Print'].includes(it.label));
  for (const k of Object.keys(MENUS)) if (Array.isArray(MENUS[k])) MENUS[k] = keep(MENUS[k], ['Theme builder', 'Edit theme', 'Change theme', 'Page setup']);
}
const zoomItems = () => [
  { label: 'Fit', key: '⌘0', on: () => !zoom, run: () => setZoom(null) },
  ...ZOOMS.map(z => ({ label: z * 100 + '%', on: () => zoom === z, run: () => setZoom(z) })),
  '-',
  { label: 'Zoom in', icon: 'zoom_in', key: '⌘+', run: () => zoomStep(1) },
  { label: 'Zoom out', icon: 'zoom_out', key: '⌘−', run: () => zoomStep(-1) },
  '-',
  { label: 'Zoom to selection', icon: 'zoom_in_map', key: '⇧⌘0', run: zoomToSelection, off: noSel },
  { label: 'Zoom to fit content', icon: 'fit_screen', key: '⌥⇧⌘0', run: zoomToContent },
];
menuButton($('#ed-zoom'), () => zoomItems());
// Trackpad pinch (and ⌘/ctrl + wheel) zooms around the pointer.
stage.addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  setZoom(fitZoom() * Math.exp(-e.deltaY / 100), e.clientX, e.clientY);
}, { passive: false });
const SLIDESHOW = [
  { label: 'Present from this slide', icon: 'slideshow', key: '⌘↵', run: () => present() },
  { label: 'Present from beginning', icon: 'first_page', key: '⇧⌘↵', run: () => present(0) },
  { label: 'Present fullscreen', icon: 'fullscreen', run: () => present(cur, { fullscreen: true }) },
  '-',
  { label: 'Presenter view', icon: 'co_present', run: () => openDeckTab(cur, true) },
  { label: 'Open in new tab', icon: 'open_in_new', run: () => openDeckTab(cur) },
  { label: 'Open as a scrolling page', icon: 'view_day', run: () => window.open('deck.html?view=scroll', '_blank') },   // reveal's scroll view: reads like a page, good on a phone
  '-',
  { label: 'Slideshow settings', icon: 'tune', run: () => showShowDialog(true) },
];
document.querySelectorAll('#ed-menubar [data-menu]').forEach(btn => {
  btn.onclick = () => openAnchor === btn ? closeMenu() : openMenu(btn, MENUS[btn.dataset.menu]);
  btn.onpointerenter = () => { if (openAnchor?.parentElement === btn.parentElement && openAnchor !== btn) openMenu(btn, MENUS[btn.dataset.menu]); };
});
$('#ed-present-menu').onclick = () => openAnchor === $('#ed-present-menu') ? closeMenu() : openMenu($('#ed-present-menu'), SLIDESHOW);

/* Toolbar groups that don't fit move, from the right, into the ⋯ popover (as Slides does). */
function layoutToolbar() {
  const bar = $('#ed-toolbar'), pop = $('#ed-more-pop'), more = $('#ed-more-wrap');
  [...pop.children].forEach(g => bar.insertBefore(g, more));
  [...bar.querySelectorAll(':scope > .grp')].sort((a, b) => a.dataset.i - b.dataset.i).forEach(g => bar.insertBefore(g, more));
  more.hidden = true;
  const groups = [...bar.querySelectorAll(':scope > .grp')].filter(g => g.offsetWidth);
  while (bar.scrollWidth > bar.clientWidth && groups.length > 1) { more.hidden = false; pop.prepend(groups.pop()); }
  if (!pop.children.length) pop.classList.remove('open');
}
$('#ed-more').onclick = () => { const pop = $('#ed-more-pop'); pop.style.top = $('#ed-toolbar').getBoundingClientRect().bottom + 4 + 'px'; pop.classList.toggle('open'); };
addEventListener('resize', layoutToolbar);
document.fonts?.addEventListener('loadingdone', layoutToolbar);   // icon and text widths change when web fonts arrive

/* Tooltips in Slides' style: a small dark pill under the control, label then shortcut. */
const tip = div('tip');
document.querySelectorAll('#ed-bar [title]').forEach(e => { e.dataset.tip = e.title; e.removeAttribute('title'); });
addEventListener('pointerover', e => {
  const t = e.target.closest?.('[data-tip]');
  if (!t || openAnchor === t) { tip.remove(); return; }
  tip.textContent = t.dataset.tip; document.body.append(tip);
  const r = t.getBoundingClientRect();
  tip.style.left = Math.max(4, Math.min(r.left + r.width / 2 - tip.offsetWidth / 2, innerWidth - tip.offsetWidth - 4)) + 'px';
  tip.style.top = r.bottom + 6 + 'px';
});
addEventListener('pointerdown', () => tip.remove(), true);

/* Search the menus (⌥/), as Slides: matches every menu item, including submenus, by label. */
const menuInput = $('#ed-menus input');
function allMenuItems() {
  const out = [], walk = (items, path) => { const list = val(items); if (Array.isArray(list)) list.forEach(it => { if (it === '-' || !it.label) return; if (it.items) walk(it.items, path.concat(it.label)); else out.push({ ...it, path }); }); };   // a fetched submenu (File → Open's recent decks), headings and custom bodies aren't searched
  Object.entries(MENUS).forEach(([name, items]) => walk(items, [name]));
  return out;
}
menuInput.oninput = () => {
  const q = menuInput.value.trim().toLowerCase();
  if (!q) { closeMenu(); return; }
  const hits = allMenuItems().filter(it => it.label.toLowerCase().includes(q) && !val(it.off)).slice(0, 12)
    .map(it => ({ ...it, label: it.label, key: it.key || it.path.join(' › '), run: () => { menuInput.value = ''; menuInput.blur(); it.run(); } }));
  openMenu($('#ed-menus'), hits.length ? hits : [{ label: 'No results', off: true, run() {} }]);
  menuInput.focus();
};
menuInput.onkeydown = e => {
  if (e.key === 'Enter') { e.preventDefault(); openMenuEl?.querySelector('.menu-item:not(:disabled)')?.click(); }
  if (e.key === 'ArrowDown') { e.preventDefault(); openMenuEl?.querySelector('.menu-item:not(:disabled)')?.focus(); }
  if (e.key === 'Escape') { menuInput.value = ''; closeMenu(); menuInput.blur(); }
};
addEventListener('keydown', e => { if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'Slash') { e.preventDefault(); menuInput.focus(); } }, true);
