"""What the `glideshow` command gives an agent writing deck.html by hand, none of which needs the editor open (or touches
it): the exact placeholder boxes of each layout, a deck's slides without the 180 KB of inlined CSS and JS around them,
finding a deck, figures that remember the script that made them, and stopping the server.

    glideshow layout [NAME] [--deck DECK]      a layout's slide, ready to paste (no NAME: the table of layouts)
    glideshow slides DECK [N ...]              the <section>s only, each headed by its number and line in deck.html
    glideshow find WORDS                       the folder of the deck that best matches (nothing is opened)
    glideshow figure add DECK FILE --slide N [--replace ID | --at body|x,y,w,h] [--id ID] [--alt TEXT] [--source CMD]
    glideshow figure refresh DECK [ID ...]     re-run each figure's data-source and put the new picture in place
    glideshow figure size DECK --slide N [--box ID | --at …]   the matplotlib figsize / dpi / font sizes for that space
    glideshow stop                             stop the background server
"""
import datetime, html as htmllib, json, re, shlex, subprocess, sys
from pathlib import Path

from .decks import EDITOR, image_size

PT = 192 / 72   # one point on the 1920 px (10 in) canvas, as in Slides
INSET = "9.6px 19.2px"   # Slides' text insets, as the editor writes them (makeBox)
PROMPT = {"title": "Click to add title", "sub": "Click to add subtitle", "body": "Click to add text"}
REGION = (65, 242, 1790, 721)   # Title and body's body: where a figure goes when the slide has no body placeholder


def layouts(deck: Path | None = None) -> list:
    """[name, label, [[role, x, y, w, h, pt, valign, align], …]] from editor/js/theme.js (the editor's own table), with a
    deck's edited layouts (its theme block's "layouts") in their place."""
    src = (EDITOR / "js" / "theme.js").read_text()
    body = re.search(r"const LAYOUTS = (\[.*?\n\]);", src, re.S)
    if not body: raise SystemExit("couldn't read the layouts from editor/js/theme.js")
    table = json.loads(re.sub(r",\s*\]", "]", body.group(1).replace("'", '"')))
    if deck and (deck / "deck.html").exists():
        m = re.search(r"/\* slides-theme (\{.*?\}) \*/", (deck / "deck.html").read_text())
        try: edited = json.loads(m.group(1)).get("layouts", {}) if m else {}
        except ValueError: edited = {}
        table = [[n, label, edited.get(n, boxes)] for n, label, boxes in table]
    return table


def _styles_like(text: str, n: int) -> dict:
    """The title's and body's text styles on slide n, for a new slide that matches an imported deck (whose sizes, fonts and
    colours sit inline on each box, not in the theme): {role: (box id, .content style, the first text run's style)}. The
    title is the placeholder titled so, else the top text box set largest; the body the biggest other text box."""
    a, z = _slide_span(text, n)
    found = []
    for m in _boxes(text[a:z]):
        at = _attrs(m.group()); cls = at.get("class", "").split()
        if {"image", "note", "group", "video", "embed", "live"} & set(cls) or re.match(r"(line|arrowline|elbow|curve|path)$", at.get("data-shape", "")): continue
        start = a + m.start(); inner = text[start:_close_box(text, start)]
        words = re.sub(r"<[^>]+>", " ", inner).split()
        if not words: continue
        content = re.search(r'<div class="content"[^>]*>', inner)
        run = next((t for t in re.findall(r'<(?:span|p|li|font)\b[^>]*\bstyle="([^"]*)"', inner) if "font" in t or "color" in t), "")
        sizes = [float(v) for v in re.findall(r"font-size:\s*([\d.]+)px", inner)] or [0]
        x, y, w, h = _box_geo(m.group())
        found.append({"id": at.get("id", ""), "role": at.get("data-role"), "content": _attrs(content.group()).get("style", "") if content else "", "run": htmllib.unescape(run), "size": max(sizes), "y": y, "area": w * h})
    if not found: raise SystemExit(f"slide {n} has no text to take styles from")
    title = next((f for f in found if f["role"] == "title"), None) or max([f for f in found if f["y"] < 324] or found, key=lambda f: (f["size"], -f["y"]))
    rest = [f for f in found if f is not title]
    body = next((f for f in rest if f["role"] == "body"), None) or (max(rest, key=lambda f: f["area"]) if rest else None)
    return {"title": title, "sub": body or title, "body": body or title}


