"""Each font's vertical middle, for the Google import's baseline (glideshow/gslides.py BASELINE): writes
editor/data/font-metrics.json, {family: (hhea ascender + descender) / 2 / unitsPerEm}.

The browser puts a line's baseline that far below the line's middle; Google Slides puts it 0.351 em below in every
font, so the importer shifts runs by the difference. Read from the font files themselves: the most popular Google Fonts
(TTF from the css2 API) and the system fonts on this Mac.

    uv run tools/font_metrics.py [how many Google Fonts, default 400]"""

import json, re, struct, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "editor" / "data" / "font-metrics.json"
SYSTEM = {"Arial": "Arial.ttf", "Times New Roman": "Times New Roman.ttf", "Courier New": "Courier New.ttf", "Georgia": "Georgia.ttf",
          "Verdana": "Verdana.ttf", "Trebuchet MS": "Trebuchet MS.ttf", "Comic Sans MS": "Comic Sans MS.ttf", "Impact": "Impact.ttf",
          "Tahoma": "Tahoma.ttf"}


def middle(data: bytes) -> float:
    """(hhea ascender + descender) / 2 in em, from a TrueType/OpenType file (the first font of a collection)."""
    base = struct.unpack(">I", data[12:16])[0] if data[:4] == b"ttcf" else 0
    n = struct.unpack(">H", data[base + 4:base + 6])[0]
    tables = {data[base + 12 + 16 * i:base + 16 + 16 * i]: struct.unpack(">I", data[base + 20 + 16 * i:base + 24 + 16 * i])[0] for i in range(n)}
    upm = struct.unpack(">H", data[tables[b"head"] + 18:tables[b"head"] + 20])[0]
    asc, desc = struct.unpack(">hh", data[tables[b"hhea"] + 4:tables[b"hhea"] + 8])
    return (asc + desc) / 2 / upm


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as r: return r.read()


def google(family: str) -> float | None:
    try:
        css = get("https://fonts.googleapis.com/css2?family=" + family.replace(" ", "+")).decode()
        m = re.search(r"url\((https://[^)]+\.ttf)\)", css)
        return round(middle(get(m.group(1))), 4) if m else None
    except (OSError, ValueError, KeyError, struct.error):
        return None


def main(n: int):
    rows = sorted(json.loads((ROOT / "editor" / "data" / "fonts.json").read_text()), key=lambda r: r[3])[:n]
    with ThreadPoolExecutor(8) as ex: got = dict(zip((r[0] for r in rows), ex.map(google, (r[0] for r in rows))))
    out = {f: v for f, v in got.items() if v is not None}
    for fam, file in SYSTEM.items():
        p = Path("/System/Library/Fonts/Supplemental") / file
        if p.exists(): out[fam] = round(middle(p.read_bytes()), 4)
    OUT.write_text(json.dumps(dict(sorted(out.items())), separators=(",", ":")) + "\n")
    print(f"{len(out)} fonts → {OUT.relative_to(ROOT)} ({len(rows) - len(got) + sum(v is None for v in got.values())} Google Fonts without a TTF)")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 400)
