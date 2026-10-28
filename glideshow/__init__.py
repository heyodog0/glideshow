"""Glideshow: a slide editor for reveal.js decks that agents can write by hand. See README.md."""

import os
from pathlib import Path

__version__ = "0.1.2"

# Before it was Glideshow it was "slides": its environment variables (SLIDES_HOME, …) still work, and its folder of
# settings (~/.slides) moves to ~/.glideshow the first time, leaving a link behind for anything still pointing there.
for _k, _v in list(os.environ.items()):
    if _k.startswith("SLIDES_") and "GLIDESHOW_" + _k[7:] not in os.environ: os.environ["GLIDESHOW_" + _k[7:]] = _v
_old, _new = Path.home() / ".slides", Path.home() / ".glideshow"
if not os.environ.get("GLIDESHOW_CACHE") and _old.is_dir() and not _old.is_symlink() and not _new.exists():
    try: _old.rename(_new); _old.symlink_to(_new)
    except OSError: pass