def layout_section(name: str, deck: Path | None = None, prefix: str = "", like: int | None = None) -> str:
    """A slide in that layout as the editor makes it: the placeholder boxes with ids (PREFIX-title …; with a deck, ids it
    doesn't use yet), sizes following the theme."""
    lay = next((x for x in layouts(deck) if x[0] == name), None)
    if not lay: raise SystemExit(f"no layout {name!r}; `glideshow layout` lists them")
    taken = (deck / "deck.html").read_text() if deck and (deck / "deck.html").exists() else ""
    if like and not taken: raise SystemExit("--like N needs --deck DECK")
    styles = _styles_like(taken, like) if like else None
    out, seen = [f'<section data-background-color="#ffffff" data-layout="{name}">'], {}
    if styles: out.append(f"  <!-- text styled like slide {like}: title as #{styles['title']['id']}, body as #{styles['body']['id']} -->")
    for role, x, y, w, h, pt, valign, align in lay[2]:
        seen[role] = seen.get(role, 0) + 1
        bid = (f"{prefix}-" if prefix else "") + {"sub": "subtitle"}.get(role, role) + (f"-{seen[role]}" if seen[role] > 1 else "")
        if taken: bid = _unique_id(taken, bid); taken += f' id="{bid}"'
        var, base = ("--th-title-size", 28) if role == "title" else ("--th-body-size", 18)
        size = f"calc(var({var}, {round(base * PT, 2):g}px) * {round(pt / base, 3):g})"
        va = f' data-valign="{valign}"' if valign != "middle" else ""
        word = role.upper() if role != "body" else "…"
        if styles:   # the deck's own look: that box's .content style (alignment as the layout says) and its text's run style
            st = styles[role]; cstyle = re.sub(r"text-align:\s*[^;]+;?\s*", "", st["content"]).strip().rstrip(";")
            attr = lambda v: v.replace("&", "&amp;").replace('"', "&quot;")   # (a font's 'quotes' stay readable)
            inner = f'<span style="{attr(st["run"])}">{word}</span>' if st["run"] else word
            out.append(f'  <div class="box" id="{bid}" data-placeholder="{PROMPT[role]}" data-role="{role}"{va} style="left: {x}px; top: {y}px; width: {w}px; height: {h}px;">'
                       f'<div class="content" style="{attr(cstyle + "; " if cstyle else "")}text-align: {align};">{inner}</div></div>')
            continue
        out.append(f'  <div class="box" id="{bid}" data-placeholder="{PROMPT[role]}" data-role="{role}"{va} style="left: {x}px; top: {y}px; width: {w}px; height: {h}px;">'
                   f'<div class="content" style="font-size: {size}; text-align: {align}; padding: {INSET};">{word}</div></div>')
    out.append("</section>")
    return "\n".join(out)


def layout_table() -> str:
    """The layouts as a Markdown table (for the docs: written from the editor's own table, so they never disagree)."""
    rows = ["| layout | placeholder boxes: role (id) at x, y, size; text size; vertical / text alignment |", "|---|---|"]
    for n, label, boxes in layouts():
        seen, cells = {}, []
        for r, x, y, w, h, pt, va, al in boxes:
            seen[r] = seen.get(r, 0) + 1
            bid = {"sub": "subtitle"}.get(r, r) + (f"-{seen[r]}" if seen[r] > 1 else "")
            cells.append(f"{r} (`{bid}`) at {x}, {y}, {w} × {h}; {pt} pt; {va} / {al}")
        rows.append(f"| `{n}` ({label}) | " + ("<br>".join(cells) or "none") + " |")
    return "\n".join(rows)


