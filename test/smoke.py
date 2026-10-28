# /// script
# dependencies = ["playwright"]
# ///
"""End-to-end smoke test: starts the server on a throwaway deck, drives the editor in headless
Chrome, checks the saved deck.html and the viewer, and writes screenshots next to this file.

    uv run glideshow/test/smoke.py            # prints PASS/FAIL per check, exits non-zero on failure

Extend `checks()` when adding a feature: one `check(name, condition)` per behaviour.
"""
import json, os, re, shutil, subprocess, sys, tempfile, time, urllib.error, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

TEST_ENV = {**os.environ, "GLIDESHOW_OFFLINE": "1", "GLIDESHOW_CACHE": tempfile.mkdtemp(prefix="slides-cache-"), "GLIDESHOW_TRASH": tempfile.mkdtemp(prefix="slides-trash-"), "GLIDESHOW_HOME": tempfile.mkdtemp(prefix="slides-home-")}   # no network, no ~/.glideshow, no decks in ~/decks

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PORT = int(os.environ.get("SMOKE_PORT") or 8799)   # and the two after it; another number lets two runs (two sessions) go at once
URL = f"http://localhost:{PORT}/"
failures = []


GOOGLE_LOOK = "try { localStorage.getItem('glideshow-look') || localStorage.setItem('glideshow-look', 'google') } catch {}"


def google_look(b):
    """Pages from `b` start in Google Slides' look: these checks were written against it. Thermal, the default look, has
    its own (look_checks), which ask for it with ?look=thermal."""
    new_context = b.new_context
    def ctx(*a, **k):
        c = new_context(*a, **k); c.add_init_script(GOOGLE_LOOK); return c
    b.new_context = ctx; b.plain_context = new_context
    b.new_page = lambda **k: ctx(**k).new_page()
    return b


def check(name, ok, detail: object = ""):
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def wait_server(deck: Path, url=URL):
    """Until the server answers, and make sure it's ours: an older server still holding the port (from a run that was
    killed) would otherwise take the requests, and every check would run against the wrong deck."""
    for _ in range(100):
        try:
            got = json.load(urllib.request.urlopen(url + "api/ping", timeout=1))
        except Exception:
            time.sleep(0.1); continue
        if Path(got["deck"]).resolve() != deck.resolve():
            raise SystemExit(f"{url} is another server (pid {got['pid']}, deck {got['deck']}): stop it and run again")
        return
    raise SystemExit("server did not start")


