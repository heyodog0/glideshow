# /// script
# dependencies = ["playwright"]
# ///
"""Every key in docs/shortcuts.md, pressed in its context (nothing selected, a box selected, editing text, the filmstrip
focused, presenting), with its effect checked and `defaultPrevented` asserted so no key falls through to Chrome.
Then the ⌘/ dialog must list exactly the keys that passed.

    uv run glideshow/test/keys.py            # PASS / FAIL per key; exits non-zero on failure
"""
import os, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PORT = 8797
URL = f"http://localhost:{PORT}/"
ENV = {**os.environ, "GLIDESHOW_OFFLINE": "1", "GLIDESHOW_CACHE": tempfile.mkdtemp(prefix="slides-cache-"), "GLIDESHOW_TRASH": tempfile.mkdtemp(prefix="slides-trash-"), "GLIDESHOW_HOME": tempfile.mkdtemp(prefix="slides-home-")}
failures, passed_rows, failed_rows = [], set(), set()

# Runs in the editor before each key: four slides, slide 2 current, holding text box A (#ka) and rectangle B (#kb).
PREP = """ctx => {
  if (presenting()) endPresent(); stopEdit(); closeMenu(); showShortcuts(false); closeFind(); if (gridOn) setGrid(false);
  document.body.classList.remove('compact'); setNotesVisible(false); setZoom(null);
  while (slides.length < 4) $('#ed-new-slide').click();
  go(1); boxes().forEach(b => b.remove());
  const A = makeBox({ x: 100, y: 100, w: 600, h: 200, html: 'Alpha text' }), B = makeBox({ x: 900, y: 400, w: 300, h: 200, shape: 'rect', html: 'Beta' });
  A.id = 'ka'; B.id = 'kb'; slides[cur].append(A, B);
  sel = new Set({ box: [A], two: [A, B], shape: [B], edit: [A] }[ctx] || []); render(); commit(); drawOverlay(); updateToolbar();
  document.activeElement?.blur?.();
  if (ctx === 'edit') { startEdit(A); const r = document.createRange(); r.selectNodeContents(content(A)); getSelection().removeAllRanges(); getSelection().addRange(r); }
  if (ctx === 'film') thumbs.focus();
  window.__n = slides.length; window.__s = slides.slice(); window.__g = geo(A); window.__w = $('#ed-canvas').getBoundingClientRect().width;
  window.__fs = parseFloat(getComputedStyle(content(A)).fontSize); window.__pd = false; window.__ev = {};
}"""
HOOKS = """(() => {
  const pd = Event.prototype.preventDefault;
  Event.prototype.preventDefault = function () { if (this.type === 'keydown') window.__pd = true; return pd.call(this); };
  for (const t of ['copy', 'cut', 'paste']) addEventListener(t, () => { window.__ev[t] = true; }, true);
  window.open = (...a) => { window.__opened = a[0]; return null; };
  window.prompt = () => 'https://example.org';
  window.A = () => document.querySelector('#ed-canvas #ka'); window.B = () => document.querySelector('#ed-canvas #kb');
  window.html = () => (A()?.innerHTML || '');
  window.__ev = {};
})()"""