def layout_cmd(args: list[str]):
    deck = Path(args[args.index("--deck") + 1]).expanduser() if "--deck" in args else None
    names = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or args[i - 1] not in ("--deck", "--prefix", "--like"))]
    like_arg = _opt(args, "--like"); like = int(like_arg) if like_arg else None
    if names: return print(layout_section(names[0], deck, _opt(args, "--prefix") or "", like))
    rows = ["layout                  placeholders: role x,y w×h (pt, vertical align, text align)"]
    for n, label, boxes in layouts(deck):
        rows.append(f"{n:<24}" + ("  ".join(f"{r} {x},{y} {w}×{h} ({pt}pt {va} {al})" for r, x, y, w, h, pt, va, al in boxes) or "(none)") + f"   [{label}]")
    print("\n".join(rows) + "\n\n`glideshow layout NAME --prefix results [--deck DECK]` prints a slide in that layout, ready to paste into"
          " deck.html, its boxes' ids starting results- (with --deck, ids the deck doesn't use yet): replace each placeholder's text"
          " (keep the boxes and sizes), and give boxes you add their own unique ids.")


# ---------- a deck's slides only ----------

def sections(text: str) -> list:
    """[(number, start offset, end offset), …] for each slide: top-level <section>s, and the inner ones of a stack."""
    start = text.find('<div class="slides"')
    if start < 0: return []
    out, depth, open_at, n = [], 0, [], 0
    for m in re.finditer(r"<section\b[^>]*>|</section>", text[start:]):
        at = start + m.start()
        if m.group().startswith("</"):
            depth -= 1; s = open_at.pop()
            if s[1]: n += 1; out.append((n, s[0], at + len("</section>")))   # a slide (a leaf section)
        else:
            if open_at: open_at[-1][1] = False   # its parent is a stack, not a slide
            open_at.append([at, True]); depth += 1
    return out


def slides_cmd(args: list[str]):
    if not args: raise SystemExit("usage: glideshow slides DECK [N ...]")
    from .cli import match
    deck = Path(args[0]).expanduser() if (Path(args[0]).expanduser() / "deck.html").exists() else match(args[0])
    ensure_server(deck)   # so what the agent then writes is kept as versions
    text, want = (deck / "deck.html").read_text(), {int(a) for a in args[1:] if a.isdigit()}
    found = sections(text)
    for n, a, z in found:
        if want and n not in want: continue
        print(f"<!-- slide {n}: deck.html line {text.count(chr(10), 0, a) + 1} -->\n{text[a:z]}\n")
    if not found: print(f"{deck / 'deck.html'} has no slides")


# ---------- figures ----------

def _deck(arg: str) -> Path:
    from .cli import match
    p = Path(arg).expanduser()
    return p if (p / "deck.html").exists() else match(arg)


def _opt(args: list[str], name: str, default=None):
    return args[args.index(name) + 1] if name in args and args.index(name) + 1 < len(args) else default


def _slide_span(text: str, n: int) -> tuple:
    found = sections(text)
    if not found: raise SystemExit("the deck has no slides")
    if not 1 <= n <= len(found): raise SystemExit(f"there is no slide {n} (the deck has {len(found)})")
    return found[n - 1][1:]


def _box_geo(tag: str) -> tuple:
    g = {k: float(re.search(rf"\b{k}:\s*(-?[\d.]+)px", tag).group(1)) for k in ("left", "top", "width", "height")}
    return g["left"], g["top"], g["width"], g["height"]


def _attrs(tag: str) -> dict:
    return {k: htmllib.unescape(v) for k, v in re.findall(r'([\w-]+)="([^"]*)"', tag)}


