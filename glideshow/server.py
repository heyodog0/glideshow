"""Local server for the slide editor.

    glideshow serve path/to/deck [--port N] [--no-open]      (or: python -m glideshow.server …)
    python -m glideshow.server path/to/deck --build OUT_DIR   # self-contained copy for hosting

Serves the editor at http://localhost:PORT, reads and writes DECK/deck.html, and stores
pasted images in DECK/assets/. The deck folder is self-contained: open DECK/deck.html in
any browser to present it, or send/host the folder to share it.
"""

import argparse, atexit, hashlib, json, os, re, shutil, sys, threading, time, urllib.request, webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

HERE = Path(__file__).resolve().parent

from . import comments, publish
from .build import MAX_FETCH, build
from .decks import deck_id, EDITOR, HOME, add_image, all_decks, deck_title, forget, in_library, is_draft, library_folders, name_draft, new_deck, new_draft, recent_decks, remember, set_title
from .fonts import FONT_EXTS, font_catalogue, local_fonts
from .history import GIT, commit_library, commit_now, commit_outside, commit_outside_library, git, history, init_repo, schedule_commit, sync
from .osutil import reveal, trash
from .service import CACHE, DEFAULT_PORT, code_version, forget_me, live, post, record, same_install




# Figures made by a script (data-source on a picture, `glideshow figure`): the editor's Refresh and redrawing when a file
# the command names changes. A deck can come from anyone, so a command runs only once you've approved it on this machine:
# CACHE/figure-trust.json maps a hash of deck + command to a hash of the code it runs (the script and any other code file
# the command names). A changed script isn't run, not even by the watcher, until the editor has asked again; a data file
# named in the command can change freely.
TRUST = CACHE / "figure-trust.json"
CODE = {".py", ".r", ".jl", ".sh", ".bash", ".zsh", ".js", ".mjs", ".ts", ".m", ".ipynb", ".rb", ".pl", ".do", ".sql", ".rmd", ".qmd"}
PENDING: dict = {}   # (deck, figure id) → the code hash waiting to be approved (its script changed)
def _cmd_key(deck: Path, cmd: str) -> str: return hashlib.sha256(f"{deck.resolve()}\0{cmd}".encode()).hexdigest()
def code_hash(deck: Path, cmd: str) -> str:
    """A hash of each code file the command runs (path and contents)."""
    h = hashlib.sha256()
    for f in sorted(f for f in watched_files(deck, cmd) if f.suffix.lower() in CODE):
        h.update(str(f.resolve()).encode() + b"\0" + hashlib.sha256(f.read_bytes()).digest())
    return h.hexdigest()
def _trust_map() -> dict:
    try: m = json.loads(TRUST.read_text())
    except Exception: return {}
    return m if isinstance(m, dict) else {}   # (an older list of command hashes: asked again once)
def trust_state(deck: Path, cmd: str) -> str:
    """"trusted", "changed" (approved, but its code has changed since) or "new"."""
    seen = _trust_map().get(_cmd_key(deck, cmd))
    return "new" if seen is None else "trusted" if seen == code_hash(deck, cmd) else "changed"
def trusted(deck: Path, cmd: str) -> bool: return trust_state(deck, cmd) == "trusted"
def trust(deck: Path, cmd: str):
    m = _trust_map(); m[_cmd_key(deck, cmd)] = code_hash(deck, cmd)
    TRUST.parent.mkdir(parents=True, exist_ok=True); TRUST.write_text(json.dumps(m))
    for k in [k for k in PENDING if k[0] == str(deck)]: PENDING.pop(k, None)
def figures(deck: Path) -> list:
    """(id, command) of each picture with a data-source."""
    from .agent import _attrs, _boxes
    out = []
    for m in _boxes((deck / "deck.html").read_text()):
        a = _attrs(m.group())
        if "image" in a.get("class", "").split() and a.get("id") and a.get("data-source"): out.append((a["id"], a["data-source"]))
    return out
def refresh_figure(deck: Path, fid: str):
    """`glideshow figure refresh DECK ID`: the command run again in the deck's folder, the new picture put in place."""
    import subprocess
    return subprocess.run([sys.executable, "-m", "glideshow", "figure", "refresh", str(deck), fid], capture_output=True, text=True, timeout=600)
def watched_files(deck: Path, cmd: str) -> list:
    """The files a figure's command names (its script, its data): any word of it that is a file, in the deck's folder or absolute."""
    import shlex
    try: words = shlex.split(cmd.replace("{out}", ""))
    except ValueError: words = cmd.split()
    files = []
    for w in words:
        for cand in (Path(w).expanduser(), deck / w):
            if cand.is_file() and cand.suffix.lower() not in (".png", ".jpg", ".jpeg", ".svg", ".gif") and cand not in files: files.append(cand); break
    return files


