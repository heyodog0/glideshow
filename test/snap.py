# /// script
# dependencies = ["playwright"]
# ///
"""Render every slide of a deck to PNG at 1920×1080 (the same renderer as `glideshow render`: glideshow/render.py).

    uv run test/snap.py DECK_DIR OUT_DIR [N ...]    # all slides, or only slides N (1-based)
"""
import runpy
from pathlib import Path

if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).resolve().parent.parent / "glideshow" / "render.py"), run_name="__main__")
