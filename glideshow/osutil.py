"""What differs by operating system: the Trash, showing a file in the file manager, and where fonts are installed."""

import datetime, os, shutil, subprocess, sys, time
from pathlib import Path
from urllib.parse import quote


def trash(p: Path) -> Path:
    """Move a deck folder to the Trash (macOS), the freedesktop trash (Linux) or, elsewhere, $GLIDESHOW_HOME/.trash.
    GLIDESHOW_TRASH overrides (tests use a temp dir)."""
    stamp = f"{p.name}-{int(time.time())}"
    if os.environ.get("GLIDESHOW_TRASH"):
        d = Path(os.environ["GLIDESHOW_TRASH"])
    elif sys.platform == "darwin":
        d = Path.home() / ".Trash"
    elif sys.platform.startswith("linux"):
        base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "Trash"
        (base / "info").mkdir(parents=True, exist_ok=True); (base / "files").mkdir(parents=True, exist_ok=True)
        (base / "info" / f"{stamp}.trashinfo").write_text(
            f"[Trash Info]\nPath={quote(str(p.resolve()))}\nDeletionDate={datetime.datetime.now().strftime('%Y-%m-%dT%H:%M:%S')}\n")
        d = base / "files"
    else:
        d = p.parent / ".trash"
    d.mkdir(parents=True, exist_ok=True)
    dst = d / stamp
    shutil.move(str(p), dst)
    return dst


def reveal(p: Path) -> None:
    """Show the file in Finder / Explorer / the default file manager."""
    if sys.platform == "darwin": subprocess.run(["open", "-R", str(p)], check=False)
    elif sys.platform == "win32": subprocess.run(["explorer", "/select,", str(p)], check=False)
    else: subprocess.run(["xdg-open", str(p.parent)], check=False)


def font_dirs() -> list:
    """Folders holding fonts installed on this computer, for the font menu's "Your fonts"."""
    home = Path.home()
    if sys.platform == "darwin":
        return [home / "Library" / "Fonts", Path("/Library/Fonts")]
    if sys.platform == "win32":
        return [Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts", Path(os.environ.get("LOCALAPPDATA", home)) / "Microsoft" / "Windows" / "Fonts"]
    return [home / ".local" / "share" / "fonts", home / ".fonts", Path("/usr/share/fonts"), Path("/usr/local/share/fonts")]
