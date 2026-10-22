# /// script
# dependencies = ["playwright"]
# ///
"""Glideshow from an agent's side, end to end: the `glideshow` command as the skill (skills/glideshow/SKILL.md) tells an
agent to use it, in a library, cache and port of its own (the user's server and decks are never touched).

    uv run test/agent.py

Covers: a quiet CLI (new --no-open and find leave the open editor alone; selection says when nothing reports, and how
old a report is; stop; a test server on its own port records itself apart), exact layouts (glideshow layout, the docs'
table written from the editor's own), the slides without the inlined CSS/JS, figures (placed with the command that made
them, refreshed, replaced in place), render / check (every problem kind, Morph slides never caught mid-animation, -o
keeping other slides, a stack's sub-slides), and connectors that follow their shapes when a deck loads (in the slideshow and the editor),
including U-shaped feedback edges.
"""
import functools, http.server, json, os, re, struct, subprocess, sys, tempfile, threading, time, urllib.request, zlib
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="glideshow-agent-"))
PORT = int(os.environ.get("AGENT_TEST_PORT") or 48950)
ENV = {**os.environ, "GLIDESHOW_HOME": str(TMP / "decks"), "GLIDESHOW_CACHE": str(TMP / "cache"), "GLIDESHOW_PORT": str(PORT),
       "GLIDESHOW_OFFLINE": "1", "GLIDESHOW_TRASH": str(TMP / "trash"), "GLIDESHOW_SYNC_EVERY": "2"}   # the library's commit pass every 2 s
REAL_STATE = Path.home() / ".glideshow" / "server.json"
failures = []


def check(name, ok, detail: object = ""):
    print(("PASS " if ok else "FAIL ") + name + (f"  ({str(detail)[:600]})" if detail and not ok else ""), flush=True)
    if not ok: failures.append(name)


def gs(*args, timeout=180):
    r = subprocess.run(["uv", "run", "--quiet", "--project", str(ROOT), "python", "-m", "glideshow", *args], env=ENV, capture_output=True, text=True, timeout=timeout)
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def ping():
    try: return json.load(urllib.request.urlopen(f"http://localhost:{PORT}/api/ping", timeout=2))
    except Exception: return None


def png(w, h, rgb=(26, 115, 232)):
    """A plain PNG of one colour (no imaging library needed)."""
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def section(deck: Path, html: str):   # a slide appended to a deck, as an agent writes one
    t = (deck / "deck.html").read_text(); i = t.rindex("</section>") + len("</section>")
    (deck / "deck.html").write_text(t[:i] + "\n" + html + t[i:])


def boxtag(deck: Path, box_id: str) -> str:
    m = re.search(rf'<div\b[^>]*\bid="{re.escape(box_id)}"[^>]*>', (deck / "deck.html").read_text())
    return m.group() if m else ""


def geo(tag: str) -> list:
    return [round(float(re.search(rf"\b{k}:\s*(-?[\d.]+)px", tag).group(1))) for k in ("left", "top", "width", "height")]


def serve(root: Path) -> int:
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(root)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1]