def _boxes(text: str):
    """Each box's opening tag (any attribute order)."""
    for m in re.finditer(r"<div\b[^>]*>", text):
        if "box" in _attrs(m.group()).get("class", "").split(): yield m


def _box(text: str, box_id: str) -> re.Match:
    m = next((m for m in _boxes(text) if _attrs(m.group()).get("id") == box_id), None)
    if not m: raise SystemExit(f"no box with id {box_id!r} in the deck")
    return m


def _region(text: str, a: int, z: int, at: str | None) -> tuple:
    """Where a figure goes: --at x,y,w,h, or the slide's body placeholder (its layout's body area), else Title and body's."""
    if at and at != "body":
        try: x, y, w, h = (float(v) for v in at.split(","))
        except ValueError: raise SystemExit("--at takes body or x,y,w,h (px on the 1920 × 1080 canvas)")
        return x, y, w, h
    body = next((m for m in _boxes(text[a:z]) if _attrs(m.group()).get("data-role") == "body"), None)
    if body: return _box_geo(body.group())
    lay = re.search(r'data-layout="([\w-]+)"', text[a:a + 300])
    for n, _, boxes in layouts():
        if lay and n == lay.group(1):
            for role, x, y, w, h, *_ in boxes:
                if role == "body": return x, y, w, h
    return REGION


def _fit(w0: float, h0: float, region: tuple) -> tuple:
    x, y, w, h = region
    k = min(w / w0, h / h0); fw, fh = round(w0 * k), round(h0 * k)
    return round(x + (w - fw) / 2), round(y + (h - fh) / 2), fw, fh


def _unique_id(text: str, want: str) -> str:
    base = re.sub(r"[^A-Za-z0-9_-]+", "-", want).strip("-").lower() or "figure"
    if base[0].isdigit(): base = "fig-" + base
    bid, n = base, 2
    while re.search(rf'\bid="{re.escape(bid)}"', text): bid, n = f"{base}-{n}", n + 1
    return bid


def _write(deck: Path, text: str):
    tmp = deck / "deck.html.tmp"; tmp.write_text(text); tmp.replace(deck / "deck.html")   # one write, as the editor expects


