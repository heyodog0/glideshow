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
  const FROM = { appear: 'none', 'fade-in': 'none', 'fade-right': 'translateX(-1em)', 'fade-left': 'translateX(1em)', 'fade-up': 'translateY(.8em)', 'fade-down': 'translateY(-.8em)', 'zoom-in': 'scale(.1)' };
  const wordByWord = (box, mode, cls) => {
    const eff = cls.find(c => c in FROM); if (!eff || cls.length > 1) return;
    const texts = [], tw = document.createTreeWalker(box.querySelector(':scope > .content') || box, NodeFilter.SHOW_TEXT);
    for (let n; (n = tw.nextNode());) if (n.data.trim()) texts.push(n);
    let i = 0;
    for (const t of texts) {
      const frag = document.createDocumentFragment();
      for (const piece of t.data.split(/(\s+)/)) {
        if (!piece) continue;
        if (/^\s+$/.test(piece)) { frag.append(piece); continue; }
        const word = document.createElement('span');
        if (mode === 'word') { word.className = 'gs-w'; word.style.setProperty('--i', String(i++)); word.textContent = piece; }
        else { word.className = 'gs-word'; for (const ch of piece) { const c = document.createElement('span'); c.className = 'gs-w'; c.style.setProperty('--i', String(i++)); c.textContent = ch; word.append(c); } }
        frag.append(word);
      }
      t.replaceWith(frag);
    }
    const total = (+box.dataset.duration || 1) * 1000, step = total / Math.max(1, i);
    box.classList.add('gs-seq');
    box.style.cssText += `;--gs-step:${step}ms;--gs-d:${eff === 'appear' ? 0 : Math.min(total, Math.max(200, step * 3))}ms;--gs-from:${FROM[eff]};--gs-ease:${box.dataset.ease || 'ease'};transition-duration:${total}ms`;
  };
  const prepare = () => {
    const all = Reveal.getSlides();
    all.forEach((sl, i) => { if (sl.hasAttribute('data-auto-animate') && all[i - 1] && !all[i - 1].hasAttribute('data-auto-animate')) all[i - 1].setAttribute('data-auto-animate', ''); });
    document.querySelectorAll('.reveal .slides .box').forEach(b => { if (!b.dataset.id) b.dataset.id = b.dataset.morph || b.id; });
    let changed = false;
    all.forEach(sl => {
      const frags = [...sl.querySelectorAll('.box.fragment[data-build]')].sort((a, b) => (+a.dataset.fragmentIndex || 0) - (+b.dataset.fragmentIndex || 0));
      frags.reverse().forEach(box => {   // from the last, so each one's room doesn't move the ones before it
        const mode = box.dataset.build, cls = [...box.classList].filter(c => /^(appear|fade-[\w-]+|zoom-in|grow|shrink|strike|semi-fade-out|current-visible|highlight-[\w-]+)$/.test(c));   // its effect
        if (mode === 'word' || mode === 'character') { wordByWord(box, mode, cls); return; }
        const table = box.querySelector(':scope > .content table'), cells = table ? [...table.querySelectorAll('td, th')] : [];
        const groups = mode === 'row' ? [...(table?.rows || [])].map(r => [r]) : mode === 'cell' ? cells.map(c => [c])
          : mode === 'column' ? [...new Set(cells.map(c => /** @type {HTMLTableCellElement} */ (c).cellIndex))].sort((a, b) => a - b).map(n => cells.filter(c => /** @type {HTMLTableCellElement} */ (c).cellIndex === n))
          : [...box.querySelectorAll(':scope > .content > :is(p, div, h1, h2, h3, h4, h5, h6), :scope > .content > :is(ul, ol) > li')].map(p => [p]);
        if (groups.length < 2) return;
        const at = +box.dataset.fragmentIndex || 0;
        sl.querySelectorAll('.fragment').forEach(f => { if (f !== box && +f.dataset.fragmentIndex > at) f.dataset.fragmentIndex = String(+f.dataset.fragmentIndex + groups.length - 1); });
        box.classList.remove('fragment', ...cls); delete box.dataset.fragmentIndex;
        groups.forEach((g, i) => g.forEach(el => { el.classList.add('fragment', ...cls); if (mode === 'highlight') el.classList.add('gs-hl'); el.dataset.fragmentIndex = String(at + i);
          for (const k of i ? ['duration', 'ease'] : ['duration', 'ease', 'delay', 'start']) if (box.dataset[k]) el.dataset[k] = box.dataset[k]; }));   // the box's timing; its start and delay on the first part
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
      const d = f.dataset; if (d.duration) f.style.transitionDuration = d.duration + 's'; if (d.ease) f.style.transitionTimingFunction = d.ease;
      if (d.delay && !/^(after|transition)$/.test(d.start || '')) f.style.transitionDelay = d.delay + 's';
    });
    if (changed) Reveal.sync();
    if (new URLSearchParams(location.search).get('view') === 'scroll') Reveal.configure({ view: 'scroll' });   // read as a page (reveal's scroll view)
  };
  Reveal.isReady() ? prepare() : Reveal.on('ready', prepare);
  const embedded = new URLSearchParams(location.search).has('embedded');
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
    else if (k === 's' && Reveal.hasPlugin('notes')) { e.preventDefault(); e.stopImmediatePropagation(); Reveal.getPlugin('notes').open(); }

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
    Reveal.configure({ slideNumber: false, margin: 0, pdfSeparateFragments: false, pdfMaxPagesPerSlide: 1, showNotes: false });
    const css = document.createElement('style');
    css.textContent = `* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }   /* without the print dialog's "Background graphics" */
      @page { margin: 0; } .reveal .slide-number, .sl-bar { display: none !important; }`;
    document.head.append(css);
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

  Reveal.configure({ controls: false, progress: false, slideNumber: false, margin: 0 });   // edge to edge, as Slides
  const css = document.createElement('style');
  css.textContent = `
    html, body, .reveal { background: #000 !important; }
    .sl-instant .reveal .slides section, .sl-instant .reveal .slides .fragment { transition: none !important; }
    .reveal .box[data-link], .reveal .box.audio { cursor: pointer; }
    .reveal .box.audio[data-hide-icon] { opacity: 0; }
    .reveal .slides .box.fragment.gs-seq { opacity: 1 !important; visibility: inherit !important; transform: none !important; }
    .reveal .gs-seq .gs-w { display: inline-block; opacity: 0; transform: var(--gs-from); transition: opacity var(--gs-d) var(--gs-ease), transform var(--gs-d) var(--gs-ease); transition-delay: calc(var(--i) * var(--gs-step)); }
    .reveal .gs-seq.visible .gs-w { opacity: 1; transform: none; }
    .reveal .gs-word { white-space: nowrap; }
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
      [I.notes, 'Open speaker notes', () => Reveal.getPlugin?.('notes')?.open(), { key: 'S' }],
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
  Reveal.on('ready', () => { document.body.append(bar); paint(); showNum(); wake(); });
  Reveal.on('slidechanged', showNum);
})();
