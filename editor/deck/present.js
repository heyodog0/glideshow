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
  const FROM = { appear: 'none', 'fade-in': 'none', 'fade-right': 'translateX(-1em)', 'fade-left': 'translateX(1em)', 'fade-up': 'translateY(.8em)', 'fade-down': 'translateY(-.8em)', 'zoom-in': 'scale(.1)', 'scale-in': 'scale(0)', 'pop-in': 'scale(0)', 'spin-in': 'rotate(-360deg)', 'scale-big': 'scale(3)' };
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
        const mode = box.dataset.build, cls = [...box.classList].filter(c => /^(appear|fade-[\w-]+|zoom-in|wipe-[rldu]|move-in-[rldu]|scale-in|pop-in|spin|pulse|pop|line-draw|line-erase|move-to|blur-in|drop-in|spin-in|iris-in|scale-big|disappear|blur-out|scale-out|iris-out|grow|shrink|strike|semi-fade-out|current-visible|highlight-[\w-]+)$/.test(c));   // its effect
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
      if (f.classList.contains('move-to') && to.length === 2 && to.every(isFinite)) { st.setProperty('--gs-mx', to[0] - (parseFloat(st.left) || 0) + 'px'); st.setProperty('--gs-my', to[1] - (parseFloat(st.top) || 0) + 'px'); }
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
    .reveal .slides .box.fragment.gs-seq { opacity: 1 !important; visibility: inherit !important; transform: none !important; scale: none !important; animation: none !important; }
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
