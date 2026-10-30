/* Presenting keys as Google Slides, for every deck (copied into <script id="deck-present"> on save, like
   shapes.js). a click advances, B / W black or white screen, L laser pointer, a slide number then ⏎ to jump, ⏎ next, Esc to
   leave (back to the editor when presenting from it), M a note for the AI (from the editor), F fullscreen and S speaker notes from reveal.js.
   Turns off reveal.js defaults Slides doesn't have: O / Esc overview, V pause, ? help. */
(function () {
  if (!window.Reveal) return;

  /* Morph (data-auto-animate on a slide): reveal's Auto-Animate from the slide before, which needs the attribute too.
     Boxes pair by data-morph (Duplicate slide sets it to the original's id), else by their own id.
     Builds by paragraph (data-build="paragraph" on an animated text box): each paragraph or list item is its own step,
     with the box's effect, and the slide's later steps move back to make room; "highlight" too, dimming the ones before
     the current one; a table by "row", "column" or "cell" the same way. By "word" or "character" stays one step, the
     text arriving a word or letter at a time over the build's duration. */
  /* By word / by character: each word (or letter, kept within its word so lines break as before) in a span that arrives
     with the box's effect, one after another over the build's duration. Out and emphasis effects stay whole. */
  const FROM = { appear: 'none', 'fade-in': 'none', 'fade-right': 'translateX(-1em)', 'fade-left': 'translateX(1em)', 'fade-up': 'translateY(.8em)', 'fade-down': 'translateY(-.8em)', 'zoom-in': 'scale(.1)', 'scale-in': 'scale(0)', 'pop-in': 'scale(0)', 'spin-in': 'rotate(-360deg)', 'scale-big': 'scale(3)', 'drift-in': 'translateX(-2em)', 'drift-scale': 'scale(.25)', 'fade-move-in': 'translateX(-1em)', 'fade-scale': 'scale(.85)', 'twist-scale': 'scale(2.5) rotate(-15deg)' };
  const wordByWord = (box, mode, cls) => {
    const eff = cls.find(c => c in FROM); if (!eff || cls.length > 1) return;
    const texts = [], tw = document.createTreeWalker(box.querySelector(':scope > .content') || box, NodeFilter.SHOW_TEXT);
    for (let n; (n = tw.nextNode());) if (n.data.trim()) texts.push(n);
    let i = 0; const spans = [];
    for (const t of texts) {
      const frag = document.createDocumentFragment();
      for (const piece of t.data.split(/(\s+)/)) {
        if (!piece) continue;
        if (/^\s+$/.test(piece)) { frag.append(piece); continue; }
        const word = document.createElement('span');
        if (mode === 'word') { word.className = 'gs-w'; spans.push(word); i++; word.textContent = piece; }
        else { word.className = 'gs-word'; for (const ch of piece) { const c = document.createElement('span'); c.className = 'gs-w'; spans.push(c); i++; c.textContent = ch; word.append(c); } }
        frag.append(word);
      }
      t.replaceWith(frag);
    }
    /* data-text-order (Keynote's Forward / Backward / From Center / From Edges / Random): the order the words or letters come in */
    const mid = (spans.length - 1) / 2, order = box.dataset.textOrder, key = k => order === 'backward' ? -k : order === 'center' ? Math.abs(k - mid) : order === 'edges' ? -Math.abs(k - mid) : order === 'random' ? ((k * 2654435761) % 1013) : k;
    spans.map((s, k) => [s, key(k), k]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).forEach(([s], r) => s.style.setProperty('--i', String(r)));
    const total = (+box.dataset.duration || 1) * 1000, step = total / Math.max(1, i);
    box.classList.add('gs-seq');
    box.style.cssText += `;--gs-step:${step}ms;--gs-d:${eff === 'appear' ? 0 : Math.min(total, Math.max(200, step * 3))}ms;--gs-from:${FROM[eff]};--gs-ease:${box.dataset.ease || 'ease'};transition-duration:${total}ms`;
  };
  /* Magic Move's Match by word / by character (data-morph-match on the slide): the text of its boxes and of the slide
     before's in spans, so each word (or letter, kept within its word) moves from where it was in the box this one
     continues, and new ones fade in. Not in boxes built by word or character. */
  const morphSplit = (box, mode) => {
    if (box.querySelector('.gs-mw') || /^(word|character)$/.test(box.dataset.build || '')) return;
    const texts = [], tw = document.createTreeWalker(box.querySelector(':scope > .content') || box, NodeFilter.SHOW_TEXT);
    for (let n; (n = tw.nextNode());) if (n.data.trim() && !n.parentElement?.closest('svg, style, script, .gs-mw')) texts.push(n);
    for (const t of texts) {
      const frag = document.createDocumentFragment();
      for (const piece of t.data.split(/(\s+)/)) {
        if (!piece) continue;
        if (/^\s+$/.test(piece)) { frag.append(piece); continue; }
        const word = document.createElement('span');
        if (mode === 'word') { word.className = 'gs-mw'; word.textContent = piece; }
        else { word.className = 'gs-word'; for (const ch of piece) word.append(Object.assign(document.createElement('span'), { className: 'gs-mw', textContent: ch })); }
        frag.append(word);
      }
      t.replaceWith(frag);
    }
  };
  /* Morph's pairs: boxes by data-id (a group's inner boxes measured within the group), not reveal's default of also pairing
     paragraphs by their text, which moved a box's text twice as far as the box; then, on a slide matching by word or
     character, the words (letters) of each pair of boxes, measured within their box. */
  Reveal.configure({ autoAnimateMatcher: function (from, to) {
    const pairs = [], scale = Reveal.getScale(), within = box => e => { let x = 0, y = 0;
      for (let n = e; n && n !== box; n = /** @type {HTMLElement} */ (n.offsetParent)) { x += n.offsetLeft; y += n.offsetTop; }
      return { x: x * scale, y: y * scale, width: e.offsetWidth * scale, height: e.offsetHeight * scale }; };
    this.findAutoAnimateMatches(pairs, from, to, ':scope > .box[data-id]', e => e.dataset.id);
    for (const p of [...pairs]) this.findAutoAnimateMatches(pairs, p.from, p.to, '.box[data-id]', e => e.dataset.id, { measure: e => within(e.parentElement.closest('.box'))(e) });
    if (/^(word|character)$/.test(to.dataset.morphMatch || ''))
      for (const p of [...pairs]) this.findAutoAnimateMatches(pairs, p.from, p.to, '.gs-mw', e => e.closest('.box') === p.from || e.closest('.box') === p.to ? e.textContent : null,
        { scale: false, measure: e => within(e.closest('.box'))(e) });
    return pairs;
  } });
  /* More than one build on a box (D12, Keynote's chained actions): data-builds="effect key=value …; …", e.g.
     "move-to to=1400,300; spin angle=90 start=after; fade-out". Each is a build of its own after the box's own one (start:
     click, the default, a step of its own; with, the same step; after, its own step that starts by itself). At load each
     becomes a wrapper round the box carrying that build, so the effects compose; a Move goes on from where the one
     before it ended. Keys: to (a Move's end, the box's top-left there), angle, duration, delay, ease, start. */
  const parseBuilds = t => (t || '').split(';').map(x => x.trim()).filter(Boolean).map(x => { const [eff, ...kv] = x.split(/\s+/); return { eff, ...Object.fromEntries(kv.map(p => p.split('='))) }; });
  const wrapBuilds = sl => sl.querySelectorAll(':scope > .box[data-builds]').forEach(box => {
    const list = parseBuilds(box.dataset.builds), st = box.style; if (!list.length) return;
    let at = box.classList.contains('fragment') ? +(box.dataset.fragmentIndex ?? 0) : -1, x = parseFloat(st.left) || 0, y = parseFloat(st.top) || 0;
    const end = (box.dataset.to || '').split(',').map(Number); if (box.classList.contains('move-to') && end.length === 2 && end.every(isFinite)) [x, y] = end;
    const geom = { left: st.left, top: st.top, width: st.width, height: st.height }; box.dataset.gsAt = `${parseFloat(st.left) || 0},${parseFloat(st.top) || 0}`; st.left = st.top = '0px';   // (its own Move still measured from there)
    let inner = box;
    for (const b of list) {
      const w = document.createElement('div'); w.className = 'gs-build fragment ' + b.eff;
      Object.assign(w.style, { position: 'absolute', left: '0px', top: '0px', width: geom.width, height: geom.height });
      inner.replaceWith(w); w.append(inner);
      if (inner !== box) { inner.style.left = inner.style.top = '0px'; }
      if (b.start !== 'with') { at++; sl.querySelectorAll('.fragment').forEach(f => { if (f !== w && !f.contains(w) && +(f.dataset.fragmentIndex ?? -1) >= at) f.dataset.fragmentIndex = String(+f.dataset.fragmentIndex + 1); }); }
      w.dataset.fragmentIndex = String(Math.max(0, at));
      if (b.start === 'after') w.dataset.start = 'after';
      for (const k of ['duration', 'delay', 'ease', 'angle']) if (b[k]) w.dataset[k] = b[k];
      const to = (b.to || '').split(',').map(Number);
      if (b.eff === 'move-to' && to.length === 2 && to.every(isFinite)) { w.style.setProperty('--gs-mx', to[0] - x + 'px'); w.style.setProperty('--gs-my', to[1] - y + 'px'); [x, y] = to; }
      inner = w;
    }
    Object.assign(inner.style, { left: geom.left, top: geom.top });   // the outermost wrapper sits where the box did
  });
  const prepare = () => {
    const all = Reveal.getSlides();
    all.forEach(wrapBuilds);
    all.forEach((sl, i) => { if (sl.hasAttribute('data-auto-animate') && all[i - 1] && !all[i - 1].hasAttribute('data-auto-animate')) all[i - 1].setAttribute('data-auto-animate', ''); });
    document.querySelectorAll('.reveal .slides .box').forEach(b => { if (!b.dataset.id) b.dataset.id = b.dataset.morph || b.id; });
    all.forEach((sl, i) => { const m = sl.dataset.morphMatch; if (sl.hasAttribute('data-auto-animate') && all[i - 1] && /^(word|character)$/.test(m || ''))
      [sl, all[i - 1]].forEach(s => s.querySelectorAll('.box').forEach(b => morphSplit(b, m))); });
    let changed = false;
    all.forEach(sl => {
      const frags = [...sl.querySelectorAll('.box.fragment[data-build]')].sort((a, b) => (+a.dataset.fragmentIndex || 0) - (+b.dataset.fragmentIndex || 0));
      frags.reverse().forEach(box => {   // from the last, so each one's room doesn't move the ones before it
        const mode = box.dataset.build, cls = [...box.classList].filter(c => /^(appear|fade-[\w-]+|zoom-in|wipe-[rldu]|move-in-[rldu]|scale-in|pop-in|spin|pulse|pop|line-draw|line-erase|move-to|blur-in|drop-in|spin-in|iris-in|scale-big|disappear|blur-out|scale-out|iris-out|sparkle-in|shimmer-in|confetti-in|flash-in|fireworks-in|skid-in|swoosh-in|trace-in|lens-in|flame-in|anvil-in|blast-in|bouncy-in|comet-in|drift-in|drift-scale|fade-move-in|fade-scale|blinds-in|cube-in|flip-in|spin-y|pivot-in|twist-scale|squish-in|grow|shrink|strike|semi-fade-out|current-visible|highlight-[\w-]+)$/.test(c));   // its effect
        if (mode === 'word' || mode === 'character') { wordByWord(box, mode, cls); return; }
        /* a table by row / column / cell, each also "-content" (the grid stays, the cells' contents build) and "-reverse"
           (last first): Keynote's 13; text by paragraph (each bullet, sub-bullets too), "group" (a bullet with its
           sub-bullets) or "highlight", from paragraph data-build-from to data-build-to (the rest come with the first / last) */
        const table = box.querySelector(':scope > .content table'), cells = table ? [...table.querySelectorAll('td, th')] : [];
        const base = (mode || '').replace(/-content|-reverse/g, ''), inner = /-content/.test(mode || ''), back = /-reverse/.test(mode || '');
        const cellPart = c => { if (!inner) return c; const w = document.createElement('div'); w.className = 'gs-cc'; w.append(...c.childNodes); c.append(w); return w; };
        const top = ':scope > .content > :is(p, div, h1, h2, h3, h4, h5, h6)', lists = [...box.querySelectorAll(':scope > .content > :is(ul, ol)')];
        let groups = base === 'row' ? [...(table?.rows || [])].map(r => inner ? [...r.cells].map(cellPart) : [r]) : base === 'cell' ? cells.map(c => [cellPart(c)])
          : base === 'column' ? [...new Set(cells.map(c => /** @type {HTMLTableCellElement} */ (c).cellIndex))].sort((a, b) => a - b).map(n => cells.filter(c => /** @type {HTMLTableCellElement} */ (c).cellIndex === n).map(cellPart))
          : base === 'group' ? [...box.querySelectorAll(top + ', :scope > .content > :is(ul, ol) > :is(li, ul, ol)')].reduce((gs, el) => { if (/^(UL|OL)$/.test(el.tagName) && gs.length) gs[gs.length - 1].push(el); else gs.push([el]); return gs; }, /** @type {HTMLElement[][]} */ ([]))
          : [...box.querySelectorAll(top), ...lists.flatMap(l => [...l.querySelectorAll('li')])].sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1).map(p => [p]);
        if (back) groups.reverse();
        if (!table && groups.length > 1) {   // Build from … to …
          const from = Math.min(groups.length, Math.max(1, +box.dataset.buildFrom || 1)), to = Math.min(groups.length, Math.max(from, +box.dataset.buildTo || groups.length));
          groups = to > from ? [groups.slice(0, from).flat(), ...groups.slice(from, to - 1), groups.slice(to - 1).flat()] : [groups.flat()];
        }
        if (groups.length < 2) return;
        const at = +box.dataset.fragmentIndex || 0;
        sl.querySelectorAll('.fragment').forEach(f => { if (f !== box && +f.dataset.fragmentIndex > at) f.dataset.fragmentIndex = String(+f.dataset.fragmentIndex + groups.length - 1); });
        box.classList.remove('fragment', ...cls); delete box.dataset.fragmentIndex;
        groups.forEach((g, i) => g.forEach(el => { el.classList.add('fragment', ...cls); if (mode === 'highlight') el.classList.add('gs-hl'); el.dataset.fragmentIndex = String(at + i);
          for (const k of i ? ['duration', 'ease', 'angle'] : ['duration', 'ease', 'angle', 'delay', 'start']) if (box.dataset[k]) el.dataset[k] = box.dataset[k]; }));   // the box's timing; its start and delay on the first part
        changed = true;
      });
    });
    // a slide's own style (<style class="slide-css" media="not all"> in the slide): applied to that slide only
    let n = 0;
    all.forEach(sl => sl.querySelectorAll(':scope > style').forEach(st => {
      st.media = 'not all'; sl.dataset.slideStyle = String(++n);
      document.head.append(Object.assign(document.createElement('style'), { textContent: `.reveal .slides section[data-slide-style="${n}"] { ${st.textContent} }` }));
    }));
    // build timing (Motion panel): duration, acceleration, and a delay for builds that start on a click or with the previous
    document.querySelectorAll('.reveal .slides .fragment').forEach(f => {
      const d = f.dataset, st = f.style; if (d.duration) { st.transitionDuration = st.animationDuration = d.duration + 's'; st.setProperty('--gs-dur', d.duration + 's'); }
      if (d.ease) { st.transitionTimingFunction = st.animationTimingFunction = d.ease; st.setProperty('--gs-ease', d.ease); }
      if (d.delay && !/^(after|transition)$/.test(d.start || '')) { st.transitionDelay = st.animationDelay = d.delay + 's'; st.setProperty('--gs-delay', d.delay + 's'); }   // (--gs-*: Line Draw's stroke)
      if (d.angle) st.setProperty('--gs-angle', d.angle + 'deg');   // the Rotate action's turn
      const to = (d.to || '').split(',').map(Number);   // the Move action's end: data-to = its top-left there
      if (f.classList.contains('move-to') && to.length === 2 && to.every(isFinite)) { const [ox, oy] = (d.gsAt || `${parseFloat(st.left) || 0},${parseFloat(st.top) || 0}`).split(',').map(Number); st.setProperty('--gs-mx', to[0] - ox + 'px'); st.setProperty('--gs-my', to[1] - oy + 'px'); }
      const via = (d.via || '').split(',').map(Number);   // a curved Move (data-via: the top-left halfway) or one aligned to its path: along an offset-path
      if (f.classList.contains('move-to') && to.length === 2 && to.every(isFinite) && (d.via && via.length === 2 && via.every(isFinite) || d.align === 'path')) {
        const [x, y] = (d.gsAt || `${parseFloat(st.left) || 0},${parseFloat(st.top) || 0}`).split(',').map(Number), w2 = (parseFloat(st.width) || 0) / 2, h2 = (parseFloat(st.height) || 0) / 2;
        const ex = to[0] - x, ey = to[1] - y, [vx, vy] = d.via ? [via[0] - x, via[1] - y] : [ex / 2, ey / 2], cx = 2 * vx - ex / 2, cy = 2 * vy - ey / 2;   // the Bézier through the halfway point
        f.classList.add('gs-path'); st.setProperty('--gs-path', `path('M${w2},${h2} Q${cx + w2},${cy + h2} ${ex + w2},${ey + h2}')`);
        st.setProperty('--gs-orot', d.align === 'path' ? `auto ${-Math.atan2(cy, cx) * 180 / Math.PI}deg` : '0deg');   // turned with the path, from no turn
      }
    });
    if (changed) Reveal.sync();
    if (new URLSearchParams(location.search).get('view') === 'scroll') Reveal.configure({ view: 'scroll' });   // read as a page (reveal's scroll view)
  };
  Reveal.isReady() ? prepare() : Reveal.on('ready', prepare);
  /* A preview in the presenter view (?gs-view): this deck, sent to a slide and build by the presenter, without animating,
     keys, clicks, sound or the toolbar. */
  if (new URLSearchParams(location.search).has('gs-view')) {
    for (const ev of ['keydown', 'keyup', 'click', 'mousedown', 'pointerdown', 'wheel', 'touchstart']) addEventListener(ev, e => { e.stopImmediatePropagation(); e.preventDefault(); }, { capture: true, passive: false });
    const st = document.createElement('style');
    st.textContent = 'html, body, .reveal { background: #000 !important; } .reveal .backgrounds { display: none; } .reveal .slides section, .reveal .slides .fragment, .reveal .slides .fragment * { transition: none !important; animation: none !important; }';
    document.head.append(st);
    Reveal.configure({ keyboard: false, controls: false, progress: false, slideNumber: false, margin: 0, hash: false, autoSlide: 0, autoPlayMedia: false });
    const still = () => document.querySelectorAll('.reveal .slides section').forEach(x => { Object.assign(x.style, window.bgCss ? window.bgCss(x) : { background: x.dataset.backgroundColor || '#fff' });
      x.querySelectorAll('video, audio').forEach(m => { /** @type {HTMLMediaElement} */ (m).muted = true; /** @type {HTMLMediaElement} */ (m).pause(); }); });
    Reveal.isReady() ? still() : Reveal.on('ready', still); Reveal.on('slidechanged', still);
    addEventListener('message', e => { const m = e.data; if (m && m.gsView) Reveal.slide(m.h, m.v, m.f); });
    return;
  }
  const embedded = new URLSearchParams(location.search).has('embedded');
  let rehearsal = null;   // Rehearse slideshow's presenter view over the show (below)
  let typed = '', screen = null, laser = null;

  const cover = color => {
    if (screen) { screen.remove(); const was = screen.dataset.c; screen = null; if (was === color) return; }
    screen = document.createElement('div'); screen.dataset.c = color;
    screen.style.cssText = `position:fixed;inset:0;z-index:100;background:${color};cursor:none`;
    document.body.append(screen);
  };
  const toggleLaser = () => {
    if (laser) { laser.remove(); laser = null; document.documentElement.style.cursor = ''; return; }
    laser = document.createElement('div');
    laser.style.cssText = 'position:fixed;z-index:101;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;background:#e8173a;box-shadow:0 0 3px 1px rgba(232,23,58,.5);pointer-events:none;left:-20px;top:-20px';
    document.body.append(laser); document.documentElement.style.cursor = 'none';
  };
  let ptr = { x: innerWidth / 2, y: innerHeight / 2 };
  addEventListener('pointermove', e => { ptr = { x: e.clientX, y: e.clientY }; if (laser) { laser.style.left = e.clientX + 'px'; laser.style.top = e.clientY + 'px'; } });

  /* M (presenting from the editor): a note for the AI at the pointer; ⏎ adds it to this slide as a .box.note, Esc drops it. */
  let memo = null;
  const openMemo = () => {
    if (memo || !embedded) return;
    memo = document.createElement('textarea'); memo.placeholder = 'Note for AI (⏎ to keep, Esc to drop)';
    memo.style.cssText = `position:fixed;z-index:103;left:${Math.min(ptr.x, innerWidth - 300)}px;top:${Math.min(ptr.y, innerHeight - 140)}px;width:280px;height:120px;padding:10px;border:0;border-radius:4px;background:#fff3a8;color:#3c4043;font:15px Roboto,Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.35);resize:none;outline:none`;
    document.body.append(memo); memo.focus();
    memo.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); memo.remove(); memo = null; }
      else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = memo.value.trim(), r = document.querySelector('.reveal .slides').getBoundingClientRect(), k = Reveal.getScale();
        const { h, v } = Reveal.getIndices();
        if (text) parent.postMessage({ slides: 'note', h, v, x: (parseFloat(memo.style.left) - r.left) / k, y: (parseFloat(memo.style.top) - r.top) / k, text }, '*');
        memo.remove(); memo = null;
      }
    });
  };

  const exit = () => {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (embedded) parent.postMessage({ slides: 'exit', h: Reveal.getIndices().h, v: Reveal.getIndices().v }, '*');
  };
  /* Keynote's show keys where Slides has none (D3): ⇧→ / ⇧↓ next slide without its builds or transition, ⇧← / ⇧↑ back one
     build, Z back through the slides as viewed, C hide / show the pointer, ? or / the keys, Q end the show. */
  const seen = []; let zBack = false, pointerOff = false;
  Reveal.on('slidechanged', e => { if (!zBack && e.previousSlide) seen.push(e.previousSlide); zBack = false; });
  const toSlide = (s, f) => { if (!s) return; const i = Reveal.getIndices(s); Reveal.slide(i.h, i.v, f); };
  const instant = fn => { document.documentElement.classList.add('sl-instant'); fn(); requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('sl-instant'))); };
  const KEYS = [['→ ↓ Space ↵ or click', 'Next build or slide'], ['← ↑', 'Previous slide'], ['⇧→', 'Next slide, skipping builds'], ['⇧←', 'Previous build'],
    ['Home / End', 'First / last slide'], ['n then ↵', 'Go to slide n'], ['Z', 'Back through viewed slides'], ['B / W', 'Black / white screen'], ['L', 'Laser pointer'],
    ['C', 'Show / hide the pointer'], ['S', 'Speaker notes'], ['F', 'Full screen'], ['?', 'These keys'], ['Esc or Q', 'Exit']];
  const showKeys = () => {
    if (pop?.classList.contains('sl-keys')) return closePop();
    openPop(null, KEYS.map(([k, l]) => [null, l, () => {}, { key: k }]));
    pop.classList.add('sl-keys'); pop.style.left = (innerWidth - pop.offsetWidth) / 2 + 'px'; pop.style.top = Math.max(8, (innerHeight - pop.offsetHeight) / 2) + 'px';
  };
  addEventListener('keydown', e => {
    if (rehearsal?.isConnected && rehearsal.style.display !== 'none') {   // Rehearse: keys go to the presenter view over the show
      e.preventDefault(); e.stopImmediatePropagation(); rehearsal.contentWindow?.focus();
      rehearsal.contentDocument?.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, bubbles: true, cancelable: true }));
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (linksOnly && !/^(Escape|q|Q|b|B|w|W|l|L|f|F|s|S|\?|\/)$/.test(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); return; }   // Links only: no key moves the show
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;   // typing in a field on the page (a comment box) is not a slideshow key
    const k = e.key.toLowerCase();
    if (screen && k !== 'b' && k !== 'w') { screen.remove(); screen = null; if (k !== 'escape') { e.preventDefault(); e.stopImmediatePropagation(); return; } }
    if (memo) return;   // typing a note
    if (/^[0-9]$/.test(e.key)) { typed += e.key; return; }
    if (e.key === 'Enter') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (typed) Reveal.slide(Math.max(0, +typed - 1)); else Reveal.next();
      typed = ''; return;
    }
    typed = '';
    if (pop && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closePop(); return; }
    if (e.shiftKey && /^Arrow(Right|Down|Left|Up)$/.test(e.key)) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (/Right|Down/.test(e.key)) { const all = Reveal.getSlides(); instant(() => toSlide(all[all.indexOf(Reveal.getCurrentSlide()) + 1], -1)); }
      else if (!Reveal.prevFragment()) Reveal.prev();
      return;
    }
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); const s = seen.pop(); if (s) { zBack = true; toSlide(s); } return; }
    if (k === 'c' && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); pointerOff = !pointerOff; document.documentElement.style.cursor = pointerOff || laser ? 'none' : ''; return; }
    if (e.key === '?' || e.key === '/') { e.preventDefault(); e.stopImmediatePropagation(); showKeys(); return; }
    if (k === 'q' && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); exit(); return; }
    if (k === 'b' || k === 'w') { e.preventDefault(); e.stopImmediatePropagation(); cover(k === 'b' ? '#000' : '#fff'); }
    else if (k === 'l') { e.preventDefault(); e.stopImmediatePropagation(); toggleLaser(); }
    else if ((k === 'n' || k === 'p') && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); k === 'n' ? Reveal.right() : Reveal.left(); }   // Slides: N / P = → / ←, past a stack
    else if (k === 'x' && rehearsal?.isConnected) { e.preventDefault(); e.stopImmediatePropagation(); rehearsal.style.display = ''; rehearsal.contentWindow?.focus(); }   // back to the presenter view
    else if (k === 's') { e.preventDefault(); e.stopImmediatePropagation(); openPresenter(); }

    else if (k === 'm' && embedded) { e.preventDefault(); e.stopImmediatePropagation(); openMemo(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); exit(); }
  }, true);   // capture: before reveal.js's own handler

  /* Builds that start by themselves (data-start="after": after the previous build ends, "transition": after the slide's
     transition), each after its own data-delay. A key or click in between cancels the wait. */
  let autoT = 0;
  const secs = (el, p) => parseFloat(getComputedStyle(el)[p]) || 0;
  const cue = () => {
    clearTimeout(autoT);
    const sl = Reveal.getCurrentSlide(); if (!sl) return;
    const f = Reveal.getIndices().f ?? -1, at = n => [...sl.querySelectorAll('.fragment')].filter(e => +(e.dataset.fragmentIndex ?? -2) === n);
    const lead = at(f + 1)[0], start = lead?.dataset.start;
    if (!start || !/^(after|transition)$/.test(start)) return;
    let ms;
    if (f < 0) {   // the slide's first build: after its transition (or morph)
      const kind = sl.dataset.transition || Reveal.getConfig().transition, sp = sl.dataset.transitionSpeed || Reveal.getConfig().transitionSpeed;
      ms = sl.hasAttribute('data-auto-animate') ? (+sl.dataset.autoAnimateDuration || 1) * 1000 : kind === 'none' ? 0 : ({ fast: 400, slow: 1200 }[sp] || 800);
    } else ms = Math.max(0, ...at(f).map(e => (secs(e, 'transitionDuration') + secs(e, 'transitionDelay')) * 1000));
    ms += (+lead.dataset.delay || 0) * 1000;
    const was = JSON.stringify(Reveal.getIndices());
    autoT = setTimeout(() => { if (JSON.stringify(Reveal.getIndices()) === was) Reveal.nextFragment(); }, ms);
  };
  Reveal.on('slidechanged', cue); Reveal.on('fragmentshown', cue); Reveal.on('fragmenthidden', () => clearTimeout(autoT));
  /* Slideshow settings (the deck's .slides): data-play="self" plays by itself, data-play-build seconds between builds and
     data-play-slide before the next slide; data-play="links" moves only through links; data-loop goes round; data-idle
     (minutes without a key or click) goes back to the first slide. */
  const show = document.querySelector('.reveal .slides')?.dataset || {}, linksOnly = show.play === 'links';
  if ('loop' in show) Reveal.configure({ loop: true });
  if (show.play === 'recorded' && show.narration) {   // a recorded slideshow: the narration plays and the show follows its steps
    const steps = (show.narrationSteps || '').split(/\s+/).map(s => s.match(/^([\d.]+):(\d+)\.(\d+)\.(-?\d+)$/)).filter(Boolean).map(m => [+m[1], +m[2], +m[3], +m[4]]);
    const voice = Object.assign(new Audio(show.narration), { id: 'sl-narration' }); document.body.append(voice);
    let last = '';
    voice.addEventListener('timeupdate', () => { const s = steps.filter(x => x[0] <= voice.currentTime + 0.05).at(-1); if (!s) return; const k = s.slice(1).join('.');
      if (k !== last) { last = k; Reveal.slide(s[1], s[2], s[3]); } });
    const go = () => voice.play().then(() => ['keydown', 'pointerdown'].forEach(ev => removeEventListener(ev, go, true))).catch(() => {});
    Reveal.isReady() ? go() : Reveal.on('ready', go); ['keydown', 'pointerdown'].forEach(ev => addEventListener(ev, go, true));
  }
  let selfT = 0;
  const selfPlay = () => {
    clearTimeout(selfT); if (show.play !== 'self') return;
    const sl = Reveal.getCurrentSlide(), more = sl && sl.querySelector('.fragment:not(.visible)');
    selfT = setTimeout(() => { if (!Reveal.isLastSlide() || more || 'loop' in show) Reveal.next(); }, (more ? +show.playBuild || 2 : +show.playSlide || 5) * 1000);
  };
  if (show.play === 'self') { Reveal.on('slidechanged', selfPlay); Reveal.on('fragmentshown', selfPlay); Reveal.on('fragmenthidden', selfPlay); Reveal.isReady() ? selfPlay() : Reveal.on('ready', selfPlay); }
  if (show.idle) {
    let idleT = 0; const restart = () => { clearTimeout(idleT); idleT = setTimeout(() => { Reveal.slide(0, 0, -1); }, +show.idle * 60000); };
    for (const ev of ['keydown', 'pointerdown', 'pointermove']) addEventListener(ev, restart, true);
    restart();
  }
  Reveal.isReady() ? cue() : Reveal.on('ready', cue);
  Reveal.configure({ keyboard: { 79: null, 86: null, 191: null, 190: null, 27: null, 72: null, 74: null, 75: null } });   // O, V, ?, ., Esc, and H / J / K (neither Slides' nor Keynote's)
  if (embedded) Reveal.on('ready', () => window.focus());
  if (embedded) for (const ev of ['slidechanged', 'fragmentshown', 'fragmenthidden']) Reveal.on(ev, () => { const i = Reveal.getIndices(); parent.postMessage({ slides: 'at', h: i.h, v: i.v || 0, f: i.f ?? -1 }, '*'); });   // Record slideshow listens
  if (/print-pdf/.test(location.search)) {   // PDF, as Slides prints it: one page per slide, edge to edge, no numbers, colours kept
    /* Slides' Print preview bar (not printed) with Keynote's PDF options: 1 slide with notes (the notes under each slide),
       Include each stage of builds, Include skipped slides (the server keeps them in), Hide background. Each is a word in
       the address, so a choice reloads the page. */
    const q = new URLSearchParams(location.search), opt = k => q.has(k);
    Reveal.configure({ slideNumber: false, margin: 0, pdfSeparateFragments: opt('builds'), pdfMaxPagesPerSlide: opt('builds') ? 99 : 1, showNotes: false });
    const css = document.createElement('style');
    css.textContent = `* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }   /* without the print dialog's "Background graphics" */
      @page { margin: 0; } .reveal .slide-number, .sl-bar { display: none !important; }
      .gs-print-bar { position: fixed; z-index: 1000; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: 16px; height: 56px; padding: 0 16px; background: #fff;
        box-shadow: 0 1px 3px rgba(60, 64, 67, .3); font: 14px Roboto, Arial, sans-serif; color: #1f1f1f; }
      .gs-print-bar select { height: 36px; padding: 0 8px; border: 1px solid #c4c7c5; border-radius: 4px; font: inherit; background: #fff; }
      .gs-print-bar label { display: flex; align-items: center; gap: 6px; cursor: pointer; } .gs-print-bar .sp { flex: 1; }
      .gs-print-bar button { height: 36px; padding: 0 16px; border: 1px solid #747775; border-radius: 18px; background: #fff; color: #0b57d0; font: 500 14px Roboto, Arial, sans-serif; cursor: pointer; }
      .gs-print-bar button.go { border: 0; background: #0b57d0; color: #fff; }
      .gs-pdf-notes { position: absolute; left: 0; box-sizing: border-box; padding: 48px 96px; font: 32px/1.5 Arial, sans-serif; color: #1f1f1f; white-space: pre-wrap; background: #fff; }
      ${opt('nobg') ? '.reveal .slides section, .reveal .pdf-page { background: #fff !important; } .reveal .slide-background { display: none !important; }' : ''}
      @media screen { html.print-pdf body { padding-top: 56px !important; } html.print-pdf .reveal .slides { zoom: var(--gs-fit, 1) !important; } }   /* pages fitted to the window */
      @media print { .gs-print-bar { display: none !important; } }`;
    document.head.append(css);
    const bar = document.createElement('div'); bar.className = 'gs-print-bar';
    bar.innerHTML = `<select title="Layout"><option value="">1 slide without notes</option><option value="notes">1 slide with notes</option></select>
      <label><input type="checkbox" data-k="builds">Include each stage of builds</label><label><input type="checkbox" data-k="skipped">Include skipped slides</label>
      <label><input type="checkbox" data-k="nobg">Hide background</label><span class="sp"></span><button class="pdf">Download as PDF</button><button class="go">Print</button>`;
    const sel = bar.querySelector('select'); sel.value = opt('notes') ? 'notes' : '';
    bar.querySelectorAll('input').forEach(c => { c.checked = opt(c.dataset.k); });
    const reload = () => { const n = ['print-pdf', ...(sel.value ? ['notes'] : []), ...[...bar.querySelectorAll('input:checked')].map(c => c.dataset.k)]; location.search = '?' + n.join('&'); };
    sel.onchange = reload; bar.querySelectorAll('input').forEach(c => { c.onchange = reload; });
    bar.querySelectorAll('button').forEach(b => { b.onclick = () => print(); });   // Chrome's dialog saves a PDF too
    const addBar = () => document.body.append(bar); document.body ? addBar() : addEventListener('DOMContentLoaded', addBar);
    const fit = () => document.documentElement.style.setProperty('--gs-fit', String(Math.min(1, (innerWidth - 32) / Reveal.getConfig().width))); fit(); addEventListener('resize', fit);
    if (opt('notes')) Reveal.on('pdf-ready', () => {   // each page taller, the slide's notes under it
      const W = Reveal.getConfig().width, H = Reveal.getConfig().height, PH = Math.round(H * 1.6);
      document.querySelectorAll('.reveal .pdf-page').forEach(pg => {
        const s = pg.querySelector('section'), n = document.createElement('div'); pg.style.height = PH + 'px';
        n.className = 'gs-pdf-notes'; Object.assign(n.style, { top: H + 'px', width: W + 'px', height: PH - H + 'px' }); n.textContent = s ? (s.querySelector('aside.notes')?.textContent || '').trim() : ''; pg.append(n);
      });
      document.head.append(Object.assign(document.createElement('style'), { textContent: `@page { size: ${W}px ${PH}px; margin: 0; }` }));
    });
    return;
  }


  /* Look: black letterbox, Slides' own hover toolbar instead of reveal's controls / progress / number. */
  /* reveal.js pauses a slide's videos when it is left and, coming back, plays only those marked data-autoplay themselves;
     a Glideshow deck marks their box (.box[data-autoplay]), so they came back still (2026-10-21). Play them again whenever
     their slide or fragment is shown. */
  const playShown = () => Reveal.getCurrentSlide()?.querySelectorAll('.box[data-autoplay] video, video[autoplay]').forEach(v => {
    if (v.closest('.fragment:not(.visible)') || !v.paused) return;
    v.play().catch(() => {});
  });
  Reveal.on('slidechanged', playShown); Reveal.on('fragmentshown', playShown);
  /* Keynote's transitions in pieces (data-transition doorway / flop / mosaic / blinds): copies of the slides, each clipped
     to its piece, play over the arriving slide and are then removed. Doorway: the old slide opens as two doors towards
     you while the new comes forward; Flop: its top half folds down over the bottom, carrying the new bottom half; Mosaic:
     7 × 5 tiles turn away, right to left; Blinds: 7 strips turn, left to right. Over black (r08c, r08d): Grid: the camera pulls
     back from the old slide to a wall of slides with black gutters, pans to the new one and closes in; Color planes: the old
     slide splits into its red, green and blue planes, which turn away one after another, and the new one's turn in and
     merge; Reflection: the two slides meet at an inside corner, set back, and the view turns from the old to the new (no floor reflection); Twist: 16
     strips, left to right, turn over about the middle line, the new slide on their backs. */
  const PIECES = { doorway: 1.5, flop: 1, mosaic: 1.25, blinds: 1.1, 'page-flip': 1, grid: 1.1, 'color-planes': 1.25, reflection: 1.5, twist: 1.5 };
  Reveal.on('slidechanged', e => {
    const s = e.currentSlide, kind = s?.dataset.transition, old = e.previousSlide;
    if (!(kind in PIECES) || !old || document.body.classList.contains('sl-instant')) return;
    const W = Reveal.getConfig().width, H = Reveal.getConfig().height, ms = PIECES[kind] * 1000 * ({ fast: 0.5, slow: 1.5 }[s.dataset.transitionSpeed] || 1);
    const layer = Object.assign(document.createElement('div'), { className: 'gs-pieces' }); s.parentElement.append(layer);
    const copy = (sec, [t, r, b, l]) => { const c = /** @type {HTMLElement} */ (sec.cloneNode(true)); c.classList.remove('past', 'future', 'present'); c.removeAttribute('id');
      c.querySelectorAll('video, iframe, audio').forEach(m => m.remove()); c.removeAttribute('aria-hidden'); c.hidden = false;
      Object.assign(c.style, { display: 'block', position: 'absolute', left: '0', top: '0', width: W + 'px', height: H + 'px', opacity: '1', visibility: 'visible', transform: 'none', clipPath: `inset(${t}px ${r}px ${b}px ${l}px)`, transition: 'none' });
      layer.append(c); return c; };
    const anims = [];
    const go = (el, kf, o) => anims.push(el.animate(kf, { duration: ms, easing: 'ease-in-out', fill: 'both', ...o }));
    if (kind === 'doorway') {
      const l = copy(old, [0, W / 2, 0, 0]), r = copy(old, [0, 0, 0, W / 2]);
      go(l, [{ transformOrigin: '0 50%', transform: 'perspective(2000px) rotateY(0)', filter: 'brightness(1)' }, { transformOrigin: '0 50%', transform: 'perspective(2000px) rotateY(-100deg)', filter: 'brightness(.4)' }]);
      go(r, [{ transformOrigin: '100% 50%', transform: 'perspective(2000px) rotateY(0)', filter: 'brightness(1)' }, { transformOrigin: '100% 50%', transform: 'perspective(2000px) rotateY(100deg)', filter: 'brightness(.4)' }]);
      go(s, [{ transform: 'scale(.55)', filter: 'brightness(.5)' }, { transform: 'none', filter: 'none' }], { fill: 'none', easing: 'ease-out' });
    } else if (kind === 'page-flip') {   // the old page turns over from its right edge, hinged on the left
      const pg = copy(old, [0, 0, 0, 0]); pg.style.backfaceVisibility = 'hidden';
      go(pg, [{ transformOrigin: '0 50%', transform: 'perspective(2400px) rotateY(0)', filter: 'brightness(1)' }, { transformOrigin: '0 50%', transform: 'perspective(2400px) rotateY(-180deg)', filter: 'brightness(.6)' }], { easing: 'ease-in-out' });
    } else if (kind === 'flop') {
      const under = copy(old, [H / 2, 0, 0, 0]), top = copy(old, [0, 0, H / 2, 0]), flap = copy(s, [H / 2, 0, 0, 0]);
      go(top, [{ transform: 'perspective(2000px) rotateX(0)', filter: 'brightness(1)' }, { transform: 'perspective(2000px) rotateX(-90deg)', filter: 'brightness(.5)', offset: 0.5 }, { transform: 'perspective(2000px) rotateX(-90deg)', filter: 'brightness(.5)' }], { easing: 'ease-in' });
      go(flap, [{ transform: 'perspective(2000px) rotateX(90deg)', filter: 'brightness(.5)' }, { transform: 'perspective(2000px) rotateX(90deg)', filter: 'brightness(.5)', offset: 0.5 }, { transform: 'none', filter: 'none' }], { easing: 'ease-out' });
      go(under, [{ opacity: 1 }, { opacity: 1, offset: 0.99 }, { opacity: 0 }], { easing: 'linear' });
    } else if (kind === 'grid') {   // a 4 × 3 wall, old and new slides alternating, the old one at (1, 1) and the new beside it
      const g = 60, wall = document.createElement('div'); Object.assign(wall.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0' }); layer.append(wall); layer.style.background = '#000';
      for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) { const c = copy((x + y) % 2 ? s : old, [0, 0, 0, 0]); Object.assign(c.style, { left: x * (W + g) + 'px', top: y * (H + g) + 'px' }); wall.append(c); }
      const at = (cx, k) => `translate(${W / 2 - k * (cx * (W + g) + W / 2)}px, ${H / 2 - k * ((H + g) + H / 2)}px) scale(${k})`;
      go(wall, [{ transform: at(1, 1) }, { transform: at(1.15, 0.55), offset: 0.35 }, { transform: at(1.85, 0.55), offset: 0.65 }, { transform: at(2, 1) }]);
    } else if (kind === 'reflection') {   // an inside corner: the new slide on the left, hinged at the corner to the old on the right
      layer.style.background = '#000'; const n = copy(s, [0, 0, 0, 0]), o = copy(old, [0, 0, 0, 0]), P = Array.from({ length: 11 }, (_, i) => i / 10);
      const at = p => `perspective(2400px) translateX(${W * Math.sin(p * Math.PI / 2) - W / 2}px) translateZ(${-0.7 * W * Math.sin(p * Math.PI)}px)`;   // the corner, seen from the middle
      go(n, P.map(p => ({ transform: `${at(p)} rotateY(${(1 - p) * 90}deg) translateX(${-W / 2}px)`, filter: `brightness(${0.5 + 0.5 * p})` })));
      go(o, P.map(p => ({ transform: `${at(p)} rotateY(${-p * 90}deg) translateX(${W / 2}px)`, filter: `brightness(${1 - 0.5 * p})` })));
    } else if (kind === 'twist') {
      layer.style.background = '#000'; const N = 16, sw = W / N;
      for (let i = 0; i < N; i++) { const clip = [0, W - (i + 1) * sw, 0, i * sw], f = copy(old, clip), b = copy(s, clip), o = { duration: ms * 0.5, delay: ms * 0.5 * i / (N - 1) };
        f.style.backfaceVisibility = b.style.backfaceVisibility = 'hidden';
        go(f, [{ transform: 'perspective(2400px) rotateX(0deg)', filter: 'brightness(1)' }, { transform: 'perspective(2400px) rotateX(90deg)', filter: 'brightness(.35)', offset: 0.5 }, { transform: 'perspective(2400px) rotateX(180deg)', filter: 'brightness(.35)' }], o);
        go(b, [{ transform: 'perspective(2400px) rotateX(-180deg)', filter: 'brightness(.35)' }, { transform: 'perspective(2400px) rotateX(-90deg)', filter: 'brightness(.35)', offset: 0.5 }, { transform: 'perspective(2400px) rotateX(0deg)', filter: 'brightness(1)' }], o); }
    } else if (kind === 'color-planes') {   // each slide as three planes (one colour channel each) added together over black
      Object.assign(layer.style, { background: '#000', isolation: 'isolate' });
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); defs.setAttribute('width', '0'); defs.setAttribute('height', '0'); defs.style.position = 'absolute';
      defs.innerHTML = ['1 0 0', '0 1 0', '0 0 1'].map((m, k) => { const [r, g2, b] = m.split(' '); return `<filter id="gs-cp${k}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${r} 0 0 0 0  0 ${g2} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0"/></filter>`; }).join(''); layer.append(defs);
      [0, 1, 2].forEach(k => {
        const o = copy(old, [0, 0, 0, 0]), n = copy(s, [0, 0, 0, 0]); [o, n].forEach(c => { c.style.filter = `url(#gs-cp${k})`; c.style.mixBlendMode = 'screen'; });
        go(o, [{ transform: 'perspective(2400px) none', opacity: 1 }, { transform: `perspective(2400px) translateX(${(k - 1) * 3}%) rotateY(${-35 - 10 * k}deg)`, opacity: 1, offset: 0.5 }, { transform: `perspective(2400px) translateX(${(k - 1) * 8}%) rotateY(${-90 - 10 * k}deg)`, opacity: 0 }], { duration: ms * 0.55, delay: ms * 0.05 * k });
        go(n, [{ transform: `perspective(2400px) translateX(${(1 - k) * 8}%) rotateY(${90 + 10 * k}deg)`, opacity: 0 }, { transform: `perspective(2400px) translateX(${(1 - k) * 3}%) rotateY(${35 + 10 * k}deg)`, opacity: 1, offset: 0.5 }, { transform: 'perspective(2400px) none', opacity: 1 }], { duration: ms * 0.55, delay: ms * (0.35 + 0.05 * k) });
      });
    } else {
      const [cols, rows] = kind === 'mosaic' ? [7, 5] : [7, 1], tw = W / cols, th = H / rows;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const t = copy(old, [y * th, W - (x + 1) * tw, H - (y + 1) * th, x * tw]), order = kind === 'mosaic' ? (cols - 1 - x) / cols + ((x * 7 + y * 13) % 5) / 25 : x / cols;
        const o = `${(x + 0.5) * tw}px ${(y + 0.5) * th}px`;
        go(t, [{ transformOrigin: o, transform: 'perspective(2000px) rotateY(0)', filter: 'brightness(1)' }, { transformOrigin: o, transform: 'perspective(2000px) rotateY(90deg)', filter: 'brightness(.5)' }],
          { duration: ms * 0.55, delay: ms * 0.45 * order });
      }
    }
    Promise.all(anims.map(a => a.finished)).then(() => layer.remove(), () => layer.remove());
  });
  /* Keynote's special effects (r08b): particles drawn on a canvas over the box (and a margin round it) while it builds in. */
  const PARTICLES = { 'sparkle-in': 1.4, 'shimmer-in': 1.2, 'confetti-in': 1.5, 'flash-in': 1.2, 'fireworks-in': 2.8, 'trace-in': 1.2, 'lens-in': 1.2, 'flame-in': 2.2, 'confetti-out': 1.75, 'anvil-in': 1.5, 'comet-in': 1.2 };
  const particles = box => {
    const kind = Object.keys(PARTICLES).find(k => box.classList.contains(k)); if (!kind || !box.parentElement) return;
    const st = box.style, x = parseFloat(st.left) || 0, y = parseFloat(st.top) || 0, w = parseFloat(st.width) || 100, h = parseFloat(st.height) || 100;
    if (kind === 'comet-in') return comet(box, x, y, w, h);
    const m = kind === 'confetti-in' || kind === 'fireworks-in' ? Math.max(w, h) : kind === 'confetti-out' ? Math.max(w, h) * 0.2 : Math.max(w, h) * 0.3, cv = document.createElement('canvas');
    cv.width = Math.round(w + 2 * m); cv.height = Math.round(h + 2 * m); cv.className = 'gs-particles';
    Object.assign(cv.style, { position: 'absolute', left: x - m + 'px', top: y - m + 'px', width: cv.width + 'px', height: cv.height + 'px', pointerEvents: 'none', zIndex: '50' });
    box.after(cv);
    const c = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d')), fill = getComputedStyle(box).getPropertyValue('--fill').trim() || '#4285f4';
    const ms = (+box.dataset.duration || PARTICLES[kind]) * 1000, t0 = performance.now(), rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    const N = /^confetti/.test(kind) ? 600 : kind === 'flame-in' ? 160 : 60, P = Array.from({ length: N }, () => ({ x: rnd(), y: rnd(), a: rnd(), b: rnd(), c: rnd() }));
    const star = (px, py, r, col, alpha) => { c.globalAlpha = alpha; c.fillStyle = col; c.beginPath(); c.moveTo(px, py - r); c.lineTo(px + r / 4, py); c.lineTo(px, py + r); c.lineTo(px - r / 4, py); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(px - r, py); c.lineTo(px, py + r / 4); c.lineTo(px + r, py); c.lineTo(px, py - r / 4); c.closePath(); c.fill(); };
    const frame = now => {
      const t = Math.min(1, (now - t0) / ms); c.clearRect(0, 0, cv.width, cv.height);
      if (kind === 'trace-in') { c.globalAlpha = 1 - t; c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.ellipse(m + w / 2, m + h / 2, w / 2, h / 2, 0, Math.PI / 2, Math.PI / 2 + Math.PI * 2 * (1 - t)); c.stroke(); }   // an arc round it, erased as it fades in
      else if (kind === 'lens-in') { const cx = m + w * (1.2 - 1.4 * t), cy = m + h / 2;   // flare rings sweeping across
        [[0, 90, '200,220,255'], [0.35, 50, '255,240,170'], [0.7, 120, '220,200,255'], [1.1, 30, '170,255,200'], [-0.4, 20, '140,240,255']].forEach(([k, r, col]) => {
          const px = cx + (m + w / 2 - cx) * k * 2, gr = c.createRadialGradient(px, cy, r * 0.6, px, cy, r); gr.addColorStop(0, `rgba(${col},.05)`); gr.addColorStop(0.85, `rgba(${col},.35)`); gr.addColorStop(1, `rgba(${col},0)`);
          c.globalAlpha = Math.sin(t * Math.PI); c.fillStyle = gr; c.beginPath(); c.arc(px, cy, r, 0, 7); c.fill(); }); }
      else if (kind === 'flame-in') P.forEach(p => { const born = p.a * 0.7, life = (t - born) / 0.3; if (life < 0 || life > 1) return;   // flames rising from its bottom edge, then smoke
        const px = m + w * p.x + Math.sin((now / 90) + p.b * 9) * 8, py = m + h - life * h * (0.6 + 0.6 * p.c), r = (1 - life) * (14 + 26 * p.c);
        c.globalAlpha = (1 - life) * (t > 0.75 ? (1 - t) * 4 : 1) * 0.8; c.fillStyle = life < 0.3 ? '#ffd54f' : life < 0.65 ? '#ff7043' : '#9e9e9e'; c.beginPath(); c.arc(px, py, r, 0, 7); c.fill(); });
      else if (kind === 'anvil-in') P.forEach((p, i) => { const life = (t - 0.1 - p.a * 0.05) / 0.85; if (life < 0 || life > 1) return;   // it lands (12%): dust puffs out along its bottom edge, and specks
        const out = (p.x - 0.5) * 2, px = m + w * (0.5 + out * (0.5 + 0.25 * life)), py = m + h - h * 0.08 - life * h * 0.25 * p.b, r = (0.2 + 0.25 * p.c) * Math.min(w, h) * (0.7 + 0.6 * life);
        if (i % 4) { const gr = c.createRadialGradient(px, py, 0, px, py, r); gr.addColorStop(0, 'rgba(255,255,255,.7)'); gr.addColorStop(0.5, 'rgba(255,255,255,.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.globalAlpha = (1 - life) * 0.8; c.fillStyle = gr; c.fillRect(px - r, py - r, 2 * r, 2 * r); }
        else { c.globalAlpha = 1 - life; c.fillStyle = '#fff'; c.fillRect(m + w * p.x, m + h * (1 - p.b * (0.3 + life)), 2, 2); } });
      else if (kind === 'confetti-out') P.forEach(p => { const k = t * (2 - t), sx = m + w * p.x, sy = m + h * p.y, an = p.a * 7, d = (0.3 + p.b) * Math.max(w, h) * 0.7;   // the old slide shattering outward
        c.globalAlpha = 1 - t; c.fillStyle = fill; c.fillRect(sx + Math.cos(an) * d * k, sy + Math.sin(an) * d * k, 5, 5); });
      else if (kind === 'sparkle-in') P.forEach(p => { const fx = m + w * t - p.a * 60, py = m + h * p.y, life = 1 - Math.abs(p.b - 0.5) * 2; star(fx + p.c * 30, py, 6 + 14 * p.c, '#fff', Math.max(0, life * (t < 1 ? 1 : 0))); });
      else if (kind === 'shimmer-in') P.forEach(p => { const g = Math.min(1, t * 1.6 + p.a * 0.3), r = 4 + g * (10 + 40 * p.c); star(m + w * p.x, m + h * p.y, r, p.b < 0.5 ? '#fff' : fill, (1 - t) * 0.9); });
      else if (kind === 'confetti-in') P.forEach(p => { const k = t * t, sx = cv.width * p.a, sy = cv.height * p.b, tx = m + w * p.x, ty = m + h * p.y;
        c.globalAlpha = 0.2 + 0.8 * t; c.fillStyle = fill; c.fillRect(sx + (tx - sx) * k, sy + (ty - sy) * k, 4, 4); });
      else if (kind === 'flash-in') P.slice(0, 14).forEach(p => { const at = p.a * 0.8, life = (t - at) / 0.22; if (life < 0 || life > 1) return;
        const px = m * 0.4 + (w + m * 1.2) * p.x, py = m * 0.4 + (h + m * 1.2) * p.y, r = 30 + 60 * p.c, gr = c.createRadialGradient(px, py, 0, px, py, r);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(200,170,255,.6)'); gr.addColorStop(1, 'rgba(160,120,255,0)'); c.globalAlpha = Math.sin(life * Math.PI); c.fillStyle = gr; c.fillRect(px - r, py - r, 2 * r, 2 * r); });
      else if (kind === 'fireworks-in') for (let k = 0; k < 6; k++) { const at = k * 0.12, life = (t - at) / 0.45; if (life < 0 || life > 1) continue;
        const bx = m * 0.3 + (w + m * 1.4) * P[k].x, by = m * 0.3 + (h + m) * P[k].y * 0.8, col = ['#7cfc00', '#00e5ff', '#e0b0ff', '#ff69b4', '#adff2f', '#ff4500'][k];
        c.strokeStyle = col; c.lineWidth = 4; c.lineCap = 'round'; c.globalAlpha = 1 - life * life;
        const R = 150 + 200 * P[k].c, at2 = l => [l * R, l * l * 140];   // out from the centre, then drooping
        for (let i = 0; i < 48; i++) { const an = (i / 48) * Math.PI * 2 + P[k].a, [d0, g0] = at2(Math.max(0, life - 0.12)), [d1, g1] = at2(life);
          c.beginPath(); c.moveTo(bx + Math.cos(an) * d0, by + Math.sin(an) * d0 + g0); c.lineTo(bx + Math.cos(an) * d1, by + Math.sin(an) * d1 + g1); c.stroke(); } }
      if (t < 1) requestAnimationFrame(frame); else cv.remove();
    };
    requestAnimationFrame(frame);
  };
  /* Comet (r08e): the box loops in from its right (base.css gs-comet-in); a blurred trail follows it, drawn on a canvas over the
     slide. COMET is that path, in box widths and heights from where it ends. */
  const COMET = s => s < 0.3 ? [3.5 - 1.95 * s / 0.3, 0] : s < 0.8 ? [1.2 + 0.35 * Math.cos((s - 0.3) / 0.5 * 2 * Math.PI), -0.6 * Math.sin((s - 0.3) / 0.5 * 2 * Math.PI)] : [1.55 * (1 - (s - 0.8) / 0.2) ** 2, 0];
  const comet = (box, x, y, w, h) => {
    const W = Reveal.getConfig().width, H = Reveal.getConfig().height, cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.className = 'gs-particles';
    Object.assign(cv.style, { position: 'absolute', left: '0px', top: '0px', width: W + 'px', height: H + 'px', pointerEvents: 'none', zIndex: '50' }); box.after(cv);
    const c = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d')), fill = getComputedStyle(box).getPropertyValue('--fill').trim() || '#4285f4';
    const ms = (+box.dataset.duration || 1.2) * 1000, t0 = performance.now(), at = s => { const [a, b] = COMET(Math.max(0, s)); return [x + w / 2 + a * w, y + h / 2 + b * h]; };
    c.filter = `blur(${Math.max(4, h * 0.08)}px)`; c.strokeStyle = fill; c.lineCap = 'round';
    const frame = now => {
      const t = Math.min(1, (now - t0) / ms); c.clearRect(0, 0, W, H);
      for (let k = 0; k < 24; k++) { const s0 = t - 0.35 * (k + 1) / 24, s1 = t - 0.35 * k / 24; if (s1 <= 0) break;   // the trail: thinner and fainter behind
        const [ax, ay] = at(s0), [bx, by] = at(s1); c.globalAlpha = 0.6 * (1 - k / 24) * (t > 0.9 ? (1 - t) * 10 : 1); c.lineWidth = h * 0.55 * (1 - k / 30);
        c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke(); }
      if (t < 1) requestAnimationFrame(frame); else cv.remove();
    };
    requestAnimationFrame(frame);
  };
  /* Blast (r08e): shards of the box (copies clipped to triangles) fly together from all round and it appears as they meet. */
  const blast = box => {
    if (!box.classList.contains('blast-in') || !box.parentElement) return;
    const ms = (+box.dataset.duration || 1.1) * 1000, rnd = (() => { let s = 11; return () => (s = (s * 16807) % 2147483647) / 2147483647; })(), parts = [];
    const pts = [[0, 0], [50, 0], [100, 0], [0, 50], [45 + rnd() * 10, 45 + rnd() * 10], [100, 50], [0, 100], [50, 100], [100, 100]];
    [[0, 1, 4], [1, 2, 4], [2, 5, 4], [5, 8, 4], [8, 7, 4], [7, 6, 4], [6, 3, 4], [3, 0, 4]].forEach(tri => {
      const p = /** @type {HTMLElement} */ (box.cloneNode(true)); p.removeAttribute('id'); p.classList.remove('fragment', 'visible', 'current-fragment', 'blast-in'); p.removeAttribute('data-fragment-index');
      p.style.clipPath = `polygon(${tri.map(i => pts[i].map(v => v + '%').join(' ')).join(', ')})`; p.style.pointerEvents = 'none'; box.after(p); parts.push(p);
      const an = rnd() * Math.PI * 2, d = 1.2 + rnd();
      p.animate([{ opacity: 0.2, translate: `${Math.cos(an) * d * 100}% ${Math.sin(an) * d * 100}%`, rotate: `${(rnd() - 0.5) * 540}deg`, scale: 1.4 }, { opacity: 1, translate: '0 0', rotate: '0deg', scale: 1 }],
        { duration: ms * 0.83, easing: 'cubic-bezier(.2, .6, .4, 1)', fill: 'both' });
    });
    setTimeout(() => parts.forEach(p => p.remove()), ms * 0.86);
  };
  Reveal.on('fragmentshown', e => e.fragments?.forEach(particles));
  Reveal.on('fragmentshown', e => e.fragments?.forEach(blast));
  /* …and the slide transitions Sparkle, Shimmer, Confetti: the same particles over the whole slide, with its own colour */
  Reveal.on('slidechanged', e => {
    const s = e.currentSlide, k = { sparkle: ['sparkle-in', 1.7], shimmer: ['shimmer-in', 1.5], confetti: ['confetti-out', 1.75] }[s?.dataset.transition]; if (!k) return;
    const src = k[0] === 'confetti-out' ? e.previousSlide : s, g = document.createElement('div'); g.className = k[0];
    Object.assign(g.style, { left: '0px', top: '0px', width: Reveal.getConfig().width + 'px', height: Reveal.getConfig().height + 'px', position: 'absolute', visibility: 'hidden' });
    g.style.setProperty('--fill', getComputedStyle(src || s).backgroundColor || '#fff'); g.dataset.duration = String(k[1] * ({ fast: 0.5, slow: 1.5 }[s.dataset.transitionSpeed] || 1)); s.append(g); particles(g); g.remove();
  });
  /* Line Draw: its arrowheads ride the stroke's ends while it draws or erases (shapes.js rideLineEnds). */
  const ride = e => e.fragments?.forEach(f => { if (f.matches('.line-draw, .line-erase')) window.rideLineEnds?.(f, ((+f.dataset.duration || 0.5) + (+f.dataset.delay || 0)) * 1000); });
  Reveal.on('fragmentshown', ride); Reveal.on('fragmenthidden', ride);

  Reveal.configure({ controls: false, progress: false, slideNumber: false, margin: 0 });   // edge to edge, as Slides
  const css = document.createElement('style');
  css.textContent = `
    html, body, .reveal { background: #000 !important; }
    .sl-instant .reveal .slides section, .sl-instant .reveal .slides .fragment { transition: none !important; }
    .reveal .box[data-link], .reveal .box.audio { cursor: pointer; }
    .reveal .box.audio[data-hide-icon] { opacity: 0; }
    .reveal .slides .box.fragment.gs-seq { opacity: 1 !important; visibility: inherit !important; transform: none !important; scale: none !important; animation: none !important; }
    .reveal .gs-seq .gs-w { display: inline-block; opacity: 0; transform: var(--gs-from); transition: opacity var(--gs-d) var(--gs-ease), transform var(--gs-d) var(--gs-ease); transition-delay: calc(var(--i) * var(--gs-step)); }
    .reveal .gs-seq.visible .gs-w { opacity: 1; transform: none; }
    .reveal .gs-word { white-space: nowrap; }
    .reveal .gs-mw { display: inline-block; }
    .reveal .gs-cc { display: block; }
    .reveal .slides .gs-build { box-sizing: border-box; }   /* a wrapper carrying one of a box's extra builds (data-builds) */
    .reveal .slides > .gs-pieces { position: absolute; left: 0; top: 0; width: var(--slide-w, 1920px); height: var(--slide-h, 1080px); z-index: 30; pointer-events: none; }   /* a transition in pieces */   /* a table cell's contents, built by themselves (by row content …) */
    .reveal .slides .fragment.gs-hl.visible:not(.current-fragment) { opacity: .35; }
    .reveal .backgrounds { display: none; }
    .sl-bar { position: fixed; left: 20px; bottom: 20px; z-index: 102; display: flex; align-items: center; height: 36px; padding: 0 4px;
      background: #f8fafd; border-radius: 18px; color: #444746; font: 14px Roboto, -apple-system, Arial, sans-serif;
      box-shadow: 0 1px 3px rgba(60, 64, 67, .3), 0 4px 8px 3px rgba(60, 64, 67, .15); transition: opacity .3s; }
    .sl-bar.idle { opacity: 0; pointer-events: none; }
    .sl-bar button { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 28px; padding: 0;
      border: 0; border-radius: 14px; background: none; color: inherit; font: inherit; cursor: pointer; }
    .sl-bar button:hover { background: rgba(68, 71, 70, .08); }
    .sl-bar .num { min-width: 40px; margin: 0 2px; background: #eef1f5; color: #1f1f1f; }
    .sl-bar svg, .sl-pop svg { width: 20px; height: 20px; fill: currentColor; }
    .sl-pop { position: fixed; z-index: 103; min-width: 220px; padding: 8px 0; background: #f8fafd; color: #1f1f1f; border-radius: 8px;
      font: 14px Roboto, -apple-system, Arial, sans-serif; box-shadow: 0 1px 3px rgba(60, 64, 67, .3), 0 4px 8px 3px rgba(60, 64, 67, .15); }
    .sl-pop button { display: flex; width: 100%; height: 35px; align-items: center; gap: 12px; padding: 0 16px 0 18px; border: 0; background: none;
      font: inherit; color: inherit; text-align: left; cursor: pointer; white-space: nowrap; }
    .sl-pop button:hover, .sl-pop button.open { background: #e9eef6; }
    .sl-pop .ic { display: inline-flex; width: 20px; color: #444746; }
    .sl-pop .on { font-weight: 600; }
    .sl-pop button.indent { position: relative; padding-left: 40px; }
    .sl-pop button.indent::before { content: ""; position: absolute; left: 27px; top: 0; bottom: 0; width: 2px; background: #c4c7c5; }


    .sl-pop .k { margin-left: auto; padding-left: 24px; color: #444746; }
    .sl-pop hr { margin: 8px 0 8px 40px; border: 0; border-top: 1px solid #c7c7c7; }`;
  document.head.append(css);
  // Each slide paints its own background colour, so the area around it stays black.
  const paint = () => document.querySelectorAll('.reveal .slides section').forEach(s => {
    s.style.background = ''; Object.assign(s.style, window.bgCss ? window.bgCss(s) : { background: s.dataset.backgroundColor || '#fff' });   // shapes.js: colour, gradient, picture
  });

  const icon = d => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
  const I = { prev: 'M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z', next: 'M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z',
    play: 'M8 5v14l11-7z', pause: 'M6 19h4V5H6zm8-14v14h4V5z', check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
    notes: 'M3 6h18v2H3zm0 5h18v2H3zm0 5h12v2H3z', laser: 'M7 2v11h3v9l7-12h-4l4-8z',
    full: 'M5 16h3v3h2v-5H5zm3-8H5v2h5V5H8zm6 11h2v-3h3v-2h-5zm2-11V5h-2v5h5V8z', exit: 'M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
    hidden: 'M12 7a5 5 0 0 1 4.6 7l2.9 2.9A11.8 11.8 0 0 0 23 12c-1.7-4.4-6-7.5-11-7.5-1.4 0-2.7.3-4 .7l2.2 2.2A5 5 0 0 1 12 7zM2 4.3l2.7 2.7A11.8 11.8 0 0 0 1 12c1.7 4.4 6 7.5 11 7.5 1.5 0 3-.3 4.4-.8l3.3 3.3 1.3-1.3L3.3 3z',
    more: 'M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', sub: 'M10 17l5-5-5-5z' };
  const bar = document.createElement('div'); bar.className = 'sl-bar';
  bar.innerHTML = `<button data-a="prev" title="Previous">${icon(I.prev)}</button><button class="num" data-a="num" title="Go to slide"></button>
    <button data-a="next" title="Next">${icon(I.next)}</button><button data-a="more" title="Options">${icon(I.more)}</button>`;
  const num = bar.querySelector('.num');
  const showNum = () => { const { h, v } = Reveal.getIndices(); num.textContent = v ? `${h + 1}.${v}` : h + 1; };   // main slide 3, its sub-slides 3.1, 3.2
  // Menus as Slides': [icon, label, run, {on, key, sub}] rows, '-' for a divider; a sub opens a second menu to the right.
  let pop = null, sub = null, subTimer = 0;
  const closePop = () => { pop?.remove(); sub?.remove(); pop = sub = null; };
  const menu = (items, place) => {
    const m = document.createElement('div'); m.className = 'sl-pop';
    for (const it of items) {
      if (it === '-') { m.append(document.createElement('hr')); continue; }
      const [ic, label, run, o = {}] = it, b = document.createElement('button');
      b.innerHTML = `<span class="ic">${o.on ? icon(I.check) : ic ? icon(ic) : ''}</span><span></span>${o.key ? `<span class="k">${o.key}</span>` : o.sub ? `<span class="k">${icon(I.sub)}</span>` : ''}`;
      b.children[1].textContent = label; if (o.on) b.classList.add('on'); if (o.indent) b.classList.add('indent');
      if (o.sub) b.onmouseenter = b.onclick = () => { sub?.remove(); m.querySelector('.open')?.classList.remove('open'); b.classList.add('open'); sub = menu(o.sub, mm => { const r = b.getBoundingClientRect(); mm.style.left = r.right + 'px'; mm.style.top = Math.max(8, r.bottom - mm.offsetHeight + 8) + 'px'; }); };
      else { b.onmouseenter = () => { if (m === pop) subTimer = setTimeout(() => { sub?.remove(); sub = null; m.querySelector('.open')?.classList.remove('open'); }, 300); };
             b.onmouseleave = () => clearTimeout(subTimer); b.onclick = () => { closePop(); run(); }; }
      m.append(b);
    }
    m.onmouseenter = () => { if (m !== pop) clearTimeout(subTimer); };   // the pointer crossed the parent on its way into the submenu
    document.body.append(m); place(m); return m;
  };
  const openPop = (btn, items) => { closePop(); pop = menu(items, m => { if (!btn) return; const r = btn.getBoundingClientRect(); m.style.left = Math.max(8, r.right - m.offsetWidth) + 'px'; m.style.top = r.top - m.offsetHeight - 4 + 'px'; }); };
  let autoMs = 0, loop = false;
  const setAuto = (ms, lp = loop) => { autoMs = ms; loop = lp; Reveal.configure({ autoSlide: ms, loop: lp }); };
  const isFull = () => !!document.fullscreenElement;
  bar.addEventListener('mousedown', e => e.preventDefault());   // keep keyboard focus on the slides
  bar.onclick = e => {
    const btn = e.target.closest('button'), a = btn?.dataset.a;
    if (a === 'prev') Reveal.prev(); if (a === 'next') Reveal.next();
    if (a === 'num') { const at = Reveal.getIndices(); openPop(num, Reveal.getHorizontalSlides().flatMap((hs, h) => {   // the stacks as a tree, as the filmstrip
      const leaves = hs.querySelector(':scope > section') ? [...hs.querySelectorAll(':scope > section')] : [hs];
      return leaves.map((s, v) => [s.dataset.visibility === 'hidden' ? I.hidden : null, v ? `${h + 1}.${v}` : `Slide ${h + 1}`, () => Reveal.slide(h, v),
        { on: h === at.h && v === (at.v || 0), indent: v > 0 }]);
    })); }
    if (a === 'more') openPop(btn, [
      [I.notes, 'Open speaker notes', () => openPresenter(), { key: 'S' }],
      [I.laser, laser ? 'Turn off the laser pointer' : 'Turn on the laser pointer', toggleLaser, { key: 'L' }],
      [I.full, isFull() ? 'Exit full screen' : 'Full screen', () => isFull() ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(), { key: 'F' }],
      [I.exit, 'Exit slideshow', exit, { key: 'Esc' }], '-',
      [I.play, 'Auto-play', null, { sub: [
        [autoMs ? I.pause : I.play, autoMs ? 'Stop' : 'Play', () => setAuto(autoMs ? 0 : 2000)], '-',
        ...[1, 2, 3, 5, 10, 15, 30, 60].map(sec => [null, sec === 1 ? 'Every second' : sec < 60 ? `Every ${sec} seconds` : 'Every minute', () => setAuto(sec * 1000), { on: autoMs === sec * 1000 }]), '-',
        [null, 'Loop', () => setAuto(autoMs, !loop), { on: loop }]] }]]);
  };
  // Toolbar and cursor fade after 3 s without the mouse moving, as Slides.
  let idleTimer = 0;
  const wake = () => {
    bar.classList.remove('idle'); if (!laser && !pointerOff) document.documentElement.style.cursor = '';
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (pop) return; bar.classList.add('idle'); if (!laser) document.documentElement.style.cursor = 'none'; }, 3000);
  };
  addEventListener('pointermove', wake);
  /* A click on the slide advances, as Keynote and Slides: not on a link, a video, a field or the toolbar, not after a
     drag (selecting text), and not when the click only closes a menu or lifts the black / white screen. */
  let down = null;
  addEventListener('pointerdown', e => {
    down = null;
    if (pop && !e.target.closest?.('.sl-pop')) { closePop(); return; }
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || memo) return;
    if (screen) { screen.remove(); screen = null; return; }
    if (e.target.closest?.('.box.audio, a, [data-link], button, input, textarea, select, video, audio, iframe, [contenteditable], .sl-bar, .sl-pop')) return;
    if (!e.target.closest?.('.reveal')) return;
    down = { x: e.clientX, y: e.clientY };
  });
  /* Links (Insert → Link): # targets are slides or the end of the show; a linked picture, line or group (data-link)
     opens its link as a whole. A slide by data-sid follows that slide wherever it moved. */
  const follow = href => {
    const all = Reveal.getSlides(), at = all.indexOf(Reveal.getCurrentSlide()), to = s => { if (s) { const i = Reveal.getIndices(s); Reveal.slide(i.h, i.v); } };
    if (href === '#next') to(all[at + 1]); else if (href === '#previous') to(all[at - 1]);
    else if (href === '#first') to(all[0]); else if (href === '#last') to(all.at(-1));
    else if (href === '#exit') exit();
    else if (href.startsWith('#slide=')) to(all.find(s => s.dataset.sid === href.slice(7)));
    else if (href.startsWith('#')) location.hash = href;
    else if (/^https?:/i.test(href)) window.open(href, '_blank', 'noopener');
    else location.href = href;   // mailto:, tel:
  };
  /* Audio boxes: a click plays or pauses; the icon shows it playing; data-hide-icon hides it but it still plays. A soundtrack
     (data-soundtrack on .slides, Slideshow settings) plays from the start, looping with data-soundtrack-loop. */
  addEventListener('click', e => {
    const ab = e.target.closest?.('.reveal .box.audio'); if (!ab) return;
    const a = ab.querySelector('audio'); if (a) { a.paused ? a.play().catch(() => {}) : a.pause(); }
  }, true);
  document.querySelectorAll('.reveal .box.audio audio').forEach(a => ['play', 'pause', 'ended'].forEach(ev => a.addEventListener(ev, () => a.closest('.box').classList.toggle('playing', !a.paused))));
  const trackSrc = document.querySelector('.reveal .slides')?.getAttribute('data-soundtrack');
  if (trackSrc && !/print-pdf/.test(location.search)) {
    const track = Object.assign(new Audio(trackSrc), { loop: document.querySelector('.reveal .slides').hasAttribute('data-soundtrack-loop') }); track.id = 'sl-soundtrack'; document.body.append(track);
    const go = () => track.play().then(() => ['keydown', 'pointerdown'].forEach(ev => removeEventListener(ev, go, true))).catch(() => {});
    go(); ['keydown', 'pointerdown'].forEach(ev => addEventListener(ev, go, true));   // a browser lets sound start after the first key or click
  }
  addEventListener('click', e => {
    if (linksOnly && !e.target.closest?.('a, [data-link]')) { down = null; return; }   // Links only: a click elsewhere doesn't advance
    const a = e.target.closest?.('.reveal a[href^="#"]:not([href^="#/"]), .reveal .box[data-link]');
    if (a && !e.defaultPrevented) { e.preventDefault(); down = null; follow(a.getAttribute('href') ?? a.dataset.link); return; }
    const d = down; down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || String(getSelection())) return;
    Reveal.next();
  });
  /* Presenter view (S, ⋮ → Open speaker notes, or the editor's Slideshow ▾ → Presenter view): Keynote's presenter display
     in the Slides look, in a window of its own. The current slide and the next one, or the current slide after its next
     build ("Builds remaining: n"); the speaker notes (A− / A+, ⌘+ / ⌘−, Invert, U / D to scroll); the clock; a timer
     counting up or down from a time (Pause, Reset, R); Keynote's ready-to-advance bar, red while a transition or build
     plays. Layout turns each part on or off, kept in this browser. Keys there drive the show; ? lists them. The previews
     are this deck in frames (?gs-view). */
  let pv = null;
  const PV_KEYS = [['→ ↓ Space or click', 'Next build or slide'], ['← ↑', 'Previous slide'], ['[', 'Previous build'], [']', 'Next slide, skipping builds'],
    ['Home / End', 'First / last slide'], ['n then ↵', 'Go to slide n'], ['Z', 'Back through viewed slides'], ['B / W', 'Black / white screen'],
    ['R', 'Reset the timer'], ['U / D', 'Scroll the notes up / down'], ['⌘+ / ⌘−', 'Notes larger / smaller'], ['?', 'These keys'], ['Esc', 'End the slideshow']];
  const PV_PARTS = [['cur', 'Current slide'], ['next', 'Next slide'], ['notes', 'Speaker notes'], ['ready', 'Ready-to-advance bar'], ['clock', 'Clock'], ['timer', 'Timer']];
  const pvPrefs = () => { try { return { cur: 1, next: 1, notes: 1, ready: 1, clock: 1, timer: 1, size: 20, invert: 0, count: 'up', minutes: 20, ...JSON.parse(localStorage.getItem('gs-presenter') || '{}') }; } catch { return { cur: 1, next: 1, notes: 1, ready: 1, clock: 1, timer: 1, size: 20, invert: 0, count: 'up', minutes: 20 }; } };
  const openPresenter = (/** @type {any} */ host = null) => {   // host: a frame over the show (Rehearse) instead of a window
    if (pv && !pv.closed) { pv.focus(); return pv; }
    pv = host || window.open('', 'gs-presenter', 'width=1280,height=800'); if (!pv?.document?.open) return (pv = null);   // blocked (or a stand-in)
    const me = pv, gone = () => me.closed || pv !== me, end = () => { exit(); if (host) { host.frameElement?.remove(); pv = null; focus(); } else me.close(); };
    const d = me.document, u = new URL(location.href), o = pvPrefs(); u.hash = ''; ['embedded', 'rehearse'].forEach(k => u.searchParams.delete(k)); u.searchParams.set('gs-view', '1');
    const save = () => { try { localStorage.setItem('gs-presenter', JSON.stringify(o)); } catch { /* private window */ } };
    d.open(); d.write(`<!doctype html><html><head><meta charset="utf-8"><title>Presenter view</title><style>
      :root { --ink: #1f1f1f; --muted: #444746; --line: #c4c7c5; --hover: #e9eef6; --blue: #0b57d0; }
      * { box-sizing: border-box; } html, body { margin: 0; height: 100%; }
      body { display: flex; flex-direction: column; background: #f8fafd; color: var(--ink); font: 14px Roboto, "Google Sans", -apple-system, Arial, sans-serif; overflow: hidden; }
      .ready { height: 6px; flex: none; background: #34a853; transition: background .15s; } .ready.busy { background: #ea4335; }
      header { display: flex; align-items: center; gap: 24px; height: 64px; padding: 0 16px 0 24px; flex: none; }
      .clock, .timer .t { font: 400 28px/1 "Google Sans", Roboto, Arial, sans-serif; font-variant-numeric: tabular-nums; }
      .timer { display: flex; align-items: center; gap: 8px; } .timer .t.over { color: #b3261e; }
      button { font: 500 14px Roboto, Arial, sans-serif; color: var(--blue); background: none; border: 1px solid #747775; border-radius: 18px; height: 32px; padding: 0 14px; cursor: pointer; }
      button:hover { background: var(--hover); } .sp { flex: 1; }
      button.ic { border: 0; width: 40px; height: 40px; padding: 8px; border-radius: 50%; color: var(--muted); } button.ic svg { width: 24px; height: 24px; fill: currentColor; display: block; }
      main { flex: 2 1 0; min-height: 0; display: flex; gap: 24px; padding: 0 24px 16px; }   /* the slides take two thirds, the notes one */
      main .pane { display: flex; flex-direction: column; min-width: 0; } .cur { flex: 3; } .next { flex: 2; }
      h2 { margin: 0 0 8px; font: 500 14px Roboto, Arial, sans-serif; color: var(--muted); }
      .fit { flex: 1; min-height: 0; container-type: size; }   /* the frame: as large as fits, in the slide's shape */
      .frame { position: relative; width: min(100cqw, 100cqh * var(--arn)); aspect-ratio: var(--ar); background: #000; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
      .frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; pointer-events: none; } .frame.end iframe { visibility: hidden; }
      .notes { flex: 1 1 0; min-height: 120px; display: flex; flex-direction: column; margin: 0 24px 24px; background: #fff; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
      .nh { display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 8px 0 16px; border-bottom: 1px solid #e3e3e3; } .nh span { flex: 1; font-weight: 500; color: var(--muted); }
      .nt { flex: 1; overflow: auto; padding: 12px 16px; line-height: 1.45; } .nt:empty::before { content: "No speaker notes"; color: #747775; }
      .notes.inv, .notes.inv .nh { background: #1f1f1f; color: #fff; border-color: #444746; } .notes.inv .nh span { color: #c4c7c5; }
      body.no-cur .cur, body.no-next .next, body.no-notes .notes, body.no-ready .ready, body.no-clock .clock, body.no-timer .timer { display: none; }
      body.no-notes main { flex: 1; } body.no-cur.no-next main { display: none; }
      .pop { position: absolute; z-index: 5; min-width: 260px; padding: 8px 0; background: #fff; border-radius: 4px; box-shadow: 0 2px 6px 2px rgba(60,64,67,.15), 0 1px 2px rgba(60,64,67,.3); }
      .pop label { display: flex; align-items: center; gap: 12px; height: 36px; padding: 0 16px; cursor: pointer; } .pop label:hover { background: #f1f3f4; }
      .pop hr { margin: 8px 0; border: 0; border-top: 1px solid #e3e3e3; } .pop input[type=number] { width: 56px; height: 28px; margin-left: auto; }
      .keys { left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 16px 24px; } .keys h3 { margin: 0 0 8px; font: 500 16px Roboto, Arial, sans-serif; }
      .keys div { display: flex; gap: 24px; height: 30px; align-items: center; } .keys b { min-width: 150px; font-weight: 500; color: var(--muted); }
    </style></head><body>
      <div class="ready" title="Green: ready to advance. Red: a transition or build is playing"></div>
      <header><div class="clock"></div><div class="timer"><span class="t"></span><button data-a="pause">Pause</button><button data-a="reset">Reset</button></div><span class="sp"></span>
        <button class="ic" data-a="layout" title="Layout">${icon('M3 3h8v8H3zm10 0h8v5h-8zM3 13h8v8H3zm10-3h8v11h-8z')}</button>
        <button class="ic" data-a="help" title="Keyboard shortcuts (?)">${icon('M11 18h2v-2h-2zm1-16a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm0-14a4 4 0 0 0-4 4h2a2 2 0 1 1 4 0c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5a4 4 0 0 0-4-4z')}</button>
        <button class="ic" data-a="end" title="End slideshow (Esc)">${icon(I.exit)}</button></header>
      <main><div class="pane cur"><h2></h2><div class="fit"><div class="frame"><iframe title="Current slide"></iframe></div></div></div>
        <div class="pane next"><h2></h2><div class="fit"><div class="frame"><iframe title="Next"></iframe></div></div></div></main>
      <div class="notes"><div class="nh"><span>Speaker notes</span><button data-a="smaller" title="Smaller (⌘−)">A−</button><button data-a="bigger" title="Larger (⌘+)">A+</button><button data-a="invert">Invert colours</button></div><div class="nt"></div></div>
    </body></html>`   /* (no section tags: the deck file carries this script, and a deck's slides are counted by them) */); d.close();
    const $p = q => /** @type {HTMLElement} */ (d.querySelector(q)), [fc, fn] = [...d.querySelectorAll('iframe')], cfg = Reveal.getConfig();
    d.body.style.setProperty('--ar', `${cfg.width} / ${cfg.height}`); d.body.style.setProperty('--arn', String(cfg.width / cfg.height));
    const apply = () => { PV_PARTS.forEach(([k]) => d.body.classList.toggle('no-' + k, !o[k])); $p('.nt').style.fontSize = o.size + 'px'; $p('.notes').classList.toggle('inv', !!o.invert); };
    // the timer: counting up from the start, or down from o.minutes; Pause / Reset as Slides' presenter view
    let t0 = Date.now(), pausedAt = 0;
    const tick = () => {
      if (gone()) return clearInterval(clock);
      $p('.clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      const ms = (pausedAt || Date.now()) - t0, left = o.minutes * 60000 - ms, v = o.count === 'down' ? Math.abs(left) : ms, sec = Math.floor(v / 1000);
      $p('.timer .t').textContent = (o.count === 'down' && left < 0 ? '−' : '') + [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60].map(n => String(n).padStart(2, '0')).join(':');
      $p('.timer .t').classList.toggle('over', o.count === 'down' && left < 0);
    };
    const clock = setInterval(tick, 250);
    const resetTimer = () => { t0 = Date.now(); if (pausedAt) pausedAt = t0; tick(); };
    // what's shown: current and next, as Keynote's labels; the ready bar red while the change plays
    let busyT = 0;
    const sync = (ms = 0) => {
      if (gone()) return;
      const all = Reveal.getSlides(), sl = Reveal.getCurrentSlide(), at = Reveal.getIndices(sl), f = Reveal.getIndices().f ?? -1;
      const steps = [...new Set([...sl.querySelectorAll('.fragment')].map(e => +(e.dataset.fragmentIndex ?? 0)))].sort((a, b) => a - b).filter(n => n > f);
      const n = all[all.indexOf(sl) + 1], i = all.indexOf(sl) + 1;
      $p('.cur h2').textContent = `Current: Slide ${i} of ${all.length}`;
      $p('.next h2').textContent = steps.length ? `Builds remaining: ${steps.length}` : n ? `Next: Slide ${i + 1} of ${all.length}` : 'End of slideshow';
      fc.contentWindow?.postMessage({ gsView: 1, h: at.h, v: at.v || 0, f }, '*');
      const to = steps.length ? { h: at.h, v: at.v || 0, f: steps[0] } : n ? { ...Reveal.getIndices(n), f: -1 } : null;
      $p('.next .frame').classList.toggle('end', !to); if (to) fn.contentWindow?.postMessage({ gsView: 1, h: to.h, v: to.v || 0, f: to.f }, '*');
      const nt = sl.querySelector('aside.notes'); $p('.nt').innerHTML = nt ? nt.innerHTML : ''; $p('.nt').scrollTop = 0;
      clearTimeout(busyT); $p('.ready').classList.toggle('busy', ms > 0); if (ms > 0) busyT = setTimeout(() => $p('.ready').classList.remove('busy'), ms);
    };
    const playMs = e => {   // how long the change that just happened plays: the slide's transition, or the builds just shown
      if (e.type === 'slidechanged') { const sl = e.currentSlide, kind = sl.dataset.transition || cfg.transition, sp = sl.dataset.transitionSpeed || cfg.transitionSpeed;
        return sl.hasAttribute('data-auto-animate') ? (+sl.dataset.autoAnimateDuration || 1) * 1000 : kind === 'none' ? 0 : ({ fast: 400, slow: 1200 }[sp] || 800); }
      return Math.max(0, ...(e.fragments || []).map(x => (Math.max(secs(x, 'transitionDuration'), secs(x, 'animationDuration')) + secs(x, 'transitionDelay')) * 1000));
    };
    const onShow = e => sync(playMs(e));
    for (const ev of ['slidechanged', 'fragmentshown', 'fragmenthidden']) Reveal.on(ev, onShow);
    fc.onload = fn.onload = () => sync(); fc.src = fn.src = u.href;
    // the buttons, the Layout menu and the key list
    let pop = null; const close = () => { pop?.remove(); pop = null; };
    const popUp = (cls, html, at) => { close(); pop = d.createElement('div'); pop.className = 'pop ' + cls; pop.innerHTML = html; d.body.append(pop);
      if (at) { const r = at.getBoundingClientRect(); pop.style.left = Math.max(8, r.right - pop.offsetWidth) + 'px'; pop.style.top = r.bottom + 4 + 'px'; } return pop; };
    const layout = btn => {
      const p = popUp('lay', PV_PARTS.map(([k, l]) => `<label><input type="checkbox" data-k="${k}"${o[k] ? ' checked' : ''}>${l}</label>`).join('')
        + `<hr><label><input type="radio" name="c" value="up"${o.count === 'up' ? ' checked' : ''}>Timer counts up</label><label><input type="radio" name="c" value="down"${o.count === 'down' ? ' checked' : ''}>Counts down from<input type="number" min="1" max="600" value="${o.minutes}"> min</label>`, btn);
      p.onchange = e => { const t = /** @type {HTMLInputElement} */ (e.target);
        if (t.dataset.k) o[t.dataset.k] = t.checked ? 1 : 0; else if (t.type === 'radio') { o.count = t.value; resetTimer(); } else { o.minutes = Math.max(1, +t.value || 20); resetTimer(); }
        save(); apply(); tick(); };
    };
    const help = () => { if (pop?.classList.contains('keys')) return close(); popUp('keys', '<h3>Keyboard shortcuts</h3>' + PV_KEYS.map(([k, l]) => `<div><b>${k}</b><span>${l}</span></div>`).join('')); };
    const size = dz => { o.size = Math.max(12, Math.min(64, o.size + dz)); save(); apply(); };
    d.addEventListener('click', e => {
      const b = /** @type {HTMLElement} */ (e.target).closest?.('button'), a = b?.dataset.a;
      if (!b) { if (pop && !pop.contains(/** @type {Node} */ (e.target))) close(); return; }
      if (a === 'pause') { if (pausedAt) { t0 += Date.now() - pausedAt; pausedAt = 0; b.textContent = 'Pause'; } else { pausedAt = Date.now(); b.textContent = 'Resume'; } tick(); }
      if (a === 'reset') resetTimer();
      if (a === 'layout') pop?.classList.contains('lay') ? close() : layout(b);
      if (a === 'help') help();
      if (a === 'end') end();
      if (a === 'smaller' || a === 'bigger') size(a === 'smaller' ? -2 : 2);
      if (a === 'invert') { o.invert = o.invert ? 0 : 1; save(); apply(); }
    });
    d.addEventListener('keydown', e => {
      if (/** @type {HTMLElement} */ (e.target).matches?.('input[type=number]')) return;   // typing the countdown's minutes
      const k = e.key, mod = e.metaKey || e.ctrlKey;
      if (mod && (k === '+' || k === '=' || k === '-')) { e.preventDefault(); size(k === '-' ? -2 : 2); return; }
      if (mod || e.altKey) return;
      if (k === 'Escape') { e.preventDefault(); if (pop) close(); else end(); return; }
      if (host && e.key.toLowerCase() === 'x' && !e.shiftKey) { e.preventDefault(); host.frameElement.style.display = 'none'; focus(); return; }   // Rehearse: X shows the slide itself
      if (k === '?' || k === '/') { e.preventDefault(); help(); return; }
      const lk = k.toLowerCase(), all = Reveal.getSlides(), go = {
        ArrowRight: () => Reveal.next(), ArrowDown: () => Reveal.next(), ' ': () => Reveal.next(), PageDown: () => Reveal.next(),
        ArrowLeft: () => Reveal.prev(), ArrowUp: () => Reveal.prev(), PageUp: () => Reveal.prev(), Home: () => Reveal.slide(0, 0, -1), End: () => toSlide(all.at(-1), -1),
        '[': () => { if (!Reveal.prevFragment()) Reveal.prev(); }, ']': () => instant(() => toSlide(all[all.indexOf(Reveal.getCurrentSlide()) + 1], -1)) }[k];
      if (go && !e.shiftKey) { e.preventDefault(); go(); return; }
      if (lk === 'r') { e.preventDefault(); resetTimer(); return; }
      if (lk === 'u' || lk === 'd') { e.preventDefault(); $p('.nt').scrollBy({ top: lk === 'u' ? -80 : 80 }); return; }
      // the rest (a slide number then ↵, B / W, Z, ⇧-arrows …) as the show's own keys
      document.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: e.shiftKey, bubbles: true, cancelable: true })); e.preventDefault();
    });
    me.addEventListener('beforeunload', () => { for (const ev of ['slidechanged', 'fragmentshown', 'fragmenthidden']) Reveal.off(ev, onShow); clearInterval(clock); });
    if (!host) addEventListener('beforeunload', () => me.close());
    apply(); tick();
    return pv;
  };
  /** @type {any} */ (window).gsPresenter = openPresenter;   // the editor's Slideshow ▾ → Presenter view
  /* Rehearse slideshow (?rehearse, the editor's Slideshow ▾ → Rehearse slideshow), as Keynote: the presenter view on this
     screen, its timer running; X flips between it and the slide; Esc ends. */
  const rehearse = () => {
    rehearsal = document.createElement('iframe'); rehearsal.title = 'Rehearse slideshow';
    rehearsal.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:200;background:#f8fafd';
    document.body.append(rehearsal); openPresenter(rehearsal.contentWindow); rehearsal.contentWindow?.focus();
  };
  if (new URLSearchParams(location.search).has('rehearse')) Reveal.isReady() ? rehearse() : Reveal.on('ready', rehearse);
  Reveal.on('ready', () => { document.body.append(bar); paint(); showNum(); wake(); });
  Reveal.on('slidechanged', showNum);
})();
