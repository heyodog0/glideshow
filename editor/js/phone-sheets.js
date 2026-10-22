/* ---------- phone: bottom sheets, and the Insert sheet ---------- */
/* A sheet rises over the bottom 442 pt of the screen while the editor slides up to keep the slide in view (the top bar
   goes off the top), with no scrim and no grab handle. Its pages push in from the right, iOS style, under a header with
   the page's title (and ‹ back on pushed pages). A tap on the canvas closes it. The Insert sheet (+ in the top bar):
   Comment, Text, Image ›, Shape ›, Line ›, Table ›, Link. */
/** @type {{ open: (page: any) => void, push: (page: any) => void, close: () => void, isOpen: () => boolean }} */
let phoneSheet = { open: () => {}, push: () => {}, close: () => {}, isOpen: () => false };
/** The Insert sheet. */
let phoneInsert = () => {};
/** A colour panel: 'color' (text), 'hilite', 'fill' or 'stroke' (border). @type {(what: string) => void} */
let phoneColors = () => {};
if (PHONE) (() => {
  const el = (tag, cls, html = '') => Object.assign(document.createElement(tag), { className: cls, innerHTML: html });
  const root = document.documentElement;
  const sheet = el('div', 'ph-sheet'); sheet.id = 'ph-sheet';
  document.body.append(sheet);
  const moving = () => ['#ph-top', 'main', '#ph-film', '#ph-tools', '#ph-view'].map(s => /** @type {HTMLElement} */ ($(s))).filter(Boolean);
  let stack = [];

  /* a page: { title, build(body) }; rows are [icon, label, run, more?] */
  function pageEl(page, back) {
    const p = el('div', 'ph-page'), head = el('div', 'ph-page-head'), body = el('div', 'ph-page-body');
    if (back) { const b = el('button', 'ph-icon-btn ph-back', '<span class="icon">arrow_back_ios_new</span>'); b.title = 'Back'; b.onclick = pop; head.append(b); }
    head.append(Object.assign(el('div', 'ph-page-title'), { textContent: page.title }));
    page.build(body);
    if (page.bare) p.append(body); else p.append(head, body);   // bare: rows from the top, no header (13-present-menu.png)
    return p;
  }
  function open(page) {
    stack = [page]; sheet.replaceChildren(pageEl(page, false));
    root.classList.add('ph-sheet-open');
    // the editor slides up so the slide sits in the space above the sheet
    const f = (root.classList.contains('ph-view') ? $('#ph-view .ph-vslide.cur') || frame : frame).getBoundingClientRect(), top = innerHeight - sheet.offsetHeight, safe = parseFloat(getComputedStyle(root).getPropertyValue('--ph-safe-top')) || 0;
    const shift = Math.max(0, (f.top + f.bottom) / 2 - (safe + top) / 2);
    moving().forEach(e => { e.style.transform = `translateY(${-shift}px)`; });
  }
  function push(page) {
    const p = pageEl(page, true), was = /** @type {HTMLElement} */ (sheet.lastElementChild);
    stack.push(page); p.classList.add('in'); sheet.append(p);
    requestAnimationFrame(() => { p.classList.remove('in'); was?.classList.add('out'); });
    setTimeout(() => was?.remove(), 260);
  }
  function pop() {
    if (stack.length < 2) return close();
    stack.pop(); const page = stack[stack.length - 1], cur = sheet.lastElementChild, p = pageEl(page, stack.length > 1);
    p.classList.add('out'); sheet.prepend(p);
    requestAnimationFrame(() => { p.classList.remove('out'); cur?.classList.add('in'); });
    setTimeout(() => cur?.remove(), 260);
  }
  function close() {
    if (!stack.length) return;
    stack = []; root.classList.remove('ph-sheet-open');
    moving().forEach(e => { e.style.transform = ''; });
    setTimeout(() => { if (!stack.length) sheet.replaceChildren(); }, 260);
  }
  phoneSheet = { open, push, close, isOpen: () => stack.length > 0 };
  stage.addEventListener('pointerdown', e => { if (stack.length) { e.stopImmediatePropagation(); e.preventDefault(); close(); } }, true);   // a tap on the canvas closes it

  const rows = (body, list) => list.forEach(([icon, label, run, more, off]) => {
    const r = el('button', 'ph-row', `<span class="icon">${icon}</span><span class="ph-row-label"></span>${more ? '<span class="icon ph-more">chevron_right</span>' : ''}`);
    r.querySelector('.ph-row-label').textContent = label; r.disabled = !!off; r.onclick = run; body.append(r);
  });
  const done = run => () => { close(); run(); };

  /* ---- Insert ---- */
  const S = 0.4;   // a new shape: a square 0.4 of the slide's width, centred (r04)
  const addSquare = (v, extra) => { const s = W * S; const b = addShape(v, { x: (W - s) / 2, y: (H - s) / 2, w: s, h: s }, extra); sel = new Set([b]); drawOverlay(); updateToolbar(); };
  const shapePage = {
    title: 'Shape',
    build(body) {
      const tabs = el('div', 'ph-tabs'), grid = el('div', 'ph-shape-grid');
      const show = i => {
        tabs.querySelectorAll('button').forEach((t, j) => t.classList.toggle('on', i === j));
        grid.replaceChildren(...SHAPE_GROUPS[i][2].filter(it => it !== '-').map(([v, label, extra]) => {
          const c = el('button', 'ph-shape-cell', shapePic(v, extra)); c.title = label; c.onclick = done(() => addSquare(v, extra)); return c;
        }));
      };
      SHAPE_GROUPS.forEach(([label], i) => { const t = el('button', ''); t.textContent = label; t.onclick = () => show(i); tabs.append(t); });
      body.append(tabs, grid); show(0);
    },
  };
  const LINES = [['line', 'Line', 'pen_size_2'], ['arrowline', 'Arrow', 'arrow_right_alt'], ['elbow', 'Elbow connector', 'turn_right'], ['curve', 'Curved connector', 'conversion_path']];
  const linePage = {
    title: 'Line',
    build(body) {
      rows(body, LINES.map(([v, label, icon]) => [icon, label, done(() => { const b = addShape(v); sel = new Set([b]); drawOverlay(); updateToolbar(); })]));
      rows(body, [['gesture', 'Curve', done(() => armShape('smooth'))], ['polyline', 'Polyline', done(() => armShape('polyline'))], ['draw', 'Scribble', done(() => armShape('scribble'))]]);
    },
  };
  const imagePage = { title: 'Image', build(body) { rows(body, [['photo_library', 'Photos', done(() => $('#ed-file').click())], ['movie', 'Video', done(() => $('#ed-video-file').click())]]); } };
  const tablePage = { title: 'Table', build(body) { const g = tableGrid(); g.classList.add('ph-table-pick'); g.addEventListener('click', () => close()); body.append(g); } };
  /* ---- the colour panels (r03, r04): a hue strip; under it the greys (5 × 2) or the chosen hue's shades (4 × 2);
     the theme's colours; the custom ones. The colour in use has a check in its corner. The panel stays open. ---- */
  const ROWS = Array.from({ length: 8 }, (_, r) => PALETTE.slice(r * 10, r * 10 + 10).map(c => c.toLowerCase()));   // the Docs palette: greys, hues, light 3, 2, 1, dark 1, 2, 3
  const HUES = ROWS[1], shades = i => [ROWS[7][i], ROWS[6][i], ROWS[5][i], ROWS[1][i], ROWS[4][i], ROWS[3][i], ROWS[2][i], '#ffffff'];
  const TITLES = { color: 'Text color', hilite: 'Highlight color', fill: 'Fill color', stroke: 'Border color' };
  const hueOf = c => { for (let i = 0; i < HUES.length; i++) if (shades(i).slice(0, 7).includes(c)) return i; return -1; };
  phoneColors = what => {
    const input = $('#ed-' + what);
    const current = () => {
      const b = [...sel][0];
      if (what === 'fill' && b && /^(transparent|none)$/.test(b.style.getPropertyValue('--fill').trim())) return 'none';
      if (what === 'stroke' && b && parseFloat(b.style.getPropertyValue('--sw')) === 0) return 'none';
      if (what === 'hilite') return '';
      return String(input.value).toLowerCase();
    };
    let hue = -2;   // -2: follow the colour in use; -1: the greys; else a hue
    const pick = c => { if (c === 'none') { if (what === 'hilite') hilite('transparent'); else if (what === 'fill') { setVar('--fill', 'transparent'); commit(); } else noBorder(); } else setColor(input, c); };
    const swatch = (c, cur) => {
      const b = el('button', 'ph-swatch-cell' + (c === cur ? ' on' : '')); b.style.background = c; b.title = c;
      b.onclick = () => { pick(c); paint(); }; return b;
    };
    let body = null;
    function paint() {
      const cur = current(), h = hue === -2 ? hueOf(cur) : hue;
      body.replaceChildren();
      if (what !== 'color') {
        const none = el('button', 'ph-row ph-none' + (cur === 'none' ? ' on' : ''), '<span class="icon">format_color_reset</span><span class="ph-row-label">No color</span><span class="icon ph-check">check</span>');
        none.onclick = () => { pick('none'); paint(); }; body.append(none);
      }
      const strip = el('div', 'ph-hues');
      [-1, ...HUES.map((_, i) => i)].forEach(i => {
        const seg = el('button', 'ph-hue' + (i === h ? ' on' : '')); seg.style.background = i < 0 ? '#000' : HUES[i];
        seg.title = i < 0 ? 'Greys' : HUES[i]; seg.onclick = () => { hue = i; paint(); }; strip.append(seg);
      });
      const grid = el('div', 'ph-swatches ' + (h < 0 ? 'five' : 'four'));
      (h < 0 ? ROWS[0] : shades(h)).forEach(c => grid.append(swatch(c, cur)));
      const theme = el('div', 'ph-swatches five'); THEME_COLORS.forEach(c => theme.append(swatch(c.toLowerCase(), cur)));
      const custom = el('div', 'ph-swatches custom'), add = el('button', 'ph-swatch-cell ph-add', '<span class="icon">add</span>');
      add.title = 'Custom colour'; add.onclick = () => { input.addEventListener('change', () => { rememberColor(input.value); paint(); }, { once: true }); input.click(); };
      custom.append(add, ...recentColors().map(c => swatch(c.toLowerCase(), cur)));
      body.append(strip, grid, Object.assign(el('div', 'ph-label'), { textContent: 'Theme' }), theme, Object.assign(el('div', 'ph-label'), { textContent: 'Custom' }), custom);
    }
    if (editing) content(editing).blur();   // the keyboard makes way for the panel; the text selection is kept (lastRange)
    open({ title: TITLES[what], build(b) { body = b; paint(); } });
  };

  phoneInsert = () => open({
    title: 'Insert',
    build(body) {
      const typing = !!editing && !getSelection().isCollapsed;
      rows(body, [
        ['add_comment', 'Comment', done(() => addComment())],
        ['insert_text', 'Text', done(() => { stopEdit(); startEdit(addText()); })],
        ['image', 'Image', () => push(imagePage), true],
        ['interests', 'Shape', () => push(shapePage), true],
        ['diagonal_line', 'Line', () => push(linePage), true],
        ['table', 'Table', () => push(tablePage), true],
        ['link', 'Link', done(() => $('#ed-link').click()), false, !typing],
      ]);
    },
  });
})();
