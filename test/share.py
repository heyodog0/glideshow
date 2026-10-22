# /// script
# dependencies = ["playwright==1.63.0", "pillow"]
# ///
"""The comments panel on a shared deck (editor/share/, as glideshow.org/p/… serves it: cloud/share.js), in WebKit
(Safari's engine) and Chromium, with the deck's own slideshow keys (editor/deck/present.js) underneath:

  - closed at first; the pill opens it, the slide fits beside it, and × or Esc closes it again (Esc doesn't reach the
    slideshow, whose Esc leaves it); Esc while choosing a comment's place cancels only that
  - in a narrow window the slide stays whole beside the panel (reveal.js's phone scroll view stays off)
  - the cards stay inside the panel; Thermal's type and canopy blue, by day and at dusk
  - the deck's sticky notes show, a little see-through (a slideshow hides them); a button hides them
  - on a phone, sandboxed as glideshow.org serves it, the slides come up (reveal.js's scroll view needs storage)
  - the filmstrip: every slide's picture (with its own background), the current one marked, comments counted, a click
    goes there; beside the slide, with the panel too; shut by its button (remembered); a row along the bottom on a phone

The page is put together here as the Worker does: the deck, then share.css / share.js and window.GLIDESHOW before
</body>, and the Worker's own key handler first in <head> (read from cloud/share.js, so the two can't drift apart).
Comments come from a stand-in for the API.  Run: uv run test/share.py"""
import json, os, re, shutil, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PORT = int(os.environ.get("SHARE_PORT", "8854"))
SHOTS = ROOT / "test" / "shots" / "share"
failures = []


