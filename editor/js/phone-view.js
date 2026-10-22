/* ---------- phone: states and view mode ---------- */
/* On a phone a deck opens in view mode, as the Slides app: a top bar (back; present, search, share, comments, ⋯) over
   the slides as a vertical list, the current one outlined. Tapping a slide offers "Add comment | Edit slide"; Edit
   slide goes to the editing state (html.ph-edit), whose chrome phone-edit.js builds. Scrolling down hides the bar,
   scrolling up brings it back, and a "Slide N of M" chip shows while the list moves. */
/** @type {(state: 'view' | 'edit') => void} */
let phoneState = () => {};
/** Present from the current slide, phone style (✕ and the title on top). */
let phonePresent = async () => {};
if (PHONE) (() => {
  const el = (tag, cls, html = '') => Object.assign(document.createElement(tag), { className: cls, innerHTML: html });
  const iconBtn = (icon, title, run) => { const b = el('button', 'ph-icon-btn', `<span class="icon">${icon}</span>`); b.title = title; b.onclick = run; return b; };
  const root = document.documentElement;
  const top = el('header', 'ph-top'), list = el('div', 'ph-view'), chip = el('div', 'ph-chip');
  list.id = 'ph-view'; top.id = 'ph-top';
  document.body.prepend(top); document.body.append(list, chip);
  let state = 'view';

  // the top bar of each state; phone-edit.js fills `edit`
  const bars = { view: el('div', 'ph-bar ph-bar-view'), edit: el('div', 'ph-bar ph-bar-edit') };
  bars.view.append(iconBtn('arrow_back_ios_new', 'Back to your decks', () => { location.href = '/'; }), el('span', 'ph-gap'),
    phoneThemeButton(), iconBtn('play_arrow', 'Present', () => phonePresent()), iconBtn('search', 'Find', () => { phoneState('edit'); openFind(); }),
    iconBtn('person_add', 'Share', () => showShare()), iconBtn('comment', 'Comments', () => { phoneState('edit'); setCommentsPanel(true); }),
    iconBtn('more_horiz', 'More', e => viewMenu(/** @type {Element} */ (e.currentTarget))));
  top.append(bars.view, bars.edit);
  /* the page itself never scrolls (each screen scrolls inside): iOS can leave it scrolled up after the keyboard, above
     all in a home-screen app, which hides the top bar under the status bar and leaves a gap at the bottom; so whenever
     nothing is being typed it goes back to the top */
  const typing = () => { const a = document.activeElement; return !!a && (/** @type {HTMLElement} */ (a).isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); };
  const pin = () => { if (typing()) return; if (scrollX || scrollY) scrollTo(0, 0); if (document.body.scrollTop) document.body.scrollTop = 0; };
  addEventListener('scroll', pin, { passive: true }); visualViewport?.addEventListener('resize', pin);
  addEventListener('focusout', () => setTimeout(pin, 120));
  phoneState = s => {
    state = s; stopEdit(); closePop();
    root.classList.toggle('ph-view', s === 'view'); root.classList.toggle('ph-edit', s === 'edit');
    if (s === 'view') { sel.clear(); if (slides.length) drawOverlay(); top.classList.remove('away'); fill(true); } else fit();
  };

  /* ---- the list: one picture per slide, drawn when it comes near the screen (a dark placeholder until then) ---- */
  const drawn = new WeakMap();   // item → the slide HTML it shows
  const near = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) draw(/** @type {HTMLElement} */ (e.target)); }), { root: list, rootMargin: '100% 0px' });
  function draw(item) {
    const s = slides[+item.dataset.i]; if (!s || drawn.get(item) === s.outerHTML) return;
    drawn.set(item, s.outerHTML);
    const k = item.clientWidth / W, inner = div('ph-vslide-canvas slides'), c = s.cloneNode(true);
    inner.style.cssText = `width:${W}px;height:${H}px;transform:scale(${k})`;
    paintBg(inner, s);
    c.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
    c.querySelectorAll('aside.notes, script, .box.note').forEach(e => e.remove());   // speaker notes and notes for AI stay out of view mode
    c.querySelectorAll('.box[data-shape]').forEach(renderShape); c.querySelectorAll('.box[data-shadow]').forEach(shadeBox); c.querySelectorAll('.box[data-crop]').forEach(cropBox);
    inner.append(c); item.replaceChildren(inner); item.classList.add('drawn');
    highlightCode(c); renderMath(c);
  }
  let filled = false;
  function fill(scrollToCur = false) {
    if (state !== 'view' || !slides.length) return;
    if (!filled) { filled = scrollToCur = true; }
    while (list.children.length > slides.length) list.lastChild.remove();
    while (list.children.length < slides.length) { const it = el('div', 'ph-vslide reveal'); it.dataset.i = String(list.children.length); list.append(it); near.observe(it); }
    [...list.children].forEach((it, i) => { /** @type {HTMLElement} */ (it).style.aspectRatio = `${W} / ${H}`; it.classList.toggle('cur', i === cur); if (it.classList.contains('drawn')) draw(/** @type {HTMLElement} */ (it)); });
    if (scrollToCur) { quietUntil = Date.now() + 200; list.children[cur]?.scrollIntoView({ block: 'nearest' }); }
  }
  const renderThumbs0 = renderThumbs;   // the list follows the deck as the filmstrip does (loads, reloads from disk)
  window['renderThumbs'] = () => { renderThumbs0(); fill(); };
  addEventListener('resize', () => { [...list.children].forEach(it => drawn.delete(it)); fill(); });

  /* ---- scrolling: the bar hides going down and comes back going up; the chip says where you are ---- */
  let lastY = 0, chipTimer = 0, quietUntil = 0;   // quiet: a scroll of our own (to the current slide) leaves the bar be
  list.addEventListener('scroll', () => {
    const y = list.scrollTop, d = y - lastY; lastY = y;
    if (Date.now() < quietUntil) return;
    if (y <= 0 || d < -4) top.classList.remove('away'); else if (d > 4 && y > 60) top.classList.add('away');
    const mid = list.getBoundingClientRect().top + list.clientHeight / 3;
    const i = [...list.children].findIndex(it => it.getBoundingClientRect().bottom > mid);
    chip.textContent = `Slide ${Math.max(0, i) + 1} of ${slides.length}`;
    chip.classList.add('on'); clearTimeout(chipTimer); chipTimer = window.setTimeout(() => chip.classList.remove('on'), 1000);
    closePop();
  }, { passive: true });

  /* ---- tap a slide: "Add comment | Edit slide", as the iOS edit menu, over the tap ---- */
  let pop = null;
  function closePop() { pop?.remove(); pop = null; }
  list.addEventListener('click', e => {
    const it = /** @type {HTMLElement} */ (e.target).closest('.ph-vslide'); if (!it || pop) { closePop(); return; }
    const i = +it.dataset.i;
    pop = el('div', 'ph-editmenu');
    const item = (label, run) => { const b = el('button', '', ''); b.textContent = label; b.onclick = ev => { ev.stopPropagation(); closePop(); run(); }; return b; };
    pop.append(item('Add comment', () => { go(i); phoneState('edit'); addComment(); }), item('Edit slide', () => { go(i); phoneState('edit'); }));
    document.body.append(pop);
    const x = Math.max(8, Math.min(e.clientX - pop.offsetWidth / 2, innerWidth - pop.offsetWidth - 8));
    pop.style.left = x + 'px'; pop.style.top = Math.max(top.getBoundingClientRect().bottom + 8, e.clientY - pop.offsetHeight - 24) + 'px';
    if (i !== cur) go(i);
  });

  /* ---- ⋯ : the deck's menu (Google's isn't captured yet; these are Glideshow's) ---- */
  function viewMenu(btn) {
    closeMenu?.();
    const m = el('div', 'menu ph-menu'), items = [['edit', 'Edit', () => phoneState('edit')], ['slideshow', 'Present', () => phonePresent()],
      ['person_add', 'Share', () => showShare()], ['desktop_windows', 'Desktop version', () => { location.href = '/edit?phone=0'; }]];
    for (const [icon, label, run] of items) {
      const b = el('button', 'menu-item', `<span class="menu-icon icon">${icon}</span><span class="menu-label"></span>`);
      b.querySelector('.menu-label').textContent = /** @type {string} */ (label); b.onclick = ev => { ev.stopPropagation(); m.remove(); /** @type {Function} */ (run)(); }; m.append(b);
    }
    document.body.append(m);
    const r = btn.getBoundingClientRect(); m.style.left = innerWidth - m.offsetWidth - 8 + 'px'; m.style.top = r.bottom + 4 + 'px';
    setTimeout(() => addEventListener('pointerdown', ev => { if (!m.contains(/** @type {Node} */ (ev.target))) m.remove(); }, { once: true }));
  }

  /* ---- ▷ : present from the current slide, with ✕ and the title on top (13-present.png; the full flow is P5) ---- */
  /* ▷ (13-present-menu.png, r07): a sheet with no title, "Present on this device" (Google's casting and meeting rows
     aren't Glideshow's). Presenting (13-present.png): the slide on black, centred on the whole screen; a bar with ✕
     and the title, which slides away once the slide shows and comes back on a tap. A tap advances (instant, with the
     slide's builds); a swipe goes forward or back. ✕ returns to the editor on the slide last shown. */
  phonePresent = async () => phoneSheet.open({ title: '', bare: true, build(body) {
    const r = el('button', 'ph-row', '<span class="icon">smartphone</span><span class="ph-row-label">Present on this device</span>');
    r.onclick = () => { phoneSheet.close(); startShow(); }; body.append(r);
  } });
  async function startShow() {
    await present(cur);
    const show = $('#ed-show'), frameEl = show.querySelector('iframe'), deck = () => /** @type {any} */ (frameEl.contentWindow)?.Reveal;
    const bar = el('div', 'ph-show-bar'), t = el('span', 'ph-show-title'), count = el('span', 'ph-show-count'), touch = el('div', 'ph-show-touch');
    t.textContent = $('#ed-title').value || 'Untitled presentation';
    const stop = () => { const i = deck()?.getIndices?.(); endPresent(i?.h, i?.v); };
    bar.append(iconBtn('close', 'Stop presenting', stop), t, count);
    // the bar shows on a tap and goes again on its own; Thermal shows "n / N" in it (the app shows the title)
    /** @type {any} */ let hide = 0; const peek = () => { bar.classList.remove('away'); clearTimeout(hide); hide = setTimeout(() => bar.classList.add('away'), 2200); };
    const counted = () => { const d = deck(); if (d?.getTotalSlides) count.textContent = `${d.getSlidePastCount() + 1} / ${d.getTotalSlides()}`; };
    show.append(touch, bar);
    frameEl.addEventListener('load', () => {
      const st = frameEl.contentDocument?.createElement('style');   // the app's look: black around the slide, no controls of the deck's own
      if (st) { st.textContent = '.sl-bar, .reveal .backgrounds { display: none !important; } html, body, .reveal-viewport, .reveal { background: #000 !important; }'; frameEl.contentDocument.head.append(st); }
      deck()?.configure?.({ scrollActivationWidth: 1 }); deck()?.layout?.();
      deck()?.getSlides?.().forEach(sl => {   // each slide wears its own background, so only the letterbox is black
        const bg = deck().getSlideBackground(sl), cs = bg && frameEl.contentWindow.getComputedStyle(bg);
        if (cs) Object.assign(sl.style, { backgroundColor: cs.backgroundColor, backgroundImage: cs.backgroundImage, backgroundSize: cs.backgroundSize, backgroundPosition: cs.backgroundPosition, backgroundRepeat: cs.backgroundRepeat });
      });   // reveal.js 5 scrolls the slides on a screen under 435 px wide (and null doesn't turn that off): the app shows one, letterboxed
      deck()?.on?.('slidechanged', counted); counted();
      setTimeout(() => bar.classList.add('away'), 600);   // r07: the bar goes once the slide is up
    }, { once: true });
    let x0 = 0, y0 = 0;
    touch.onpointerdown = e => { x0 = e.clientX; y0 = e.clientY; };
    touch.onpointerup = e => {
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) deck()?.next(); else deck()?.prev(); return; }   // a swipe
      if (Math.hypot(dx, dy) < 10) { peek(); deck()?.next(); }   // a tap: the bar comes back for a moment, and on to the next
    };
  }
  let fresh = false; try { fresh = sessionStorage.getItem('ph-open-edit') === '1'; sessionStorage.removeItem('ph-open-edit'); } catch {}
  phoneState(fresh ? 'edit' : 'view');   // a deck just made with + opens for editing; others open to view, as the app
})();