# (dialog section, dialog row, context, keys, effect, native). keys: one combo or a list; 'js:…' entries run in the page.
# native = the browser does the work (clipboard, typing), so the keydown is not prevented.
E = [
  ("Common actions", "Search the menus", "none", "Alt+Slash", "document.activeElement === menuInput"),
  ("Common actions", "Undo", "box", ["js:setGeo(A(), {...geo(A()), x: 300}); commit()", "Meta+z"], "geo(A()).x === 100"),
  ("Common actions", "Undo", "edit", ["js:stopEdit(); setGeo(A(), {...geo(A()), x: 300}); commit(); startEdit(A())", "Meta+z"], "geo(A()).x === 100"),
  ("Common actions", "Redo", "box", ["js:setGeo(A(), {...geo(A()), x: 300}); commit(); undo()", "Meta+Shift+z"], "geo(A()).x === 300"),

  ("Common actions", "Redo", "box", ["js:setGeo(A(), {...geo(A()), x: 300}); commit(); undo()", "Meta+y"], "geo(A()).x === 300"),
  ("Common actions", "Copy", "box", "Meta+c", "__ev.copy === true", True),
  ("Common actions", "Cut", "box", "Meta+x", "__ev.cut === true && !A()", True),
  ("Common actions", "Paste", "box", ["Meta+c", "Meta+v"], "__ev.paste === true && boxes().length === 3", True),
  ("Common actions", "Paste without formatting", "box", ["Meta+c", "Meta+Shift+v"], "__ev.paste === true && boxes().length === 3"),
  ("Common actions", "Paste without formatting", "edit", ["js:return navigator.clipboard.writeText('Plain words')", "Meta+Shift+v"], "/Plain words/.test(html())"),
  ("Common actions", "Copy formatting", "box", ["js:content(A()).style.fontWeight = 'bold'", "Meta+Alt+c"], "!!copiedFormat"),
  ("Common actions", "Paste formatting", "box", ["js:content(A()).style.fontWeight = 'bold'; copyFormat(); sel = new Set([B()])", "Meta+Alt+v"], "/bold|[6-9]00/.test(getComputedStyle(content(B())).fontWeight)"),
  ("Common actions", "Duplicate (slide when the filmstrip has focus)", "box", "Meta+d", "boxes().length === 3"),
  ("Common actions", "Duplicate (slide when the filmstrip has focus)", "film", "Meta+d", "slides.length === __n + 1"),
  ("Common actions", "Delete", "box", "Backspace", "!A() && boxes().length === 1"),
  ("Common actions", "Delete", "box", "Delete", "!A() && boxes().length === 1"),
  ("Common actions", "Select all", "none", "Meta+a", "sel.size === 2"),
  ("Common actions", "Insert or edit link", "edit", ["Meta+k", "js:$('#ed-link-url').value = 'https://example.org'", "Enter"], "/href=\"https:\\/\\/example.org\"/.test(html())"),
  ("Common actions", "New slide", "none", "Control+m", "slides.length === __n + 1 && cur === 2"),
  ("Common actions", "New slide", "none", "Meta+m", "slides.length === __n + 1 && cur === 2"),
  ("Common actions", "New sub-slide below", "none", "Meta+Shift+m", "slides.length === __n + 1 && cur === 2 && !!slides[2].dataset.edStack && slides[1].dataset.edStack === slides[2].dataset.edStack"),
  ("Common actions", "Find", "none", "Meta+f", "!$('#ed-find').hidden"),
  ("Common actions", "Find and replace", "none", "Meta+Shift+h", "!$('#ed-find').hidden"),
  ("Common actions", "Save", "none", "Meta+s", "true"),
  ("Common actions", "Print", "none", "Meta+p", "/print-pdf/.test(window.__opened || '')"),
  ("Common actions", "Hide menus", "none", "Control+Shift+f", "document.body.classList.contains('compact')"),
  ("Common actions", "Show speaker notes", "none", "Meta+Alt+Shift+s", "!document.body.classList.contains('notes-off')"),
  ("Common actions", "Show spelling suggestions", "none", "Meta+Alt+x", "true"),
  ("Common actions", "Grid view", "none", "Meta+Alt+1", "gridOn"),
  ("Common actions", "Insert comment", "box", "Meta+Alt+m", "!$('#ed-comments').hidden && !!cmDraft && cmDraft.box === A().id"),
  ("Common actions", "Keyboard shortcuts", "none", "Meta+Slash", "!shortcutsDlg.hidden"),
  ("Text formatting", "Bold", "box", "Meta+b", "/bold|[6-9]00/.test(html()) || /bold|[6-9]00/.test(getComputedStyle(content(A())).fontWeight)"),
  ("Text formatting", "Bold", "edit", "Meta+b", "/bold|<b>|[6-9]00/.test(html())"),
  ("Text formatting", "Bold", "none", "Meta+b", "true"),
  ("Text formatting", "Italic", "box", "Meta+i", "/italic|<i>/.test(html())"),
  ("Text formatting", "Italic", "edit", "Meta+i", "/italic|<i>/.test(html())"),
  ("Text formatting", "Italic", "none", "Meta+i", "true"),
  ("Text formatting", "Underline", "box", "Meta+u", "/underline|<u>/.test(html())"),
  ("Text formatting", "Underline", "edit", "Meta+u", "/underline|<u>/.test(html())"),
  ("Text formatting", "Strikethrough", "box", "Meta+Shift+x", "/line-through|<s>|<strike>/.test(html())"),
  ("Text formatting", "Strikethrough", "edit", "Meta+Shift+x", "/line-through|<s>|<strike>/.test(html())"),
  ("Text formatting", "Superscript", "edit", "Meta+Period", "/super|<sup>/.test(html())"),
  ("Text formatting", "Subscript", "edit", "Meta+Comma", "/vertical-align: sub|<sub>/.test(html())"),
  ("Text formatting", "Increase font size", "box", "Meta+Shift+Period", "parseFloat(getComputedStyle(content(A())).fontSize) > __fs"),
  ("Text formatting", "Decrease font size", "box", "Meta+Shift+Comma", "parseFloat(getComputedStyle(content(A())).fontSize) < __fs"),
  ("Text formatting", "Clear formatting", "box", ["js:content(A()).style.fontWeight = 'bold'", "Meta+Backslash"], "!/bold/.test(html()) && !content(A()).style.fontWeight"),
  ("Paragraph formatting", "Bulleted list", "box", "Meta+Shift+8", "!!A().querySelector('ul li')"),
  ("Paragraph formatting", "Numbered list", "box", "Meta+Shift+7", "!!A().querySelector('ol li')"),
  ("Paragraph formatting", "Increase / decrease indent", "box", "Meta+BracketRight", "parseFloat(getComputedStyle(content(A())).paddingLeft) > 19.2"),
  ("Paragraph formatting", "Increase / decrease indent", "box", ["Meta+BracketRight", "js:window.__p = parseFloat(getComputedStyle(content(A())).paddingLeft)", "Meta+BracketLeft"], "parseFloat(getComputedStyle(content(A())).paddingLeft) < __p"),
  ("Paragraph formatting", "Indent in a list", "edit", ["js:listText('insertUnorderedList')", "Tab"], "!!A().querySelector('li ul, li ol, ul ul, ol ol')"),
  ("Paragraph formatting", "Align left / center / right", "box", "Meta+Shift+e", "content(A()).style.textAlign === 'center'"),
  ("Paragraph formatting", "Align left / center / right", "box", "Meta+Shift+r", "content(A()).style.textAlign === 'right'"),
  ("Paragraph formatting", "Align left / center / right", "box", ["js:content(A()).style.textAlign = 'center'", "Meta+Shift+l"], "content(A()).style.textAlign === 'left'"),
  ("Paragraph formatting", "Justify", "box", "Meta+Shift+j", "content(A()).style.textAlign === 'justify'"),
  ("Objects", "Select next / previous object", "box", "Tab", "sel.size === 1 && sel.has(B())"),
  ("Objects", "Select next / previous object", "box", "Shift+Tab", "sel.size === 1 && sel.has(B())"),
  ("Objects", "Bring forward / send backward", "box", "Meta+ArrowUp", "boxes()[1] === A()"),
  ("Objects", "Bring forward / send backward", "shape", "Meta+ArrowDown", "boxes()[0] === B()"),
  ("Objects", "Rotate 15° / 1°", "shape", "Alt+ArrowRight", "rot(B()) === 15"),
  ("Objects", "Rotate 15° / 1°", "shape", "Alt+ArrowLeft", "rot(B()) === -15 || rot(B()) === 345"),
  ("Objects", "Rotate 15° / 1°", "shape", "Alt+Shift+ArrowRight", "rot(B()) === 1"),
  ("Objects", "Rotate 15° / 1°", "shape", "Alt+Shift+ArrowLeft", "rot(B()) === -1 || rot(B()) === 359"),
  ("Objects", "Larger horizontally / vertically / both", "shape", "Control+Meta+b", "geo(B()).w > 300 && geo(B()).h === 200"),
  ("Objects", "Larger horizontally / vertically / both", "shape", "Control+Meta+i", "geo(B()).h > 200 && geo(B()).w === 300"),
  ("Objects", "Larger horizontally / vertically / both", "shape", "Control+Meta+k", "geo(B()).h > 200 && geo(B()).w > 300"),
  ("Objects", "Smaller horizontally / both", "shape", "Control+Meta+w", "geo(B()).w < 300 && geo(B()).h === 200"),
  ("Objects", "Smaller horizontally / both", "shape", "Control+Meta+j", "geo(B()).w < 300 && geo(B()).h < 200"),
  ("Actions", "Edit text in the selected box", "box", "Enter", "editing === A()"),
  ("Actions", "Finish editing / deselect", "edit", "Escape", "!editing && sel.size === 1 && sel.has(A())"),
  ("Actions", "Finish editing / deselect", "box", "Escape", "sel.size === 0"),
  ("Actions", "Nudge", "box", "ArrowRight", "geo(A()).x === __g.x + 1"),
  ("Actions", "Nudge", "box", "ArrowLeft", "geo(A()).x === __g.x - 1"),
  ("Actions", "Nudge", "box", "ArrowDown", "geo(A()).y === __g.y + 1"),
  ("Actions", "Nudge", "box", "ArrowUp", "geo(A()).y === __g.y - 1"),
  ("Actions", "Nudge 10 px", "box", "Shift+ArrowRight", "geo(A()).x === __g.x + 10"),
  ("Actions", "Nudge 10 px", "box", "Shift+ArrowUp", "geo(A()).y === __g.y - 10"),
  ("Actions", "Group / ungroup", "two", "Meta+Alt+g", "boxes().length === 1 && boxes()[0].classList.contains('group')"),
  ("Actions", "Group / ungroup", "two", ["js:groupSel()", "Meta+Alt+Shift+g"], "boxes().length === 2 && !slides[cur].querySelector('.group')"),
  ("Actions", "Bring to front", "box", "Meta+Shift+ArrowUp", "boxes().at(-1) === A()"),
  ("Actions", "Send to back", "shape", "Meta+Shift+ArrowDown", "boxes()[0] === B()"),
  ("Filmstrip (click a slide first)", "Previous / next slide", "film", "ArrowDown", "cur === 2 && document.activeElement === thumbs"),
  ("Filmstrip (click a slide first)", "Previous / next slide", "film", "ArrowUp", "cur === 0"),
  ("Filmstrip (click a slide first)", "Previous / next slide", "film", "PageDown", "cur === 2"),
  ("Filmstrip (click a slide first)", "Previous / next slide", "film", "PageUp", "cur === 0"),
  ("Filmstrip (click a slide first)", "First / last slide", "film", "Home", "cur === 0"),
  ("Filmstrip (click a slide first)", "First / last slide", "film", "End", "cur === slides.length - 1"),
  ("Filmstrip (click a slide first)", "Move slides up / down", "film", "Meta+ArrowDown", "slides[2] === __s[1]"),
  ("Filmstrip (click a slide first)", "Move slides up / down", "film", "Meta+ArrowUp", "slides[0] === __s[1]"),
  ("Filmstrip (click a slide first)", "Move slides up / down", "film", "Meta+ArrowRight", "slides[2] === __s[1]"),
  ("Filmstrip (click a slide first)", "Move slides up / down", "film", "Meta+ArrowLeft", "slides[0] === __s[1]"),
  ("Filmstrip (click a slide first)", "Move slides to beginning / end", "film", "Meta+Shift+ArrowLeft", "slides[0] === __s[1]"),
  ("Filmstrip (click a slide first)", "Move slides to beginning / end", "film", "Meta+Shift+ArrowUp", "slides[0] === __s[1]"),

  ("Filmstrip (click a slide first)", "Move slides to beginning / end", "film", "Meta+Shift+ArrowDown", "slides.at(-1) === __s[1]"),
  ("Filmstrip (click a slide first)", "Extend / toggle slide selection", "film", "Shift+ArrowDown", "picked.size === 2"),
  ("Filmstrip (click a slide first)", "Delete / duplicate selected slides", "film", "Backspace", "slides.length === __n - 1"),
  ("Filmstrip (click a slide first)", "Select all slides", "film", "Meta+a", "picked.size === slides.length"),
  ("Filmstrip (click a slide first)", "Back to the slide / to the filmstrip", "film", "Enter", "document.activeElement !== thumbs"),
  ("Filmstrip (click a slide first)", "Back to the slide / to the filmstrip", "none", "Escape", "document.activeElement === thumbs"),
  ("Filmstrip (click a slide first)", "Move to filmstrip", "box", "Meta+Alt+Shift+f", "document.activeElement === thumbs"),
  ("Navigation", "Next / previous slide (nothing selected)", "none", "ArrowDown", "cur === 2"),
  ("Navigation", "Next / previous slide (nothing selected)", "none", "ArrowUp", "cur === 0"),
  ("Navigation", "Next / previous slide", "none", "PageDown", "cur === 2"),
  ("Navigation", "Next / previous slide", "none", "PageUp", "cur === 0"),
  ("Navigation", "Next / previous slide while typing", "edit", "PageDown", "cur === 2 && !editing"),
  ("Navigation", "Next / previous slide while typing", "edit", "PageUp", "cur === 0 && !editing"),
  ("Navigation", "Go to slide", "none", ["Control+Meta+g", "js:$('#ed-goto-n').value = '3'", "Enter"], "cur === 2 && $('#ed-gotodlg').hidden"),
  ("Navigation", "Zoom in", "none", "Meta+Equal", "$('#ed-canvas').getBoundingClientRect().width > __w"),
  ("Navigation", "Zoom out", "none", "Meta+Minus", "$('#ed-canvas').getBoundingClientRect().width < __w"),
  ("Navigation", "Fit", "none", ["Meta+Equal", "Meta+Digit0"], "Math.abs($('#ed-canvas').getBoundingClientRect().width - __w) < 1"),
  ("Navigation", "Zoom to selection", "box", "Meta+Shift+Digit0", "zoom > 1 && Math.abs(A().getBoundingClientRect().left + A().getBoundingClientRect().width / 2 - ($('#ed-stage').getBoundingClientRect().left + $('#ed-stage').clientWidth / 2)) < 30"),
  ("Navigation", "Zoom to fit content", "none", ["js:setZoom(2)", "Meta+Alt+Shift+Digit0"], "zoom !== null && zoom < 2"),
  ("Presenting", "Present from this slide", "none", "Meta+Enter", "presenting() && /#\\/1/.test($('#ed-show iframe').src)"),
  ("Presenting", "Present from beginning", "none", "Meta+Shift+Enter", "presenting() && /#\\/0/.test($('#ed-show iframe').src)"),
]
E = [(*e, False) if len(e) == 5 else e for e in E]