def checks(pg, deck: Path, errors):
    pg.goto(URL + "edit"); pg.wait_for_timeout(800)
    pg.wait_for_function("document.fonts.check('20px \\'Material Symbols Outlined\\'')", timeout=20000)   # the toolbar lays out with real icons
    chrome = pg.evaluate("[getComputedStyle(document.body).fontFamily, getComputedStyle(document.body).backgroundColor, getComputedStyle(document.documentElement).getPropertyValue('--blue').trim()]")
    clash = pg.evaluate("""(() => { const made = ['notes', 'status', 'toolbar'].map((id, i) => { const b = makeBox({x: 100 + i * 300, y: 900, w: 200, h: 100, html: id}); b.id = id; return b; });
      slides[cur].append(...made); render();
      const out = made.map(b => getComputedStyle(b).display).concat(getComputedStyle(document.querySelector('#ed-canvas .box#title')).maxWidth,
        document.querySelector('#ed-notes').isContentEditable, document.querySelector('#ed-status').closest('#ed-bar') !== null);
      made.forEach(b => b.remove()); render(); return out; })()""")
    check("deck box ids (title, notes, status, toolbar) don't collide with the editor's", clash == ["flex", "flex", "flex", "none", True, True], str(clash))
    title_px = pg.evaluate("getComputedStyle(document.querySelector('#ed-title')).fontSize")
    pg.fill("#ed-date", "2026-10-07"); pg.dispatch_event("#ed-date", "change"); pg.wait_for_timeout(1500)
    check("the deck's date field is saved as <meta name=\"date\"> (new decks start with today's)", '<meta name="date" content="2026-10-07">' in deck.read_text())

    check("chrome uses Slides tokens (Roboto, stage, blue, 18px title)", chrome[0].startswith("Roboto") and chrome[1] == "rgb(248, 250, 253)" and chrome[2] == "#1a73e8" and title_px == "18px", f"{chrome} {title_px}")

    pg.click("#ed-add-text"); pg.keyboard.type("Hello from the test")
    for _ in range(4): pg.keyboard.press("Shift+ArrowLeft")    # select "test"
    pg.click("#ed-bold"); pg.click("#ed-italic"); pg.keyboard.press("Meta+Shift+x"); pg.keyboard.press("Meta+.")
    pg.evaluate("(() => { const i = document.querySelector('#ed-color'); i.value = '#d93025'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); })()")
    pg.keyboard.press("Escape")
    pg.click("#ed-add-text"); pg.keyboard.type("Tall")
    for _ in range(6): pg.keyboard.press("Enter")
    pg.keyboard.type("box")
    grown = pg.evaluate("parseFloat([...document.querySelectorAll('#ed-canvas .box')].pop().style.height)")
    pg.keyboard.press("Meta+a"); pg.keyboard.press("Backspace"); pg.keyboard.type("short")
    shrunk = pg.evaluate("parseFloat([...document.querySelectorAll('#ed-canvas .box')].pop().style.height)")
    pg.keyboard.press("Escape")
    check("text box grows while typing and shrinks back", grown > 160 and shrunk == 160, f"{grown} {shrunk}")
    pg.click("#ed-size-up"); pg.keyboard.press("Meta+Shift+.")
    sz = pg.evaluate("[...document.querySelectorAll('#ed-canvas .box')].pop().querySelector('.content').style.fontSize")
    pg.click("#ed-size-down")
    sz2 = pg.evaluate("[...document.querySelectorAll('#ed-canvas .box')].pop().querySelector('.content').style.fontSize")
    check("font size steps through Slides sizes (1 pt = 2.667 px)", sz == "64px" and sz2 == "48px", f"{sz} {sz2}")
    pg.fill("#ed-size", "96"); pg.press("#ed-size", "Enter")
    h_big = pg.evaluate("parseFloat([...document.querySelectorAll('#ed-canvas .box')].pop().style.height)")
    pg.fill("#ed-size", "16"); pg.press("#ed-size", "Enter")
    h_small = pg.evaluate("parseFloat([...document.querySelectorAll('#ed-canvas .box')].pop().style.height)")
    check("toolbar size change grows and shrinks the box", h_big > 160 and h_small == 160, f"{h_big} {h_small}")
    pg.evaluate("""(() => { const c = [...document.querySelectorAll('#ed-canvas .box')].pop().querySelector('.content');   // text that sets its own size and font, as an imported deck's
      c.innerHTML = '<span style="font-size: 80px; font-family: Georgia, serif">Imported</span> <span style="font-size: 80px; font-family: Georgia, serif">text</span>'; commit(); updateToolbar(); })()""")
    shown = pg.evaluate("[$('#ed-size').value, $('#ed-font .font-name').textContent]")
    pg.click("#ed-size-up")
    runs = pg.evaluate("[...[...document.querySelectorAll('#ed-canvas .box')].pop().querySelectorAll('.content span')].map(s => getComputedStyle(s).fontSize)")
    pg.fill("#ed-size", "16"); pg.press("#ed-size", "Enter")
    left = pg.evaluate("[...document.querySelectorAll('#ed-canvas .box')].pop().querySelector('.content').innerHTML.includes('font-size')")
    check("a box whose text sets its own size and font (an imported deck) shows them; + steps that text, and a size for the box replaces them",
          shown == ["30", "Georgia"] and runs == ["96px", "96px"] and not left, f"{shown} {runs} {left}")
    pg.click("#ed-lh"); pg.click(".menu-item:has-text('Double')")
    check("line spacing as Slides means it: Double = 2 × the font's natural line height (CSS 2.3)", pg.evaluate("[...document.querySelectorAll('#ed-canvas .box')].pop().querySelector('.content').style.lineHeight") == "2.3")
    pg.click("#ed-ul")
    check("bulleted list applied to box", pg.evaluate("!![...document.querySelectorAll('#ed-canvas .box')].pop().querySelector('.content > ul > li')"))
    pg.click("#ed-lh"); pg.click(".menu-item:has-text('Add space before paragraph')")
    sp = pg.evaluate("(() => { const c = [...document.querySelectorAll('#ed-canvas .box')].pop().querySelector('.content'); return [c.style.getPropertyValue('--space-before'), getComputedStyle(c.querySelector('li')).marginTop]; })()")
    pg.click("#ed-lh"); lbl = pg.evaluate("[...document.querySelectorAll('.menu-item')].some(r => r.textContent.includes('Remove space before paragraph'))")
    pg.click(".menu-item:has-text('Remove space before paragraph')")
    gone = pg.evaluate("[...document.querySelectorAll('#ed-canvas .box')].pop().querySelector('.content').style.getPropertyValue('--space-before')")
    pg.click("#ed-lh"); pg.click(".menu-item:has-text('Custom spacing')")
    pg.fill("#ed-sp-after", "12"); pg.fill("#ed-sp-line", "1.5"); pg.keyboard.press("Enter")
    cs = pg.evaluate("(() => { const c = [...document.querySelectorAll('#ed-canvas .box')].pop().querySelector('.content'); return [c.style.getPropertyValue('--space-after'), c.style.lineHeight, document.querySelector('#ed-spacedlg').hidden]; })()")
    pg.evaluate("(() => { const c = [...document.querySelectorAll('#ed-canvas .box')].pop().querySelector('.content'); c.querySelector('li').textContent = 'hello wORLD'; })()")
    pg.click("#ed-menubar [data-menu=Format]"); pg.hover(".menu-item:has-text('Text')"); pg.hover(".menu-item:has-text('Capitalization')"); pg.click(".menu-item:has-text('Title Case')")
    pg.click("#ed-menubar [data-menu=Format]"); pg.hover(".menu-item:has-text('Text')"); pg.hover(".menu-item:has-text('Letter spacing')"); pg.click(".menu-item:has-text('Very loose')")
    tc = pg.evaluate("(() => { const c = [...document.querySelectorAll('#ed-canvas .box')].pop().querySelector('.content'); return [c.querySelector('li').textContent, c.style.letterSpacing]; })()")
    check("Format → Text → Capitalization rewrites to Title Case; Letter spacing sets letter-spacing", tc == ["Hello World", "0.1em"], str(tc))
    check("Custom spacing dialog: 12pt after (32px) and line spacing 1.5 (CSS 1.725), Enter applies and closes", cs == ["32px", "1.725", True], str(cs))
    check("paragraph spacing: Add space before paragraph puts 10pt (26.67px) above each paragraph and toggles to Remove", sp == ["26.67px", "26.67px"] and lbl and gone == "", f"{sp} {lbl} {gone!r}")
    pg.keyboard.press("Meta+k"); pg.fill("#ed-link-url", "example.com"); pg.keyboard.press("Enter")
    check("⌘K links the box text", pg.evaluate("[...document.querySelectorAll('#ed-canvas .box')].pop().querySelector('.content a')?.getAttribute('href')") == "https://example.com")
    pg.click("#ed-ul"); pg.click("#ed-ul")   # off, then on again over a fully linked text: the link must end up inside the item
    check("list toggle keeps link inside items", pg.evaluate("(() => { const c = [...document.querySelectorAll('#ed-canvas .box')].pop().querySelector('.content'); return !c.querySelector('a > ul, a > ol') && !!c.querySelector('li a'); })()"))
    pg.keyboard.press("Meta+d")   # duplicate the styled box, clear the copy, delete it
    pg.keyboard.press("Meta+\\")
    cleared = pg.evaluate("(() => { const c = [...document.querySelectorAll('#ed-canvas .box')].pop().querySelector('.content'); return !c.querySelector('a, span, [style]') && !c.style.lineHeight; })()")
    check("⌘\\ clears formatting", cleared)
    lk = pg.evaluate("""(() => { window.__cur = cur; const s = blankSlide(); slides.push(s); const t = makeBox({x: 100, y: 100, w: 400, h: 100, html: 'mail me'}), im = makeBox({x: 600, y: 100, w: 200, h: 200, cls: 'image', html: '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">'}); s.append(t, im);
      go(slides.length - 1); sel = new Set([t]); render(); updateToolbar(); return [im.id, slides[0].dataset.sid]; })()""")
    pg.keyboard.press("Meta+k"); pg.select_option("#ed-link-to", "email"); pg.fill("#ed-link-mail", "a@b.org"); pg.fill("#ed-link-subject", "the talk"); pg.locator("#ed-linkdlg .dialog").screenshot(path=str(HERE / "link-dialog.png")); pg.click("#ed-link-ok")
    mail = pg.evaluate("boxes()[0].querySelector('a')?.getAttribute('href')")
    pg.evaluate(f"(() => {{ sel = new Set([document.getElementById('{lk[0]}')]); render(); }})()")
    t0 = pg.evaluate("performance.now()"); pg.keyboard.press("Meta+k"); dlg_ms = pg.evaluate(f"Math.round(performance.now() - {t0})")
    opts = pg.evaluate("[...$('#ed-link-to').options].map(o => o.textContent)")
    pg.select_option("#ed-link-to", "slide"); pg.select_option("#ed-link-slide", f"#slide={lk[1]}"); pg.click("#ed-link-ok")
    obj = pg.evaluate(f"document.getElementById('{lk[0]}').dataset.link")
    pg.keyboard.press("Meta+k"); back = [pg.evaluate("$('#ed-link-to').value"), pg.evaluate("$('#ed-link-slide').value")]; pg.click("#ed-link-remove")
    gone = pg.evaluate(f"document.getElementById('{lk[0]}').hasAttribute('data-link')")
    pg.evaluate("(() => { slides.pop(); go(__cur); sel.clear(); render(); commit(); })()")
    check(f"Link dialog ({dlg_ms} ms): Webpage / Slide / Email / Phone number / Exit slideshow; an email with subject on text; a picture links to a slide by its id, reopens on it, Remove link",
          opts == ["Webpage", "Slide", "Email", "Phone number", "Exit slideshow"] and mail == "mailto:a@b.org?subject=the%20talk" and obj == f"#slide={lk[1]}"
          and back == ["slide", f"#slide={lk[1]}"] and gone is False, f"{opts} {mail} {obj} {back} {gone}")
    pg.keyboard.press("Backspace")
    pg.evaluate("(() => { const b = [...document.querySelectorAll('#ed-canvas .box')].pop(); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 })); })()")
    pg.mouse.up()
    pg.click("#ed-font"); pg.fill(".font-search", "georgia"); pg.click(".font-list .menu-item:has-text('Georgia')")
    pg.click("#ed-size"); n_sizes = pg.evaluate("document.querySelectorAll('.menu .menu-item').length"); pg.click(".menu-item >> text='24'")
    sz24 = pg.evaluate("[...document.querySelectorAll('#ed-canvas .box')].pop().querySelector('.content').style.fontSize")
    pg.click("#ed-font"); pg.wait_for_selector(".font-list .menu-head")
    recent = pg.evaluate("(() => { const h = [...document.querySelectorAll('.font-list .menu-head')].find(e => e.textContent === 'RECENT'); return [h?.textContent, h?.nextElementSibling?.querySelector('.menu-label')?.textContent]; })()"); pg.keyboard.press("Escape")
    check("font size list (Slides' 6–96 pt), recent fonts section", n_sizes == 16 and sz24 == "64px" and recent == ["RECENT", "Georgia"], f"{n_sizes} {sz24} {recent}")
    imp = pg.evaluate("""(() => {   // an imported title: sizes on each paragraph and its run, as gslides2deck writes them
      const b = [...document.querySelectorAll('#ed-canvas .box')].pop(), c = b.querySelector('.content'), p = '<div style="font-size: 138.7px; line-height: 1.2">';
      c.innerHTML = p + '<span style="font-size: 138.7px">PlayTrain</span></div>' + p + '<span style="font-size: 138.7px">A fast framework</span></div>';
      sel = new Set([b]); startEdit(b); setSize(64); setSize(64);
      const all = [c.innerHTML, c.getBoundingClientRect().height < 220];
      const t = c.lastChild.firstChild, r = document.createRange(); r.setStart(t, 2); r.setEnd(t, 6); getSelection().removeAllRanges(); getSelection().addRange(r); lastRange = r.cloneRange();
      setSize(128); const part = [c.lastChild.innerHTML, getSelection().toString()]; stopEdit(); return [...all, ...part]; })()""")
    check("size on selected text in an imported box: whole paragraphs take it (their lines shrink too), a part gets one span, sizing twice doesn't nest",
          imp == ['<div style="font-size: 64px; line-height: 1.2;">PlayTrain</div><div style="font-size: 64px; line-height: 1.2;">A fast framework</div>', True,
                  'A <span style="font-size: 128px;">fast</span> framework', "fast"], str(imp))
    pg.evaluate("(() => { const b = [...document.querySelectorAll('#ed-canvas .box')].pop(); content(b).innerHTML = 'one<div>two</div><div>three</div>'; content(b).style.fontSize = '96px'; fitHeight(b); sel = new Set([b]); drawOverlay(); })()")
    h = pg.locator(".handle[data-dir=s]").bounding_box(); pg.mouse.move(h["x"] + h["width"] / 2, h["y"] + h["height"] / 2); pg.mouse.down()
    pg.mouse.move(h["x"] + h["width"] / 2, h["y"] - 150, steps=5); pg.mouse.up()
    fit = pg.evaluate("(() => { const b = [...document.querySelectorAll('#ed-canvas .box')].pop(); return [geo(b).h >= content(b).offsetHeight, +b.dataset.minh < geo(b).h]; })()")
    check("dragging a text box shorter than its text: it grows back to fit on release (as Slides), keeping the dragged height as its floor", fit == [True, True], str(fit))
    pg.click("#ed-font"); pg.fill(".font-search", "lobster"); pg.click(".font-list .menu-item:has(.menu-label:text-is('Lobster'))")
    gf = pg.evaluate("[[...document.querySelectorAll('#ed-canvas .box')].pop().querySelector('.content').style.fontFamily, document.querySelector('#ed-deck-fonts')?.getAttribute('href') || '', document.querySelectorAll('#ed-thumbs').length]")
    pg.click("#ed-font"); pg.wait_for_selector(".font-list .menu-head"); n_all = pg.evaluate("document.querySelector('.font-pad').offsetHeight / 32")
    heads = pg.evaluate("[...document.querySelectorAll('.font-list .menu-head')].map(e => e.textContent)"); pg.click(".font-cat:has-text('Monospace')")
    mono = pg.evaluate("[...document.querySelectorAll('.font-list .menu-label')].slice(0, 3).map(e => e.textContent)"); pg.keyboard.press("Escape")
    check("font menu: the whole Google Fonts catalogue (searchable, filtered by category, Used in this deck / Recent / All), picking one links it in the deck",
          gf[0] == "Lobster, sans-serif" and "fonts.googleapis.com/css2?" in gf[1] and "family=Lobster" in gf[1] and n_all > 1500 and heads[:2] == ["USED IN THIS DECK", "RECENT"] and len(mono) == 3,
          f"{gf} {n_all} {heads} {mono}")
    pg.click("#ed-font"); pg.fill(".font-search", "georgia"); pg.click(".font-list .menu-item:has-text('Georgia')")
    lf = pg.evaluate("""(async () => { const fam = await useFontFile({ query: 'name=Test-Font.ttf', body: new Blob(['not really a font']) });
      return [fam, deckDoc.querySelector('#deck-theme').textContent.includes("@font-face { font-family: 'Test Font'; src: url('assets/fonts/Test-Font.ttf')")]; })()""")
    pg.click("#ed-font"); pg.click(".font-cat:has-text('Your fonts')"); pg.wait_for_selector(".font-list .menu-head:text-is('ON THIS COMPUTER')")
    yours = pg.evaluate("[...document.querySelectorAll('.font-list .menu-head, .font-list .menu-label')].slice(0, 3).map(e => e.textContent)"); pg.keyboard.press("Escape")
    check("Your fonts: a font file goes to assets/fonts/ with an @font-face in #deck-theme, and is listed under In this deck",
          lf == ["Test Font", True] and (deck.parent / "assets" / "fonts" / "Test-Font.ttf").exists() and yours[:2] == ["IN THIS DECK", "Test Font"], f"{lf} {yours}")
    pg.click("#ed-menubar [data-menu=Insert]"); pg.click(".menu-item:has-text('Special characters')")
    pg.fill("#ed-chars-q", "\\alpha"); first = pg.evaluate("document.querySelector('#ed-chars-grid button')?.textContent")
    pg.fill("#ed-chars-q", "u+2192"); arrow = pg.evaluate("document.querySelector('#ed-chars-grid button')?.textContent")
    pg.click("#ed-chars-grid button"); made = pg.evaluate("[...document.querySelectorAll('#ed-canvas .box')].pop().textContent")
    pg.fill("#ed-chars-q", ""); rec = pg.evaluate("[document.querySelector('#ed-chars-grid .chars-sep')?.textContent, document.querySelector('#ed-chars-grid button')?.textContent]")
    pg.keyboard.press("Escape"); pg.evaluate("(() => { const b = boxes().find(b => b.textContent === '→'); b?.remove(); sel.clear(); render(); commit(); })()")
    pg.click("#ed-add-text"); pg.keyboard.type("\\alpha + x^2 + y_{ij} done")
    tx = pg.evaluate("[...document.querySelectorAll('#ed-canvas .box')].pop().querySelector('.content').innerHTML.replace(/&nbsp;/g, ' ')"); pg.keyboard.press("Escape")
    pg.evaluate("(() => { sel.forEach(b => b.remove()); sel.clear(); render(); commit(); })()")
    check("LaTeX shortcuts while typing: \\alpha → α, ^2 → superscript, _{ij} → subscript", tx == "α + x<sup>2</sup> + y<sub>ij</sub> done", tx)
    pg.click("#ed-add-text"); t0 = pg.evaluate("performance.now()"); pg.keyboard.type("\"It's\" 'ok' -- (\"x\")"); q_ms = pg.evaluate(f"Math.round((performance.now() - {t0}) / 21)")
    qt = pg.evaluate("[...document.querySelectorAll('#ed-canvas .box')].pop().textContent.replace(/\\u00a0/g, ' ')")
    pg.keyboard.press("Escape")
    pg.evaluate("(() => { sel.forEach(b => b.remove()); sel.clear(); render(); commit(); })()")
    pg.click("#ed-add-text"); pg.keyboard.type("- one"); pg.keyboard.press("Enter"); pg.keyboard.type("two")
    ul = pg.evaluate("[...document.querySelectorAll('#ed-canvas .box')].pop().querySelector('.content').innerHTML"); pg.keyboard.press("Escape")
    pg.evaluate("(() => { sel.forEach(b => b.remove()); sel.clear(); render(); commit(); })()")
    pg.click("#ed-add-text"); pg.keyboard.type("1. first")
    ol = pg.evaluate("[...document.querySelectorAll('#ed-canvas .box')].pop().querySelector('.content').innerHTML"); pg.keyboard.press("Escape")
    pg.evaluate("(() => { sel.forEach(b => b.remove()); sel.clear(); store('slides-auto-lists', '0'); store('slides-smart-quotes', '0'); render(); commit(); })()")
    pg.click("#ed-add-text"); pg.keyboard.type("- \"x\"")
    off = pg.evaluate("[...document.querySelectorAll('#ed-canvas .box')].pop().textContent.replace(/\\u00a0/g, ' ')"); pg.keyboard.press("Escape")
    pg.evaluate("(() => { sel.forEach(b => b.remove()); sel.clear(); store('slides-auto-lists'); store('slides-smart-quotes'); render(); commit(); })()")
    pg.click("#ed-menubar [data-menu=Tools]"); tools = pg.evaluate("[...document.querySelectorAll('.menu .menu-label')].map(e => e.textContent)"); pg.keyboard.press("Escape")
    check(f"smart quotes and dashes while typing ({q_ms} ms a key); '- ' and '1. ' start lists; both off from Tools",
          qt == "“It’s” ‘ok’ — (“x”)" and ul == "<ul><li>one</li><li>two</li></ul>" and ol.startswith("<ol><li>first")
          and off == '- "x"' and {"Use smart quotes", "Automatically detect lists"} <= set(tools), f"{qt!r} {ul} {ol} {off!r} {tools}")
    pg.click("#ed-menubar [data-menu=Insert]"); pg.click(".menu-item:has-text('Icon')"); pg.wait_for_selector("#ed-icons-grid button")
    pg.fill("#ed-icons-q", "rocket launch"); pg.click("#ed-icons-grid button >> nth=0")
    ic = pg.evaluate("(() => { const b = [...sel][0]; return [b.dataset.shape, b.dataset.icon, b.querySelector('svg text')?.textContent, deckDoc.querySelector('link#deck-icons')?.getAttribute('href') || '']; })()")
    pg.evaluate("(() => { sel.forEach(b => b.remove()); sel.clear(); render(); commit(); })()")
    check("Insert → Icon: searchable Material Symbols grid; inserts a data-shape=icon box drawn from the glyph; the deck links just its icons",
          ic[:3] == ["icon", "rocket_launch", "rocket_launch"] and "icon_names=rocket_launch" in ic[3], str(ic))
    pg.click("#ed-menubar [data-menu=Insert]"); pg.hover(".menu-item:has-text('Code block')"); pg.click(".menu-item:has(.menu-label:text-is('Python'))")
    pg.wait_for_function("document.querySelector('#ed-canvas pre code.language-python[data-highlighted]')", timeout=15000)
    cb = pg.evaluate("(() => { const c = document.querySelector('#ed-canvas pre code.language-python'); return [c.querySelectorAll('.hljs-keyword').length > 0, getComputedStyle(c.querySelector('.hljs-keyword')).color]; })()")
    pg.evaluate("(() => { sel.forEach(b => b.remove()); sel.clear(); render(); commit(); })()")
    check("Insert → Code block (Python): <pre><code class=language-python> coloured by highlight.js with base.css' colours", cb == [True, "rgb(207, 34, 46)"], str(cb))
    pg.click("#ed-menubar [data-menu=Insert]"); pg.click(".menu-item:has(.menu-label:text-is('Equation'))")
    pg.wait_for_function("document.querySelector('#ed-canvas .katex')", timeout=15000)
    eq = pg.evaluate("(() => { const b = [...sel][0]; return [!!b.querySelector('.katex-display'), cleanBox(b).querySelector('.content').textContent]; })()")
    pg.keyboard.press("Enter"); src = pg.evaluate("[...sel][0].querySelector('.content').textContent"); pg.keyboard.press("Escape")
    pg.wait_for_function("[...sel][0]?.querySelector('.katex')", timeout=15000)
    pg.evaluate("(() => { sel.forEach(b => b.remove()); sel.clear(); render(); commit(); })()")
    check("Insert → Equation: KaTeX typesets \\[…\\]; the deck and editing keep the source", eq == [True, "\\[ e^{i\\pi} + 1 = 0 \\]"] and src == "\\[ e^{i\\pi} + 1 = 0 \\]", f"{eq} {src}")
    pg.click("#ed-menubar [data-menu=Insert]"); pg.hover(".menu-item:has-text('Table')")
    pg.hover(".tg-cell[data-r='1'][data-c='2']"); cap = pg.evaluate("document.querySelector('.table-cap').textContent"); pg.click(".tg-cell[data-r='1'][data-c='2']")
    dims = pg.evaluate("(() => { const t = [...sel][0].querySelector('table'); return [t.rows.length, t.rows[0].cells.length]; })()")
    pg.keyboard.press("Enter"); pg.evaluate("focusCell([...sel][0].querySelector('td'))"); pg.keyboard.type("Item"); pg.keyboard.press("Tab"); pg.keyboard.type("Q1")
    for _ in range(5): pg.keyboard.press("Tab")   # Q1 is cell 2 of 6: four Tabs reach the last cell, the fifth adds a row
    td = pg.locator("#ed-canvas table td >> nth=0"); td.click(button="right"); pg.click(".menu-item:has-text('Insert column right')")
    after = pg.evaluate("(() => { const t = document.querySelector('#ed-canvas table'); return [t.rows.length, t.rows[0].cells.length, t.rows[0].cells[0].textContent, t.rows[0].cells[2].textContent]; })()")
    pg.keyboard.press("Escape"); pg.evaluate("(() => { sel.forEach(b => b.remove()); sel.clear(); render(); commit(); })()")
    check("Insert → Table: size grid (3 x 2), Tab moves between cells and adds a row at the end, right-click a cell to insert a column",
          cap == "3 x 2" and dims == [2, 3] and after == [3, 4, "Item", "Q1"], f"{cap} {dims} {after}")
    pg.click("#ed-menubar [data-menu=Insert]"); pg.hover(".menu-item:has-text('Video')"); pg.click(".menu-item:has-text('By URL')")
    pg.fill("#ed-url-in", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5"); pg.keyboard.press("Enter")
    em = pg.evaluate("(() => { const b = [...sel][0]; return [b.classList.contains('embed'), b.querySelector('iframe').getAttribute('src'), isMedia(b)]; })()")
    pg.evaluate("(() => { sel.forEach(b => b.remove()); sel.clear(); render(); commit(); })()")
    check("Insert → Video → By URL / Insert → Embed: an iframe box; a YouTube page address becomes its player", em == [True, "https://www.youtube.com/embed/dQw4w9WgXcQ", True], str(em))
    png = pg.evaluate("""(async () => { const r = makeBox({x: 800, y: 400, w: 300, h: 200, shape: 'rect'}); r.style.setProperty('--fill', '#ff0000'); slides[cur].append(r); render();
      const b = await slidePNG(); r.remove(); render(); const im = await createImageBitmap(b); const cv = new OffscreenCanvas(im.width, im.height), x = cv.getContext('2d'); x.drawImage(im, 0, 0);
      return [b.type, im.width, im.height, [...x.getImageData(950, 500, 1, 1).data].slice(0, 3)]; })()""")
    check("File → Download → PNG image: the current slide as a 1920×1080 PNG with its shapes drawn", png == ["image/png", 1920, 1080, [255, 0, 0]], str(png))
    fm = pg.evaluate("""(async () => { const r = await fetch('/api/recent').then(r => r.json()); const z = await fetch('/api/zip'); const zb = new Uint8Array(await z.arrayBuffer());
      return [r.length >= 1 && r[0].current, z.headers.get('content-type'), zb[0] === 0x50 && zb[1] === 0x4b]; })()""")
    pg.click("#ed-menubar [data-menu=File]"); pg.hover(".menu-item:has(.menu-label:text-is('Open'))"); pg.wait_for_selector(".menu-item:has-text('Open a folder')")
    opened = pg.evaluate("document.querySelectorAll('.menu').length"); pg.evaluate("closeMenu()")   # not Esc: a second Esc would move focus to the filmstrip
    px = pg.evaluate("""(async () => { const r = await fetch('/api/pptx'); const b = new Uint8Array(await r.arrayBuffer()); return [r.status, r.headers.get('content-type').includes('presentationml'), b[0] === 0x50 && b[1] === 0x4b, b.length > 20000]; })()""")
    imp = pg.evaluate("""(async () => { await flushSave(); const b = await (await fetch('/api/pptx')).blob(); const j = await (await fetch('/api/importpptx', { method: 'POST', body: b })).json();
      return [j.slides?.length === slides.length, (j.slides || []).join('').includes('class="box'), j.error || '']; })()""")
    check("Import slides: a .pptx (here our own export) comes back as deck sections with boxes", imp == [True, True, ""], str(imp))
    gsl = pg.evaluate(r"""async file => { const j = await (await fetch('/api/importgslides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file }) })).json();
      const h = (j.slides || []).join(''), n0 = slides.length; if (!j.error) insertImported(j, 'fixture');
      const g = n0 + 2 === slides.length ? slides[cur + 1] : null;
      return [j.error || '', j.slides?.length, /data-role="title"[^>]*>.*?font-size: 74\.7px[^>]*>.*?color: #000000/.test(h), /<ul[^>]*><li[^>]*>.*?<span style="[^"]*font-weight: bold[^"]*">2 k<\/span>/.test(h) && h.includes('<ol>') === false,
        /data-shape="roundrect" data-dash="dash"/.test(h), /data-shape="line" data-end="fill-arrow" data-from="g2-1:r" data-to="g2-2:l"/.test(h), /transform: rotate\(30\.00deg\)/.test(h),
        /data-crop="0\.0500 0\.0000 0\.0000 0\.1000"/.test(h) && h.includes('alt="A red square"'), /class="box group"/.test(h) && /<table>(<col[^>]*>)*<tr[^>]*><td/.test(h), h.includes('<aside class="notes">Say hello first'),
        !!g && [...g.querySelectorAll('.box')].every(b => b.id), slides.length === n0 + 2]; }""", str(ROOT / "test" / "fixtures" / "gslides-api.json"))
    check("Import from Google Slides: a presentations.get response becomes sections (placeholder text inherits the layout's 28 pt and the theme's black, bullets, "
          "dashed rounded rectangle, an arrow attached to both shapes, a rotated box, a cropped picture with alt text, a group, a table, notes) and is inserted after the current slide",
          gsl == ["", 2, True, True, True, True, True, True, True, True, True, True], str(gsl))
    pg.evaluate("slides.splice(cur, 2); go(cur - 1); commit()")   # the two imported slides out again
    check("File → Download → PowerPoint: /api/pptx runs pptx_export.py (python-pptx via uv) and returns a .pptx", px == [200, True, True, True], str(px))
    check("File → Open lists recent decks (~/.glideshow/recent.json); Download → Web page folder is a .zip of the deck", fm == [True, "application/zip", True] and opened >= 2, f"{fm} {opened}")
    ps = pg.evaluate("""(() => { setPageSize(1920, 1440); const r = [deckDoc.querySelector('.slides').dataset.size, W, H, getComputedStyle(document.querySelector('#ed-canvas > section')).height,
      Math.round(document.querySelector('#ed-frame').getBoundingClientRect().height / document.querySelector('#ed-frame').getBoundingClientRect().width * 100)];
      setPageSize(1920, 1080); return [...r, deckDoc.querySelector('.slides').dataset.size ?? null]; })()""")
    check("File → Page setup: 4:3 stores data-size=1920x1440, resizes the canvas and frame; back to 16:9 removes it", ps == ["1920x1440", 1920, 1440, "1440px", 75, None], str(ps))
    nt = pg.evaluate("""(() => { window.postMessage({ slides: 'note', h: hv(cur)[0], v: hv(cur)[1], x: 300, y: 200, text: 'make this chart bigger' }, '*'); return new Promise(r => setTimeout(() => {
      const n = slides[cur].querySelector('.box.note'), chip = document.querySelector('#ed-ai-notes .ai-note');
      const out = [n?.textContent, !!n?.dataset.time, chip?.textContent.includes('make this chart bigger'), deckHTML().includes('class="box note"')];
      n?.remove(); render(); commit(); r(out); }, 300)); })()""")
    check("Note for AI: M while presenting (postMessage) adds a stamped .box.note to the slide, listed above the speaker notes, saved in the deck", nt == ["make this chart bigger", True, True, True], str(nt))
    # View → Show sticky notes: off hides them on the slide and in the filmstrip, out of Select all and drags too, remembered;
    # the list above the speaker notes, or adding a note, shows them again; the deck itself never changes
    pg.evaluate("(() => { addNote(cur, 300, 200, 'sticky test'); sel.clear(); drawOverlay(); })()"); pg.wait_for_timeout(300)
    SEEN = """(() => { const n = slides[cur].querySelector('.box.note'), t = document.querySelector('#ed-thumbs .thumb.active .thumb-canvas .box.note');
      return [!!n && n.getClientRects().length > 0, !!t && getComputedStyle(t).display !== 'none']; })()"""
    pg.click("#ed-menubar [data-menu=View]"); item = pg.locator(".menu-item", has=pg.locator(".menu-label", has_text="Show sticky notes"))
    on_before = [item.count(), item.locator(".menu-icon").text_content()]; saved_before = pg.evaluate("deckHTML()")
    shown = pg.evaluate(SEEN); item.click(); pg.wait_for_timeout(200)
    hidden = pg.evaluate(SEEN); pg.keyboard.press("Escape"); pg.evaluate("document.activeElement.blur(); stopEdit()"); pg.keyboard.press("Meta+a")
    picked = pg.evaluate("[sel.size, [...sel].some(b => b.classList.contains('note')), boxes(slides[cur]).length]")
    same_deck = pg.evaluate("deckHTML()") == saved_before
    pg.reload(); pg.wait_for_function("typeof slides !== 'undefined' && slides.length > 0"); pg.evaluate("go(slides.findIndex(s => s.querySelector('.box.note')?.textContent === 'sticky test'))"); pg.wait_for_timeout(300)
    kept = pg.evaluate(SEEN + " .concat([document.body.classList.contains('stickies-off')])")
    pg.click("#ed-ai-notes .ai-note"); pg.wait_for_timeout(200)
    via_list = pg.evaluate(SEEN + " .concat([[...sel].some(b => b.classList.contains('note'))])")
    pg.evaluate("setStickies(false)"); pg.evaluate("(() => { const b = addNote(cur, 400, 300, 'second'); b.remove(); render(); commit(); })()")
    via_add = pg.evaluate("document.body.classList.contains('stickies-off')")
    pg.evaluate("(() => { slides[cur].querySelectorAll('.box.note').forEach(n => n.remove()); sel.clear(); render(); commit(); })()")
    check("View → Show sticky notes: on at first; off hides them on the slide and in the filmstrip, keeps them out of Select all, is remembered, and leaves the deck as it was",
          on_before == [1, "check"] and shown == [True, True] and hidden == [False, False] and picked[0] >= 1 and not picked[1] and same_deck and kept == [False, False, True],
          f"{on_before} {shown} {hidden} {picked} {same_deck} {kept}")
    check("…a note picked in the list above the speaker notes, or a note added, shows them again", via_list == [True, True, True] and via_add is False, f"{via_list} {via_add}")
    # editing a text box: a drag that starts on its text (its first letter sits a few px inside the box) selects the text,
    # it doesn't move the box; a drag in the box's margin still does
    pt = pg.evaluate("""(() => { const b = addText('Selectable heading text'); sel = new Set([b]); startEdit(b); window.__sb = b;
      const t = [...content(b).querySelectorAll('*'), content(b)].map(e => [...e.childNodes].find(n => n.nodeType === 3 && n.textContent.trim())).find(Boolean), r = document.createRange();
      r.setStart(t, 0); r.setEnd(t, 1); const g = r.getBoundingClientRect(), bb = b.getBoundingClientRect(); return [g.left + 1, g.top + g.height / 2, bb.left, b.style.left, b.style.top]; })()""")
    pg.mouse.click(pt[0] + 30, pt[1]); pg.wait_for_timeout(150)   # the caret in the text, as a person would have it
    pg.mouse.move(pt[0], pt[1]); pg.mouse.down(); pg.mouse.move(pt[0] + 60, pt[1], steps=6); pg.mouse.move(pt[0] + 140, pt[1], steps=6); pg.mouse.up(); pg.wait_for_timeout(200)
    drag_sel = pg.evaluate("[__sb.style.left, __sb.style.top, getSelection().toString(), editing === __sb]")
    pg.evaluate("(() => { stopEdit(); __sb.remove(); sel.clear(); render(); commit(); })()")
    check("editing text: a drag from the first letter selects text and doesn't move the box (it did, from within 14 px of the edge)",
          drag_sel[:2] == pt[3:5] and drag_sel[2].startswith("Select") and drag_sel[3] and pt[0] - pt[2] < 20, f"{pt} {drag_sel}")
    check("Insert → Special characters: LaTeX and codepoint search, inserts a new text box when not editing, remembers recently used",
          first == "α" and arrow == "→" and made == "→" and rec == ["Recently used", "→"], f"{first} {arrow} {made} {rec}")
    check("font family applied to box", pg.evaluate("[...document.querySelectorAll('#ed-canvas .box')].pop().querySelector('.content').style.fontFamily") == "Georgia, serif")
    pg.click("#ed-add-shape"); pg.hover(".menu-item:has-text('Shapes')"); pg.click(".menu-item[data-label='Rounded rectangle']")
    fr = pg.locator("#ed-frame").bounding_box(); pg.mouse.move(fr["x"] + fr["width"] * .35, fr["y"] + fr["height"] * .3); pg.mouse.down()
    pg.mouse.move(fr["x"] + fr["width"] * .65, fr["y"] + fr["height"] * .7, steps=5); pg.mouse.up()
    drawn = pg.evaluate("(() => { const b = [...document.querySelectorAll('#ed-canvas .box[data-shape]')].pop(); return [b.dataset.shape, Math.round(parseFloat(b.style.width) / 96), Math.round(parseFloat(b.style.height) / 108), [...sel][0] === b]; })()")
    check("shape picker (Shapes ▸ grid) then drag on the slide draws the shape at that size", drawn == ["roundrect", 6, 4, True], str(drawn))
    cx, cy = pg.evaluate("(() => { const r = [...document.querySelectorAll('#ed-canvas .box[data-shape]')].pop().getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()")
    before = pg.evaluate("[...document.querySelectorAll('#ed-canvas .box[data-shape]')].pop().style.left")
    pg.mouse.move(cx, cy); pg.mouse.down(); pg.mouse.move(cx + 100, cy + 60, steps=5); pg.mouse.up()
    after = pg.evaluate("[...document.querySelectorAll('#ed-canvas .box[data-shape]')].pop().style.left")
    check("drag moves a shape", before != after, f"{before} -> {after}")
    sx = pg.evaluate("(() => { const b = [...document.querySelectorAll('#ed-canvas .box[data-shape]')].pop(); return [b.style.left, b.style.top]; })()")
    n_shapes = pg.evaluate("document.querySelectorAll('#ed-canvas .box[data-shape]').length")
    cx, cy = cx + 100, cy + 60
    pg.keyboard.down("Alt"); pg.mouse.move(cx, cy); pg.mouse.down(); pg.keyboard.up("Alt")
    pg.keyboard.down("Shift"); pg.mouse.move(cx + 37, cy + 150, steps=5); pg.mouse.up(); pg.keyboard.up("Shift")
    dup = pg.evaluate("(() => { const bs = [...document.querySelectorAll('#ed-canvas .box[data-shape]')]; return [bs.length, bs[bs.length - 2].style.left, bs[bs.length - 2].style.top, bs[bs.length - 1].style.left, bs[bs.length - 1].style.top]; })()")
    check("⌥-drag copies, ⇧ constrains to vertical", dup[0] == n_shapes + 1 and dup[1:3] == sx and dup[3] == sx[0] and dup[4] != sx[1], f"{sx} {dup}")
    pg.keyboard.press("Backspace")
    pg.mouse.click(cx, cy - 1)   # back to the original shape

    h = pg.locator(".handle[data-dir=se]").bounding_box()
    w0 = pg.evaluate("[...document.querySelectorAll('#ed-canvas .box[data-shape]')].pop().style.width")
    pg.mouse.move(h["x"] + 3, h["y"] + 3); pg.mouse.down(); pg.mouse.move(h["x"] + 80, h["y"] + 40, steps=5); pg.mouse.up()
    w1 = pg.evaluate("[...document.querySelectorAll('#ed-canvas .box[data-shape]')].pop().style.width")
    check("handle resizes a shape", w0 != w1, f"{w0} -> {w1}")

    r = pg.locator(".handle.rotate").bounding_box()
    bb = pg.evaluate("(() => { const r = [...document.querySelectorAll('#ed-canvas .box[data-shape]')].pop().getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()")
    pg.mouse.move(r["x"] + r["width"]/2, r["y"] + r["height"]/2); pg.mouse.down()
    pg.mouse.move(bb[0] + 200, bb[1], steps=5); pg.keyboard.down("Shift"); pg.mouse.move(bb[0] + 200, bb[1] + 1, steps=2)
    mid = pg.evaluate("[[...document.querySelectorAll('#ed-canvas .box[data-shape]:not(.rot-ghost)')].pop().style.transform, document.querySelectorAll('#ed-guides .rot-ghost').length, document.querySelector('#ed-guides .rot-label')?.textContent]")
    pg.mouse.up(); pg.keyboard.up("Shift")
    check("rotating shows a grey outline and angle label, applying on release (as Slides)", mid == ["", 1, "90°"] and not pg.evaluate("document.querySelector('#ed-guides .rot-ghost, #ed-guides .rot-label')"), str(mid))
    check("skipped slides are veiled with a centred eye; transitions marked under the number",
          pg.evaluate("""(() => { slides[0].dataset.visibility = 'hidden'; slides[0].dataset.transition = 'fade'; renderThumbs();
            const t = document.querySelector('.thumb'), out = [!!t.querySelector('.thumb-view > .skipped .icon'), !!t.querySelector('.num .has-trans')];
            delete slides[0].dataset.visibility; delete slides[0].dataset.transition; renderThumbs(); return out.join(); })()""") == "true,true")
    check("rotation handle rotates (⇧ snaps)", pg.evaluate("[...document.querySelectorAll('#ed-canvas .box[data-shape]')].pop().style.transform") == "rotate(90deg)", pg.evaluate("[...document.querySelectorAll('#ed-canvas .box[data-shape]')].pop().style.transform"))
    rb = pg.evaluate("(() => { const b = [...document.querySelectorAll('#ed-canvas .box[data-shape]')].pop(); return [parseFloat(b.style.width), parseFloat(b.style.height)]; })()")
    h = pg.locator(".handle[data-dir=e]").bounding_box()   # at 90° the box's east handle sits at the bottom
    pg.mouse.move(h["x"] + h["width"]/2, h["y"] + h["height"]/2); pg.mouse.down(); pg.mouse.move(h["x"] + h["width"]/2, h["y"] + h["height"]/2 + 40, steps=4); pg.mouse.up()
    ra = pg.evaluate("(() => { const b = [...document.querySelectorAll('#ed-canvas .box[data-shape]')].pop(); return [parseFloat(b.style.width), parseFloat(b.style.height)]; })()")
    check("rotated box resizes along its own axes", ra[0] > rb[0] + 20 and abs(ra[1] - rb[1]) < 1, f"{rb} -> {ra}")
    pg.click(".swatch[data-for=fill]")
    n_cells = pg.evaluate("document.querySelector('.palette .cells.std').children.length * (document.querySelector('.palette .cells').children.length === 10)")
    pg.click(".palette .cell[data-color='#cc0000']")
    picked = pg.evaluate("[...document.querySelectorAll('#ed-canvas .box[data-shape]')].pop().style.getPropertyValue('--fill')")
    pg.click(".swatch[data-for=fill]"); pg.click(".palette .transparent")
    cleared = pg.evaluate("[...document.querySelectorAll('#ed-canvas .box[data-shape]')].pop().style.getPropertyValue('--fill')")
    check("color popover: 8×10 palette, pick, transparent", n_cells == 80 and picked == "#cc0000" and cleared == "transparent", f"{n_cells} {picked} {cleared}")
    pg.evaluate("(() => { const i = document.querySelector('#ed-fill'); i.value = '#e06666'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); })()")

    pg.evaluate("""(async () => {
      const c = document.createElement('canvas'); c.width = 400; c.height = 200;
      const x = c.getContext('2d'); x.fillStyle = '#3c9'; x.fillRect(0,0,400,200); x.fillStyle = '#fff'; x.font = '48px sans-serif'; x.fillText('plot.png', 90, 115);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'plot.png', { type: 'image/png' }));
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    })()""")
    pg.wait_for_timeout(800)
    n_img = pg.evaluate("document.querySelectorAll('#ed-canvas .box.image').length")
    pg.evaluate("""(async () => {   // Finder-style paste: file only in items, not in files
      const c = document.createElement('canvas'); c.width = 200; c.height = 100;
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const f = new File([blob], 'finder.png', { type: 'image/png' });
      const e = new Event('paste', { bubbles: true });
      e.clipboardData = { files: [], items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }, { kind: 'file', type: 'image/png', getAsFile: () => f }], getData: () => 'finder.png' };
      document.body.dispatchEvent(e);
    })()""")
    pg.wait_for_function(f"document.querySelectorAll('#ed-canvas .box.image').length > {n_img}", timeout=10000)
    check("paste falls back to clipboard items", pg.evaluate("document.querySelectorAll('#ed-canvas .box.image').length") == n_img + 1)
    pg.evaluate("addShape('arrowline')")

    pg.click("#ed-new-slide-btn"); pg.click("#ed-add-text"); pg.keyboard.type("Slide two"); pg.keyboard.press("Escape")
    check("speaker notes start collapsed to a thin bar", pg.evaluate("document.body.classList.contains('notes-off') && getComputedStyle(document.querySelector('#ed-splitter')).display !== 'none'"))
    pg.keyboard.press("Meta+Alt+Shift+s")   # open the notes pane
    pg.click("#ed-notes"); pg.keyboard.type("Mention the caveat"); pg.keyboard.press("Backspace"); pg.keyboard.type("t")
    pg.mouse.click(5, 880)   # blur the notes pane (filmstrip)
    pg.click("#ed-menubar [data-menu=View]"); pg.click(".menu-item:has-text('Show speaker notes')")
    hidden = pg.evaluate("getComputedStyle(document.querySelector('#ed-notes')).display")
    pg.click("#ed-menubar [data-menu=View]"); pg.click(".menu-item:has-text('Show speaker notes')")
    check("notes pane edits <aside class=notes>, Backspace stays in notes, View toggles it", pg.evaluate("slides[cur].querySelector(':scope > aside.notes')?.textContent") == "Mention the caveat" and hidden == "none", hidden)
    pg.click(".thumb >> nth=0")
    n0 = pg.evaluate("document.querySelectorAll('#ed-thumbs .thumb').length")
    pg.keyboard.press("Meta+z"); pg.wait_for_timeout(100)
    pg.keyboard.press("Meta+z"); pg.wait_for_timeout(100)
    pg.keyboard.press("Meta+Shift+z"); pg.wait_for_timeout(100)
    pg.keyboard.press("Meta+Shift+z"); pg.wait_for_timeout(1200)
    n1 = pg.evaluate("document.querySelectorAll('#ed-thumbs .thumb').length")
    check("undo/redo round-trips", n0 == n1 == 2, f"{n0} {n1}")
    # undo returns to the slide where the change was made (not slide 1)
    pg.click(".thumb >> nth=1"); pg.wait_for_timeout(200)
    pg.click("#ed-add-text"); pg.keyboard.type("undo target"); pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    pg.click(".thumb >> nth=0"); pg.wait_for_timeout(200)
    pg.keyboard.press("Meta+z"); pg.wait_for_timeout(300)
    check("undo jumps to the edited slide", pg.evaluate("cur") == 1, str(pg.evaluate("cur")))
    pg.keyboard.press("Meta+Shift+z"); pg.wait_for_timeout(300)
    check("redo stays on the edited slide", pg.evaluate("cur") == 1 and pg.evaluate("document.body.textContent.includes('undo target')"))
    pg.keyboard.press("Meta+z"); pg.wait_for_timeout(300)
    # a new deck starts on a Title slide with placeholders; one click on a placeholder starts typing; the theme applies
    check("new deck opens on a Title slide", pg.evaluate("slides[0].dataset.layout === 'title' && slides[0].querySelectorAll('.box[data-placeholder]').length === 2"))
    pg.keyboard.press("Meta+m"); pg.wait_for_timeout(300)   # a fresh Title-and-body slide, nothing overlapping its placeholders
    check("⌘M after the current slide gives a layout with placeholders", pg.evaluate("slides[cur].dataset.layout === 'title-body'"))
    n_before = pg.evaluate("slides.length"); pg.click("#ed-new-slide-more"); pg.click(".menu-item:has-text('Big number')"); pg.wait_for_timeout(200)
    big = pg.evaluate("[slides.length, slides[cur].dataset.layout, boxes().map(b => b.dataset.role).join(), picked.size]")
    healed = pg.evaluate("""(() => { const el = deckDoc.querySelector('#deck-theme'), was = el.textContent;
      el.textContent = '/* slides-theme {"name":"Simple Light","titleSize":null,"bodySize":null,"layouts":{"title":[["title",65,152,1790,431,null,"bottom","center"]]}} */\\n/* end slides-theme */\\n';
      const t = theme(); el.textContent = was; return [t.titleSize, t.bodySize, !!t.layouts?.title]; })()""")
    pg.click("#ed-menubar [data-menu=Slide]"); pg.hover(".menu-item:has-text('New slide with layout')"); pg.click(".menu-item:has(.menu-label:text-is('Section header'))"); pg.wait_for_timeout(200)
    sec = pg.evaluate("[slides.length, slides[cur].dataset.layout]")
    pg.keyboard.press("Meta+z"); pg.wait_for_timeout(200); pg.keyboard.press("Meta+z"); pg.wait_for_timeout(200)
    check("+ ▾ and Slide → New slide with layout add a slide in any layout (only it picked); a theme saved with null sizes falls back to Simple Light's", big == [n_before + 1, "big-number", "title,body", 1] and sec == [n_before + 2, "section"] and healed == [28, 18, False] and pg.evaluate("slides.length") == n_before, f"{big} {sec} {healed}")


    tb = pg.locator("#ed-canvas .box[data-placeholder][data-role=title]").first.bounding_box()
    pg.mouse.click(tb["x"] + tb["width"] / 2, tb["y"] + tb["height"] / 2); pg.wait_for_timeout(200)
    check("one click on an empty placeholder starts typing", pg.evaluate("!!editing && editing.dataset.role === 'title'"))
    # pressing and dragging on the empty placeholder while editing moves it (no text to select); the caret stays
    x0 = pg.evaluate("editing.style.left")
    pg.mouse.move(tb["x"] + tb["width"] / 2, tb["y"] + tb["height"] / 2); pg.mouse.down(); pg.mouse.move(tb["x"] + tb["width"] / 2 + 120, tb["y"] + tb["height"] / 2 + 40, steps=6); pg.mouse.up(); pg.wait_for_timeout(300)
    check("dragging an empty placeholder moves it and keeps editing", pg.evaluate(f"!!editing && editing.dataset.role === 'title' && editing.style.left !== '{x0}'"))
    pg.keyboard.press("Meta+z"); pg.wait_for_timeout(300)
    tb = pg.locator("#ed-canvas .box[data-placeholder][data-role=title]").first.bounding_box()
    pg.mouse.click(tb["x"] + tb["width"] / 2, tb["y"] + tb["height"] / 2); pg.wait_for_timeout(200)
    pg.keyboard.type("Deck title"); pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    check("typed title keeps the theme colour and Arial", pg.evaluate("(() => { const c = document.querySelector('#ed-canvas .box[data-role=title] .content'); const cs = getComputedStyle(c); return c.textContent === 'Deck title' && cs.color === 'rgb(0, 0, 0)' && /Arial/.test(cs.fontFamily); })()"))
    pg.keyboard.press("Meta+z"); pg.wait_for_timeout(300); pg.keyboard.press("Meta+z"); pg.wait_for_timeout(300)   # undo the typing and the new slide
    # after clicking a thumbnail, clicking a box and pressing Backspace deletes the box, not the slide
    pg.click("#ed-add-text"); pg.keyboard.type("to delete"); pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    n_slides = pg.evaluate("slides.length"); victim = pg.evaluate("[...sel][0].id")
    pg.click(f".thumb >> nth={pg.evaluate('cur')}"); pg.wait_for_timeout(200)   # focus the filmstrip on the current slide
    vb = pg.locator(f"#{victim}").bounding_box(); pg.mouse.click(vb["x"] + vb["width"] / 2, vb["y"] + vb["height"] / 2); pg.wait_for_timeout(200)
    pg.keyboard.press("Backspace"); pg.wait_for_timeout(300)
    check("Backspace after a filmstrip click deletes the box, not the slide", pg.evaluate(f"slides.length === {n_slides} && !document.getElementById('{victim}')"))
    # ⌘B / ⌘I / ⌘U on a selected box and on a text selection while editing
    pg.click(".thumb >> nth=1"); pg.wait_for_timeout(200)
    pg.click("#ed-add-text"); pg.keyboard.type("styled"); pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    pg.keyboard.press("Meta+b"); pg.wait_for_timeout(150)
    check("⌘B bolds the selected box", pg.evaluate("[...sel][0].querySelector('.content').style.fontWeight") == "bold")
    pg.keyboard.press("Enter"); pg.wait_for_timeout(150); pg.keyboard.press("Meta+a"); pg.keyboard.press("Meta+i"); pg.wait_for_timeout(150)
    check("⌘I italicises the text selection while editing", pg.evaluate("!!editing && /italic/.test(editing.querySelector('.content').innerHTML + editing.querySelector('.content').style.fontStyle)"))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(150)
    pg.hover("#ed-undo"); pg.wait_for_timeout(100)
    tipped = pg.evaluate("(() => { const t = document.querySelector('.tip'); return t && [t.textContent, getComputedStyle(t).backgroundColor]; })()")
    icons = pg.evaluate("[...document.querySelectorAll('#ed-toolbar button')].filter(b => b.offsetWidth && !b.querySelector('.icon') && !b.classList.contains('text')).map(b => b.id)")
    check("toolbar shows icons with Slides-style tooltips", tipped == ["Undo (⌘Z)", "rgb(60, 64, 67)"] and not icons and not pg.query_selector("#ed-toolbar [title]"), f"{tipped} {icons}")
    film = pg.evaluate("""(() => { slides[0].dataset.visibility = 'hidden'; renderThumbs();
      const v = document.querySelector('.thumb-view').getBoundingClientRect();
      const out = [document.querySelector('#ed-side').offsetWidth, Math.round(v.width / v.height * 100), !!document.querySelector('.thumb .skipped')];
      delete slides[0].dataset.visibility; renderThumbs(); return out; })()""")
    check("filmstrip 200px, 16:9 thumbs, skipped eye", film == [200, 178, True], str(film))
    pg.click("#ed-menubar [data-menu=Arrange]")
    labels = pg.evaluate("[...document.querySelectorAll('.menu .menu-label')].map(e => e.textContent)")
    pg.hover("#ed-menubar [data-menu=Slide]")
    switched = pg.evaluate("[...document.querySelectorAll('.menu .menu-label')].map(e => e.textContent)")
    pg.keyboard.press("Escape")
    check("menu bar opens menus and switches on hover", "Order" in labels and "New slide" in switched and not pg.query_selector(".menu"), f"{labels} {switched}")
    pg.evaluate("thumbs.blur()"); pg.keyboard.press("Meta+a")   # Order's items need a selection (and canvas focus)
    pg.click("#ed-menubar [data-menu=Arrange]"); pg.keyboard.press("ArrowDown"); pg.keyboard.press("ArrowRight")
    sub = pg.evaluate("[document.querySelectorAll('.menu').length, document.activeElement.textContent, getComputedStyle(document.querySelector('.menu-item')).height]")
    pg.keyboard.press("Escape"); pg.keyboard.press("Escape"); pg.keyboard.press("Escape")
    check("menus: 36px rows, ▸ submenu by keyboard", sub[0] == 2 and "Bring to front" in sub[1] and sub[2] == "36px" and not pg.query_selector(".menu"), str(sub))
    pg.click("#ed-menubar [data-menu=Edit]")
    keys = pg.evaluate("Object.fromEntries([...document.querySelectorAll('.menu .menu-item')].map(r => [r.querySelector('.menu-label').textContent, r.querySelector('.menu-key').textContent]))")
    pg.keyboard.press("Escape")
    mb = pg.evaluate("(() => { const b = makeBox({x:100,y:100,w:400,h:200,shape:'rect'}); slides[cur].append(b); render(); sel = new Set([b]); drawOverlay(); return b.id; })()")
    pg.click("#ed-menubar [data-menu=Arrange]"); pg.hover(".menu-item:has-text('Center on page')"); pg.click(".menu-item:has-text('Horizontally')")
    pg.click("#ed-menubar [data-menu=Arrange]"); pg.hover(".menu-item:has-text('Rotate')"); pg.click(".menu-item:has-text('Rotate clockwise 90°')")
    ar = pg.evaluate(f"(() => {{ const b = document.getElementById('{mb}'); const g = geo(b); return [g.x + g.w / 2, rot(b)]; }})()")
    pg.evaluate(f"(() => {{ document.getElementById('{mb}').remove(); sel.clear(); render(); commit(); }})()")
    pg.click("#ed-menubar [data-menu=Slide]"); pg.click(".menu-item:has-text('Skip slide')")
    sk = pg.evaluate("[slides[cur].dataset.visibility, !!document.querySelector('.thumb.active .skipped')]")
    pg.click("#ed-menubar [data-menu=Slide]"); pg.click(".menu-item:has-text('Skip slide')")
    check("menus as Slides: Google key labels, Center on page, Rotate 90°, Skip slide",
          keys.get("Paste without formatting") == "⌘+Shift+V" and keys.get("Redo") == "⌘Y" and ar == [960, 90] and sk == ["hidden", True] and pg.evaluate("!slides[cur].dataset.visibility"), f"{keys} {ar} {sk}")
    pg.click("#ed-present-menu")
    check("Slideshow ▾ lists present options", pg.evaluate("[...document.querySelectorAll('.menu .menu-label')].map(e => e.textContent)") == ["Present from this slide", "Present from beginning", "Present fullscreen", "Presenter view", "Open in new tab", "Open as a scrolling page"])
    pg.keyboard.press("Escape")
    pg.evaluate("thumbs.blur()"); pg.keyboard.press("Meta+a")   # selection-only groups make the toolbar wide
    pg.set_viewport_size({"width": 760, "height": 900}); pg.wait_for_timeout(100)
    narrow = pg.evaluate("[!document.querySelector('#ed-more-wrap').hidden, document.querySelector('#ed-more-pop').children.length, document.querySelector('#ed-toolbar').scrollWidth <= document.querySelector('#ed-toolbar').clientWidth]")
    pg.set_viewport_size({"width": 1440, "height": 900}); pg.keyboard.press("Escape"); pg.wait_for_timeout(100)
    check("narrow window collapses toolbar groups into ⋯", narrow[0] and narrow[1] > 0 and narrow[2], str(narrow))
    pg.evaluate("addShape('ellipse')")
    pg.click("#ed-menubar [data-menu=Format]"); pg.click(".menu-item:has-text('Format options')")
    check("Format options sections start collapsed, as Slides", pg.evaluate("[...document.querySelectorAll('#ed-fmt details')].every(d => !d.open)"))
    pg.click("#ed-fmt summary:has-text('Size')"); pg.click("#ed-fmt summary:has-text('Position')")
    pg.fill("#ed-f-w", "2.5"); pg.press("#ed-f-w", "Enter")
    pg.click("#ed-f-lock"); pg.fill("#ed-f-w", "1.25"); pg.press("#ed-f-w", "Enter")
    pg.fill("#ed-f-rot", "30"); pg.press("#ed-f-rot", "Enter"); pg.click("#ed-f-fliph"); pg.click("#ed-fmt summary:has-text('Drop shadow')"); pg.click("#ed-f-shadow")
    pg.select_option("#ed-f-from", "c"); pg.fill("#ed-f-x", "5"); pg.press("#ed-f-x", "Enter")
    fo = pg.evaluate("(() => { const b = [...document.querySelectorAll('#ed-canvas .box[data-shape]')].pop(); return [b.style.width, b.style.height, b.style.transform, b.dataset.flip, 'shadow' in b.dataset, parseFloat(b.style.left) + parseFloat(b.style.width) / 2, getComputedStyle(b).scale]; })()")
    check("Format options (inches, as Slides): size, lock aspect, rotate, flip, shadow, position from centre", fo == ["240px", "200px", "rotate(30deg)", "h", True, 960, "-1 1"], str(fo))
    pg.fill("#ed-f-rot", "90"); pg.press("#ed-f-rot", "Enter")
    # map the local shadow offset through the box's actual rendered matrix (flip · rotate) and expect "straight down"
    sh = pg.evaluate("""(() => { const b = [...document.querySelectorAll('#ed-canvas .box[data-shape]')].pop();
      const x = parseFloat(b.style.getPropertyValue('--shx')), y = parseFloat(b.style.getPropertyValue('--shy'));
      const [sx, sy] = getComputedStyle(b).scale.split(' ').map(Number), m = new DOMMatrix(b.style.transform);
      const p = new DOMMatrix().scale(sx, sy ?? sx).multiply(m).transformPoint(new DOMPoint(x, y));
      return [Math.round(p.x), Math.round(p.y)]; })()""")
    check("shadow falls straight down the page on a rotated, flipped box", sh == [0, 6], str(sh))
    cur_e = pg.evaluate("document.querySelector('#ed-ui .handle[data-dir=e]').style.cursor")
    check("resize cursors turn with a rotated box", cur_e == "ns-resize", cur_e)
    ov = pg.evaluate("getComputedStyle(document.querySelector('#ed-ui .sel-box')).scale")
    check("selection outline mirrors a flipped box", ov == "-1 1", ov)
    pg.evaluate("document.activeElement.blur()"); pg.keyboard.press("Backspace")   # focus was in the X field
    pg.click("#ed-fmt-close"); pg.wait_for_timeout(1200)
    vis = pg.evaluate("""(() => { sel = new Set([boxes()[0]]); drawOverlay();
      const o = document.querySelector('#ed-ui .sel-box'), h = document.querySelector('#ed-ui .handle');
      const out = [Math.round(parseFloat(getComputedStyle(o).boxShadow.split(' ').at(-1)) * scale * 10) / 10, Math.round(h.getBoundingClientRect().width)];
      showGuides(500, null, { x: 400, y: 600, w: 200, h: 100 }, null, null, [{ x: 450, y: 300, w: 100, h: 200 }]);
      const gl = document.querySelector('#ed-guides .guide');
      out.push([document.querySelector('#ed-guides .measure-label') ? 'label' : 'none', Math.round(parseFloat(gl.style.top)), Math.round(parseFloat(gl.style.height))]);
      sel.clear(); drawOverlay(); showGuides(); return out; })()""")
    r0 = pg.locator("#ed-canvas .box >> nth=0").bounding_box()
    pg.mouse.move(r0["x"] + r0["width"] / 2, r0["y"] + r0["height"] / 2); pg.mouse.move(r0["x"] + r0["width"] / 2 + 2, r0["y"] + r0["height"] / 2); pg.wait_for_timeout(100)
    vis.append(pg.evaluate("!!document.querySelector('#ed-guides .hover-box')"))
    check("2px outline, 12px round handles, alignment line spans only the aligned boxes (no distance number), hover outline", vis == [2, 12, ["none", 300, 400], True], str(vis))
    pg.click("#ed-zoom"); pg.click(".menu-item:has-text('200%')")
    z2 = pg.evaluate("[scale, document.querySelector('#ed-stage').scrollWidth > document.querySelector('#ed-stage').clientWidth, document.querySelector('#ed-zoom').textContent.includes('200%')]")
    pg.keyboard.press("Meta+-"); z1 = pg.evaluate("scale")
    pg.keyboard.press("Meta+0")
    z0 = pg.evaluate("[document.querySelector('#ed-stage').scrollWidth <= document.querySelector('#ed-stage').clientWidth, document.querySelector('#ed-zoom').textContent.includes('Fit')]")
    check("zoom menu, ⌘− steps, ⌘0 fits; stage scrolls when zoomed", z2 == [1, True, True] and z1 == 0.75 and z0 == [True, True], f"{z2} {z1} {z0}")
    ids = pg.evaluate("""(() => { const a = makeBox({x:200,y:200,w:300,h:200,shape:'rect'}), b = makeBox({x:900,y:200,w:300,h:200,shape:'ellipse'});
      a.style.setProperty('--fill', '#cc0000'); a.dataset.shadow = ''; slides[cur].append(a, b); sel = new Set([a]); render(); commit(); return [a.id, b.id]; })()""")
    pg.click("#ed-paint-format")
    tb = pg.locator(f"#{ids[1]}").bounding_box(); pg.mouse.click(tb["x"] + tb["width"] / 2, tb["y"] + tb["height"] / 2)
    painted = pg.evaluate(f"(() => {{ const b = document.getElementById('{ids[1]}'); return [b.style.getPropertyValue('--fill'), 'shadow' in b.dataset, document.body.classList.contains('painting')]; }})()")
    check("paint format copies a box's style onto the clicked box", painted == ["#cc0000", True, False], str(painted))
    pg.evaluate("(() => { const t = boxes().find(b => !b.dataset.shape && !b.dataset.placeholder); sel = new Set([t]); drawOverlay(); updateToolbar(); })()")
    pg.click(".swatch[data-for=hilite]"); pg.click(".palette .cell[data-color='#ffff00']")
    hl = pg.evaluate("boxes().find(b => !b.dataset.shape && !b.dataset.placeholder).querySelector('.content').innerHTML")
    pg.click(".swatch[data-for=hilite]"); pg.click(".palette .transparent")
    hl0 = pg.evaluate("boxes().find(b => !b.dataset.shape && !b.dataset.placeholder).querySelector('.content').innerHTML")
    check("highlight color on a box, None removes it", "background-color: rgb(255, 255, 0)" in hl and "background" not in hl0, f"{hl} | {hl0}")
    pg.evaluate(f"(() => {{ ['{ids[0]}', '{ids[1]}'].forEach(id => document.getElementById(id).remove()); sel.clear(); render(); commit(); }})()")
    pg.wait_for_timeout(1200)   # let the save settle before later checks touch the file
    lid = pg.evaluate("(() => { const b = makeBox({x:200,y:300,w:700,h:300,html:'<ul><li>One</li><li>Two</li></ul>'}); slides[cur].append(b); render(); commit(); return b.id; })()")
    pg.evaluate(f"(() => {{ const b = document.getElementById('{lid}'); b.dataset.valign = 'top'; sel = new Set([b]); drawOverlay(); updateToolbar(); }})()")
    pg.click("#ed-align"); n_align = pg.evaluate("document.querySelectorAll('.align-pop .align-btn').length")
    pg.click(".align-pop .align-btn[data-v=justify]")
    j = pg.evaluate(f"document.querySelector('#{lid} .content').style.textAlign")
    pg.keyboard.press("Meta+Shift+e")
    c = pg.evaluate(f"document.querySelector('#{lid} .content').style.textAlign")
    pg.click("#ed-menubar [data-menu=Format]"); pg.hover(".menu-item:has-text('Text')"); pg.hover(".menu-item:has-text('Columns')"); pg.click(".menu-item:has-text('Two columns')")
    cols = pg.evaluate(f"[document.querySelector('#{lid} .content').style.columnCount, document.getElementById('{lid}').className]")
    check("Align popover (4+3), ⇧⌘E, two columns; boxes never get toolbar classes", n_align == 7 and j == "justify" and c == "center" and cols == ["2", "box"], f"{n_align} {j} {c} {cols}")
    pg.evaluate(f"(() => {{ const b = document.getElementById('{lid}'); delete b.dataset.valign; Object.assign(b.querySelector('.content').style, {{ textAlign: '', columnCount: '', columnGap: '' }}); commit(); }})()")
    pt = pg.evaluate(f"(() => {{ const t = document.querySelector('#{lid} li').firstChild, r = document.createRange(); r.setStart(t, 1); r.setEnd(t, 2); const q = r.getBoundingClientRect(); return [q.left + 1, q.top + q.height / 2]; }})()")
    pg.mouse.dblclick(*pt)   # on the "n" of "One"
    caret = pg.evaluate("[getSelection().isCollapsed, getSelection().anchorNode?.textContent, getSelection().anchorOffset]")
    pg.keyboard.press("Escape"); pg.keyboard.press("Escape")
    check("double-click puts the caret at the click, not select-all", caret[0] and caret[1] == "One" and 0 < caret[2] < 3, str(caret))
    pg.dblclick(f"#{lid} li >> nth=1"); pg.keyboard.press("End"); pg.keyboard.press("Tab")
    nested = pg.evaluate(f"!!document.querySelector('#{lid} ul ul, #{lid} li ul')")
    pg.keyboard.press("Shift+Tab")
    flat = pg.evaluate(f"!document.querySelector('#{lid} ul ul, #{lid} li ul')")
    pg.keyboard.press("Escape")
    pg.click("#ed-menubar [data-menu=Format]"); pg.hover(".menu-item:has-text('Bullets & numbering')"); pg.hover(".menu-item:has-text('Numbered list')")
    levels = pg.evaluate("document.querySelectorAll('.menu').length")
    pg.click(".menu-item:has-text('a.  b.  c.')")
    ol = pg.evaluate(f"document.querySelector('#{lid} ol')?.style.listStyleType")
    check("Tab / ⇧Tab nest and un-nest list items; numbered style a. b. c. from a 3-level menu", nested and flat and ol == "lower-alpha" and levels == 3, f"{nested} {flat} {ol} {levels}")
    pg.evaluate(f"(() => {{ document.getElementById('{lid}').remove(); sel.clear(); render(); commit(); }})()"); pg.wait_for_timeout(1200)
    sid = pg.evaluate("(() => { const b = makeBox({x:300,y:300,w:600,h:120,html:'A long caption that will not fit in a short box at forty pixels unless the text shrinks to fit it'}); slides[cur].append(b); sel = new Set([b]); render(); commit(); return b.id; })()")
    pg.click("#ed-menubar [data-menu=Format]"); pg.click(".menu-item:has-text('Format options')")
    pg.click("#ed-fmt summary:has-text('Text fitting')"); pg.click("#ed-f-fit input[value=shrink]")
    fit = pg.evaluate(f"""(() => {{ const b = document.getElementById('{sid}'), c = b.querySelector('.content'), z = +b.style.getPropertyValue('--fit');
      return [b.dataset.autofit, z, c.offsetHeight * z <= b.clientHeight + 1, parseFloat(b.style.height), cleanBox(b).getAttribute('style').includes('--fit')]; }})()""")
    check("Shrink text on overflow: text zooms down to fit, box keeps its size, --fit not saved", fit[0] == "shrink" and 0.2 < fit[1] < 1 and fit[2] and fit[3] == 120 and not fit[4], str(fit))
    pg.click("#ed-fmt-close")
    pg.evaluate("(() => { sel.clear(); render(); commit(); })()"); pg.wait_for_timeout(1200)   # keep the shrink box: the viewer checks it
    tbk = pg.evaluate("""(() => { const vis = q => !!document.querySelector(q)?.offsetParent, l = makeBox({x: 100, y: 100, w: 300, h: 0, shape: 'line'}), t = makeBox({x: 100, y: 300, w: 300, h: 80, html: 'hi'});
      slides[cur].append(l, t); render(); const out = [];
      for (const s of [[l], [t], [l, t]]) { sel = new Set(s); drawOverlay(); updateToolbar(); out.push([vis('#ed-font'), vis('.swatch[data-for=fill]'), vis('#ed-link'), vis('#ed-format-options')].map(Number).join('')); }
      l.remove(); t.remove(); sel.clear(); render(); updateToolbar(); return out; })()""")
    check("toolbar follows the selection as Slides: lines/images and mixed selections drop text and fill controls", tbk == ["0011", "1110", "0011"], str(tbk))
    mot = pg.evaluate("""(() => { sel.clear(); drawOverlay(); updateToolbar(); setTransPanel(true); const s = slides[cur], t = s.dataset.transition, a = [];
      const st = () => [$('#ed-anim-add').innerText.replace('add', '').trim(), $('#ed-anim-play').disabled, !!$('#ed-t-speed').offsetParent].join('|');
      delete s.dataset.transition; renderAnims(); a.push(st()); s.dataset.transition = 'fade'; renderAnims(); a.push(st());
      if (t) s.dataset.transition = t; else delete s.dataset.transition; setTransPanel(false); return a; })()""")
    check("Motion panel empty states as Slides: 'Select an object to animate', Play greyed and no speed for None", mot[0].startswith("Select an object to animate|") and mot[0].endswith("|false") and mot[1].endswith("|false|true"), str(mot))
    ids = pg.evaluate("""(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1);
      const bs = [100, 500, 935].map((x, i) => makeBox({x, y: 400, w: 200, h: i === 2 ? 150 : 200, shape: 'rect'})); s.append(...bs); sel.clear(); render(); return bs.map(b => b.id); })()""")
    def ctr(i):
        r = pg.evaluate(f"(() => {{ const r = document.getElementById('{ids[i]}').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, r.right, r.bottom]; }})()")
        return r
    c = ctr(2); pg.mouse.move(c[0], c[1]); pg.mouse.down(); sc = pg.evaluate("scale"); pg.mouse.move(c[0] - 31 * sc, c[1] + 3, steps=4)
    mid = pg.evaluate("document.querySelectorAll('#ed-guides .space').length")
    pg.mouse.up(); x2 = pg.evaluate(f"parseFloat(document.getElementById('{ids[2]}').style.left)")
    h = pg.locator(".handle[data-dir=s]").bounding_box(); pg.mouse.move(h["x"] + h["width"] / 2, h["y"] + h["height"] / 2); pg.mouse.down()
    pg.mouse.move(h["x"] + h["width"] / 2, h["y"] + h["height"] / 2 + 52 * pg.evaluate("scale"), steps=4)
    size = pg.evaluate("document.querySelectorAll('#ed-guides .space').length"); pg.mouse.up()
    h2 = pg.evaluate(f"parseFloat(document.getElementById('{ids[2]}').style.height)")
    pg.evaluate("(() => { slides.pop(); go(slides.length - 1); commit(); })()")
    check("smart guides: equal spacing snaps the third box and draws teal gap brackets; equal size snaps a resize", x2 == 900 and mid >= 6 and h2 == 200 and size >= 6, f"x={x2} brackets={mid} h={h2} size marks={size}")
    ad = pg.evaluate("""(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1);
      const bs = [[100, 100, 200], [700, 300, 100], [1500, 500, 300]].map(([x, y, w]) => makeBox({x, y, w, h: 100, shape: 'rect'})); s.append(...bs); render();
      sel = new Set(bs); alignSel('v', 0); const top = bs.map(b => parseFloat(b.style.top)).join();
      bs[1].style.left = '400px'; distributeSel('h'); const left = bs.map(b => parseFloat(b.style.left)).join();
      sel = new Set([bs[0]]); alignSel('h', 1); const one = parseFloat(bs[0].style.left);
      slides.pop(); go(slides.length - 1); commit(); return [top, left, one]; })()""")
    check("Arrange → Align (selection, or slide for one object) and Distribute", ad == ["100,100,100", "100,850,1500", 1720], str(ad))
    pg.evaluate("""(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1);
      s.append(...[100, 500].map(x => makeBox({x, y: 300, w: 200, h: 100, shape: 'rect'}))); sel = new Set(boxes()); render(); drawOverlay(); })()""")
    gb = pg.evaluate("[document.querySelectorAll('#ed-ui .sel-box.thin').length, document.querySelectorAll('#ed-ui .sel-wrap > .handle').length, !!document.querySelector('#ed-ui .handle.rotate')]")
    h = pg.locator("#ed-ui .handle[data-dir=e]").bounding_box(); sc = pg.evaluate("scale")
    pg.mouse.move(h["x"] + h["width"] / 2, h["y"] + h["height"] / 2); pg.mouse.down(); pg.mouse.move(h["x"] + h["width"] / 2 + 600 * sc, h["y"] + h["height"] / 2, steps=4); pg.mouse.up()
    gr = pg.evaluate("boxes().map(b => [parseFloat(b.style.left), parseFloat(b.style.width)].map(Math.round).join('/')).join(' ')")
    pg.evaluate("(() => { slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); })()")
    check("multi-selection: one box with handles around the selection (thin outlines per object) resizes them together", gb == [2, 8, False] and gr == "100/400 900/400", f"{gb} {gr}")
    grp = pg.evaluate("""(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1);
      const a = makeBox({x: 100, y: 100, w: 200, h: 100, shape: 'rect'}), b = makeBox({x: 500, y: 300, w: 100, h: 100, html: 'hi'}); s.append(a, b); sel = new Set([a, b]); render(); return [a.id, b.id]; })()""")
    pg.keyboard.press("Meta+Alt+g")
    g1 = pg.evaluate("(() => { const g = boxes()[0]; return [boxes().length, g.classList.contains('group'), g.style.cssText.match(/left: [\\d.]+px; top: [\\d.]+px; width: [\\d.]+px; height: [\\d.]+px/)[0], g.children.length, [...sel][0] === g, document.querySelectorAll('#ed-ui .sel-box.thin').length]; })()")
    c = pg.evaluate("(() => { const r = document.getElementById('%s').getBoundingClientRect(); return [r.x + 5, r.y + 5]; })()" % grp[1])
    pg.keyboard.press("Escape"); pg.mouse.click(c[0], c[1]); clicked = pg.evaluate("[...sel][0]?.classList.contains('group')")
    pg.evaluate("(() => { const g = boxes()[0]; setGeo(g, { ...geo(g), w: 1000, h: 600 }); })()")
    pg.keyboard.press("Meta+Alt+Shift+g")
    g2 = pg.evaluate("boxes().map(b => [b.style.left, b.style.top, b.style.width].join(' ')).join(' | ') + ' ' + sel.size")
    pg.evaluate("(() => { slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); })()")
    check("Group ⌥⌘G / Ungroup ⇧⌥⌘G: one box.group around the selection, clicks pick the group, resizing scales members",
          g1 == [1, True, "left: 100px; top: 100px; width: 500px; height: 300px", 2, True, 2] and clicked and g2 == "100px 100px 400px | 900px 500px 200px 2", f"{g1} {clicked} {g2}")
    bid = pg.evaluate("""(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1); const b = makeBox({x: 600, y: 300, w: 400, h: 200, html: 'ctx'}); s.append(b); sel.clear(); render(); return b.id; })()""")
    labels = lambda: pg.evaluate("[...document.querySelectorAll('.menu .menu-label')].map(e => e.textContent)")
    pg.click("#" + bid, button="right"); on_box = labels(); boxsel = pg.evaluate(f"[...sel][0]?.id === '{bid}'")
    pg.keyboard.press("Escape")
    fr = pg.locator("#ed-frame").bounding_box(); pg.mouse.click(fr["x"] + 20, fr["y"] + fr["height"] - 20, button="right"); on_slide = labels(); pg.keyboard.press("Escape")
    pg.click(".thumb >> nth=-1", button="right"); on_thumb = labels(); pg.keyboard.press("Escape")
    pg.evaluate("(() => { closeMenu(); slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); })()")
    check("right-click menus as Slides: object (Cut…Edit text…Order…Format options), empty slide (Change background, Transition), filmstrip (New slide, Duplicate, Skip)",
          boxsel and {"Cut", "Edit text", "Alt text", "Order", "Rotate", "Center on page", "Animate", "Format options"} <= set(on_box)
          and {"Paste", "Change background", "Transition"} <= set(on_slide) and "Edit text" not in on_slide
          and {"New slide", "Duplicate slide", "Skip slide", "Change background"} <= set(on_thumb), f"{on_box} | {on_slide} | {on_thumb}")
    ids = pg.evaluate("""(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1);
      const bs = [100, 500, 900].map(x => makeBox({x, y: 300, w: 200, h: 100, shape: 'rect'})); s.append(...bs); sel = new Set([bs[0]]); render(); return bs.map(b => b.id); })()""")
    pg.locator("#ed-stage").focus(); order = []
    for key in ["Tab", "Tab", "Tab", "Shift+Tab"]:
        pg.keyboard.press(key); order.append(ids.index(pg.evaluate("[...sel][0].id")))
    pg.evaluate("(() => { slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); })()")
    check("Tab / ⇧Tab select the next / previous object on the slide, wrapping", order == [1, 2, 0, 2], str(order))
    ids = pg.evaluate("""(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1);
      const a = makeBox({x: 200, y: 200, w: 200, h: 200, shape: 'rect'}), t = makeBox({x: 600, y: 250, w: 300, h: 100, html: 'member'}); s.append(a, t);
      sel = new Set([a, t]); render(); groupSel(); return [a.id, t.id, boxes()[0].id]; })()""")
    box = lambda i: pg.evaluate("(() => { const r = document.getElementById('%s').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()" % ids[i])
    c = box(0); pg.mouse.dblclick(c[0], c[1]); entered = pg.evaluate("[[...sel][0]?.id, !!document.querySelector('#ed-ui .sel-box.scope')]")
    ol = pg.evaluate("(() => { const o = document.querySelector('#ed-ui .sel-wrap').getBoundingClientRect(), r = document.getElementById('%s').getBoundingClientRect(); return Math.abs(o.x - r.x) < 2 && Math.abs(o.y - r.y) < 2; })()" % ids[0])
    sc = pg.evaluate("scale"); pg.mouse.move(c[0], c[1]); pg.mouse.down(); pg.mouse.move(c[0] - 100 * sc, c[1], steps=4); pg.mouse.up()
    moved = pg.evaluate("(() => { const g = document.getElementById('%s'), a = document.getElementById('%s'); return [g.style.left, g.style.width, a.style.left]; })()" % (ids[2], ids[0]))
    pg.keyboard.press("Escape"); out = pg.evaluate("[[...sel][0]?.id, scope]")
    pg.evaluate("(() => { slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); })()")
    check("double-click enters a group to pick one member (outline lines up), moving it refits the group, Esc goes back to the group",
          entered == [ids[0], True] and ol and moved == ["100px", "800px", "0px"] and out == [ids[2], None], f"{entered} {ol} {moved} {out}")
    off = pg.evaluate("""(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1); const b = makeBox({x: W + 700, y: H + 300, w: 300, h: 200, shape: 'rect'}); s.append(b);
      sel.clear(); render(); commit(); setZoom(2); const st = $('#ed-stage'); st.scrollLeft = st.scrollWidth; st.scrollTop = st.scrollHeight;
      const r = b.getBoundingClientRect(), sr = st.getBoundingClientRect(); return [b.id, r.right <= sr.right + 1 && r.bottom <= sr.bottom + 1 && r.left >= sr.left]; })()""")
    t0 = pg.evaluate("performance.now()"); pg.evaluate("zoomToContent()"); zc_ms = pg.evaluate(f"Math.round(performance.now() - {t0})")
    seen = pg.evaluate(f"""(() => {{ const sr = $('#ed-stage').getBoundingClientRect(), inside = r => r.left >= sr.left - 1 && r.right <= sr.right + 1 && r.top >= sr.top - 1 && r.bottom <= sr.bottom + 1;
      const out = [inside(document.getElementById('{off[0]}').getBoundingClientRect()), inside($('#ed-frame').getBoundingClientRect())];
      setZoom(null); slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); return [...out, $('#ed-frame').style.marginLeft || 'auto']; }})()""")
    check(f"extended canvas: zoomed in, the stage scrolls to an object off the slide; View → Zoom to fit content shows it and the slide ({zc_ms} ms)",
          off[1] and seen == [True, True, "auto"], f"{off} {seen}")
    pg.evaluate("go(0)"); pg.click("#ed-menubar [data-menu=Slide]"); pg.click(".menu-item:has(.menu-label:text-is('Go to slide'))")
    pg.fill("#ed-goto-n", "2"); t0 = pg.evaluate("performance.now()"); pg.keyboard.press("Enter")
    went = pg.evaluate(f"[cur, $('#ed-gotodlg').hidden, Math.round(performance.now() - {t0})]")
    pg.keyboard.press("Control+Meta+g"); pg.fill("#ed-goto-n", "999"); pg.keyboard.press("Enter"); far = pg.evaluate("cur === slides.length - 1"); pg.evaluate("go(0)")
    check(f"Slide → Go to slide (⌃⌘G): a number, ⏎, there ({went[2]} ms); past the end goes to the last", went[:2] == [1, True] and far, f"{went} {far}")
    ids = pg.evaluate("""(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1);
      const a = makeBox({x: 200, y: 200, w: 300, h: 150, html: 'locked'}), b = makeBox({x: 700, y: 200, w: 200, h: 150, shape: 'rect'}); s.append(a, b);
      sel = new Set([a]); render(); updateToolbar(); return [a.id, b.id]; })()""")
    pg.click("#ed-menubar [data-menu=Arrange]"); t0 = pg.evaluate("performance.now()"); pg.click(".menu-item:has(.menu-label:text-is('Lock'))")
    lock_ms = pg.evaluate(f"Math.round(performance.now() - {t0})")
    c = box(0); sc = pg.evaluate("scale"); pg.mouse.move(c[0], c[1]); pg.mouse.down(); pg.mouse.move(c[0] + 100 * sc, c[1], steps=4); pg.mouse.up()
    pg.locator("#ed-stage").focus(); pg.keyboard.press("ArrowRight"); pg.keyboard.press("Delete"); pg.mouse.dblclick(c[0], c[1])
    held = pg.evaluate("""(() => { const a = document.getElementById('%s'); return [a.isConnected, a.style.left, !!editing, !!document.querySelector('#ed-ui .sel-wrap.locked .handle'),
      !document.querySelector('#ed-ui .handle.rotate'), getComputedStyle(document.querySelector('#ed-ui .sel-wrap.locked .handle')).pointerEvents]; })()""" % ids[0])
    pg.keyboard.press("Escape"); pg.mouse.move(c[0] - 200 * sc, c[1] - 150 * sc); pg.mouse.down(); pg.mouse.move(c[0] + 700 * sc, c[1] + 150 * sc, steps=4); pg.mouse.up()
    marq = pg.evaluate("[...sel].map(b => b.id)")
    pg.mouse.click(c[0], c[1], button="right"); rmenu = pg.evaluate("[...document.querySelectorAll('.menu .menu-label')].map(e => e.textContent)"); pg.keyboard.press("Escape")
    pg.wait_for_timeout(700); saved = 'data-locked' in deck.read_text()
    pg.evaluate("closeMenu()"); pg.mouse.click(c[0], c[1]); pg.click("#ed-menubar [data-menu=Arrange]"); pg.click(".menu-item:has(.menu-label:text-is('Unlock'))")
    pg.mouse.move(c[0], c[1]); pg.mouse.down(); pg.mouse.move(c[0] + 100 * sc, c[1], steps=4); pg.mouse.up()
    freed = pg.evaluate("(() => { const a = document.getElementById('%s'); return [a.hasAttribute('data-locked'), a.style.left]; })()" % ids[0])
    pg.evaluate("(() => { slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); })()")
    check(f"Arrange → Lock ({lock_ms} ms): grey handles that don't drag, no move / nudge / delete / text editing, a drag-select passes over it, saved; right-click offers Unlock, which frees it",
          held == [True, "200px", False, True, True, "none"] and marq == [ids[1]] and "Unlock" in rmenu and saved and freed == [False, "300px"], f"{held} {marq} {rmenu} {saved} {freed}")
    pg.click("#ed-menubar [data-menu=View]"); pg.hover(".menu-item:has-text('Guides')"); pg.click(".menu-item:has-text('Add vertical guide')")
    rule = pg.locator("#ed-rules .rule.v").bounding_box(); sc = pg.evaluate("scale")
    pg.mouse.move(rule["x"] + rule["width"] / 2, rule["y"] + 200); pg.mouse.down(); pg.mouse.move(rule["x"] + rule["width"] / 2 + 300 * sc, rule["y"] + 200, steps=4); pg.mouse.up()
    gd = pg.evaluate("deckDoc.querySelector('.slides').dataset.guides")
    bid = pg.evaluate("""(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1); const b = makeBox({x: 1250, y: 400, w: 200, h: 100, shape: 'rect'}); s.append(b); sel.clear(); render(); return b.id; })()""")
    c = pg.evaluate("(() => { const r = document.getElementById('%s').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()" % bid)
    pg.mouse.move(c[0], c[1]); pg.mouse.down(); pg.mouse.move(c[0] + 2, c[1] + 95 * sc, steps=3); pg.mouse.move(c[0] + 8 * sc, c[1] + 100 * sc, steps=2); pg.mouse.up()
    snapped = pg.evaluate("parseFloat(document.getElementById('%s').style.left)" % bid)
    pg.wait_for_timeout(700); saved = 'data-guides="v1260"' in deck.read_text()
    pg.keyboard.press("Control+Meta+e"); pg.keyboard.press("Control+Meta+g"); hidden = pg.evaluate("document.querySelectorAll('#ed-rules .rule').length")
    pg.keyboard.press("Control+Meta+e"); pg.keyboard.press("Control+Meta+g")
    pg.evaluate("(() => { slides.pop(); go(slides.length - 1); setGuides([]); sel.clear(); render(); commit(); })()")
    check("View → Guides: add, drag, saved as data-guides, objects snap to them, ⌃⌘E ⌃⌘G hides", gd == "v1260" and snapped == 1260 and saved and hidden == 0, f"{gd} {snapped} {saved} {hidden}")
    shp = pg.evaluate("""(() => { const names = ['parallelogram','trapezoid','pentagon','hexagon','octagon','star','plus','cloud','chevron','callout','roundcallout','leftarrow','uparrow','downarrow','leftrightarrow','updownarrow','quadarrow','bentarrow','uturnarrow','notchedarrow','curvedarrow','curvedleftarrow','curveduparrow','curveddownarrow','leftrightuparrow','leftuparrow','bentuparrow','stripedarrow','homeplate','rightarrowcallout','leftarrowcallout','uparrowcallout','downarrowcallout','leftrightarrowcallout','quadarrowcallout','circulararrow','explosion1','explosion2','star4','star6','star7','star8','star10','star12','star16','star24','star32','ribbonup','ribbon','curvedribbonup','curvedribbon','vscroll','hscroll','wave','doublewave','ovalcallout','cloudcallout','minus','multiply','divide','equal','notequal','brackets','braces','leftbracket','rightbracket','leftbrace','rightbrace','snip1rect','snip2samerect','snip2diagrect','sniproundrect','round1rect','round2samerect','round2diagrect','rttriangle','heptagon','decagon','dodecagon','pie','arc','teardrop','chord','frame','halfframe','corner','diagstripe','cross','plaque','can','cube','bevel','donut','nosmoking','blockarc','foldedcorner','smileyface','heart','lightningbolt','sun','moon','flow-process','flow-alternateprocess','flow-decision','flow-inputoutput','flow-predefinedprocess','flow-internalstorage','flow-document','flow-multidocument','flow-terminator','flow-preparation','flow-manualinput','flow-manualoperation','flow-connector','flow-offpageconnector','flow-punchedcard','flow-punchedtape','flow-summingjunction','flow-or','flow-collate','flow-sort','flow-extract','flow-merge','flow-onlinestorage','flow-delay','flow-magnetictape','flow-magneticdisk','flow-magneticdrum','flow-display'];
      return names.filter(n => { const b = makeBox({x: 0, y: 0, w: 300, h: 200, shape: n}); renderShape(b); const f = b.querySelector('svg.shape .f');
        return !f || !(f.getAttribute('points') || f.getAttribute('d')) || /NaN|undefined/.test(f.outerHTML); }); })()""")
    in_menu = pg.evaluate("shapeItems().flatMap(g => g.items()).map(i => i.label).filter(l => ['Parallelogram', '5-point star', 'Cloud', 'Rounded rectangular callout'].includes(l)).length")
    check("more shapes (parallelogram … cloud, callouts) draw cleanly and are in the shape menu", shp == [] and in_menu == 4, f"broken={shp} menu={in_menu}")
    lid = pg.evaluate("""(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1); const b = makeBox({x: 200, y: 300, w: 800, h: 0, shape: 'line'}); s.append(b); sel = new Set([b]); render(); updateToolbar(); return b.id; })()""")
    vis = pg.evaluate("[!!$('#ed-lstart').offsetParent, !!$('#ed-lend').offsetParent, !!$('#ed-dash').offsetParent]")
    pg.click("#ed-dash"); pg.click(".menu-item[data-label='Dash-dot']")
    pg.click("#ed-lend"); pg.click(".menu-item[data-label='Filled arrow']")
    pg.click("#ed-lstart"); pg.click(".menu-item[data-label='Open circle']")
    ln = pg.evaluate("""(() => { const b = document.getElementById('%s'); return [b.dataset.dash, b.dataset.start, b.dataset.end,
      b.querySelector('svg .l').getAttribute('stroke-dasharray'), b.querySelectorAll('svg .h').length, b.querySelectorAll('svg circle.l').length]; })()""" % lid)
    pg.evaluate("(() => { slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); })()")
    check("lines: dash style and start/end markers from the toolbar (data-dash / data-start / data-end), drawn by shapes.js",
          vis == [True, True, True] and ln[:3] == ["dashdot", "open-circle", "fill-arrow"] and ln[3] and ln[4] == 1 and ln[5] == 1, f"{vis} {ln}")
    lid = pg.evaluate("""(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1); const b = makeBox({x: 200, y: 300, w: 800, h: 0, shape: 'arrowline'}); s.append(b); sel = new Set([b]); render(); return b.id; })()""")
    h = pg.locator("#ed-ui .handle[data-dir=se]").bounding_box(); fr = pg.locator("#ed-frame").bounding_box(); sc = pg.evaluate("scale")
    pg.mouse.move(h["x"] + h["width"] / 2, h["y"] + h["height"] / 2); pg.mouse.down(); pg.mouse.move(fr["x"] + 100 * sc, fr["y"] + 600 * sc, steps=6); pg.mouse.up()
    le = pg.evaluate("""(() => { const b = document.getElementById('%s'); return [Math.round(parseFloat(b.style.left)), Math.round(parseFloat(b.style.top)), Math.round(parseFloat(b.style.width)), Math.round(parseFloat(b.style.height)), b.dataset.dir || '', b.dataset.start || '', b.dataset.end || '', b.dataset.shape]; })()""" % lid)
    pg.evaluate("(() => { slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); })()")
    check("dragging a line end moves only that end, swinging past the other (arrowhead stays on its end)", le == [100, 300, 100, 300, "up", "fill-arrow", "", "line"], str(le))
    con = pg.evaluate("""(() => { const out = []; for (const sh of ['elbow', 'curve']) { addShape(sh); const b = [...sel][0];
      b.dataset.end = 'fill-arrow'; renderShape(b); const d = b.querySelector('svg .l').getAttribute('d');
      out.push([b.dataset.shape, isLine(b), /^M[^LC]+(L.+L.+L|C)/.test(d), b.querySelectorAll('svg .h').length, document.querySelectorAll('#ed-ui .handle').length]); b.remove(); }
      sel.clear(); render(); commit(); return out; })()""")
    check("elbow and curved connectors (Line menu): drawn corner to corner, horizontal ends, markers, two end handles (+ a bend handle)", con == [["elbow", True, True, 1, 3], ["curve", True, True, 1, 3]], str(con))
    rid = pg.evaluate("""(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1); const b = makeBox({x: 400, y: 300, w: 600, h: 400, shape: 'roundrect'}); s.append(b); sel = new Set([b]); render(); return b.id; })()""")
    a = pg.locator("#ed-ui .handle.adjust").bounding_box(); sc = pg.evaluate("scale")
    pg.mouse.move(a["x"] + a["width"] / 2, a["y"] + a["height"] / 2); pg.mouse.down(); pg.mouse.move(a["x"] + a["width"] / 2 + 50 * sc, a["y"] + 30, steps=4); pg.mouse.up()
    ad = pg.evaluate("(() => { const b = document.getElementById('%s'); return [+b.dataset.adj, Math.round(+b.querySelector('svg path').getAttribute('d').match(/A([\\d.]+)/)[1]), !!shapeAdjust(makeBox({x: 0, y: 0, w: 100, h: 100, shape: 'ellipse'}))]; })()" % rid)
    pg.evaluate("(() => { slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); })()")
    check("yellow adjust handle sets a shape's corner radius (data-adj = OOXML adj, of the shorter side), along the top edge", abs(ad[0] - 0.292) < 0.004 and abs(ad[1] - 117) <= 1 and not ad[2], str(ad))
    op = pg.evaluate("""(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1);
      const r = makeBox({x: 100, y: 100, w: 400, h: 300, shape: 'rect'}); r.style.setProperty('--fill', '#ff0000');
      const im = makeBox({x: 800, y: 100, w: 400, h: 300, cls: 'image', html: '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">'}); s.append(r, im); sel = new Set([r]); render(); return [r.id, im.id]; })()""")
    pg.click(".swatch[data-for=fill]"); pg.locator(".palette-alpha input").fill("40"); pg.keyboard.press("Escape")
    pg.evaluate("(() => { sel = new Set([document.getElementById('%s')]); drawOverlay(); updateToolbar(); setPanel(true); })()" % op[1])
    vis = pg.evaluate("!!document.querySelector('#ed-fmt details.img-only').offsetParent")
    pg.click("#ed-fmt summary:has-text('Adjustments')"); pg.fill("#ed-f-opacity-n", "30"); pg.press("#ed-f-opacity-n", "Enter")
    res = pg.evaluate("(() => [document.getElementById('%s').style.getPropertyValue('--fill'), document.getElementById('%s').querySelector('img').style.opacity, toHex('#ff000099', '#000')])()" % (op[0], op[1]))
    pg.fill("#ed-f-adj-exposure-n", "40"); pg.press("#ed-f-adj-exposure-n", "Enter"); pg.fill("#ed-f-adj-temperature-n", "-30"); pg.press("#ed-f-adj-temperature-n", "Enter")
    t0 = pg.evaluate("performance.now()"); pg.evaluate("(() => { const f = $('#ed-f-adj-contrast'); f.value = '25'; f.dispatchEvent(new Event('input')); })()"); adj_ms = pg.evaluate(f"Math.round(performance.now() - {t0})")
    adj = pg.evaluate("""(() => { const b = document.getElementById('%s'), img = b.querySelector('img'), c = cleanBox(b);
      return [b.dataset.adjust, /url\\(.#adj-/.test(img.style.filter), b.querySelectorAll('svg.adj feComponentTransfer, svg.adj feColorMatrix').length, !c.querySelector('svg.adj') && !c.querySelector('img').style.filter]; })()""" % op[1])
    pg.click("#ed-f-adj-reset"); reset = pg.evaluate("(() => { const b = document.getElementById('%s'); return [b.dataset.adjust ?? '', !!b.querySelector('svg.adj'), b.querySelector('img').style.opacity, $('#ed-f-adj-exposure').value]; })()" % op[1])
    check(f"image adjustments (Keynote's Exposure … Tint) in Format options → Adjustments: data-adjust, an SVG filter drawn live ({adj_ms} ms), never saved; Reset clears them",
          adj == ["exposure:40 contrast:25 temperature:-30", True, 3, True] and reset == ["", False, "", "0"], f"{adj} {reset}")
    pg.evaluate("(() => { setPanel(false); slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); })()")
    check("fill transparency (palette slider, #rrggbbaa) and image opacity (Format options → Adjustments)", vis and res == ["#ff000099", "0.3", "#ff0000"], f"{vis} {res}")
    gid = pg.evaluate("""(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1); const r = makeBox({x: 100, y: 100, w: 400, h: 300, shape: 'rect'}), tx = makeBox({x: 700, y: 100, w: 400, h: 200, html: 'grad'});
      s.append(r, tx); sel = new Set([r]); render(); updateToolbar(); return [r.id, tx.id]; })()""")
    pg.click(".swatch[data-for=fill]"); pg.click(".palette-tabs button[data-t=gradient]"); pg.locator(".menu.palette").screenshot(path=str(HERE / "gradient-palette.png"))
    t0 = pg.evaluate("performance.now()"); pg.click(".grad-pane .cells .cell >> nth=4"); gr_ms = pg.evaluate(f"Math.round(performance.now() - {t0})")
    g1 = pg.evaluate(f"(() => {{ const b = document.getElementById('{gid[0]}'), f = b.querySelector('svg.shape .f'); return [b.dataset.gradient, /url\\(.#gr-/.test(f.style.fill), b.querySelectorAll('svg.shape linearGradient stop').length]; }})()")
    pg.click(".swatch[data-for=fill]"); pg.select_option(".grad-custom .gk", "radial"); pg.keyboard.press("Escape")
    g2 = pg.evaluate(f"document.getElementById('{gid[0]}').dataset.gradient.split(' ')[0] + ' ' + !!document.getElementById('{gid[0]}').querySelector('radialGradient')")
    pg.evaluate(f"(() => {{ sel = new Set([document.getElementById('{gid[1]}')]); render(); updateToolbar(); }})()")
    pg.click(".swatch[data-for=fill]"); pg.click(".palette-tabs button[data-t=gradient]"); pg.click(".grad-pane .cells .cell >> nth=0")
    g3 = pg.evaluate(f"(() => {{ const b = document.getElementById('{gid[1]}'); return [getComputedStyle(b).backgroundImage.startsWith('linear-gradient'), !cleanBox(b).style.getPropertyValue('--grad')]; }})()")
    pg.click(".swatch[data-for=fill]"); pg.click(".palette-tabs button[data-t=solid]"); pg.click(".palette .cells.std .cell >> nth=1")
    g4 = pg.evaluate(f"[document.getElementById('{gid[1]}').dataset.gradient ?? '', getComputedStyle(document.getElementById('{gid[1]}')).backgroundImage]")
    tiny_png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR42mP8z8DAwMDAxAAFAA8JAQXc2aaYAAAAAElFTkSuQmCC"
    pg.evaluate(f"(() => {{ sel = new Set([document.getElementById('{gid[0]}')]); render(); updateToolbar(); }})()")
    pg.click(".swatch[data-for=fill]"); pg.click(".palette-tabs button[data-t=image]"); itab = pg.evaluate("[...document.querySelectorAll('.img-fill .fs option')].map(o => o.textContent)")
    pg.keyboard.press("Escape")
    t0 = pg.evaluate("performance.now()"); pg.evaluate(f"(() => {{ setFillImage('{tiny_png}', 'tile'); commit(); }})()"); fi_ms = pg.evaluate(f"Math.round(performance.now() - {t0})"); pg.wait_for_timeout(200)
    f1 = pg.evaluate(f"(() => {{ const b = document.getElementById('{gid[0]}'), p = b.querySelector('svg.shape pattern'); return [b.dataset.fillScale, !b.dataset.gradient, !!p && /url\\(.#fi-/.test(b.querySelector('svg.shape .f').style.fill), p?.getAttribute('width')]; }})()")
    pg.evaluate(f"(() => {{ sel = new Set([document.getElementById('{gid[1]}')]); setFillImage('{tiny_png}', 'fit'); commit(); }})()")
    f2 = pg.evaluate(f"(() => {{ const b = document.getElementById('{gid[1]}'), cs = getComputedStyle(b); return [cs.backgroundImage.startsWith('url('), cs.backgroundSize, !cleanBox(b).style.getPropertyValue('--fimg')]; }})()")
    check(f"Fill colour → Image, as Keynote's Image Fill ({fi_ms} ms): Scale to fill / fit / Stretch / Tile / Original size; a shape tiles it at the picture's size, a text box fits it; derived CSS not saved",
          itab == ["Scale to fill", "Scale to fit", "Stretch", "Tile", "Original size"] and f1 == ["tile", True, True, "2"] and f2[0] and f2[1].startswith("contain") and f2[2], f"{itab} {f1} {f2}")
    pg.evaluate(f"(() => {{ sel.clear(); render(); slides[cur].dataset.backgroundImage = '{tiny_png}'; render(); showBgDialog(true); }})()")
    pg.select_option("#ed-bg-size", "auto repeat"); pg.fill("#ed-bg-opacity", "50"); pg.dispatch_event("#ed-bg-opacity", "input"); pg.dispatch_event("#ed-bg-opacity", "change")
    pg.fill("#ed-bg-tint", "#ff0000"); pg.dispatch_event("#ed-bg-tint", "input")
    pg.locator("#ed-bgdlg .dialog").screenshot(path=str(HERE / "background-dialog.png"))
    b1 = pg.evaluate("(() => { const d = slides[cur].dataset, cs = getComputedStyle($('#ed-frame')); return [d.backgroundRepeat, d.backgroundSize, d.backgroundOpacity, d.backgroundTint, cs.backgroundImage.split('gradient').length - 1, cs.backgroundRepeat]; })()")
    pg.click("#ed-bg-color"); pg.click(".palette-tabs button[data-t=gradient]"); notab = pg.evaluate("!document.querySelector('.palette-tabs [data-t=image]')"); pg.click(".grad-pane .cells .cell >> nth=12")
    b2 = pg.evaluate("(() => { const d = slides[cur].dataset; return [d.backgroundGradient?.startsWith('radial-gradient(circle, #'), !d.backgroundImage, !d.backgroundTint, getComputedStyle($('#ed-frame')).backgroundImage.startsWith('radial-gradient')]; })()")
    pg.evaluate("showBgDialog(false)")
    check("Change background: a picture's scale (Tile), opacity and tint as Keynote's; a gradient from the colour menu's Gradient tab (no Image tab), which replaces the picture",
          b1 == ["repeat", "auto", "0.5", "#ff000066", 2, "no-repeat, no-repeat, repeat"] and notab and b2 == [True, True, True, True], f"{b1} {notab} {b2}")
    pg.evaluate("(() => { slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); })()")
    check(f"Fill colour → Gradient, as Slides ({gr_ms} ms): presets and a custom radial on a shape (SVG gradient), a text box (CSS, derived --grad not saved); a solid colour removes it",
          g1[0].startswith("linear 180") and g1[1:] == [True, 2] and g2 == "radial true" and g3 == [True, True] and g4 == ["", "none"], f"{g1} {g2} {g3} {g4}")
    sh = pg.evaluate("""(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1); const b = makeBox({x: 600, y: 300, w: 400, h: 200, shape: 'rect'});
      s.append(b); setRot(b, 90); b.dataset.flip = 'h'; sel = new Set([b]); render(); setPanel(true); return b.id; })()""")
    pg.evaluate("$('#ed-f-shadow').closest('details').open = true")
    pg.fill("#ed-f-sh-angle-n", "0"); pg.press("#ed-f-sh-angle-n", "Enter"); pg.fill("#ed-f-sh-distance-n", "10"); pg.press("#ed-f-sh-distance-n", "Enter")
    pg.fill("#ed-f-sh-opacity-n", "50"); pg.press("#ed-f-sh-opacity-n", "Enter"); pg.fill("#ed-f-sh-blur-n", "4"); pg.press("#ed-f-sh-blur-n", "Enter")
    shd = pg.evaluate("""(() => { const b = document.getElementById('%s'); const x = parseFloat(b.style.getPropertyValue('--shx')), y = parseFloat(b.style.getPropertyValue('--shy'));
      const [sx, sy] = getComputedStyle(b).scale.split(' ').map(Number), p = new DOMMatrix().scale(sx, sy ?? sx).multiply(new DOMMatrix(b.style.transform)).transformPoint(new DOMPoint(x, y));
      return ['shadow' in b.dataset, b.dataset.shadowAngle, b.dataset.shadowDistance, b.dataset.shadowOpacity, b.dataset.shadowBlur, Math.round(p.x), Math.round(p.y), b.style.getPropertyValue('--shc')]; })()""" % sh)
    pg.evaluate("(() => { setPanel(false); slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); })()")
    check("Drop shadow controls (color, opacity, angle, distance, blur) keep their page direction on a rotated, flipped box",
          shd == [True, "0", "10", "0.5", "4", 10, 0, "#00000080"], str(shd))
    pg.evaluate("(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1); sel.clear(); render(); })()")
    fr = pg.locator("#ed-frame").bounding_box(); sc = pg.evaluate("scale"); at = lambda x, y: (fr["x"] + x * sc, fr["y"] + y * sc)
    pg.click("#ed-add-line"); pg.click(".menu-item:has-text('Polyline')")
    for x, y in [(200, 200), (500, 400), (800, 200)]: pg.mouse.click(*at(x, y))
    pg.mouse.dblclick(*at(1100, 400))
    pg.click("#ed-add-line"); pg.click(".menu-item:has-text('Scribble')")
    pg.mouse.move(*at(200, 700)); pg.mouse.down()
    for i in range(1, 12): pg.mouse.move(*at(200 + i * 40, 700 + (i % 2) * 60))
    pg.mouse.up()
    pg.click("#ed-add-line"); pg.click(".menu-item:has-text('Arrow')")
    pg.mouse.move(*at(1600, 900)); pg.mouse.down(); pg.mouse.move(*at(1300, 600), steps=4); pg.mouse.up()
    drawn = pg.evaluate("""boxes().map(b => [b.dataset.shape, b.dataset.path?.split(/[LC]/).length || 0, Math.round(parseFloat(b.style.left)), Math.round(parseFloat(b.style.width)), b.dataset.start || '', b.dataset.dir || ''])""")
    pg.evaluate("(() => { slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); })()")
    ok = (len(drawn) == 3 and drawn[0][:4] == ["path", 4, 200, 900] and drawn[1][0] == "path" and drawn[1][1] >= 5
          and drawn[2][0] == "line" and drawn[2][2:] == [1300, 300, "fill-arrow", ""])
    check("Line tool as Slides: Polyline by clicks + double-click, Scribble by dragging (data-path), Arrow drawn by dragging (backwards keeps the head at the end)", ok, str(drawn))
    ids = pg.evaluate("""(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1);
      const a = makeBox({x: 200, y: 400, w: 300, h: 200, shape: 'rect'}), c = makeBox({x: 1300, y: 300, w: 300, h: 200, shape: 'ellipse'}); s.append(a, c); sel.clear(); render(); return [a.id, c.id]; })()""")
    fr = pg.locator("#ed-frame").bounding_box(); sc = pg.evaluate("scale"); at = lambda x, y: (fr["x"] + x * sc, fr["y"] + y * sc)
    pg.click("#ed-add-line"); pg.click(".menu-item:has-text('Elbow Connector')")
    pg.mouse.move(*at(503, 497)); pg.mouse.down(); pg.mouse.move(*at(1000, 450), steps=3); pg.mouse.move(*at(1297, 404), steps=3)
    dots = pg.evaluate("document.querySelectorAll('#ed-guides .conn').length"); pg.mouse.up()
    c1 = pg.evaluate("(() => { const l = boxes().find(b => b.dataset.shape === 'elbow'); return [l.dataset.from, l.dataset.to, l.style.left, l.style.top, l.style.width, l.style.height]; })()")
    pg.evaluate("(() => { const c = document.getElementById('%s'); setGeo(c, { ...geo(c), y: 700 }); commit(); })()" % ids[1])
    c2 = pg.evaluate("(() => { const l = boxes().find(b => b.dataset.shape === 'elbow'); return [l.style.top, l.style.height, l.dataset.dir || '']; })()")
    pg.evaluate("sel = new Set([boxes().find(b => b.dataset.shape === 'elbow')]); drawOverlay()")
    linked = pg.evaluate("document.querySelectorAll('#ed-ui .handle.linked').length")
    pg.evaluate("(() => { slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); })()")
    reuse = pg.evaluate("""(() => { const v = [...document.querySelectorAll('#ed-thumbs .thumb-view')]; boxes()[0] && (content(boxes()[0]).dataset.x = '1'); commit();
      const w = [...document.querySelectorAll('#ed-thumbs .thumb-view')]; boxes()[0] && delete content(boxes()[0]).dataset.x; commit();
      return [v.length === w.length, v.filter((e, i) => e === w[i]).length, v.length - 1]; })()""")
    ru = pg.evaluate("""(() => { const r = document.querySelector('#ed-ruler-h').getBoundingClientRect(), v = document.querySelector('#ed-ruler-v').getBoundingClientRect(); return [Math.round(r.height), Math.round(v.width)]; })()""")
    hr = pg.locator("#ed-ruler-h").bounding_box(); fr = pg.locator("#ed-frame").bounding_box()
    ng = pg.evaluate("userGuides().length")
    pg.mouse.move(fr["x"] + fr["width"] / 2, hr["y"] + 10); pg.mouse.down(); pg.mouse.move(fr["x"] + fr["width"] / 2, fr["y"] + fr["height"] / 4, steps=4); pg.mouse.up()
    g = pg.evaluate("userGuides()")
    pg.evaluate("setGuides(userGuides().slice(0, -1))")
    # a click on the ruler (or a wobble on it) adds no guide; mid-drag the line is blue and says where it is; let go off the slide, none
    n_before = pg.evaluate("userGuides().length")
    pg.mouse.click(fr["x"] + fr["width"] / 3, hr["y"] + 10); pg.wait_for_timeout(200)
    clicked = pg.evaluate("userGuides().length") - n_before
    pg.mouse.move(fr["x"] + fr["width"] / 3, hr["y"] + 10); pg.mouse.down(); pg.mouse.move(fr["x"] + fr["width"] / 3, fr["y"] + fr["height"] / 2, steps=5)
    mid = pg.evaluate("[!!document.querySelector('#ed-rules .rule.new'), document.querySelector('#ed-rules .rule-at')?.textContent || '', getComputedStyle(document.querySelector('#ed-rules .rule.new'), '::after').backgroundColor]")
    pg.mouse.move(fr["x"] + fr["width"] / 3, hr["y"] - 40, steps=4); pg.mouse.up(); pg.wait_for_timeout(200)
    cancelled = pg.evaluate("userGuides().length") - n_before
    check("a click on the ruler adds no guide; dragging one out shows it blue with its place in inches, and let go off the slide it's gone",
          clicked == 0 and mid[0] and mid[1].endswith(" in") and mid[2] != "rgb(95, 99, 104)" and cancelled == 0 and pg.evaluate("document.querySelector('#ed-ruler-h').title").startswith("Drag down"), f"click={clicked} mid={mid} cancel={cancelled}")
    pg.click("#ed-menubar [data-menu=View]"); pg.click(".menu-item:has-text('Show ruler')")
    off = pg.evaluate("getComputedStyle(document.querySelector('#ed-ruler-h')).display")
    pg.click("#ed-menubar [data-menu=View]"); pg.click(".menu-item:has-text('Show ruler')")
    gs = pg.evaluate("""(() => { store('slides-snap-grid', '1'); const b = makeBox({x: 100, y: 100, w: 200, h: 100}); const out = [snap(geo(b), []), snapGrid()];
      store('slides-snap-grid', undefined); return [out[0].dx, out[0].dy, out[1], snapGrid()]; })()""")
    pg.click("#ed-menubar [data-menu=View]"); pg.hover(".menu-item:has-text('Snap to')"); pg.click(".menu-item:has(.menu-label:text-is('Grid'))")
    gm = pg.evaluate("snapGrid()"); pg.evaluate("store('slides-snap-grid', undefined)")
    pg.click("#ed-menubar [data-menu=View]"); pg.click(".menu-item:has(.menu-label:text-is('Dark mode'))"); pg.wait_for_timeout(900)   # after its transition
    dk = pg.evaluate("[document.body.classList.contains('dark'), getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector('#ed-frame')).backgroundColor]")
    pg.evaluate("setDark(false); store('slides-dark', undefined)")
    fit_sz = pg.evaluate("""(() => { const i = document.querySelector('#ed-size'), v = i.value; i.value = '16.5'; const ok = i.scrollWidth <= i.clientWidth; i.value = v; return ok; })()""")
    check("the font-size box shows a fractional size (16.5) without cutting it off", fit_sz)
    check("View → Dark mode darkens the chrome but not the slide", dk == [True, "rgb(19, 19, 20)", "rgb(255, 255, 255)"], str(dk))
    check("View → Snap to → Grid: moves snap the top-left corner to the 1/8 in (24px) grid", gs == [-4, -4, True, False] and gm is True, f"{gs} {gm}")
    th = pg.evaluate("""(() => { const o = {x: 300, y: 300, w: 200, h: 200}, at = px => snap({x: 900, y: 300 + px / scale, w: 200, h: 200}, [o]).dy !== 0;
      const row = [{x: 100, y: 0, w: 100, h: 100}, {x: 300, y: 0, w: 100, h: 100}], sp = px => !!spaceSnap({x: 500 + px / scale, y: 0, w: 100, h: 100}, row, 'x');
      const s = makeBox({x: 100, y: 600, w: 200, h: 200, shape: 'rect'}), l = makeBox({x: 300, y: 700, w: 400, h: 0, shape: 'line'}); l.dataset.from = s.id + ':r';
      slides[cur].append(s, l); render(); setGeo(s, {...geo(s), x: 200}); followConnectors(); const lg = geo(l); s.remove(); l.remove(); render();
      return [at(5), at(7), sp(2), sp(3), lg.x, lg.w]; })()""")
    check("snapping as measured on Slides: alignment at 5 screen px not 7, equal spacing at 2 not 3; a line attached at one end moves whole with its shape",
          th == [True, False, True, False, 400, 400], str(th))

    check("rulers: 20px top and left rulers; dragging out of the top ruler adds a horizontal guide; View → Show ruler hides them",
          ru == [20, 20] and len(g) == ng + 1 and g[-1][0] == "h" and abs(g[-1][1] - 270) < 6 and off == "none", f"{ru} {g} {off}")
    check("filmstrip: an edit rebuilds only the changed slide's thumbnail", reuse[0] and reuse[1] == reuse[2], str(reuse))
    check("an attached line's ends draw as filled handles", linked == 2, str(linked))
    check("connectors snap to shapes' connection points (data-from / data-to) and follow when the shape moves",
          dots >= 4 and c1 == [ids[0] + ":r", ids[1] + ":l", "500px", "400px", "800px", "100px"] and c2 == ["500px", "300px", ""], f"{dots} {c1} {c2}")
    eb = pg.evaluate("""(() => { const e = makeBox({x: 0, y: 0, w: 400, h: 200, shape: 'elbow'}), n = () => e.querySelector('path.l').getAttribute('d').split('L').length - 1;
      renderShape(e); const two = n(), h0 = shapeAdjust(e)[0].x; e.dataset.from = 'a:r'; e.dataset.to = 'b:t'; renderShape(e); const one = n(), none = shapeAdjust(e);
      e.dataset.from = 'a:b'; e.dataset.to = 'b:t'; renderShape(e); const vhv = e.querySelector('path.l').getAttribute('d'); const set = shapeAdjust(e)[0].set(0, 50); return [two, h0, one, none, vhv.includes('L0,50') || vhv.includes('L0,100'), set.bend]; })()""")
    cv = pg.evaluate("""(() => { const e = makeBox({x: 0, y: 0, w: 400, h: 200, shape: 'curve'}); renderShape(e); const h = shapeAdjust(e)[0];
      Object.assign(e.dataset, h.set(125, 100)); renderShape(e); const d = e.querySelector('path.l').getAttribute('d'), h2 = shapeAdjust(e)[0];
      return [h.x, h.y, e.dataset.bend, Math.round(h2.x), d.includes('C100,0 100,200')]; })()""")
    check("curved connector: bend handle on the curve moves the S (data-bend)", cv == [200, 100, "0.25", 125, True], str(cv))
    check("elbow connectors route as Slides: 2 bends between like sides (bend handle → data-bend), 1 bend between a horizontal and a vertical side", eb == [3, 200, 2, None, True, "0.25"], str(eb))
    pg.evaluate("(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1); sel.clear(); render(); })()")
    pg.click("#ed-menubar [data-menu=Insert]"); pg.click(".menu-item:has-text('Word art')")
    pg.keyboard.type("Hello"); pg.keyboard.press("Enter")
    wa = pg.evaluate("""(() => { const b = [...sel][0], t = b.querySelector('svg.shape text'), r = t.getBBox();
      return [b.dataset.shape, editing === null, b.querySelector('.content').textContent, t.textContent, Math.round(r.width) >= parseFloat(b.style.width) - 4, getComputedStyle(b.querySelector('.content')).opacity]; })()""")
    pg.evaluate("(() => { slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); })()")
    check("Insert → Word art: type, Enter; the text is drawn as SVG letters stretched to the box (data-shape=wordart)", wa == ["wordart", True, "Hello", "Hello", True, "0"], str(wa))
    gif = __import__("base64").b64decode("R0lGODlhCAAIAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAFAAAACwAAAAACAAIAAAIDwABCBxIsKDBgwgTKkwYEAAh+QQBFAABACwAAAAACAAIAIEAAP8AAAAAAAAAAAAIDwABCBxIsKDBgwgTKkwYEAA7")
    pg.evaluate("(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1); sel.clear(); render(); })()")
    pg.set_input_files("#ed-file", files=[{"name": "anim.gif", "mimeType": "image/gif", "buffer": gif}]); pg.wait_for_timeout(800)
    g = pg.evaluate("(() => { const src = boxes()[0].querySelector('img').getAttribute('src'), t = document.querySelector('.thumb.active .thumb-canvas img'); return [src, t?.getAttribute('src').slice(0, 15)]; })()")
    saved = (deck.parent / g[0]).read_bytes() == gif if g[0] else False
    pg.evaluate("(() => { const b = boxes()[0]; sel = new Set([b]); setGeo(b, { x: 100, y: 100, w: 900, h: 300 }); drawOverlay(); updateToolbar(); })()")
    rb = pg.evaluate("!!document.querySelector('#ed-replace-image').offsetParent")
    pg.set_input_files("#ed-replace-file", files=[{"name": "p.png", "mimeType": "image/png", "buffer": __import__("base64").b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==")}]); pg.wait_for_timeout(600)
    rp = pg.evaluate("(() => { const b = boxes()[0]; return [b.querySelector('img').getAttribute('src').endsWith('.png'), b.style.width, b.style.height]; })()")
    pg.evaluate("resetImageSize(boxes()[0])"); pg.wait_for_timeout(300); rs = pg.evaluate("[boxes()[0].style.width, boxes()[0].style.height]")
    check("Replace image keeps the box's place and size; Reset size restores the picture's proportions", rb and rp == [True, "900px", "300px"] and rs[0] == rs[1], f"{rb} {rp} {rs}")
    pg.evaluate("(() => { slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); })()")
    check("GIFs keep their bytes (so they animate) and the filmstrip shows the first frame", g[0].endswith(".gif") and saved and g[1] == "data:image/png;", f"{g} saved={saved}")
    vid = pg.evaluate("""(async () => { const s = blankSlide(); slides.push(s); go(slides.length - 1); sel.clear(); render();
      const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180; const x = cv.getContext('2d');
      const rec = new MediaRecorder(cv.captureStream(30), { mimeType: 'video/webm' }), parts = []; rec.ondataavailable = e => parts.push(e.data);
      let t = 0; const iv = setInterval(() => { x.fillStyle = t++ % 2 ? '#1a73e8' : '#fbbc04'; x.fillRect(0, 0, 320, 180); }, 30);
      rec.start(); await new Promise(r => setTimeout(r, 500)); rec.stop(); await new Promise(r => rec.onstop = r); clearInterval(iv);
      await addVideo(new File(parts, 'clip.webm', { type: 'video/webm' }));
      const b = [...sel][0], v = b.querySelector('video'); setPanel(true);
      return [b.className, v.getAttribute('src').endsWith('.webm'), (v.getAttribute('poster') || '').endsWith('.jpg'), Math.round(parseFloat(b.style.width) / parseFloat(b.style.height) * 100),
              !!document.querySelector('#ed-fmt details.video-only').offsetParent, getComputedStyle(b, '::after').content.includes('play_arrow'), b.id]; })()""")
    pg.evaluate("$('#ed-f-v-auto').closest('details').open = true"); pg.click("#ed-f-v-auto"); pg.click("#ed-f-v-loop")
    pg.fill("#ed-f-v-start", "0:01.5"); pg.press("#ed-f-v-start", "Enter"); pg.fill("#ed-f-v-end", "3"); pg.press("#ed-f-v-end", "Enter")
    trim = pg.evaluate("(() => { const v = document.getElementById('%s').querySelector('video'); return [v.getAttribute('src').split('#')[1], $('#ed-f-v-start').value]; })()" % vid[6])
    check("video trim: Start at / End at become a #t=start,end fragment on the src", trim == ["t=1.5,3", "0:01.5"], str(trim))
    va = pg.evaluate("(() => { const v = document.getElementById('%s').querySelector('video'); return [v.hasAttribute('data-autoplay'), v.hasAttribute('loop'), v.hasAttribute('muted')]; })()" % vid[6])
    # without a poster (an agent's <video>): the slide shows its first frame (editor only), the filmstrip a picture of it,
    # never a <video> per thumbnail (Safari draws those black); the deck keeps no poster
    pg.evaluate("(() => { const v = document.getElementById('%s').querySelector('video'); v.removeAttribute('poster'); v.setAttribute('src', v.getAttribute('src').split('#')[0]); render(); commit(); })()" % vid[6])
    pg.wait_for_function("(document.getElementById('%s').querySelector('video').getAttribute('poster') || '').startsWith('data:image/jpeg')" % vid[6], timeout=10000); pg.wait_for_timeout(300)
    nop = pg.evaluate("""(id => { const t = document.querySelector('#ed-thumbs .thumb.active .thumb-canvas');
      return [!!t.querySelector('video'), (t.querySelector('img')?.getAttribute('src') || '').slice(0, 15), cleanBox(document.getElementById(id)).querySelector('video').hasAttribute('poster'), slides.map(x => sectionHTML(x)).join().includes('data-ed-poster')]; })""", vid[6])
    check("a video without a poster: its first frame on the slide (editor only) and as a picture in the filmstrip, no poster saved", nop == [False, "data:image/jpeg", False, False], nop)
    pg.evaluate("(() => { setPanel(false); slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); })()")
    check("video boxes: upload to assets/, poster from the first frame, play badge in the editor, Video playback autoplay / loop",
          vid[:6] == ["box video", True, True, 178, True, True] and va == [True, True, False], f"{vid} {va}")
    plot = pg.evaluate("""(async () => { const s = blankSlide(); slides.push(s); go(slides.length - 1); sel.clear(); render();
      const c = document.createElement('canvas'); c.width = 2400; c.height = 1600; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 2400, 1600); x.strokeStyle = '#1a73e8'; x.lineWidth = 8; x.beginPath(); x.moveTo(100, 1500); x.lineTo(2300, 100); x.stroke();
      const blob = await new Promise(r => c.toBlob(r, 'image/png')), e = new Event('paste', { bubbles: true });
      e.clipboardData = { files: [new File([blob], 'image.png', { type: 'image/png' })], items: [], getData: () => '' };   // what Jupyter / matplotlib put on the clipboard
      document.body.dispatchEvent(e); await new Promise(r => setTimeout(r, 900));
      const b = boxes().find(b => b.classList.contains('image')), out = b ? [b.style.width, b.style.height, b.querySelector('img').getAttribute('src').endsWith('.png')] : null;
      slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); return out; })()""")
    check("pasting a retina-size plot (2400×1600 image/png, as from Jupyter) inserts it fitted to the slide, full resolution kept", plot == ["1200px", "800px", True], str(plot))
    cid = pg.evaluate("""(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1);
      const c = document.createElement('canvas'); c.width = 400; c.height = 200; c.getContext('2d').fillStyle = '#1a73e8'; c.getContext('2d').fillRect(0, 0, 400, 200);
      const b = makeBox({x: 400, y: 300, w: 800, h: 400, cls: 'image', html: `<img src="${c.toDataURL()}" alt="">`}); s.append(b); sel = new Set([b]); render(); return b.id; })()""")
    r0 = pg.evaluate("(() => { const r = document.querySelector('#%s img').getBoundingClientRect(); return [r.x, r.width]; })()" % cid)
    c = pg.evaluate("(() => { const r = document.getElementById('%s').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()" % cid)
    pg.mouse.dblclick(c[0], c[1]); marks = pg.evaluate("document.querySelectorAll('#ed-ui .handle.crop').length")
    h = pg.locator("#ed-ui .handle.crop.w").bounding_box(); sc = pg.evaluate("scale")
    pg.mouse.move(h["x"] + 2, h["y"] + h["height"] / 2); pg.mouse.down(); pg.mouse.move(h["x"] + 2 + 200 * sc, h["y"] + h["height"] / 2, steps=5); pg.mouse.up()
    pg.keyboard.press("Enter")
    cr = pg.evaluate("(() => { const b = document.getElementById('%s'), r = b.querySelector('img').getBoundingClientRect(); return [b.dataset.crop, b.style.left, b.style.width, Math.round(r.x), Math.round(r.width), document.querySelectorAll('#ed-ui .handle.crop').length]; })()" % cid)
    pg.evaluate("(() => { slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); })()")
    check("crop: double-click an image for black crop marks; dragging one cuts that side (data-crop) while the picture stays put; ↵ ends",
          marks == 8 and cr[:3] == ["0 0 0 0.25", "600px", "600px"] and abs(cr[3] - round(r0[0])) <= 1 and abs(cr[4] - round(r0[1])) <= 1 and cr[5] == 0, f"{marks} {cr} {r0}")
    up = pg.evaluate("""(async () => { const c = document.createElement('canvas'); c.width = 300; c.height = 150; c.getContext('2d').fillRect(0, 0, 300, 150);
      const blob = await new Promise(r => c.toBlob(r, 'image/png')); return (await (await fetch('/api/upload?ext=png', { method: 'POST', body: blob })).json()).src; })()""")
    pu = pg.evaluate("""(async url => { const s = blankSlide(); slides.push(s); go(slides.length - 1); sel.clear(); render();
      const paste = t => { const e = new Event('paste', { bubbles: true }); e.clipboardData = { files: [], items: [], getData: k => k === 'text/plain' ? t : '' }; document.body.dispatchEvent(e); };
      paste(url); await new Promise(r => setTimeout(r, 1200)); paste(location.origin + '/editor/editor.css'); await new Promise(r => setTimeout(r, 1200));
      const out = boxes().map(b => b.classList.contains('image') ? 'image:' + b.querySelector('img').getAttribute('src').startsWith('assets/') + ':' + b.style.width : 'text:' + b.textContent.slice(-10));
      slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); return out; })""", URL + "deck/" + up)
    check("pasting an image's web address inserts the picture (downloaded into assets/); any other address stays text", pu == ["image:true:300px", "text:editor.css"], str(pu))
    iid = pg.evaluate("""(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1);
      const c = document.createElement('canvas'); c.width = 40; c.height = 20; const b = makeBox({x: 400, y: 300, w: 800, h: 400, cls: 'image', html: `<img src="${c.toDataURL()}" alt="">`});
      b.dataset.crop = '0 0 0 0.2'; s.append(b); sel.clear(); render(); return b.id; })()""")
    pg.click("#" + iid, button="right"); ctx = pg.evaluate("[...document.querySelectorAll('.menu .menu-label')].map(e => e.textContent)"); pg.keyboard.press("Escape")
    pg.click("#ed-menubar [data-menu=Format]"); pg.hover(".menu-item:has-text('Image')"); fm = pg.evaluate("[...document.querySelectorAll('.menu')].pop().innerText"); pg.keyboard.press("Escape")
    pg.evaluate("resetImage(boxes()[0])"); pg.wait_for_timeout(200); rst = pg.evaluate("[boxes()[0].dataset.crop || '', boxes()[0].style.width]")
    pg.evaluate("imageToBackground(boxes()[0])"); bg = pg.evaluate("[boxes().length, (slides[cur].dataset.backgroundImage || '').startsWith('data:image/png')]")
    pg.evaluate("(() => { slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); })()")
    check("pictures, as Slides: right-click ends with Crop / Replace / Reset image / Set image as background (and Link, as Keynote); Format → Image; Reset image undoes the crop",
          {"Crop image", "Replace image", "Reset image", "Set image as background"} <= set(ctx) and "Link" in ctx and all(k in fm for k in ("Crop image", "Replace image", "Reset image"))
          and rst == ["", "40px"] and bg == [0, True], f"{ctx} | {fm!r} | {rst} {bg}")
    n0 = pg.evaluate("(() => { go(slides.length - 1); sel.clear(); render(); return slides.length; })()")
    pg.locator("#ed-stage").focus(); pg.keyboard.press("Meta+Shift+m"); pg.keyboard.press("Meta+Shift+m"); pg.keyboard.press("Meta+m")
    st = pg.evaluate("[slides.length, [...document.querySelectorAll('.thumb')].slice(-4).map(t => (t.classList.contains('sub') ? 'sub:' : '') + t.querySelector('.num').firstChild.textContent)]")
    pg.wait_for_timeout(1200); html = deck.read_text()
    nested = html.count("<section>\n<section") >= 1
    pg.evaluate("load(true)"); pg.wait_for_timeout(500)
    st2 = pg.evaluate("[slides.length, [...document.querySelectorAll('.thumb')].slice(-4).map(t => t.querySelector('.num').firstChild.textContent)]")
    par = n0 - 1
    tree = pg.evaluate(f"""(() => {{ const ts = [...document.querySelectorAll('.thumb')], sub = ts[{par} + 1];
      const whole = t => {{ const v = t.querySelector('.thumb-view').getBoundingClientRect(), c = t.querySelector('.thumb-canvas').getBoundingClientRect(); return Math.abs(c.width - v.width) < 1.5 && Math.abs(c.height - v.height) < 1.5; }};
      const nr = (r => (r.selectNodeContents(sub.querySelector('.num')), r.getBoundingClientRect()))(document.createRange()), tick = sub.getBoundingClientRect().left + parseFloat(getComputedStyle(sub, '::after').left) + 6;
      const rail = [getComputedStyle(sub, '::before').width, getComputedStyle(sub, '::after').width, sub.querySelector('.thumb-view').offsetWidth, whole(sub), nr.left >= tick && nr.right <= sub.querySelector('.thumb-view').getBoundingClientRect().left];
      ts[{par}].querySelector('.fold').click();
      const folded = [getComputedStyle(document.querySelectorAll('.thumb')[{par} + 1]).display, document.querySelectorAll('.thumb')[{par}].querySelector('.fold-count')?.textContent];
      const kept = stored(foldKey());
      document.querySelectorAll('.thumb')[{par}].querySelector('.fold').click();
      setGrid(true); const ts2 = [...document.querySelectorAll('.thumb')].slice({par}, {par} + 3), r = ts2.map(t => t.getBoundingClientRect());
      const g = [ts2.every(t => t.style.gridColumn === ts2[0].style.gridColumn && t.style.gridRow === ts2[0].style.gridRow), r[1].top > r[0].bottom, r[2].top > r[1].bottom,
        Math.round(ts2[1].querySelector('.thumb-view').offsetWidth / ts2[0].querySelector('.thumb-view').offsetWidth * 10) / 10, whole(ts2[1])]; setGrid(false);
      return [rail, folded, g, getComputedStyle(document.querySelectorAll('.thumb')[{par} + 1]).display, kept]; }})()""")
    v = pg.context.browser.new_page(); v.goto(URL + "deck/deck.html"); v.wait_for_function("window.Reveal?.isReady?.()", timeout=20000)
    v.evaluate(f"Reveal.slide({par}, 2)"); v.wait_for_timeout(200); pill = v.evaluate("document.querySelector('.sl-bar .num').textContent")
    v.click(".sl-bar .num"); pick = v.evaluate("[...document.querySelectorAll('.sl-pop button')].slice(-4).map(b => (b.classList.contains('indent') ? '>' : '') + b.textContent)"); v.close()
    check("stacks as a tree: sub-slides at 72 % under a 2 px rail with ticks (the whole slide drawn in the smaller frame, its number between tick and picture), fold to '+2', a column under the main slide in grid view; the slideshow pill and picker follow",
          tree[0][:2] == ["2px", "6px"] and tree[0][2] == 114 and tree[0][3:] == [True, True] and tree[1] == ["none", "+2"] and tree[2][:3] == [True, True, True] and tree[2][3] < 0.8 and tree[2][4]
          and tree[3] != "none" and tree[4] == f"[{par}]"

          and pill == f"{n0}.2" and pick == [f"Slide {n0}", f">{n0}.1", f">{n0}.2", f"Slide {n0 + 1}"], f"{tree} {pill} {pick}")
    pg.evaluate("(() => { slides.splice(-3); go(slides.length - 1); commit(); })()"); pg.wait_for_timeout(1200)
    last = str(n0)

    check("vertical sub-slides: ⇧⌘M adds a slide below (filmstrip 2.1 indented), ⌘M the next main slide; saved as a nested <section> stack and loaded back",
          st == [n0 + 3, [last, "sub:" + last + ".1", "sub:" + last + ".2", str(n0 + 1)]] and nested and st2[1] == [last, last + ".1", last + ".2", str(n0 + 1)], f"{n0} {st} {nested} {st2}")
    ids = pg.evaluate("""(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1);
      const a = makeBox({x: 200, y: 300, w: 300, h: 200, shape: 'rect'}), c = makeBox({x: 900, y: 600, w: 300, h: 300, shape: 'rect'}); s.append(a, c); sel = new Set([a]); render(); return [a.id, c.id]; })()""")
    h = pg.locator("#ed-ui .handle[data-dir=e]").bounding_box(); sc = pg.evaluate("scale")
    pg.mouse.move(h["x"] + h["width"] / 2, h["y"] + h["height"] / 2); pg.mouse.down(); pg.mouse.move(h["x"] + h["width"] / 2 + 395 * sc, h["y"] + h["height"] / 2, steps=5)
    red = pg.evaluate("document.querySelectorAll('#ed-guides .guide').length"); pg.mouse.up()
    after = pg.evaluate("[document.getElementById('%s').style.width, document.querySelectorAll('#ed-guides .guide').length]" % ids[0])
    r = pg.locator("#ed-ui .handle.rotate").bounding_box(); bb = pg.evaluate("(() => { const r = document.getElementById('%s').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()" % ids[0])
    import math
    pg.mouse.move(r["x"] + r["width"] / 2, r["y"] + r["height"] / 2); pg.mouse.down()
    ang = math.radians(-90 + 43.5); pg.mouse.move(bb[0] + 300 * math.cos(ang), bb[1] + 300 * math.sin(ang), steps=6); pg.mouse.up()
    rotd = pg.evaluate("document.getElementById('%s').style.transform" % ids[0])
    pg.evaluate("(() => { slides.pop(); go(slides.length - 1); sel.clear(); render(); commit(); })()")
    check("resizing snaps the dragged edge to other boxes' edges with a red line (gone on release); rotation clicks into 45°",
          red >= 1 and after == ["700px", 0] and rotd == "rotate(45deg)", f"{red} {after} {rotd}")
    head = pg.evaluate("""(() => { const b = makeBox({x: 0, y: 0, w: 800, h: 0, shape: 'line'}); b.style.setProperty('--sw', '16px'); b.dataset.end = 'fill-arrow'; renderShape(b);
      const pts = b.querySelector('svg .h').getAttribute('points').split(' ').map(p => p.split(',').map(Number)), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      return [Math.round(Math.max(...xs) - Math.min(...xs)), Math.round(Math.max(...ys) - Math.min(...ys))]; })()""")
    check("line ends scale with the weight as Slides': a 16px line's filled arrow is 7× long and 5.4× wide", 108 <= head[0] <= 116 and 83 <= head[1] <= 90, str(head))
    ax = pg.evaluate("""(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1);
      const b = makeBox({x: 400, y: 300, w: 600, h: 300, shape: 'arrow', html: 'label'}); s.append(b); render();
      const box = b.getBoundingClientRect(), c = b.querySelector('.content').getBoundingClientRect(), mid = (c.left + c.right) / 2 - box.left;
      const out = [Math.round(mid / box.width * 100), cleanBox(b).getAttribute('style').includes('--tx-r')]; slides.pop(); go(slides.length - 1); render(); return out; })()""")
    check("block arrow text sits in the shaft (left of centre), as Slides; the offset isn't saved", ax[0] < 47 and ax[0] > 35 and not ax[1], str(ax))
    ins = pg.evaluate("""(() => { const n = makeBox({x: 0, y: 0, w: 400, h: 100, html: 'new'}), o = document.createElement('div'); o.className = 'box'; o.innerHTML = '<div class="content">old</div>';
      slides[cur].append(n, o); const cs = e => getComputedStyle(e.querySelector('.content')), out = [cs(n).paddingTop, cs(n).paddingLeft, cs(o).paddingTop, cs(o).paddingLeft];
      n.remove(); o.remove(); return out; })()""")
    check("new text boxes use Slides' insets (0.05 in / 0.1 in = 9.6 / 19.2 px); boxes without their own padding keep 8 / 16 px", ins == ["9.6px", "19.2px", "8px", "16px"], str(ins))
    n0 = pg.evaluate("""(() => { const n0 = slides.length; for (const t of ['A', 'B', 'C']) { const s = blankSlide(); s.dataset.tag = t; slides.push(s); } render(); commit(); return n0; })()""")
    src = pg.locator(".thumb").nth(n0 + 2).bounding_box(); dst = pg.locator(".thumb").nth(n0).bounding_box()
    pg.mouse.move(src["x"] + 80, src["y"] + 40); pg.mouse.down(); pg.mouse.move(src["x"] + 80, src["y"] + 20, steps=3)
    pg.mouse.move(dst["x"] + 80, dst["y"] + 10, steps=6)
    mid = pg.evaluate("[!!document.querySelector('.thumb-ghost'), !!document.querySelector('#ed-thumbs .thumb-drop')]"); pg.mouse.up()
    order = pg.evaluate("slides.slice(-3).map(s => s.dataset.tag).join('') + ' ' + (slides[cur].dataset.tag || '')")
    pg.evaluate("(() => { slides.splice(-3); go(slides.length - 1); commit(); })()")
    check("drag a thumbnail to reorder slides (ghost + blue drop line, as Slides)", mid == [True, True] and order == "CAB C", f"{mid} {order}")
    pg.evaluate("(() => { const s = blankSlide(); slides.push(s); go(slides.length - 1); sel.clear(); render(); })()")
    pg.click("#ed-menubar [data-menu=Slide]"); pg.hover(".menu-item:has-text('Apply layout')"); pg.click(".menu-item[data-label='Title slide'], .tile-item:has-text('Title slide')")
    lay = pg.evaluate("[slides[cur].dataset.layout, boxes().map(b => b.dataset.role).join(), getComputedStyle(boxes()[0].querySelector('.content'), '::before').content]")
    t = pg.evaluate("(() => { const r = boxes()[0].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()")
    ph = pg.evaluate("""(() => { const c = boxes()[1].querySelector('.content'), out = [];
      for (const h of ['<br>', 'Line one<br>line two']) { c.innerHTML = h; render(); out.push(getComputedStyle(c, '::before').content); }
      c.innerHTML = ''; render(); return out; })()""")
    pg.mouse.dblclick(t[0], t[1]); pg.keyboard.type("Hello deck"); typed = pg.evaluate("!('ph' in content(editing).dataset)")
    pg.keyboard.press("Escape"); pg.keyboard.press("Escape")
    check("a placeholder prompts only while it has no text: a lone <br> does; two lines (text<br>text, as agents write) and typing don't",
          ph == ['"Click to add subtitle"', "none"] and typed, f"{ph} {typed}")
    pg.locator("#ed-stage").focus(); pg.keyboard.press("Meta+m")
    nxt = pg.evaluate("[slides[cur].dataset.layout, boxes().length]")
    pg.wait_for_timeout(1200); saved = deck.read_text()
    kept = 'data-placeholder="Click to add subtitle"' in saved and 'data-ph=' not in saved
    pg.evaluate("(() => { slides.splice(-2); go(slides.length - 1); commit(); })()")
    check("layouts as Slides: Slide → Apply layout grid; placeholders prompt 'Click to add title' and survive empty; ⌘M after a title slide gives Title and body",
          lay == ["title", "title,sub", '"Click to add title"'] and nxt == ["title-body", 2] and kept, f"{lay} {nxt} {kept}")
    th0 = pg.evaluate("[deckDoc.querySelector('#deck-theme').textContent, slides.map(s => s.dataset.backgroundColor)]")
    pg.click("#ed-theme-btn"); pg.click(".theme-card:has-text('Simple Dark')")
    pg.evaluate("(() => { const s = blankSlide('title'); slides.push(s); go(slides.length - 1); const b = makeBox({x: 100, y: 900, w: 600, h: 100, html: 'plain'}); s.append(b); render(); })()")
    thm = pg.evaluate("""(() => { const c = s => getComputedStyle(s).color, b = boxes(), t = b.find(x => x.dataset.role === 'title'), p = b.find(x => !x.dataset.role);
      return [slides[cur].dataset.backgroundColor, slides[0].dataset.backgroundColor, c(p.querySelector('.content')), c(t.querySelector('.content')), getComputedStyle(t.querySelector('.content')).fontSize, getComputedStyle(p.querySelector('.content')).fontFamily.includes('Arial')]; })()""")
    pg.fill("#ed-th-title-size", "42"); pg.press("#ed-th-title-size", "Enter")
    big = pg.evaluate("getComputedStyle(boxes().find(x => x.dataset.role === 'title').querySelector('.content')).fontSize")
    pg.wait_for_timeout(1200); saved = "/* slides-theme" in deck.read_text()
    pg.evaluate("""(([css, bgs]) => { slides.pop(); slides.forEach((s, i) => { if (bgs[i]) s.dataset.backgroundColor = bgs[i]; }); deckDoc.querySelector('#deck-theme').textContent = css;
      $('#ed-deck-theme-live').textContent = css; setThemePanel(false); go(slides.length - 1); render(); commit(); })""", th0)
    check("Themes panel: Simple Dark recolours text, titles and slide backgrounds; new boxes inherit the font; Title size scales layout titles; saved in deck-theme",
          thm[:4] + thm[5:] == ["#212121", "#212121", "rgb(217, 217, 217)", "rgb(255, 255, 255)", True] and abs(float(thm[4][:-2]) - 138.67) < 0.1 and abs(float(big[:-2]) - 208) < 0.1 and saved, f"{thm} {big} {saved}")
    pg.keyboard.press("Meta+Alt+1"); pg.wait_for_timeout(150)
    gv = pg.evaluate("""(() => { const ts = [...document.querySelectorAll('.thumb .thumb-view')], r0 = ts[0].getBoundingClientRect(), r1 = ts[1].getBoundingClientRect();
      return [document.body.classList.contains('grid-mode'), !document.querySelector('#ed-work').offsetParent, Math.round(r0.width), Math.abs(r0.top - r1.top) < 2 && r1.left > r0.right]; })()""")
    pg.click("#ed-grid-in"); w2 = pg.evaluate("Math.round(document.querySelector('.thumb .thumb-view').getBoundingClientRect().width)")
    pg.locator(".thumb").nth(1).dblclick(); back = pg.evaluate("[document.body.classList.contains('grid-mode'), cur]")
    check("View → Grid view (⌘⌥1): slides as large thumbnails side by side in place of the editor; + enlarges; double-click opens the slide",
          gv == [True, True, 300, True] and w2 == 360 and back == [False, 1], f"{gv} {w2} {back}")
    th0 = pg.evaluate("[deckDoc.querySelector('#deck-theme').textContent, slides.map(s => s.dataset.backgroundColor)]")
    pg.click(".thumb >> nth=0", button="right"); tm = pg.evaluate("[...document.querySelectorAll('.menu .menu-label')].map(e => e.textContent)"); pg.keyboard.press("Escape")
    pg.evaluate("(() => { slides[cur].dataset.backgroundColor = '#fff2cc'; render(); })()"); pg.click("#ed-background"); pg.click("#ed-bg-theme")
    at = pg.evaluate("[theme().bg, slides[slides.length - 1].dataset.backgroundColor === '#fff2cc' || slides.length === 1, document.querySelectorAll('#ed-theme-list .theme-card').length]")
    pg.click("#ed-theme-btn"); ncards = pg.evaluate("document.querySelectorAll('#ed-theme-list .theme-card').length"); pg.click("#ed-theme-close")
    pg.evaluate("""(([css, bgs]) => { slides.forEach((s, i) => { if (bgs[i]) s.dataset.backgroundColor = bgs[i]; }); deckDoc.querySelector('#deck-theme').textContent = css;
      $('#ed-deck-theme-live').textContent = css; go(slides.length - 1); render(); commit(); })""", th0)
    pg.click("#ed-layout-btn"); lg = pg.evaluate("document.querySelectorAll('.menu.tile-grid .tile-item').length"); pg.keyboard.press("Escape")
    check("filmstrip menu has Move slide and Apply layout; Background → Add to theme sets the theme background; eleven theme presets",
          {"Move slide", "Apply layout"} <= set(tm) and at[0] == "#fff2cc" and ncards == 11 and lg == 11, f"{tm} {at} {ncards} {lg}")
    th0 = pg.evaluate("[deckDoc.querySelector('#deck-theme').textContent, slides.length]")
    pg.click("#ed-menubar [data-menu=Slide]"); pg.click(".menu-item:has-text('Edit theme')")
    te = pg.evaluate("[document.body.classList.contains('theme-mode'), slides.length, slides.map(s => s.dataset.edTheme).slice(0, 3).join(), !$('#ed-theme-bar').hidden]")
    pg.evaluate("""(() => { go(slides.findIndex(s => s.dataset.edTheme === 'title-body')); const t = boxes().find(b => b.dataset.role === 'title'); setGeo(t, { ...geo(t), y: 300 });
      go(0); content(boxes().find(b => b.dataset.role === 'title')).style.fontSize = '96px'; render(); })()""")
    pg.wait_for_timeout(700); clean = "Click to edit theme" not in deck.read_text()
    pg.click("#ed-theme-done")
    after = pg.evaluate("""(() => { const t = theme(), s = blankSlide('title-body'), tb = boxes(s).find(b => b.dataset.role === 'title');
      return [document.body.classList.contains('theme-mode'), slides.length, t.layouts['title-body'][0][2], t.titleSize, tb.style.top]; })()""")
    pg.evaluate("""(([css]) => { deckDoc.querySelector('#deck-theme').textContent = css; $('#ed-deck-theme-live').textContent = css; render(); commit(); })""", th0)
    check("Slide → Edit theme: master + layouts in the filmstrip, editing them changes the theme's layouts and title size; the deck never saves the stand-ins",
          te[0] and te[1] == 11 and te[2] == "master,title,section" and te[3] and clean and after == [False, th0[1], 300, 36, "300px"], f"{te} {clean} {after}")
    png = __import__("base64").b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==")
    pg.click("#ed-background"); pg.click("#ed-bg-color"); pg.click(".palette .cell[data-color='#fff2cc']")
    pg.set_input_files("#ed-bg-file", files=[{"name": "bg.png", "mimeType": "image/png", "buffer": png}]); pg.wait_for_timeout(500)
    bgd = pg.evaluate("[!$('#ed-bgdlg').hidden, slides[cur].dataset.backgroundColor, (slides[cur].dataset.backgroundImage || '').startsWith('assets/'), getComputedStyle($('#ed-frame')).backgroundImage.startsWith('url('), $('#ed-bg-reset').disabled]")
    pg.click("#ed-bg-reset"); pg.click("#ed-bg-done")
    bga = pg.evaluate("[$('#ed-bgdlg').hidden, slides[cur].dataset.backgroundColor, 'backgroundImage' in slides[cur].dataset, getComputedStyle($('#ed-frame')).backgroundImage]")
    check("Background dialog (as Slides): color, image (cover), Reset to theme, Done", bgd == [True, "#fff2cc", True, True, False] and bga == [True, "#ffffff", False, "none"], f"{bgd} {bga}")
    pg.evaluate("(() => { const a = makeBox({x:100,y:900,w:500,h:100,html:'zebra one'}), b = makeBox({x:100,y:900,w:500,h:100,html:'Zebra two zebra'}); slides[0].append(a); slides[1].append(b); render(); commit(); })()")
    pg.keyboard.press("Meta+Shift+h"); pg.keyboard.type("zebra")
    f1 = pg.evaluate("[document.querySelector('#ed-find .find-count').textContent, CSS.highlights.get('find')?.size]")
    pg.click("#ed-find-case")
    f2 = pg.evaluate("document.querySelector('#ed-find .find-count').textContent")
    cur0 = pg.evaluate("cur"); pg.click("#ed-find-next"); pg.click("#ed-find-next"); cur1 = pg.evaluate("cur")
    pg.click("#ed-find-re"); pg.fill("#ed-find-q", "z(e)bra"); re_n = pg.evaluate("found.length"); pg.click("#ed-find-re"); pg.fill("#ed-find-q", "zebra")
    pg.evaluate("(() => { slides[0].append(makeBox({x:100,y:100,w:300,h:100,html:'zébra'})); render(); })()"); pg.fill("#ed-find-q", "zebra"); dia_n = pg.evaluate("found.length")
    pg.evaluate("(() => { boxes(slides[0]).filter(b => b.textContent === 'zébra').forEach(b => b.remove()); render(); })()"); pg.fill("#ed-find-q", "zebra")
    check("find: regular expressions and ignore diacritics", re_n == 2 and dia_n == 3, f"{re_n} {dia_n}")
    pg.fill("#ed-find-r", "okapi"); pg.click("#ed-find-all")
    texts = pg.evaluate("slides.flatMap(s => boxes(s)).map(b => b.textContent).filter(t => /okapi|zebra/i.test(t))")
    pg.keyboard.press("Escape")
    check("find & replace across slides: count, match case, next moves slide, replace all", f1[0] == "1 of 3" and f2 == "1 of 2" and cur0 != cur1 and sorted(texts) == ["Zebra two okapi", "okapi one"] and pg.evaluate("document.querySelector('#ed-find').hidden"), f"{f1} {f2} {cur0}->{cur1} {texts}")
    pg.evaluate("(() => { slides.forEach(s => boxes(s).filter(b => /okapi/.test(b.textContent)).forEach(b => b.remove())); render(); commit(); })()"); pg.wait_for_timeout(1200)
    pg.evaluate("startEdit(boxes().find(b => !b.dataset.shape && !b.classList.contains('image')))")
    sp1 = pg.evaluate("document.querySelector('.content[contenteditable]').spellcheck")
    pg.keyboard.press("Meta+Alt+x")
    sp2 = pg.evaluate("[document.querySelector('.content[contenteditable]').spellcheck, document.querySelector('#ed-notes').spellcheck]")
    pg.keyboard.press("Escape"); pg.keyboard.press("Escape")
    pg.click("#ed-menubar [data-menu=Tools]"); pg.hover(".menu-item:has-text('Spelling')"); pg.click(".menu-item:has-text('Show spelling suggestions')")
    sp3 = pg.evaluate("[spellOn(), document.querySelector('#ed-notes').spellcheck, slides.some(s => s.querySelector('[spellcheck]'))]")
    check("spelling underline while editing; ⌥⌘X and Tools → Spelling toggle it; never saved", sp1 is True and sp2 == [False, False] and sp3 == [True, True, False], f"{sp1} {sp2} {sp3}")
    # Editor: common shortcuts (docs/shortcuts.md)
    n0 = pg.evaluate("slides.length"); pg.click(".thumb >> nth=0"); pg.keyboard.press("Meta+d"); n1 = pg.evaluate("slides.length")
    pg.keyboard.press("Meta+z"); pg.wait_for_timeout(100); n2 = pg.evaluate("slides.length")
    fm = pg.evaluate("""(() => { const a = makeBox({x:100,y:100,w:200,h:100,shape:'rect'}), b = makeBox({x:400,y:100,w:200,h:100,shape:'rect'});
      a.style.setProperty('--fill', '#00ff00'); slides[cur].append(a, b); render(); sel = new Set([a]); drawOverlay(); return [a.id, b.id]; })()""")
    pg.keyboard.press("Meta+Alt+c")
    pg.evaluate(f"(() => {{ sel = new Set([document.getElementById('{fm[1]}')]); drawOverlay(); }})()")
    pg.keyboard.press("Meta+Alt+v")
    pf = pg.evaluate(f"document.getElementById('{fm[1]}').style.getPropertyValue('--fill')")
    pg.evaluate(f"(() => {{ const b = document.getElementById('{fm[1]}'); b.querySelector('.content').textContent = 'x'; startEdit(b); }})()")
    paste = """() => { const dt = new DataTransfer(); dt.setData('text/html', '<b>bold</b><script>x()</script>'); dt.setData('text/plain', 'bold');
      document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return document.querySelector('.content[contenteditable]').innerHTML; }"""
    rich = pg.evaluate(paste)
    pg.context.grant_permissions(["clipboard-read", "clipboard-write"]); pg.evaluate("navigator.clipboard.writeText('bold')")
    pg.keyboard.press("Meta+Shift+v"); pg.wait_for_timeout(200)   # ⇧⌘V reads the clipboard as plain text
    plain = pg.evaluate("document.querySelector('.content[contenteditable]').innerHTML")

    pg.keyboard.press("Escape"); pg.keyboard.press("Escape")
    pg.evaluate(f"(() => {{ ['{fm[0]}', '{fm[1]}'].forEach(id => document.getElementById(id).remove()); render(); commit(); }})()")
    pg.keyboard.press("Control+Shift+f"); compact = pg.evaluate("getComputedStyle(document.querySelector('#ed-top')).display"); pg.keyboard.press("Control+Shift+f")
    pg.keyboard.press("Meta+Alt+Shift+s"); notes_off = pg.evaluate("document.body.classList.contains('notes-off')"); pg.keyboard.press("Meta+Alt+Shift+s")
    pg.keyboard.press("Meta+s"); pg.wait_for_timeout(600); saved = pg.evaluate("document.querySelector('#ed-status .status-text').textContent")
    with pg.context.expect_page() as pi:
        pg.keyboard.press("Meta+p")
    printed = "print-pdf" in pi.value.url; pi.value.close()
    check("common shortcuts: ⌘D slide in filmstrip, ⌥⌘C/⌥⌘V, ⌘V keeps / ⇧⌘V drops formatting, ⌃⇧F, ⌥⇧⌘S, ⌘S, ⌘P",
          n1 == n0 + 1 and n2 == n0 and pf == "#00ff00" and "<b>bold</b>" in rich and "script" not in rich and plain.count("<b>") == 1
          and compact == "none" and notes_off and saved == "All changes saved" and printed,
          f"{n0} {n1} {n2} {pf} {rich} {plain} {compact} {notes_off} {saved} {printed}")
    tb = pg.evaluate("(() => { const b = makeBox({x:100,y:100,w:400,h:100,html:'Plain'}); slides[cur].append(b); render(); sel = new Set([b]); drawOverlay(); return b.id; })()")
    pg.keyboard.press("Meta+b"); pg.keyboard.press("Meta+i"); pg.keyboard.press("Meta+u")
    on = pg.evaluate(f"(() => {{ const c = document.querySelector('#{tb} .content').style; return [c.fontWeight, c.fontStyle, c.textDecoration]; }})()")
    pg.keyboard.press("Meta+b")
    off = pg.evaluate(f"document.querySelector('#{tb} .content').style.fontWeight")
    pg.evaluate(f"(() => {{ document.getElementById('{tb}').remove(); sel.clear(); render(); commit(); }})()")
    ob = pg.evaluate("""(() => { const a = makeBox({x:100,y:100,w:400,h:200,shape:'rect'}), b = makeBox({x:700,y:100,w:400,h:200,shape:'ellipse'});
      slides[cur].append(a, b); render(); sel = new Set([a]); drawOverlay(); return [a.id, b.id]; })()""")
    pg.keyboard.press("Tab"); t1 = pg.evaluate("[...sel][0].id"); pg.keyboard.press("Shift+Tab"); t2 = pg.evaluate("[...sel][0].id")
    pg.keyboard.press("Meta+ArrowUp"); z = pg.evaluate(f"boxes().map(b => b.id).filter(id => ['{ob[0]}','{ob[1]}'].includes(id))")
    pg.keyboard.press("Alt+ArrowRight"); pg.keyboard.press("Alt+Shift+ArrowLeft"); r = pg.evaluate("rot([...sel][0])")
    pg.keyboard.press("Meta+Control+k"); pg.keyboard.press("Meta+Control+w"); g = pg.evaluate("(() => { const g = geo([...sel][0]); return [g.w, g.h, g.x + g.w / 2]; })()")
    pg.evaluate("setRot([...sel][0], 0); drawOverlay()")
    h = pg.locator("#ed-ui .handle[data-dir=e]").bounding_box()
    pg.keyboard.down("Alt"); pg.mouse.move(h["x"] + 3, h["y"] + 3); pg.mouse.down(); pg.mouse.move(h["x"] + 43, h["y"] + 3, steps=4); pg.mouse.up(); pg.keyboard.up("Alt")
    gc = pg.evaluate("(() => { const g = geo([...sel][0]); return [Math.round(g.x + g.w / 2), Math.round(g.w)]; })()")
    pg.evaluate(f"(() => {{ ['{ob[0]}','{ob[1]}'].forEach(id => document.getElementById(id).remove()); sel.clear(); render(); commit(); }})()")
    # filmstrip (docs/shortcuts.md): multi-select, keys on slides, focus moves
    ids0 = pg.evaluate("slides.map(s => s.textContent.trim().slice(0, 30))")
    pg.click(".thumb >> nth=0"); pg.click(".thumb >> nth=1", modifiers=["Shift"])
    pk = pg.evaluate("[picked.size, document.querySelectorAll('.thumb.picked').length]")
    pg.keyboard.press("Meta+d"); nd = pg.evaluate("slides.length"); pg.keyboard.press("Meta+z"); pg.wait_for_timeout(100)
    pg.click(".thumb >> nth=1"); pg.keyboard.press("Meta+ArrowUp"); mv = pg.evaluate("[cur, slides.map(s => s.textContent.trim().slice(0, 30))]"); pg.keyboard.press("Meta+z"); pg.wait_for_timeout(100)
    pg.click(".thumb >> nth=0"); pg.keyboard.press("ArrowDown"); c1 = pg.evaluate("cur"); pg.keyboard.press("Home"); c0 = pg.evaluate("cur"); pg.keyboard.press("End"); c2 = pg.evaluate("cur")
    pg.keyboard.press("Meta+a"); pa = pg.evaluate("picked.size"); pg.keyboard.press("Backspace"); nleft = pg.evaluate("slides.length"); pg.keyboard.press("Meta+z"); pg.wait_for_timeout(100)
    pg.click(".thumb >> nth=0"); pg.keyboard.press("Enter"); blurred = pg.evaluate("!filmFocused()")
    pg.keyboard.press("Escape"); back = pg.evaluate("filmFocused()"); pg.keyboard.press("Enter")
    pg.keyboard.press("Meta+Alt+Shift+f"); mf = pg.evaluate("filmFocused()"); pg.keyboard.press("Enter")
    ids1 = pg.evaluate("slides.map(s => s.textContent.trim().slice(0, 30))")
    check("filmstrip: ⇧-click range, ⌘D duplicates picked, ⌘↑ moves, ↓/Home/End, ⌘A+⌫ keeps one, ⏎/Esc/⌥⇧⌘F focus",
          pk == [2, 2] and nd == len(ids0) + 2 and mv[0] == 0 and mv[1] == ids0[::-1] and (c1, c0, c2) == (1, 0, len(ids0) - 1)
          and pa == len(ids0) and nleft == 1 and blurred and back and mf and ids1 == ids0, f"{pk} {nd} {mv} {(c1, c0, c2)} {pa} {nleft} {blurred} {back} {mf} {ids1 == ids0}")
    check("objects: Tab/⇧Tab, ⌘↑ forward, ⌥→/⇧⌥← rotate, ⌃⌘K/⌃⌘W resize from centre, ⌥-resize from centre",
          t1 == ob[1] and t2 == ob[0] and z == [ob[1], ob[0]] and r == 14 and g == [400, 220, 300] and gc[0] == 300 and gc[1] > 400, f"{t1} {t2} {z} {r} {g} {gc}")
    check("⌘B ⌘I ⌘U format a selected box without editing it (toggle)", on == ["bold", "italic", "underline"] and off == "", f"{on} {off}")
    pg.wait_for_timeout(1200)
    pg.evaluate("go(1)"); pg.click("#ed-menubar [data-menu=Slide]"); pg.click(".menu-item:has-text('Transition')")
    pg.click("#ed-trans details.item summary")
    pg.select_option("#ed-t-kind", "sl-left"); pg.fill("#ed-t-speed", "2"); pg.dispatch_event("#ed-t-speed", "change")
    tr = pg.evaluate("[slides[1].dataset.transition, slides[1].dataset.transitionSpeed, slides[0].dataset.transition]")
    pg.click("#ed-t-all"); tr_all = pg.evaluate("slides.map(s => s.dataset.transition)")
    pg.select_option("#ed-t-kind", "none"); pg.click("#ed-t-all"); pg.click("#ed-trans-close")
    an = pg.evaluate("(() => { const a = makeBox({x:100,y:700,w:300,h:100,html:'First'}), b = makeBox({x:500,y:700,w:300,h:100,html:'Second'}); slides[cur].append(a, b); render(); sel = new Set([a]); drawOverlay(); updateToolbar(); return [a.id, b.id]; })()")
    pg.click("#ed-menubar [data-menu=Insert]"); pg.click(".menu-item:has-text('Animation')")
    pg.evaluate(f"(() => {{ sel = new Set([document.getElementById('{an[1]}')]); drawOverlay(); updateToolbar(); }})()"); pg.click("#ed-anim-add")
    pg.click(".anim-row >> nth=0 >> .anim-head .eff"); pg.select_option(".anim-row >> nth=0 >> select.e", "fade-right")
    ra = pg.locator(".anim-row >> nth=1 >> .n").bounding_box(); rz = pg.locator(".anim-row >> nth=0 >> .n").bounding_box()
    pg.mouse.move(ra["x"] + 5, ra["y"] + 5); pg.mouse.down(); pg.mouse.move(ra["x"] + 8, ra["y"] - 5, steps=5); pg.mouse.move(rz["x"] + 5, rz["y"] + 5, steps=10); pg.mouse.up()
    anim = pg.evaluate(f"['{an[0]}', '{an[1]}'].map(id => {{ const b = document.getElementById(id); return [b.className, b.dataset.fragmentIndex]; }})")
    rows = pg.evaluate("[...document.querySelectorAll('.anim-row .what')].map(e => e.textContent)")
    pg.click(".anim-row >> nth=1 >> .anim-head .eff"); pg.select_option(".anim-row >> nth=1 >> select.t", "with")
    withp = pg.evaluate(f"['{an[0]}', '{an[1]}'].map(id => document.getElementById(id).dataset.fragmentIndex)")
    pg.select_option(".anim-row >> nth=1 >> select.t", "click")
    pg.evaluate(f"(() => {{ openAnims.add(document.getElementById('{an[1]}')); renderAnims(); }})()")
    starts = [pg.evaluate("[...document.querySelectorAll('.anim-row')].map(r => [...r.querySelectorAll('select.t option')].map(o => o.value).join())")]
    pg.select_option(".anim-row >> nth=1 >> select.t", "after"); pg.fill(".anim-row >> nth=1 >> input.dur", "1.5"); pg.dispatch_event(".anim-row >> nth=1 >> input.dur", "change")
    pg.fill(".anim-row >> nth=1 >> input.del", "0.25"); pg.dispatch_event(".anim-row >> nth=1 >> input.del", "change"); pg.select_option(".anim-row >> nth=1 >> select.ease", "ease-out")
    pg.locator("#ed-trans").screenshot(path=str(HERE / "motion-timing.png"))
    timing = pg.evaluate(f"(() => {{ const b = document.getElementById('{an[1]}'), d = b.dataset; return [d.start, d.duration, d.delay, d.ease, d.fragmentIndex, document.querySelectorAll('.anim-row .eff')[1].textContent.includes('After build 1')]; }})()")
    pg.select_option(".anim-row >> nth=1 >> select.t", "click"); pg.evaluate(f"(() => {{ const d = document.getElementById('{an[1]}').dataset; delete d.duration; delete d.delay; delete d.ease; commit(); }})()")
    pg.click(".anim-row >> nth=0 >> .anim-head .what"); pg.click(".anim-row >> nth=1 >> .anim-head .what", modifiers=["Meta"])
    pg.fill(".anim-row >> nth=0 >> input.dur", "2"); pg.dispatch_event(".anim-row >> nth=0 >> input.dur", "change")
    multi = pg.evaluate(f"[['{an[0]}', '{an[1]}'].map(id => document.getElementById(id).dataset.duration), [...document.querySelectorAll('.anim-row .step')].map(s => s.textContent)]")
    pg.evaluate(f"(() => {{ ['{an[0]}', '{an[1]}'].forEach(id => delete document.getElementById(id).dataset.duration); sel.clear(); commit(); renderAnims(); }})()")
    check("Motion panel as Keynote's build order: numbered builds, ⌘-click a second row and a change goes to both", multi == [["2", "2"], ["1", "2"]], str(multi))
    check("Motion panel build timing: start On click / With previous / After previous (After transition on the first only), duration, delay, acceleration",
          starts[0][0].endswith("transition") and not starts[0][1].endswith("transition")
          and timing == ["after", "1.5", "0.25", "ease-out", "1", True], f"{starts} {timing}")
    together = pg.evaluate("""(() => { const a = makeBox({x:100,y:850,w:300,h:100,html:'Third'}), b = makeBox({x:500,y:850,w:300,h:100,html:'Fourth'}); slides[cur].append(a, b); render();
      sel = new Set([a, b]); drawOverlay(); addAnim(); const out = [a, b].map(x => [x.dataset.fragmentIndex, 'withPrevious' in x.dataset]); a.remove(); b.remove(); renumber(animBoxes()); sel.clear(); render(); return out; })()""")
    check("Add animation on several selected objects: they animate together (one click, the rest with previous)", together == [["2", False], ["2", True]], str(together))
    cp = pg.evaluate("""(() => { const a = makeBox({x:100,y:850,w:300,h:100,html:'<p>one</p><p>two</p>'}), b = makeBox({x:500,y:850,w:300,h:100,html:'Other'}); slides[cur].append(a, b); render();
      setEffect(a, 'fade-right'); a.dataset.build = 'paragraph'; renumber([...animBoxes().filter(x => x !== a), a]); sel = new Set([a]); render(); return [a.id, b.id]; })()""")
    pg.click("#ed-menubar [data-menu=Edit]"); pg.click(".menu-item:has(.menu-label:text-is('Copy animation'))")
    pg.evaluate(f"(() => {{ sel = new Set([document.getElementById('{cp[1]}')]); render(); }})()")
    pg.click(f"#{cp[1]}", button="right"); rpaste = pg.evaluate("[...document.querySelectorAll('.menu .menu-label')].map(e => e.textContent).includes('Paste animation')"); pg.keyboard.press("Escape")
    t0 = pg.evaluate("performance.now()"); pg.evaluate("closeMenu(); pasteAnim()"); pa_ms = pg.evaluate(f"Math.round(performance.now() - {t0})")
    pasted = pg.evaluate(f"""(() => {{ const a = document.getElementById('{cp[0]}'), b = document.getElementById('{cp[1]}');
      const out = [b.classList.contains('fade-right'), b.dataset.build, +b.dataset.fragmentIndex > +a.dataset.fragmentIndex]; a.remove(); b.remove(); renumber(animBoxes()); sel.clear(); render(); commit(); return out; }})()""")
    check(f"Edit → Copy animation / Paste animation ({pa_ms} ms): effect and by-paragraph delivery onto another object, which joins the end of the order; right-click offers Paste",
          pasted == [True, "paragraph", True] and rpaste, f"{pasted} {rpaste}")
    pg.evaluate(f"(() => {{ ['{an[0]}', '{an[1]}'].forEach(id => document.getElementById(id).remove()); sel.clear(); render(); commit(); }})()")
    check("Motion: Insert → Animation, effect (fly in from left = fade-right), drag reorder → data-fragment-index",
          anim == [["box fragment fade-right", "1"], ["box fragment fade-in", "0"]] and rows == ["Second", "First"] and withp == ["0", "0"], f"{anim} {rows} {withp}")
    check("Slide → Transition: per-slide type and speed, Apply to all, None clears", tr == ["sl-left", "fast", None] and tr_all == ["sl-left", "sl-left"] and pg.evaluate("slides.every(s => !s.dataset.transition)"), f"{tr} {tr_all}")
    # the filmstrip marks a slide with animated objects too (not only a transition), as Slides
    badge = pg.evaluate("""(() => { const s = blankSlide(), b = makeBox({ x: 100, y: 100, w: 400, h: 100, html: 'Animated' }); setEffect(b, 'fade-in'); s.append(b); slides.push(s); go(slides.length - 1); render(); renderThumbs();
      const t = document.querySelectorAll('#ed-thumbs .thumb')[slides.length - 1]?.querySelector('.num .has-trans'); const out = [!!t, t?.dataset.tip]; slides.pop(); go(0); render(); commit(); return out; })()""")
    check("the filmstrip marks a slide whose objects are animated (not only one with a transition)", badge == [True, "Animations"], str(badge))
    # a small box drags: handles' hit areas no longer cover it whole (they were six times the handle)
    small = pg.evaluate("""(() => { const b = makeBox({ x: 800, y: 500, w: 200, h: 64, html: '<b>all four?</b>' }); b.id = 'small-one'; slides[cur].append(b); render(); commit(); sel = new Set([b]); drawOverlay();
      const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, document.querySelectorAll('#ed-ui .handle.side').length]; })()""")
    pg.mouse.move(small[0], small[1]); pg.mouse.down(); pg.mouse.move(small[0] + 20, small[1], steps=3); pg.mouse.move(small[0] + 80, small[1], steps=6); pg.mouse.up(); pg.wait_for_timeout(200)
    moved = pg.evaluate("(() => { const b = document.getElementById('small-one'); const x = geo(b).x; b.remove(); sel.clear(); render(); commit(); return x; })()")
    check("a small selected box drags from its middle (handles' hit areas don't cover it; the side handles that don't fit go)", moved > 820 and small[2] == 2, f"x={moved} side handles={small[2]}")
    # equal size while moving: the box and every other as wide (or tall) are marked in teal, as when resizing
    marks = pg.evaluate("""(() => { const a = makeBox({ x: 100, y: 700, w: 300, h: 100, html: 'A' }), c = makeBox({ x: 900, y: 700, w: 300, h: 140, html: 'B' }); a.id = 'eq-a'; c.id = 'eq-b'; slides[cur].append(a, c); render(); commit(); sel = new Set([a]); drawOverlay();
      const r = a.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()""")
    pg.mouse.move(marks[0], marks[1]); pg.mouse.down(); pg.mouse.move(marks[0] + 10, marks[1] + 40, steps=4)
    teal = pg.evaluate("document.querySelectorAll('#ed-guides .space').length"); pg.mouse.up()
    pg.evaluate("(() => { ['eq-a', 'eq-b'].forEach(id => document.getElementById(id)?.remove()); sel.clear(); render(); commit(); })()")
    check("moving a box as wide as another marks both with teal brackets (equal size, as when resizing)", teal >= 6, f"marks={teal}")
    # slides copy and paste, as Slides: ⌘C / ⌘V with the filmstrip focused; the copy goes after the current slide, new ids
    pg.evaluate("(() => { go(0); picked = new Set([slides[0]]); renderThumbs(); thumbs.focus(); })()")
    n0 = pg.evaluate("slides.length")
    pg.keyboard.press("Meta+c"); pg.keyboard.press("Meta+v"); pg.wait_for_timeout(600)
    pasted = pg.evaluate("[slides.length, cur, slides[1].dataset.sid !== slides[0].dataset.sid, normHTML(sectionHTML(slides[1])).replace(/ data-sid=\"[^\"]*\"/, '') === normHTML(sectionHTML(slides[0])).replace(/ data-sid=\"[^\"]*\"/, ''), boxes(slides[1]).every(b => !boxes(slides[0]).some(o => o.id === b.id))]")
    pg.evaluate("(() => { slides.splice(1, 1); go(0); render(); commit(); })()"); pg.wait_for_timeout(300)
    check("⌘C / ⌘V with the filmstrip focused copy a slide and paste it after the current one (its own slide id and box ids)",
          pasted == [n0 + 1, 1, True, True, True], f"{pasted} (had {n0})")
    # a deck carrying an older copy of the slideshow's code (saved by an older editor, written by an agent since): a
    # slideshow from the editor writes this editor's copy first, so what plays is current
    pg.wait_for_function("!saving && !saveTimer && !unsaved()", timeout=10000); pg.wait_for_timeout(600)
    text = deck.read_text(); a = text.index('<script id="deck-present">') + len('<script id="deck-present">'); z = text.index("</script>", a)
    deck.write_text(text[:a] + "\n/* an older present.js */\n" + text[z:])
    pg.wait_for_function("!new RegExp('older present').test(document.title) && savedCode.includes('an older present.js')", timeout=10000)
    pg.evaluate("go(0)"); pg.evaluate("present()"); pg.wait_for_timeout(2500)
    fr = next(f for f in pg.frames if "embedded" in f.url)
    fresh_code = ["an older present.js" not in deck.read_text(), fr.evaluate("document.getElementById('deck-present').textContent.includes('playShown')")]
    pg.evaluate("endPresent()"); pg.wait_for_timeout(500)
    check("presenting a deck that carries an older copy of the slideshow's code writes this editor's first, and that is what plays", fresh_code == [True, True], str(fresh_code))
    # a change from elsewhere while presenting brings the slideshow up to date where it is, not back to where it began
    pg.evaluate("go(0)"); pg.evaluate("present()"); pg.wait_for_timeout(2000)
    fr = next(f for f in pg.frames if "embedded" in f.url)
    fr.evaluate("Reveal.next()"); fr.evaluate("Reveal.next()"); pg.wait_for_timeout(400); before_at = fr.evaluate("JSON.stringify(Reveal.getIndices())")
    pg.evaluate("refreshPresent()"); pg.wait_for_timeout(2500)
    fr = next(f for f in pg.frames if "embedded" in f.url); after_at = fr.evaluate("JSON.stringify(Reveal.getIndices())")
    pg.evaluate("endPresent()"); pg.wait_for_timeout(400)
    check("the slideshow, brought up to date by a change made elsewhere, stays on its slide and step", before_at == after_at and before_at != '{"h":0,"v":0}', f"{before_at} -> {after_at}")
    # presenting in place (deck.html in the editor window) with Slides' keys from present.js
    pg.evaluate("go(0)"); pg.keyboard.press("Meta+Enter"); pg.wait_for_timeout(2000)
    fr = next(f for f in pg.frames if "embedded" in f.url)
    shown = pg.evaluate("[!document.querySelector('#ed-show').hidden, getComputedStyle(document.querySelector('#ed-show')).zIndex]")
    pg.keyboard.press("ArrowRight"); pg.wait_for_timeout(200); h1 = fr.evaluate("Reveal.getIndices().h")
    pg.keyboard.press("1"); pg.keyboard.press("Enter"); pg.wait_for_timeout(200); h0 = fr.evaluate("Reveal.getIndices().h")
    pg.keyboard.press("b"); black = fr.evaluate("!!document.querySelector('div[data-c]')"); pg.keyboard.press("b")
    pg.keyboard.press("o"); ov = fr.evaluate("Reveal.isOverview()")
    pg.keyboard.press("ArrowRight"); pg.wait_for_timeout(200); pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    after = pg.evaluate("[document.querySelector('#ed-show').hidden, cur]")
    check("⌘⏎ presents in place; → / number+⏎ / B / no overview on O; Esc returns to the slide you stopped on",
          shown[0] and h1 == 1 and h0 == 0 and black and not ov and after == [True, 1], f"{shown} {h1} {h0} {black} {ov} {after}")
    shared = {"url": "", "inLibrary": True, "access": "link", "people": []}
    def fake_publish(r):   # no real deploy: the editor's settings kept here, as the server keeps them
        if r.request.method == "POST":
            body = json.loads(r.request.post_data or "{}")
            if body.get("op") == "publish": shared["url"] = "https://slides-x.example.workers.dev/deck-abc123/"
            if "access" in body: shared["access"] = body["access"]
            if "people" in body: shared["people"] = [x.strip().lower() for x in re.split(r"[\s,;]+", body["people"]) if x.strip()]
        r.fulfill(json=shared)
    pg.route("**/api/publish", fake_publish)

    pg.click("#ed-share"); pg.wait_for_selector("#ed-sharedlg:not([hidden])")
    before = pg.evaluate("[$('#ed-share-on').checked, $('#ed-share-linkrow').hidden, $('#ed-share-title').textContent.length > 0]")
    pg.click("#ed-share-on"); pg.wait_for_function("!$('#ed-share-linkrow').hidden", timeout=10000)
    after = pg.evaluate("[$('#ed-share-url').value, !document.querySelector('#ed-share-update'), $('#ed-share .icon').textContent, $('#ed-share-hint').textContent.includes('always shows the latest')]")
    # who can open it: each person a pill (Enter, comma, space, a pasted list, leaving the field); × and Backspace take one off
    pg.select_option("#ed-share-access", "people"); pg.wait_for_function("!$('#ed-share-peoplerow').hidden")
    pills = lambda: pg.evaluate("[...document.querySelectorAll('#ed-share-chips .person')].map(c => c.querySelector('span').textContent + (c.classList.contains('bad') ? '!' : ''))")
    pg.click("#ed-share-people"); pg.keyboard.type("kazuki@harvard.edu"); pg.keyboard.press("Enter"); one = pills()
    pg.keyboard.type("@Lab.example.edu,octocat "); two = pills()
    pg.evaluate("(() => { const i = $('#ed-share-people'), dt = new DataTransfer(); dt.setData('text/plain', 'a@b.org; not an address!'); i.value = 'a@b.org; not an address!'; i.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt })); })()"); pg.wait_for_timeout(100); three = pills()
    pg.keyboard.press("Backspace"); pg.keyboard.press("Backspace"); pg.keyboard.press("Backspace"); four = pills()
    pg.click("#ed-share-chips .person:first-child button"); pg.keyboard.type("last@x.io"); pg.click("#ed-share-access"); pg.keyboard.press("Escape"); pg.wait_for_timeout(400); five = pills()
    pg.wait_for_function("$('#ed-share-status').textContent === 'Saved.'", timeout=5000)
    check("Share → Only people I add: each address becomes a pill (Enter, comma, space, paste, leaving the field), × and Backspace remove one, each change saved; a non-address is outlined",
          one == ["kazuki@harvard.edu"] and two == ["kazuki@harvard.edu", "@lab.example.edu", "octocat"] and three == two + ["a@b.org", "not", "an", "address!!"]
          and four == two + ["a@b.org"] and five == ["@lab.example.edu", "octocat", "a@b.org", "last@x.io"] and shared["people"] == five, f"{one} {two} {three} {four} {five} {shared['people']}")
    pg.keyboard.press("Escape"); pg.unroute("**/api/publish")
    check("Share → Publish to the web: off by default, publishing shows the link with Copy (no Update: it always shows the latest), the Share button shows it's public; Esc closes",
          before == [False, True, True] and after == ["https://slides-x.example.workers.dev/deck-abc123/", True, "public", True] and pg.evaluate("$('#ed-sharedlg').hidden"), f"{before} {after}")
    pg.evaluate("() => { go(0); sel = new Set([boxes()[0]]); render(); }")
    pg.keyboard.press("Meta+Alt+m"); pg.wait_for_function("document.activeElement?.matches('#ed-comments:not([hidden]) .cm-card textarea')", timeout=10000)   # (it takes focus a tick after it appears)
    pg.keyboard.type("Tighten this title"); pg.keyboard.press("Meta+Enter")
    pg.wait_for_function("cmList.length === 1 && document.querySelectorAll('#ed-pins .cm-pin').length === 1", timeout=10000)
    pg.fill(".cm-card input", "Done"); pg.press(".cm-card input", "Enter"); pg.wait_for_function("cmList[0]?.replies?.length === 1", timeout=10000)
    pg.click(".cm-card .cm-acts button:has-text('Resolve')"); pg.wait_for_function("cmList[0]?.resolved", timeout=10000)
    saved_cm = json.loads((deck.parent / "comments.json").read_text())["comments"]
    first_box = pg.evaluate("boxes()[0].id")
    check("⌥⌘M comments on the selected box: a card and a pin; Reply and Resolve; kept in comments.json beside deck.html",
          len(saved_cm) == 1 and saved_cm[0]["text"] == "Tighten this title" and saved_cm[0]["box"] == first_box and saved_cm[0]["resolved"]
          and saved_cm[0]["replies"][0]["text"] == "Done" and pg.evaluate("$('#ed-comments-n').textContent") == "", str(saved_cm)[:300])
    pg.click("#ed-cm-close")
    pg.keyboard.press("Meta+/")
    sc = pg.evaluate(
"[!document.querySelector('#ed-shortcuts').hidden, document.querySelectorAll('#ed-shortcuts .sc-section').length]")
    pg.keyboard.type("bold")
    hits = pg.evaluate("[...document.querySelectorAll('#ed-shortcuts .sc-row > span:first-child')].map(e => e.textContent)")
    pg.keyboard.press("Escape")
    check("⌘/ opens the shortcuts dialog; search filters; Esc closes", sc == [True, 8] and hits == ["Bold"] and pg.evaluate("document.querySelector('#ed-shortcuts').hidden"), f"{sc} {hits}")
    pg.screenshot(path=str(HERE / "editor.png"))

    for _ in range(50):   # (a slow runner's last save can land after the status says saved)
        if "Mention the caveat" in (html := deck.read_text()): break
        pg.wait_for_timeout(300)
    st = pg.evaluate("[document.querySelector('#ed-status .status-text').textContent, document.querySelector('#ed-status .icon').textContent, document.querySelector('#ed-status').dataset.tip || '']")
    check("saved: 'All changes saved' with cloud icon and last-saved time", st[:2] == ["All changes saved", "cloud_done"] and st[2].startswith("Saved to disk at "), str(st))
    check("two slides saved", html.count("<section") == 2)
    check("text saved", "Hello from the test" in re.sub(r"<[^>]+>", "", html))
    check("speaker notes saved", '<aside class="notes">Mention the caveat</aside>' in html)
    styled = re.search(r'Hello from the (<(span|strike|sup)[^>]*>)+test(</(span|strike|sup)>)+', html)
    check("selection styling saved", bool(styled) and all(k in styled.group(0) for k in ("font-weight: bold", "font-style: italic", "rgb(217, 48, 37)")), styled.group(0) if styled else "no span")
    check("strike/superscript saved", bool(styled) and "line-through" in styled.group(0) and ("<sup" in styled.group(0) or "vertical-align: super" in styled.group(0)), styled.group(0) if styled else "no span")
    check("image saved to assets/", bool(re.search(r'assets/\w+\.png', html)) and any((deck.parent / "assets").iterdir()))
    check("fill saved", "#e06666" in html)
    check("no SVG saved in slides", "<svg" not in html.split('class="slides"')[1].split("</section>")[-2])

    pg.evaluate("go(0)"); pg.wait_for_timeout(300)
    deck.write_text(html.replace("Slide two", "Slide two (edited by agent)"))
    pg.wait_for_function("document.querySelector('#ed-thumbs').innerHTML.includes('edited by agent')", timeout=15000)
    seen = pg.evaluate("[cur, $('#ed-status').innerText, document.querySelectorAll('#ed-flash .flash-box').length]")
    check("editor reloads agent edit: goes to the changed slide, says which, outlines the changed box", seen[0] == 1 and "slide 2" in seen[1] and seen[2] >= 1, seen)
    pg.keyboard.press("Escape"); pg.mouse.click(5, 300); pg.keyboard.press("Meta+z")
    pg.wait_for_function("!document.querySelector('#ed-thumbs').innerHTML.includes('edited by agent')", timeout=15000); pg.wait_for_timeout(1200)
    undone = "edited by agent" not in deck.read_text()
    pg.keyboard.press("Meta+Shift+z"); pg.wait_for_timeout(1200)
    check("⌘Z takes an agent's edit back (and saves that); ⇧⌘Z brings it back", undone and "edited by agent" in deck.read_text())
    # a picture rewritten on disk under the same name (an agent making a plot again) shows new on the slide and in the filmstrip,
    # not from the page's image cache; the editor's fetch-again mark (?gsv=) never reaches the deck
    def png(rgb):
        import struct, zlib
        chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
        return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"".join(b"\x00" + bytes(rgb) * 2 for _ in range(2)))) + chunk(b"IEND", b"")
    before_pic = deck.read_text(); (deck.parent / "assets").mkdir(exist_ok=True); (deck.parent / "assets" / "plot-again.png").write_bytes(png((255, 0, 0)))
    deck.write_text(before_pic.replace("</section>", '<div class="box image" id="plot-again" style="left: 100px; top: 100px; width: 400px; height: 400px;"><div class="content"><img src="assets/plot-again.png" alt=""></div></div></section>', 1))
    pg.wait_for_function("!!document.querySelector('#ed-thumbs img[src*=\"plot-again\"]')", timeout=10000); pg.evaluate("go(0)"); pg.wait_for_timeout(800)
    (deck.parent / "assets" / "plot-again.png").write_bytes(png((0, 0, 255)))
    deck.write_text(deck.read_text().replace('id="plot-again" style="left: 100px;', 'id="plot-again" style="left: 120px;'))
    pg.wait_for_function("document.querySelector('#plot-again')?.style.left === '120px'", timeout=10000); pg.wait_for_timeout(1500)
    PIX = """(q => Promise.all([...document.querySelectorAll(q)].map(i => new Promise(r => { const go = () => { const c = document.createElement('canvas'); c.width = c.height = 2; c.getContext('2d').drawImage(i, 0, 0, 2, 2); r([...c.getContext('2d').getImageData(0, 0, 1, 1).data.slice(0, 3)]); }; i.complete ? go() : i.addEventListener('load', go, { once: true }); }))))"""
    stage_px = pg.evaluate(PIX + "('#plot-again img')"); thumb_px = pg.evaluate(PIX + "('#ed-thumbs .thumb:first-child img[src*=\"plot-again\"]')")
    pg.evaluate("(() => { const b = document.querySelector('#plot-again'); b.style.top = '130px'; commit(); })()"); pg.evaluate("flushSave()"); pg.wait_for_timeout(1200)
    saved_pic = deck.read_text()
    check("a picture rewritten on disk under the same name: new on the slide and in the filmstrip; the deck keeps its plain src",
          stage_px == [[0, 0, 255]] and thumb_px == [[0, 0, 255]] and 'src="assets/plot-again.png"' in saved_pic and "gsv=" not in saved_pic, f"{stage_px} {thumb_px} {'gsv=' in saved_pic}")
    deck.write_text(before_pic); pg.wait_for_function("!document.querySelector('#ed-thumbs img[src*=\"plot-again\"]')", timeout=10000); pg.wait_for_timeout(800)
    pg.evaluate("() => { go(1); sel = new Set([boxes().find(b => content(b)?.textContent.includes('agent'))]); render(); }"); pg.wait_for_timeout(900)
    selnow = json.load(urllib.request.urlopen(URL + "api/selection"))
    check("the editor reports what's on show and selected (glideshow selection): slide, box id and text",
          selnow.get("slide") == 2 and selnow["boxes"] and selnow["boxes"][0]["id"] == pg.evaluate("[...sel][0].id") and "agent" in selnow["boxes"][0]["text"], str(selnow)[:300])
    pg.evaluate("busy = true")   # hold the live reload back, so the editor's next save meets the agent's write
    deck.write_text(deck.read_text().replace("Slide two (edited by agent)", "Slide two (edited by agent again)"))
    pg.evaluate("() => { go(0); const b = boxes().find(b => content(b)?.textContent.includes('Hello from')); b.dataset.mine = '1'; commit(); }")
    pg.wait_for_function("$('#ed-status').innerText.includes('Merged')", timeout=10000); pg.evaluate("busy = false"); pg.wait_for_timeout(1200)
    merged = deck.read_text()
    check("an edit made in the editor while an agent wrote another slide: both kept (merged by slide)", "edited by agent again" in merged and 'data-mine="1"' in merged)
    # editing together: slides carry ids, and three versions merge slide by slide
    sids = pg.evaluate("[slides.every(s => !!s.dataset.sid), new Set(slides.map(s => s.dataset.sid)).size === slides.length, deckHTML().includes('data-sid=')]")
    check("each slide has an id of its own (data-sid), kept in the deck", sids == [True, True, True], sids)
    mg = pg.evaluate("""(() => {
      const S = (id, t) => `<section data-sid="${id}">\n  <div class="box"><div class="content">${t}</div></div>\n</section>`;
      const base = [S('a', 'A'), S('b', 'B'), S('c', 'C')];
      const r = (mine, theirs) => { const m = mergeSlides(base, mine, theirs); return [m.html.map(h => h.match(/content">([^<]*)/)[1]).join(','), m.both.join(',')]; };
      return {
        different: r([S('a', 'A1'), base[1], base[2]], [base[0], base[1], S('c', 'C2')]),
        theyInsert: r([S('a', 'A1'), base[1], base[2]], [base[0], S('n', 'N'), base[1], base[2]]),
        iInsertTheyDelete: r([base[0], S('m', 'M'), base[1], base[2]], [base[0], base[2]]),
        theyDeleteIEdit: r([base[0], S('b', 'B1'), base[2]], [base[0], base[2]]),
        iMoveTheyEdit: r([base[2], base[0], base[1]], [base[0], S('b', 'B2'), base[2]]),
        both: r([base[0], S('b', 'Bmine'), base[2]], [base[0], S('b', 'Btheirs'), base[2]]),
      }; })()""")
    check("merging by slide: edits to different slides, an insert, a delete, a move all come through; a slide changed in both keeps mine and is named",
          mg == {"different": ["A1,B,C2", ""], "theyInsert": ["A1,N,B,C", ""], "iInsertTheyDelete": ["A,M,C", ""], "theyDeleteIEdit": ["A,B1,C", ""],
                 "iMoveTheyEdit": ["C,A,B2", ""], "both": ["A,Bmine,C", "2"]}, mg)
    # a slide changed in both merges box by box (lib/merge.js): added on either side kept, removed on one side gone,
    # changed on both keeps mine; the same rules on whole deck files (what a library online merges a Mac push with)
    bx = pg.evaluate("""(() => {
      const B = (id, t, x = 0) => `<div class="box" id="${id}" style="left: ${x}px"><div class="content">${t}</div></div>`;
      const S = (sid, ...boxes) => `<section data-sid="${sid}">\n  ${boxes.join('\\n  ')}\n</section>`;
      const ids = h => [...h.matchAll(/id="([^"]+)"[^>]*><div class="content">([^<]*)/g)].map(m => m[1] + '=' + m[2]).join(',');
      const base = [S('a', B('x', 'X'), B('y', 'Y'), B('z', 'Z'))];
      const mine = [S('a', B('x', 'Xmine'), B('z', 'Z'), B('m', 'M'))];                    // change x, remove y, add m
      const theirs = [S('a', B('x', 'Xtheirs'), B('y', 'Y'), B('z', 'Z', 50), B('t', 'T'))];   // change x and z, add t
      const m = mergeSlides(base, mine, theirs);
      const deck = sl => `<!doctype html><html><head><title>T</title></head><body><div class="reveal"><div class="slides">\n${sl.join('\\n\\n')}\n</div></div></body></html>`;
      const two = [S('a', B('x', 'X')), S('b', B('v', 'V'))];
      const d2 = glideMerge.mergeDecks(deck(two), deck([S('a', B('x', 'A edited')), two[1]]), deck([two[0], S('b', B('v', 'agent grid'))]));
      const d1 = glideMerge.mergeDecks(deck(base), deck([S('a', B('x', 'X', 300), B('y', 'Y'), B('z', 'Z'))]), deck([S('a', B('x', 'X'), B('y', 'Y'), B('z', 'Z'), B('mario', 'Mario'))]));
      // an agent adds slides without data-sid after slide a (and edits one of them again) while my save changes slide a
      const N = (t) => `<section data-background-color="#ffffff">\\n  ${B('n' + t, t)}\\n</section>`;
      const d3 = glideMerge.mergeDecks(deck(two), deck([S('a', B('x', 'Slide 1 here')), two[1]]), deck([two[0], N('New 1'), N('New 2 edited'), N('New 3'), two[1]]));
      // two identical slides without ids (a hidden original beside its candidate): never paired with the wrong one; at
      // worst both kept. Both sides inserting after the same slide: all kept, mine first.
      const T = (t, sid) => `<section${sid ? ` data-sid="${sid}"` : ''}>\\n  ${B('t' + t.replace(/\\W/g, ''), t)}\\n</section>`;
      const texts = h => [...h.matchAll(/content">([^<]*)/g)].map(m => m[1]).join(',');
      const tw = glideMerge.mergeDecks(deck([T('O'), T('O')]), deck([T('O', 's1'), T('O', 's2')]), deck([T('O'), T('O cand')]));
      const ins = glideMerge.mergeDecks(deck([T('A', 'a'), T('B', 'b')]), deck([T('A', 'a'), T('m1', 'm1'), T('m2', 'm2'), T('B', 'b')]), deck([T('A', 'a'), T('t1'), T('t2'), T('B', 'b')]));
      return { twins: tw && texts(tw.html), inserts: ins && texts(ins.html), deck3: d3 && ids(d3.html), boxes: ids(m.html[0]), zmoved: m.html[0].includes('id="z" style="left: 50px"'), both: m.both.join(),
        deck2: d2 && [ids(d2.html), d2.both.join()], deck1: d1 && [ids(d1.html), d1.html.includes('id="x" style="left: 300px"'), d1.both.join()] }; })()""")
    check("merging a slide changed in both, box by box: boxes added on either side kept, one removed on one side gone, one changed on both keeps mine; whole decks merge the same way, slides an agent added without ids too (identical ones never mispaired), inserts at one spot from both sides all kept",
          bx == {"boxes": "x=Xmine,z=Z,m=M,t=T", "zmoved": True, "both": "1", "deck2": ["x=A edited,v=agent grid", ""], "deck1": ["x=X,y=Y,z=Z,mario=Mario", True, ""],
                "deck3": "x=Slide 1 here,nNew 1=New 1,nNew 2 edited=New 2 edited,nNew 3=New 3,v=V", "twins": "O,O,O cand", "inserts": "A,m1,m2,t1,t2,B"}, bx)
    # glideshow/merge.py (the Mac's sync) and lib/merge.js agree, rule for rule, on decks shaped like the three incidents
    import importlib; sys.path.insert(0, str(ROOT)); pymerge = importlib.import_module("glideshow.merge")
    cases = pg.evaluate("""(() => {
      const B = (id, t, x = 0) => `<div class="box" id="${id}" style="left: ${x}px"><div class="content">${t}</div></div>`;
      const S = (sid, ...b) => `<section${sid ? ` data-sid="${sid}"` : ''}>\\n  ${b.join('\\n  ')}\\n</section>`;
      const D = sl => `<!doctype html><html><head><title>T</title></head><body><div class="reveal"><div class="slides">\\n${sl.join('\\n\\n')}\\n</div></div></body></html>`;
      const base = [S('a', B('x', 'X'), B('y', 'Y'), B('z', 'Z')), S('b', B('v', 'V')), S('', B('o', 'O')), S('', B('o', 'O'))];
      const cs = [
        [base, [S('a', B('x', 'Xmine'), B('z', 'Z'), B('m', 'M')), base[1], base[2], base[3]], [S('a', B('x', 'Xtheirs'), B('y', 'Y'), B('z', 'Z', 50), B('t', 'T')), base[1], base[2], base[3]]],
        [base, [S('a', B('x', 'slide 1 here')), base[1], base[2], base[3]], [base[0], S('', B('n1', 'New 1')), S('', B('n2', 'New 2')), base[1], base[2], S('', B('o', 'O cand'))]],
        [base, [base[0], base[2], base[3]], [base[0], S('b', B('v', 'V grid')), base[2], base[3]]],
        [base, [base[0], S('m1', B('m1', 'm1')), base[1], base[2], base[3]], [base[0], S('', B('t1', 't1')), base[1], S('a2', B('q', 'Q')), base[2], base[3]]],
      ].map(c => c.map(D));
      return cs.map(([b, m, t]) => [b, m, t, glideMerge.mergeDecks(b, m, t)]); })()""")
    agree = [i for i, (b, m, t, js) in enumerate(cases) if pymerge.merge_decks(b, m, t) != {"html": js["html"], "both": js["both"]}]
    check("the Mac's deck merge (glideshow/merge.py) gives what the editor's and glideshow.org's (lib/merge.js) give, case for case", not agree, f"differ: {agree}")
    # stage 4: on glideshow.org someone else's change goes into every state of the undo history rather than being a step;
    # a state that would undo it is marked (undo stops there)
    rb = pg.evaluate("""(() => {
      const S = (id, t) => `<section data-sid="${id}">\n  <div class="box"><div class="content">${t}</div></div>\n</section>`;
      const text = st => st.html.map(h => h.match(/content">([^<]*)/)[1]).join(','), keep = [hist, hptr];
      hist = [{ html: [S('a', 'A'), S('b', 'B'), S('c', 'C')], cur: 0 }, { html: [S('a', 'A1'), S('b', 'B'), S('c', 'C')], cur: 0 }, { html: [S('a', 'A1'), S('b', 'B1'), S('c', 'C')], cur: 1 }]; hptr = 2;
      rebaseHistory(hist[2].html, [S('a', 'A1'), S('b', 'B1'), S('c', 'C2')], 'Kazuki');   // they change C, which no step of mine touched
      const t1 = hist.map(text), c1 = hist.map(st => (st.clash || []).join());
      rebaseHistory(hist[2].html, [S('a', 'A1'), S('b', 'B2'), S('c', 'C2')], 'Kazuki');   // they change B, which my last step changed
      const t2 = hist.map(text), c2 = hist.map(st => (st.clash || []).join()), by = hist[1].by;
      [hist, hptr] = keep;
      return { t1, c1, t2, c2, by }; })()""")
    check("undo on glideshow.org: another person's change goes into every undo state (never undone by mine); a state that would overwrite it is marked, with their name",
          rb == {"t1": ["A,B,C2", "A1,B,C2", "A1,B1,C2"], "c1": ["", "", ""], "t2": ["A,B,C2", "A1,B,C2", "A1,B2,C2"], "c2": ["b", "b", ""], "by": "Kazuki"}, rb)
    # a change made while a reload from elsewhere is on its way isn't lost under it
    was_text = pg.evaluate("() => { go(0); const b = boxes().find(b => content(b)?.textContent.trim()); const w = content(b).innerHTML; window.__p = load(true, true); content(b).textContent = 'Typed while reloading'; render(); commit(); return w; }")
    pg.evaluate("window.__p"); pg.wait_for_function("!saving && !saveTimer && !unsaved()", timeout=10000); pg.wait_for_timeout(600)
    check("a change made while the deck reloads (saved elsewhere) is kept, and saved", "Typed while reloading" in deck.read_text() and pg.evaluate("slides[0].textContent.includes('Typed while reloading')"))
    pg.evaluate("w => { go(0); content(boxes().find(b => content(b)?.textContent.includes('Typed while reloading'))).innerHTML = w; render(); commit(); }", was_text)
    pg.wait_for_function("!saving && !saveTimer && !unsaved()", timeout=10000); pg.wait_for_timeout(600)
    # two editors on the one deck, editing at once: slide 1's text in one, a new slide and slide 2's in the other; both land
    before_two = deck.read_text()
    pg2 = pg.context.new_page(); pg2.goto(URL + "edit"); pg2.wait_for_function("typeof slides !== 'undefined' && slides.length > 1 && !!mtime"); pg2.wait_for_timeout(500)
    pg.evaluate("() => { go(0); const b = boxes().find(b => content(b)?.textContent.trim()); content(b).textContent = 'Typed in editor one'; render(); commit(); }")
    pg2.evaluate("() => { go(1); const b = boxes().find(b => content(b)?.textContent.trim()); content(b).textContent = 'Typed in editor two'; render(); commit(); newSlideWith('title-only'); content(boxes()[0]).textContent = 'Added in editor two'; render(); commit(); }")
    for _ in range(40):
        disk = deck.read_text()
        if all(t in disk for t in ("Typed in editor one", "Typed in editor two", "Added in editor two")): break
        pg.wait_for_timeout(250)
    pg.wait_for_timeout(2500)
    same_now = pg.evaluate("slides.map(s => normHTML(sectionHTML(s))).join()") == pg2.evaluate("slides.map(s => normHTML(sectionHTML(s))).join()")
    check("two editors editing the one deck at once: both edits and the new slide land on disk, and both editors end up showing the same deck",
          all(t in disk for t in ("Typed in editor one", "Typed in editor two", "Added in editor two")) and same_now, [t for t in ("Typed in editor one", "Typed in editor two", "Added in editor two") if t not in disk] + [same_now])
    pg2.close()
    deck.write_text(before_two); pg.wait_for_function("!slides.some(s => s.textContent.includes('editor one'))", timeout=10000); pg.wait_for_timeout(1200)
    # an agent writes the deck while the editor has changes not yet saved (the data loss of 2026-10-21): to another slide
    # (the editor changed slide A only, the agent slide B), then to the same slide (other boxes): both land, every time
    settled = "!saving && !saveTimer && !unsaved()"
    sid_a, sid_b = pg.evaluate("""(() => { const mk = (t, id) => { const s = blankSlide(), b = makeBox({ x: 100, y: 300, w: 600, h: 100, html: t }); b.id = id; s.append(b); return s; };
      const a = mk('Slide A', 'mx-a'), b = mk('Slide B', 'mx-b'); slides.push(a, b); ensureSids(); go(slides.length - 2); render(); commit(); return [a.dataset.sid, b.dataset.sid]; })()""")
    pg.wait_for_function(settled, timeout=10000); pg.wait_for_timeout(600)
    def agent_writes(sid, fn):   # an agent's edit of one slide, straight to the file
        text = deck.read_text(); a = text.index(f'data-sid="{sid}"'); z = text.index("</section>", a)
        deck.write_text(text[:a] + fn(text[a:z]) + text[z:])
    def lands(*want, n=60):
        for _ in range(n):
            disk = deck.read_text()
            if all(w in disk for w in want): break
            pg.wait_for_timeout(250)
        pg.wait_for_function(settled, timeout=10000); pg.wait_for_timeout(1500)
        disk = deck.read_text(); return [w for w in want if w not in disk]
    pg.evaluate("() => { content(document.getElementById('mx-a')).textContent = 'A edited here'; render(); commit(); clearTimeout(saveTimer); saveTimer = null; }")
    agent_writes(sid_b, lambda sec: sec.replace(">Slide B<", ">Atari grid by the agent<"))
    lost2 = lands("A edited here", "Atari grid by the agent")
    shown2 = pg.evaluate("[slides.map(s => s.querySelector('#mx-a')).find(Boolean)?.textContent.trim(), slides.find(s => s.dataset.sid === '" + sid_b + "')?.textContent.trim()]")
    check("an agent's edit to slide B while the editor has unsaved edits to slide A only: both land on disk and in the editor (slide B isn't reverted)",
          not lost2 and shown2 == ["A edited here", "Atari grid by the agent"], f"lost={lost2} shown={shown2}")
    pg.evaluate("() => { const b = document.getElementById('mx-a'); setGeo(b, { ...geo(b), x: 900 }); render(); commit(); clearTimeout(saveTimer); saveTimer = null; }")
    agent_writes(sid_a, lambda sec: sec + '  <div class="box" id="mx-mario" style="left: 100px; top: 600px; width: 400px; height: 100px;"><div class="content">Mario tile by the agent</div></div>\n')
    lost1 = lands("Mario tile by the agent", 'id="mx-a" style="left: 900px')
    shown1 = pg.evaluate("[!!document.getElementById('mx-mario') || slides.some(s => !!s.querySelector('#mx-mario')), (slides.flatMap(s => [...s.querySelectorAll('#mx-a')])[0])?.style.left]")
    check("an agent adds a box to a slide the editor moved another box on, before it saved: both boxes kept, the move too",
          not lost1 and shown1 == [True, "900px"], f"lost={lost1} shown={shown1}")
    # the same box changed on both sides: mine kept, and a bar over the slide says so (and stays) until dismissed
    pg.evaluate("() => { $('#ed-merge-bar').hidden = true; const b = slides.flatMap(s => [...s.querySelectorAll('#mx-a')])[0]; content(b).textContent = 'Title typed here'; render(); commit(); clearTimeout(saveTimer); saveTimer = null; }")
    agent_writes(sid_a, lambda sec: re.sub(r'(id="mx-a"[^>]*><div class="content"[^>]*>)[^<]*', r'\1Title by the agent', sec))
    lost3 = lands("Title typed here"); pg.wait_for_timeout(1500)
    note = pg.evaluate("[!$('#ed-merge-bar').hidden, $('#ed-merge-what').textContent, slides.findIndex(s => !!s.querySelector('#mx-a')) + 1]")
    pg.screenshot(path=str(HERE / "shots" / "merge-note.png"))
    check("a box changed on both sides keeps mine, and a red bar over the slide names the slide and points to Version history; it outlasts the save that follows",
          not lost3 and "Title by the agent" not in deck.read_text() and note[0] and f"slide {note[2]}." in note[1] and "Version history" in note[1], f"lost={lost3} note={note}")
    pg.click("#ed-merge-close")
    pg.evaluate("() => { slides = slides.filter(s => !s.querySelector('#mx-a, #mx-b')); go(0); render(); commit(); }"); pg.wait_for_function(settled, timeout=10000); pg.wait_for_timeout(600)
    errors[:] = [e for e in errors if "409" not in e]   # the clash itself
    # two saves from the same version at the same moment: one goes in, the other is told it clashed (never both written).
    # Both sent over connections already open, all but their last byte, then finished together.
    def race(html, mt):
        import http.client, threading
        body = json.dumps({"html": html, "mtime": mt}).encode(); cs = [http.client.HTTPConnection("localhost", PORT, timeout=30) for _ in range(2)]
        for c in cs:
            c.putrequest("POST", "/api/save"); c.putheader("X-Glideshow", "1"); c.putheader("Content-Type", "application/json"); c.putheader("Content-Length", str(len(body))); c.endheaders(); c.send(body[:-1])
        time.sleep(0.1); got = [0, 0]
        def finish(i): cs[i].send(body[-1:]); got[i] = cs[i].getresponse().status
        ts = [threading.Thread(target=finish, args=(i,)) for i in range(2)]; [t.start() for t in ts]; [t.join() for t in ts]
        return ",".join(map(str, sorted(got)))
    api_deck = lambda: json.load(urllib.request.urlopen(URL + "api/deck"))
    was_deck = api_deck()["html"]
    races = [race((d := api_deck())["html"].replace("</body>", "<!--" + "x" * 500_000 + "-->" + "</body>"), d["mtime"]) for _ in range(12)]
    urllib.request.urlopen(urllib.request.Request(URL + "api/save", data=json.dumps({"html": was_deck, "mtime": api_deck()["mtime"]}).encode(), method="POST", headers={"X-Glideshow": "1"}))
    pg.wait_for_timeout(1500); pg.wait_for_function("!saving && !saveTimer && !unsaved()", timeout=10000)
    check("two saves from one version at the same moment: one is written, the other told it clashed (every time)", all(r == "200,409" for r in races), races)
    pg.evaluate("() => { go(1); startEdit(boxes().find(b => content(b)?.textContent.includes('agent again'))); }")
    pg.keyboard.press("End"); pg.keyboard.type(" typed then left"); pg.evaluate("dispatchEvent(new Event('blur'))"); pg.wait_for_timeout(1000)
    check("leaving the window saves what you typed, even mid-edit", "typed then left" in deck.read_text() and pg.evaluate("!!editing"))
    pg.keyboard.press("Escape"); pg.keyboard.press("Escape"); pg.evaluate("go(0)")
    html = deck.read_text()

    v = pg.context.browser.new_page()
    v.set_viewport_size({"width": 1280, "height": 720})
    v.on("pageerror", lambda e: errors.append("viewer: " + str(e)))
    v.goto(URL + "deck/deck.html"); v.wait_for_function("window.Reveal?.isReady?.()", timeout=20000); v.wait_for_timeout(500)
    check("viewer shows boxes", v.evaluate("document.querySelectorAll('.box').length") >= 5)
    lines = v.evaluate("""(() => { const c = [...document.querySelectorAll('.box .content')].find(c => c.textContent.startsWith('Hello from'));
      const r = document.createRange(); r.selectNodeContents(c); const qs = [...r.getClientRects()];
      const k = c.getBoundingClientRect().width / c.offsetWidth, lh = parseFloat(getComputedStyle(c).lineHeight) * k;
      return Math.round((Math.max(...qs.map(q => q.bottom)) - Math.min(...qs.map(q => q.top))) / lh * 10) / 10; })()""")
    check("inline formatting stays on one line in the viewer", lines < 1.6, f"{lines} line-heights tall")
    v.evaluate("Reveal.slide(1)"); v.wait_for_timeout(300)
    vfit = v.evaluate("(() => { const b = document.querySelector('.box[data-autofit=shrink]'); return b && +b.style.getPropertyValue('--fit'); })()")
    v.evaluate("Reveal.slide(0)"); v.wait_for_timeout(300)
    check("viewer shrinks text on overflow when the slide is shown", vfit and 0.2 < vfit < 1, str(vfit))
    look = v.evaluate("""(() => { const c = document.querySelector('.reveal .controls'), bar = document.querySelector('.sl-bar');
      return [Reveal.getConfig().controls, Reveal.getConfig().progress, getComputedStyle(document.body).backgroundColor, !!bar, bar?.querySelector('.num').textContent,
              getComputedStyle(document.querySelector('.reveal .slides section.present')).backgroundColor]; })()""")
    wake = lambda: (v.mouse.move(200, 200), v.mouse.move(60, 700), v.wait_for_selector(".sl-bar:not(.idle)"))   # the bar hides after 3 s still, as Slides': a slow run gets there first
    wake(); v.click(".sl-bar [data-a=next]"); vnum = v.evaluate("[Reveal.getIndices().h, document.querySelector('.sl-bar .num').textContent]"); wake(); v.click(".sl-bar [data-a=prev]")
    v.wait_for_timeout(3300); idle = v.evaluate("[document.querySelector('.sl-bar').classList.contains('idle'), document.documentElement.style.cursor]")
    check("presenting look: no reveal controls/progress, black letterbox, hover toolbar (◀ n ▶) that fades and hides the cursor",
          look[:2] == [False, False] and look[2] == "rgb(0, 0, 0)" and look[3] and look[4] == "1" and look[5] == "rgb(255, 255, 255)" and vnum == [1, "2"] and idle == [True, "none"], f"{look} {vnum} {idle}")
    v.mouse.move(200, 200); v.mouse.move(60, 700); v.click(".sl-bar [data-a=more]"); v.hover(".sl-pop button:has-text('Auto-play')"); v.wait_for_timeout(150)
    menu = v.evaluate("""[[...document.querySelectorAll('.sl-bar button')].map(b => b.dataset.a).join(), Reveal.getConfig().margin,
      [...document.querySelectorAll('.sl-pop')].map(m => [...m.querySelectorAll('button')].map(b => b.innerText.replace(/\\s+/g, ' ').trim()).join('|'))]""")
    v.click(".sl-pop button:has-text('Every 5 seconds')"); auto = v.evaluate("Reveal.getConfig().autoSlide"); v.evaluate("Reveal.configure({ autoSlide: 0 })")
    check("presenting toolbar is Slides' pill (◀ n ▶ ⋮), edge to edge, ⋮ menu with keys and an Auto-play submenu",
          menu[0] == "prev,num,next,more" and menu[1] == 0 and "Exit slideshow Esc" in menu[2][0] and "Every second" in menu[2][1] and auto == 5000, f"{menu} {auto}")
    v.evaluate("Reveal.slide(0)"); v.wait_for_timeout(300)
    t0 = v.evaluate("performance.now()"); v.mouse.click(640, 360); clicked = v.evaluate(f"[Reveal.getIndices().h, Math.round(performance.now() - {t0})]")
    v.mouse.move(600, 300); v.mouse.down(); v.mouse.move(700, 320, steps=4); v.mouse.up(); dragged = v.evaluate("Reveal.getIndices().h")
    v.keyboard.press("b"); v.mouse.click(640, 360); lifted = v.evaluate("[!!document.querySelector('body > div[data-c]'), Reveal.getIndices().h]")
    wake(); v.click(".sl-bar [data-a=more]"); v.mouse.click(640, 360); closed = v.evaluate("[!!document.querySelector('.sl-pop'), Reveal.getIndices().h]")
    v.evaluate("Reveal.slide(0)")
    check(f"a click on the slide advances, as Keynote and Slides ({clicked[1]} ms); a drag doesn't, nor the click that lifts the black screen or closes the menu",
          clicked[0] == 1 and dragged == 1 and lifted == [False, 1] and closed == [False, 1], f"{clicked} {dragged} {lifted} {closed}")
    v.evaluate("""(() => { const s = Reveal.getSlides(), a = document.createElement('a'); a.href = '#last'; a.textContent = 'to the end'; a.id = 'lk-last';
      a.style.cssText = 'position:absolute;left:0;top:0;font-size:60px'; s[0].append(a);
      const b = document.createElement('div'); b.className = 'box'; b.dataset.link = '#slide=' + s[1].dataset.sid; b.id = 'lk-box'; b.style.cssText = 'position:absolute;left:0;top:300px;width:200px;height:200px;background:#09f';
      s.at(-1).append(b); Reveal.slide(0); })()"""); v.wait_for_timeout(300)
    v.click("#lk-last"); v.wait_for_timeout(200); at_last = v.evaluate("Reveal.getSlides().indexOf(Reveal.getCurrentSlide()) === Reveal.getSlides().length - 1")
    v.click("#lk-box"); v.wait_for_timeout(200); at_sid = v.evaluate("Reveal.getSlides().indexOf(Reveal.getCurrentSlide())")
    v.evaluate("(() => { document.getElementById('lk-last').remove(); document.getElementById('lk-box').remove(); Reveal.slide(0); })()")
    check("in the slideshow a #last text link and a linked box (#slide=<sid>) go there, and the click doesn't also advance", at_last and at_sid == 1, f"{at_last} {at_sid}")
    v.evaluate("""(() => { const s = Reveal.getSlides()[0], mk = (i, start) => { const b = document.createElement('div'); b.className = 'box fragment fade-in'; b.dataset.fragmentIndex = i;
        if (start) b.dataset.start = start; b.dataset.delay = '0.2'; b.style.cssText = 'position:absolute;left:0;top:0;width:10px;height:10px'; b.id = 'tm-' + i; s.append(b); };
      mk(0, 'transition'); mk(1, ''); mk(2, 'after'); Reveal.sync(); Reveal.slide(1); Reveal.slide(0, 0, -1); })()""")
    v.wait_for_timeout(1600); auto1 = v.evaluate("Reveal.getIndices().f")
    v.evaluate("Reveal.nextFragment()"); v.wait_for_timeout(1500); auto2 = v.evaluate("Reveal.getIndices().f")
    v.evaluate("(() => { ['tm-0', 'tm-1', 'tm-2'].forEach(id => document.getElementById(id).remove()); Reveal.sync(); Reveal.slide(0); })()")
    check("slideshow: a build After transition plays by itself, the next waits for a click, an After previous one follows it", auto1 == 0 and auto2 == 2, f"{auto1} {auto2}")
    vbg = v.evaluate("(() => { const s = document.createElement('section'); s.dataset.backgroundGradient = 'linear-gradient(90deg, #ff0000, #0000ff)'; return window.bgCss?.(s).background; })()")
    check("the slideshow paints background gradients through shapes.js's bgCss", vbg == "linear-gradient(90deg, #ff0000, #0000ff)", str(vbg))
    v.evaluate("""(() => { const s = Reveal.getSlides()[0]; for (const i of [0, 1]) { const b = document.createElement('div'); b.className = 'box fragment fade-in'; b.dataset.fragmentIndex = i; b.id = 'kb-' + i; s.append(b); }
      Reveal.sync(); Reveal.slide(0, 0, 1); })()"""); v.wait_for_timeout(200)
    v.keyboard.press("Shift+ArrowLeft"); back1 = v.evaluate("[Reveal.getIndices().h, Reveal.getIndices().f]")
    v.keyboard.press("h"); v.keyboard.press("k"); still = v.evaluate("Reveal.getIndices().h")
    t0 = v.evaluate("performance.now()"); v.keyboard.press("Shift+ArrowRight"); skip = v.evaluate(f"[Reveal.getIndices().h, Math.round(performance.now() - {t0})]")
    v.keyboard.press("Shift+Slash"); v.wait_for_timeout(100); v.screenshot(path=str(HERE / "show-keys.png")); v.keyboard.press("Escape")
    v.evaluate("(() => { ['kb-0', 'kb-1'].forEach(id => document.getElementById(id).remove()); Reveal.sync(); Reveal.slide(0); })()")
    check(f"slideshow keys as Keynote: ⇧← takes back one build, ⇧→ goes to the next slide past the rest ({skip[1]} ms), reveal's H / K do nothing",
          back1 == [0, 0] and still == 0 and skip[0] == 1, f"{back1} {still} {skip}")
    check("decks carry present.js (Slides' presenting keys)", v.evaluate("!!document.getElementById('deck-present') && !Reveal.getConfig().keyboard[79] && Reveal.getConfig().keyboard[79] === null"))
    check("viewer loads the notes plugin (S = speaker view)", v.evaluate("!!(window.Reveal && Reveal.hasPlugin('notes'))"))
    v.screenshot(path=str(HERE / "viewer.png"))

    # the insert bar, last: it adds and removes boxes on the current slide
    dk = pg.evaluate("""(() => { const d = document.querySelector('#ed-dock'), r = d.getBoundingClientRect(), s = document.querySelector('#ed-stage-wrap').getBoundingClientRect();
      const n0 = boxes().length; window.__before = new Set(boxes()); document.querySelector('#ed-dock [data-do=note]').click(); const note = boxes().find(b => b.classList.contains('note'));
      stopEdit(); document.querySelector('#ed-dock [data-do=text]').click(); const n1 = boxes().length; stopEdit();
      document.querySelector('#ed-dock [data-do=shape]').click(); const m = document.querySelector('.menu'), mr = m?.getBoundingClientRect();
      const above = !!mr && mr.bottom <= r.top; closeMenu();
      return [!d.hidden, Math.abs((r.left + r.right) / 2 - (s.left + s.right) / 2) < 2, r.top - s.bottom, !!note && note === editing || !!note, n1 - n0, above,
        [...d.querySelectorAll('button')].map(b => b.dataset.do).join()]; })()""")
    check("insert bar: a pill centred in its own row under the stage (never over the slide); Note for AI adds a sticky, Text box a box, Shape opens its picker above the bar",
          dk[0] and dk[1] and 0 <= dk[2] <= 16 and dk[3] and dk[4] == 1 and dk[5] and dk[6] == "select,text,shape,line,image,table,code,equation,note", str(dk))
    pg.click("#ed-menubar [data-menu=View]"); pg.click(".menu-item:has(.menu-label:text-is('Show insert bar'))"); pg.wait_for_timeout(100); pg.evaluate("closeMenu()")
    hid = pg.evaluate("[document.querySelector('#ed-dock').hidden, localStorage.getItem('slides-dock')]")
    pg.click("#ed-menubar [data-menu=View]"); pg.click(".menu-item:has(.menu-label:text-is('Show insert bar'))"); pg.wait_for_timeout(100); pg.evaluate("closeMenu()")
    check("View → Show insert bar hides the bar and remembers it; again shows it", hid == [True, "0"] and pg.evaluate("!document.querySelector('#ed-dock').hidden"), str(hid))
    pg.evaluate("stopEdit(); sel = new Set(boxes().filter(b => !window.__before.has(b))); if (sel.size) deleteSelection(); sel = new Set()"); pg.wait_for_timeout(100)   # what the bar added, gone again

def reveal_checks(b, errors, deck_file: Path):
    """reveal.js beyond positioned boxes: Morph (Auto-Animate), live boxes, more build effects, video and web-page
    backgrounds, a slide's own style, scroll view. Each through the editor, then the saved file, then the slideshow."""
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.on("console", lambda m: m.type == "error" and "ERR_" not in m.text and errors.append(m.text)); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL + "edit"); pg.wait_for_function("typeof slides !== 'undefined' && slides.length > 0", timeout=20000); pg.wait_for_timeout(500)
    saved = lambda: deck_file.read_text()
    def settle(): pg.wait_for_function("document.querySelector('#ed-status').innerText.includes('saved')", timeout=20000); pg.wait_for_timeout(300)

    # Morph: a slide with a box, Duplicate slide (the copy remembers its original), the copy's box moved, Morph on the copy
    first = pg.evaluate("""() => { slides.push(document.createElement('section')); go(slides.length - 1);
      const b = makeBox({ x: 100, y: 100, w: 300, h: 200, shape: 'rect', html: 'Morph me' }); b.dataset.shape = 'rect'; slides[cur].append(b); render(); commit();
      dupSlides(); const c = boxes(slides[cur])[0]; c.style.left = '1200px'; c.style.top = '600px'; render(); commit(); return slides.length - 2; }""")
    pg.evaluate("setTransPanel(true); document.querySelector('#ed-trans details').open = true"); pg.select_option("#ed-t-kind", "morph"); settle()
    m = pg.evaluate("""() => { const a = boxes(slides[cur - 1])[0], c = boxes(slides[cur])[0];
      return [slides[cur].hasAttribute('data-auto-animate'), c.dataset.morph === a.id, c.id !== a.id, !!document.querySelectorAll('#ed-thumbs .thumb')[cur].querySelector('.has-trans'), $('#ed-t-name').textContent]; }""")
    check("Morph: Slide → Transition offers Morph (data-auto-animate); Duplicate slide pairs each copy with its original (data-morph); the filmstrip marks it",
          m == [True, True, True, True, "Morph"] and saved().count("data-auto-animate") >= 1, str(m))
    v = b.new_page(viewport={"width": 1280, "height": 720}); v.on("pageerror", lambda e: errors.append(str(e)))
    v.goto(URL + "deck/deck.html"); v.wait_for_function("window.Reveal?.isReady?.()", timeout=20000); v.wait_for_timeout(300)
    v.evaluate(f"Reveal.slide({first})"); v.wait_for_timeout(300); v.evaluate("Reveal.next()"); v.wait_for_timeout(120)
    run = v.evaluate("""() => { const s = Reveal.getCurrentSlide(), t = s.querySelector('.box[data-auto-animate-target]');
      return [s.getAttribute('data-auto-animate'), !!t, Reveal.getSlides()[Reveal.getIndices().h - 1]?.hasAttribute('data-auto-animate')]; }""")
    check("…in the slideshow the box morphs: reveal's Auto-Animate pairs it with the slide before's (both slides marked, the box a target)",
          run[0] == "running" and run[1] and run[2], str(run))

    # builds: more effects; by paragraph; a stack of pictures shown one after another
    eff = pg.evaluate("EFFECTS.map(e => e[0])")
    dl = pg.evaluate("""() => { slides.push(document.createElement('section')); go(slides.length - 1);
      const w = makeBox({ x: 100, y: 100, w: 900, h: 150, html: 'alpha beta gamma' }), h = makeBox({ x: 100, y: 300, w: 900, h: 300, html: '<ul><li>Hi one</li><li>Hi two</li></ul>' });
      const tb = makeBox({ x: 1100, y: 100, w: 600, h: 200, cls: 'table', html: '<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td><td>e</td><td>f</td></tr></table>' });
      slides[cur].append(w, h, tb); render(); for (const b of [w, h, tb]) { sel = new Set([b]); addAnim(); }
      w.dataset.build = 'word'; h.dataset.build = 'highlight'; tb.dataset.build = 'column'; commit(); render(); sel = new Set([tb]); renderAnims();
      return [deliveries(w).map(d => d[1]), deliveries(tb).map(d => d[1]), [...document.querySelectorAll('.anim-row .eff')].map(e => e.textContent.split('  ')[0])]; }""")
    check("Motion panel → Delivery: text All at once / By paragraph / By highlighted paragraph / By word / By character; a table By row / column / cell",
          dl[0] == ["All at once", "By paragraph", "By highlighted paragraph", "By word", "By character"] and dl[1] == ["All at once", "By row", "By column", "By cell"]
          and dl[2] == ["Fade in by word", "Fade in by highlighted paragraph", "Fade in by column"], str(dl))
    pg.evaluate("""() => { slides.push(document.createElement('section')); go(slides.length - 1);
      const t = makeBox({ x: 100, y: 100, w: 900, h: 500, html: '<ul><li>One</li><li>Two</li><li>Three</li></ul>' }), after = makeBox({ x: 1100, y: 100, w: 500, h: 200, html: 'After' });
      slides[cur].append(t, after); render(); sel = new Set([t]); addAnim(); sel = new Set([after]); addAnim();
      setEffect(t, 'fade-in-then-semi-out'); t.dataset.build = 'paragraph'; t.dataset.duration = '1.2'; t.dataset.ease = 'ease-in'; t.dataset.delay = '0.5'; commit(); render(); }""")
    pg.wait_for_selector("#ed-anim-list .anim-row select.dl", state="attached")
    pics = pg.evaluate("""() => { slides.push(document.createElement('section')); go(slides.length - 1);
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const ps = [0, 1, 2].map(i => makeBox({ x: 100 + i * 500, y: 200 + i * 40, w: 400, h: 300, cls: 'image', html: `<img src="${png}" alt="">` }));
      slides[cur].append(...ps); render(); sel = new Set(ps); stackSequence();
      return ps.map(p => [p.style.left, p.style.top, [...p.classList].filter(c => /fade|appear/.test(c)).join(' '), p.dataset.fragmentIndex, 'withPrevious' in p.dataset]); }""")
    settle()
    check("builds: Fade out, Dim, Fade in then out / then dim, Highlight, Grow, Shrink, Strike; Arrange → Stack as a sequence puts pictures in one place, shown one after another",
          {"fade-out", "semi-fade-out", "fade-in-then-out", "fade-in-then-semi-out", "highlight-current-blue", "grow", "shrink", "strike"} <= set(eff)
          and len({(p[0], p[1]) for p in pics}) == 1 and [p[2] for p in pics] == ["fade-out", "fade-in-then-out", "fade-in"] and pics[0][3] == pics[1][3] and pics[0][4], f"{eff} {pics}")
    v.reload(); v.wait_for_function("window.Reveal?.isReady?.()", timeout=20000); v.wait_for_timeout(300)
    para = v.evaluate("""() => { const s = Reveal.getSlides().at(-2), li = [...s.querySelectorAll('li')];
      return [li.map(l => l.className.includes('fragment fade-in-then-semi-out') ? l.dataset.fragmentIndex : '-'), [...s.querySelectorAll('.box')].find(b => b.textContent === 'After')?.dataset.fragmentIndex,
        li.map(l => [l.style.transitionDuration, l.style.transitionTimingFunction, l.style.transitionDelay].join(' ').trim())]; }""")
    check("…by paragraph: in the slideshow each bullet is its own step, with the box's effect, and the next animation follows them",
          para[:2] == [["0", "1", "2"], "3"], str(para))
    check("…its timing (1.2 s, ease in, 0.5 s delay) plays on every bullet, the delay on the first only", para[2] == ["1.2s ease-in 0.5s", "1.2s ease-in", "1.2s ease-in"], str(para[2]))
    dv = v.evaluate("""() => { const s = Reveal.getSlides().find(x => x.textContent.includes('alpha beta')), w = [...s.querySelectorAll('.box')].find(b => b.textContent.includes('alpha'));
      const cells = [...s.querySelectorAll('td')].map(c => c.dataset.fragmentIndex), li = [...s.querySelectorAll('li')];
      return [w.querySelectorAll('.gs-w').length, w.classList.contains('gs-seq'), cells, li.map(l => l.classList.contains('gs-hl') && l.classList.contains('fragment')), Reveal.getIndices(s).h]; }""")
    v.evaluate(f"Reveal.slide({dv[4]}, 0, -1)"); v.wait_for_timeout(900); v.evaluate("Reveal.nextFragment()")
    v.wait_for_timeout(200); mid = v.evaluate("[...document.querySelectorAll('.reveal .present .gs-w')].map(w => +getComputedStyle(w).opacity)")
    v.wait_for_timeout(1400); end = v.evaluate("[...document.querySelectorAll('.reveal .present .gs-w')].map(w => +getComputedStyle(w).opacity > .99)")
    v.evaluate("Reveal.slide(0)")
    check("…in the slideshow: by word, the words arrive one after another in one step; by highlighted paragraph each bullet is a step; a table by column builds column by column",
          dv[:2] == [3, True] and dv[2] == ["3", "4", "5", "3", "4", "5"] and dv[3] == [True, True] and mid[0] > .05 and mid[2] == 0 and all(end), f"{dv} {mid} {end}")

    # live box: its own page in assets/, sandboxed in the slide and served with a sandbox policy; double-click edits it
    pg.evaluate("go(slides.length - 1)"); pg.evaluate("addLive()"); pg.wait_for_function("boxes(slides[cur]).some(b => b.classList.contains('live'))"); settle()
    live = pg.evaluate("""async () => { const b = boxes(slides[cur]).find(b => b.classList.contains('live')), f = b.querySelector('iframe'), src = f.getAttribute('src'), r = await fetch(src);
      return [f.getAttribute('sandbox'), src, (await r.text()).includes('<canvas'), r.headers.get('content-security-policy'), !!document.querySelectorAll('#ed-thumbs .thumb')[cur].querySelector('.live-still') && !document.querySelectorAll('#ed-thumbs .thumb')[cur].querySelector('iframe')]; }""")
    pg.evaluate("editLive(boxes(slides[cur]).find(b => b.classList.contains('live')))"); pg.wait_for_selector("#ed-livedlg:not([hidden])")
    pg.fill("#ed-live-code", "<!doctype html><p id=hello>Hello from a live box</p><script>document.title = 'ran'</script>"); pg.click("#ed-live-ok"); settle()
    src2 = pg.evaluate("boxes(slides[cur]).find(b => b.classList.contains('live')).querySelector('iframe').getAttribute('src')")
    check("live box: Insert → Live box puts a page of its own in assets/, run in a sandboxed iframe (scripts only) and served with a sandbox policy; thumbnails don't run it; double-click edits its page",
          live[0] == "allow-scripts allow-pointer-lock" and live[1].startswith("assets/") and live[1].endswith(".html") and live[2] and "sandbox" in (live[3] or "") and live[4]
          and src2 != live[1] and "Hello from a live box" in (deck_file.parent / src2).read_text(), f"{live} {src2}")
    for _ in range(40):   # (the status can still read "saved" from the save before)
        if src2 in saved(): break
        pg.wait_for_timeout(250)
    v.reload(); v.wait_for_function("window.Reveal?.isReady?.()", timeout=20000); v.evaluate("Reveal.slide(Reveal.getTotalSlides() - 1)"); v.wait_for_timeout(1200)
    fr = next((f for f in v.frames if f.url.endswith(src2)), None)
    ran = [fr.evaluate("document.title"), fr.evaluate("(() => { try { return String(!!parent.document) } catch { return 'blocked' } })()")] if fr else None
    check("…in the slideshow the page runs, in its sandbox", ran == ["ran", "blocked"], f"{ran} {src2} {[f.url for f in v.frames]}")

    # backgrounds: a web page (the dialog) and a video (as the dialog writes it)
    pg.evaluate("showBgDialog(true)"); pg.click("#ed-bg-page"); pg.fill("#ed-url-in", "https://localhost:9/bg"); pg.click("#ed-url-ok"); settle()
    bg = pg.evaluate("[slides[cur].dataset.backgroundIframe, !!document.querySelector('#ed-frame > .bg-media iframe'), !!document.querySelectorAll('#ed-thumbs .thumb')[cur].querySelector('.bg-media .icon')]")
    clip = next((deck_file.parent / "assets").glob("*.webm"), None)   # the video made in checks(), else a stand-in (then only where it plays is checked)
    if not clip: clip = deck_file.parent / "assets" / "clip.mp4"; clip.write_bytes(b"\0" * 64)
    pg.evaluate("""src => { const s = slides[cur - 1]; Object.assign(s.dataset, { backgroundVideo: src, backgroundVideoLoop: '', backgroundVideoMuted: '' }); render(); commit(); }""", "assets/" + clip.name); settle()
    if clip.suffix == ".webm": pg.wait_for_function("(document.querySelectorAll('#ed-thumbs .thumb')[cur - 1].querySelector('.bg-media')?.style.background || '').includes('data:image/jpeg')", timeout=10000)
    vid = pg.evaluate("""() => { const t = document.querySelectorAll('#ed-thumbs .thumb')[cur - 1].querySelector('.bg-media'); return [!!t, !t.querySelector('video')]; }""")
    v.reload(); v.wait_for_function("window.Reveal?.isReady?.()", timeout=20000); v.evaluate("Reveal.slide(Reveal.getTotalSlides() - 1)"); v.wait_for_timeout(800)
    rbg = v.evaluate("""() => { const b = Reveal.getSlideBackground(Reveal.getTotalSlides() - 1), p = Reveal.getSlideBackground(Reveal.getTotalSlides() - 2);
      return [b?.querySelector('iframe')?.getAttribute('src') || b?.querySelector('iframe')?.dataset?.src || '', !!p?.querySelector('video') || Reveal.getSlides().at(-2).hasAttribute('data-background-video')]; }""")
    check("backgrounds: a web page (Background → Web page) and a video play behind the slide; the editor shows them, thumbnails a still",
          bg == ["https://localhost:9/bg", True, True] and vid == [True, True] and rbg[0] == "https://localhost:9/bg" and rbg[1], f"{bg} {vid} {rbg}")

    # a slide's own style, scoped to it in the editor and the slideshow; scroll view by ?view=scroll
    pg.evaluate("editSlideCSS()"); pg.wait_for_selector("#ed-livedlg:not([hidden])"); pg.fill("#ed-live-code", ".box > .content { color: rgb(255, 0, 0); }"); pg.click("#ed-live-ok"); settle()
    css = pg.evaluate("""() => { const red = b => getComputedStyle(content(b)).color === 'rgb(255, 0, 0)';
      const here = boxes(slides[cur]).filter(b => !b.classList.contains('live')).every(red) && boxes(slides[cur]).length > 0, other = boxes(slides[cur - 1]).some(red);
      return [here, other, slides[cur].querySelector(':scope > style')?.getAttribute('media'), getComputedStyle(document.querySelector('#ed-title')).color !== 'rgb(255, 0, 0)']; }""")
    pg.evaluate("() => { boxes(slides[cur]).forEach(b => { if (!b.classList.contains('live')) b.remove(); }); slides[cur].append(makeBox({ x: 100, y: 800, w: 600, h: 100, html: 'Styled' })); render(); commit(); }"); settle()
    css = [pg.evaluate("getComputedStyle(content(boxes(slides[cur]).find(b => b.textContent === 'Styled'))).color === 'rgb(255, 0, 0)'"), *css[1:]]
    v.reload(); v.wait_for_function("window.Reveal?.isReady?.()", timeout=20000); v.wait_for_timeout(300)
    vcss = v.evaluate("""() => { const red = el => getComputedStyle(el).color === 'rgb(255, 0, 0)', all = Reveal.getSlides();
      return [red([...all.at(-1).querySelectorAll('.box > .content')].find(c => c.textContent === 'Styled')), [...all.at(-2).querySelectorAll('.box > .content')].some(red)]; }""")
    check("a slide's own style (Slide → Slide style): stored inert in the slide, applied to that slide only, in the editor and the slideshow",
          css == [True, False, "not all", True] and vcss == [True, False] and 'class="slide-css" media="not all"' in saved(), f"{css} {vcss}")
    v.goto(URL + "deck/deck.html?view=scroll"); v.wait_for_function("window.Reveal?.isReady?.()", timeout=20000); v.wait_for_timeout(500)
    check("…and ?view=scroll reads the deck as a scrolling page (reveal's scroll view)", v.evaluate("Reveal.isScrollView?.() === true"))
    v.close(); pg.close()


def look_checks(b, errors):
    """The Thermal look's shorter toolbar (editor/js/toolbar-groups.js): one place per control, ▾ trays, only what fits the selection."""
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text)); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL + "edit?look=thermal"); pg.wait_for_function("document.fonts.check('20px \\'Material Symbols Outlined\\'')", timeout=20000); pg.wait_for_timeout(500)
    shown = """() => [...document.querySelectorAll('#ed-toolbar button, #ed-toolbar input#ed-size')].filter(e => e.getClientRects().length && !e.closest('.tray, #ed-more-pop, #ed-more-wrap'))
      .map(e => e.id || (e.dataset.for ? 'swatch-' + e.dataset.for : e.className)).filter(x => !['ed-collapse', 'ed-new-slide-btn', 'ed-new-slide-more', 'ed-undo', 'ed-redo', 'ed-zoom'].includes(x))"""
    pick = """kind => { stopEdit(); sel.clear();
      const b = makeBox({ x: 300, y: 300, w: 600, h: 200, html: kind === 'line' || kind === 'image' ? '' : 'Some text' });
      if (kind === 'shape') b.dataset.shape = 'rect';
      if (kind === 'line') b.dataset.shape = 'line';
      if (kind === 'image') { b.classList.add('image'); b.querySelector('.content').innerHTML = '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">'; }
      b.id = 'look-' + kind; slides[cur].append(b); render(); sel.add(slides[cur].querySelector('#look-' + kind)); drawOverlay(); updateToolbar(); }"""
    def select(kind): pg.evaluate(pick, kind); pg.wait_for_timeout(150)
    def tidy(): pg.evaluate("() => { stopEdit(); sel.clear(); document.querySelectorAll('#ed-canvas .box[id^=look-]').forEach(x => slides[cur].querySelector('#' + x.id)?.remove()); render(); drawOverlay(); updateToolbar(); }")

    base = pg.evaluate("() => [document.documentElement.classList.contains('tb-grouped'), ...['#ed-add-text', '#ed-print', '#ed-paint-format', '#ed-animate'].map(s => !!document.querySelector(s).getClientRects().length), !!document.querySelector('#ed-dock [data-do=text]').getClientRects().length]")
    check("Thermal toolbar: inserting is the insert bar's only, Print, Paint format and Animate leave the toolbar", base == [True, False, False, False, False, True], str(base))
    none = pg.evaluate(shown)
    check("Thermal toolbar, nothing selected: only the slide's Background, Layout, Theme, Transition", none == ["ed-background", "ed-layout-btn", "ed-theme-btn", "ed-transition"], str(none))
    select("text"); text = pg.evaluate(shown)
    check("Thermal toolbar, a text box: font, size, B, I, text style ▾, paragraph ▾, link, Format options (no fill or border until it has one)",
          text == ["ed-font", "ed-size-down", "ed-size", "ed-size-up", "ed-bold", "ed-italic", "ed-textstyle", "ed-para", "ed-link", "ed-format-options"], str(text))
    pg.click("#ed-textstyle"); pg.wait_for_timeout(150)
    tray = pg.evaluate("() => [...document.querySelectorAll('#ed-textstyle-tray.open > button')].filter(e => e.getClientRects().length).map(e => e.id || 'swatch-' + e.dataset.for)")
    pg.click("#ed-underline"); pg.wait_for_timeout(200)
    under = pg.evaluate("() => [getComputedStyle(slides[cur].querySelector('#look-text .content')).textDecorationLine, document.querySelector('#ed-textstyle-tray').classList.contains('open')]")
    check("the text style tray holds underline, text color, highlight, clear formatting; underline applies and the tray stays open", tray == ["ed-underline", "swatch-color", "swatch-hilite", "ed-clear-fmt"] and under == ["underline", True], f"{tray} {under}")
    pg.click("#ed-canvas", position={"x": 20, "y": 20}); pg.wait_for_timeout(150)
    select("text"); pg.click("#ed-para"); pg.wait_for_timeout(150); pg.click("#ed-align"); pg.wait_for_timeout(150)
    both = pg.evaluate("() => [!!document.querySelector('.menu'), document.querySelector('#ed-para-tray').classList.contains('open')]")
    pg.click(".align-pop .align-btn[data-v=center]"); pg.wait_for_timeout(200)
    para = pg.evaluate("() => [getComputedStyle(slides[cur].querySelector('#look-text .content')).textAlign, document.querySelector('#ed-para .glyph').textContent]")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(100)
    closed = pg.evaluate("() => document.querySelector('#ed-para-tray').classList.contains('open')")
    check("the paragraph tray: a control's menu opens over it, centring applies, the ▾ button shows the alignment, Esc closes it",
          both == [True, True] and para == ["center", "format_align_center"] and not closed, f"{both} {para} {closed}")
    tidy(); select("shape"); shape = pg.evaluate(shown)
    check("Thermal toolbar, a shape: fill, border ▾, then its text's controls", shape[:2] == ["swatch-fill", "ed-border"] and "ed-bold" in shape and "ed-ends" not in shape, str(shape))
    pg.click("#ed-border"); pg.wait_for_timeout(150); pg.click("#ed-sw"); pg.wait_for_timeout(150)
    pg.click(".menu .menu-item >> nth=3"); pg.wait_for_timeout(200)
    sw = pg.evaluate("() => slides[cur].querySelector('#look-shape').style.getPropertyValue('--sw')")
    check("the border tray holds border color, weight and dash; a weight from it applies", sw not in ("", None), sw)
    tidy(); select("line"); line = pg.evaluate(shown)
    check("Thermal toolbar, a line: border ▾ and arrowheads ▾, no text or fill", line[:2] == ["ed-border", "ed-ends"] and not {"ed-bold", "swatch-fill", "ed-textstyle"} & set(line), str(line))
    tidy(); select("image"); image = pg.evaluate(shown)
    check("Thermal toolbar, an image: crop and Replace, no text controls", {"ed-crop", "ed-replace-image"} <= set(image) and not {"ed-bold", "ed-font"} & set(image), str(image))
    tidy(); select("text"); pg.set_viewport_size({"width": 1100, "height": 800}); pg.wait_for_timeout(300)
    fits = pg.evaluate("() => document.querySelector('#ed-more-wrap').hidden")
    check("the shorter toolbar fits a 1100 px window with a text box selected (nothing moves into ⋯)", fits)
    select("text"); pg.click("#ed-menubar [data-menu=Format]"); pg.click(".menu-item:has-text('Paint format')"); pg.wait_for_timeout(100)
    paint = pg.evaluate("() => [document.body.classList.contains('painting'), document.querySelector('#ed-paint-format').classList.contains('on')]")
    pg.keyboard.press("Escape")
    check("Format → Paint format starts painting (its toolbar button is gone in this look)", paint == [True, True], str(paint))
    # View → Floating toolbar: the toolbar as a bar over the selection; Menus, undo, redo and zoom in the top row; remembered
    tidy(); pg.set_viewport_size({"width": 1440, "height": 900})
    pg.click("#ed-menubar [data-menu=View]"); pg.click(".menu-item:has-text('Floating toolbar')"); pg.wait_for_timeout(200)
    top = pg.evaluate("() => [document.documentElement.classList.contains('tb-float'), !!document.querySelector('#ed-menubar').getClientRects().length, !!document.querySelector('#ed-toolbar').getClientRects().length, ['ed-menus', 'ed-undo', 'ed-redo', 'ed-zoom'].every(i => document.getElementById(i).closest('#ed-top'))]")
    check("Floating toolbar: no menu bar, no toolbar with nothing selected, Menus, undo, redo and zoom in the top row", top == [True, False, False, True], str(top))
    pg.click("#ed-menus input"); pg.wait_for_timeout(150)
    menus = pg.evaluate("() => [...document.querySelectorAll('.menu > .menu-item .menu-label')].map(e => e.textContent)")
    pg.hover(".menu-item:has-text('Format')"); pg.wait_for_timeout(150)
    sub = pg.evaluate("() => document.querySelectorAll('.menu').length")
    pg.keyboard.type("ruler"); pg.wait_for_timeout(150)
    hits = pg.evaluate("() => [...document.querySelectorAll('.menu .menu-label')].map(e => e.textContent)")
    pg.keyboard.press("Escape")
    check("Menus, empty, lists the menu bar's menus (each opens as before); typing searches every command",
          menus == ["File", "Edit", "View", "Insert", "Format", "Slide", "Arrange", "Tools", "Help"] and sub >= 2 and "Show ruler" in hits, f"{menus} {sub} {hits}")
    select("text")
    where = pg.evaluate("""() => { const t = document.querySelector('#ed-toolbar').getBoundingClientRect(), b = document.querySelector('.sel-box').getBoundingClientRect();
      return [t.height > 0, t.bottom <= b.top, Math.abs((t.left + t.right) / 2 - (b.left + b.right) / 2) < 2] }""")
    check("Floating toolbar: a text box gets the bar above it, centred", where == [True, True, True], str(where))
    pg.evaluate("() => { const b = slides[cur].querySelector('#look-text'); b.style.top = '10px'; render(); drawOverlay(); }"); pg.wait_for_timeout(100)
    flip = pg.evaluate("() => document.querySelector('#ed-toolbar').getBoundingClientRect().top >= document.querySelector('.sel-box').getBoundingClientRect().bottom")
    check("Floating toolbar: over a box at the top of the slide, the bar goes below it", flip)
    pg.evaluate("() => { const b = slides[cur].querySelector('#look-text'); b.style.top = '40px'; render(); drawOverlay(); }"); pg.wait_for_timeout(100)
    ruler = pg.evaluate("() => { const t = document.querySelector('#ed-toolbar').getBoundingClientRect(), r = document.querySelector('#ed-ruler-h').getBoundingClientRect(); return [t.top >= r.bottom, t.top >= document.querySelector('.sel-box').getBoundingClientRect().bottom]; }")
    check("Floating toolbar: never over the ruler (a box just under it gets the bar below)", ruler == [True, True], str(ruler))
    pg.click("#ed-textstyle"); pg.wait_for_timeout(150); pg.click("#ed-underline"); pg.wait_for_timeout(150)
    fu = pg.evaluate("() => getComputedStyle(slides[cur].querySelector('#look-text .content')).textDecorationLine")
    pg.click("#ed-format-options"); pg.wait_for_timeout(200)
    fo = pg.evaluate("() => !document.querySelector('#ed-fmt').hidden")
    pg.click("#ed-format-options"); pg.wait_for_timeout(100)
    check("Floating toolbar: its trays work, and ⋯ (Format options) opens the Format card", fu == "underline" and fo, f"{fu} {fo}")
    pg.reload(); pg.wait_for_timeout(1200)
    kept = pg.evaluate("() => document.documentElement.classList.contains('tb-float')")
    pg.click("#ed-menus input"); pg.click(".menu-item:has-text('View')"); pg.click(".menu-item:has-text('Floating toolbar')"); pg.wait_for_timeout(200)
    back = pg.evaluate("() => [document.documentElement.classList.contains('tb-float'), !!document.querySelector('#ed-menubar').getClientRects().length, document.querySelector('#ed-undo').closest('#ed-toolbar') !== null, !!document.querySelector('#ed-toolbar').getClientRects().length]")
    check("Floating toolbar is remembered across a reload, and turning it off brings the menu bar and toolbar back", kept and back == [False, True, True, True], f"{kept} {back}")
    tidy()
    # the light / dark switch, in the editor and on the home screen (js/theme-toggle.js); the same choice in both
    flips = []
    for path in ("edit", "", "edit"):
        pg.goto(URL + path); pg.wait_for_selector("#theme-toggle"); pg.wait_for_timeout(300)
        was = pg.evaluate("document.body.classList.contains('dark')"); pg.click("#theme-toggle"); pg.wait_for_timeout(900)
        flips.append(pg.evaluate("[document.body.classList.contains('dark'), localStorage.getItem('slides-dark'), document.querySelector('#theme-toggle').textContent.trim()]") + [was])
    pg.click("#ed-menubar [data-menu=View]"); pg.click(".menu-item:has-text('Dark mode')"); pg.wait_for_timeout(900)
    menu = pg.evaluate("[document.body.classList.contains('dark'), document.querySelector('#theme-toggle').textContent.trim()]")
    check("the sun / moon switch turns dark mode on and off in the editor and on the home screen, remembered across both; View → Dark mode moves it too",
          [f[:3] for f in flips] == [[True, "1", "light_mode"], [False, "0", "dark_mode"], [True, "1", "light_mode"]] and flips[0][3] is False and menu == [False, "dark_mode"], f"{flips} {menu}")
    # Thermal is the default look, on a phone too; ?look=google gives Google Slides' (remembered)
    looks, fresh = [], getattr(b, "plain_context", b.new_context)().new_page()   # a browser that never chose a look
    for q in ("", "?look=google", "", "?look=thermal", "?phone=1"):
        fresh.goto(URL + "edit" + q); fresh.wait_for_timeout(300)
        looks.append(fresh.evaluate("document.documentElement.dataset.look || 'google'"))
        if q == "?look=thermal": fresh.evaluate("localStorage.removeItem('glideshow-look')")
    fresh.context.close()
    check("the default look is Thermal, a phone's too; ?look=google switches to Google Slides' and is remembered, ?look=thermal back",
          looks == ["thermal", "google", "google", "thermal", "thermal"], str(looks))
    pg.close()


