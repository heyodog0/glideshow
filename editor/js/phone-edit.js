/* ---------- phone: the editing screen ---------- */
/* The Slides app's editor: a top bar (back; undo, redo, present, share, +, comments, ⋯) over the slide fitted 15 from
   the sides, and the filmstrip at the bottom (the current slide's cell blue, a new-slide button at its right). With
   something selected, back becomes ✓ (done: deselect) and share leaves the bar. */
if (PHONE) (() => {
  const el = (tag, cls, html = '') => Object.assign(document.createElement(tag), { className: cls, innerHTML: html });
  const iconBtn = (icon, title, run) => { const b = el('button', 'ph-icon-btn', `<span class="icon">${icon}</span>`); b.title = title; b.onclick = run; return b; };
  const bar = $('#ph-top .ph-bar-edit');

  /* ---- the top bar ---- */
  const back = iconBtn('arrow_back_ios_new', 'Back to the slides', () => phoneState('view'));
  const done = iconBtn('check', 'Done', () => { stopEdit(); sel.clear(); drawOverlay(); updateToolbar(); });
  done.classList.add('ph-done');
  const share = iconBtn('person_add', 'Share', () => showShare());
  const rails = () => document.documentElement.classList.contains('ph-rails');
  /* a menu from a button: under it, or in the side rails (landscape) beside it, to its left */
  const menuAt = (btn, items) => {
    openMenu(btn, items);
    const r = btn.getBoundingClientRect();
    if (rails() && openMenuEl) placeMenu(openMenuEl, r.left - openMenuEl.offsetWidth - 8, r.top + r.height / 2 - openMenuEl.offsetHeight / 2);
  };
  const more = e => menuAt(e.currentTarget, [
    { label: 'Find', run: () => openFind() }, { label: 'Share', run: () => showShare() },
    ...(document.documentElement.dataset.look === 'thermal' ? [{ label: document.body.classList.contains('dark') ? 'Light mode' : 'Dark mode', run: () => window['setDark']?.(!document.body.classList.contains('dark')) }] : []),
    { label: 'Desktop version', run: () => { location.href = '/edit?phone=0'; } }]);
  bar.append(back, done, el('span', 'ph-gap'), iconBtn('undo', 'Undo', () => stepBack(undo)), iconBtn('redo', 'Redo', () => stepBack(redo)),
    iconBtn('play_arrow', 'Present', () => phonePresent()), share,
    iconBtn('add', 'Insert', () => phoneInsert()),
    iconBtn('comment', 'Comments', () => setCommentsPanel(true)),
    iconBtn('more_horiz', 'More', more));
  /* undo and redo select what they changed on the slide, as the app does (r08) */
  const saved = i => {   // the current slide's boxes in history step i, by id (as saved: no rendering in them)
    const t = document.createElement('template'); t.innerHTML = hist[i]?.html[cur] || '';
    const sig = b => { const c = b.querySelector(':scope > .content'); return [...b.attributes, ...(c?.attributes || [])].map(x => x.name + '=' + x.value).join('\n') + '\n' + (c?.textContent || ''); };   // what an edit changes, not what rendering adds (highlighting, maths)
    return new Map([...t.content.querySelectorAll('.box[id]')].map(b => [b.id, sig(b)]));
  };
  function stepBack(fn) {
    const at = cur, was = hptr, before = saved(hptr);
    fn();
    if (cur !== at || hptr === was) return;
    const now = saved(hptr), changed = boxes().filter(b => b.id && now.has(b.id) && before.get(b.id) !== now.get(b.id));
    if (changed.length) { sel = new Set(changed); drawOverlay(); updateToolbar(); }
  }
  const picking = () => sel.size > 0 || !!editing;
  const drawOverlay0 = drawOverlay;   // the bars follow the selection, which redraws the overlay whenever it changes
  window['drawOverlay'] = () => { drawOverlay0(); bar.classList.toggle('picking', picking()); document.documentElement.classList.toggle('ph-picking', picking()); showTools(); };

  /* ---- the filmstrip: cells of 98 with an 80 wide thumbnail and the number under it ---- */
  const film = el('div', 'ph-film'), strip = el('div', 'ph-film-strip'), row = el('div', 'ph-film-cells'), add = iconBtn('library_add', 'New slide', () => $('#ed-new-slide').click());
  add.classList.add('ph-film-new'); film.id = 'ph-film';
  // New slide: the app keeps it at the strip's right end; Thermal makes it a tile right after the last slide, scrolling with them
  strip.append(row); film.append(strip); (document.documentElement.dataset.look === 'thermal' ? strip : film).append(add); document.body.append(film);
  const pics = new WeakMap();   // slide → { key, node }: a copy of its filmstrip picture, remade when the slide changes
  function pic(s) {
    const key = s.outerHTML, hit = pics.get(s);
    if (hit?.key === key) return hit.node;
    const node = /** @type {HTMLElement} */ (thumbView(s).cloneNode(true));
    pics.set(s, { key, node }); return node;
  }
  function fillFilm() {
    if (!slides.length) return;
    while (row.children.length > slides.length) row.lastChild.remove();
    while (row.children.length < slides.length) {
      const c = el('button', 'ph-cell', '<div class="ph-thumb"></div><span class="ph-num"></span>'), i = row.children.length;
      c.onclick = () => { if (!lifted) cellTap([...row.children].indexOf(c)); };
      c.onpointerdown = e => press(e, c);
      row.append(c); void i;
    }
    [...row.children].forEach((c, i) => {
      const t = c.firstElementChild, p = pic(slides[i]);
      if (t.firstChild !== p) t.replaceChildren(p);
      /** @type {HTMLElement} */ (t).style.height = 80 * H / W + 'px';
      c.lastElementChild.textContent = String(i + 1); c.classList.toggle('cur', i === cur); c.classList.toggle('picked', slideMode && picked.has(slides[i]));
    });
    const c = /** @type {HTMLElement} */ (row.children[cur]);
    if (!c) return;
    if (rails()) { if (c.offsetTop < strip.scrollTop || c.offsetTop + c.offsetHeight > strip.scrollTop + strip.clientHeight) strip.scrollTo({ top: c.offsetTop - 8 }); }   // the strip runs down the left
    else if (c.offsetLeft < strip.scrollLeft || c.offsetLeft + c.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollTo({ left: c.offsetLeft - 8 });
  }
  const renderThumbs0 = renderThumbs;
  window['renderThumbs'] = () => { renderThumbs0(); fillFilm(); count.textContent = String(picked.size); };

  /* ---- reorder: a long press lifts a slide's picture (×1.2), it follows the finger along the strip, the others make
     room, and letting go puts the slide there (r05) ---- */
  let lifted = null;
  function press(e, c) {
    const x0 = e.clientX, y0 = e.clientY, from = [...row.children].indexOf(c), down = rails(), pitch = down ? c.offsetHeight : 98;   // along the strip: across, or down the side rail
    let timer = window.setTimeout(lift, 400), at = from, ghost = null;
    const cells = () => /** @type {HTMLElement[]} */ ([...row.children]);
    function lift() {
      timer = 0; lifted = c; c.classList.add('lifting'); film.classList.add('dragging');
      ghost = /** @type {HTMLElement} */ (c.querySelector('.ph-thumb').cloneNode(true)); ghost.className = 'ph-thumb ph-lifted';
      document.body.append(ghost); place_(x0, y0);
    }
    const place_ = (x, y) => { ghost.style.left = x - 49 + 'px'; ghost.style.top = y - 28 + 'px'; };
    function move(ev) {
      if (timer) { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) end(); return; }   // moved first: a scroll, not a lift
      ev.preventDefault(); place_(ev.clientX, ev.clientY);
      const r = strip.getBoundingClientRect();
      const along = down ? ev.clientY - r.top + strip.scrollTop - cells()[0].offsetTop : ev.clientX - r.left + strip.scrollLeft, t = down ? 'translateY' : 'translateX';
      at = Math.max(0, Math.min(slides.length - 1, Math.floor(along / pitch)));
      cells().forEach((x, i) => { x.style.transform = i === from ? '' : i > from && i <= at ? `${t}(-${pitch}px)` : i < from && i >= at ? `${t}(${pitch}px)` : ''; });
    }
    function end() {
      clearTimeout(timer);
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); strip.removeEventListener('touchmove', hold);
    }
    function up() {
      end(); if (!lifted) return;
      ghost.remove(); c.classList.remove('lifting'); film.classList.remove('dragging'); cells().forEach(x => { x.style.transform = ''; });
      if (at !== from) slideOp(() => { const s = slides.splice(from, 1)[0]; slides.splice(at, 0, s); cur = at; picked = new Set([s]); });
      setTimeout(() => { lifted = null; });   // after the click that follows the lift
    }
    const hold = ev => { if (lifted) ev.preventDefault(); };   // while a slide is lifted the strip doesn't scroll
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    strip.addEventListener('touchmove', hold, { passive: false });
  }

  /* ---- slide mode (11-slide-selected.png, r05): a tap on the current slide's cell picks it; the top bar turns into
     ✕, the number picked, and the slide actions; taps on other cells add or drop them. (How the app enters it isn't
     captured yet.) ---- */
  let slideMode = false, clip = [];
  const slideBar = el('div', 'ph-bar ph-bar-slide'), count = el('span', 'ph-count');
  const act = (icon, title, run) => { const b = iconBtn(icon, title, run); b.classList.add('ph-act'); return b; };
  const copySlides = () => { clip = pickedIdx().map(i => slides[i].cloneNode(true)); };
  slideBar.append(iconBtn('close', 'Done', () => setSlideMode(false)), count, el('span', 'ph-gap'),
    act('content_cut', 'Cut', () => { copySlides(); deleteSlides(); }),
    act('content_copy', 'Copy', copySlides),
    act('content_paste', 'Paste', () => { if (!clip.length) return; slideOp(() => { const copies = clip.map(s => { const c = /** @type {HTMLElement} */ (s.cloneNode(true)); boxes(c).forEach(b => { b.id = uid(); }); return c; }); const at = pickedIdx().at(-1) + 1; slides.splice(at, 0, ...copies); cur = at + copies.length - 1; picked = new Set(copies); }); }),
    act('delete', 'Delete', () => deleteSlides()),
    act('select_all', 'Select all', () => { picked = new Set(slides); renderThumbs(); }),
    act('visibility_off', 'Skip slide', () => skipSlides()),
    act('format_color_fill', 'Change background', () => showBgDialog(true)),
    act('view_quilt', 'Layout', () => phoneSheet.open({ title: 'Layout', build(b) { b.append(layoutGrid(name => { phoneSheet.close(); slideOp(() => pickedIdx().forEach(i => applyLayout(slides[i], name))); })); } })));
  bar.after(slideBar);
  function setSlideMode(on) {
    slideMode = on; document.documentElement.classList.toggle('ph-slide', on);
    if (on) { stopEdit(); sel.clear(); drawOverlay(); } else picked = new Set([slides[cur]]);
    renderThumbs();
  }
  function cellTap(j) {
    if (slideMode) {   // add or drop it; the last one can't go
      const s = slides[j];
      if (picked.has(s) && picked.size > 1) { picked.delete(s); if (j === cur) go(pickedIdx()[0], true); else renderThumbs(); }
      else if (!picked.has(s)) { picked.add(s); go(j, true); }
      return;
    }
    if (j === cur) setSlideMode(true); else go(j);
  }
  const phoneState0 = phoneState;
  phoneState = st => { if (slideMode) setSlideMode(false); phoneState0(st); };
  stage.addEventListener('pointerdown', () => { if (slideMode) setSlideMode(false); }, true);   // touching the slide leaves slide mode

  /* ---- Add slide (12-new-slide-layouts.png): the layouts in two columns, full screen ---- */
  const PHT = { title: 'Double tap to add title', sub: 'Double tap to add subtitle', body: 'Double tap to add text' };
  function layoutPic(lay) {   // the layout's placeholders as the app draws them: outlined boxes with their prompt
    const list = theme().layouts?.[lay[0]] || lay[2];
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><rect width="${W}" height="${H}" fill="#fff"/>` +
      (lay[0] === 'section-description' ? `<rect x="${W / 2}" width="${W / 2}" height="${H}" fill="#eee"/>` : '') +
      list.map(([role, x, y, w, h, pt, , ta]) => {
        const text = lay[0] === 'big-number' && role === 'title' ? 'xx%' : PHT[role], fs = Math.min(pt * 2.67, (w - 40) / (text.length * .5)), tx = ta === 'center' ? x + w / 2 : x + 20, anchor = ta === 'center' ? 'middle' : 'start';
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#9aa0a6" stroke-width="4"/>` +
          `<text x="${tx}" y="${y + Math.min(h - 10, fs * 1.2)}" font-size="${fs}" text-anchor="${anchor}" fill="${role === 'title' ? '#000' : '#5f6368'}" font-family="Arial">${text}</text>`;
      }).join('') + '</svg>';
  }
  function layoutGrid(pick) {
    const g = el('div', 'ph-layouts');
    for (const lay of LAYOUTS) {
      const t = el('button', 'ph-layout', layoutPic(lay) + '<span></span>'); t.dataset.layout = lay[0];
      t.querySelector('span').textContent = lay[1]; t.onclick = () => pick(lay[0]); g.append(t);
    }
    return g;
  }
  const addSlide = el('div', 'ph-addslide'); addSlide.id = 'ph-addslide'; addSlide.hidden = true;
  const head = el('div', 'ph-addslide-head', '<span>Add slide</span>'), shut = iconBtn('close', 'Close', () => { addSlide.hidden = true; });
  head.append(shut);
  addSlide.append(head, layoutGrid(name => { addSlide.hidden = true; newSlideWith(name); }));
  document.body.append(addSlide);
  add.onclick = () => { addSlide.hidden = false; addSlide.lastElementChild.scrollTop = 0; };

  /* ---- the toolbar under the filmstrip (above the keyboard while typing): text, or a shape's fill and border ---- */
  const tools = el('div', 'ph-tools'), textTools = el('div', 'ph-tools-text'), shapeTools = el('div', 'ph-tools-shape');
  tools.id = 'ph-tools';
  const toggle = (icon, title, id) => { const b = iconBtn(icon, title, () => { $(id).click(); syncTools(); }); b.dataset.mirror = id; return b; };
  const swatch = (icon, title, what) => {   // a colour button with the colour under it; it opens the colour panel (phone-sheets.js)
    const b = iconBtn(icon, title, () => phoneColors(what)); b.dataset.for = what; b.classList.add('ph-swatch'); b.append(el('i', 'ph-bar-color')); return b;
  };
  const align = (a, icon, title) => { const b = iconBtn(icon, title, () => { setAlign(a); syncTools(); }); b.dataset.align = a; return b; };
  // in the side rails the three align buttons are one, which opens them as a menu (the column has room for fewer buttons)
  const alignOne = iconBtn('format_align_left', 'Align', e => menuAt(e.currentTarget, [['left', 'Left'], ['center', 'Center'], ['right', 'Right']].map(([a, label]) => ({ label, on: () => curAlign() === a, run: () => { setAlign(a); syncTools(); } }))));
  alignOne.classList.add('ph-rail-only', 'ph-align-one');
  textTools.append(toggle('format_bold', 'Bold', '#ed-bold'), toggle('format_italic', 'Italic', '#ed-italic'), toggle('format_underlined', 'Underline', '#ed-underline'),
    swatch('format_color_text', 'Text color', 'color'), swatch('ink_highlighter', 'Highlight color', 'hilite'), el('i', 'ph-sep'),
    align('left', 'format_align_left', 'Left'), align('center', 'format_align_center', 'Center'), align('right', 'format_align_right', 'Right'), alignOne);
  shapeTools.append(swatch('format_color_fill', 'Fill color', 'fill'), swatch('border_color', 'Border color', 'stroke'), iconBtn('line_weight', 'Border weight', e => menuAt(e.currentTarget, [1, 2, 3, 4, 8, 12, 16, 24].map(v => ({ label: v + 'px', on: () => curSw() === v, run: () => { setVar('--sw', v + 'px'); commit(); } })))));
  // the side rails' format column: ✓ (done) on top, and Cut, Copy, Paste, Delete in its ⋯ (the edit menu's, phone-touch.js)
  const railDone = iconBtn('check', 'Done', () => done.click()), railEdit = iconBtn('more_horiz', 'Cut, copy, paste, delete', e => menuAt(e.currentTarget, phoneClipActions().map(([label, run]) => ({ label, run }))));
  railDone.classList.add('ph-rail-only', 'ph-done'); railEdit.classList.add('ph-rail-only');
  tools.append(railDone, textTools, shapeTools, railEdit);
  film.after(tools);
  const kind = () => {
    const b = sel.size === 1 ? [...sel][0] : null;
    if (editing) return 'text';
    if (!b || isMedia(b) || isGroup(b)) return '';
    if (isLine(b)) return 'shape';
    return b.dataset.shape ? 'shape' : 'text';
  };
  function syncTools() {
    textTools.querySelectorAll('[data-mirror]').forEach(b => b.classList.toggle('on', $(/** @type {HTMLElement} */ (b).dataset.mirror).classList.contains('on')));
    const a = sel.size ? curAlign() : '';
    textTools.querySelectorAll('[data-align]').forEach(b => b.classList.toggle('on', /** @type {HTMLElement} */ (b).dataset.align === a));
    alignOne.querySelector('.icon').textContent = `format_align_${['center', 'right'].includes(a) ? a : 'left'}`;
    tools.querySelectorAll('.ph-swatch').forEach(b => { /** @type {HTMLElement} */ (b.querySelector('.ph-bar-color')).style.background = $('#ed-' + /** @type {HTMLElement} */ (b).dataset.for).value; });
  }
  function showTools() {
    const k = kind(), root = document.documentElement;
    root.classList.toggle('ph-tools-text', k === 'text'); root.classList.toggle('ph-tools-shape', k === 'shape');
    root.classList.toggle('ph-typing', !!editing);
    if (k) syncTools();
    if (phoneLayout('float')) requestAnimationFrame(floatTools);
  }
  /* layout "float": the format bar sits just above the selection (below it when there's no room), not at the bottom */
  function floatTools() {
    const box = ui.querySelector('.sel-box') || (editing && editing), r = box?.getBoundingClientRect();
    if (!r || editing || !kind() || rails()) { tools.style.top = tools.style.left = ''; return; }   // the side rails keep it in its column
    const top = $('#ph-top').getBoundingClientRect().bottom, w = tools.offsetWidth, h = tools.offsetHeight, knob = 56;
    let y = r.top - knob - h; if (y < top + 8) y = r.bottom + 16;
    tools.style.top = Math.min(y, innerHeight - h - 8) + 'px';
    tools.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)) + 'px';
  }
  /* layout "thumb": the deck's title on top, the actions in a pill above the filmstrip, where a thumb reaches */
  if (phoneLayout('thumb')) {
    const dock = el('div', 'ph-dock'), title = el('span', 'ph-doc-title');
    const name = () => { title.textContent = $('#ed-title').value || 'Untitled presentation'; };
    $('#ed-title').addEventListener('input', name);
    const renderThumbs1 = renderThumbs; window['renderThumbs'] = () => { renderThumbs1(); name(); };   // the title arrives with the deck
    ['Undo', 'Redo', 'Insert', 'Present', 'Comments'].forEach(t => dock.append(bar.querySelector(`[title="${t}"]`)));
    bar.querySelector('.ph-gap').replaceWith(title);
    film.before(dock);
    /* in landscape, side rails: no top bar; the filmstrip runs down the left, and the pill stands
       on the right with back (✓ with a selection) on top and ⋯ below; a text box or shape selected turns the column into
       its format controls (#ph-tools). phone.css lays it out under html.ph-rails. */
    const railBack = iconBtn('arrow_back', 'Back to the slides', () => back.click()), railDone2 = iconBtn('check', 'Done', () => done.click()), railMore = iconBtn('more_horiz', 'More', more);
    railBack.classList.add('ph-rail-only', 'ph-rail-back'); railDone2.classList.add('ph-rail-only', 'ph-done'); railMore.classList.add('ph-rail-only');
    dock.prepend(railBack, railDone2); dock.append(railMore);
    const wide = matchMedia('(orientation: landscape)');
    const setRails = () => { document.documentElement.classList.toggle('ph-rails', wide.matches); showTools(); fillFilm(); };
    wide.addEventListener('change', setRails); setRails();
  }
  new ResizeObserver(() => fit()).observe(stage);   // the keyboard and typing change the canvas's size; a toolbar alone doesn't
  const updateToolbar0 = updateToolbar;
  window['updateToolbar'] = () => { updateToolbar0(); if (kind()) syncTools(); };
})();
