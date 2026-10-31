"""What the `glideshow` command gives an agent writing deck.html by hand, none of which needs the editor open (or touches
it): the exact placeholder boxes of each layout, a deck's slides without the 180 KB of inlined CSS and JS around them,
finding a deck, figures that remember the script that made them, and stopping the server.

    glideshow layout [NAME] [--deck DECK]      a layout's slide, ready to paste (no NAME: the table of layouts)
    glideshow slides DECK [N ...] [--outline]  the <section>s only, each headed by its number and line in deck.html
    glideshow put DECK N | --after N | --delete N   replace, insert or remove slides (the new <section>s on stdin)
    glideshow find WORDS                       the folder of the deck that best matches (nothing is opened)
    glideshow figure add DECK FILE --slide N [--replace ID | --at body|x,y,w,h] [--id ID] [--alt TEXT] [--source CMD]
    glideshow figure refresh DECK [ID ...]     re-run each figure's data-source and put the new picture in place
    glideshow figure size DECK --slide N [--box ID | --at …]   the matplotlib figsize / dpi / font sizes for that space
    glideshow stop                             stop the background server
"""
import datetime, html as htmllib, json, re, shlex, subprocess, sys, time
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
    like_arg = _opt(args, "--like"); like = slide_number((deck / "deck.html").read_text(), like_arg) if like_arg and deck else (int(like_arg) if like_arg else None)
    if names: return print(layout_section(names[0], deck, _opt(args, "--prefix") or "", like))
    rows = ["layout                  placeholders: role x,y w×h (pt, vertical align, text align)"]
    for n, label, boxes in layouts(deck):
        rows.append(f"{n:<24}" + ("  ".join(f"{r} {x},{y} {w}×{h} ({pt}pt {va} {al})" for r, x, y, w, h, pt, va, al in boxes) or "(none)") + f"   [{label}]")
    print("\n".join(rows) + "\n\n`glideshow layout NAME --prefix results [--deck DECK]` prints a slide in that layout, ready to paste into"
          " deck.html, its boxes' ids starting results- (with --deck, ids the deck doesn't use yet): replace each placeholder's text"
          " (keep the boxes and sizes), and give boxes you add their own unique ids.")


# ---------- a deck's slides only ----------

def scan(text: str) -> tuple:
    """The deck's slides and what is wrong with its structure: ([{n, a, z, label, stack}, …], [problem, …]). Slides are the
    leaf <section>s inside <div class="slides"> (a stack's sub-slides too), numbered n in order; label is the deck's own
    number (reveal's: main slide 8, its sub-slides 8.1, 8.2); stack is the span of the stack a sub-slide sits in."""
    start = text.find('<div class="slides"')
    if start < 0: return [], []
    line = lambda at: text.count("\n", 0, at) + 1
    depth, end = 0, len(text)   # where .slides closes: its own </div>
    for m in re.finditer(r"<div\b[^>]*>|</div>", text[start:]):
        depth += -1 if m.group() == "</div>" else 1
        if depth == 0: end = start + m.end(); break
    slides, problems, open_at, h = [], [], [], 0
    for m in re.finditer(r"<section\b[^>]*>|</section>", text[start:end]):
        at = start + m.start()
        if m.group().startswith("</"):
            if not open_at: problems.append(f"deck.html line {line(at)}: a </section> that closes nothing"); continue
            s = open_at.pop()
            if s["leaf"]:
                stack = (open_at[-1]["a"], None) if open_at else None
                slides.append({"n": len(slides) + 1, "a": s["a"], "z": at + len("</section>"), "label": s["label"], "stack": stack})
            elif not open_at:   # a stack closing: its sub-slides learn where it ends
                for sl in slides:
                    if sl["stack"] and sl["stack"][0] == s["a"]: sl["stack"] = (s["a"], at + len("</section>"))
        else:
            if open_at:
                parent = open_at[-1]; parent["leaf"] = False
                v = parent["kids"]; parent["kids"] += 1
                label = parent["label"] + (f".{v}" if v else "")
            else:
                h += 1; label = str(h)
            open_at.append({"a": at, "leaf": True, "kids": 0, "label": label})
    for s in open_at: problems.append(f"deck.html line {line(s['a'])}: a <section> that is never closed")
    for sl in slides:
        body = text[sl["a"]:sl["z"]]
        extra = len(re.findall(r"<div\b", body)) - body.count("</div>")
        if extra: problems.append(f"slide {sl['n']} (deck.html line {line(sl['a'])}): {abs(extra)} <div> {'never closed' if extra > 0 else 'closed too often'}; boxes after it land on the wrong slide or outside the deck")
    tail = text[end:]; tail = tail[:min([i for i in (tail.find("<script"), tail.find("</body>")) if i >= 0] or [len(tail)])]
    if "<section" in tail: problems.append(f"deck.html line {line(end)}: {tail.count('<section')} <section>s after the end of the slides (<div class=\"slides\"> closed early): they never show; remove them, or move them inside")
    return slides, problems