def fixture_checks(b, errors):
    """A hand-written agent deck opens in the editor with every box selectable, and in the viewer."""
    tmp = Path(tempfile.mkdtemp(prefix="slides-fixture-")) / "deck"
    tmp.mkdir(); (tmp / "assets").mkdir()
    shutil.copy(HERE / "fixtures" / "agent-deck.html", tmp / "deck.html")
    srv = subprocess.Popen(["uv", "run", "--quiet", "--project", str(ROOT), "python", "-m", "glideshow.server", "--exit-with", str(os.getpid()), str(tmp), "--port", str(PORT + 1), "--no-open"], env=TEST_ENV,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://localhost:{PORT + 1}/"
    try:
        wait_server(tmp, url)
        pg = b.new_page(viewport={"width": 1440, "height": 900})

        errs = []
        pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(url + "edit"); pg.wait_for_timeout(800)
        n = pg.evaluate("document.querySelectorAll('#ed-canvas .box').length")
        check("fixture: boxes on slide 1 render (incl. a note for the AI)", n == 9, str(n))
        pg.keyboard.press("Meta+a")
        check("fixture: every box selectable", pg.evaluate("document.querySelectorAll('#ed-ui .sel-box.thin').length") == n)
        check("fixture: ids assigned to id-less boxes", pg.evaluate("[...document.querySelectorAll('#ed-canvas .box')].every(b => b.id)"))
        check("fixture: shapes drawn", pg.evaluate("document.querySelectorAll('#ed-canvas .box[data-shape] svg.shape').length") == 5)
        pg.click(".thumb >> nth=1"); pg.wait_for_timeout(300)
        check("fixture: all shape kinds draw", pg.evaluate("document.querySelectorAll('#ed-canvas .box[data-shape] svg.shape *').length") >= 7)
        pg.screenshot(path=str(HERE / "fixture.png"))
        # Round-trip: a no-op save must keep every box and attribute.
        pg.click("#ed-new-slide-btn"); pg.keyboard.press("Meta+z"); pg.wait_for_timeout(1200)
        html = (tmp / "deck.html").read_text()
        check("fixture: round-trip keeps boxes", html.count('class="box') == 54 and 'data-layout="title-body"' in html and 'data-shape="uturnarrow"' in html and html.count('<section>\n<section') == 1 and 'class="box video"' in html and 'data-crop="0.1 0 0.1 0.2"' in html and 'data-shape="wordart"' in html and 'data-from="para:b"' in html and 'data-path="M0,1 C' in html and 'data-shape="elbow"' in html and 'data-adj="0.4"' in html and 'data-shadow-angle="45"' in html and 'data-end="fill-arrow"' in html and 'class="box group"' in html and 'data-guides="v960 h540"' in html and 'data-dir="up"' in html and "--sw: 6px" in html)
        check("fixture: background image slide round-trips and paints its thumbnail", "data-background-image=\"data:image/svg+xml" in html
              and "url(" in pg.evaluate("getComputedStyle(document.querySelectorAll('.thumb-canvas')[2]).backgroundImage"))
        check("fixture: round-trip fills deck-base/deck-shapes, keeps equation source", "renderShape" in html and ".box {" in html and "$\\pi_\\theta(a_t \\mid h_{&lt;t})$" in html and 'class="katex' not in html)
        v = b.new_page(viewport={"width": 1280, "height": 720})
        v.on("pageerror", lambda e: errs.append("viewer: " + str(e)))
        v.goto(url + "deck/deck.html"); v.wait_for_function("window.Reveal?.isReady?.()", timeout=20000); v.wait_for_timeout(300)
        check("fixture: viewer renders", v.evaluate("document.querySelectorAll('.box svg.shape').length") >= 5)
        v.evaluate("Reveal.slide(5, 1)"); v.wait_for_timeout(300)
        bgq = v.evaluate("(() => { const s = Reveal.getSlides()[2]; Reveal.slide(2); return getComputedStyle(Reveal.getSlideBackground(s).querySelector('.slide-background-content')).backgroundImage.startsWith('url(\"data:image/svg+xml'); })()"); v.evaluate("Reveal.slide(5, 1)"); v.wait_for_timeout(300)
        check("fixture: a data: background image with quotes in it shows in the viewer (shapes.js quotes reveal's url())", bgq)
        pdf = b.new_page(); pdf.goto(url + "deck/deck.html?print-pdf"); pdf.wait_for_function("document.querySelectorAll('.pdf-page').length > 0", timeout=20000); pdf.wait_for_timeout(500)
        check("fixture: ?print-pdf lays every slide (stack included) on its own page", pdf.evaluate("document.querySelectorAll('.pdf-page').length") == 7)
        pp = pdf.evaluate("""[Reveal.getConfig().margin, Reveal.getConfig().slideNumber, Reveal.getConfig().pdfSeparateFragments,
          [...document.querySelectorAll('.slide-number')].every(e => getComputedStyle(e).display === 'none'), getComputedStyle(document.body).printColorAdjust]""")
        check("PDF as Slides prints it: edge to edge (margin 0), no slide numbers, each slide once (fragments shown), colours kept without 'Background graphics'",
              pp == [0, False, False, True, "exact"], str(pp))

        pdf.close()
        check("fixture: a nested <section> stack presents as 6.1 (↓ in the stack; reveal numbering: main 6, sub-slides 6.1…)", v.evaluate("[Reveal.getIndices().v, document.querySelector('.sl-bar .num')?.textContent]") == [1, "6.1"])
        check("fixture: a note for the AI is hidden in the deck", v.evaluate("getComputedStyle(document.querySelector('.box.note')).display") == "none")
        check("fixture: an empty layout placeholder is hidden in the deck", v.evaluate("(() => { const b = [...document.querySelectorAll('.box[data-placeholder]')].find(b => !b.textContent.trim()); return b && getComputedStyle(b).display; })()") == "none")
        # --build: the saved fixture as a self-contained folder, opened from disk with the network cut off
        out = tmp.parent / "built"
        subprocess.run(["uv", "run", "--quiet", "--project", str(ROOT), "python", "-m", "glideshow.server", "--exit-with", str(os.getpid()), str(tmp), "--build", str(out)], env=TEST_ENV, check=True, capture_output=True)
        bh = (out / "deck.html").read_text()
        ctx = b.new_context(viewport={"width": 1280, "height": 720}); ctx.route("http*://**", lambda r: r.abort()); o = ctx.new_page()
        o.goto((out / "deck.html").as_uri()); o.wait_for_timeout(1200)
        ok = o.evaluate("[!!window.Reveal?.isReady?.(), document.querySelectorAll('.box svg.shape').length, !!document.querySelector('.katex')]")
        check("--build: reveal.js vendored and Google Fonts embedded; the built deck presents offline",
              "cdn.jsdelivr" not in bh and "fonts.googleapis" not in bh and (out / "assets" / "fonts" / "google-fonts.css").exists() and ok[0] and ok[1] >= 5 and ok[2], f"{ok}")
        ctx.close()
        errs = [e for e in errs if "missing" not in e and "404" not in e]   # the fixture's missing image is deliberate
        check("fixture: no browser errors", not errs, "; ".join(errs)[:300])
        # stack-deck.html (14 main slides, a 3-slide stack on slide 1) in grid view on a 1440 × 900 window
        sd = tmp.parent / "stackdeck"; sd.mkdir(); shutil.copy(HERE / "fixtures" / "stack-deck.html", sd / "deck.html")
        urllib.request.urlopen(urllib.request.Request(url + "api/open", method="POST", headers={"X-Glideshow": "1"}, data=json.dumps({"path": str(sd)}).encode()))
        g = b.new_page(viewport={"width": 1440, "height": 900}); g.goto(url + "edit"); g.wait_for_function("typeof slides !== 'undefined' && slides.length")
        g.evaluate("setGrid(true)"); g.wait_for_timeout(300)
        rows = g.evaluate("(() => { const m = [...document.querySelectorAll('.thumb:not(.sub)')]; return [m.length, new Set(m.map(t => Math.round(t.getBoundingClientRect().top))).size]; })()")
        g.close()
        check("grid view: a stack sits in its main slide's cell, so stack-deck's 14 main slides take 4 rows at 1440 × 900", rows == [14, 4], str(rows))

    finally:
        srv.terminate()


def deck_sync_check():
    """history.sync pulls glideshow.org's commits under the Mac's with the deck merge (glideshow/merge.py): edits on
    neighbouring lines of one slide, and on another slide, all kept (a line merge where the Mac wins dropped the web's)."""
    import importlib; sys.path.insert(0, str(ROOT)); sync = importlib.import_module("glideshow.history").sync
    t = Path(tempfile.mkdtemp(prefix="slides-decksync-")); g = lambda repo, *a: subprocess.run(["git", "-C", str(repo), *a], capture_output=True, text=True)
    B = lambda i, txt: f'<div class="box" id="{i}" style="left: 0px"><div class="content">{txt}</div></div>'
    S = lambda sid, *bx: f'<section data-sid="{sid}">\n  ' + "\n  ".join(bx) + '\n</section>'
    deck = lambda *sl: '<!doctype html><html><head><title>T</title></head><body><div class="reveal"><div class="slides">\n' + "\n\n".join(sl) + '\n</div></div></body></html>\n'
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(t / "origin.git")])
    for c in ("mac", "web"): subprocess.run(["git", "clone", "-q", str(t / "origin.git"), str(t / c)], capture_output=True); g(t / c, "config", "user.email", "t@t"); g(t / c, "config", "user.name", c)
    (t / "mac" / "d").mkdir(); (t / "mac" / "d" / "deck.html").write_text(deck(S("a", B("x", "X"), B("y", "Y")), S("b", B("v", "V"))))
    g(t / "mac", "add", "-A"); g(t / "mac", "commit", "-qm", "start"); g(t / "mac", "push", "-q", "origin", "HEAD:main"); g(t / "web", "pull", "-q", "origin", "main")
    (t / "web" / "d" / "deck.html").write_text(deck(S("a", B("x", "X"), B("y", "Y from the web")), S("b", B("v", "V from the web"))))
    g(t / "web", "commit", "-qam", "web"); g(t / "web", "push", "-q", "origin", "HEAD:main")
    (t / "mac" / "d" / "deck.html").write_text(deck(S("a", B("x", "X from the Mac"), B("y", "Y"), B("n", "New box from the Mac")), S("b", B("v", "V"))))
    g(t / "mac", "commit", "-qam", "mac"); r = sync(t / "mac"); out = (t / "mac" / "d" / "deck.html").read_text()
    lost = [w for w in ("X from the Mac", "Y from the web", "New box from the Mac", "V from the web") if w not in out]
    check("the Mac's sync merges a deck changed online by slide and box: edits on neighbouring lines of one slide and on another slide all kept, and pushed",
          r == "in 1, out 1" and not lost and g(t / "mac", "status", "--porcelain").stdout == "", f"{r} lost={lost}")


