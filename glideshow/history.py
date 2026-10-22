"""Version history in git: saves are committed (debounced) with a message naming what changed, pushed to origin when
there is one (the backup), listed for File → Version history."""

import os, shutil, re, sys, threading
from pathlib import Path

# History: when the deck lives in a git repo, saves are committed (deck.html + assets/), at most one commit per
# GLIDESHOW_GIT_DELAY seconds of quiet (30 by default), with a message naming the first changed slide and its new words.
GIT = {"on": True, "push": True, "delay": float(os.environ.get("GLIDESHOW_GIT_DELAY") or 30), "timer": None, "lock": __import__("threading").Lock()}


def git(deck: Path, *args):
    import subprocess
    return subprocess.run(["git", "-C", str(deck), *args], capture_output=True, text=True)


def commit_message(old: str, new: str) -> str:
    if not old:
        m = re.search(r"<title>(.*?)</title>", new, re.S)
        return f"deck: {(m.group(1).strip() if m else '') or 'first save'}"[:72]
    split = lambda h: [x.split(">", 1)[-1] for x in re.split(r"<section\b", h.split('class="slides"', 1)[-1])[1:]]   # each slide's inside
    words = lambda h: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", re.sub(r"<(svg|script|style)\b.*?</\1>", " ", h, flags=re.S))).split()
    a, b = split(old), split(new)
    # which slides changed, came or went, matched by content (a slide inserted early doesn't make every later one "changed")
    import difflib
    changed, added, removed, first, gone_at = [], [], 0, None, None
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
        if tag == "equal": continue
        pairs = min(i2 - i1, j2 - j1) if tag == "replace" else 0
        for k in range(pairs):
            changed.append(j1 + k); first = first if first is not None else (i1 + k, j1 + k)
        added += range(j1 + pairs, j2); removed += (i2 - i1) - pairs
        if (i2 - i1) > pairs and gone_at is None: gone_at = i1 + pairs
        if first is None and j2 > j1 + pairs: first = (None, j1 + pairs)
    if first is None: return f"slide {gone_at + 1} removed" + (f" (and {removed - 1} more)" if removed > 1 else "") if removed else "deck: edit"
    before, after = words(a[first[0]]) if first[0] is not None else [], words(b[first[1]])
    fresh = " ".join(([w for w in after if w not in before] or after)[:6]) or "edit"
    if len(changed) == 1 and not added and not removed: return f"slide {changed[0] + 1}: {fresh}"[:72]
    nums = lambda xs: ", ".join(str(x + 1) for x in xs[:4]) + (" …" if len(xs) > 4 else "")
    parts = ([f"slide{'s' if len(changed) > 1 else ''} {nums(changed)}"] if changed else []) + ([f"new slide{'s' if len(added) > 1 else ''} {nums(added)}"] if added else []) \
        + ([f"{removed} removed"] if removed else [])
    return f"{' + '.join(parts)}: {fresh}"[:72]


def commit_outside(deck: Path, saved: str):
    """deck.html was changed outside the editor. The editor's last save, if still waiting for its commit, is committed first
    (from memory, as it was), so each side's change is its own version; the outside edit is committed once the file has
    been quiet for GLIDESHOW_OUTSIDE_DELAY seconds (3), so an agent's run of writes makes one version, not dozens."""
    if GIT["timer"] and GIT["timer"].is_alive():
        GIT["timer"].cancel(); GIT["timer"] = None
        commit_text(deck, saved)
    if GIT.get("outside"): GIT["outside"].cancel()
    GIT["outside"] = threading.Timer(float(os.environ.get("GLIDESHOW_OUTSIDE_DELAY") or 3), commit_now, [deck, "outside the editor: "]); GIT["outside"].daemon = True; GIT["outside"].start()


def commit_text(deck: Path, html: str):
    """Commit this text as deck.html without touching the file on disk (git's index, not the working tree)."""
    import subprocess
    with GIT["lock"]:
        if git(deck, "rev-parse", "--is-inside-work-tree").stdout.strip() != "true": return
        top = Path(git(deck, "rev-parse", "--show-toplevel").stdout.strip())
        rel = (deck / "deck.html").resolve().relative_to(top.resolve()).as_posix()
        sha = subprocess.run(["git", "-C", str(deck), "hash-object", "-w", "--stdin"], input=html, capture_output=True, text=True).stdout.strip()
        if not sha: return
        git(top, "update-index", "--add", "--cacheinfo", f"100644,{sha},{rel}")
        git(top, "commit", "-q", "-m", commit_message(git(deck, "show", f"HEAD:{rel}").stdout, html))


