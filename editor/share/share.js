/* Comments on a shared deck (glideshow.org/p/…): a panel over the presented deck. The page that serves the deck sets
   window.GLIDESHOW = {comments: <api url>, pass, me: {n} | null, signin: <url>, report: <url>, owner, title}; comments are
   anchored to a slide (its number among all slides, stacks flattened, as in the editor), a point on it and the box there,
   if any. The deck runs sandboxed, without the viewer's cookies, so the API is told who is commenting by `pass` (an
   encrypted pass for this deck, cloud/share.js) and marks the viewer's own comments `mine`. */
(() => {
  const G = window.GLIDESHOW; if (!G) return;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const deckEl = () => window.Reveal?.getRevealElement?.() || document.querySelector('.reveal:not(.gs-pic-reveal)');   // the deck itself, not a filmstrip picture
  const leaves = () => window.Reveal?.getSlides?.() ||   // reveal.js's own list: its phone scroll view wraps the sections in pages of its own
    [...(deckEl()?.querySelectorAll(':scope > .slides > section') || [])].flatMap(s => s.querySelector(':scope > section') ? [...s.querySelectorAll(':scope > section')] : [s]);
  const curIndex = () => Math.max(0, leaves().indexOf(window.Reveal?.getCurrentSlide?.()));
  /* A comment's slide: the one with its data-sid, wherever slides have moved since; else the number it was left on. */
  const slideOf = c => { const i = c.sid ? leaves().findIndex(s => s.dataset.sid === c.sid) : -1; return i >= 0 ? i + 1 : c.slide; };
  const goTo = n => { const s = leaves()[n - 1]; if (!s || !window.Reveal) return; const i = Reveal.getIndices(s); Reveal.slide(i.h, i.v); };
  const ago = t => { const s = (Date.now() - Date.parse(t)) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }); };
  let list = [], open = false, showResolved = false, placing = null, draft = null, timer = /** @type {any} */ (0);

  const btn = el('button', 'gs-toggle'); btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M4 4h16v12H5.17L4 17.17V4m0-2c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2H4z"/></svg><span>Comments</span><b class="gs-n"></b>';
  const panel = el('aside', 'gs-panel'); panel.hidden = true;
  const X = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M18.3 5.71 12 12.01l-6.3-6.3-1.41 1.41 6.3 6.3-6.3 6.3 1.41 1.41 6.3-6.3 6.3 6.3 1.41-1.41-6.3-6.3 6.3-6.3z"/></svg>';
  const hint = el('div', 'gs-hint', 'Click on the slide where the comment goes. Esc to cancel.'); hint.hidden = true;

  /* ---- the filmstrip: every slide as a picture, down the left (a row along the bottom on a phone), the current one
     ringed in canopy blue with its number, and its open comments counted; a click goes there. Open on a computer, shut
     on a phone, by the button at the top left (for this visit: the sandboxed page keeps nothing). ---- */
  const strip = el('nav', 'gs-strip'), stripBtn = el('button', 'gs-strip-toggle'); strip.setAttribute('aria-label', 'Slides');
  stripBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm2 0v14h4V5H5zm6 0v14h8V5h-8z"/></svg>';
  stripBtn.title = 'Slides';
  let stripOn = innerWidth > 700;
  try { const v = localStorage.getItem('glideshow-strip'); if (v) stripOn = v === '1'; } catch {}
  const PIC = 120;   // a picture's width
  function buildStrip() {
    const R = window.Reveal, W = R?.getConfig?.().width || 1920, H = R?.getConfig?.().height || 1080;
    strip.style.setProperty('--gs-pic-h', Math.round(PIC * H / W) + 'px');
    strip.replaceChildren(...leaves().map((s, i) => {
      const cell = el('button', 'gs-cell'), pic = el('div', 'gs-pic'), wrap = el('div', 'reveal gs-pic-reveal'), slides = el('div', 'slides');
      const c = /** @type {HTMLElement} */ (s.cloneNode(true));
      [c, ...c.querySelectorAll('[id]')].forEach(e => e.removeAttribute('id'));
      c.removeAttribute('hidden'); c.removeAttribute('aria-hidden'); c.className = c.className.replace(/\b(past|present|future|stack)\b/g, '');
      c.style.cssText = 'display: block; position: absolute; inset: 0; width: 100%; height: 100%; transform: none; opacity: 1; visibility: visible;';
      c.querySelectorAll('.fragment').forEach(f => f.classList.add('visible'));   // as built in full
      c.querySelectorAll('video').forEach(v => { const im = el('img', 'gs-still'); const p = v.getAttribute('poster'); if (p) im.src = p; v.replaceWith(im); });
      c.querySelectorAll('iframe').forEach(f => f.replaceWith(el('div', 'gs-still')));
      c.querySelectorAll('img').forEach(im => { im.loading = 'lazy'; });
      c.querySelectorAll('.gs-marker, aside.notes').forEach(e => e.remove());
      Object.assign(slides.style, { width: W + 'px', height: H + 'px', inset: '0', margin: '0', transform: 'none', pointerEvents: 'none' });
      Object.assign(wrap.style, { width: W + 'px', height: H + 'px', transform: `scale(${PIC / W})` });
      // the slide's background is a layer reveal.js draws apart from the slide (and the slideshow's letterbox is black)
      const bg = R?.getSlideBackground?.(s), cs = bg && getComputedStyle(bg), clear = !cs || /^(transparent|rgba\(0, 0, 0, 0\))$/.test(cs.backgroundColor);
      wrap.style.setProperty('background-color', clear ? (s.dataset.backgroundColor || '#fff') : cs.backgroundColor, 'important');
      if (cs && cs.backgroundImage !== 'none') for (const k of ['background-image', 'background-size', 'background-position', 'background-repeat']) wrap.style.setProperty(k, cs.getPropertyValue(k), 'important');
      slides.append(c); wrap.append(slides); pic.append(wrap);
      cell.append(el('span', 'gs-num', String(i + 1)), pic, el('b', 'gs-cn'));
      cell.title = `Slide ${i + 1}`; cell.onclick = () => goTo(i + 1);
      return cell;
    }));
    markStrip();
  }
  function markStrip() {
    const here = curIndex(), live = list.filter(c => !c.resolved);
    [...strip.children].forEach((cell, i) => {
      cell.classList.toggle('cur', i === here);
      const n = G.me ? live.filter(c => c.slide === i + 1).length : 0; cell.querySelector('.gs-cn').textContent = n ? String(n) : '';
    });
    const cur = /** @type {HTMLElement} */ (strip.children[here]);
    if (cur && stripOn) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  /* shown when it's on, unless the comments panel is open too and the slide would be left too narrow between them (it
     comes back when the panel closes) */
  const stripShown = () => stripOn && !(open && innerWidth > 700 && innerWidth - 176 - 360 < 480);
  function showStrip(on = !stripOn, remember = true) {
    stripOn = on;
    if (remember) try { localStorage.setItem('glideshow-strip', on ? '1' : '0'); } catch {}
    relayout(); if (on) markStrip();
  }
  /* the deck's sticky notes (share.css shows them): a button beside the filmstrip's hides them, on the slide and in the
     filmstrip, for this visit; there only when the deck has notes */
  const notesBtn = el('button', 'gs-notes-toggle');
  notesBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10l6-6V5a2 2 0 0 0-2-2zM5 19V5h14v9h-5v5H5zm2-12h10v2H7V7zm0 4h6v2H7v-2z"/></svg>';
  let notesOn = true;
  try { notesOn = localStorage.getItem('glideshow-sticky') !== '0'; } catch {}
  function showNotes(on = !notesOn, remember = true) {
    notesOn = on; document.body.classList.toggle('gs-notes-off', !on); notesBtn.classList.toggle('on', on);
    notesBtn.title = on ? 'Hide sticky notes' : 'Show sticky notes'; notesBtn.setAttribute('aria-pressed', String(on));
    if (remember) try { localStorage.setItem('glideshow-sticky', on ? '1' : '0'); } catch {}
  }
  notesBtn.onclick = () => showNotes();
  stripBtn.onclick = () => { if (open && !stripShown()) toggle(false); showStrip(open ? true : !stripOn); };   // (a tucked-away strip comes back, the panel giving way)
  addEventListener('resize', () => { if (document.body.classList.contains('gs-strip-on') !== stripShown()) relayout(); });
  document.body.append(btn, panel, hint, strip, stripBtn);
  if (G.edit) {   // whoever may edit gets an Edit button: the editor, for this deck (glideshow.org/e/…)
    const edit = el('a', 'gs-edit'); edit.href = G.edit; edit.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg><span>Edit</span>';
    document.body.append(edit);
  }
  panel.addEventListener('keydown', e => e.stopPropagation());   // typing is not for the slideshow

  async function api(body) {
    const headers = { 'X-Glideshow-View': G.pass || '', ...(body ? { 'X-Glideshow': '1', 'content-type': 'application/json' } : {}) };
    const r = await fetch(G.comments, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (Array.isArray(j.comments)) list = j.comments.map(c => ({ ...c, slide: slideOf(c) }));
    return j;
  }
  const typing = () => [...panel.querySelectorAll('input:not([type=checkbox]), textarea')].some(i => i.value.trim() || i === document.activeElement);
  const refresh = async () => { if (G.me && !typing()) { await api(); if (!typing()) render(); } };   // never under someone's fingers

  function markers() {
    document.querySelectorAll('.gs-marker').forEach(m => m.remove());
    const s = leaves()[curIndex()], n = curIndex() + 1; if (!s || !open) return;
    list.filter(c => c.slide === n && (showResolved || !c.resolved)).forEach((c, i) => {
      const m = el('button', 'gs-marker' + (c.resolved ? ' done' : ''), String(i + 1)); m.style.left = c.x + 'px'; m.style.top = c.y + 'px'; m.title = c.text;
      m.onclick = e => { e.stopPropagation(); panel.querySelector(`[data-id="${c.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); flash(c.id); };
      s.append(m);
    });
  }
  const flash = id => { const card = panel.querySelector(`[data-id="${id}"]`); card?.classList.add('flash'); setTimeout(() => card?.classList.remove('flash'), 900); };

  function render() {
    const live = list.filter(c => !c.resolved);
    btn.querySelector('.gs-n').textContent = live.length || '';
    panel.replaceChildren();
    const head = el('header'); head.append(el('h2', '', 'Comments'), el('b', 'gs-n', live.length ? String(live.length) : ''));
    const close = el('button', 'gs-x'); close.innerHTML = X; close.title = 'Close (Esc)'; close.onclick = () => toggle(false); head.append(close); panel.append(head);
    const foot = el('div', 'gs-foot'), report = el('a', '', 'Report this deck');   // to glideshow.org's own report form (worker.js)
    report.href = G.report || '/report'; report.target = '_blank'; report.rel = 'noopener'; foot.append(report);
    if (!G.me) {
      const p = el('p', 'gs-empty'); p.append('Sign in to see and add comments. ');
      const a = el('a', '', 'Sign in'); a.href = G.signin; p.append(a); panel.append(p, foot); return;
    }
    const tools = el('div', 'gs-tools'), add = el('button', 'gs-primary', 'Add a comment'); add.onclick = startPlacing;
    const res = el('label', 'gs-check'), cb = el('input'); cb.type = 'checkbox'; cb.checked = showResolved; cb.onchange = () => { showResolved = cb.checked; render(); }; res.append(cb, ' Show resolved');
    tools.append(add, res); panel.append(tools);
    if (draft) panel.append(composer());
    const shown = list.filter(c => showResolved || !c.resolved).sort((a, b) => a.slide - b.slide || a.at.localeCompare(b.at));
    if (!shown.length && !draft) panel.append(el('p', 'gs-empty', list.length ? 'All comments are resolved.' : 'No comments yet.'));
    const here = curIndex() + 1, perSlide = {};
    for (const c of shown) {
      const k = (perSlide[c.slide] = (perSlide[c.slide] || 0) + 1);
      const card = el('div', 'gs-card' + (c.resolved ? ' done' : '') + (c.slide === here ? ' here' : '')); card.dataset.id = c.id;
      const top = el('div', 'gs-top'); top.append(el('span', 'gs-chip', `Slide ${c.slide} · ${k}`), el('span', 'gs-when', ago(c.at)));
      card.append(top);
      if (c.quote) card.append(el('div', 'gs-quote', c.quote));
      card.append(el('div', 'gs-by', c.by?.n || c.by?.e || ''), el('div', 'gs-text', c.text));
      for (const r of c.replies || []) {
        const rr = el('div', 'gs-reply' + (r.event ? ' event' : '')); rr.append(el('span', 'gs-by', r.by?.n || r.by?.e || ''), ' ', el('span', '', r.text)); card.append(rr);
      }
      const acts = el('div', 'gs-acts');
      const reply = el('input', 'gs-in'); reply.placeholder = 'Reply'; reply.gsKey = async e => { if (e.key === 'Enter' && reply.value.trim()) { await api({ op: 'reply', id: c.id, text: reply.value }); render(); } };
      const resolve = el('button', 'gs-link', c.resolved ? 'Reopen' : 'Resolve'); resolve.onclick = async e => { e.stopPropagation(); await api({ op: 'resolve', id: c.id, resolved: !c.resolved }); render(); };
      acts.append(reply, resolve);
      if (c.mine) { const del = el('button', 'gs-link', 'Delete'); del.onclick = async e => { e.stopPropagation(); if (confirm('Delete this comment?')) { await api({ op: 'delete', id: c.id }); render(); } }; acts.append(del); }
      card.append(acts);
      card.onclick = e => { if (!e.target.closest('input, button')) { goTo(c.slide); } };
      panel.append(card);
    }
    panel.append(foot);
    markers(); markStrip();
  }

  function composer() {
    const box = el('div', 'gs-card gs-new'), ta = el('textarea', 'gs-in'); ta.placeholder = `Comment on slide ${draft.slide}`; ta.rows = 3;
    const row = el('div', 'gs-acts'), post = el('button', 'gs-primary', 'Comment'), cancel = el('button', 'gs-link', 'Cancel');
    post.onclick = async () => { if (!ta.value.trim()) return; const j = await api({ op: 'add', ...draft, text: ta.value }); if (!j.error) { draft = null; render(); } };
    cancel.onclick = () => { draft = null; render(); };
    ta.gsKey = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post.click(); if (e.key === 'Escape') cancel.click(); };
    if (draft.quote) box.append(el('div', 'gs-quote', draft.quote));
    row.append(post, cancel); box.append(ta, row); setTimeout(() => ta.focus());
    return box;
  }

  function startPlacing() { placing = true; hint.hidden = false; document.body.classList.add('gs-placing'); }
  function stopPlacing() { placing = false; hint.hidden = true; document.body.classList.remove('gs-placing'); }
  /* Esc puts away what's open: choosing a place for a comment, then the panel. The page that serves the deck calls this
     from a key handler of its own that runs before the deck's (whose Esc leaves the slideshow); the one here is for a page
     without it. */
  window['gsEscape'] = () => { if (placing) { stopPlacing(); return true; } if (open && !typing()) { toggle(false); return true; } return false; };
  addEventListener('keydown', e => { if (e.key === 'Escape' && window['gsEscape']()) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  addEventListener('click', e => {
    if (!placing || e.target.closest('.gs-panel, .gs-toggle, .gs-strip, .gs-strip-toggle')) return;
    const s = leaves()[curIndex()]; if (!s) return;
    e.preventDefault(); e.stopPropagation();
    const r = s.getBoundingClientRect(), k = s.offsetWidth / r.width;
    const box = document.elementsFromPoint(e.clientX, e.clientY).map(x => x.closest?.('.box')).find(b => b && s.contains(b));
    draft = { slide: curIndex() + 1, sid: leaves()[curIndex()]?.dataset.sid || '', x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, box: box?.id || '', quote: (box?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120) };
    stopPlacing(); render();
  }, true);

  /* With the panel or the filmstrip beside it the slide may be under reveal.js's 435 px, where it turns into its phone
     scroll view (the slide blown up and cut off): not while either is open on a wide screen. */
  let scrollWidth;
  function relayout() {
    document.body.classList.toggle('gs-strip-on', stripShown()); stripBtn.classList.toggle('on', stripShown());
    const R = window.Reveal, squeezed = (open || stripShown()) && innerWidth > 700;
    if (R?.configure && squeezed) { scrollWidth ??= R.getConfig().scrollActivationWidth; R.configure({ scrollActivationWidth: null }); }
    else if (R?.configure && scrollWidth !== undefined) R.configure({ scrollActivationWidth: scrollWidth });
    setTimeout(() => { R?.layout?.(); dispatchEvent(new Event('resize')); }, 50);
  }
  function toggle(on = !open) {
    open = on; panel.hidden = !on; btn.classList.toggle('on', on); document.body.classList.toggle('gs-open', on);
    clearInterval(timer); if (on) { refresh(); timer = setInterval(refresh, 20000); }
    relayout(); render();
  }
  btn.onclick = () => toggle();
  const wire = () => { buildStrip(); showStrip(stripOn, false); notesBtn.hidden = !deckEl()?.querySelector('.box.note'); document.body.append(notesBtn); showNotes(notesOn, false); window.Reveal?.on?.('slidechanged', () => { if (open) render(); else markStrip(); }); };
  if (window.Reveal?.isReady?.()) wire(); else window.Reveal?.on?.('ready', wire);
  if (G.me) api().then(render); else render();
})();

/* (as present.js does in decks saved since: a shared link's deck may have been saved before) */
/* reveal.js pauses a slide's videos when it is left and, coming back, plays only those marked data-autoplay themselves;
   a Glideshow deck marks their box (.box[data-autoplay]), so they came back still (2026-10-21). Play them again whenever
   their slide or fragment is shown. */
(function playShown() {
  const R = window.Reveal; if (!R?.on || !R.isReady?.()) { setTimeout(playShown, 200); return; }
  const play = () => R.getCurrentSlide()?.querySelectorAll('.box[data-autoplay] video, video[autoplay]').forEach(v => {
    if (v.closest('.fragment:not(.visible)') || !v.paused) return;
    v.play().catch(() => {});
  });
  R.on('slidechanged', play); R.on('fragmentshown', play); play();
})();

/* Speaker notes on a shared link (S, or ⋮ → Open speaker notes). The deck runs sandboxed, with no origin of its own, so
   reveal.js's notes plugin opened a blank window it couldn't write (2026-10-22). Its `open` is this instead: Glideshow's
   speaker page (share/speaker.html), a page of glideshow.org's own, kept in step by postMessage: the slide, its step and
   its notes go there; Next / Previous come back. In the speaker page's two pictures (frames of this same deck) nothing of
   this viewer shows. */
(function speaker() {
  if (!window.GLIDESHOW) return;
  if (window.top !== window || new URLSearchParams(location.search).has('speaker')) { document.documentElement.classList.add('gs-preview'); return; }
  const R = window.Reveal; if (!R?.on || !R.isReady?.()) { setTimeout(speaker, 200); return; }
  let win = /** @type {Window | null} */ (null);
  const state = () => {
    const i = R.getIndices(), all = R.getSlides(), cur = R.getCurrentSlide();
    const notes = cur?.querySelector('aside.notes'), text = notes ? (notes.innerText || notes.textContent || '').trim() : (cur?.getAttribute('data-notes') || '');
    return { h: i.h, v: i.v || 0, f: i.f ?? -1, n: all.indexOf(cur) + 1, total: all.length, last: R.isLastSlide() && !R.availableFragments().next, notes: text };
  };
  const send = () => { if (win && !win.closed) win.postMessage({ gs: 'speaker', state: state() }, '*'); };
  const open = () => {
    if (win && !win.closed) { win.focus(); send(); return; }
    const deck = new URL(document.baseURI).pathname;   // the link's address (with a signed-in viewer's pass, as the deck's <base> has it)
    win = window.open('/share/speaker.html?deck=' + encodeURIComponent(deck), 'gs-speaker', 'width=1100,height=720');
  };
  addEventListener('message', e => {
    if (!win || e.source !== win) return;
    const m = e.data;
    if (m?.gs === 'speaker-ready') send();
    if (m?.gs === 'speaker-nav') { m.dir === 'prev' ? R.prev() : R.next(); }
  });
  ['slidechanged', 'fragmentshown', 'fragmenthidden'].forEach(ev => R.on(ev, send));
  const plugin = R.getPlugin?.('notes'); if (plugin) plugin.open = open;
  addEventListener('keydown', e => {   // a deck saved before present.js sent S to the plugin's open: its own binding is reveal's
    if (e.key?.toLowerCase() !== 's' || e.metaKey || e.ctrlKey || e.altKey || /** @type {any} */ (e.target)?.closest?.('input, textarea, [contenteditable]')) return;
    e.preventDefault(); e.stopImmediatePropagation(); open();
  }, true);
})();