def sync_checks():
    """history.sync: the library trades commits with origin (edits made online come in under local ones; overlaps keep this Mac's)."""
    import importlib; sys.path.insert(0, str(ROOT)); sync = importlib.import_module("glideshow.history").sync
    d = Path(tempfile.mkdtemp(prefix="slides-sync-")); g = lambda repo, *a: subprocess.run(["git", "-C", str(repo), *a], capture_output=True, text=True)
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(d / "origin.git")])
    for c in ("mac", "web"): subprocess.run(["git", "clone", "-q", str(d / "origin.git"), str(d / c)], capture_output=True)
    for c in ("mac", "web"): g(d / c, "config", "user.email", "t@t"); g(d / c, "config", "user.name", "t")
    (d / "mac" / "deck.html").write_text("a\n"); g(d / "mac", "add", "-A"); g(d / "mac", "commit", "-qm", "start"); g(d / "mac", "push", "-q", "origin", "main")
    g(d / "web", "pull", "-q", "origin", "main"); (d / "web" / "deck.html").write_text("web\n"); g(d / "web", "commit", "-qam", "web"); g(d / "web", "push", "-q", "origin", "main")
    (d / "mac" / "other").write_text("x"); g(d / "mac", "add", "-A"); g(d / "mac", "commit", "-qm", "mac")
    first = sync(d / "mac")
    (d / "mac" / "deck.html").write_text("mac\n"); dirty = sync(d / "mac")
    g(d / "mac", "commit", "-qam", "mac2"); g(d / "web", "pull", "-q", "origin", "main"); (d / "web" / "deck.html").write_text("web2\n"); g(d / "web", "commit", "-qam", "web2"); g(d / "web", "push", "-q", "origin", "main")
    overlap = sync(d / "mac")
    check("library sync: online commits come in under local ones and both reach origin; never with unsaved work; overlaps keep the Mac's",
          first == "in 1, out 1" and dirty == "uncommitted changes" and overlap == "in 1, out 1" and (d / "mac" / "deck.html").read_text() == "mac\n"
          and g(d / "origin.git", "log", "--format=%s", "main").stdout.split() == ["mac2", "web2", "mac", "web", "start"], (first, dirty, overlap))
    # a deck removed online: git takes its files away but leaves its folder (and an empty assets/), which Home showed as an
    # empty folder; the sync clears those away, and only those
    for c, f in (("mac", "talk/deck.html"), ("mac", "kept/deck.html")):
        (d / c / f).parent.mkdir(parents=True, exist_ok=True); (d / c / f).write_text("x\n")
    (d / "mac" / "talk" / "assets").mkdir(); (d / "mac" / "kept" / "notes.txt").write_text("mine\n"); (d / "mac" / "mine-empty").mkdir()
    g(d / "mac", "add", "talk", "kept/deck.html"); g(d / "mac", "commit", "-qm", "two decks"); sync(d / "mac")
    g(d / "web", "pull", "-q", "origin", "main"); g(d / "web", "rm", "-rq", "talk", "kept/deck.html"); g(d / "web", "commit", "-qm", "remove both"); g(d / "web", "push", "-q", "origin", "main")
    sync(d / "mac")
    check("library sync: a deck removed online leaves no empty folder behind; a folder still holding a file, or one made here, stays",
          not (d / "mac" / "talk").exists() and (d / "mac" / "kept" / "notes.txt").exists() and (d / "mac" / "mine-empty").is_dir(),
          [p.name for p in (d / "mac").iterdir()])


