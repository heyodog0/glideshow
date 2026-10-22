# /// script
# dependencies = ["playwright==1.63.0"]
# ///
"""Editing together, stage 1: what a collaborator saves is cleaned before it reaches the owner's
deck (cloud/clean.js), and the deck a collaborator opens is cleaned too. Against `wrangler dev` (cloud/), whose
/__dev/clean runs the cleaning:

    cd cloud && npx wrangler dev --port 8790      # .dev.vars has DEV_LOGIN
    uv run test/coedit.py [--decks ~/decks]

  - script tricks, each loaded in WebKit and Chromium as the editor loads a deck (DOMParser, then into the page) and as a
    page of its own: none runs (a tripwire, pwn(), is all they call)
  - the cleaned HTML has no scripts, handlers, javascript: or other unsafe URLs, frames or objects left
  - a collaborator's save keeps the owner's head, theme and the deck's own scripts, and the owner's live boxes and slide
    styles as they were; a frame or style of the collaborator's own goes
  - the deck a collaborator opens has none of the owner's scripts
  - every slide of the decks in --decks comes through unchanged (the cleaning leaves the editor's own markup alone)"""
import argparse, glob, html, json, os, re, sys, urllib.request
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser(); ap.add_argument("--url", default="http://localhost:8790"); ap.add_argument("--decks", default=os.path.expanduser("~/decks"))
args = ap.parse_args()
failures = []


