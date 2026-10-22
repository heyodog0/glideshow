"""Fonts for the font menu: those installed on this Mac and the Google Fonts catalogue (fetched monthly, snapshot offline)."""

import json, os, re, time, urllib.request
from pathlib import Path

from .decks import EDITOR
from .osutil import font_dirs

# Fonts installed on this computer, for the font menu's "Your fonts" (Linux keeps them in subfolders).
FONT_EXTS = {".ttf", ".otf", ".woff", ".woff2"}


def local_fonts() -> list:
    return sorted((f for d in font_dirs() if d.is_dir() for f in d.rglob("*") if f.suffix.lower() in FONT_EXTS and f.is_file()), key=lambda f: f.name.lower())



# The Google Fonts catalogue for the font menu: fetched once a month into ~/.glideshow/fonts.json, with editor/fonts.json
# (a snapshot) as the offline fallback. Rows: [family, category, styles, popularity(, weight)], where styles is a bit
# set of the faces available (1 = 400, 2 = 700, 4 = 400 italic, 8 = 700 italic) and weight the lightest upright
# face of a family without 400.
FONTS_CACHE = Path(os.environ.get("GLIDESHOW_CACHE") or Path.home() / ".glideshow") / "fonts.json"   # GLIDESHOW_CACHE: tests use a temp dir
FONTS_URL = "https://fonts.google.com/metadata/fonts"
FONT_CATS = {"Sans Serif": "sans", "Serif": "serif", "Display": "display", "Handwriting": "handwriting", "Monospace": "mono"}


def distil_fonts(text: str) -> list:
    meta = json.loads(text[text.index("{"):])   # the response starts with an anti-JSON-hijacking prefix
    rows = []
    for f in meta.get("familyMetadataList", []):
        name = f.get("family", "")
        if not re.fullmatch(r"[A-Za-z0-9 \-'.&+]{1,60}", name):
            continue
        faces = set((f.get("fonts") or {}).keys())
        bits = sum(b for k, b in (("400", 1), ("700", 2), ("400i", 4), ("700i", 8)) if k in faces)
        row = [name, FONT_CATS.get(f.get("category", ""), "display"), bits, int(f.get("popularity") or 9999)]
        if not bits & 1:
            ups = sorted(int(k) for k in faces if k.isdigit())
            if not ups:
                continue
            row.append(ups[0])
        rows.append(row)
    return sorted(rows, key=lambda r: r[0].lower())


def font_catalogue() -> list:
    try:
        if time.time() - FONTS_CACHE.stat().st_mtime < 30 * 86400:
            return json.loads(FONTS_CACHE.read_text())
    except (OSError, ValueError):
        pass
    if os.environ.get("GLIDESHOW_OFFLINE"):
        return json.loads((EDITOR / "data" / "fonts.json").read_text())
    try:
        with urllib.request.urlopen(FONTS_URL, timeout=8) as r:
            rows = distil_fonts(r.read(20_000_000).decode("utf-8"))
        if len(rows) > 500:
            FONTS_CACHE.parent.mkdir(exist_ok=True)
            FONTS_CACHE.write_text(json.dumps(rows, separators=(",", ":")))
            return rows
    except Exception:
        pass
    return json.loads((EDITOR / "data" / "fonts.json").read_text())