def sections(text: str) -> list:
    """[(number, start offset, end offset), …] for each slide: top-level <section>s, and the inner ones of a stack."""
    return [(s["n"], s["a"], s["z"]) for s in scan(text)[0]]


def slide_number(text: str, arg: str) -> int:
    """A slide named by its number in the file (9) or the deck's own (8.1, a stack's sub-slide), as a number in the file."""
    if re.fullmatch(r"\d+", arg): return int(arg)
    hit = next((s["n"] for s in scan(text)[0] if s["label"] == arg), None)
    if hit is None: raise SystemExit(f"there is no slide {arg} (`glideshow slides DECK --outline` lists them)")
    return hit


def _name(s: dict) -> str:
    return f"{s['n']}" if s["label"] == str(s["n"]) else f"{s['n']} = {s['label']}"


def _words(html: str, n: int = 40) -> str:
    t = " ".join(htmllib.unescape(re.sub(r"<[^>]+>", " ", html)).split())
    return t[:n] + ("…" if len(t) > n else "")


def outline_line(text: str, s: dict) -> str:
    """One slide in a line or two: its numbers, layout, title, then each box's id and first words (pictures by their alt;
    lines counted; notes for the AI in full, as they are instructions)."""
    a, z = s["a"], s["z"]; body = text[a:z]
    lay = re.search(r'\bdata-layout="([^"]+)"', body.split(">", 1)[0])
    boxes, lines, notes, title, bare = [], 0, [], "", 0
    effects = _editor_list("motion.js", "EFFECTS")
    for m in _boxes(body):
        at = _attrs(m.group()); bid = at.get("id", "(no id)"); cls = at.get("class", "").split()
        inner = body[m.start():_close_box(body, m.start())]; bl = _builds_of(at, cls, effects)
        if "note" in cls: notes.append(f"  NOTE #{bid}: {_words(inner, 400)}"); continue
        if "chart" in cls:
            rows = _chart_rows(inner) or [[]]; cats, ser = max(0, len(rows[0]) - 1), max(0, len(rows) - 1)
            if at.get("data-plot") == "columns": cats, ser = ser, cats
            boxes.append(f"#{bid} [{at.get('data-chart', '?')} chart: {ser} series × {cats} categories]{bl}"); continue
        if re.match(r"(line|arrowline|elbow|curve|path)$", at.get("data-shape", "")):
            if bl: boxes.append(f"#{bid} (line){bl}")
            else: lines += 1
            continue
        if "image" in cls:
            alt = re.search(r'\balt="([^"]*)"', inner); boxes.append(f"#{bid} [picture: {_words(alt.group(1) if alt else '', 30)}]{bl}"); continue
        words = _words(inner)
        if at.get("data-role") == "title" and not title and not bl: title = _words(inner, 60); continue
        if not words and at.get("data-role"): boxes.append(f"#{bid} (empty placeholder){bl}"); continue
        if not words and not bl: bare += 1; continue   # a shape with no words (a dot, a bar): counted, not listed
        boxes.append(f'#{bid} "{words}"{bl}' if words else f"#{bid} ({at.get('data-shape') or 'box'}){bl}")
    extra = ([f"{bare} shape{'s' if bare > 1 else ''} without text"] if bare else []) + ([f"{lines} line{'s' if lines > 1 else ''}"] if lines else []) + (["notes"] if "<aside" in body else [])
    head = f"{_name(s)}  {lay.group(1) if lay else '-'}" + (f'  "{title}"' if title else "")
    objs = _layout_objects(text, lay.group(1)) if lay and 'data-layout-objects="off"' not in body.split(">", 1)[0] else ""
    if objs: extra.append(f"from the layout: {objs}")
    return "\n".join([head + "\n   " + " · ".join(boxes + extra) if boxes or extra else head] + notes)


