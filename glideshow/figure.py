"""For a figure script: save a matplotlib figure for a slide, and beside it where its text is, so `glideshow check` can
see inside the picture (labels overlapping or cut off at its edge, text too small on the slide, missing glyphs).

    from glideshow.figure import save
    save(fig, "assets/curves.png")   # assets/curves.png and assets/curves.png.json

Needs nothing but the matplotlib the script already uses."""
import json, re, warnings
from pathlib import Path


def save(fig, out, dpi: int = 384, **kw):
    """fig.savefig(out) at 2× the slide's pixels (a figure 1 in wide fills 192 px of slide), then OUT.json: the figure's
    size in inches and each visible piece of text: its words, size in pt and box as shares of the figure (0–1, from the
    top left). Glyphs the font lacks are listed too (matplotlib draws them as empty boxes)."""
    from matplotlib.text import Text
    texts, draw = {}, Text.draw
    def note(self, renderer, *a, **k):   # each piece of text as it is drawn (so not the labels of ticks outside the axes' range)
        done = draw(self, renderer, *a, **k)
        if self.get_visible() and self.get_text().strip():
            b, W, H = self.get_window_extent(renderer), fig.bbox.width, fig.bbox.height
            if b.width > 0 and b.height > 0:
                texts[id(self)] = {"text": self.get_text()[:80], "pt": round(self.get_fontsize(), 2),
                                   "x": round(b.x0 / W, 4), "y": round(1 - b.y1 / H, 4), "w": round(b.width / W, 4), "h": round(b.height / H, 4)}
        return done
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        Text.draw = note
        try: fig.savefig(out, dpi=dpi, **kw)
        finally: Text.draw = draw
    missing = sorted({chr(int(m.group(1))) for w in caught if (m := re.search(r"Glyph (\d+)\b.*missing from", str(w.message)))})
    w_in, h_in = fig.get_size_inches()
    Path(str(out) + ".json").write_text(json.dumps({"inches": [round(w_in, 3), round(h_in, 3)], "texts": list(texts.values()), "missing": missing}))
