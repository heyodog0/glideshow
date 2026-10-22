"""--build: a self-contained copy of a deck that presents without the network."""

import hashlib, re, urllib.request
from pathlib import Path

# --build: a copy of the deck that needs no network. reveal.js (and the notes plugin shapes.js loads beside it) is
# vendored under vendor/, and the deck's Google Fonts / Material Symbols links become assets/fonts/google-fonts.css and
# google-icons.css with the font files
# beside it. Only https URLs in those two places are fetched; everything else is copied as is.
MAX_FETCH = 25_000_000   # bytes: pasted image URLs larger than this are refused
REVEAL_FILES = ["dist/reveal.css", "dist/reveal.js", "plugin/notes/notes.js", "plugin/highlight/highlight.js"]
WOFF2_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


def fetch(url: str, ua: str = "slides-build") -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": ua}), timeout=30) as r:
        return r.read(MAX_FETCH)


def build(deck: Path, out: Path) -> None:
    import shutil
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"{out} is not empty")
    shutil.copytree(deck, out, dirs_exist_ok=True, ignore=shutil.ignore_patterns(".*"))
    html = (out / "deck.html").read_text()
    for m in sorted(set(re.findall(r"https://cdn\.jsdelivr\.net/npm/(reveal\.js@[\d.]+)/dist/reveal\.(?:css|js)", html))):
        for rel in REVEAL_FILES:
            dst = out / "vendor" / m.replace("@", "-") / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(fetch(f"https://cdn.jsdelivr.net/npm/{m}/{rel}"))
        html = html.replace(f"https://cdn.jsdelivr.net/npm/{m}/", f"vendor/{m.replace('@', '-')}/")
    for ver in sorted(set(re.findall(r"https://cdn\.jsdelivr\.net/npm/katex@([\d.]+)/dist/", html))):   # equations (shapes.js)
        base, dst = f"https://cdn.jsdelivr.net/npm/katex@{ver}/dist/", out / "vendor" / f"katex-{ver}"
        for rel in ["katex.min.css", "katex.min.js", "contrib/auto-render.min.js"]:
            (dst / rel).parent.mkdir(parents=True, exist_ok=True)
            (dst / rel).write_bytes(fetch(base + rel))
        for rel in sorted(set(re.findall(r"url\((fonts/[^)]+?\.woff2)\)", (dst / "katex.min.css").read_text()))):
            (dst / rel).parent.mkdir(parents=True, exist_ok=True)
            (dst / rel).write_bytes(fetch(base + rel))
        html = html.replace(base, f"vendor/katex-{ver}/")
    for link in re.finditer(r'<link id="deck-(fonts|icons)"[^>]*href="(https://fonts\.googleapis\.com/css2\?[^"]+)"', html):
        css = fetch(link.group(2).replace("&amp;", "&"), WOFF2_UA).decode()
        fonts = out / "assets" / "fonts"
        fonts.mkdir(parents=True, exist_ok=True)
        def local(m):
            data = fetch(m.group(1))
            name = hashlib.sha1(data).hexdigest()[:12] + ".woff2"
            (fonts / name).write_bytes(data)
            return f"url({name})"
        css = re.sub(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", local, css)
        (fonts / f"google-{link.group(1)}.css").write_text(css)
        html = html.replace(link.group(2), f"assets/fonts/google-{link.group(1)}.css")
    (out / "deck.html").write_text(html)
    print(f"Built {out / 'deck.html'} (no network needed)")