# In the slideshow (deck.html on its own): (row, keys, effect on Reveal's state). Starts on slide 2 of 4, slide 2 has a sub-slide.
P = [
  ("Next / previous slide", "ArrowRight", "Reveal.getIndices().h === 2"),
  ("Next / previous slide", "ArrowLeft", "Reveal.getIndices().h === 0"),
  ("Next / previous slide", "n", "Reveal.getIndices().h === 2"),
  ("Next / previous slide", "p", "Reveal.getIndices().h === 0"),
  ("Up / down in a stack", "ArrowDown", "Reveal.getIndices().h === 1 && Reveal.getIndices().v === 1"),
  ("Next / back in reading order", "Space", "Reveal.getIndices().h === 1 && Reveal.getIndices().v === 1"),
  ("Next / back in reading order", "PageDown", "Reveal.getIndices().h === 1 && Reveal.getIndices().v === 1"),
  ("Next / back in reading order", "Shift+Space", "Reveal.getIndices().h === 0"),
  ("Next / back in reading order", "PageUp", "Reveal.getIndices().h === 0"),
  ("First / last slide", "Home", "Reveal.getIndices().h === 0"),
  ("First / last slide", "End", "Reveal.getIndices().h === Reveal.getHorizontalSlides().length - 1"),
  ("Go to slide n", ["4", "Enter"], "Reveal.getIndices().h === 3"),
  ("Black / white screen", "b", "getComputedStyle(document.querySelector('div[data-c]')).backgroundColor === 'rgb(0, 0, 0)'"),
  ("Black / white screen", "w", "getComputedStyle(document.querySelector('div[data-c]')).backgroundColor === 'rgb(255, 255, 255)'"),
  ("Laser pointer", "l", "[...document.body.children].some(e => e.style.borderRadius === '50%' && e.style.display !== 'none')"),
  ("Full screen", "f", "true"),
  ("Speaker view", "s", "window.__opened !== undefined"),
]