def commit_now(deck: Path, label: str = ""):
    with GIT["lock"]:
        if git(deck, "rev-parse", "--is-inside-work-tree").stdout.strip() != "true":
            return
        top = Path(git(deck, "rev-parse", "--show-toplevel").stdout.strip())
        rel = (deck / "deck.html").resolve().relative_to(top.resolve()).as_posix()
        old = git(deck, "show", f"HEAD:{rel}").stdout
        paths = ["deck.html"] + (["assets"] if any(f.is_file() for f in (deck / "assets").rglob("*")) else []) + (["comments.json"] if (deck / "comments.json").exists() else [])   # git refuses an empty pathspec
        git(deck, "add", "--", *paths)
        made = git(deck, "commit", "-q", "-m", (label + commit_message(old, (deck / "deck.html").read_text()))[:72], "--", *paths).returncode == 0
    if made: sync(deck)   # backup: the commit goes to origin too



def commit_library(home: Path, message: str):
    """A library change (a deck moved, a folder made or removed): commit everything under $GLIDESHOW_HOME, then push."""
    if not GIT["on"] or git(home, "rev-parse", "--is-inside-work-tree").stdout.strip() != "true":
        return
    with GIT["lock"]:
        git(home, "add", "-A", "--", ".")
        made = git(home, "commit", "-q", "-m", message[:72]).returncode == 0
    if made: sync(home)


def commit_outside_library(home: Path, skip: Path | None = None) -> bool:
    """What changed in the library outside the editor (an agent editing a deck that isn't open, a new deck folder, a
    file deleted by hand): one commit, so syncing, which waits for a clean tree, never stalls on it. Files over 50 MB
    are left out (GitHub refuses them, which would stall the push instead). `skip` is the open deck's deck.html: its
    outside edits are commit_outside's, named by slide, even when this runs in the second before that one notices."""
    if not GIT["on"] or git(home, "rev-parse", "--is-inside-work-tree").stdout.strip() != "true": return False
    with GIT["lock"]:
        paths = [line[3:].split(" -> ")[-1].strip('"') for line in git(home, "status", "--porcelain").stdout.splitlines()]
        big = [p for p in paths if (home / p).is_file() and (home / p).stat().st_size > 50_000_000]
        paths = [p for p in paths if p not in big and Path(p).name not in (".DS_Store", "Thumbs.db")]   # Finder's / Explorer's litter
        try: mine = skip.resolve().relative_to(home.resolve()).as_posix() if skip else None
        except ValueError: mine = None
        paths = [p for p in paths if p != mine]
        if big: print(f"git: not committing files over 50 MB: {', '.join(big[:3])}")
        if not paths: return False
        deck_of = lambda p: next((q.as_posix() for q in [Path(p), *Path(p).parents] if q != Path(".") and (home / q / "deck.html").is_file()), Path(p).parts[0])
        names = sorted({deck_of(p) for p in paths})
        git(home, "add", "-A", "--", *paths)
        made = git(home, "commit", "-q", "-m", ("outside the editor: " + ", ".join(names[:3]) + (" …" if len(names) > 3 else ""))[:72]).returncode == 0
    return made


def prune_emptied(repo: Path, before: str):
    """Folders that commits brought in from elsewhere emptied (a deck removed online): git takes away the files but leaves
    the folders, with any empty ones inside (a deck's assets/), and Home would show them as empty folders. Only folders
    the pulled commits removed files from, and only once nothing is left in them but empty folders."""
    gone = git(repo, "diff", "--name-only", "--diff-filter=D", before, "HEAD").stdout.split("\n")
    for d in sorted({(repo / f).parent for f in gone if f}, key=lambda p: -len(p.parts)):
        while d != repo and repo in d.parents and d.is_dir() and not any(f.is_file() or f.is_symlink() for f in d.rglob("*")):
            shutil.rmtree(d, ignore_errors=True); d = d.parent


# A deck.html both sides changed merges slide by slide and box by box (glideshow/merge.py, the rules of the editor and of
# glideshow.org), not line by line: unrelated edits sit on nearby lines of a deck, and a line merge where this Mac wins
# could drop a web edit. In a rebase the Mac's commit being replayed is git's "theirs" (%B), so the driver is told it is
# mine. A deck it can't read as slides is left to git's line merge.
DECK_MERGE = ("-c", "merge.glideshow-deck.name=Glideshow deck merge", "-c", f'merge.glideshow-deck.driver="{sys.executable}" "{Path(__file__).with_name("merge.py")}" %O %A %B theirs')   # (by its path: it needs nothing else)


def deck_merge_attributes(repo: Path):
    """deck.html files use the deck merge (in .git/info/attributes: nothing for the library to commit)."""
    p = Path(repo) / git(repo, "rev-parse", "--git-path", "info/attributes").stdout.strip()
    line = "deck.html merge=glideshow-deck"
    if not p.exists() or line not in p.read_text().splitlines():
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a") as f: f.write(line + "\n")


