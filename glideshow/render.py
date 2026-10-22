# /// script
# dependencies = ["playwright"]
# ///
"""Render a deck's slides to PNG at 1920×1080 in headless Chrome, and check them: `glideshow render` / `glideshow check` (an
agent looking at its work) and test/snap.py (references) all run this. A uv script, so Playwright comes with it and the
package keeps no dependencies.

    uv run glideshow/render.py DECK_DIR OUT_DIR [N ...] [--check] [--json] [--morph]

Writes OUT_DIR/slide-NN.png and prints each path, then one line per problem found ("slide 3: ..."): text spilling out
of its box, code cut off, a box off the slide, text overlapping other text (or partly over a picture, or crossed by a
line), text under 24 px or hard to see against its background, a picture that didn't load, has no alt text or is
squeezed into a box of another shape, a box without an id (or a duplicate), a line attached to a box that isn't there
(or to a side that isn't t/r/b/l), a Morph pairing with nothing on the slide before, and notes for the AI still on a slide. Each slide is shown as it looks
after its last build step, with transitions and Morph off, so nothing is caught mid-animation. --check only checks (no
pictures; exit status 1 when it finds something). --json prints {"slides": [paths], "problems": [{slide, box, kind,
message}]}. --morph adds, for each Morph step, which boxes pair with the slide before and how they move, resize,
recolour or fade, and a picture halfway through the animation (slide-NN-morph.png). Serves DECK_DIR over http so assets
and fonts load as in a browser.
"""
import functools, http.server, json, signal, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright


# An animated GIF's first frame (createImageBitmap decodes it), so a screenshot never catches it mid-animation.
FIRST_FRAME_JS = r"""async () => {
  const still = async src => { const bm = await createImageBitmap(await (await fetch(src)).blob()); const c = document.createElement('canvas');
    c.width = bm.width; c.height = bm.height; c.getContext('2d').drawImage(bm, 0, 0); return c.toDataURL('image/png'); };
  for (const im of document.querySelectorAll('img')) if (/^data:image\/gif|\.gif(\?|$)/i.test(im.src)) { im.src = await still(im.src); await im.decode().catch(() => 0); }
}"""


def serve(root: Path) -> int:

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass   # (setting it on the partial below never reached the handler)
    handler = functools.partial(Quiet, directory=str(root))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1]