def _editor_list(file: str, name: str) -> list:
    """The values of an editor table (`const NAME = [['value', 'Label'], …];` in editor/js/FILE), so checks follow the editor."""
    m = re.search(rf"const {name} = \[(.*?)\];", (EDITOR / "js" / file).read_text(), re.S)
    return re.findall(r"\[\s*'([\w-]*)'", m.group(1)) if m else []


CHART_KINDS = ("column", "bar", "line", "area", "pie", "scatter")
BUILDS_KEYS = ("start", "duration", "delay", "ease", "angle", "to")


def _kind(cls: list, at: dict, inner: str) -> str:
    if "chart" in cls: return "pie chart" if at.get("data-chart") == "pie" else "chart"
    return "table" if "<table" in inner else "text box"


def _chart_rows(inner: str) -> list | None:
    t = re.search(r'<table\b[^>]*class="chart-data"[^>]*>(.*?)</table>', inner, re.S)
    return [[_words(c, 999) for c in re.findall(r"<t[hd]\b[^>]*>(.*?)</t[hd]>", r, re.S)] for r in re.findall(r"<tr\b[^>]*>(.*?)</tr>", t.group(1), re.S)] if t else None


def _num(s: str):
    try: return float(re.sub(r"[,\s$%€£]", "", s))
    except ValueError: return None


def lint(text: str, deck: Path | None = None, only: set | None = None) -> list:
    """What is wrong with the attributes the editor writes and present.js plays (builds, deliveries, charts, layouts, slide
    links, paragraph styles), one line each: what is wrong, then what is allowed."""
    found = scan(text)[0]
    effects, xb = _editor_list("motion.js", "EFFECTS"), _editor_list("motion.js", "XB_EFFECTS")
    deliver = {"text box": _editor_list("motion.js", "DELIVERY_TEXT"), "table": _editor_list("motion.js", "DELIVERY_TABLE"),
               "chart": _editor_list("motion.js", "DELIVERY_CHART"), "pie chart": _editor_list("motion.js", "DELIVERY_PIE")}
    tpl = re.search(r'<template id="deck-layouts">(.*?)</template>', text, re.S)
    names = {n for n, _, _ in layouts(deck)} | set(re.findall(r'<div\b[^>]*\bclass="layout"[^>]*\bdata-layout="([^"]+)"', tpl.group(1) if tpl else ""))
    names |= set(re.findall(r'<div\b[^>]*\bdata-layout="([^"]+)"[^>]*\bclass="layout"', tpl.group(1) if tpl else ""))
    sids = set(re.findall(r'<section\b[^>]*\bdata-sid="([^"]+)"', text))
    styles = set(_editor_list("format-panel.js", "PSTYLES")) | set(re.findall(r"\.slides \.(ps-[\w-]+) \{", text))
    out = []
    for s in found:
        if only and s["n"] not in only: continue
        body, at0 = text[s["a"]:s["z"]], f"slide {_name(s)}"
        lay = re.search(r'\bdata-layout="([^"]+)"', body.split(">", 1)[0])
        if lay and lay.group(1) not in names: out.append(f'{at0}: data-layout="{lay.group(1)}" names no layout; allowed: {", ".join(sorted(names))}')
        for m in re.finditer(r'\b(?:href|data-link)="#slide=([^"]*)"', body):
            if m.group(1) not in sids: out.append(f'{at0}: a link to #slide={m.group(1)}, but no slide has data-sid="{m.group(1)}"; link to a slide\'s data-sid (`glideshow slides DECK N` shows it)')
        for c in sorted({c for m in re.finditer(r'\bclass="([^"]*)"', body) for c in m.group(1).split() if c.startswith("ps-")} - styles):
            out.append(f'{at0}: paragraph style "{c}" doesn\'t exist; allowed: {", ".join(sorted(styles))}')
        for m in _boxes(body):
            at = _attrs(m.group()); bid = f"#{at.get('id', '?')}"; cls = at.get("class", "").split()
            inner = body[m.start():_close_box(body, m.start())]
            for part in [x.strip() for x in at.get("data-builds", "").split(";") if x.strip()]:
                eff, *kv = part.split()
                if eff not in effects: out.append(f'{at0} {bid}: data-builds effect "{eff}" is unknown; allowed: {", ".join(xb)} (Add action\'s) or any build effect in docs/deck-format.md')
                for k in kv:
                    key, _, val = k.partition("=")
                    if key not in BUILDS_KEYS or not val: out.append(f'{at0} {bid}: data-builds "{k}" in "{part}" isn\'t a setting; allowed: {", ".join(f"{x}=…" for x in BUILDS_KEYS)} (start=after or with)')
                    elif key == "start" and val not in ("after", "with"): out.append(f'{at0} {bid}: data-builds start={val}; allowed: start=after, start=with (leave it out for on click)')
            kind = _kind(cls, at, inner)
            if at.get("data-build") and at["data-build"] not in deliver[kind]:
                ok = [v for v in deliver[kind] if v] or ["none (this box has no text)"]
                out.append(f'{at0} {bid}: data-build="{at["data-build"]}" isn\'t a delivery for a {kind}; allowed: {", ".join(ok)}')
            if "chart" not in cls: continue
            if at.get("data-chart") not in CHART_KINDS: out.append(f'{at0} {bid}: data-chart="{at.get("data-chart", "")}" is not a chart kind; allowed: {", ".join(CHART_KINDS)}')
            rows = _chart_rows(inner)
            if rows is None: out.append(f'{at0} {bid}: a chart without <table class="chart-data"> (its data: first row the categories, each later row a series name and its values)'); continue
            widths = sorted({len(r) for r in rows})
            if len(widths) > 1: out.append(f'{at0} {bid}: the chart-data rows have {" / ".join(map(str, widths))} cells; every row needs the same number (the header row\'s, {len(rows[0]) if rows else 0}), blank cells allowed')
            bad = [v for r in rows[1:] for v in r[1:] if v and _num(v) is None]
            if bad: out.append(f'{at0} {bid}: chart values that aren\'t numbers: {", ".join(repr(v) for v in bad[:5])}; allowed: numbers (1,200 · 12.5 · 40% · $3), or blank for a gap')
            if at.get("data-chart") == "scatter" and rows and any(_num(c) is None for c in rows[0][1:] if c): out.append(f'{at0} {bid}: a scatter chart\'s categories (the header row) are its x values; allowed: numbers')
    return out