def figure_add(args: list[str]):
    if len(args) < 2: raise SystemExit("usage: glideshow figure add DECK FILE --slide N [--replace ID | --at body|x,y,w,h] [--id ID] [--alt TEXT] [--source CMD]")
    deck, src = _deck(args[0]), Path(args[1]).expanduser()
    if not src.is_absolute() and not src.is_file() and (deck / src).is_file(): src = deck / src   # a path inside the deck (assets/x.png)
    if not src.is_file(): raise SystemExit(f"no file {args[1]} (here or in {deck})")
    text, data = (deck / "deck.html").read_text(), src.read_bytes()
    replace, slide = _opt(args, "--replace"), _opt(args, "--slide")
    (deck / "assets").mkdir(exist_ok=True)
    old = _box(text, replace) if replace else None
    old_src = None
    if old:
        tail = text[old.end():old.end() + 2000]
        m = re.search(r'<img\b[^>]*\bsrc="([^"]+)"', tail); old_src = m.group(1) if m else None
    # the file keeps its own name (a figure's name says what it is); a different picture of that name gets -2, -3…
    stem, ext = re.sub(r"[^A-Za-z0-9_.-]+", "-", src.stem) or "figure", src.suffix.lower() or ".png"
    name, n = f"{stem}{ext}", 2
    while (deck / "assets" / name).exists() and (deck / "assets" / name).read_bytes() != data and f"assets/{name}" != old_src:
        name, n = f"{stem}-{n}{ext}", n + 1
    if (deck / "assets" / name).resolve() != src.resolve(): (deck / "assets" / name).write_bytes(data)
    w0, h0 = image_size(data) or (1600, 900)
    alt = _opt(args, "--alt") or re.sub(r"[-_]+", " ", src.stem).strip().capitalize()
    source, made = _opt(args, "--source"), datetime.datetime.now().isoformat(timespec="seconds")
    if old:   # in place: the old box's spot, the new picture fitted inside it; its id, alt and source carried over unless given
        a = text.rfind("<section", 0, old.start())
        close = _close_box(text, old.start())
        tag = old.group()
        x, y, w, h = _fit(w0, h0, _box_geo(tag))
        keep_alt = re.search(r'\balt="([^"]*)"', text[old.start():close])
        alt = _opt(args, "--alt") or (htmllib.unescape(keep_alt.group(1)) if keep_alt and keep_alt.group(1) else alt)
        source = source or _attrs(tag).get("data-source")
        new = _figure_html(replace, x, y, w, h, name, alt, source, made, indent="")
        text = text[:old.start()] + new + text[close:]
        _write(deck, text)
        if old_src and old_src != f"assets/{name}" and old_src.startswith("assets/") and old_src not in text: (deck / old_src).unlink(missing_ok=True)
        return print(f"replaced #{replace} on slide {_slide_of(text, a)} with assets/{name} ({w}×{h} at {x},{y})")
    n_slide = int(slide) if slide else len(sections(text))
    a, z = _slide_span(text, n_slide)
    x, y, w, h = _fit(w0, h0, _region(text, a, z, _opt(args, "--at")))
    bid = _unique_id(text, _opt(args, "--id") or stem)
    box = _figure_html(bid, x, y, w, h, name, alt, source, made)
    notes = text.rfind("<aside", a, z)
    at = notes if notes > 0 else z - len("</section>")
    text = text[:at] + box + text[at:]
    _write(deck, text)
    print(f"added #{bid} (assets/{name}, {w}×{h} at {x},{y}) to slide {n_slide}")


def _figure_html(bid, x, y, w, h, name, alt, source, made, indent="  ") -> str:
    attrs = f' data-source="{htmllib.escape(source)}"' if source else ""
    return (f'{indent}<div class="box image" id="{bid}"{attrs} data-made="{made}" style="left: {x}px; top: {y}px; width: {w}px; height: {h}px;">'
            f'<div class="content"><img src="assets/{name}" alt="{htmllib.escape(alt)}"></div></div>' + ("\n" if indent else ""))


def _close_box(text: str, start: int) -> int:
    """The end of the box element that opens at `start` (counting nested divs)."""
    depth = 0
    for m in re.finditer(r"<div\b[^>]*>|</div>", text[start:]):
        depth += -1 if m.group() == "</div>" else 1
        if depth == 0: return start + m.end()
    raise SystemExit("the box isn't closed in deck.html")


def _slide_of(text: str, at: int) -> int:
    return next((n for n, a, z in sections(text) if a <= at < z), 0)


def figure_refresh(args: list[str]):
    """Each figure's data-source run again in the deck's folder ({out} is its picture's path), then put back in place."""
    if not args: raise SystemExit("usage: glideshow figure refresh DECK [ID ...]")
    deck, ids = _deck(args[0]), {a for i, a in enumerate(args[1:], 1) if not a.startswith("--") and args[i - 1] != "--alt"}
    text = (deck / "deck.html").read_text()
    figs = [(m, _attrs(m.group())) for m in _boxes(text)]
    figs = [(m, a) for m, a in figs if "image" in a["class"].split() and a.get("data-source") and a.get("id") and (not ids or a["id"] in ids)]
    if not figs: raise SystemExit("no figure with a data-source" + (f" among {', '.join(sorted(ids))}" if ids else "") + " (glideshow figure add … --source CMD records one)")
    failed = 0
    for m, at in figs:
        bid, cmd = at["id"], at["data-source"]
        img = re.search(r'<img\b[^>]*\bsrc="([^"]+)"', text[m.end():m.end() + 2000])
        out = img.group(1) if img else f"assets/{bid}.png"
        run = cmd.replace("{out}", shlex.quote(out))
        print(f"#{bid}: {run}", flush=True)
        r = subprocess.run(run, shell=True, cwd=deck, capture_output=True, text=True)
        if r.returncode:
            failed += 1; print(f"#{bid}: `{run}` failed (exit {r.returncode}):\n{(r.stderr or r.stdout).strip()[-800:]}", file=sys.stderr); continue
        if not (deck / out).is_file(): failed += 1; print(f"#{bid}: `{run}` ran but wrote no {out}", file=sys.stderr); continue
        new_alt = _opt(args, "--alt")
        figure_add([str(deck), str(deck / out), "--replace", bid] + (["--alt", new_alt] if new_alt else []))
        text = (deck / "deck.html").read_text()
        at = _box(text, bid).start(); alt = re.search(r'\balt="([^"]*)"', text[at:_close_box(text, at)])
        if not new_alt and alt: print(f'#{bid}: its alt text is still "{htmllib.unescape(alt.group(1))}"; if the new data changed what it shows, pass --alt "…" (and fix any caption on the slide)')
    if failed: raise SystemExit(1)