# What `check` looks for, on the slide on show (built to its last step). Geometry is the deck's own (px on the canvas);
# text is measured where it is drawn. `authored`: whether the deck itself gives this slide data-auto-animate (the
# slideshow adds it to the slide before a Morph slide as it loads, which must not count as a Morph step).
CHECK_JS = r"""([i, ids, authored]) => {
  const sec = Reveal.getCurrentSlide(), W = Reveal.getConfig().width, H = Reveal.getConfig().height, out = [];
  const S = sec.getBoundingClientRect(), k = S.width / W || 1;
  const toCanvas = r => ({ x: (r.left - S.left) / k, y: (r.top - S.top) / k, w: r.width / k, h: r.height / k });
  const px = (e, key) => parseFloat(e.style[key]) || 0, name = b => b.id ? '#' + b.id : `box ${[...sec.querySelectorAll('.box')].indexOf(b) + 1} (no id)`;
  const say = (b, kind, message) => out.push({ slide: i + 1, box: b?.id || '', kind, message });
  const text = b => (b.querySelector(':scope > .content')?.textContent || '').replace(/\s+/g, ' ').trim();
  const quote = b => { const t = text(b); return t ? ` ("${t.slice(0, 40)}${t.length > 40 ? '…' : ''}")` : ''; };
  const isLine = b => /^(line|arrowline|elbow|curve|path)$/.test(b.dataset.shape || '');
  const top = [...sec.children].filter(b => b.classList?.contains('box'));
  const all = [...sec.querySelectorAll('.box')];
  const textual = all.filter(b => text(b) && !b.classList.contains('note') && !isLine(b) && !b.classList.contains('group') && b.offsetParent !== null);
  const textRect = b => {   // where the box's text is drawn (the union of its lines), on the canvas
    const r = document.createRange(); r.selectNodeContents(b.querySelector(':scope > .content'));
    const rs = [...r.getClientRects()].filter(q => q.width > 0.5 && q.height > 0.5); if (!rs.length) return null;
    const u = { left: Math.min(...rs.map(q => q.left)), top: Math.min(...rs.map(q => q.top)), right: Math.max(...rs.map(q => q.right)), bottom: Math.max(...rs.map(q => q.bottom)) };
    return toCanvas({ left: u.left, top: u.top, width: u.right - u.left, height: u.bottom - u.top });
  };
  const boxRect = b => toCanvas(b.getBoundingClientRect());
  const meet = (A, B) => ({ w: Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x), h: Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y) });
  const inside = (P, Q) => P.x >= Q.x - 1 && P.y >= Q.y - 1 && P.x + P.w <= Q.x + Q.w + 1 && P.y + P.h <= Q.y + Q.h + 1;

  for (const b of sec.querySelectorAll('.box.note')) say(b, 'note', `a note for you is still on the slide: "${text(b)}" (do it, then delete the note)`);
  for (const b of all) {
    if (!b.id) say(b, 'id', `${name(b)}${quote(b)} has no id`);
    else if (ids[b.id] > 1) say(b, 'id', `#${b.id} is used by ${ids[b.id]} boxes in the deck; ids must be unique`);
  }
  for (const b of top) {   // off the slide
    if (b.classList.contains('note')) continue;
    const x = px(b, 'left'), y = px(b, 'top'), w = px(b, 'width'), h = px(b, 'height');
    const over = Math.max(-x, -y, x + w - W, y + h - H);
    if (over > 2) say(b, 'off-slide', `${name(b)}${quote(b)} reaches ${Math.round(over)} px past the edge of the slide (it's at ${Math.round(x)},${Math.round(y)} size ${Math.round(w)}×${Math.round(h)}; the slide is ${W}×${H})`
      + (b.classList.contains('image') ? '; to keep the picture where it shows now, crop the hidden part (data-crop="top right bottom left", shares 0–1) and shrink the box to the visible part' : ''));
  }
  for (const b of textual) {   // text that doesn't fit, small text
    const c = b.querySelector(':scope > .content'), fit = parseFloat(b.style.getPropertyValue('--fit')) || 1, cs = getComputedStyle(c);
    const T = textRect(b), B = boxRect(b);   // where the lines are drawn, against the box
    if (T) {
      const bottom = T.y + T.h, spill = Math.round(Math.max(bottom - (B.y + B.h), B.y - T.y)), pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      if (bottom > H + 2) say(b, 'off-slide', `text in ${name(b)}${quote(b)} runs ${Math.round(bottom - H)} px off the bottom of the slide (and ${spill} px out of its box): it must be shorter or smaller, or start higher`);
      else if (spill > 6) say(b, 'overflow', `text in ${name(b)}${quote(b)} spills ${spill} px out of its box: make the box at least ${Math.ceil(bottom - B.y + parseFloat(cs.paddingBottom))} px tall (it is ${Math.round(B.h)}), or the text about ${Math.max(10, Math.floor((B.h - pad) / T.h * 100))}% of its size, or set data-autofit="shrink"`);
    }
    else if (fit < 0.7) say(b, 'overflow', `text in ${name(b)}${quote(b)} is shrunk to ${Math.round(fit * 100)}% to fit; consider less text or a bigger box`);
    for (const pre of c.querySelectorAll('pre')) if (pre.scrollWidth > pre.clientWidth + 2) say(b, 'cut-off', `code in ${name(b)} is cut off on the right (needs ${pre.scrollWidth - pre.clientWidth} px more width, or shorter lines / a smaller font)`);
    if (!c.querySelector('pre') && c.scrollWidth > c.clientWidth + 2) say(b, 'cut-off', `text in ${name(b)}${quote(b)} is wider than its box by ${c.scrollWidth - c.clientWidth} px (a long word or URL)`);
    let small = Infinity;
    const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) if (w.currentNode.textContent.trim() && !w.currentNode.parentElement.closest('.katex, pre, sub, sup')) small = Math.min(small, parseFloat(getComputedStyle(w.currentNode.parentElement).fontSize) * fit);
    if (small < 23.5) say(b, 'small-text', `text in ${name(b)}${quote(b)} is ${Math.round(small)} px; under 24 px (9 pt) is hard to read when presenting`);
  }
  // contrast: the text against what is behind it (the box's own fill, else the slide's colour; pictures behind are skipped)
  const rgb = v => { const e = document.createElement('i'); e.style.color = v; document.body.append(e); const m = getComputedStyle(e).color.match(/[\d.]+/g)?.map(Number); e.remove(); return m; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  if (!sec.dataset.backgroundImage && !sec.dataset.backgroundVideo && !sec.dataset.backgroundIframe) for (const b of textual) {
    const leaf = [...b.querySelectorAll('.content *')].find(e => e.textContent.trim() && !e.children.length) || b.querySelector('.content');
    const fg = rgb(getComputedStyle(leaf).color), fill = getComputedStyle(b).getPropertyValue('--fill').trim(), f = fill && fill !== 'transparent' ? rgb(fill) : null;
    const bg = f && (f[3] ?? 1) > 0.5 ? f : rgb(sec.dataset.backgroundColor || '#ffffff');
    if (!fg || !bg || (fg[3] ?? 1) < 0.5) continue;
    const [L1, L2] = [lum(fg), lum(bg)].sort((a, z) => z - a), ratio = (L1 + 0.05) / (L2 + 0.05);
    if (ratio < 3) say(b, 'contrast', `text in ${name(b)}${quote(b)} is hard to see against what is behind it (contrast ${ratio.toFixed(1)}:1; aim for 4.5:1)`);
  }
  for (const b of sec.querySelectorAll('.box.image')) {
    const im = b.querySelector('img'); if (!im) continue;
    if (!(im.getAttribute('alt') || '').trim() && !b.getAttribute('aria-label')) say(b, 'alt', `the picture in ${name(b)} (${im.getAttribute('src')}) has no alt text`);
    if (!im.naturalWidth) { say(b, 'picture', `the picture in ${name(b)} didn't load (${im.getAttribute('src')})`); continue; }
    const ar = im.naturalWidth / im.naturalHeight, br = px(b, 'width') / (px(b, 'height') || 1);
    if (!b.dataset.crop && Math.abs(Math.log(ar / br)) > 0.04) say(b, 'shape', `the picture in ${name(b)} is ${im.naturalWidth}×${im.naturalHeight} but its box is ${Math.round(px(b, 'width'))}×${Math.round(px(b, 'height'))}, so it is squeezed or letterboxed and its text shows smaller than planned; make the figure that shape (glideshow figure size … --box ${b.id || 'ID'}) or refit the box (glideshow figure add … --replace ${b.id || 'ID'})`);
  }
  for (const b of sec.querySelectorAll('.box[data-from], .box[data-to]'))
    for (const ref of [b.dataset.from, b.dataset.to]) {
      if (!ref) continue;
      const [id, side] = ref.split(':');
      if (!'t r b l'.split(' ').includes(side)) say(b, 'connector', `${name(b)} is attached to "${ref}": the side after the colon must be t, r, b or l`);
      else if (!sec.querySelector('#' + CSS.escape(id))) say(b, 'connector', `${name(b)} is attached to #${id}, which isn't on this slide`);
    }
  if (authored) {   // Morph partners (only slides the deck makes Morph steps)
    const prev = Reveal.getSlides()[Reveal.getSlides().indexOf(sec) - 1];
    for (const b of all) { const m = b.dataset.morph; if (m && !prev?.querySelector('#' + CSS.escape(m))) say(b, 'morph', `${name(b)} has data-morph="${m}" but the slide before has no box with id "${m}", so it fades in instead of moving`); }
    if (prev && !all.some(b => prev.querySelector('#' + CSS.escape(b.dataset.morph || b.id || '-')))) say(null, 'morph', 'this Morph step shares no box with the slide before (pair boxes with data-morph="<id on the slide before>", or drop data-auto-animate if this is the first step)');
  }
  // text on text (even a label inside a shape with words of its own), text partly over a picture, lines through text
  const shown = textual.filter(b => !b.classList.contains('fragment')), rects = new Map(shown.map(b => [b, textRect(b)]));
  for (let a = 0; a < shown.length; a++) for (let z = a + 1; z < shown.length; z++) {
    const A = rects.get(shown[a]), B = rects.get(shown[z]); if (!A || !B) continue;
    if (shown[a].contains(shown[z]) || shown[z].contains(shown[a])) continue;
    const m = meet(A, B);
    if (m.w > 2 && m.h > 2) say(shown[z], 'overlap', `the text of ${name(shown[a])}${quote(shown[a])} and of ${name(shown[z])}${quote(shown[z])} overlap (${Math.round(m.w)}×${Math.round(m.h)} px)`);
  }
  for (const im of top.filter(b => b.classList.contains('image') && !b.classList.contains('fragment')))
    for (const b of shown) {
      const T = rects.get(b), P = boxRect(im); if (!T) continue;
      const m = meet(T, P);
      if (m.w > 4 && m.h > 4 && !inside(T, P)) say(b, 'overlap', `the text of ${name(b)}${quote(b)} runs partly over the picture ${name(im)} (${Math.round(m.w)}×${Math.round(m.h)} px)`);
    }
  for (const l of all.filter(isLine)) {
    const path = l.querySelector('svg.shape path.l'), M = path?.getScreenCTM(); if (!path || !M) continue;
    const len = path.getTotalLength(), hits = new Set();
    for (let d = 0; d <= len; d += 6) {
      const q = path.getPointAtLength(d), sx = M.a * q.x + M.c * q.y + M.e, sy = M.b * q.x + M.d * q.y + M.f, cx = (sx - S.left) / k, cy = (sy - S.top) / k;
      for (const b of shown) { const T = rects.get(b); if (T && cx > T.x + 2 && cx < T.x + T.w - 2 && cy > T.y + 2 && cy < T.y + T.h - 2) hits.add(b); }
    }
    for (const b of hits) {   // a label with a solid background drawn over the line (later on the slide) covers it: a deliberate look
      const f = getComputedStyle(b).getPropertyValue('--fill').trim(), solid = f && f !== 'transparent' && ((rgb(f) || [])[3] ?? 1) > 0.5;
      if (solid && (l.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      say(l, 'overlap', `${name(l)} runs through the text of ${name(b)}${quote(b)}`);
    }
  }
  return out;
}"""