def run(pg, frame_eval, keys):
    for k in ([keys] if isinstance(keys, str) else keys):
        if k.startswith("js:"): frame_eval(f"(() => {{ {k[3:]} }})()")
        else: frame_eval("window.__pd = false"); pg.keyboard.press(k); pg.wait_for_timeout(100)


def main():
    tmp = Path(tempfile.mkdtemp(prefix="slides-keys-"))
    srv = subprocess.Popen(["uv", "run", "--quiet", "--project", str(ROOT), "python", "-m", "glideshow.server", "--exit-with", str(os.getpid()), str(tmp / "deck"), "--port", str(PORT), "--no-open", "--no-git"], env=ENV,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try: urllib.request.urlopen(URL + "api/deck", timeout=1); break
            except Exception: time.sleep(0.1)
        with sync_playwright() as p:
            b = p.chromium.launch(channel="chrome")
            bctx = b.new_context(viewport={"width": 1440, "height": 900}, permissions=["clipboard-read", "clipboard-write"])
            pg = bctx.new_page()
            errors = []
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.goto(URL + "edit"); pg.wait_for_function("typeof slides !== 'undefined' && slides.length")
            pg.wait_for_function("document.fonts.check('20px \\'Material Symbols Outlined\\'')", timeout=20000)
            pg.evaluate(HOOKS)
            for sec, row, ctx, keys, effect, native in E:
                pg.evaluate(f"({PREP})('{ctx}')")
                run(pg, pg.evaluate, keys)
                ok, pd = pg.evaluate(f"[!!({effect}), window.__pd]")
                good = ok and (pd or native)
                name = f"{row} [{keys if isinstance(keys, str) else keys[-1]}, {ctx}]"
                print(("PASS " if good else "FAIL ") + name + ("" if good else f"  (effect {ok}, defaultPrevented {pd})"))
                (passed_rows if good else failed_rows).add((sec, row))
                if not good: failures.append(name)
            # the in-place slideshow: M leaves a note for the AI, Esc returns to the editor
            pg.evaluate(f"({PREP})('none')"); pg.keyboard.press("Meta+Enter"); pg.wait_for_timeout(1500)
            fr = next(f for f in pg.frames if "embedded" in f.url)
            pg.mouse.move(700, 450); pg.keyboard.press("m"); pg.wait_for_timeout(100)
            memo = fr.evaluate("!!document.querySelector('textarea')"); pg.keyboard.type("Check this"); pg.keyboard.press("Enter"); pg.wait_for_timeout(300)
            note = pg.evaluate("[...slides[1].querySelectorAll('.box.note')].some(b => b.textContent.includes('Check this'))")
            pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
            for row, good in (("Note for the AI (presenting from the editor)", memo and note), ("Exit", pg.evaluate("!presenting()"))):
                print(("PASS " if good else "FAIL ") + row + " [presenting in the editor]"); (passed_rows if good else failed_rows).add(("Presenting", row))
                if not good: failures.append(row)
            # the slideshow on its own
            pg.evaluate(f"({PREP})('none'); go(1); newSlideBelow(); go(1)"); pg.evaluate("flushSave()"); pg.wait_for_timeout(500)
            v = bctx.new_page()
            v.on("pageerror", lambda e: errors.append("viewer: " + str(e)))
            v.add_init_script("window.open = (...a) => { window.__opened = a[0] || ''; return { document: { write() {}, close() {} }, postMessage() {}, focus() {}, close() {}, addEventListener() {}, closed: false }; }; window.__pd = false;"
                              "const _pd = Event.prototype.preventDefault; Event.prototype.preventDefault = function () { if (this.type === 'keydown') window.__pd = true; return _pd.call(this); };")
            v.goto(URL + "deck/deck.html"); v.wait_for_function("window.Reveal?.isReady?.()", timeout=20000)
            for row, keys, effect in P:
                v.evaluate("Reveal.slide(1, 0)"); v.wait_for_timeout(100)
                run(v, v.evaluate, keys); v.wait_for_timeout(200)
                ok, pd = v.evaluate(f"[!!({effect}), window.__pd]")
                good = ok and pd
                print(("PASS " if good else "FAIL ") + f"{row} [{keys if isinstance(keys, str) else '+'.join(keys)}, slideshow]" + ("" if good else f"  (effect {ok}, defaultPrevented {pd})"))
                (passed_rows if good else failed_rows).add(("Presenting", row))
                if not good: failures.append(row)
                if keys in ("b", "w", "l"): v.keyboard.press(keys)   # toggle it off again
                v.evaluate("document.fullscreenElement && document.exitFullscreen()")
            # the ⌘/ dialog lists exactly the keys that pass
            rows = pg.evaluate("Object.entries(SHORTCUTS).flatMap(([s, rows]) => rows.map(([l, k]) => [s, l, k]))")
            listed = {(s, l) for s, l, _ in rows}
            mouse = {(s, l) for s, l, k in rows if any(m in k for m in ("+ drag", "+ resize", "+ rotate"))}   # pointer gestures: smoke.py drives those
            ok_rows = passed_rows - failed_rows
            missing, extra = ok_rows - listed, listed - mouse - ok_rows

            good = not missing and not extra
            print(("PASS " if good else "FAIL ") + "the ⌘/ dialog lists exactly the keys that pass" + ("" if good else f"  (not listed {sorted(missing)}; listed but untested or failing {sorted(extra)})"))
            if not good: failures.append("dialog")
            if errors: failures.append("browser errors"); print("FAIL no browser errors  (" + "; ".join(errors)[:300] + ")")
            b.close()
    finally:
        srv.terminate()
    print(f"\n{'ALL PASSED' if not failures else str(len(failures)) + ' FAILED: ' + ', '.join(failures)}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