def sync(repo: Path) -> str:
    """Trade commits with origin: bring in what was committed elsewhere (the online editor, docs/self-hosting.md) under the
    local commits, then push those. Only with nothing uncommitted (a save waiting for its commit, or a hand edit), so a
    pull never writes into a file being worked on; the next try comes after the commit. Returns what happened."""
    if not GIT["push"] or git(repo, "remote", "get-url", "origin").returncode: return "no origin"
    with GIT["lock"]:
        if git(repo, "status", "--porcelain", "--untracked-files=no").stdout.strip(): return "uncommitted changes"
        deck_merge_attributes(repo)
        branch = git(repo, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
        if git(repo, "fetch", "-q", "origin", branch).returncode: return "offline"
        behind, ahead = (int(n) for n in git(repo, "rev-list", "--left-right", "--count", "FETCH_HEAD...HEAD").stdout.split() or (0, 0))
        before = git(repo, "rev-parse", "HEAD").stdout.strip()
        if behind:
            if git(repo, *DECK_MERGE, "rebase", "-q", "FETCH_HEAD").returncode:
                # The same lines changed in both places: this Mac's version wins where they overlap (the other one stays in
                # the history), so the two never stay apart, which would stop the backup.
                git(repo, "rebase", "--abort")
                if git(repo, *DECK_MERGE, "rebase", "-q", "-X", "theirs", "FETCH_HEAD").returncode:
                    git(repo, "rebase", "--abort"); print("git: couldn't bring in commits from origin; local commits kept"); return "conflict"
                print("git: an edit made elsewhere overlapped this Mac's; this Mac's version was kept (the other is in the history)")
            prune_emptied(repo, before)
        if ahead:
            r = git(repo, "push", "-q", "origin", f"HEAD:{branch}")
            if r.returncode: print(f"git push failed (kept locally): {r.stderr.strip()[:200]}"); return "push failed"
        return f"in {behind}, out {ahead}"


def schedule_commit(deck: Path):

    if not GIT["on"]:
        return
    if GIT["timer"]: GIT["timer"].cancel()
    GIT["timer"] = threading.Timer(GIT["delay"], commit_now, [deck]); GIT["timer"].daemon = True; GIT["timer"].start()


def history(deck: Path, slide=None, limit=100) -> list:
    if git(deck, "rev-parse", "--is-inside-work-tree").stdout.strip() != "true":
        return []
    out = []
    for line in git(deck, "log", f"-{limit}", "--format=%H%x09%ct%x09%an%x09%s", "--", "deck.html").stdout.splitlines():
        h, t, who, msg = line.split("\t", 3)
        out.append({"rev": h, "time": int(t), "author": who, "message": msg})
    names = {}   # named versions: annotated tags under refs/tags/slides/
    for line in git(deck, "for-each-ref", "refs/tags/slides", "--format=%(*objectname)%09%(contents:subject)").stdout.splitlines():
        rev, _, name = line.partition("\t")
        if rev: names[rev] = name
    for c in out: c["name"] = names.get(c["rev"], "")
    web, pushed = github_url(deck), set(git(deck, "rev-list", "-n", "1000", "@{upstream}").stdout.split())
    for c in out: c["url"] = f"{web}/commit/{c['rev']}" if web and c["rev"] in pushed else ""   # only commits already on GitHub
    if slide:   # keep the commits where slide N's <section> differs from the commit before it
        sec = lambda h: (re.split(r"<section\b", h.split('class="slides"', 1)[-1])[1:] + [""] * slide)[slide - 1]
        texts = [git(deck, "show", f"{c['rev']}:./deck.html").stdout for c in out] + [""]
        out = [c for i, c in enumerate(out) if sec(texts[i]) != sec(texts[i + 1])]
    return out


def github_url(deck: Path) -> str:
    """https://github.com/OWNER/REPO for the repo's origin when it is on GitHub (ssh or https remote), else ''."""
    m = re.match(r"(?:git@github\.com:|https://github\.com/)([\w.-]+/[\w.-]+?)(?:\.git)?/?$", git(deck, "remote", "get-url", "origin").stdout.strip())
    return f"https://github.com/{m.group(1)}" if m else ""


def init_repo(deck: Path):

    if git(deck, "rev-parse", "--is-inside-work-tree").stdout.strip() == "true":
        return print(f"{deck} is already in a git repo")
    git(deck, "init", "-q")
    (deck / ".gitignore").write_text(".DS_Store\n*.tmp\n")
    git(deck, "add", "-A"); git(deck, "commit", "-q", "-m", "deck: start")
    print(f"{deck} is now a git repo; saves are committed")