def _builds_of(at: dict, cls: list, effects: list) -> str:
    """A box's builds in a few words: its effect and delivery, then each extra build (data-builds)."""
    eff = next((c for c in cls if c in effects), "") if "fragment" in cls else ""
    parts = ([eff + (f" by {at['data-build']}" if at.get("data-build") else "") + (" (with previous)" if "data-with-previous" in at else "")] if eff else [])
    parts += ["then " + x.strip() for x in at.get("data-builds", "").split(";") if x.strip()]
    return " {" + "; ".join(parts) + "}" if parts else ""


def _layout_objects(text: str, key: str) -> str:
    """The objects a slide gets from its layout (#deck-layouts, D5), by id and first words."""
    tpl = re.search(r'<template id="deck-layouts">(.*?)</template>', text, re.S)
    if not tpl: return ""
    m = next((m for m in re.finditer(r"<div\b[^>]*>", tpl.group(1)) if "layout" in _attrs(m.group()).get("class", "").split() and _attrs(m.group()).get("data-layout") == key), None)
    if not m: return ""
    lay = tpl.group(1)[m.start():_close_box(tpl.group(1), m.start())]
    items = []
    for b in _boxes(lay):
        at = _attrs(b.group()); words = _words(lay[b.start():_close_box(lay, b.start())], 30)
        items.append(f"#{at.get('id', '?')}" + (f' "{words}"' if words else f" ({at.get('data-shape') or 'box'})"))
    return ", ".join(items)


def slides_cmd(args: list[str]):
    if not args: raise SystemExit("usage: glideshow slides DECK [N ...] [--outline]")
    deck = _deck(args[0])
    ensure_server(deck)   # so what the agent then writes is kept as versions
    text = (deck / "deck.html").read_text()
    found, problems = scan(text)
    want = {slide_number(text, a) for a in args[1:] if not a.startswith("--")}
    if "--outline" in args:
        print(f"{len(found)} slides (N = the number to use; \"9 = 8.1\": a stack's sub-slide, 8.1 in the editor). Full HTML: glideshow slides {args[0]} N")
    for s in found:
        if want and s["n"] not in want: continue
        if "--outline" in args: print(outline_line(text, s)); continue
        summary = outline_line(text, s).replace("--", "‐‐")   # what is there (charts, builds, layout objects), above the HTML
        print(f"<!-- slide {_name(s)}: deck.html line {text.count(chr(10), 0, s['a']) + 1}\n{summary}\n-->\n{text[s['a']:s['z']]}\n")
    if not found: print(f"{deck / 'deck.html'} has no slides")
    for p in problems: print(f"problem: {p}", file=sys.stderr)