def check(name, ok, detail: object = ""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  ({detail})"))
    if not ok: failures.append(name)


BOOT = {"comments": "/__comments", "pass": "", "me": {"n": "Ryan"}, "report": "/report", "signin": "/login", "owner": "R", "title": "T"}
COMMENTS = {"comments": [
    {"id": "c1", "slide": 1, "x": 300, "y": 900, "text": "test", "by": {"n": "Ryan"}, "at": "2026-10-14T19:00:00Z", "mine": True, "replies": []},
    {"id": "c2", "slide": 2, "x": 900, "y": 300, "text": "Could the y-axis start at zero? " * 3, "quote": "First try at the gate correct, a long quote that has to be cut short",
     "by": {"n": "Kazuki"}, "at": "2026-10-14T18:00:00Z", "replies": [{"by": {"n": "Ryan"}, "text": "Yes, will fix"}]}]}
_src = (ROOT / "cloud" / "share.js").read_text()
KEYS = re.search(r"const storage = `(<script>.*?</script>)`", _src).group(1) + re.search(r"const keys = storage \+ `(<script>.*?</script>)`", _src).group(1)
CHROME_ARGS = ["--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests"]   # (a sandboxed page here loads its files from localhost, which glideshow.org's never do)
SANDBOX = re.search(r"const SANDBOX = '([^']+)'", (ROOT / "cloud" / "worker.js").read_text()).group(1)   # served as glideshow.org serves it: sandboxed, no same origin


def page_html():
    html = (ROOT / "test" / "fixtures" / "agent-deck.html").read_text()
    inject = (f'<script src="/editor/deck/present.js"></script>'   # the deck's slideshow keys (decks carry a copy inline)
              f'<link rel="stylesheet" href="/editor/share/share.css"><script>window.GLIDESHOW = {json.dumps(BOOT)}</script><script src="/editor/share/share.js" defer></script>\n')
    at = html.rfind("</body>"); html = html[:at] + inject + html[at:]
    if 'name="viewport"' not in html: html = html.replace("<head>", '<head><meta name="viewport" content="width=device-width, initial-scale=1">', 1)   # as saved decks have
    return re.sub(r"<head[^>]*>", lambda m: m.group(0) + KEYS, html, count=1)


ON = "(q => { const e = document.querySelector(q); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'; })"
FIT = """(() => { const s = document.querySelector('.reveal .slides').getBoundingClientRect(), p = document.querySelector('.gs-panel'), pr = p.getClientRects().length ? p.getBoundingClientRect().left : innerWidth;
  return [Math.round(s.left), Math.round(s.right), Math.round(pr), Math.round(innerWidth)]; })()"""


def run(p, engine, url):
    b = p.webkit.launch() if engine == "webkit" else p.chromium.launch(channel="chrome", args=CHROME_ARGS)
    for scheme in ("light", "dark"):
        pg = b.new_page(viewport={"width": 1000, "height": 568}, color_scheme=scheme); errors = []; pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.route("**/deck/deck.html*", lambda r: r.fulfill(status=200, content_type="text/html", body=page_html(), headers={"content-security-policy": SANDBOX}))
        pg.route("**/__comments*", lambda r: r.fulfill(json=COMMENTS))
        pg.goto(url + "deck/deck.html"); pg.wait_for_function("window.Reveal?.isReady?.() && !!document.querySelector('.gs-toggle')", timeout=20000); pg.wait_for_timeout(500)
        tag = f"{engine} {scheme}"
        if scheme == "light":
            check(f"{tag}: closed at first: the pill, no panel, the slide the whole width",
                  pg.evaluate(ON + "('.gs-toggle')") and not pg.evaluate(ON + "('.gs-panel')") and pg.evaluate(FIT)[1] >= 990, pg.evaluate(FIT))
        pg.click(".gs-toggle"); pg.wait_for_timeout(600); pg.screenshot(path=str(SHOTS / f"{engine}-{scheme}.png"))
        fit = pg.evaluate(FIT)
        if scheme == "light":
            check(f"{tag}: the pill opens it; the slide fits beside it; the panel has a ×, the pill steps aside",
                  pg.evaluate(ON + "('.gs-panel')") and fit[1] <= fit[2] + 1 and fit[0] >= -1 and pg.evaluate(ON + "('.gs-x')") and not pg.evaluate(ON + "('.gs-toggle')"), fit)
        cards = pg.evaluate("(() => { const p = document.querySelector('.gs-panel'), r = p.getBoundingClientRect(); return [p.querySelectorAll('.gs-card').length, [...p.querySelectorAll('.gs-card')].every(c => c.getBoundingClientRect().right <= r.right - 8), p.scrollWidth <= p.clientWidth]; })()")
        check(f"{tag}: the comments' cards stay inside the panel", cards == [2, True, True], cards)
        look = pg.evaluate("(() => { const cs = q => getComputedStyle(document.querySelector(q)); return [cs('.gs-panel').fontFamily.split(',')[0].replace(/\"/g, ''), cs('.gs-primary').backgroundColor, cs('.gs-top').fontFamily.split(',')[0].replace(/\"/g, '')]; })()")
        blue = "rgb(47, 107, 255)" if scheme == "light" else "rgb(138, 174, 255)"
        check(f"{tag}: Thermal: Hanken Grotesk, IBM Plex Mono for the meta, canopy blue", look == ["Hanken Grotesk", blue, "IBM Plex Mono"], look)
        if scheme == "light":
            notes = pg.evaluate("""(() => { const seen = q => [...document.querySelectorAll(q)].filter(n => n.getClientRects().length && getComputedStyle(n).display !== 'none');
              const n = seen('.reveal:not(.gs-pic-reveal) .box.note')[0], t = [...document.querySelectorAll('.gs-pic-reveal .box.note')].filter(x => getComputedStyle(x).display !== 'none');   // (the filmstrip may be tucked away here)
              return [!!n, n ? +getComputedStyle(n).opacity : null, n ? getComputedStyle(n).backgroundColor : null, t.length > 0]; })()""")
            check(f"{tag}: sticky notes show on the shared deck, a little see-through, and in the filmstrip", notes[0] and 0.5 < notes[1] < 1 and notes[2] == "rgb(255, 243, 168)" and notes[3], notes)
        if scheme == "light":
            pg.click(".gs-x"); pg.wait_for_timeout(400)
            check(f"{tag}: × closes it, and the slide has the whole width again", not pg.evaluate(ON + "('.gs-panel')") and pg.evaluate(ON + "('.gs-toggle')") and pg.evaluate(FIT)[1] >= 990, pg.evaluate(FIT))
            pg.click(".gs-toggle"); pg.wait_for_timeout(300); pg.evaluate("Reveal.slide(1)"); pg.wait_for_timeout(200)
            pg.mouse.click(300, 300); pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
            check(f"{tag}: Esc closes it (and stays in the slideshow, on the same slide)",
                  not pg.evaluate(ON + "('.gs-panel')") and pg.evaluate("Reveal.getIndices().h") == 1 and not pg.evaluate("!!document.fullscreenElement"), pg.evaluate("Reveal.getIndices().h"))
            if pg.evaluate(ON + "('.gs-panel')"): pg.click(".gs-x"); pg.wait_for_timeout(300)   # (so a failure above doesn't stop the rest)
            pg.click(".gs-toggle"); pg.wait_for_timeout(300); pg.click(".gs-primary"); pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
            placing = [pg.evaluate("document.body.classList.contains('gs-placing')"), pg.evaluate(ON + "('.gs-panel')")]
            check(f"{tag}: Esc while choosing where a comment goes cancels just that", placing == [False, True], placing)
            pg.set_viewport_size({"width": 760, "height": 520}); pg.wait_for_timeout(700); narrow = pg.evaluate(FIT) + [pg.evaluate("!!document.querySelector('.reveal-scroll, .scroll-page')")]
            pg.screenshot(path=str(SHOTS / f"{engine}-narrow.png"))
            check(f"{tag}: in a narrow window the slide stays whole beside the panel (no phone scroll view; the filmstrip gives way)", narrow[0] >= -1 and narrow[1] <= narrow[2] + 1 and narrow[1] - narrow[0] > 300 and not narrow[4], narrow)
            pg.click(".gs-x"); pg.wait_for_timeout(400)
            check(f"{tag}: …and the filmstrip comes back when the panel closes", pg.evaluate(ON + "('.gs-strip')"))
        check(f"{tag}: no page errors", not errors, errors[:3])
        pg.close()
    b.close()


def strip_checks(p, engine, url):
    """The filmstrip: down the left on a computer (open at first, remembered when shut), a row along the bottom on a phone (shut at first)."""
    b = p.webkit.launch() if engine == "webkit" else p.chromium.launch(channel="chrome", args=CHROME_ARGS)
    ctx = b.new_context(viewport={"width": 1000, "height": 568}); pg = ctx.new_page(); errors = []; pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/deck/deck.html*", lambda r: r.fulfill(status=200, content_type="text/html", body=page_html(), headers={"content-security-policy": SANDBOX}))
    pg.route("**/__comments*", lambda r: r.fulfill(json=COMMENTS))
    ready = "window.Reveal?.isReady?.() && document.querySelectorAll('.gs-cell').length > 0"
    pg.goto(url + "deck/deck.html"); pg.wait_for_function(ready, timeout=20000); pg.wait_for_timeout(600)
    S = """(() => { const st = document.querySelector('.gs-strip'), on = st.getClientRects().length > 0, cells = [...document.querySelectorAll('.gs-cell')];
      const sl = Reveal.getSlides(), scale = Reveal.getScale(), w = Reveal.getConfig().width * scale, slides = document.querySelector('.reveal:not(.gs-pic-reveal) .slides').getBoundingClientRect();
      const left = slides.left + (slides.width - w) / 2;   // the slide itself, centred in reveal's box
      return { on, n: cells.length, total: sl.length, cur: cells.findIndex(c => c.classList.contains('cur')), counts: cells.map(c => c.querySelector('.gs-cn').textContent),
               stripRight: on ? Math.round(st.getBoundingClientRect().right) : 0, stripTop: on ? Math.round(st.getBoundingClientRect().top) : 0, slideLeft: Math.round(left),
               deckBottom: Math.round(document.querySelector('.reveal:not(.gs-pic-reveal)').getBoundingClientRect().bottom),
               white: getComputedStyle(cells[0].querySelector('.gs-pic-reveal')).backgroundColor }; })()"""
    a = pg.evaluate(S)
    check(f"{engine}: filmstrip on a computer: open at first, a picture of every slide, the current one marked, the slide beside it",
          a["on"] and a["n"] == a["total"] and a["cur"] == 0 and a["slideLeft"] >= a["stripRight"] - 1, a)
    check(f"{engine}: filmstrip: a slide's picture has the slide's own background (not the slideshow's black)", a["white"] == "rgb(255, 255, 255)", a["white"])
    check(f"{engine}: filmstrip: each slide's open comments counted", a["counts"][:3] == ["1", "1", ""], a["counts"][:3])
    NOTES = "[!!document.querySelector('.gs-notes-toggle')?.getClientRects().length, [...document.querySelectorAll('.box.note')].filter(x => getComputedStyle(x).display !== 'none').length, document.querySelectorAll('.box.note').length]"
    shown = pg.evaluate(NOTES); pg.click(".gs-notes-toggle"); pg.wait_for_timeout(200); hid = pg.evaluate(NOTES)
    pg.click(".gs-notes-toggle"); pg.wait_for_timeout(200); back = pg.evaluate(NOTES)
    check(f"{engine}: sticky notes: a button beside the filmstrip's hides them (on the slide and in the filmstrip) and shows them again",
          shown[0] and shown[1] == shown[2] > 1 and hid[1] == 0 and back[1] == back[2], f"{shown} {hid} {back}")
    pg.click(".gs-cell >> nth=2"); pg.wait_for_timeout(400)
    check(f"{engine}: filmstrip: a click goes to that slide", pg.evaluate("[Reveal.getSlides().indexOf(Reveal.getCurrentSlide()), [...document.querySelectorAll('.gs-cell')].findIndex(c => c.classList.contains('cur'))]") == [2, 2])
    pg.set_viewport_size({"width": 1280, "height": 720}); pg.click(".gs-toggle"); pg.wait_for_timeout(600)   # (room for both beside the slide)
    both = pg.evaluate(S); panel = pg.evaluate("Math.round(document.querySelector('.gs-panel').getBoundingClientRect().left)")
    check(f"{engine}: filmstrip and comments together: the slide between them", both["on"] and both["slideLeft"] >= both["stripRight"] - 1 and pg.evaluate("Reveal.getConfig().width * Reveal.getScale()") + both["slideLeft"] <= panel + 1, f"{both} panel {panel}")
    pg.click(".gs-x"); pg.click(".gs-strip-toggle"); pg.wait_for_timeout(400); off = pg.evaluate(S)
    check(f"{engine}: filmstrip: the button shuts it, and the slide takes the room", not off["on"] and off["slideLeft"] < 100, off)
    ctx.close()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=engine == "chromium", has_touch=True); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/deck/deck.html*", lambda r: r.fulfill(status=200, content_type="text/html", body=page_html(), headers={"content-security-policy": SANDBOX}))
    pg.route("**/__comments*", lambda r: r.fulfill(json=COMMENTS))
    pg.goto(url + "deck/deck.html"); pg.wait_for_function(ready, timeout=20000); pg.wait_for_timeout(600)
    phone = pg.evaluate("""(() => { const r = document.querySelector('.reveal:not(.gs-pic-reveal)'), first = Reveal.getSlides()[0].getBoundingClientRect();
      return [document.documentElement.classList.contains('reveal-scroll') || document.body.classList.contains('reveal-scroll') || !!r.closest('.reveal-scroll'), first.width > 300,
              (() => { try { sessionStorage.setItem('x', '1'); return sessionStorage.getItem('x') === '1'; } catch { return false; } })()]; })()""")
    shot = SHOTS / f"{engine}-phone.png"; pg.screenshot(path=str(shot))
    from PIL import Image
    im = Image.open(shot).convert("L").resize((40, 80)); light = sum(1 for v in im.getdata() if v > 60) / (40 * 80)   # a black screen: next to nothing light
    check(f"{engine}: on a phone, sandboxed as glideshow.org serves it: reveal.js's scroll view comes up with the slides showing (it read sessionStorage, which the sandbox refuses: a black screen)",
          phone == [True, True, True] and light > .5 and not errors, f"{phone} light={light:.2f} {errors[:2]}")
    shut = pg.evaluate(S); pg.click(".gs-strip-toggle"); pg.wait_for_timeout(500); row = pg.evaluate(S)
    pg.screenshot(path=str(SHOTS / f"{engine}-phone-strip.png"))
    check(f"{engine}: filmstrip on a phone: shut at first; the button shows it as a row along the bottom, under the slides",
          not shut["on"] and shut["n"] == shut["total"] and row["on"] and row["stripTop"] > 600 and row["stripRight"] == 390 and row["deckBottom"] <= row["stripTop"] + 1, f"{shut} {row}")
    check(f"{engine}: filmstrip: no page errors", not errors, errors[:3])
    ctx.close(); b.close()


def main():
    SHOTS.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="glideshow-share-")); d = tmp / "home" / "S" / "deck"; d.mkdir(parents=True)
    shutil.copy(ROOT / "test" / "fixtures" / "agent-deck.html", d / "deck.html")
    env = {**os.environ, "GLIDESHOW_HOME": str(tmp / "home"), "GLIDESHOW_CACHE": str(tmp / "cache"), "GLIDESHOW_OFFLINE": "1"}
    srv = subprocess.Popen(["uv", "run", "--quiet", "--project", str(ROOT), "python", "-m", "glideshow.server", str(d), "--port", str(PORT),
                            "--no-open", "--no-git", "--exit-with", str(os.getpid())], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://localhost:{PORT}/"
    for _ in range(60):
        try: urllib.request.urlopen(url + "api/ping", timeout=1); break
        except Exception: time.sleep(0.5)
    try:
        with sync_playwright() as p:
            for engine in ("webkit", "chromium"):
                run(p, engine, url); strip_checks(p, engine, url)
    finally:
        srv.terminate()
    print("ALL PASSED" if not failures else f"{len(failures)} FAILED: {', '.join(failures)}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