# A Morph step's pairs, from the slide before: what moves, resizes or recolours into place, what fades in, what fades out.
MORPH_JS = r"""(i) => {
  const all = Reveal.getSlides(), sec = all[i], prev = all[i - 1], out = [];
  const g = b => ['left', 'top', 'width', 'height'].map(k => Math.round(parseFloat(b.style[k]) || 0));
  const fill = b => getComputedStyle(b).getPropertyValue('--fill').trim(), label = b => '#' + (b.id || '?') + ((t => t ? ` ("${t.slice(0, 30)}")` : '')((b.querySelector(':scope > .content')?.textContent || '').trim()));
  const used = new Set();
  for (const b of sec.querySelectorAll(':scope > .box')) {
    const p = prev?.querySelector('#' + CSS.escape(b.dataset.morph || b.id || '-'));
    if (!p) { out.push(`${label(b)} fades in`); continue; }
    used.add(p);
    const [a, z] = [g(p), g(b)], how = [];
    if (a[0] !== z[0] || a[1] !== z[1]) how.push(`moves ${a[0]},${a[1]} → ${z[0]},${z[1]}`);
    if (a[2] !== z[2] || a[3] !== z[3]) how.push(`resizes ${a[2]}×${a[3]} → ${z[2]}×${z[3]}`);
    if (fill(p) !== fill(b)) how.push(`recolours ${fill(p) || 'none'} → ${fill(b) || 'none'}`);
    out.push(`${label(b)} ← #${p.id}: ${how.join(', ') || 'stays'}`);
  }
  for (const p of prev?.querySelectorAll(':scope > .box') || []) if (!used.has(p)) out.push(`${label(p)} fades out`);
  return out;
}"""


