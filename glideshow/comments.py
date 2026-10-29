"""Comments on a deck: comments.json beside deck.html, the same file glideshow.org writes when people comment on a
shared deck (cloud/share.js has the format). Committed with the deck's saves."""

import re, json, secrets, time
from pathlib import Path


def read(deck: Path) -> dict:
    try: c = json.loads((deck / "comments.json").read_text())
    except (OSError, ValueError): c = {}
    return {"comments": c.get("comments") if isinstance(c.get("comments"), list) else []}


def change(deck: Path, r: dict, by: dict) -> dict:
    """add {slide, sid, box, x, y, quote, text} / reply {id, text} / edit {id, reply?, text} / resolve {id, resolved} / delete {id}."""
    doc = read(deck); items = doc["comments"]
    find = lambda i: next((c for c in items if c.get("id") == i), None)
    text, now, rid = str(r.get("text", "")).strip()[:4000], time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime()), lambda: secrets.token_hex(4)
    who = {"n": by.get("n", ""), "e": by.get("e", "")}
    op = r.get("op")
    if op == "add" and text:
        sid = str(r.get("sid") or "") if re.fullmatch(r"[\w-]{1,40}", str(r.get("sid") or "")) else ""   # the slide's data-sid: it finds the slide after slides move
        items.append({"id": rid(), "slide": max(1, int(r.get("slide") or 1)), **({"sid": sid} if sid else {}), "box": str(r.get("box", ""))[:40], "x": round(float(r.get("x") or 0)), "y": round(float(r.get("y") or 0)),
                      "quote": str(r.get("quote", ""))[:200], "text": text, "by": who, "at": now, "resolved": False, "replies": []})
    elif op == "reply" and (c := find(r.get("id"))) and text:
        c.setdefault("replies", []).append({"id": rid(), "text": text, "by": who, "at": now})
    elif op == "edit" and (c := find(r.get("id"))) and text:   # the deck's own editor: any comment or reply (one person here)
        t = next((x for x in c.get("replies", []) if x.get("id") == r.get("reply")), None) if r.get("reply") else c
        if not t or t.get("event"): return {**doc, "error": "nothing to edit"}
        t["text"], t["edited"] = text, now
    elif op == "resolve" and (c := find(r.get("id"))):
        c["resolved"] = bool(r.get("resolved"))
        c.setdefault("replies", []).append({"id": rid(), "text": "(resolved)" if c["resolved"] else "(reopened)", "by": who, "at": now, "event": True})
    elif op == "delete" and (c := find(r.get("id"))):
        items.remove(c)
    else:
        return {**doc, "error": "nothing to do"}
    (deck / "comments.json").write_text(json.dumps({"comments": items}, indent=2) + "\n")
    return {"comments": items}
