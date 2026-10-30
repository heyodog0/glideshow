"""The `glideshow` command.

    glideshow                         open the home screen (starting the server if needed)
    glideshow new "Lab meeting"       a new deck in $GLIDESHOW_HOME (default ~/decks), opened in the editor
                                      (--no-open: only made, its folder printed; the editor isn't touched)
    glideshow find <words>            the folder of the deck that best matches (nothing is opened)
    glideshow <name>                  open the deck whose folder name best matches <name> (in any folder)
    glideshow build <name> <out>      a self-contained copy that presents offline
    glideshow serve [DECK] [...]      run the server in the foreground (--port N, --build OUT, --init, --add-image FILE)
    glideshow url                     print the running server's address (starting it if needed)
    glideshow selection [--json]      what the open editor shows: the deck, the slide on show, the selected boxes and their text
    glideshow render [deck] [N ...]   the deck's slides as 960 × 540 PNGs (default: the deck open in the editor; -o DIR; --full:
                                      1920 × 1080), one path per line, then any problems (overflow, cut-off code, off-slide,
                                      overlaps, small text, inside figures, notes left; --json); --sheet: nine slides to a picture
                                      instead; --morph: each Morph step's pairs and a picture halfway through it
    glideshow check [deck] [N ...]    only the problems, no pictures (exit 1 if any)
    glideshow movie <deck> OUT        play the deck into OUT (.mp4, .gif or .webm) as a self-playing show: --from N --to M,
                                      --slide 5 --build 2 (seconds before the next slide / build), --size 1280x720, --fps 30
    glideshow docs [reference]        for an agent: the guide and recipes (reference: the full deck format)
    glideshow layout [NAME]           the layouts' exact placeholder boxes; with NAME, a slide in that layout to paste
    glideshow slides <deck> [N ...]   only the deck's <section>s (no inlined CSS / JS), each with its line in deck.html;
                                      --outline: one line per slide (its layout, title, boxes' ids and first words)
    glideshow put <deck> N            replace slide N with the <section>s on stdin (--after N inserts, --delete N removes, --all replaces every slide)
    glideshow figure add|refresh|size a picture placed or replaced in place, remembering the command that made it (see
                                      `glideshow figure`); refresh re-runs those commands; size gives matplotlib settings
    glideshow comments <deck>         the open comments, each on the slide it's on now (--all, --json)
    glideshow stop                    stop the background server
    glideshow skill                   teach Claude Code to make decks here: links the Glideshow skill into ~/.claude/skills
    glideshow install                 start the server at login (macOS, Linux, Windows), and link the skill (glideshow skill)
    glideshow init-remote OWNER/REPO  back the library up to a new private GitHub repo (needs `gh`); every save is pushed
    glideshow publish <name>          share the deck at an unguessable glideshow.org link (the library on GitHub, with the Glideshow app on it)
    glideshow unpublish <name>        take it down again; `glideshow published` lists the links
    glideshow import-google <url>     a Google Slides deck as a new deck, through the Slides API (--login once; --report scores it)

One server serves every deck, in the background, on port 47800 (or the next free one; GLIDESHOW_PORT overrides). It is
recorded in ~/.glideshow/server.json (server-PORT.json with GLIDESHOW_PORT set; GLIDESHOW_CACHE moves the whole folder),
restarts itself when its code changes, and a second one is never started. A separate library for tests:
GLIDESHOW_HOME=/tmp/x/decks GLIDESHOW_CACHE=/tmp/x/cache GLIDESHOW_PORT=48900 glideshow …
--no-open skips the browser and prints the address instead (`glideshow url` prints it too)."""
import datetime, json, os, re, subprocess, sys, time, webbrowser
from pathlib import Path

from .service import CACHE, DEFAULT_PORT, code_version, live, post, same_install

HERE = Path(__file__).resolve().parent
HOME = Path(os.environ.get("GLIDESHOW_HOME") or Path.home() / "decks").expanduser()
URL = f"http://localhost:{DEFAULT_PORT}/"   # updated to the live server's address by running()


