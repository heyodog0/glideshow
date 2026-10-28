"""Deck folders: a new deck from the template (+ its AGENTS.md), pictures added from the command line, the recent
list, the library ($GLIDESHOW_HOME) and switching the server to another deck."""

import hashlib, json, os, re
from pathlib import Path

HERE = Path(__file__).resolve().parent
# The editor's files and the docs copied into decks: inside the package when installed, beside it in the repository.
EDITOR = HERE / "editor" if (HERE / "editor").is_dir() else HERE.parent / "editor"
DOCS = HERE / "docs" if (HERE / "docs").is_dir() else HERE.parent / "docs"
DECK_FILES = EDITOR / "deck"   # the template and what every deck carries inline: base.css, shapes.js, present.js


def new_deck(path: Path, title: str = "") -> None:
    html = (DECK_FILES / "template.html").read_text()
    html = html.replace("{{BASE}}", (DECK_FILES / "base.css").read_text().strip())
    html = html.replace("{{SHAPES}}", (DECK_FILES / "shapes.js").read_text().strip())
    html = html.replace("{{PRESENT}}", (DECK_FILES / "present.js").read_text().strip())
    if title:
        import html as _html
        html = re.sub(r"<title>.*?</title>", f"<title>{_html.escape(title)}</title>", html, count=1, flags=re.S)
    import datetime   # every deck has a date (the talk's or meeting's), today's to start with
    html = html.replace("</title>", f'</title>\n<meta name="date" content="{datetime.date.today().isoformat()}">', 1)
    path.write_text(html)
    write_agents_md(path.parent)


def docs_text(part: str = "") -> str:
    """AGENTS.md: the guide and recipes (docs/agents.md, with the layouts' table written from the editor's own) and the
    format reference (docs/deck-format.md); `glideshow docs` prints the first ("guide"), `glideshow docs reference` the
    second, so an agent reads the reference only when it needs it."""
    from .agent import layout_table
    guide = (DOCS / "agents.md").read_text().replace("{{LAYOUTS}}", layout_table()).rstrip()
    ref = (DOCS / "deck-format.md").read_text()
    return {"guide": guide, "reference": ref}.get(part) or guide + "\n\n" + ref


def write_agents_md(deck: Path) -> None:
    """AGENTS.md beside deck.html (docs_text)."""
    (deck / "AGENTS.md").write_text(docs_text())


def image_size(data: bytes):
    """(width, height) of a PNG, JPEG or GIF, read from its header; None if unknown."""
    import struct
    if data[:8] == b"\x89PNG\r\n\x1a\n": return struct.unpack(">II", data[16:24])
    if data[:6] in (b"GIF87a", b"GIF89a"): return struct.unpack("<HH", data[6:10])
    if data[:2] == b"\xff\xd8":
        i = 2
        while i < len(data) - 9:
            if data[i] != 0xFF: i += 1; continue
            marker, size = data[i + 1], struct.unpack(">H", data[i + 2:i + 4])[0]
            if marker in (0xC0, 0xC1, 0xC2): h, w = struct.unpack(">HH", data[i + 5:i + 9]); return w, h
            i += 2 + size
    return None


def add_image(deck: Path, src: Path, slide: int | None = None) -> str:
    """Copy a picture into assets/ and place it on slide N (1-based; default the last), fitted into the body area."""
    data = src.read_bytes()
    name = f"{hashlib.sha1(data).hexdigest()[:12]}{src.suffix.lower() or '.png'}"
    (deck / "assets").mkdir(exist_ok=True); (deck / "assets" / name).write_bytes(data)
    w0, h0 = image_size(data) or (1600, 900)
    k = min(1680 / w0, 760 / h0); w, h = round(w0 * k), round(h0 * k)
    x, y = 120 + (1680 - w) // 2, 240 + (760 - h) // 2
    box = f'  <div class="box image" style="left: {x}px; top: {y}px; width: {w}px; height: {h}px;"><div class="content"><img src="assets/{name}" alt=""></div></div>\n'
    html = (deck / "deck.html").read_text()
    ends = [m.start() for m in re.finditer(r"</section>", html)]
    leaves = [e for e in ends if not re.search(r"</section>\s*$", html[:e])]   # a stack's outer </section> follows an inner one
    if not leaves: raise SystemExit("the deck has no slides")
    at = leaves[(slide - 1) if slide else -1]
    (deck / "deck.html").write_text(html[:at] + box + html[at:])
    return f"assets/{name}"


# Decks opened recently (newest first), for File → Open; the server can switch to another deck folder.
RECENT = Path(os.environ.get("GLIDESHOW_CACHE") or Path.home() / ".glideshow") / "recent.json"


def recent_decks() -> list:
    try:
        paths = json.loads(RECENT.read_text())
    except (OSError, ValueError):
        paths = []
    return [p for p in paths if (Path(p) / "deck.html").exists()]


# A new presentation is a draft until it has a title: it lives in ~/.glideshow/drafts/, outside the library (not listed,
# not committed, not backed up), and moves into the library folder it was started from once it is named.
DRAFTS = RECENT.parent / "drafts"
UNTITLED = "Untitled deck"


def is_draft(deck: Path) -> bool:
    return DRAFTS.resolve() in deck.resolve().parents


def new_draft(folder: str = "") -> Path:
    import shutil, time as _t
    for old in DRAFTS.glob("*") if DRAFTS.is_dir() else []:   # drafts nobody named within a day are dropped
        if old.is_dir() and _t.time() - old.stat().st_mtime > 86400: shutil.rmtree(old, ignore_errors=True)
    d = DRAFTS / f"draft-{int(_t.time() * 1000)}"
    (d / "assets").mkdir(parents=True)
    new_deck(d / "deck.html")
    (d / ".draft.json").write_text(json.dumps({"folder": folder}))
    return d