PUT_HELP = """glideshow put DECK N            replace slide N with the <section>(s) on stdin (or --file F)
glideshow put DECK --after N    insert them after slide N (0: before the first; inside N's stack if it is in one)
glideshow put DECK --delete N … remove those slides
glideshow put DECK --all        replace every slide with them (a script that builds the whole deck: pipe its output in)
N is the number `glideshow slides DECK --outline` gives (9, or the deck's own 8.1). The input is only <section>s; it is
checked before anything is written (every <div> closed, ids unique in the deck, no other slide's data-sid). A replaced
slide keeps its data-sid if the new one has none. deck.html is written in one go, so an open editor reloads it.
Boxes may leave their place to put: data-flow="row" (or "column", "grid 3"; then an area, body or x,y,w,h, and "gap N")
lays out the boxes sharing that value in the layout's body area, equal sizes 40 px apart, and writes their pixels."""


def _top_sections(html: str) -> tuple:
    """The top-level <section>…</section> spans of a fragment, and whatever else is in it (comments aside)."""
    spans, depth, at = [], 0, 0
    for m in re.finditer(r"<section\b[^>]*>|</section>", html):
        if m.group().startswith("</"):
            depth -= 1
            if depth == 0: spans.append((at, m.end()))
            if depth < 0: raise SystemExit("put: a </section> that closes nothing")
        else:
            if depth == 0: at = m.start()
            depth += 1
    if depth: raise SystemExit("put: a <section> that is never closed")
    rest, last = [], 0
    for a, z in spans: rest.append(html[last:a]); last = z
    rest.append(html[last:])
    return spans, re.sub(r"<!--.*?-->", "", "".join(rest), flags=re.S).strip()