def pptx_cmd(script: str) -> list:
    """How to run a PowerPoint script: here if python-pptx is installed (`pip install glideshow[pptx]`), else through uv,
    which fetches it from the script's inline metadata."""
    import importlib.util, shutil as _sh
    if importlib.util.find_spec("pptx"): return [sys.executable, str(HERE / script)]
    if _sh.which("uv"): return ["uv", "run", "--quiet", str(HERE / script)]
    return [sys.executable, "-c", "raise SystemExit('PowerPoint needs python-pptx: pip install python-pptx')"]


class Handler(SimpleHTTPRequestHandler):
    deck: Path
    selection: dict = {}   # what the editor shows and has selected (POST /api/selection), for `glideshow selection`
    written: str | None = None   # deck.html as this server last wrote it: any other content on disk came from outside
    writing = threading.Lock()   # held while this server writes deck.html, so the watcher never reads it half-saved

    def log_message(self, *args):
        pass

    @property
    def deck_file(self) -> Path:
        return self.deck / "deck.html"

    def mtime(self) -> str:
        return str(self.deck_file.stat().st_mtime_ns)

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, base: Path, rel: str):
        path = (base / rel).resolve()
        if not path.is_relative_to(base.resolve()) or not path.is_file():
            return self.send_error(404)
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", self.guess_type(str(path)))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        if path.suffix.lower() in (".html", ".htm") and "assets" in Path(rel).parts:   # a live box's page: sandboxed even opened on its own
            self.send_header("Content-Security-Policy", "sandbox allow-scripts allow-pointer-lock")
        self.end_headers()
        self.wfile.write(data)

    def allowed(self, post=False) -> bool:
        """Only this machine's editor may talk to the server. The Host must be localhost (stops DNS rebinding), and a
        POST must carry X-Glideshow: another website can't add that header without a CORS preflight, which is never
        granted, so it can't save, delete or fetch through the server from a page you happen to visit."""
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
        ok = host in ("localhost", "127.0.0.1", "::1") and (not post or self.headers.get("X-Glideshow") == "1")
        if not ok: self.send_error(403, "not from this machine's editor")
        return ok

    def do_GET(self):
        if not self.allowed(): return
        path = unquote(urlparse(self.path).path)
        if path in ("/", "/home"):   # the home screen: every deck as a card
            return self.send_file(EDITOR, "home.html")
        if path in ("/edit", "/index.html"):
            return self.send_file(EDITOR, "index.html")
        if path == "/api/history":   # File → Version history: commits touching deck.html (?slide=N: those that changed that slide)
            q = parse_qs(urlparse(self.path).query)
            return self.send_json(history(self.deck, int(q["slide"][0]) if q.get("slide") else None))
        if path == "/api/version":   # deck.html as of one commit
            rev = parse_qs(urlparse(self.path).query).get("rev", [""])[0]
            if not re.fullmatch(r"[0-9a-f]{7,40}", rev):
                return self.send_error(400)
            return self.send_json({"html": git(self.deck, "show", f"{rev}:./deck.html").stdout})
        if path == "/api/selection":   # `glideshow selection`: the slide on show and the selected boxes, for an agent working beside you
            return self.send_json({**Handler.selection, "deck": str(self.deck), "file": str(self.deck_file)} if Handler.selection.get("deck") == str(self.deck) else {"deck": str(self.deck), "file": str(self.deck_file), "slide": None, "boxes": []})
        if path == "/api/ping":   # is this our server, which code, which deck (glideshow / the app ask before reusing it)
            return self.send_json({"app": "glideshow", "version": code_version(), "pid": os.getpid(), "deck": str(self.deck), "install": str(Path(__file__).resolve().parent)})
        if path == "/api/decks":
            return self.send_json(all_decks(self.deck))
        if path == "/api/publish":   # Share: the open deck's link ('' when not shared), who can open it, until when
            return self.send_json(publish.status(self.deck))
        if path == "/api/comments":   # comments.json beside deck.html (left on a shared deck at glideshow.org, or here)
            return self.send_json(comments.read(self.deck))
        if path == "/api/library":   # where the library is, for the home screen's welcome (~/decks)
            return self.send_json({"home": str(HOME).replace(str(Path.home()), "~", 1)})
        if path == "/api/folders":   # the library's folders, relative to $GLIDESHOW_HOME
            return self.send_json(library_folders())
        if path.startswith("/library/"):   # a file inside any known deck, by its id (home-screen thumbnails)
            rel = Path(path.removeprefix("/library/"))
            deck = next((Path(d["path"]) for d in all_decks(self.deck) if d["id"] == rel.parts[0]), None) if rel.parts else None
            return self.send_file(deck, str(Path(*rel.parts[1:]))) if deck and len(rel.parts) > 1 else self.send_error(404)
        if path.startswith("/editor/"):
            return self.send_file(EDITOR, path.removeprefix("/editor/"))
        if path.startswith("/deck/"):
            if path == "/deck/deck.html" and "skipped" in parse_qs(urlparse(self.path).query, keep_blank_values=True):   # Print preview → Include skipped slides:
                data = self.deck_file.read_text().replace("Reveal.initialize({", "Reveal.initialize({ showHiddenSlides: true,", 1).encode()   # reveal drops them otherwise
                self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store"); self.end_headers(); self.wfile.write(data); return None
            return self.send_file(self.deck, path.removeprefix("/deck/"))
        if path == "/api/deck":
            return self.send_json({"html": self.deck_file.read_text(), "mtime": self.mtime(), "draft": is_draft(self.deck), "id": deck_id(self.deck)})   # id: its files under /library/<id>/ (slides copied to another deck)

        if path == "/api/events":
            return self.events()
        if path == "/api/fonts":
            return self.send_json(font_catalogue())
        if path == "/api/recent":
            return self.send_json([{"path": p, "title": deck_title(Path(p)), "current": Path(p) == self.deck} for p in recent_decks()])
        if path == "/api/pptx":   # File → Download → PowerPoint: pptx_export.py runs under uv with python-pptx
            import subprocess, tempfile
            out = Path(tempfile.mkdtemp()) / f"{self.deck.name}.pptx"
            r = subprocess.run([*pptx_cmd("pptx_export.py"), str(self.deck_file), str(out)], capture_output=True, text=True, timeout=300)
            if r.returncode or not out.exists():
                return self.send_json({"error": (r.stderr or "export failed").strip().splitlines()[-1]}, 500)
            data = out.read_bytes()
            self.send_response(200); self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation")
            self.send_header("Content-Disposition", f'attachment; filename="{out.name}"'); self.send_header("Content-Length", str(len(data))); self.end_headers()
            return self.wfile.write(data)
        if path == "/api/figures":   # Format options → Figure: each figure, whether its command is trusted here, the files it watches
            return self.send_json({"figures": [{"id": i, "state": (st := trust_state(self.deck, c)), "trusted": st == "trusted", "pending": PENDING.get((str(self.deck), i)), "cmd": c,
                "watch": [str(f.relative_to(self.deck)) if f.is_relative_to(self.deck) else str(f) for f in watched_files(self.deck, c)]} for i, c in figures(self.deck)]})
        if path == "/api/movie":   # File → Download → Movie / Animated GIF: movie.py plays the deck in headless Chrome and records it
            import subprocess, tempfile
            q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
            kind = q.get("kind", "mp4"); kind = kind if kind in ("mp4", "gif", "webm") else "mp4"
            out = Path(tempfile.mkdtemp()) / f"{self.deck.name}.{kind}"
            opts = [x for k in ("from", "to", "slide", "build", "size", "fps") if re.fullmatch(r"[\d.x]+", q.get(k, "")) for x in (f"--{k}", q[k])]
            try: r = subprocess.run(["uv", "run", "--quiet", str(HERE / "movie.py"), str(self.deck), str(out), *opts], capture_output=True, text=True, timeout=1800)
            except FileNotFoundError: return self.send_json({"error": "a movie needs uv (https://docs.astral.sh/uv/), which brings Playwright with it"}, 500)
            if r.returncode or not out.exists():
                return self.send_json({"error": ((r.stderr or "").strip().splitlines() or ["the movie failed"])[-1]}, 500)
            data = out.read_bytes()
            self.send_response(200); self.send_header("Content-Type", {"mp4": "video/mp4", "gif": "image/gif", "webm": "video/webm"}[kind])
            self.send_header("Content-Disposition", f'attachment; filename="{out.name}"'); self.send_header("Content-Length", str(len(data))); self.end_headers()
            return self.wfile.write(data)
        if path == "/api/zip":   # the deck folder as a .zip (File → Download → Web page)
            import io, zipfile
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                for f in sorted(self.deck.rglob("*")):
                    if f.is_file() and not any(part.startswith(".") for part in f.relative_to(self.deck).parts):
                        z.write(f, Path(self.deck.name) / f.relative_to(self.deck))
            data = buf.getvalue()
            self.send_response(200); self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", f'attachment; filename="{self.deck.name}.zip"'); self.send_header("Content-Length", str(len(data))); self.end_headers()
            return self.wfile.write(data)
        if path == "/api/localfonts":
            return self.send_json([{"name": f.stem.replace("-", " ").replace("_", " "), "path": str(f)} for f in local_fonts()])
        if path == "/api/localfont":   # the file itself, for the font menu's preview
            f = Path(parse_qs(urlparse(self.path).query).get("path", [""])[0])
            if f not in local_fonts():
                return self.send_error(404)
            data = f.read_bytes()
            self.send_response(200); self.send_header("Content-Type", "font/" + f.suffix[1:].lower()); self.send_header("Content-Length", str(len(data))); self.end_headers()
            return self.wfile.write(data)
        self.send_error(404)

    def events(self):
        """Server-sent events: pushes deck.html's mtime whenever it changes on disk."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        last = None
        try:
            while True:
                m = self.mtime()
                if m != last:
                    self.wfile.write(f"data: {m}\n\n".encode())
                    self.wfile.flush()
                    last = m
                time.sleep(0.4)
        except (BrokenPipeError, ConnectionResetError, FileNotFoundError):
            pass

    def store(self, data, ext):
        """Save bytes in assets/ under a content hash; returns the deck-relative path."""
        if not re.fullmatch(r"[a-z0-9]{1,5}", ext):
            ext = "png"
        name = f"{hashlib.sha1(data).hexdigest()[:12]}.{ext}"
        assets = self.deck / "assets"
        assets.mkdir(exist_ok=True)
        if not (assets / name).exists():
            (assets / name).write_bytes(data)
        return f"assets/{name}"

    def do_POST(self):
        if not self.allowed(post=True): return
        url = urlparse(self.path)

        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if url.path in ("/api/figure/refresh", "/api/figure/trust"):   # Refresh (a figure's command run again), Trust (its command, on this machine)
            req = json.loads(body or b"{}"); fid = req.get("id", ""); cmd = dict(figures(self.deck)).get(fid)
            if not cmd: return self.send_json({"error": "no figure with a command by that id"}, 404)
            if url.path == "/api/figure/trust": trust(self.deck, cmd); return self.send_json({"ok": True})
            st = trust_state(self.deck, cmd)
            if st != "trusted": return self.send_json({"untrusted": True, "changed": st == "changed", "cmd": cmd})   # the editor asks, then trusts it
            r = refresh_figure(self.deck, fid)
            return self.send_json({"ok": r.returncode == 0, "log": (r.stdout + r.stderr).strip()[-1200:]}, 200 if r.returncode == 0 else 500)
        if url.path == "/api/save":
            req = json.loads(body)
            tmp = self.deck_file.with_suffix(".tmp")
            with Handler.writing:   # the version check and the write as one: two editors saving at the same moment can't both pass it
                if req.get("mtime") != self.mtime():
                    return self.send_json({"error": "conflict", "mtime": self.mtime()}, 409)
                Handler.written = req["html"]
                tmp.write_text(req["html"])
                tmp.replace(self.deck_file)
            if is_draft(self.deck):   # untitled: kept out of the library until it is named, then moved in
                if not (dst := name_draft(self.deck)): return self.send_json({"mtime": self.mtime(), "draft": True})
                open_deck(dst); schedule_commit(dst)
                return self.send_json({"mtime": self.mtime(), "moved": str(dst)})

            schedule_commit(self.deck)
            return self.send_json({"mtime": self.mtime()})
        if url.path == "/api/selection":
            Handler.selection = {**json.loads(body or b"{}"), "deck": str(self.deck), "time": time.time()}
            return self.send_json({"ok": True})
        if url.path == "/api/discard":   # leave an untitled draft without keeping it: back to the most recent deck
            if is_draft(self.deck):
                gone = self.deck; open_deck(default_deck()); shutil.rmtree(gone, ignore_errors=True)
            return self.send_json({"ok": True})
        if url.path == "/api/importpptx":   # File → Import slides / a dropped .pptx: pptx_import.py (python-pptx via uv)
            import subprocess, tempfile
            src = Path(tempfile.mkdtemp()) / "in.pptx"
            src.write_bytes(body)
            r = subprocess.run([*pptx_cmd("pptx_import.py"), str(src), str(self.deck / "assets")], capture_output=True, text=True, timeout=300)
            if r.returncode:
                return self.send_json({"error": (r.stderr or "import failed").strip().splitlines()[-1]})
            return self.send_json(json.loads(r.stdout))
        if url.path == "/api/importgslides":   # File → Import from Google Slides: the Slides API (signed in once with `glideshow import-google --login`)
            from . import gslides
            req = json.loads(body or b"{}")
            try:
                if req.get("file"):   # a saved presentations.get response (tests; `glideshow import-google` keeps one under source/)
                    pres = json.loads(Path(req["file"]).expanduser().read_text())
                else:
                    pres = gslides.fetch(gslides.presentation_id(req.get("url", "")))
                conv = gslides.Converter(pres, self.deck)
                sections = conv.convert()
                conv.fonts = {f for f in conv.fonts if f in gslides.Converter._google_fonts()}
                return self.send_json({"slides": sections, "layouts": conv.layout_divs(), "title": pres.get("title", ""), "fonts": sorted(conv.fonts), "log": conv.log})
            except SystemExit as e:   # not signed in / no client / API errors come this way, with the steps to take
                return self.send_json({"error": str(e)})
            except (OSError, ValueError, KeyError) as e:
                return self.send_json({"error": f"import failed: {e}"})
        if url.path == "/api/name":   # Version history → Name this version (an annotated tag; an empty name removes it)
            req = json.loads(body or b"{}")
            rev, name = req.get("rev", ""), req.get("name", "").strip()[:100]
            if not re.fullmatch(r"[0-9a-f]{7,40}", rev):
                return self.send_json({"error": "bad version"})
            tag = f"slides/{rev[:12]}"
            git(self.deck, "tag", "-d", tag)
            if name:
                r = git(self.deck, "tag", "-a", tag, "-m", name, rev)
                if r.returncode:
                    return self.send_json({"error": r.stderr.strip()})
            return self.send_json({"ok": True})
        if url.path == "/api/restore":   # Version history → Restore this version: that deck.html (and its pictures) back, committed
            rev = json.loads(body or b"{}").get("rev", "")
            if not re.fullmatch(r"[0-9a-f]{7,40}", rev):
                return self.send_json({"error": "bad version"})
            html = git(self.deck, "show", f"{rev}:./deck.html").stdout
            if not html:
                return self.send_json({"error": "no such version"})
            git(self.deck, "checkout", rev, "--", "./assets")   # pictures that version used (newer ones stay)
            with Handler.writing:
                Handler.written = html
                self.deck_file.write_text(html)
            when = git(self.deck, "log", "-1", "--format=%cd", "--date=format:%b %-d, %H:%M", rev).stdout.strip()
            paths = ["deck.html"] + (["assets"] if any(f.is_file() for f in (self.deck / "assets").rglob("*")) else [])
            git(self.deck, "add", "--", *paths); git(self.deck, "commit", "-q", "-m", f"deck: restore the version of {when}", "--", *paths)
            return self.send_json({"mtime": self.mtime()})
        if url.path == "/api/quit":   # home screen ⋮ → Quit server: a clean exit, which `glideshow install`'s launchd agent doesn't restart
            self.send_json({"ok": True})
            return threading.Thread(target=self.server.shutdown, daemon=True).start()
        if url.path == "/api/deckop":   # home-screen card menu: duplicate / rename / delete (to the Trash) / reveal in Finder
            req = json.loads(body or b"{}")
            deck = next((Path(d["path"]) for d in all_decks(self.deck) if d["path"] == req.get("path")), None)
            if deck is None:
                return self.send_json({"error": "unknown deck"})
            op = req.get("op")
            if op == "rename":
                set_title(deck, req.get("title", "").strip() or deck.name)
            elif op == "duplicate":
                dst, n = deck.parent / f"{deck.name}-copy", 2
                while dst.exists(): dst, n = deck.parent / f"{deck.name}-copy-{n}", n + 1
                shutil.copytree(deck, dst, ignore=shutil.ignore_patterns(".*"))
                set_title(dst, "Copy of " + deck_title(deck)); remember(dst)
            elif op == "delete":
                if deck == self.deck:   # the open deck: serve the next most recent one (or a new blank) first
                    others = [Path(d["path"]) for d in all_decks(self.deck) if Path(d["path"]) != deck]
                    open_deck(others[0] if others else new_draft())
                publish.drop(deck); trash(deck); forget(deck); commit_library(HOME, f"library: remove {deck.name}")
            elif op == "move":   # into another library folder ('' = the top), keeping its folder name
                dst, n = in_library(req.get("folder", "")) / deck.name, 2
                if dst.parent == deck.parent: return self.send_json({"ok": True})
                while dst.exists(): dst, n = dst.parent / f"{deck.name}-{n}", n + 1
                dst.parent.mkdir(parents=True, exist_ok=True)
                deck.rename(dst); forget(deck); publish.rekey(deck, dst)
                if deck == self.deck: open_deck(dst)
                commit_library(HOME, f"library: move {deck.name} to {req.get('folder') or 'the top'}")
            elif op == "reveal":
                reveal(deck / "deck.html")
            return self.send_json({"ok": True})
        if url.path == "/api/open":   # File → New / Open / Make a copy: switch this server to another deck folder
            req = json.loads(body or b"{}")
            try:
                if req.get("copy"):
                    dst = (self.deck.parent / req["copy"]).resolve()
                    if dst.exists():
                        return self.send_json({"error": f"{dst.name} already exists"})
                    shutil.copytree(self.deck, dst, ignore=shutil.ignore_patterns(".*"))
                    deck = open_deck(dst)
                elif req.get("new"):   # New presentation: a draft, moved into this library folder once it has a title
                    in_library(req.get("folder", ""))
                    deck = open_deck(new_draft(req.get("folder", "")))
                else:
                    target = Path(req.get("path", "")).expanduser()
                    if not target.is_absolute():
                        target = self.deck.parent / target
                    deck = open_deck(target, create=bool(req.get("create")))
            except (OSError, KeyError, ValueError) as e:
                return self.send_json({"error": str(e)})
            return self.send_json({"path": str(deck)})
        if url.path == "/api/publish":   # Share: a glideshow.org link (an entry in published.json), its settings, or taking it down
            req = json.loads(body or b"{}")
            try:
                if req.get("op") == "unpublish": publish.unpublish(self.deck); return self.send_json(publish.status(self.deck))
                return self.send_json(publish.publish(self.deck, req.get("op", "publish"), req.get("access"), req.get("people"), req.get("expires"), req.get("editors")))
            except SystemExit as e:   # publish reports problems (not logged in, outside the library) this way
                return self.send_json({"error": str(e)})
            except (OSError, ValueError) as e:
                return self.send_json({"error": str(e)})
        if url.path == "/api/folder":   # home screen: make, rename or remove (only when empty) a library folder

            req = json.loads(body or b"{}")
            try:
                op, at = req.get("op"), in_library(req.get("path", ""))
                name = re.sub(r'[/\\:]+', "-", req.get("name", "")).strip()
                if op == "create":
                    if not name or name.startswith("."): return self.send_json({"error": "a folder needs a name"})
                    (at / name).mkdir(parents=True, exist_ok=False); (at / name / ".keep").touch()   # git keeps empty folders by a file
                elif op == "rename":
                    if at == HOME.resolve() or not name: return self.send_json({"error": "nothing to rename"})
                    dst = at.parent / name
                    if dst.exists(): return self.send_json({"error": f"{name} already exists"})
                    moved_current = at in self.deck.parents
                    at.rename(dst); publish.rekey(at, dst)

                    if moved_current: open_deck(dst / self.deck.relative_to(at))
                elif op == "delete":
                    if at == HOME.resolve() or any(p.name != ".keep" for p in at.iterdir()): return self.send_json({"error": "only an empty folder can be removed"})
                    for p in at.iterdir(): p.unlink()
                    at.rmdir()
                else:
                    return self.send_json({"error": "unknown folder op"})
            except (OSError, ValueError) as e:
                return self.send_json({"error": str(e)})
            commit_library(HOME, " ".join(filter(None, ["library:", op, "folder", req.get("path"), name])))

            return self.send_json({"ok": True})

        if url.path == "/api/comments":
            me = git(HOME, "config", "user.name").stdout.strip() or "You"   # the owner, as git knows them
            r = comments.change(self.deck, json.loads(body or b"{}"), {"n": me, "e": "", "owner": True})
            schedule_commit(self.deck)
            return self.send_json(r)
        if url.path == "/api/font":   # a font file (dropped, or copied from the computer's fonts) into assets/fonts/
            q = parse_qs(url.query)
            if "path" in q:
                f = Path(q["path"][0])
                if f not in local_fonts():
                    return self.send_json({"error": "not a font on this computer"})
                body, name = f.read_bytes(), f.name
            else:
                name = q.get("name", [""])[0]
            stem, ext = Path(name).stem, Path(name).suffix.lower()
            if ext not in FONT_EXTS or not body:
                return self.send_json({"error": "not a font file"})
            stem = re.sub(r"[^A-Za-z0-9 _-]", "", stem).strip().replace(" ", "-") or hashlib.sha1(body).hexdigest()[:12]
            (self.deck / "assets" / "fonts").mkdir(parents=True, exist_ok=True)
            (self.deck / "assets" / "fonts" / (stem + ext)).write_bytes(body)
            return self.send_json({"src": f"assets/fonts/{stem}{ext}", "family": stem.replace("-", " ").replace("_", " ")})
        if url.path == "/api/upload":
            ext = parse_qs(url.query).get("ext", ["png"])[0].lower()
            return self.send_json({"src": self.store(body, ext)})
        if url.path == "/api/fetch":   # a pasted image URL: download it into assets/ so the deck stays self-contained
            src = json.loads(body or b"{}").get("url", "")
            if not re.match(r"https?://", src):
                return self.send_json({"error": "not a web address"})
            try:
                with urllib.request.urlopen(urllib.request.Request(src, headers={"User-Agent": "glideshow"}), timeout=15) as r:
                    kind = r.headers.get_content_type()
                    data = r.read(MAX_FETCH + 1)
            except Exception as e:
                return self.send_json({"error": str(e)})
            if not kind.startswith("image/") or len(data) > MAX_FETCH:
                return self.send_json({"error": "not an image" if not kind.startswith("image/") else "too large"})   # an ordinary answer: the editor pastes the text
            ext = {"image/jpeg": "jpg", "image/svg+xml": "svg"}.get(kind, kind.split("/")[1])
            return self.send_json({"src": self.store(data, ext)})
        self.send_error(404)



def open_deck(deck: Path, create: bool = False) -> Path:
    deck = deck.expanduser().resolve()
    if not (deck / "deck.html").exists():
        if not create:
            raise FileNotFoundError(f"no deck.html in {deck}")
        fresh = not deck.exists()
        try:
            (deck / "assets").mkdir(parents=True, exist_ok=True)
            new_deck(deck / "deck.html")
        except Exception:
            if fresh: shutil.rmtree(deck, ignore_errors=True)   # no half-made deck folder left behind
            raise
    Handler.deck = deck
    try: Handler.written = (deck / "deck.html").read_text()
    except OSError: Handler.written = None
    remember(deck)
    return deck


def default_deck() -> Path:
    """No deck named: the most recently opened one, else the newest in the library, else a new draft."""
    recent = [Path(r) for r in recent_decks()]
    found = recent or [Path(d["path"]) for d in all_decks(HOME / ".none")]
    return found[0] if found else new_draft()   # an empty library: a draft, kept out of ~/decks until it is named


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("deck", nargs="?", help="deck folder (created if missing); default: the most recent deck")
    ap.add_argument("--port", type=int, help=f"serve on this port and skip the one-server check (default {DEFAULT_PORT}, or the next free one)")
    ap.add_argument("--no-open", action="store_true", help="don't open a browser")
    ap.add_argument("--no-git", action="store_true", help="don't commit saves even if the deck is in a git repo")
    ap.add_argument("--no-push", action="store_true", help="commit saves but don't push them to the repo's origin remote")
    ap.add_argument("--init", action="store_true", help="make the deck folder a git repo (saves are then committed) and exit")
    ap.add_argument("--add-image", metavar="FILE", help="copy a picture into the deck and place it (fitted to the body area) on --slide N (default: the last slide), then exit")
    ap.add_argument("--slide", type=int, help="slide number for --add-image (1-based)")
    ap.add_argument("--build", metavar="OUT_DIR", help="write a self-contained copy (reveal.js vendored, Google Fonts embedded) and exit")
    ap.add_argument("--exit-with", type=int, metavar="PID", help="shut down when process PID is gone (tests: no server outlives its test run)")
    args = ap.parse_args()

    deck = Path(args.deck).expanduser().resolve() if args.deck else default_deck().resolve()
    if args.build:
        return build(deck, Path(args.build).expanduser().resolve())
    if args.add_image:
        return print(f"Added {add_image(deck, Path(args.add_image).expanduser(), args.slide)} to {deck / 'deck.html'}")
    GIT["on"] = not args.no_git
    GIT["push"] = not args.no_push
    if args.init:
        open_deck(deck, create=True)
        return init_repo(deck)
    shared = args.port is None   # the one background server: reuse it, or replace one running old code
    if shared and (other := live()):
        if other["version"] == code_version() or not same_install(other):   # another install's server is left alone

            post(other["url"], "api/open", {"path": str(deck), "create": True})
            print(f"Already running at {other['url']}; switched it to {deck.name}")
            if not args.no_open: webbrowser.open(other["url"] + "edit")
            return
        try: post(other["url"], "api/quit", {})
        except Exception: pass
        time.sleep(0.5)
    open_deck(deck, create=True)
    # The shared server walks up past a port someone else holds; an explicit --port must be that port, so a caller (a test)
    # never ends up talking to an older server still sitting on it.
    start = args.port or DEFAULT_PORT
    for port in range(start, start + (1 if args.port else 20)):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            continue
    else:
        raise SystemExit(f"port {start} is in use (another server, perhaps an old one: see /api/ping)" if args.port else f"no free port between {start} and {start + 19}")
    server.daemon_threads = True
    if shared:
        record(port); atexit.register(forget_me)
    url = f"http://localhost:{port}/"
    print(f"Editing {deck / 'deck.html'}\n  editor: {url}edit\n  home:   {url}\n  viewer: {url}deck/deck.html", flush=True)
    if not args.no_open:
        webbrowser.open(url + "edit")
    # When the server's own code changes (an update, a git pull), restart in place on the same port and deck.
    version, restart = code_version(), threading.Event()
    def watch():
        while not restart.wait(1):
            if code_version() != version:
                restart.set(); server.shutdown()
    threading.Thread(target=watch, daemon=True).start()
    def figure_watch():   # an approved figure is made again when a file its command names changes; a changed script waits for the editor to ask
        seen: dict = {}
        while not restart.wait(2):
            try:
                deck = Handler.deck
                for fid, cmd in figures(deck):   # every figure's files are followed from the start; only an approved one acts
                    if (str(deck), fid) not in PENDING and trust_state(deck, cmd) == "changed":   # its code changed (even before its files' times were first seen)
                        PENDING[(str(deck), fid)] = code_hash(deck, cmd)
                    for f in watched_files(deck, cmd):
                        key, t = (str(deck), fid, str(f)), f.stat().st_mtime
                        if key in seen and seen[key] != t:
                            seen[key] = t; st = trust_state(deck, cmd)
                            if st == "trusted": refresh_figure(deck, fid)
                            elif st == "changed": PENDING[(str(deck), fid)] = code_hash(deck, cmd)
                            break
                        seen[key] = t
            except Exception: pass
    threading.Thread(target=figure_watch, daemon=True).start()
    def outside():   # deck.html changed on disk, not by this server (an agent, a text editor): its own version in git
        while not restart.wait(1):
            with Handler.writing:
                deck = Handler.deck
                try: text = (deck / "deck.html").read_text()
                except OSError: continue
                if Handler.written is None or text == Handler.written: continue
                saved, Handler.written = Handler.written, text
            if GIT["on"]: commit_outside(deck, saved)
    threading.Thread(target=outside, daemon=True).start()
    def trade():   # the library repo and origin: edits made online come in every 30 s; edits made here go out within seconds
        busy = lambda t: t and t.is_alive()   # a save, or an outside edit to the open deck, waiting for its own commit
        every, quiet = float(os.environ.get("GLIDESHOW_SYNC_EVERY") or 30), float(os.environ.get("GLIDESHOW_OUTSIDE_DELAY") or 3)
        last_sync, seen = time.time(), None
        def in_deck(f: Path) -> bool:   # inside a deck's folder (an agent's edit), not the library's own files (published.json, …)
            return any((d / "deck.html").is_file() for d in [f.parent, *f.parent.parents] if d != HOME and HOME in d.parents)
        def changed():   # what is changed in the library's decks, and when each file last was (a run of writes keeps it moving)
            out = []
            for line in git(HOME, "status", "--porcelain").stdout.splitlines():
                f = HOME / line[3:].split(" -> ")[-1].strip('"')
                if not in_deck(f): return []   # something else changed too (a command of glideshow's own writing): the 30 s turn
                try: out.append((str(f), f.stat().st_mtime_ns))
                except OSError: out.append((str(f), 0))
            return out
        # An agent editing a deck that isn't open here: committed once its files have been still for `quiet` seconds
        # (as the open deck's outside edits are, commit_outside) and pushed at once, rather than at the next 30 s turn,
        # so glideshow.org (its push webhook) shows it within seconds (2026-10-22: agent edits arrived late or in bursts).
        while not restart.wait(quiet):
            if busy(GIT["timer"]) or busy(GIT.get("outside")): continue
            now = changed()
            settled = bool(now) and now == seen
            seen = now
            if settled and commit_outside_library(HOME, Handler.deck / "deck.html"): sync(HOME); last_sync = time.time(); seen = None
            elif time.time() - last_sync >= every:
                commit_outside_library(HOME, Handler.deck / "deck.html"); sync(HOME); last_sync = time.time(); seen = None   # edits to other decks first, or syncing would wait on them
    if GIT["on"] and HOME.is_dir(): threading.Thread(target=trade, daemon=True).start()
    if args.exit_with:   # stop when the process that started us is gone, even if it was killed outright
        def orphaned():
            while True:
                time.sleep(1)
                try: os.kill(args.exit_with, 0)
                except ProcessLookupError: return server.shutdown()
                except PermissionError: pass
        threading.Thread(target=orphaned, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        restart.clear()
    server.server_close()
    if restart.is_set():
        if GIT["timer"]: GIT["timer"].cancel(); commit_now(Handler.deck)   # don't lose a pending commit
        forget_me()
        flags = [f for f, on in (("--no-git", args.no_git), ("--no-push", args.no_push)) if on] + (["--exit-with", str(args.exit_with)] if args.exit_with else [])

        os.execv(sys.executable, [sys.executable, "-m", "glideshow.server", str(Handler.deck), "--no-open", *flags, *(["--port", str(port)] if not shared else [])])


if __name__ == "__main__":
    main()