def figure_size(args: list[str]):
    """matplotlib settings for a figure that fills a space exactly: 1 in of figure = 192 px of slide, so a point in the
    figure is a point on the slide (and the 24 px reading floor is 9 pt)."""
    if not args: raise SystemExit("usage: glideshow figure size DECK --slide N [--box ID | --at body|x,y,w,h]")
    deck = _deck(args[0]); text = (deck / "deck.html").read_text()
    box_id, slide_n = _opt(args, "--box"), int(_opt(args, "--slide") or len(sections(text)))
    if box_id:
        m = _box(text, box_id); x, y, w, h = _box_geo(m.group()); slide_n = _slide_of(text, m.start())
    else:
        a, z = _slide_span(text, slide_n)
        x, y, w, h = _region(text, a, z, _opt(args, "--at"))
    m = re.search(r"/\* slides-theme (\{.*?\}) \*/", text)
    try: th = json.loads(m.group(1)) if m else {}
    except ValueError: th = {}
    font = (th.get("font") or "Arial, Helvetica, sans-serif").split(",")[0].strip("'\" ")
    print(f"""# the space: {w:g}×{h:g} px at {x:g},{y:g} on the slide
import matplotlib.pyplot as plt
plt.rcParams.update({{"font.family": "{font}", "font.size": 14, "axes.titlesize": 16, "axes.labelsize": 14,
                     "xtick.labelsize": 12, "ytick.labelsize": 12, "legend.fontsize": 12,
                     "text.color": "{th.get('text', '#595959')}", "axes.labelcolor": "{th.get('text', '#595959')}",
                     "axes.spines.top": False, "axes.spines.right": False}})
fig, ax = plt.subplots(figsize=({w / 192:.2f}, {h / 192:.2f}), layout="constrained")   # 192 px of slide per inch: 1 pt here = 1 pt on the slide
# … plot …   (constrained layout keeps the axis labels inside the figure)
fig.savefig("assets/NAME.png", dpi=384)   # 2× the slide's pixels: sharp when presenting; no bbox_inches="tight" (it changes the shape)
# then (scripts live in the deck's folder, e.g. src/plot.py, and run there; or give an absolute path):
# glideshow figure add {deck} assets/NAME.png --slide {slide_n} --at {x:g},{y:g},{w:g},{h:g} --id NAME --alt "WHAT IT SHOWS" --source "uv run src/plot.py --out {{out}}"
# text under 9 pt (24 px) is hard to read when presenting; 12–16 pt reads well""")