def cli_checks(b):
    """bin/glideshow: new deck in $GLIDESHOW_HOME (git-initialised), fuzzy open, one server reused."""
    home = Path(tempfile.mkdtemp(prefix="slides-home-"))
    env = {**TEST_ENV, "GLIDESHOW_HOME": str(home), "GLIDESHOW_PORT": str(PORT + 2), "GLIDESHOW_GIT_DELAY": "0.3", "GLIDESHOW_OUTSIDE_DELAY": "0.5", "GLIDESHOW_SYNC_EVERY": "1"}
    run = lambda *a: subprocess.run([str(ROOT / "bin" / "glideshow"), *a, "--no-open"], env=env, capture_output=True, text=True, timeout=120).stdout
    try:
        usage = run("new", "--help")
        check("glideshow new --help prints the usage and makes no deck (it once made one called \"--help\")", "glideshow new" in usage and not any(home.iterdir()), [p.name for p in home.iterdir()])
        run("new", "Lab Meeting"); run("new", "Journal club"); out = run("lab")
        lab_dir = next(d for d in home.iterdir() if d.name.startswith("lab-meeting"))
        fresh = (lab_dir / "deck.html").read_text()
        check("glideshow new: a ready deck (template filled in) with AGENTS.md (recipes + the format reference) beside it",
              "{{BASE}}" not in fresh and "renderShape" in fresh and "<title>Lab Meeting</title>" in fresh and "## Deck format" in (lab_dir / "AGENTS.md").read_text())
        png = home / "plot.png"; png.write_bytes(bytes.fromhex("89504e470d0a1a0a0000000d4948445200000320000001900802000000") + b"\0" * 32)   # an 800x400 PNG header
        subprocess.run(["uv", "run", "--quiet", "--project", str(ROOT), "python", "-m", "glideshow.server", "--exit-with", str(os.getpid()), str(lab_dir), "--add-image", str(png), "--no-git"], env=env, capture_output=True, timeout=60)
        placed = re.search(r'<div class="box image" style="left: (\d+)px; top: (\d+)px; width: (\d+)px; height: (\d+)px;"', (lab_dir / "deck.html").read_text())
        check("server.py DECK --add-image: copies the picture into assets/ and fits it into the body area of the last slide", placed and placed.groups() == ("200", "240", "1520", "760"), str(placed and placed.groups()))
        gs = run("import-google", str(ROOT / "test" / "fixtures" / "gslides-api.json"))
        gs_dir = next((d for d in home.iterdir() if d.name.startswith("fixture-deck")), None)
        gs_html = (gs_dir / "deck.html").read_text() if gs_dir else ""
        check("glideshow import-google <saved .json>: a new deck in the library from the API response, offline (pictures into assets/, the response kept under source/, title set)",
              gs_dir is not None and "<title>Fixture deck</title>" in gs_html and 'data-shape="arrow"' in gs_html and (gs_dir / "assets").is_dir() and any((gs_dir / "assets").iterdir())
              and (gs_dir / "source" / "gslides-api-FIXTURE.json").exists() and "2 slides" in gs, gs[-300:])
        names = sorted(d.name for d in home.iterdir() if d.is_dir() and not d.name.startswith("fixture-deck"))
        cur = [d["title"] for d in json.load(urllib.request.urlopen(f"http://localhost:{PORT + 2}/api/recent", timeout=5)) if d["current"]]
        servers = subprocess.run(["pgrep", "-f", f"glideshow.server.*{home}"], capture_output=True, text=True).stdout.split()
        check("slides CLI: new decks in $GLIDESHOW_HOME (git repo), fuzzy open switches the one running server",
              (home / ".git").exists() and len(names) == 3 and names[1].startswith("journal-club-") and cur == ["Lab Meeting"] and "lab-meeting" in out and len(servers) <= 2,
              f"{names} {cur} {out!r} {servers}")
        save = lambda html, m: urllib.request.urlopen(urllib.request.Request(f"http://localhost:{PORT + 2}/api/save", method="POST", headers={"X-Glideshow": "1"}, data=json.dumps({"html": html, "mtime": m}).encode())).read()
        d = json.load(urllib.request.urlopen(f"http://localhost:{PORT + 2}/api/deck")); save(d["html"], d["mtime"])
        gitlog = lambda: subprocess.run(["git", "-C", str(home), "log", "--format=%s", "-4"], capture_output=True, text=True).stdout
        last = lambda *g: subprocess.run(["git", *(g or ("-C", str(home))), "log", "--format=%s", "-1"], capture_output=True, text=True).stdout.strip()
        def until(words, log=gitlog):   # (commits are debounced, and slower on CI)
            for _ in range(75):
                if words in log(): return
                time.sleep(0.2)
        until("deck: Lab Meeting")   # the first commit
        d = json.load(urllib.request.urlopen(f"http://localhost:{PORT + 2}/api/deck"))
        urllib.request.urlopen(urllib.request.Request(f"http://localhost:{PORT + 2}/api/save", method="POST", headers={"X-Glideshow": "1"},
            data=json.dumps({"html": d["html"].replace("</section>", '<div class="box" style="left: 100px; top: 100px; width: 600px; height: 100px;"><div class="content">Hypothesis one</div></div></section>', 1), "mtime": d["mtime"]}).encode()))
        until("slide 1: Hypothesis one"); log = gitlog()
        mine = [m for m in log.split("\n") if m and not m.startswith("outside the editor:")]   # the picture added from the command line, and the other decks, are their own versions
        check("history: saves in a git-tracked deck are committed (debounced): 'deck: <title>', then 'slide N: <new words>'", mine[:2] == ["slide 1: Hypothesis one", "deck: Lab Meeting"], repr(log))

        v = b.new_page(viewport={"width": 1280, "height": 800}); v.goto(f"http://localhost:{PORT + 2}/edit"); v.wait_for_function("typeof slides !== 'undefined' && slides.length")
        v.click("#ed-menubar [data-menu=File]"); v.click(".menu-item:has-text('Version history')"); v.wait_for_selector(".hist-row >> nth=2")
        rows = v.evaluate("[...document.querySelectorAll('.hist-row small')].map(e => e.textContent)")
        v.click(".hist-row:has-text('slide 1: Hypothesis one')"); v.wait_for_function("document.body.classList.contains('history-mode')"); v.wait_for_timeout(300)
        changed = v.evaluate("[...slides[0].querySelectorAll('.box.hist-changed')].map(b => b.textContent.trim())")
        v.evaluate("(async () => { await fetch('/api/name', { method: 'POST', body: JSON.stringify({ rev: histRev, name: 'Draft one' }) }); await listHistory(); })()"); v.wait_for_timeout(300)
        named = v.evaluate("[...document.querySelectorAll('.hist-row b')].map(e => e.textContent)")
        v.click(".hist-row:has-text('deck: Lab Meeting')"); v.wait_for_selector(".hist-row.on:has-text('deck: Lab Meeting')"); v.wait_for_timeout(200)
        old = v.evaluate("slides[0].textContent.includes('Hypothesis one')")
        v.click("#ed-hist-restore"); v.wait_for_function("!document.body.classList.contains('history-mode') && !slides[0].textContent.includes('Hypothesis one')", timeout=15000)
        for _ in range(50):   # (the page shows the restore before the server has committed it)
            top = subprocess.run(["git", "-C", str(home), "log", "--format=%s", "-1"], capture_output=True, text=True).stdout.strip()
            if top.startswith("deck: restore"): break
            v.wait_for_timeout(200)
        v.close()
        check("File → Version history lists the commits, previews one read-only, and Restore this version commits it back",
              rows[:3] == ["what you are editing", "slide 1: Hypothesis one", "deck: Lab Meeting"] and old is False and top.startswith("deck: restore the version of"), f"{rows} {old} {top!r}")
        check("Version history: Highlight changes outlines the boxes that changed; a version can be named (git tag)", changed == ["Hypothesis one"] and "Draft one" in named, f"{changed} {named}")
        bare = Path(tempfile.mkdtemp(prefix="slides-origin-")) / "lib.git"
        subprocess.run(["git", "init", "-q", "--bare", str(bare)], check=True)
        subprocess.run(["git", "-C", str(home), "remote", "add", "origin", str(bare)], check=True)
        ir = run("init-remote", "someone/decks")   # origin already set: commits the library (.gitignore) and pushes, no GitHub call
        d = json.load(urllib.request.urlopen(f"http://localhost:{PORT + 2}/api/deck"))
        save(d["html"].replace("</section>", '<div class="box" style="left: 100px; top: 300px; width: 600px; height: 100px;"><div class="content">Backed up</div></div></section>', 1), d["mtime"])
        until("slide 1:", lambda: last("--git-dir", str(bare))); pushed = last("--git-dir", str(bare))
        check("backup: `glideshow init-remote` pushes the library to origin, and each later auto-commit is pushed too",
              "backed up to someone/decks" in ir and pushed.startswith("slide 1:") and (home / ".gitignore").exists(), f"{ir!r} {pushed!r}")
        open_file = Path(json.load(urllib.request.urlopen(f"http://localhost:{PORT + 2}/api/ping"))["deck"]) / "deck.html"
        open_file.write_text(open_file.read_text().replace("Backed up", "Backed up, then edited by an agent"))
        race = subprocess.run(["uv", "run", "--quiet", "--project", str(ROOT), "python", "-c", "import sys; from pathlib import Path; from glideshow.history import commit_outside_library as c; "
                               "print(c(Path(sys.argv[1]), Path(sys.argv[2])))", str(home), str(open_file)], env=env, capture_output=True, text=True, timeout=60)   # the 30 s pass, in the second before the watcher notices
        until("outside the editor: slide 1:", last); outside = last()
        check("an edit made outside the editor is committed as its own version, named by slide (the library's 30 s pass leaves the open deck to it)",
              outside.startswith("outside the editor: slide 1:") and race.stdout.strip() == "False", f"{outside!r} {race.stdout.strip()!r} {race.stderr[-200:]}")
        other = next(d for d in home.iterdir() if (d / "deck.html").is_file() and (d / "deck.html").resolve() != open_file.resolve())
        (other / "deck.html").write_text((other / "deck.html").read_text().replace("</section>", '<div class="box" style="left: 0px; top: 0px; width: 9px; height: 9px;"><div class="content">agent</div></div></section>', 1))
        until(f"outside the editor: {other.name}", last); elsewhere = last()
        check("an agent's edit to a deck that isn't open is committed too (so syncing never waits on it)", elsewhere == f"outside the editor: {other.name}" and not subprocess.run(["git", "-C", str(home), "status", "--porcelain"], capture_output=True, text=True).stdout.strip(), elsewhere)
        subprocess.run(["git", "-C", str(home), "remote", "set-url", "origin", "git@github.com:someone/decks.git"], check=True)   # only the URL changes; origin/main stays
        hl = json.load(urllib.request.urlopen(f"http://localhost:{PORT + 2}/api/history"))
        subprocess.run(["git", "-C", str(home), "remote", "set-url", "origin", str(bare)], check=True)
        rk = subprocess.run(["uv", "run", "--quiet", "--project", str(ROOT), "python", "-c", "import json; from glideshow import publish as p; "
                             "p.LEDGER.write_text(json.dumps({'a': {'slug': 'a-1'}, 'f/b': {'slug': 'b-1'}})); p.rekey(p.HOME / 'a', p.HOME / 'F' / 'a'); p.rekey(p.HOME / 'f', p.HOME / 'g'); "
                             "print(sorted(p.ledger())); p.drop(p.HOME / 'g'); print(sorted(p.ledger())); p.LEDGER.unlink()"], env=env, capture_output=True, text=True, timeout=60)
        check("moving a deck (or renaming its folder) keeps its shared link: published.json follows it; removing it stops sharing it",
              rk.stdout.split() == ["['F/a',", "'g/b']", "['F/a']"], rk.stdout + rk.stderr[-200:])
        subprocess.run(["git", "-C", str(home), "remote", "set-url", "origin", "git@github.com:Someone/decks.git"], check=True)   # a GitHub library (nothing is pushed: sync can't reach it)
        sh = subprocess.run(["uv", "run", "--quiet", "--project", str(ROOT), "python", "-c", "import json, sys; from pathlib import Path; from glideshow import publish as p; d = p.HOME / sys.argv[1]; "
                             "a = p.publish(d); b = p.publish(d, 'settings', 'people', 'a@b.org, @harvard.edu octocat', '2030-01-02'); e = p.ledger()[sys.argv[1]]; "
                             "print(json.dumps([a, b, e]))", lab_dir.name], env=env, capture_output=True, text=True, timeout=120)
        subprocess.run(["git", "-C", str(home), "remote", "set-url", "origin", str(bare)], check=True)
        try: sh1, sh2, she = json.loads(sh.stdout.strip().splitlines()[-1])
        except Exception: sh1 = sh2 = she = {}
        head = subprocess.run(["git", "-C", str(home), "log", "--format=%s", "-1"], capture_output=True, text=True).stdout.strip()
        check("glideshow publish: a glideshow.org/p/<repo owner>/<slug>/ link pinned to the current commit, kept in published.json and committed; settings change who can open it, not the link",
              sh1.get("url", "").startswith("https://glideshow.org/p/someone/" + lab_dir.name) and sh1["access"] == "link" and sh2["url"] == sh1["url"]
              and sh2["access"] == "people" and sh2["people"] == ["a@b.org", "@harvard.edu", "octocat"] and sh2["expires"] == "2030-01-02"
              and len(she.get("rev", "")) == 40 and head.startswith("library: share"), (sh.stdout + sh.stderr)[-400:])
        check("version history links each pushed version to its commit on GitHub when origin is a GitHub repo",

              hl and all(c["url"] == f"https://github.com/someone/decks/commit/{c['rev']}" for c in hl), str(hl[:2]))

        (home / "untitled-x").mkdir(exist_ok=True)   # an untitled deck, for the card that goes by its first slide's first line
        (home / "untitled-x" / "deck.html").write_text(re.sub(r"<title>.*?</title>", "<title>Untitled deck</title>", (lab_dir / "deck.html").read_text(), count=1)
            .replace("<section", '<section><div class="box" style="left: 100px; top: 100px; width: 800px; height: 100px;"><div class="content">Model fits</div></div></section>\n<section', 1))
        h = b.new_page(viewport={"width": 1280, "height": 800}); h.goto(f"http://localhost:{PORT + 2}/"); h.wait_for_selector(".hm-card")

        h.wait_for_function("document.querySelectorAll('.hm-card .pic > div').length >= 2", timeout=15000)
        titles = h.evaluate("[...document.querySelectorAll('#hm-grid .hm-card .title')].map(e => e.textContent)")
        h.hover(".hm-card >> nth=0"); h.wait_for_selector(".hm-preview", timeout=5000)
        pv = h.evaluate("[document.querySelectorAll('.hm-preview .hm-pic').length, document.querySelector('.hm-preview .cap').textContent, [...document.querySelectorAll('.hm-group')].map(g => g.textContent)[0], /slides?$/.test(document.querySelector('.hm-card .n').textContent)]")
        h.mouse.move(5, 400); h.wait_for_timeout(100); gone = h.evaluate("!document.querySelector('.hm-preview')")
        check("home: hovering a card shows a larger preview (first slide, the next ones, slide count); decks are grouped by the month of their date; cards show their slide count",
              pv[0] >= 1 and " slide" in pv[1] and re.fullmatch(r"[A-Z][a-z]+ \d{4}|No date", pv[2] or "") and pv[3] and gone, f"{pv} {gone}")
        derived = h.evaluate("[...document.querySelectorAll('.hm-card .title.derived')].map(e => e.textContent)")
        check("home: a deck with a generic title ('Untitled deck') goes by its first slide's first line, in italics", "Model fits" in derived, str(derived))


        h.fill("#hm-q", "journal"); shown = h.evaluate("document.querySelectorAll('#hm-grid .hm-card').length"); h.fill("#hm-q", "")
        h.click("#hm-sort"); az = h.evaluate("[...document.querySelectorAll('#hm-grid .hm-card .title')].map(e => e.textContent)"); h.click("#hm-sort")
        h.click("#hm-view"); lst = h.evaluate("[document.querySelector('#hm-grid').classList.contains('list'), getComputedStyle(document.querySelector('.hm-card .pic')).display]"); h.click("#hm-view")
        check("home: sort by title and list view toggles (list rows keep a small picture)", az == sorted(az) and lst == [True, "block"], f"{az} {lst}")
        lab = next(d for d in json.load(urllib.request.urlopen(f"http://localhost:{PORT + 2}/api/decks")) if d["title"] == "Lab Meeting")
        h.evaluate("(p) => fetch('/api/deckop', { method: 'POST', headers: { 'X-Glideshow': '1' }, body: JSON.stringify({ path: p, op: 'duplicate' }) })", lab["path"]); h.reload(); h.wait_for_selector(".hm-card")
        after = h.evaluate("[...document.querySelectorAll('#hm-grid .hm-card .title')].map(e => e.textContent)")
        band = h.evaluate("!!document.querySelector('.hm-start, .hm-blank, #hm-gallery')")
        h.evaluate("window.prompt = () => 'Lab'"); h.click("#hm-newfolder"); h.wait_for_selector(".hm-folder")
        h.evaluate("""(() => { const c = [...document.querySelectorAll('.hm-card')].find(c => c.textContent.includes('Journal club')), f = document.querySelector('.hm-folder'), dt = new DataTransfer();
          c.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true })); f.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
          f.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); c.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true })); })()""")   # Playwright's HTML5 drag is unreliable here
        h.wait_for_function("!decks.some(d => d.title === 'Journal club' && d.folder === '')", timeout=10000)

        moved = (home / "Lab").is_dir() and any((home / "Lab").glob("journal-club-*/deck.html"))
        top = h.evaluate("[...document.querySelectorAll('#hm-grid .hm-card .title')].map(e => e.textContent)")
        h.click(".hm-folder:has-text('Lab')"); h.wait_for_selector(".hm-crumbs a:has-text('Lab')")
        inside = h.evaluate("[[...document.querySelectorAll('.hm-crumbs a')].map(a => a.textContent), [...document.querySelectorAll('#hm-grid .hm-card .title')].map(e => e.textContent)]")
        h.click("#hm-new"); h.wait_for_url("**/edit", timeout=15000); h.wait_for_function("typeof isDraft !== 'undefined' && isDraft")
        draft = [h.evaluate("[$('#ed-title').value, $('#ed-status .status-text').textContent]"), any((home / "Lab").iterdir() if (home / "Lab").exists() else [])]
        h.fill("#ed-title", "Lab notes"); h.wait_for_function("!isDraft", timeout=10000)
        made_in = (home / "Lab" / "lab-notes" / "deck.html").exists() and h.evaluate("deckPath").endswith("/Lab/lab-notes")
        check("an untitled new presentation is a draft (not in the library, 'Not saved: add a title'); naming it saves it into the folder it was started from",
              draft[0] == ["", "Not saved: add a title"] and made_in, f"{draft} {made_in}")
        # a folder inside a folder: its tile has room for its name, and the decks below keep a gap from it (no heading between)
        (home / "Lab" / "_build1014").mkdir(); (home / "Lab" / "_build1014" / "plot.png").write_bytes(b"png")
        h.goto(f"http://localhost:{PORT + 2}/#/Lab"); h.reload(); h.wait_for_selector("#hm-folders .hm-folder"); h.wait_for_timeout(300)
        nested = h.evaluate("""(() => { const f = document.querySelector('#hm-folders'), g = document.querySelector('#hm-grid'), n = f.querySelector('.name');
          return [Math.round(g.getBoundingClientRect().top - f.getBoundingClientRect().bottom), n.textContent, n.scrollWidth <= n.clientWidth]; })()""")
        check("home: a folder inside a folder: the decks below keep a gap from its tile, and its name isn't cut short", nested[0] >= 20 and nested[1] == "_build1014" and nested[2], nested)
        shutil.rmtree(home / "Lab" / "_build1014")
        h.goto(f"http://localhost:{PORT + 2}/#/Lab"); h.wait_for_selector(".hm-card"); h.click(".hm-crumbs a >> nth=0"); h.wait_for_function("location.hash === ''")
        h.wait_for_function("document.querySelectorAll('.hm-folder .peek .hm-pic').length > 0", timeout=10000)
        top_level = h.evaluate("[document.querySelectorAll('#hm-recent .hm-card').length, !document.querySelector('#hm-recent-head').hidden]")
        check("home top level: a Recent row of the decks opened last (any folder), and folder tiles showing their decks' first slides",
              top_level[0] >= 2 and top_level[1], str(top_level))
        log_lib = subprocess.run(["git", "-C", str(home), "log", "--format=%s", "-5"], capture_output=True, text=True).stdout

        check("home: folders in the library (New folder, drag a card onto it, open it, New presentation inside, breadcrumbs back); no template band",
              not band and moved and "Journal club" not in top and inside == [["My decks", "Lab"], ["Journal club"]] and made_in and "library: move journal-club" in log_lib,
              f"{band} {moved} {top} {inside} {made_in} {log_lib!r}")
        h.goto(f"http://localhost:{PORT + 2}/"); h.wait_for_selector("#hm-new")
        h.click("#hm-new"); h.wait_for_url("**/edit", timeout=15000); h.wait_for_function("typeof isDraft !== 'undefined' && isDraft")
        h.fill("#ed-title", "Untitled talk"); h.wait_for_function("!isDraft", timeout=10000)
        blank = h.evaluate("document.title"); made = (home / "untitled-talk" / "deck.html").exists()

        h.wait_for_function("deckPath", timeout=10000)
        gone = h.evaluate("deckPath"); href = h.evaluate("document.querySelector('#ed-app-icon').getAttribute('href')")
        h.evaluate("window.confirm = () => true"); h.click("#ed-menubar [data-menu=File]"); h.click(".menu-item:has-text('Move to trash')")
        h.wait_for_url(f"http://localhost:{PORT + 2}/", timeout=15000)
        trashed = not Path(gone).exists()
        trashed = trashed and any(Path(TEST_ENV["GLIDESHOW_TRASH"]).glob(Path(gone).name + "-*"))   # in the test's Trash, not ~/.Trash
        h.close()
        check("editor: the app glyph links home; File → Move to trash moves the open deck to the Trash and returns home", href == "/" and trashed, f"{href} {trashed}")
        q = b.new_page(); q.goto(f"http://localhost:{PORT + 2}/"); q.wait_for_selector(".hm-card")
        q.evaluate("window.confirm = () => true"); q.click("#hm-app-more"); q.click(".menu-item:has-text('Quit server')"); q.wait_for_selector(".hm-quit"); q.close()
        time.sleep(0.5)
        try: urllib.request.urlopen(f"http://localhost:{PORT + 2}/api/deck", timeout=1); stopped = False
        except Exception: stopped = True
        app_home = Path(tempfile.mkdtemp(prefix="slides-app-"))
        subprocess.run(["bash", str(ROOT / "tools" / "make-app.sh")], env={**TEST_ENV, "HOME": str(app_home)}, capture_output=True, timeout=180)
        launcher = app_home / "Applications" / "Glideshow.app" / "Contents" / "MacOS" / "Glideshow"
        lt = launcher.read_text() if launcher.exists() else ""
        ok_sh = launcher.exists() and subprocess.run(["bash", "-n", str(launcher)]).returncode == 0
        check("home ⋮ → Quit server stops the server; Glideshow.app's launcher opens Chrome's binary with --app in its own profile (fast, never restores your tabs), else the default browser",
              stopped and ok_sh and '--app="$URL"' in lt and '--user-data-dir="$PROFILE"' in lt
 and 'open "$URL"' in lt and 'glideshow url' in lt and "open -na" not in lt, f"{stopped} {ok_sh}")
        check("home screen at /: deck cards with first-slide pictures, search, Duplicate, Blank opens a new deck in the editor",

              {"Journal club", "Lab Meeting"} <= set(titles) and shown == 1 and "Copy of Lab Meeting" in after and len(after) == len(titles) + 1
              and made, f"{titles} {shown} {after} {blank}")
        # for agents: the format reference, the slides as pictures, and the skill linked into Claude Code
        docs = run("docs") + run("docs", "reference"); shots = Path(tempfile.mkdtemp(prefix="slides-render-"))
        rendered = [ln for ln in run("render", "lab", "1", "-o", str(shots)).splitlines() if ln.endswith(".png")]   # the paths, then any problems
        fake = Path(tempfile.mkdtemp(prefix="slides-user-"))
        subprocess.run([str(ROOT / "bin" / "glideshow"), "skill"], env={**env, "HOME": str(fake)}, capture_output=True, text=True, timeout=120)
        link = fake / ".claude" / "skills" / "glideshow"
        check("glideshow docs prints the recipes, docs reference the format reference; glideshow render <deck> 1 writes slide 1 and prints its path; glideshow skill links the skill into ~/.claude/skills",
              "# Writing slides as an agent" in docs and "Deck format" in docs and rendered == [str((shots / "slide-01.png").resolve())] and (shots / "slide-01.png").stat().st_size > 1500
              and link.is_symlink() and "name: glideshow" in (link / "SKILL.md").read_text(), f"{rendered} {link.is_symlink()}")
    finally:
        subprocess.run(["pkill", "-f", f"glideshow.server.*{home}"])


