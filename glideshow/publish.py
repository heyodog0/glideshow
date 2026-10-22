"""`glideshow publish` / Share: a link to a deck at Glideshow (glideshow.org/p/<owner>/<slug>/), docs/self-hosting.md.

The library's published.json says which decks are shared, under which link, as of which commit, and with whom:
    "Lab/talk": {"slug": "talk-k3x9…", "rev": "<commit>", "access": "link" | "people", "people": ["a@b.org", "@harvard.edu", "octocat"],
                 "expires": "2026-12-31", "title": …, "url": …}
Sharing is that entry, committed and pushed with the library; glideshow.org reads it from the library's GitHub repo
(with the Glideshow app installed on it) and serves the deck's latest pushed version (`rev` only records the version it
was shared at). So the library must be on GitHub (`glideshow init-remote`), and the link follows each save once it's pushed. No index of decks exists, and robots are told
to stay out, so a deck is reachable only by its link."""

import json, secrets
from pathlib import Path

from .decks import HOME, deck_title
from .history import commit_library, commit_now, git, github_url

CONFIG = Path.home() / ".glideshow" / "config.json"
LEDGER = HOME / "published.json"
SITE = "https://glideshow.org"


def config() -> dict:
    try: return json.loads(CONFIG.read_text())
    except (OSError, ValueError): return {}


def ledger() -> dict:
    try: return json.loads(LEDGER.read_text())
    except (OSError, ValueError): return {}


def _rel(deck: Path) -> str:
    if HOME.resolve() not in deck.resolve().parents: raise SystemExit(f"Only decks in your library ({HOME}) can be shared; move this one there first.")
    return deck.resolve().relative_to(HOME.resolve()).as_posix()


def _owner() -> str:
    """Whose library the link names: the GitHub owner of the library's repo (config "share_owner" overrides)."""
    if config().get("share_owner"): return config()["share_owner"].lower()
    web = github_url(HOME)
    if not web: raise SystemExit("Sharing needs the library on GitHub (`glideshow init-remote`), with the Glideshow app installed on that repo.")
    return web.rstrip("/").split("/")[-2].lower()


def _people(v) -> list:
    items = v if isinstance(v, list) else str(v or "").replace(";", ",").replace("\n", ",").replace(" ", ",").split(",")
    return list(dict.fromkeys(x.strip().lower() for x in items if x.strip()))[:200]


def state(entry: dict | None, in_library: bool = True) -> dict:
    e = entry or {}
    return {"url": e.get("url", ""), "access": e.get("access", "link"), "people": e.get("people", []), "editors": e.get("editors", []), "expires": e.get("expires", ""), "inLibrary": in_library}


def publish(deck: Path, op: str = "publish", access=None, people=None, expires=None, editors=None) -> dict:
    """Share the deck (op "publish": its link, which always shows the latest pushed version) or change who can open it
    (op "settings": the link stays). Returns state()."""
    rel, entries = _rel(deck), ledger()
    e: dict = dict(entries.get(rel) or {"slug": f"{deck.name[:40]}-{secrets.token_urlsafe(8).lower().replace('_', '').replace('-', '')[:10]}"})
    if access is not None: e["access"] = "people" if access == "people" else "link"
    if people is not None: e["people"] = _people(people)
    if editors is not None: e["editors"] = _people(editors)   # who may edit it at glideshow.org/e/…
    if expires is not None: e["expires"] = expires if len(expires or "") == 10 else ""
    e.setdefault("access", "link"); e.setdefault("people", []); e.setdefault("editors", [])
    if op == "publish" or "rev" not in e:   # pin the deck as it is now, its waiting save committed first
        commit_now(deck)
        e["rev"] = git(HOME, "rev-parse", "HEAD").stdout.strip()
    e["title"] = deck_title(deck)
    e["url"] = f"{config().get('share_site', SITE)}/p/{_owner()}/{e['slug']}/"
    entries[rel] = e
    LEDGER.write_text(json.dumps(entries, indent=2) + "\n")
    commit_library(HOME, f"library: share {deck.name}")   # pushed with it, which is when the link starts to work
    return state(e)


def rekey(old: Path, new: Path) -> None:
    """A deck (or a folder of decks) moved within the library: its shared entries follow, keeping their links."""
    try: o, n = (p.resolve().relative_to(HOME.resolve()).as_posix() for p in (old, new))
    except ValueError: return
    entries = ledger()
    moved = {(n + k[len(o):] if k == o or k.startswith(o + "/") else k): v for k, v in entries.items()}
    if moved != entries: LEDGER.write_text(json.dumps(moved, indent=2) + "\n")


def drop(deck: Path) -> None:
    """A deck (or a folder of decks) removed from the library stops being shared; committed with the removal."""
    try: rel = deck.resolve().relative_to(HOME.resolve()).as_posix()
    except ValueError: return
    entries = ledger()
    kept = {k: v for k, v in entries.items() if k != rel and not k.startswith(rel + "/")}
    if kept != entries: LEDGER.write_text(json.dumps(kept, indent=2) + "\n")


def status(deck: Path) -> dict:
    """Share's view of the deck: its link ('' when not shared), who can open it, until when."""
    try: rel = deck.resolve().relative_to(HOME.resolve()).as_posix()
    except ValueError: return state(None, in_library=False)
    return state(ledger().get(rel))


def unpublish(deck: Path):
    rel, entries = _rel(deck), ledger()
    if rel not in entries: raise SystemExit(f"{rel} is not shared")
    del entries[rel]
    LEDGER.write_text(json.dumps(entries, indent=2) + "\n")
    commit_library(HOME, f"library: stop sharing {deck.name}")