def slug(title: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or "deck"
    return f"{s}-{datetime.date.today().isoformat()}"


def decks() -> list:
    """Every deck in the library, in any folder, most recently edited first."""
    from .decks import walk_library
    return sorted(walk_library()[0], key=lambda d: -(d / "deck.html").stat().st_mtime)


def match(name: str) -> Path:
    """Exact folder, then substring, then every word (in any order), then letters in order (fuzzy); spaces, dashes and
    underscores are alike ("lab meeting" finds lab-meeting-2026-10-15); the most recently edited wins ties."""
    norm = lambda t: re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")
    q, ds = norm(name), decks()
    words = [w for w in q.split("-") if w]
    for test in (lambda d: norm(d.name) == q, lambda d: q in norm(d.name), lambda d: words and all(w in norm(d.name) for w in words),
                 lambda d: re.search(".*?".join(map(re.escape, q.replace("-", ""))), norm(d.name).replace("-", ""))):
        hit = [d for d in ds if test(d)]
        if hit: return hit[0]
    raise SystemExit(f"no deck in {HOME} matches {name!r}")


def running() -> bool:
    """Is our one server up, on the current code? A server running older code is told to quit (a fresh one replaces it)."""
    global URL
    s = live()
    if s and not same_install(s):
        print(f"(the running server is another install of slides: {s.get('install')})", file=sys.stderr)
    elif s and s["version"] != code_version():

        try: post(s["url"], "api/quit", {})
        except Exception: pass
        time.sleep(0.5); return False
    if s: URL = s["url"]
    return bool(s)


def start(deck: Path | None = None):
    """Start the background server (detached, logging to ~/.glideshow/server.log) and wait until it answers."""
    log = open(CACHE.mkdir(parents=True, exist_ok=True) or CACHE / "server.log", "a")
    subprocess.Popen([sys.executable, "-m", "glideshow.server", *([str(deck)] if deck else []), "--no-open"],
                     stdout=log, stderr=log, stdin=subprocess.DEVNULL, start_new_session=True)
    for _ in range(600):   # (a cold first start can take a while: imports, a fresh .pyc cache)
        if running(): return
        time.sleep(0.1)
    raise SystemExit(f"the slides server did not start; see {CACHE / 'server.log'}")


def serve(deck: Path, open_browser: bool):
    """Open the deck in the editor; the terminal shows its address only when no browser opens (--no-open)."""
    if running():   # switch the running server to this deck
        err = post(URL, "api/open", {"path": str(deck), "create": True}).get("error")
        if err: raise SystemExit(err)
    else:
        start(deck)
    if open_browser: webbrowser.open(URL + "edit")
    else: print(f"Editing {deck} at {URL}edit")


def new(title: str) -> Path:
    HOME.mkdir(parents=True, exist_ok=True)
    if not (HOME / ".git").exists() and subprocess.run(["git", "-C", str(HOME), "rev-parse"], capture_output=True).returncode:
        subprocess.run(["git", "init", "-q", str(HOME)], check=False)   # decks are versioned from the first one
        if not (HOME / ".gitignore").exists(): (HOME / ".gitignore").write_text(IGNORE)
    deck, n = HOME / slug(title), 2
    while deck.exists(): deck, n = HOME / f"{slug(title)}-{n}", n + 1
    (deck / "assets").mkdir(parents=True)
    from .decks import new_deck   # the template with base.css / shapes.js / present.js filled in, + AGENTS.md
    new_deck(deck / "deck.html", title)
    return deck


BIG = 50 * 1024 * 1024   # GitHub warns above 50 MB and refuses 100 MB
# `**/` so the rules still hold once decks are moved into folders (a plain `*/refs/` matches one level only)
IGNORE = ".DS_Store\n*.tmp\n# regenerable comparison renders (gslides2deck refs, test/snap.py shots), at any folder depth\n**/refs/\n**/refs-svg/\n**/source/snap*/\n**/source/cmp/\n"



def init_remote(repo: str):
    """The whole library ($GLIDESHOW_HOME) as one git repo with a private GitHub origin; the server pushes after each commit."""
    git = lambda *a, **k: subprocess.run(["git", "-C", str(HOME), *a], capture_output=True, text=True, **k)
    HOME.mkdir(parents=True, exist_ok=True)
    if git("rev-parse", "--is-inside-work-tree").stdout.strip() != "true":
        git("init", "-q", "-b", "main")
    ig = HOME / ".gitignore"
    big = sorted({f"**/{p.name}" for p in HOME.rglob("*") if p.is_file() and ".git" not in p.parts and p.stat().st_size > BIG})   # by name: still ignored after a move

    text = ig.read_text() if ig.exists() else IGNORE
    new = [b for b in big if b not in text.split("\n")]
    if new: text += "# over 50 MB: kept on this Mac only\n" + "".join(b + "\n" for b in new)
    ig.write_text(text)
    git("add", "-A")
    if git("diff", "--cached", "--quiet").returncode:
        git("commit", "-q", "-m", "library: back up decks")
    if git("remote", "get-url", "origin").returncode == 0:
        print(f"origin is already {git('remote', 'get-url', 'origin').stdout.strip()}; pushing")
        r = git("push", "-u", "origin", "HEAD")
    elif subprocess.run(["gh", "repo", "view", repo], capture_output=True).returncode == 0:
        url = subprocess.run(["gh", "repo", "view", repo, "--json", "sshUrl", "-q", ".sshUrl"], capture_output=True, text=True).stdout.strip()
        git("remote", "add", "origin", url); r = git("push", "-u", "origin", "HEAD")
    else:
        r = subprocess.run(["gh", "repo", "create", repo, "--private", "--source", str(HOME), "--remote", "origin", "--push",
                            "--description", "Slide decks (backed up by the slides editor)"], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"push failed: {(r.stderr or r.stdout).strip()[:400]}")
    print(f"{HOME} is backed up to {repo} (private); the server pushes after every commit (--no-push to stop)"
          + (f"; not uploaded (over 50 MB): {', '.join(big)}" if big else ""))


SKILL = (HERE / "skills" if (HERE / "skills").is_dir() else HERE.parent / "skills") / "glideshow"


def link_skill():
    """The Glideshow skill (skills/glideshow/SKILL.md) in ~/.claude/skills, so every Claude Code session on this computer, in
    any folder, knows how to make and check decks here. A link, so it follows updates; a real folder there is left alone."""
    dst = Path.home() / ".claude" / "skills" / "glideshow"
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.is_symlink(): dst.unlink()
    if dst.exists(): return print(f"{dst} exists and isn't a link; left as it is (the skill is at {SKILL})")
    dst.symlink_to(SKILL, target_is_directory=True)
    print(f"Claude Code now knows Glideshow: {dst} -> {SKILL}")


def render(args: list[str], check: bool = False):
    """`glideshow render` (the slides as PNGs, then any problems) and `glideshow check` (only the problems; exit 1 if
    any) through glideshow/render.py, a uv script that brings Playwright with it."""
    out = None
    if "-o" in args: i = args.index("-o"); out = Path(args[i + 1]).expanduser(); args = args[:i] + args[i + 2:]
    flags = [a for a in args if a in ("--json", "--morph", "--full", "--sheet")] + (["--check"] if check else [])
    args = [a for a in args if not a.startswith("--")]
    is_num = lambda a: re.fullmatch(r"\d+(\.\d+)?", a)
    nums, names = [a for a in args if is_num(a)], [a for a in args if not is_num(a)]
    if names: deck = Path(names[0]).expanduser() if (Path(names[0]).expanduser() / "deck.html").exists() else match(names[0])
    else:
        s = live()
        if not s: raise SystemExit("Name a deck (glideshow render <deck> [N ...]); no editor is open to take it from.")
        deck = Path(s["deck"])
    from .agent import ensure_server, scan, slide_number
    ensure_server(deck)   # the edits being checked are kept as versions by it
    text = (deck / "deck.html").read_text()
    nums = [str(slide_number(text, a)) for a in nums]   # the deck's own numbers (8.1) as the file's
    os.environ["GLIDESHOW_STRUCTURE"] = json.dumps(scan(text)[1])   # what render.py can't see: the file's own structure
    out = out or CACHE / "renders" / deck.name
    try: r = subprocess.run(["uv", "run", "--quiet", str(HERE / "render.py"), str(deck.resolve()), str(out), *nums, *flags])
    except FileNotFoundError: raise SystemExit("glideshow render needs uv (https://docs.astral.sh/uv/), which brings Playwright with it")
    raise SystemExit(r.returncode)


def install():
    """Start the server at login: a launchd agent (macOS), a systemd user service (Linux), the Startup folder (Windows)."""
    link_skill()
    py, log = sys.executable, CACHE / "server.log"
    CACHE.mkdir(parents=True, exist_ok=True)
    if sys.platform == "darwin":
        f = Path.home() / "Library" / "LaunchAgents" / "com.glideshow.server.plist"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.glideshow.server</string>
  <key>ProgramArguments</key><array><string>{py}</string><string>-m</string><string>glideshow.server</string><string>--no-open</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>{log}</string><key>StandardErrorPath</key><string>{log}</string>
</dict></plist>
""")
        subprocess.run(["launchctl", "unload", str(f)], capture_output=True)
        subprocess.run(["launchctl", "load", str(f)], check=False)
    elif sys.platform.startswith("linux"):
        f = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "systemd" / "user" / "glideshow.service"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(f"[Unit]\nDescription=Glideshow editor server\n\n[Service]\nExecStart={py} -m glideshow.server --no-open\nRestart=on-failure\n\n[Install]\nWantedBy=default.target\n")
        subprocess.run(["systemctl", "--user", "daemon-reload"], check=False)
        subprocess.run(["systemctl", "--user", "enable", "--now", "glideshow.service"], check=False)
    elif sys.platform == "win32":
        f = Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup" / "slides-server.cmd"
        f.write_text(f'@start "" /min "{Path(py).with_name("pythonw.exe")}" -m glideshow.server --no-open\r\n')
    else:
        raise SystemExit("glideshow install knows macOS, Linux and Windows")
    print(f"The Glideshow server now starts at login ({f}). `glideshow` opens it.")


def main(argv):
    open_browser = "--no-open" not in argv
    args = [a for a in argv if a != "--no-open"]
    if not args:   # the home screen, starting the server if needed
        if not running(): start()
        if open_browser: webbrowser.open(URL)
        else: print(URL)   # the address only when no browser opens
        return
    cmd, rest = args[0], args[1:]
    if cmd in ("-h", "--help", "help") or any(a in ("-h", "--help") for a in rest): return print(__doc__)   # `glideshow new --help` too: usage, not a deck called "--help"
    if cmd == "url":   # the running server's address, starting it if needed (the desktop app asks this)
        if not running(): start()
        return print(URL)
    if cmd == "selection":   # for an agent working beside the editor: what "this" means
        s = live()
        import urllib.request
        if not s:
            if "--json" in rest: print(json.dumps({"slide": None, "boxes": [], "error": "no server, so no editor is open"}))
            raise SystemExit(1 if "--json" in rest else "No editor is open (the Glideshow server isn't running), so there is no selection: ask the user which slide they mean.")
        sel = json.load(urllib.request.urlopen(s["url"] + "api/selection", timeout=5))
        age = round(time.time() - sel["time"]) if sel.get("time") else None
        if age is not None: sel["age"] = age
        if "--json" in rest:
            print(json.dumps(sel, indent=2))
            if not sel.get("slide"): raise SystemExit(1)
            return
        if not sel.get("slide"): raise SystemExit(f"{sel['file']}\nNo editor window has reported what it shows (the server is running, but no editor is open in a browser): ask the user which slide they mean.")
        from .agent import sections
        n_file = len(sections(Path(sel["file"]).read_text())) if Path(sel["file"]).exists() else None
        if n_file and sel.get("slides") and n_file != sel["slides"]: print(f"(the editor reported {sel['slides']} slides but deck.html now has {n_file}: it may not have reloaded yet, or the report is old)")
        lines = [sel["file"], f"slide {sel['slide']} of {sel.get('slides', '?')}" + (f"  (reveal #/{sel['h']}/{sel['v']})" if sel.get("v") else "")
                 + (f"  (reported {age} s ago{'; the editor may be closed' if age > 600 else ''})" if age is not None else "")]
        for b in sel.get("boxes", []):
            lines.append(f"  box id={b['id']}  ({b['shape']}, box {b['index'] + 1} on the slide, at {b['x']},{b['y']} size {b['w']}×{b['h']})" + (f": {b['text'][:120]}" if b.get("text") else ""))
        if not sel.get("boxes"): lines.append("  nothing selected (the whole slide)")
        if sel.get("selectedText"): lines.append(f"  selected text: {sel['selectedText'][:200]!r}")
        return print("\n".join(lines))
    if cmd == "serve":   # the server itself, in the foreground: `glideshow serve DECK [--port N] [--build OUT] [--init] [--add-image F]`
        from .server import main as server_main
        sys.argv = ["glideshow serve", *argv[1:]]; return server_main()
    if cmd == "new":
        if rest and rest[0].startswith("-"): raise SystemExit('usage: glideshow new "<title>" [--no-open]   (a title can\'t start with "-")')
        deck = new(" ".join(rest) or "Untitled")
        if not open_browser:   # an agent's: made and printed; the editor (and what it shows) is left alone
            if not running(): start(deck)   # the background server, so every edit to the deck becomes a version
            return print(deck)
        return serve(deck, open_browser)
    if cmd in ("layout", "slides", "put", "figure", "find", "stop", "comments"):
        from . import agent
        if cmd == "stop": return agent.stop_cmd()
        return {"layout": agent.layout_cmd, "slides": agent.slides_cmd, "put": agent.put_cmd, "figure": agent.figure_cmd, "find": agent.find_cmd, "comments": agent.comments_cmd}[cmd](rest)

    if cmd == "build":
        if len(rest) != 2: raise SystemExit("usage: glideshow build <name> <out>")
        return subprocess.run([sys.executable, "-m", "glideshow.server", str(match(rest[0])), "--build", rest[1]], check=True)
    if cmd == "install": return install()
    if cmd == "skill": return link_skill()
    if cmd in ("render", "check"): return render(rest, check=cmd == "check")
    if cmd == "movie":   # Keynote's Export → Movie / Animated GIF, through glideshow/movie.py (a uv script with Playwright)
        if len(rest) < 2: raise SystemExit("usage: glideshow movie <deck> OUT.mp4|.gif|.webm [--from N] [--to M] [--slide S] [--build S] [--size WxH] [--fps F]")
        deck = Path(rest[0]).expanduser() if (Path(rest[0]).expanduser() / "deck.html").exists() else match(rest[0])
        return subprocess.run(["uv", "run", "--quiet", str(HERE / "movie.py"), str(deck.resolve()), str(Path(rest[1]).expanduser()), *rest[2:]]).returncode
    if cmd == "docs":   # the guide and recipes; `docs reference` the format reference (AGENTS.md beside each deck holds both)
        from .decks import docs_text
        return print(docs_text("reference" if rest[:1] == ["reference"] else "guide"))
    if cmd in ("publish", "unpublish", "published"):
        from . import publish as pub
        if cmd == "published":
            return print("\n".join(f"{v.get('url', '(not deployed)')}  {v.get('title', rel)}" for rel, v in pub.ledger().items()) or "nothing published")
        if not rest: raise SystemExit(f"usage: glideshow {cmd} <name>")
        deck = match(" ".join(rest))
        if cmd == "unpublish": pub.unpublish(deck); return print(f"{deck.name} is no longer shared")
        return print(f"{deck.name} is at {pub.publish(deck)['url']}  (anyone with this link can view it once the library is pushed; Share sets who can)")

    if cmd == "import-google":   # a Google Slides deck → a deck here (slides/gslides.py: OAuth once, then the Slides API)
        from . import gslides
        return gslides.main(rest + ([] if open_browser else ["--no-open"]))
    if cmd == "init-remote":

        if len(rest) != 1 or "/" not in rest[0]: raise SystemExit("usage: glideshow init-remote OWNER/REPO")
        return init_remote(rest[0])

    serve(match(" ".join(args)), open_browser)


def run():   # the `glideshow` entry point
    import signal
    if hasattr(signal, "SIGPIPE"): signal.signal(signal.SIGPIPE, signal.SIG_DFL)   # `glideshow … | head` just stops
    main(sys.argv[1:])


if __name__ == "__main__":
    run()