# Every build step done, transitions and Morph off and finished, so the picture is the slide's final state.
SETTLE_JS = r"""async () => {
  const sec = Reveal.getCurrentSlide();
  sec.querySelectorAll('.fragment').forEach(f => { f.classList.add('visible'); f.classList.remove('current-fragment'); });
  await Promise.all(document.getAnimations().map(a => { try { a.finish(); } catch { } return a.finished.catch(() => 0); }));
  await Promise.all([...document.images].map(im => im.complete ? 0 : new Promise(r => im.onload = im.onerror = r)));
  document.querySelectorAll('.box[data-autofit="shrink"]').forEach(b => window.fitText?.(b));
}"""


def main():
    if hasattr(signal, "SIGPIPE"): signal.signal(signal.SIGPIPE, signal.SIG_DFL)   # `glideshow render … | head` just stops, no traceback
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    argv = [a for a in sys.argv[1:] if not a.startswith("--")]
    check_only, as_json, morph = "--check" in flags, "--json" in flags, "--morph" in flags
    deck, out = Path(argv[0]).expanduser().resolve(), Path(argv[1]).expanduser().resolve()
    only = {int(a) for a in argv[2:]}
    if not (deck / "deck.html").exists(): raise SystemExit(f"no deck.html in {deck}")
    if not check_only:
        out.mkdir(parents=True, exist_ok=True)
        for old in out.glob("slide-*.png"):   # this render's slides replace their old pictures; others stay
            if not only or int(old.stem.split("-")[1]) in only: old.unlink()
    port = serve(deck)
    paths, problems, morphs = [], [], []
    with sync_playwright() as p:
        try: browser = p.chromium.launch()   # Playwright's Chromium, as the fidelity references were measured with
        except Exception: browser = p.chromium.launch(channel="chrome")   # not downloaded: the installed Chrome
        pg = browser.new_page(viewport={"width": 1920, "height": 1080})
        pg.goto(f"http://127.0.0.1:{port}/deck.html")
        pg.wait_for_function("window.Reveal && Reveal.isReady()")
        pg.evaluate("Reveal.configure({margin: 0, controls: false, progress: false, slideNumber: false, transition: 'none', backgroundTransition: 'none', autoAnimate: false})")
        pg.add_style_tag(content=".sl-bar, .sl-pop { display: none !important; } .reveal .fragment { transition: none !important; }")   # the slideshow's own pill; builds without fades
        pg.evaluate(FIRST_FRAME_JS)   # animated GIFs at their first frame, as gslides2deck's references show them
        pg.evaluate("document.fonts.ready")
        ids = pg.evaluate("(() => { const n = {}; document.querySelectorAll('.slides .box[id]').forEach(b => n[b.id] = (n[b.id] || 0) + 1); return n; })()")
        authored = pg.evaluate("""async () => {   // which slides the deck itself makes Morph steps (the slideshow adds more as it loads)
          const raw = new DOMParser().parseFromString(await (await fetch('deck.html')).text(), 'text/html');
          return [...raw.querySelectorAll('.slides section')].filter(s => !s.querySelector('section')).map(s => s.hasAttribute('data-auto-animate')); }""")
        n = pg.evaluate("Reveal.getTotalSlides()")   # every slide, a stack's sub-slides counted in deck order (as `glideshow slides` numbers them)
        go = lambda i: pg.evaluate("i => { const x = Reveal.getIndices(Reveal.getSlides()[i]); Reveal.slide(x.h, x.v); }", i)   # Reveal.slide(i) alone takes only the horizontal index
        for i in range(n):
            if only and i + 1 not in only:
                continue
            go(i)
            pg.evaluate(SETTLE_JS)
            pg.wait_for_timeout(100)
            problems += pg.evaluate(CHECK_JS, [i, ids, bool(authored[i]) if i < len(authored) else False])
            if check_only: continue
            path = out / f"slide-{i + 1:02d}.png"
            pg.screenshot(path=str(path)); paths.append(str(path))
            if not as_json: print(path, flush=True)
        if morph:   # each Morph step: its pairs, and a picture halfway through the animation from the slide before
            for i in range(1, n):
                if (only and i + 1 not in only) or not (i < len(authored) and authored[i]): continue
                pairs = pg.evaluate(MORPH_JS, i)
                pg.evaluate("Reveal.configure({ autoAnimate: true })"); go(i - 1); pg.evaluate(SETTLE_JS); pg.wait_for_timeout(100)
                dur = pg.evaluate(f"parseFloat(Reveal.getSlides()[{i}].dataset.autoAnimateDuration) || Reveal.getConfig().autoAnimateDuration || 1")
                go(i); pg.wait_for_timeout(int(dur * 500))
                mid = out / f"slide-{i + 1:02d}-morph.png"
                if not check_only: pg.screenshot(path=str(mid))
                pg.wait_for_timeout(int(dur * 600)); pg.evaluate("Reveal.configure({ autoAnimate: false })")
                morphs.append({"slide": i + 1, "pairs": pairs, "midway": "" if check_only else str(mid)})
        browser.close()
    if as_json: print(json.dumps({"slides": paths, "problems": problems, **({"morph": morphs} if morph else {})}, indent=2))
    else:
        for m in morphs: print(f"slide {m['slide']} (Morph from slide {m['slide'] - 1}):" + "".join(f"\n  {p}" for p in m["pairs"]) + (f"\n  halfway: {m['midway']}" if m["midway"] else ""))
        if not n: print(f"{deck / 'deck.html'} has no slides")
        for q in problems: print(f"slide {q['slide']}: {q['message']}")
        print(f"{len(problems)} problem{'s' if len(problems) != 1 else ''} found" if problems else "no problems found")
    if check_only and problems: sys.exit(1)


if __name__ == "__main__":
    main()