real_before = REAL_STATE.stat().st_mtime_ns if REAL_STATE.exists() else None
try:
    # ---------- a quiet command line ----------
    code, a_out, err = gs("new", "Deck A", "--no-open")
    deck_a = Path(a_out.splitlines()[0]) if a_out else Path()
    check("new --no-open makes the deck, prints only its folder, and starts the background server (which keeps versions) without opening anything",
          code == 0 and a_out == str(deck_a) and (deck_a / "deck.html").exists() and (deck_a / "AGENTS.md").exists() and bool(ping()), (code, a_out, err))
    if code: print("server.log:\n" + ((TMP / "cache" / "server.log").read_text()[-3000:] if (TMP / "cache" / "server.log").exists() else "(none)"), flush=True)
    code, _, err = gs(deck_a.name, "--no-open")   # the editor shows deck A
    p = ping() or {}
    check("a server on GLIDESHOW_PORT records itself apart (server-PORT.json) and never touches the usual server.json",
          (TMP / "cache" / f"server-{PORT}.json").exists() and (REAL_STATE.stat().st_mtime_ns if REAL_STATE.exists() else None) == real_before and p.get("deck", "").endswith(deck_a.name), (p, err))
    code, b_out, err = gs("new", "Deck B", "--no-open")
    deck_b = Path(b_out.splitlines()[0]) if b_out else Path()
    check("new --no-open with the editor open leaves it on the deck it shows", code == 0 and (deck_b / "deck.html").exists() and (ping() or {}).get("deck", "").endswith(deck_a.name), (code, b_out, ping()))
    code, out, _ = gs("find", "deck b")
    check("find prints the best match's folder and opens nothing", code == 0 and out == str(deck_b) and (ping() or {}).get("deck", "").endswith(deck_a.name), out)
    code, out, err = gs("selection")
    check("selection exits 1, saying so, when no editor window reports what it shows", code == 1 and "No editor window" in (err + out), (code, out, err))
    urllib.request.urlopen(urllib.request.Request(f"http://localhost:{PORT}/api/selection", method="POST", headers={"X-Glideshow": "1"},
                           data=json.dumps({"slide": 1, "slides": 1, "boxes": [{"id": "title", "shape": "text", "index": 0, "x": 65, "y": 152, "w": 1790, "h": 431, "text": "Deck A"}]}).encode()))
    code, out, _ = gs("selection")
    check("…and with a report: the slide, the selected box and how long ago it was reported", code == 0 and "box id=title" in out and re.search(r"reported \d+ s ago", out), out)
    section(deck_a, '<section data-layout="blank"><div class="box" id="extra" style="left: 100px; top: 100px; width: 600px; height: 100px;"><div class="content">Extra</div></div></section>')
    code, out, _ = gs("selection")
    check("…warning when the editor's slide count no longer matches deck.html (a stale report)", "reported 1 slides but deck.html now has 2" in out, out)
    t = (deck_a / "deck.html").read_text(); (deck_a / "deck.html").write_text(t[:t.rindex('<section data-layout="blank"><div class="box" id="extra"')] + t[t.rindex("</section>") + len("</section>"):])

    # ---------- layouts, docs and slides ----------
    code, table, _ = gs("layout")
    theme_js = (ROOT / "editor" / "js" / "theme.js").read_text()
    names = re.findall(r"^  \['([\w-]+)', '", theme_js, re.M)
    check("layout lists every layout the editor has, with its placeholders' exact geometry",
          code == 0 and names and all(re.search(rf"^{re.escape(n)}\b", table, re.M) for n in names) and "body 65,242 1790×721" in table, table[:300])
    code, docs, _ = gs("docs")
    lay = re.search(r"\['title-body'.*?\]\]\]", theme_js).group()
    nums = re.findall(r"\['(\w+)', (\d+), (\d+), (\d+), (\d+)", lay)
    check("the docs' layout table is written from the editor's own layouts (no drift), and AGENTS.md has it too",
          "{{LAYOUTS}}" not in docs and all(f"{r} (`{r}`) at {x}, {y}, {w} × {h}" in docs for r, x, y, w, h in nums) and "65, 242, 1790 × 721" in (deck_b / "AGENTS.md").read_text(), nums)
    check("the docs hold no change history", not re.search(r"before this change|Before this change|older 8 px", docs))
    fences = re.findall(r"```html\n(.*?)```", docs, re.S)
    unnamed = [t for f in fences for t in re.findall(r'<div class="box[^"]*"[^>]*>', f) if " id=" not in t]
    check("every box in the docs' examples has an id", fences and not unnamed, unnamed[:3])
    code, sl, _ = gs("layout", "title-body", "--prefix", "res", "--deck", str(deck_b))
    section(deck_b, sl)
    code, sl2, _ = gs("layout", "title-body", "--prefix", "res", "--deck", str(deck_b))
    check("layout --prefix --deck gives a slide to paste, with ids the deck doesn't use yet",
          'id="res-title"' in sl and 'id="res-body"' in sl and 'data-layout="title-body"' in sl and 'id="res-title-2"' in sl2, sl2[:200])
    code, out, _ = gs("slides", str(deck_b))
    lines = (deck_b / "deck.html").read_text().splitlines()
    heads = re.findall(r"<!-- slide (\d+): deck.html line (\d+) -->", out)
    check("slides prints only the slides (no inlined CSS / JS), each with its true line in deck.html",
          code == 0 and [h[0] for h in heads] == ["1", "2"] and all(lines[int(n) - 1].lstrip().startswith("<section") for _, n in heads)
          and "deck-base" not in out and len(out) < 6000, (heads, len(out)))

    # ---------- figures ----------
    (deck_b / "src").mkdir()
    (deck_b / "src" / "plot.py").write_text("import json, struct, sys, zlib\nw, h = json.load(open('src/size.json'))\nout = sys.argv[sys.argv.index('--out') + 1]\n"
        "raw = b''.join(b'\\x00' + b'\\x1a\\x73\\xe8' * w for _ in range(h))\nc = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)\n"
        "open(out, 'wb').write(b'\\x89PNG\\r\\n\\x1a\\n' + c(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + c(b'IDAT', zlib.compress(raw)) + c(b'IEND', b''))\n")
    (deck_b / "src" / "size.json").write_text("[800, 400]")
    (deck_b / "assets").mkdir(exist_ok=True)
    subprocess.run(["uv", "run", "--no-project", "python", "src/plot.py", "--out", "assets/curves.png"], cwd=deck_b, check=True)
    code, size, _ = gs("figure", "size", str(deck_b), "--slide", "2")
    check("figure size gives matplotlib settings that fit the slide's body area (1 in = 192 px)", code == 0 and "figsize=(9.32, 3.76)" in size and "dpi=384" in size, size[:300])
    code, out, err = gs("figure", "add", str(deck_b), "assets/curves.png", "--slide", "2", "--id", "curves", "--alt", "Return over training",
                        "--source", "uv run --no-project python src/plot.py --out {out}")
    tag = boxtag(deck_b, "curves")
    after = (deck_b / "deck.html").read_text()
    check("figure add keeps the file's name, gives the box an id, alt text and its source, and fits it into the body area",
          code == 0 and 'src="assets/curves.png"' in after and 'alt="Return over training"' in after and "data-source=" in tag and "data-made=" in tag
          and geo(tag) == [239, 242, 1442, 721] and not [f for f in (deck_b / "assets").iterdir() if re.fullmatch(r"[0-9a-f]{12}\.png", f.name)], (out, err, tag))
    made = re.search(r'data-made="([^"]+)"', tag).group(1) if tag else ""
    (deck_b / "src" / "size.json").write_text("[600, 600]"); time.sleep(1.1)
    code, out, err = gs("figure", "refresh", str(deck_b))
    refresh_out = out
    tag2 = boxtag(deck_b, "curves")
    check("figure refresh re-runs the recorded command and puts the new picture in the same place (same box, id and alt)",
          code == 0 and geo(tag2) == [600, 242, 721, 721] and re.search(r'data-made="([^"]+)"', tag2).group(1) != made
          and (deck_b / "deck.html").read_text().count('class="box image"') == 1 and 'alt="Return over training"' in (deck_b / "deck.html").read_text(), (out, err, tag2))
    check("…saying which command it ran, and that the alt text may be stale; refresh --alt updates it",
          "#curves: uv run --no-project python src/plot.py --out assets/curves.png" in refresh_out and "its alt text is still" in refresh_out
          and gs("figure", "refresh", str(deck_b), "curves", "--alt", "Return over training, 16 seeds")[0] == 0 and 'alt="Return over training, 16 seeds"' in (deck_b / "deck.html").read_text(), refresh_out)
    code, out, err = gs("figure")
    check("glideshow figure alone prints the whole usage", code == 1 and all(f"glideshow figure {w}" in out for w in ("add", "refresh", "size")), out[:200])
    (TMP / "seeds10.png").write_bytes(png(400, 200, (217, 48, 37)))
    code, out, err = gs("figure", "add", str(deck_b), str(TMP / "seeds10.png"), "--replace", "curves")
    t3 = (deck_b / "deck.html").read_text()
    check("figure add --replace swaps the picture in place: the box's spot and id kept, its alt and source carried over, the old file gone",
          code == 0 and t3.count('class="box image"') == 1 and 'src="assets/seeds10.png"' in t3 and 'alt="Return over training, 16 seeds"' in t3 and "data-source=" in boxtag(deck_b, "curves")
          and geo(boxtag(deck_b, "curves")) == [600, 422, 721, 360] and not (deck_b / "assets" / "curves.png").exists(), (out, err))

    # ---------- a Google Slides import: a run states only what differs from its paragraph ----------
    sys.path.insert(0, str(ROOT))
    from glideshow import gslides
    conv = gslides.Converter(json.loads((ROOT / "test" / "fixtures" / "gslides-api.json").read_text()), TMP / "gs-deck", get=lambda url: b"")
    imported = "\n".join(conv.convert())
    paras = re.findall(r'<(div|li)\b[^>]*style="([^"]*font-size: ([\d.]+)px[^"]*)"[^>]*>(.*?)</\1>', imported, re.S)
    repeats = [(size, inner[:80]) for _, _, size, inner in paras if re.search(rf'<span style="[^"]*font-size: {re.escape(size)}px', inner)]
    check("an imported paragraph's runs don't repeat its font size (one place to change it)", paras and not repeats, repeats[:3])

    # ---------- render and check ----------
    deck_c = TMP / "decks" / "problems"; gs("new", "Problems", "--no-open"); next((TMP / "decks").glob("problems-*")).rename(deck_c)
    section(deck_c, """<section data-layout="blank">
  <div class="box" id="long" style="left: 100px; top: 100px; width: 600px; height: 80px;"><div class="content" style="font-size: 40px;">A paragraph far too long for the little box it was given, so it runs out of the bottom</div></div>
  <div class="box" id="code" style="left: 100px; top: 300px; width: 300px; height: 200px;"><div class="content"><pre><code class="language-python">loss = ((pred - target) ** 2).mean(-1).sum(-1)</code></pre></div></div>
  <div class="box" id="off" style="left: 1800px; top: 900px; width: 300px; height: 100px;"><div class="content">Off the edge</div></div>
  <div class="box" id="over-a" style="left: 800px; top: 100px; width: 400px; height: 200px;"><div class="content">Caption one</div></div>
  <div class="box" id="over-b" style="left: 1000px; top: 200px; width: 400px; height: 200px;"><div class="content">Caption two</div></div>
  <div class="box" id="tiny" style="left: 800px; top: 600px; width: 400px; height: 80px;"><div class="content" style="font-size: 16px;">Footnote in 16 px</div></div>
  <div class="box image" id="gone" style="left: 1300px; top: 500px; width: 300px; height: 200px;"><div class="content"><img src="assets/missing.png"></div></div>
  <div class="box" style="left: 100px; top: 700px; width: 400px; height: 100px;"><div class="content">No id here</div></div>
  <div class="box" id="long" style="left: 100px; top: 850px; width: 400px; height: 100px;"><div class="content">Same id</div></div>
  <div class="box" id="arrow" data-shape="line" data-from="nowhere:r" data-to="code:l" style="left: 0px; top: 0px; width: 10px; height: 0px;"><div class="content"></div></div>
  <div class="box note" id="note-1" style="left: 1400px; top: 60px; width: 400px; height: 150px;"><div class="content">Make the plot bigger</div></div>
</section>
<section data-layout="blank">
  <div class="box" id="node" data-shape="roundrect" style="left: 100px; top: 100px; width: 600px; height: 300px; --fill: #e8f0fe;"><div class="content">Replay buffer</div></div>
  <div class="box" id="label" style="left: 150px; top: 200px; width: 500px; height: 100px;"><div class="content" style="text-align: center;">hidden label</div></div>
  <div class="box" id="caption" style="left: 900px; top: 150px; width: 600px; height: 100px;"><div class="content">An arrow runs through me</div></div>
  <div class="box" id="through" data-shape="line" style="left: 850px; top: 200px; width: 700px; height: 0px; --sw: 4px;"><div class="content"></div></div>
  <div class="box" id="ghost" style="left: 900px; top: 400px; width: 600px; height: 100px;"><div class="content" style="color: #fafafa;">White on white</div></div>
  <div class="box" id="badside" data-shape="line" data-from="node:x" data-to="caption:l" style="left: 0px; top: 0px; width: 10px; height: 0px;"><div class="content"></div></div>
  <div class="box image" id="squeezed" style="left: 100px; top: 600px; width: 300px; height: 300px;"><div class="content"><img src="assets/wide.png" alt="A wide plot"></div></div>
</section>
<section data-layout="blank" data-auto-animate>
  <div class="box" id="m2" data-morph="no-such-box" style="left: 100px; top: 100px; width: 400px; height: 200px;"><div class="content">Step two</div></div>
</section>""")
    (deck_c / "assets" / "wide.png").write_bytes(png(400, 200))
    code, out, err = gs("check", str(deck_c), "--json")
    kinds = {q["kind"] for q in json.loads(out)["problems"]} if out.startswith("{") else set()
    want = {"overflow", "cut-off", "off-slide", "overlap", "small-text", "picture", "alt", "id", "connector", "morph", "note", "contrast", "shape"}
    check("check finds every kind of problem (overflow, cut-off code, off-slide, overlap, small text, contrast, broken / alt-less / squeezed picture, ids, connector, Morph, note) and exits 1",
          code == 1 and want <= kinds, (code, sorted(want - kinds), err[-300:]))
    code, out, _ = gs("check", str(deck_c), "4")
    check("…naming each in words an agent can act on", "data-morph=\"no-such-box\"" in out and "problem" in out, out[-300:])
    code, out, _ = gs("check", str(deck_c), "3")
    check("…including text on text inside a shape, a line through text, a side that isn't t/r/b/l and too little contrast",
          all(t in out for t in ("the text of #node", "#through runs through the text of #caption", '"node:x"', "#ghost", "#squeezed is 400×200")), out)
    code, out, _ = gs("check", str(deck_c), "2")
    check("…and a note's whole text", '"Make the plot bigger"' in out, out[-400:])
    code, out, _ = gs("check", str(deck_c), "2")
    check("an overflow says what box height would fit the text", re.search(r"#long .*make the box at least \d+ px tall \(it is 80\)", out), out[:400])
    section(deck_c, """<section data-layout="blank">
  <div class="box" id="runoff" data-valign="top" style="left: 100px; top: 960px; width: 800px; height: 100px;"><div class="content" style="font-size: 40px;">One line<br>two lines<br>three lines<br>four lines past the bottom</div></div>
  <div class="box image" id="edge" style="left: -40px; top: 100px; width: 400px; height: 200px;"><div class="content"><img src="assets/wide.png" alt="A wide plot"></div></div>
</section>""")
    code, out, _ = gs("check", str(deck_c), "5")
    check("text running off the bottom of the slide is called that (not just a spill), and a picture off the edge suggests a crop",
          "#runoff" in out and "off the bottom of the slide" in out and "#edge" in out and "data-crop" in out, out)
    section(deck_c, """<section data-layout="blank">
  <div class="box" id="imp-title" style="left: 60px; top: 40px; width: 1800px; height: 120px;"><div class="content"><span style="font-family: 'Georgia', serif; font-size: 67.2px; color: #1a1a6e">Imported title</span></div></div>
  <div class="box" id="imp-body" style="left: 60px; top: 200px; width: 1800px; height: 700px;"><div class="content" style="line-height: 1.38;"><span style="font-family: 'Georgia', serif; font-size: 53.3px; color: #333333">Imported body text</span></div></div>
</section>""")
    code, out, _ = gs("layout", "title-body", "--prefix", "new", "--deck", str(deck_c), "--like", "6")
    check("layout --like N gives the new slide's placeholders that slide's title and body styles (an imported deck's look)",
          code == 0 and "font-size: 67.2px; color: #1a1a6e" in out and "font-family: 'Georgia', serif; font-size: 53.3px" in out and "line-height: 1.38" in out
          and 'id="new-title"' in out, out[:600])
    code, out, err = gs("check", str(deck_a))
    check("a new deck checks clean (exit 0, \"no problems found\")", code == 0 and out.endswith("no problems found"), (code, out, err))
    deck_e = deck_a
    def step(k):   # Morph step k: node A moves right, and a new node joins, the others carried over
        node = lambda j: (f'<div class="box" id="e{k}-n{j}"' + (f' data-morph="e{k - 1}-n{j}"' if j < k else "")
                          + f' data-shape="roundrect" style="left: {200 + 300 * j}px; top: 700px; width: 250px; height: 150px; --fill: #fce8e6;"><div class="content">Step {j + 1}</div></div>')
        a = f'<div class="box" id="e{k}-a"' + (f' data-morph="e{k - 1}-a"' if k else "") + f' data-shape="roundrect" style="left: {200 + 300 * k}px; top: 400px; width: 400px; height: 200px; --fill: #e8f0fe;"><div class="content">Node A</div></div>'
        return f'<section data-layout="blank"{" data-auto-animate" if k else ""}>\n  {a}\n  ' + "".join(node(j) for j in range(k + 1)) + "\n</section>"
    steps = "\n".join(step(k) for k in range(3))
    section(deck_e, steps)
    out_dir = TMP / "renders"
    code, out, err = gs("render", str(deck_e), "-o", str(out_dir))
    batch = {p.name: p.read_bytes() for p in out_dir.glob("slide-*.png")}
    singles = {}
    for n in (3, 4):
        gs("render", str(deck_e), str(n), "-o", str(TMP / f"single-{n}"))
        singles[f"slide-{n:02d}.png"] = (TMP / f"single-{n}" / f"slide-{n:02d}.png").read_bytes()
    check("render of a whole deck shows Morph steps finished, exactly as each slide rendered alone (never mid-animation)",
          code == 0 and all(batch.get(k) == v for k, v in singles.items()) and len(batch) == 4, (code, sorted(batch), err[-300:]))
    gs("render", str(deck_e), "1", "-o", str(TMP / "keep")); gs("render", str(deck_e), "2", "-o", str(TMP / "keep"))
    code, out, err = gs("render", str(deck_e), "--morph", "-o", str(TMP / "morph"))
    check("render --morph lists each Morph step's pairs (moves, fades) and saves a picture halfway through",
          code == 0 and "slide 3 (Morph from slide 2):" in out and "#e1-a (\"Node A\") ← #e0-a: moves 200,400 → 500,400" in out and "#e1-n1 (\"Step 2\") fades in" in out
          and (TMP / "morph" / "slide-03-morph.png").exists() and (TMP / "morph" / "slide-04-morph.png").exists(), out[-600:])
    check("render -o DIR keeps the other slides' pictures there", sorted(p.name for p in (TMP / "keep").glob("*.png")) == ["slide-01.png", "slide-02.png"])
    code, out, err = gs("check", str(deck_e))
    check("a Morph build written as the docs say checks clean (its first step isn't a Morph slide, whatever the slideshow adds)", code == 0 and "no problems found" in out, out)
    r = subprocess.run(f"uv run --quiet --project {ROOT} python -m glideshow render {deck_e} -o {TMP / 'pipe'} | head -1", shell=True, env=ENV, capture_output=True, text=True, timeout=180)
    check("render piped into head just stops (no traceback)", "Traceback" not in r.stderr and r.stdout.strip().endswith(".png"), r.stderr[-300:])
    section(deck_e, """<section data-layout="blank">
  <div class="box" id="g-a" data-shape="roundrect" style="left: 200px; top: 300px; width: 500px; height: 300px;"><div class="content">Env</div></div>
  <div class="box" id="g-b" data-shape="roundrect" style="left: 1200px; top: 300px; width: 500px; height: 300px;"><div class="content">Learner</div></div>
  <div class="box" id="g-label" style="left: 600px; top: 380px; width: 700px; height: 80px;"><div class="content" style="text-align: center;">transitions</div></div>
</section>""")
    code, out, err = gs("check", str(deck_e), "5")
    check("a label whose box overlaps the shapes but whose words don't touch theirs isn't reported", code == 0, out)
    code, s_out, _ = gs("new", "Stacks", "--no-open")
    deck_s = Path(s_out.splitlines()[0]) if s_out else Path()
    sub = lambda k, w, words: (f'<section data-layout="blank"><div class="box" id="st-{k}" style="left: 200px; top: 300px; width: {w}px; height: 100px;">'
                               f'<div class="content" style="font-size: 60px;">{words}</div></div></section>')
    section(deck_s, "<section>\n" + sub("main", 900, "The main slide") + "\n" + sub("below", 900, "Below it") + "\n"
            + sub("long", 300, "This text is far too long for its little box") + "\n</section>")
    code, out, err = gs("render", str(deck_s), "-o", str(TMP / "stacks"))
    shots = [(TMP / "stacks" / f"slide-{n:02d}.png").read_bytes() if (TMP / "stacks" / f"slide-{n:02d}.png").exists() else b"" for n in range(1, 5)]
    check("render shows a stack's sub-slides themselves (numbered in deck order), not the slide above them again",
          code == 0 and all(shots) and len(set(shots)) == 4, (code, [len(s) for s in shots], err[-300:]))
    code, out, err = gs("check", str(deck_s))
    check("…and check looks at them: a sub-slide's overflow is reported under its own number", code == 1 and "slide 4: text in #st-long" in out, out)

    # ---------- comments stay on their slide when slides move ----------
    t = (deck_e / "deck.html").read_text()
    t = t.replace('<section data-layout="blank">\n  <div class="box" id="e0-a"', '<section data-layout="blank" data-sid="s-step0">\n  <div class="box" id="e0-a"', 1)
    (deck_e / "deck.html").write_text(t)
    urllib.request.urlopen(urllib.request.Request(f"http://localhost:{PORT}/api/comments", method="POST", headers={"X-Glideshow": "1"},
                           data=json.dumps({"op": "add", "slide": 2, "sid": "s-step0", "box": "e0-a", "text": "Make node A blue"}).encode()))
    stored = json.loads((deck_e / "comments.json").read_text())["comments"][-1] if (deck_e / "comments.json").exists() else {}
    section_at = t.index('<section data-layout="blank" data-sid="s-step0">')
    (deck_e / "deck.html").write_text(t[:section_at] + '<section data-layout="blank"><div class="box" id="intro" style="left: 100px; top: 100px; width: 600px; height: 100px;"><div class="content">Inserted before</div></div></section>\n' + t[section_at:])
    code, out, _ = gs("comments", str(deck_e))
    check("a comment keeps its slide's id, and glideshow comments shows it on the slide it is on now (after a slide was inserted before it)",
          stored.get("sid") == "s-step0" and "slide 3 (left on slide 2), box #e0-a" in out and "Make node A blue" in out, (stored, out))

    # ---------- connectors that follow their shapes ----------
    deck_f = deck_b
    section(deck_f, """<section data-layout="blank">
  <div class="box" id="actors" data-shape="roundrect" style="left: 160px; top: 400px; width: 400px; height: 200px;"><div class="content">Actors</div></div>
  <div class="box" id="learner" data-shape="roundrect" style="left: 1360px; top: 400px; width: 400px; height: 200px;"><div class="content">Learner</div></div>
  <div class="box" id="feed" data-shape="line" data-end="fill-arrow" data-from="actors:r" data-to="learner:l" style="left: 10px; top: 10px; width: 50px; height: 50px; --sw: 4px;"><div class="content"></div></div>
  <div class="box" id="sync" data-shape="elbow" data-start="fill-arrow" data-from="actors:b" data-to="learner:b" data-out="80" style="left: 0px; top: 0px; width: 0px; height: 0px; --sw: 4px;"><div class="content"></div></div>
  <div class="box" id="back" data-shape="line" data-end="fill-arrow" data-from="learner:t" data-to="actors:t" style="left: 0px; top: 0px; width: 5px; height: 5px;"><div class="content"></div></div>
  <div class="box" id="sync2" data-shape="elbow" data-end="fill-arrow" data-from="learner:b" data-to="actors:b" style="left: 0px; top: 0px; width: 0px; height: 0px;"><div class="content"></div></div>
  <div class="box" id="plain" style="left: 100px; top: 900px; width: 600px; height: 80px;"><div class="content">E = mc</div></div>
  <div class="box" id="raised" style="left: 800px; top: 900px; width: 600px; height: 80px;"><div class="content">E = mc<sup>2</sup> and x<sub>t</sub></div></div>
</section>""")
    n_last = len(re.findall(r"<section\b", (deck_f / "deck.html").read_text()))
    port = serve(deck_f)
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="chrome")
        pg = b.new_page(viewport={"width": 1920, "height": 1080})
        pg.goto(f"http://127.0.0.1:{port}/deck.html"); pg.wait_for_function("window.Reveal && Reveal.isReady()")
        g = pg.evaluate("""() => Object.fromEntries(['feed', 'sync', 'back', 'sync2'].map(id => { const b = document.getElementById(id);
          return [id, { geo: ['left', 'top', 'width', 'height'].map(k => Math.round(parseFloat(b.style[k]))), from: b.dataset.from, to: b.dataset.to, start: b.dataset.start || '', end: b.dataset.end || '', dir: b.dataset.dir || '',
                        ys: (b.querySelector('svg path.l')?.getAttribute('d') || '').match(/-?[\\d.]+/g)?.filter((_, i) => i % 2).map(Number) || [] }]; }))""")
        check("the slideshow fits an attached line to its shapes when the deck loads, whatever geometry was written",
              g["feed"]["geo"] == [560, 500, 800, 0], g["feed"])
        check("an elbow with both ends on the bottom draws a U running data-out px below them (a feedback edge)",
              g["sync"]["geo"] == [360, 600, 1200, 0] and g["sync"]["ys"] and abs(max(g["sync"]["ys"]) - 80) < 1, g["sync"])
        check("a line whose ends swap sides keeps the left end first: its attachments and arrow head swap with them",
              g["back"]["from"] == "actors:t" and g["back"]["to"] == "learner:t" and g["back"]["start"] == "fill-arrow" and not g["back"]["end"], g["back"])
        check("a feedback edge written in the direction it means (learner → actors, head on data-end) draws the same U, head at the actors",
              g["sync2"]["from"] == "actors:b" and g["sync2"]["start"] == "fill-arrow" and not g["sync2"]["end"] and g["sync2"]["geo"] == [360, 600, 1200, 0], g["sync2"])
        hs = pg.evaluate("['plain', 'raised'].map(id => document.querySelector('#' + id + ' > .content').offsetHeight)")
        check("a superscript or subscript doesn't make its line taller (as in Slides)", hs[0] == hs[1], hs)
        b.close()
        # the editor does the same when it opens the deck
        code, _, err = gs(deck_f.name, "--no-open")
        b = pw.chromium.launch(channel="chrome")
        ed = b.new_page(viewport={"width": 1440, "height": 900})
        ed.goto(f"http://localhost:{PORT}/edit"); ed.wait_for_function("typeof slides !== 'undefined' && slides.length > 2", timeout=30000)
        eg = ed.evaluate(f"(() => {{ const b = slides[{n_last - 1}].querySelector('#feed'); return ['left', 'top', 'width', 'height'].map(k => Math.round(parseFloat(b.style[k]))); }})()")
        check("the editor fits attached lines to their shapes as it loads the deck", eg == [560, 500, 800, 0], eg)
        sid2 = ed.evaluate("slides[1].dataset.sid")
        moved = ed.evaluate("sid => { const s = slides.splice(1, 1)[0]; slides.splice(2, 0, s); const n = cmN({ sid, slide: 2 }); slides.splice(2, 1); slides.splice(1, 0, s); return n; }", sid2)
        check("the editor's comments panel puts a comment on its slide by id (slide 2 moved to 3: the comment goes with it)", bool(sid2) and moved == 3, (sid2, moved))
        b.close()

    (deck_b / ".DS_Store").write_bytes(b"\0\0\0\1Bud1"); time.sleep(4)
    tracked = subprocess.run(["git", "-C", str(TMP / "decks"), "ls-files"], capture_output=True, text=True).stdout
    check("the library is made with a .gitignore, and Finder's .DS_Store never goes into the history", (TMP / "decks" / ".gitignore").exists() and ".DS_Store" not in tracked, tracked[:200])
    from importlib import import_module
    sys.path.insert(0, str(ROOT)); cm = import_module("glideshow.history").commit_message
    dk = lambda *ss: '<div class="slides">' + "".join(f"<section>{x}</section>" for x in ss) + "</div>"
    msgs = [cm(dk("a", "b", "c"), dk("a", "b2 hello", "c")), cm(dk("a", "b", "c"), dk("a", "b", "new one", "c")), cm(dk("a", "b", "c"), dk("a2 x", "b", "c2 y")), cm(dk("a", "b", "c"), dk("a", "c"))]
    check("version messages name every changed, new or removed slide (an inserted slide doesn't make later ones \"changed\")",
          msgs == ["slide 2: b2 hello", "new slide 3: new one", "slides 1, 3: a2 x", "slide 2 removed"], msgs)
    log = subprocess.run(["git", "-C", str(TMP / "decks"), "log", "--format=%s"], capture_output=True, text=True).stdout
    check("an agent's edits became versions without any editor open (the background server commits them)", deck_b.name in log or "outside the editor" in log, log[:300])
    code, out, _ = gs("stop")
    time.sleep(1)
    check("stop stops the server", code == 0 and not ping() and not (TMP / "cache" / f"server-{PORT}.json").exists(), out)
    outside = TMP / "elsewhere"; outside.mkdir(); (outside / "deck.html").write_text((deck_a / "deck.html").read_text())
    gs("check", str(outside))
    check("check on a folder outside the library starts no server", not ping())
    gs("check", str(deck_a)); up = bool(ping())
    gs("stop")
    check("check on a library deck starts the background server (so the edits it checks become versions)", up)
    code, out, _ = gs("selection", "--json")
    try: sj = json.loads(out)
    except ValueError: sj = None
    check("selection --json answers in JSON (and exits 1) even with no server", code == 1 and sj is not None and sj.get("slide") is None, out)
finally:
    if ping():
        try: urllib.request.urlopen(urllib.request.Request(f"http://localhost:{PORT}/api/quit", method="POST", headers={"X-Glideshow": "1"}, data=b"{}"), timeout=3)
        except Exception: pass

print("ALL PASSED" if not failures else f"{len(failures)} FAILED: {', '.join(failures)}")
sys.exit(1 if failures else 0)