def arrange(html: str) -> str:
    """Boxes with data-flow, solved into plain left/top/width/height (put does this before writing, so the deck itself
    only ever holds pixels). data-flow="row|column|grid C [AREA] [gap N]": the boxes of a slide sharing one data-flow
    value share its AREA (body, the layout's body area, the default; or x,y,w,h) in that order: side by side, one under
    another, or C to a row; equal sizes, N px apart (default 40)."""
    def one(sec: str) -> str:
        lay = re.search(r'\bdata-layout="([\w-]+)"', sec.split(">", 1)[0])
        body = next((b[1:5] for n, _, boxes in layouts() if lay and n == lay.group(1) for b in boxes if b[0] == "body"), REGION)
        groups = {}
        for m in _boxes(sec):
            flow = _attrs(m.group()).get("data-flow")
            if flow: groups.setdefault(flow, []).append(m.group())
        for flow, tags in groups.items():
            words = flow.split()
            kind, cols = words[0], int(words[1]) if words[0] == "grid" and len(words) > 1 and words[1].isdigit() else 0
            if kind not in ("row", "column", "grid") or (kind == "grid" and not cols): raise SystemExit(f'put: data-flow="{flow}": row, column or grid C, then an area (body or x,y,w,h) and gap N, as in "row body gap 40"')
            rest = words[2 if cols else 1:]
            gap = float(rest[rest.index("gap") + 1]) if "gap" in rest and rest.index("gap") + 1 < len(rest) else 40
            area = next((w for w in rest if re.fullmatch(r"[\d.]+(,[\d.]+){3}", w)), None)
            x, y, w, h = (float(v) for v in area.split(",")) if area else body
            n = len(tags); c = n if kind == "row" else 1 if kind == "column" else cols; r = -(-n // c)
            cw, ch = (w - gap * (c - 1)) / c, (h - gap * (r - 1)) / r
            for k, tag in enumerate(tags):
                geo = f"left: {round(x + (k % c) * (cw + gap))}px; top: {round(y + (k // c) * (ch + gap))}px; width: {round(cw)}px; height: {round(ch)}px;"
                style = re.sub(r"\b(left|top|width|height):\s*[^;]*;?\s*", "", _attrs(tag).get("style", "")).strip()
                new = re.sub(r'\s+data-flow="[^"]*"', "", tag)
                new = re.sub(r'\sstyle="[^"]*"', "", new)[:-1] + f' style="{geo}{" " + style if style else ""}">'
                sec = sec.replace(tag, new, 1)
        return sec
    return re.sub(r"<section\b.*?</section>", lambda m: one(m.group()), html, flags=re.S) if "data-flow" in html else html


def put_cmd(args: list[str]):
    if not args or args[0] in ("-h", "--help", "help"): return print(PUT_HELP)
    deck = _deck(args[0]); ensure_server(deck)
    text = (deck / "deck.html").read_text()
    found, problems = scan(text)
    if problems: raise SystemExit("put: deck.html has structure problems; fix those first (by hand):\n  " + "\n  ".join(problems))
    rest = [a for i, a in enumerate(args[1:], 1) if args[i - 1] != "--file" and a not in ("--after", "--delete", "--file", "--all")]
    if "--delete" in args:
        gone = sorted({slide_number(text, a) for a in rest}, reverse=True)
        if not gone: raise SystemExit("usage: glideshow put DECK --delete N …")
        if any(n > len(found) for n in gone): raise SystemExit(f"put: the deck has {len(found)} slides")
        cut = []
        for n in gone:
            s = found[n - 1]
            kin = [x for x in found if s["stack"] and x["stack"] == s["stack"]]
            if kin and all(x["n"] in gone for x in kin): cut.append(s["stack"])   # every sub-slide of a stack: the stack goes too
            else: cut.append((s["a"], s["z"]))
        for a, z in sorted(set(cut), reverse=True):
            if text[z:z + 1] == "\n": z += 1
            text = text[:a] + text[z:]
        _write(deck, text)
        return print(f"deleted slide{'s' if len(gone) > 1 else ''} {', '.join(map(str, sorted(gone)))}; the deck has {len(scan(text)[0])} slides")
    src = _opt(args, "--file")
    new = Path(src).expanduser().read_text() if src else sys.stdin.read()
    spans, junk = _top_sections(new)
    if not spans: raise SystemExit("put: no <section> on stdin (or --file)")
    if junk: raise SystemExit(f"put: only <section>s, please; this is outside them: {junk[:120]!r}")
    new = "\n".join(new[a:z].strip() for a, z in spans)
    made, bad = scan(f'<div class="slides">\n{new}\n</div>')
    if bad: raise SystemExit("put: " + "; ".join(re.sub(r"deck\.html line \d+: | \(deck\.html line \d+\)", "", b) for b in bad))
    new = arrange(new)
    for m in reversed(list(_boxes(new))):   # every box has its place: attached lines get one at load (written as zeros)
        at = _attrs(m.group()); style = at.get("style", "")
        if all(re.search(rf"\b{k}:\s*-?[\d.]+px", style) for k in ("left", "top", "width", "height")): continue
        if at.get("data-from") and at.get("data-to"):
            tag = re.sub(r'\sstyle="[^"]*"', "", m.group())[:-1] + f' style="left: 0px; top: 0px; width: 0px; height: 0px;{" " + style if style else ""}">'
            new = new[:m.start()] + tag + new[m.end():]
        else: raise SystemExit(f"put: #{at.get('id', '?')} has no place: give it left / top / width / height in px, or data-flow")
    if "--all" in args:   # every slide replaced (a script that builds the whole deck pipes it all in)
        if found: a, z = (found[0]["stack"] or (found[0]["a"],))[0], max((x["stack"] or (0, x["z"]))[1] for x in found)
        else: a = z = text.find(">", text.find('<div class="slides"')) + 1
        first = 1
    elif "--after" in args:
        after = _opt(args, "--after")
        if not after: raise SystemExit("usage: glideshow put DECK --after N (0: before the first slide)")
        n = slide_number(text, after) if after != "0" else 0
        if n > len(found): raise SystemExit(f"put: the deck has {len(found)} slides")
        if n: a = z = found[n - 1]["z"]
        elif found: a = z = found[0]["a"]
        else: a = z = text.find(">", text.find('<div class="slides"')) + 1
        first = n + 1
    else:
        if len(rest) != 1: raise SystemExit(PUT_HELP)
        n = slide_number(text, rest[0])
        if not 1 <= n <= len(found): raise SystemExit(f"put: there is no slide {rest[0]} (the deck has {len(found)})")
        a, z = found[n - 1]["a"], found[n - 1]["z"]; first = n
        old_sid = re.search(r'\bdata-sid="([^"]+)"', text[a:a + 400].split(">", 1)[0])
        if old_sid and not re.search(r'\bdata-sid="', new.split(">", 1)[0]):
            new = re.sub(r"<section\b", f'<section data-sid="{old_sid.group(1)}"', new, count=1)
    start = text.find('<div class="slides"'); end = max(x["z"] for x in found) if found else a
    others = text[start:a] + text[z:end]
    ids = re.findall(r'\bid="([^"]+)"', new)
    dup = sorted({i for i in ids if ids.count(i) > 1})
    if dup: raise SystemExit(f"put: these ids are used twice in what you sent: {', '.join(dup)}")
    taken = sorted({i for i in ids if re.search(rf'\bid="{re.escape(i)}"', others)})
    if taken: raise SystemExit(f"put: the deck already has boxes with these ids: {', '.join(taken)} (ids are unique in the whole deck; give the new slide's boxes a prefix of their own)")
    sids = [x for x in re.findall(r'\bdata-sid="([^"]+)"', new) if f'data-sid="{x}"' in others]
    if sids: raise SystemExit(f"put: data-sid {', '.join(sids)} belongs to another slide; leave data-sid out of new slides")
    pre = "" if text[:a].endswith("\n") else "\n"
    text = text[:a] + pre + new + ("\n" if a == z and not text[z:].startswith("\n") else "") + text[z:]
    now = scan(text)[0]
    mine = now[first - 1:first - 1 + len(made)]
    wrong = lint(text, deck, {s["n"] for s in mine})   # a link to a slide not there yet is only reported: it may come next
    if [w for w in wrong if "#slide=" not in w]: raise SystemExit("put: nothing written:\n  " + "\n  ".join(wrong))
    _write(deck, text)
    for s in mine: print(outline_line(text, s))
    for w in wrong: print(f"problem: {w}", file=sys.stderr)
    print(f"{'inserted' if '--after' in args else 'replaced every slide' if '--all' in args else 'replaced'}; `glideshow check {args[0]} {' '.join(str(s['n']) for s in mine)}` checks {'them' if len(mine) > 1 else 'it'}")


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
    side = src.with_name(src.name + ".json")   # where the figure's labels are (glideshow.figure.save), for check
    if side.is_file() and side.resolve() != (deck / "assets" / f"{name}.json").resolve(): (deck / "assets" / f"{name}.json").write_bytes(side.read_bytes())
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
    n_slide = slide_number(text, slide) if slide else len(sections(text))
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
        before = (deck / out).read_bytes() if (deck / out).is_file() else None
        r = subprocess.run(run, shell=True, cwd=deck, capture_output=True, text=True)
        glyphs = sorted({chr(int(g)) for g in re.findall(r"Glyph (\d+)\b[^\n]*?missing from", r.stdout + r.stderr)})
        if glyphs: print(f"#{bid}: the figure's font has no {' '.join(glyphs)}: they are drawn as empty boxes (use words, or a font that has them)")
        if r.returncode:
            failed += 1; print(f"#{bid}: `{run}` failed (exit {r.returncode}):\n{(r.stderr or r.stdout).strip()[-800:]}", file=sys.stderr); continue
        if not (deck / out).is_file(): failed += 1; print(f"#{bid}: `{run}` ran but wrote no {out}", file=sys.stderr); continue
        side = deck / f"{out}.json"   # glideshow.figure.save keeps matplotlib's warnings there
        lacks = sorted(set(json.loads(side.read_text()).get("missing", [])) - set(glyphs)) if side.is_file() and side.stat().st_mtime >= time.time() - 600 else []
        if lacks: print(f"#{bid}: the figure's font has no {' '.join(lacks)}: they are drawn as empty boxes (use words, or a font that has them)")
        new_alt = _opt(args, "--alt")
        if before is not None and not new_alt and _same_picture(before, (deck / out).read_bytes()): print(f"#{bid}: unchanged"); continue
        figure_add([str(deck), str(deck / out), "--replace", bid] + (["--alt", new_alt] if new_alt else []))
        text = (deck / "deck.html").read_text()
        at = _box(text, bid).start(); alt = re.search(r'\balt="([^"]*)"', text[at:_close_box(text, at)])
        if not new_alt and alt: print(f'#{bid}: its alt text is still "{htmllib.unescape(alt.group(1))}"; if the new data changed what it shows, pass --alt "…" (and fix any caption on the slide)')
    if failed: raise SystemExit(1)


def _same_picture(a: bytes, b: bytes) -> bool:
    """Do two pictures have the same pixels? PNGs by their header and image data only (not the metadata a save adds)."""
    def pixels(d: bytes):
        if d[:8] != b"\x89PNG\r\n\x1a\n": return d
        out, i = [], 8
        while i + 8 <= len(d):
            n, kind = int.from_bytes(d[i:i + 4], "big"), d[i + 4:i + 8]
            if kind in (b"IHDR", b"PLTE", b"IDAT"): out.append(d[i + 8:i + 8 + n])
            i += 12 + n
        return b"".join(out)
    return a == b or pixels(a) == pixels(b)


FIGURE_DEP = "glideshow"   # (from PyPI)


def mplstyle(th: dict) -> str:
    """deck.mplstyle: the deck's theme for matplotlib (font, ink, accents, sizes that read on a slide, KaTeX's maths font)."""
    font = (th.get("font") or "Arial").split(",")[0].strip("'\" ")
    ink, title = (th.get("text") or "#595959").lstrip("#"), (th.get("title") or "#000000").lstrip("#")
    return f"""# This deck's look for matplotlib (written by `glideshow figure size`): plt.style.use("deck.mplstyle")
font.family: sans-serif
font.sans-serif: {font}, Arial, Helvetica, DejaVu Sans
font.size: 14
axes.titlesize: 16
axes.labelsize: 14
xtick.labelsize: 12
ytick.labelsize: 12
legend.fontsize: 12
legend.frameon: False
text.color: {ink}
axes.labelcolor: {ink}
axes.titlecolor: {title}
axes.edgecolor: {ink}
xtick.color: {ink}
ytick.color: {ink}
axes.spines.top: False
axes.spines.right: False
axes.prop_cycle: cycler('color', ['1a73e8', 'd93025', '188038', 'f9ab00', '9334e6', '12b5cb', 'e8710a', '5f6368'])
mathtext.fontset: cm
savefig.dpi: 384
"""


def figure_size(args: list[str]):
    """matplotlib settings for a figure that fills a space exactly: 1 in of figure = 192 px of slide, so a point in the
    figure is a point on the slide (and the 24 px reading floor is 9 pt)."""
    if not args: raise SystemExit("usage: glideshow figure size DECK --slide N [--box ID | --at body|x,y,w,h]")
    deck = _deck(args[0]); text = (deck / "deck.html").read_text()
    box_id, slide_n = _opt(args, "--box"), slide_number(text, _opt(args, "--slide") or str(len(sections(text))))
    if box_id:
        m = _box(text, box_id); x, y, w, h = _box_geo(m.group()); slide_n = _slide_of(text, m.start())
    else:
        a, z = _slide_span(text, slide_n)
        x, y, w, h = _region(text, a, z, _opt(args, "--at"))
    m = re.search(r"/\* slides-theme (\{.*?\}) \*/", text)
    try: th = json.loads(m.group(1)) if m else {}
    except ValueError: th = {}
    (deck / "deck.mplstyle").write_text(mplstyle(th))
    print(f"""# the space: {w:g}×{h:g} px at {x:g},{y:g} on slide {slide_n}; wrote {deck / "deck.mplstyle"} (the deck's font, colours, sizes)
# a script in the deck's folder (e.g. src/plot.py, run there by `uv run src/plot.py --out assets/NAME.png`):
# /// script
# dependencies = ["matplotlib", "{FIGURE_DEP}"]
# ///
import sys, matplotlib.pyplot as plt
from glideshow.figure import save
plt.style.use("deck.mplstyle")
fig, ax = plt.subplots(figsize=({w / 192:.2f}, {h / 192:.2f}), layout="constrained")   # 192 px of slide per inch: 1 pt here = 1 pt on the slide
# … plot …   (constrained layout keeps the axis labels inside the figure; no bbox_inches="tight", it changes the shape)
save(fig, sys.argv[sys.argv.index("--out") + 1])   # the PNG at 2× the slide's pixels, and beside it where its labels are, for glideshow check
# then: glideshow figure add {deck} assets/NAME.png --slide {slide_n} --at {x:g},{y:g},{w:g},{h:g} --id NAME --alt "WHAT IT SHOWS" --source "uv run src/plot.py --out {{out}}"
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
