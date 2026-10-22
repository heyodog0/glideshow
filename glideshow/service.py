"""The one background server: where it runs, whether it is ours, and whether it runs the current code.

A default-port server records itself in ~/.glideshow/server.json (pid, port, code version). `glideshow` and the app ask that
server (GET /api/ping) instead of guessing ports; a server whose code version differs from the files on disk is told to
quit and a fresh one takes over, and a running server restarts itself when its own Python files change."""

import hashlib, json, os, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = Path(os.environ.get("GLIDESHOW_CACHE") or Path.home() / ".glideshow")
DEFAULT_PORT = int(os.environ.get("GLIDESHOW_PORT") or 47800)   # out of the way of the usual dev-server ports
# A server on its own port (GLIDESHOW_PORT, a test's) records itself apart, so it never finds or replaces the usual one
STATE = CACHE / (f"server-{DEFAULT_PORT}.json" if os.environ.get("GLIDESHOW_PORT") else "server.json")


def code_version() -> str:
    """Changes whenever a Python file of the server changes (the editor's own files are served fresh anyway)."""
    h = hashlib.sha1()
    for f in sorted(HERE.glob("*.py")):
        st = f.stat(); h.update(f"{f.name}:{st.st_size}:{st.st_mtime_ns};".encode())
    return h.hexdigest()[:12]


def ping(port: int) -> dict | None:
    try:
        with urllib.request.urlopen(f"http://localhost:{port}/api/ping", timeout=1) as r:
            j = json.load(r)
        return j if j.get("app") in ("glideshow", "slides") else None   # (a server from before the rename answers "slides")
    except Exception:
        return None


def live() -> dict | None:
    """The recorded server if it answers as ours: {port, pid, version, url}."""
    try: s = json.loads(STATE.read_text())
    except (OSError, ValueError): return None
    p = ping(s.get("port", 0))
    return {**s, **p, "url": f"http://localhost:{s['port']}/"} if p and p.get("pid") == s.get("pid") else None


def same_install(s: dict) -> bool:
    """Is that running server this copy of slides (the checkout, or the installed package)? Only then may we replace it
    for running older code; two installs would otherwise keep replacing each other's server."""
    return not s.get("install") or Path(s["install"]).resolve() == HERE   # a server too old to say is replaceable



def record(port: int) -> None:

    CACHE.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps({"port": port, "pid": os.getpid(), "version": code_version()}))


def forget_me() -> None:
    try:
        if json.loads(STATE.read_text()).get("pid") == os.getpid(): STATE.unlink()
    except (OSError, ValueError):
        pass


def post(url: str, path: str, body: dict) -> dict:
    req = urllib.request.Request(url + path, data=json.dumps(body).encode(), method="POST", headers={"X-Glideshow": "1"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)