def name_draft(d: Path) -> Path | None:
    """The draft's new home in the library once it has a title, moved there; None while it is still untitled."""
    import shutil
    title = deck_title(d)
    if title in ("", UNTITLED) or title == d.name: return None
    try: folder = json.loads((d / ".draft.json").read_text()).get("folder", "")
    except (OSError, ValueError): folder = ""
    base = in_library(folder) / (re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60] or "deck")
    dst, n = base, 2
    while dst.exists(): dst, n = Path(f"{base}-{n}"), n + 1
    dst.parent.mkdir(parents=True, exist_ok=True)
    (d / ".draft.json").unlink(missing_ok=True)
    shutil.move(str(d), dst)
    return dst


def remember(deck: Path) -> None:
    if is_draft(deck): return   # drafts never show in recent decks
    paths = [str(deck)] + [p for p in recent_decks() if p != str(deck)]

    RECENT.parent.mkdir(parents=True, exist_ok=True)
    RECENT.write_text(json.dumps(paths[:12]))


def deck_date(deck: Path) -> str:
    """The deck's date, <meta name="date" content="YYYY-MM-DD">, or '' when it has none."""
    m = re.search(r'<meta name="date" content="(\d{4}-\d{2}-\d{2})"', (deck / "deck.html").read_text(errors="replace")[:20000])
    return m.group(1) if m else ""


def deck_title(deck: Path) -> str:
    m = re.search(r"<title>(.*?)</title>", (deck / "deck.html").read_text(errors="replace"), re.S)
    return (m.group(1).strip() if m else "") or deck.name


HOME = Path(os.environ.get("GLIDESHOW_HOME") or Path.home() / "decks").expanduser()


def walk_library():
    """(decks, folders) under $GLIDESHOW_HOME: a folder holding deck.html is a deck (not looked inside); any other folder
    groups decks and may nest. Hidden folders are skipped."""
    decks, folders = [], []
    def visit(d: Path, depth: int):
        for c in sorted(d.iterdir()) if d.is_dir() else []:
            if not c.is_dir() or c.name.startswith(".") or c.name == "assets": continue   # assets/ outside a deck is a leftover, not a folder

            if (c / "deck.html").exists(): decks.append(c)
            elif depth < 6: folders.append(c); visit(c, depth + 1)
    visit(HOME, 0)
    return decks, folders


def folder_of(d: Path) -> str | None:
    """The deck's folder in the library ('' at the top, 'Lab/2026' nested), or None for a deck outside it."""
    try: rel = d.parent.resolve().relative_to(HOME.resolve())
    except ValueError: return None
    return "" if rel == Path(".") else rel.as_posix()



def deck_id(d: Path) -> str:
    return hashlib.sha1(str(d.resolve()).encode()).hexdigest()[:12]   # stable, unique even when two folders share a name


def all_decks(current: Path) -> list:
    """The current deck, recent decks and every deck in $GLIDESHOW_HOME (in any folder), newest edit first."""
    seen, out = set(), []
    for d in [current, *map(Path, recent_decks()), *walk_library()[0]]:
        d = d.resolve()
        if d in seen or not (d / "deck.html").exists() or d.name.startswith(".") or is_draft(d):

            continue
        seen.add(d)
        out.append({"path": str(d), "id": deck_id(d), "name": d.name, "folder": folder_of(d), "title": deck_title(d), "shown": shown_title(d), "date": deck_date(d),

                    "mtime": (d / "deck.html").stat().st_mtime, "current": d == current})
    return sorted(out, key=lambda x: -x["mtime"])


def shown_title(d: Path) -> str:
    """What the home screen calls a deck: its title, or for a generic one ('Untitled deck', 'Untitled presentation')
    the first line of text on its first slide ('' if it has none either)."""
    t = deck_title(d)
    if not re.fullmatch(r"\s*untitled( deck| presentation)?\s*", t, re.I): return t
    html = (d / "deck.html").read_text(errors="replace")
    first = html[html.find("<section"):][:200000]
    first = first[:first.find("</section>")] if "</section>" in first else first
    for m in re.finditer(r'<div class="box(?![^"]*\bnote\b)[^"]*"[^>]*>\s*<div class="content"[^>]*>(.*?)</div>\s*</div>', first, re.S):
        lines = [re.sub(r"\s+", " ", l).strip() for l in re.sub(r"<[^>]+>", " ", re.sub(r"<(br|/div|/p|/li)[^>]*>", "\n", m.group(1))).split("\n")]
        if line := next((l for l in lines if l), ""): return html_unescape(line)[:80]

    return ""


def html_unescape(s: str) -> str:
    import html
    return html.unescape(s)


def library_folders() -> list:

    """Every folder in the library as a path relative to $GLIDESHOW_HOME ('Lab', 'Lab/2026')."""
    return [f.resolve().relative_to(HOME.resolve()).as_posix() for f in walk_library()[1]]


def in_library(rel: str) -> Path:
    """A folder path relative to $GLIDESHOW_HOME, refusing anything that would leave it."""
    p = (HOME / (rel or "")).resolve()
    if p != HOME.resolve() and HOME.resolve() not in p.parents: raise ValueError(f"{rel!r} is outside the library")
    return p


def forget(deck: Path) -> None:
    RECENT.parent.mkdir(parents=True, exist_ok=True)
    RECENT.write_text(json.dumps([p for p in recent_decks() if Path(p).resolve() != deck.resolve()]))



def set_title(deck: Path, title: str) -> None:
    import html as _html
    f = deck / "deck.html"
    f.write_text(re.sub(r"<title>.*?</title>", f"<title>{_html.escape(title)}</title>", f.read_text(), count=1, flags=re.S))