def main():

    library = Path.home() / "decks"
    before = sorted(p.name for p in library.iterdir()) if library.is_dir() else []
    tmp = Path(tempfile.mkdtemp(prefix="slides-test-"))
    srv = subprocess.Popen(["uv", "run", "--quiet", "--project", str(ROOT), "python", "-m", "glideshow.server", "--exit-with", str(os.getpid()), str(tmp / "deck"), "--port", str(PORT), "--no-open"], env=TEST_ENV,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_server(tmp / "deck")

        errors = []
        with sync_playwright() as p:
            b = google_look(p.chromium.launch(channel="chrome"))
            pg = b.new_page(viewport={"width": 1440, "height": 900})
            pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
            pg.on("pageerror", lambda e: errors.append(str(e)))
            checks(pg, tmp / "deck" / "deck.html", errors)
            look_checks(b, errors)
            reveal_checks(b, errors, tmp / "deck" / "deck.html")
            fixture_checks(b, errors)
            cli_checks(b)
            b.close()
        sync_checks()
        deck_sync_check()
        gs = subprocess.run(["uv", "run", "--quiet", str(ROOT / "tools" / "gslides2deck.py"), "selftest"], capture_output=True, text=True, env=TEST_ENV, timeout=300)
        check("gslides2deck: filled outlines become editor presets (arrow, rounded rectangle; a blob stays exact); --pptx brings notes and click builds as fragments",
              gs.returncode == 0 and "selftest ok" in gs.stdout, (gs.stdout + gs.stderr)[-400:])
        dup = subprocess.run(["uv", "run", "--quiet", "--project", str(ROOT), "python", "-m", "glideshow.server", str(tmp / "other"), "--port", str(PORT), "--no-open", "--no-git"],
                             env=TEST_ENV, capture_output=True, text=True, timeout=60)
        check("a server given an explicit --port that is taken refuses to start (a test never runs against an older server left on its port)",
              dup.returncode != 0 and "in use" in dup.stderr, dup.stderr[-200:])

        keys = subprocess.run(["uv", "run", "--quiet", str(HERE / "keys.py")], capture_output=True, text=True, env=TEST_ENV)

        check("every docs/shortcuts.md key does its job in context and never falls through to Chrome; the ⌘/ dialog lists exactly those (test/keys.py)",
              keys.returncode == 0, "\n".join(l for l in keys.stdout.splitlines() if l.startswith("FAIL"))[:600] or keys.stderr[-300:])

        check("no browser errors", not errors, "; ".join(errors)[:300])
        def status(path, method="GET", headers=None, data=None):
            try: return urllib.request.urlopen(urllib.request.Request(URL + path, method=method, headers=headers or {}, data=data), timeout=5).status
            except urllib.error.HTTPError as e: return e.code
        sec = [status("api/save", "POST", {}, b"{}"), status("api/deckop", "POST", {"Origin": "https://evil.example"}, b'{"op":"delete"}'),
               status("api/deck", headers={"Host": "evil.example:8799"}), status("api/deck"), status("api/recent", "GET")]
        check("only this machine's editor can use the server: a POST without X-Glideshow, or any request for another Host, is refused (403)", sec == [403, 403, 403, 200, 200], str(sec))

        after = sorted(p.name for p in library.iterdir()) if library.is_dir() else []
        check("the run left ~/decks untouched (every test server gets a temp $GLIDESHOW_HOME)", after == before, str(sorted(set(after) ^ set(before))))

    finally:
        srv.terminate()
    print(f"\n{'ALL PASSED' if not failures else str(len(failures)) + ' FAILED: ' + ', '.join(failures)}  (screenshots in {HERE})")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