def check(name, ok, detail: object = ""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  ({str(detail)[:600]})"), flush=True)
    if not ok: failures.append(name)


def clean(op, html_, owner=None, title=None, **more):
    req = urllib.request.Request(args.url + "/__dev/clean", data=json.dumps({"op": op, "html": html_, "owner": owner, "title": title, **more}).encode(), method="POST", headers={"content-type": "application/json"})
    return urllib.request.urlopen(req, timeout=30).read().decode()


TRICKS = [
    "<script>pwn()</script>", "<SCRIPT>pwn()</SCRIPT>", "<scr<script>ipt>pwn()</script>", "<img src=x onerror=pwn()>", "<img src=x OnErRoR=pwn()>",
    "<svg onload=pwn()></svg>", "<svg><script>pwn()</script></svg>", "<a href=\"javascript:pwn()\" id=j1>x</a>", "<a href=\"jav&#x09;ascript:pwn()\" id=j2>x</a>",
    "<a href=\"&#106;avascript:pwn()\" id=j3>x</a>", "<a href=\" javascript:pwn()\" id=j4>x</a>", "<iframe src=\"javascript:pwn()\"></iframe>",
    "<iframe srcdoc=\"<script>parent.pwn()</script>\"></iframe>", "<object data=\"javascript:pwn()\"></object>", "<embed src=\"javascript:pwn()\">",
    "<math><mtext><table><mglyph><style><img src=x onerror=pwn()>", "<svg><foreignObject><img src=x onerror=pwn()></foreignObject></svg>",
    "<svg><a xlink:href=\"javascript:pwn()\" id=j5><text>x</text></a></svg>", "<svg><a href=\"javascript:pwn()\" id=j6><text>x</text></a></svg>",
    "<svg><animate onbegin=pwn() attributeName=x dur=1s /></svg>", "<svg><set attributeName=onmouseover to=pwn() /></svg>",
    "<details open ontoggle=pwn()><summary>x</summary></details>", "<video><source onerror=pwn()></video>", "<video poster=\"javascript:pwn()\"></video>",
    "<div style=\"background:url(javascript:pwn())\">x</div>", "<div style=\"background:url(&#106;avascript:pwn())\">x</div>",
    "<style>@import 'https://example.com/x.css'; body{color:red}</style>", "<form action=\"javascript:pwn()\"><button id=b1>go</button></form>",
    "<noscript><p title=\"</noscript><img src=x onerror=pwn()>\"></noscript>", "<div data-path='\"/><img src=x onerror=pwn()>'>x</div>",
    "<base href=\"javascript:pwn()//\"><a href=\"x\" id=j7>x</a>", "<meta http-equiv=\"refresh\" content=\"0;url=javascript:pwn()\">",
    "<template><img src=x onerror=pwn()></template>", "<xmp><img src=x onerror=pwn()></xmp>", "<!--<img src=x onerror=pwn()>-->",
    "<div class=\"a&quot; onclick=&quot;pwn()\" id=c1>x</div>", "<custom-elem onclick=pwn() id=c2>text</custom-elem>",
    "<a href=\"data:text/html;base64,PHNjcmlwdD5wYXJlbnQucHduKCk8L3NjcmlwdD4=\" id=j8>x</a>", "<img src=\"data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9cHduKCk+\">",
    "<a href=\"//example.com/x\" id=j9>x</a>", "<input autofocus onfocus=pwn()>", "<select autofocus onfocus=pwn()></select>", "<marquee onstart=pwn()>x</marquee>",
    "<img src=x onerror=\"&#112;wn()\">", "<div style=\"behavior:url(x.htc)\">x</div>", "<svg><use href=\"data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9cHduKCk+#x\"/></svg>",
]
SLIDES = "".join(f'<section data-sid="t{i}"><div class="box" id="b{i}" style="left: 10px; top: 10px; width: 100px; height: 100px;"><div class="content">{t}</div></div></section>' for i, t in enumerate(TRICKS))
OWNER = """<!doctype html><html><head><meta charset="utf-8"><title>Owner deck</title><style id="deck-theme">.reveal{color:#111}</style></head><body>
<div class="reveal"><div class="slides">
<section data-sid="o1"><div class="box live" id="live1"><div class="content"><iframe src="assets/demo.html" sandbox="allow-scripts allow-pointer-lock"></iframe></div></div>
<style class="slide-css" media="not all">.box{color:red}</style></section>
<section data-sid="o2"><div class="box" id="o2b"><div class="content"><p>Owner text</p><script>window.ownerScript = true</script></div></div></section>
</div></div>
<script id="deck-shapes">window.deckShapes = 1</script><script>Reveal = { initialize() {} }; window.ownerInit = true</script></body></html>"""
UNSAFE = [r"<script", r"\son\w+\s*=", r"javascript:", r"vbscript:", r"<iframe[^>]*srcdoc", r"<object", r"<embed", r"<form", r"<math", r"<foreignobject",
          r"<use\b", r"<animate", r"<set\b", r"<base\b", r"<meta\b", r"xlink:href", r"data:text/html", r"data:image/svg", r"@import", r"<template", r"<input", r"<select"]


def unsafe(text):
    t = html.unescape(text).lower()
    return [p for p in UNSAFE if re.search(p, t)]


out = clean("slides", SLIDES)
check("cleaned slides keep nothing that can run: no scripts, handlers, script URLs, frames, objects, forms, imports", not unsafe(out), unsafe(out))
with sync_playwright() as p:   # what an editor really sends: the browser's own serialisation of the slides (always well formed)
    b = p.chromium.launch(channel="chrome"); pg = b.new_page()
    SERIAL = pg.evaluate("""h => { const d = new DOMParser().parseFromString('<div class="slides">' + h + '</div>', 'text/html'); return [...d.querySelectorAll('.slides > section')].map(s => s.outerHTML).join(''); }""", SLIDES)
    # the boxes that are boxes in the browser's own reading (the <math> trick turns everything after it into a style's text)
    REAL = pg.evaluate("""h => { const d = new DOMParser().parseFromString('<div class="slides">' + h + '</div>', 'text/html'); return [...d.querySelectorAll('.slides > section > .box[id]')].map(b => b.id); }""", SERIAL)
    b.close()
out2 = clean("slides", SERIAL)
check("…also the tricks as a browser serialises them (what an editor sends)", not unsafe(out2), unsafe(out2))
missing = [i for i in REAL if f'id="{i}"' not in out2]
check("…and every box of theirs the browser sees as a box is still there", not missing and len(REAL) > 10, f"{len(REAL)} boxes, missing {missing}")
composed = clean("compose", '<section data-sid="o1"><div class="box live" id="live1"><div class="content"><iframe src="assets/demo.html" sandbox="allow-scripts allow-pointer-lock"></iframe></div></div><style class="slide-css" media="not all">.box{color:red}</style></section>'
                 '<section><div class="box" id="x1"><div class="content"><iframe src="https://example.com"></iframe><style>.box{color:blue}</style><img src=x onerror=pwn()></div></div></section>' + SLIDES, OWNER, "New title")
slides_part = composed.split('<div class="slides">', 1)[1].split("</div></div>\n<script", 1)[0] if '<div class="slides">' in composed else ""
check("a collaborator's save keeps the owner's head, theme and deck scripts, and takes their title",
      '<script id="deck-shapes">window.deckShapes = 1</script>' in composed and "window.ownerInit = true" in composed and '<style id="deck-theme">.reveal{color:#111}</style>' in composed and "<title>New title</title>" in composed, composed[:400])
check("…keeps the owner's live box and slide style as they were, drops a frame and style of the collaborator's own",
      '<iframe src="assets/demo.html" sandbox="allow-scripts allow-pointer-lock"></iframe>' in slides_part and ".box{color:red}" in slides_part and "example.com" not in slides_part and ".box{color:blue}" not in slides_part, slides_part[:600])
check("…and nothing that can run in the slides", not unsafe(slides_part), unsafe(slides_part))
# slides a collaborator left as they were stay the owner's own, exactly: scripts and all (they only change the ones they edit)
S1 = '<section data-sid="k1">\n  <div class="box" id="a1"><div class="content">Has a script</div></div>\n  <script>window.ownerSlide = 1</script>\n  <canvas id="c1"></canvas>\n</section>'
S2 = '<section data-sid="k2">\n  <div class="box" id="a2"><div class="content">Plain</div></div>\n</section>'
S3 = '<section>\n  <div class="box" id="a3" onclick="ownerClick()"><div class="content">No id yet</div></div>\n  <script>window.ownerOld = "</section>"</script>\n</section>'
OWN = f'<!doctype html><html><head><title>Kept</title><script>var s = "<section>";</script></head><body><div class="reveal"><div class="slides">{S1}\n{S2}\n<section>{S3}</section>\n</div></div><script id="deck-present">1</script></body></html>'
C1, C3 = '<section data-sid="k1"><div class="box" id="a1"><div class="content">Has a script</div></div></section>', '<section data-sid="sx3"><div class="box" id="a3"><div class="content">No id yet</div></div></section>'
mine = C1 + '<section data-sid="k2"><div class="box" id="a2"><div class="content">Plain, edited</div></div></section>' + '<section>' + C3 + '</section>'
k = clean("compose", mine, OWN, "Kept", same=[{"sid": "k1", "at": 0}, {"sid": "sx3", "at": 2}], count=3)
check("a collaborator's save keeps, exactly, the owner's slides they didn't touch (scripts, canvas, handlers too), with their edit to another slide",
      S1 in k and "Plain, edited" in k and 'window.ownerOld = "</section>"' in k and 'onclick="ownerClick()"' in k and '<section data-sid="sx3">' in k and k.count("<section data-sid=") == 3, k)
lie = '<section data-sid="k1"><div class="box" id="a1"><div class="content">Has a script<img src=x onerror=pwn()></div></div></section>' + mine[len(C1):]
k = clean("compose", lie, OWN, "Kept", same=[{"sid": "k1", "at": 0}], count=3)
check("…a slide sent as untouched though changed by hand comes back as the owner's own: nothing of theirs in it", S1 in k and "onerror" not in k, k)
k = [clean("compose", mine, OWN, "Kept", **x) for x in ({"same": [{"sid": "k2", "at": 0}], "count": 3}, {"same": [{"sid": "k1", "at": 0}], "count": 2}, {"same": [{"sid": "k1", "at": 9}], "count": 3})]
check("…but only the slide it says (by id and place), and only against the version they started from (else just cleaned)",
      all("window.ownerSlide" not in x and "<canvas" not in x and "Plain, edited" in x for x in k), [x[-500:] for x in k])
two = clean("compose", C1 + C1, OWN, "Kept", same=[{"sid": "k1", "at": 0}], count=3)
check("…and once: the same slide sent twice brings back the owner's only once", two.count("window.ownerSlide") == 1, two)

view = clean("collab", OWNER)
check("the deck a collaborator opens has none of the owner's scripts (the owner's live box and theme stay)",
      "<script" not in view.lower() and 'src="assets/demo.html"' in view and "deck-theme" in view and "Owner text" in view, view[:500])

# the cleaned tricks, in real browsers: as the editor loads a deck (DOMParser, nodes into the page) and as a page of its own
TRAP = ("<script>window.__pwned = []; window.pwn = () => window.__pwned.push(1); window.alert = window.pwn;"   # the tripwire, and links that don't leave the page
        "addEventListener('click', e => { const a = e.target.closest && e.target.closest('a'); if (a && !/^\\s*javascript:/i.test(a.getAttribute('href') || '')) e.preventDefault(); }, true);</script>")
with sync_playwright() as p:
    for engine in ("webkit", "chromium"):
        b = p.webkit.launch() if engine == "webkit" else p.chromium.launch(channel="chrome")
        pg = b.new_page()
        pg.set_content("<!doctype html><html><head>" + TRAP + "</head><body><div class='reveal'><div class='slides' id=host></div></div></body></html>")
        pg.evaluate("""html => { const d = new DOMParser().parseFromString('<div class="slides">' + html + '</div>', 'text/html');
          for (const s of d.querySelectorAll('.slides > section')) document.getElementById('host').append(document.importNode(s, true)); }""", out)
        pg.wait_for_timeout(1500)
        for sel in ["a", "button", "summary", "div", "svg a"]:
            for el in pg.query_selector_all(f"#host {sel}")[:60]:
                try: el.click(timeout=200, force=True, no_wait_after=True)
                except Exception: pass
        pg.wait_for_timeout(500)
        ran_editor = pg.evaluate("window.__pwned ? window.__pwned.length : -1")   # (-1: the page was navigated away)
        pg2 = b.new_page(); pg2.set_content("<!doctype html><html><head>" + TRAP + "</head><body>" + out + out2 + "</body></html>"); pg2.wait_for_timeout(1500)
        ran_page = pg2.evaluate("window.__pwned.length")
        check(f"{engine}: none of the cleaned tricks runs, loaded as the editor loads a deck (and clicked) or as a page", ran_editor == 0 and ran_page == 0, f"editor {ran_editor}, page {ran_page}")
        pg3 = b.new_page(); pg3.set_content(clean("collab", OWNER.replace("<head>", "<head>" + TRAP))); pg3.wait_for_timeout(800)
        check(f"{engine}: the owner's scripts don't run in the deck a collaborator opens", pg3.evaluate("[!!window.ownerScript, !!window.ownerInit, !!window.deckShapes]") == [False, False, False])
        # control: the tricks do run when not cleaned (so the tripwire works)
        pg4 = b.new_page(); pg4.set_content("<!doctype html><html><head>" + TRAP + "</head><body>" + SLIDES + "</body></html>"); pg4.wait_for_timeout(1500)
        check(f"{engine}: (control) uncleaned, the tricks do run", pg4.evaluate("window.__pwned.length") > 0)
        b.close()

# the editor's own markup comes through as it is: every slide of every deck in --decks
decks = sorted(glob.glob(os.path.join(args.decks, "**", "deck.html"), recursive=True))
changed = []
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome"); pg = b.new_page()
    norm = """h => { const d = new DOMParser().parseFromString('<div class="slides">' + h + '</div>', 'text/html'); return [...d.querySelectorAll('.slides > section')].map(s => s.outerHTML); }"""
    for f in decks:
        src = open(f, encoding="utf-8", errors="replace").read()
        m = re.search(r'<div class="slides"[^>]*>(.*)</div>\s*</div>', src, re.S)
        if not m: continue
        a = pg.evaluate(norm, m.group(1)); c = pg.evaluate(norm, clean("slides", m.group(1), src))
        for i, (x, y) in enumerate(zip(a, c)):
            if x != y: changed.append((os.path.relpath(f, args.decks), i + 1, x, y))
        if len(a) != len(c): changed.append((os.path.relpath(f, args.decks), "count", len(a), len(c)))
    b.close()
def first_diff(x, y):
    i = next((k for k in range(min(len(x), len(y))) if x[k] != y[k]), min(len(x), len(y)))
    return f"…{x[max(0, i - 60):i + 80]!r} → …{y[max(0, i - 60):i + 80]!r}"
check(f"every slide of the {len(decks)} decks in {args.decks} comes through the cleaning unchanged", not changed,
      "; ".join(f"{d} slide {s}: {first_diff(x, y) if isinstance(x, str) else (x, y)}" for d, s, x, y in changed[:4]) + f" ({len(changed)} slides differ)")
print("ALL PASSED" if not failures else f"{len(failures)} FAILED: {', '.join(failures)}")
sys.exit(1 if failures else 0)