FIGURE_HELP = """glideshow figure add DECK FILE --slide N [--at body|x,y,w,h] [--id ID] [--alt TEXT] [--source CMD]
    place a picture (FILE: a path, or one inside the deck such as assets/x.png), fitted into the slide's body area or
    --at; it keeps its file name, gets an id and alt text, and records --source (the command that makes it: {out} is the
    picture's path, and it runs in the deck's folder)
glideshow figure add DECK FILE --replace ID [--alt TEXT]
    swap a picture into box ID, fitted inside its place; its id, alt text and source are kept unless given
glideshow figure refresh DECK [ID ...] [--alt TEXT]
    re-run each figure's recorded source (or only those named) and put the new picture in place
glideshow figure size DECK --slide N [--box ID | --at body|x,y,w,h]
    matplotlib settings for a figure that fills that space exactly (1 pt in the figure = 1 pt on the slide)"""


def ensure_server(deck: Path):
    """For a deck in the library: the background server, started if it isn't running (nothing is opened or switched). It
    commits each change to a deck as its own version, so an agent's edits are versions even with no editor open."""
    from .cli import HOME, running, start
    if HOME.resolve() not in deck.resolve().parents: return   # a folder elsewhere (a test's, a download): nothing to version
    if not running(): start(deck)


def figure_cmd(args: list[str]):
    sub, rest = (args[0], args[1:]) if args else ("", [])
    if sub in ("add", "refresh") and rest: ensure_server(_deck(rest[0]))
    if sub == "add": return figure_add(rest)
    if sub == "refresh": return figure_refresh(rest)
    if sub == "size": return figure_size(rest)
    print(FIGURE_HELP)
    if sub not in ("help", "-h", "--help"): raise SystemExit(1)


def slide_ids(text: str) -> list:
    """Each slide's data-sid (or ""), in order."""
    return [(re.search(r'\bdata-sid="([^"]+)"', text[a:a + 400].split(">", 1)[0]) or [None, ""])[1] for _, a, _ in sections(text)]


def comments_cmd(args: list[str]):
    """The comments in comments.json, each on the slide it is on now (found by the slide's id, so slides added or moved
    since don't misplace it), open ones first: what an agent reads before answering them."""
    if not args: raise SystemExit("usage: glideshow comments DECK [--all] [--json]")
    deck = _deck(args[0]); f = deck / "comments.json"
    items = json.loads(f.read_text()).get("comments", []) if f.exists() else []
    sids = slide_ids((deck / "deck.html").read_text())
    for c in items:
        c["now"] = sids.index(c["sid"]) + 1 if c.get("sid") in sids else c.get("slide")
    shown = [c for c in items if "--all" in args or not c.get("resolved")]
    if "--json" in args: return print(json.dumps(shown, indent=2, ensure_ascii=False))
    if not shown: return print("no open comments" + ("" if "--all" in args else " (--all shows resolved ones)"))
    for c in sorted(shown, key=lambda c: (bool(c.get("resolved")), c.get("now") or 0)):
        moved = f" (left on slide {c['slide']})" if c.get("now") != c.get("slide") else ""
        where = f"slide {c.get('now')}{moved}" + (f", box #{c['box']}" if c.get("box") else "") + (f', on "{c["quote"]}"' if c.get("quote") else "")
        print(f"[{c['id']}] {where} · {(c.get('by') or {}).get('n') or 'someone'} · {'resolved' if c.get('resolved') else 'open'}\n    {c.get('text', '')}")
        for r in c.get("replies", []): print(f"    ↳ {(r.get('by') or {}).get('n') or 'someone'}: {r.get('text', '')}")
    print(f"\nTo answer: make the change, add a reply to that comment's \"replies\" in {f} and, when done, set \"resolved\": true (see `glideshow docs`).")


def find_cmd(args: list[str]):
    from .cli import match
    if not args: raise SystemExit("usage: glideshow find WORDS")
    print(match(" ".join(args)))


def stop_cmd():
    from .service import live, post
    s = live()
    if not s: return print("no Glideshow server is running")
    try: post(s["url"], "api/quit", {})
    except Exception: pass
    print(f"stopped the server on {s['url']}")
