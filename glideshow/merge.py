"""Three-way merges of deck files, by slide and by box: editor/lib/merge.js in Python, rule for rule (smoke checks that
the two agree), for the Mac's side of a library online: history.sync pulls glideshow.org's commits under the Mac's own
with this as git's merge of deck.html, where a line merge would mix unrelated edits that sit on nearby lines.

    python glideshow/merge.py BASE OURS THEIRS [MINE]   # git's merge driver (%O %A %B): the result is written to OURS

MINE names which of OURS / THEIRS keeps a box (or slide) both changed: 'theirs' in a rebase, where THEIRS is this Mac's
commit being replayed on top of what came in. A file that can't be read as slides gets git's line merge, MINE winning
where lines overlap."""
import re, sys

_ID = re.compile(r'\sid="[^"]*"')
norm = lambda h: _ID.sub("", h)
same_html = lambda a, b: a == b or norm(a) == norm(b)
_SID = re.compile(r'^<section\b[^>]*\sdata-sid="([^"]+)"')
sid_of = lambda h: (m.group(1) if (m := _SID.match(h)) else "")


def merge_lists(base, mine, theirs, key, both=lambda b, m, t: m, val=lambda x: x):
    """Keyed lists, three ways (merge.js mergeLists): (list, clash, order)."""
    same = lambda a, b: a is not None and b is not None and same_html(val(a), val(b))
    B, M, T = ({key(h): h for h in l} for l in (base, mine, theirs))
    out, clash = {}, []
    for i in dict.fromkeys([*M, *T, *B]):
        b, m, t = B.get(i), M.get(i), T.get(i)
        if m is not None and t is not None:
            if same(m, b): out[i] = t
            elif same(t, b) or same(t, m): out[i] = m
            else: out[i] = both(b, m, t); clash.append(i)
        elif m is not None:
            if b is None or not same(m, b): out[i] = m
        elif t is not None:
            if b is None or not same(t, b): out[i] = t
    ids = lambda l: [key(h) for h in l]
    moved = [i for i in ids(mine) if i in B] != [i for i in ids(base) if i in M]
    lead, other = (mine, theirs) if moved else (theirs, mine)
    order = [i for i in ids(lead) if i in out]
    oids = ids(other)
    for n, i in enumerate(oids):
        if i not in out or i in order: continue
        prev = next((x for x in reversed(oids[:n]) if x in order), None)
        order.insert(order.index(prev) + 1 if prev is not None else 0, i)
    order += [i for i in out if i not in order]
    return [out[i] for i in order], [i for i in clash if i in order], order


VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
TOKEN = re.compile(r"""<!--[\s\S]*?-->|<(script|style|textarea|title|xmp|noscript|template)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?</\1\s*>|<(/?)([a-zA-Z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*?(/?)>""")
OPEN = re.compile(r"""^\s*<([a-zA-Z][\w-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>""")
CLOSE = re.compile(r"</\s*([a-zA-Z][\w-]*)\s*>\s*$")


def parts(html):
    """An element's opening tag, top-level children (each whole) and closing tag; None when the tags don't pair up."""
    o, c = OPEN.match(html), CLOSE.search(html)
    if not o or not c or c.group(1).lower() != o.group(1).lower(): return None
    body, kids = html[len(o.group(0)):len(html) - len(c.group(0))], []
    depth, start, last = 0, -1, 0
    def text(a, z):
        t = body[a:z].strip()
        if t: kids.append(t)
    for m in TOKEN.finditer(body):
        at, end = m.start(), m.end()
        whole = m.group(0).startswith("<!--") or m.group(1) or (not m.group(2) and (m.group(4) or m.group(3).lower() in VOID))
        if depth == 0: text(last, at)
        if whole:
            if depth == 0: kids.append(m.group(0)); last = end
            continue
        if m.group(2):
            depth -= 1
            if depth < 0: return None
            if depth == 0: kids.append(body[start:end]); last = end
        else:
            if depth == 0: start = at
            depth += 1
    if depth: return None
    text(last, len(body))
    return {"open": o.group(0).strip(), "kids": kids, "close": c.group(0).strip()}


_KID_ID = re.compile(r"""^<[a-zA-Z][\w-]*\b(?:[^>"']|"[^"]*"|'[^']*')*?\sid="([^"]+)\"""")
_KID_TAG = re.compile(r"""^<([a-zA-Z][\w-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*?(?:\sclass="([^"]*)")?""")


def keyed(kids):
    seen, out = {}, []
    for h in kids:
        if m := _KID_ID.match(h): out.append(("id:" + m.group(1), h)); continue
        t = _KID_TAG.match(h)
        k = (t.group(1).lower() + "." + (t.group(2) or "")) if t and t.group(1) else "#text"
        n = seen.get(k, 0); seen[k] = n + 1; out.append((f"{k}#{n}", h))
    return out


def merge_boxes(b, m, t, note=None):
    """One slide both sides changed, box by box (merge.js mergeBoxes). note['lost']: something of theirs gave way."""
    note = note if note is not None else {}
    note["lost"] = True
    B, M, T = (parts(b) if b is not None else None), parts(m), parts(t)
    if not B or not M or not T or re.search(r"<section\b", "".join(B["kids"] + M["kids"] + T["kids"]), re.I): return m
    bk = keyed(B["kids"]); base = dict(bk)
    def match(side):
        out = keyed(side["kids"]); have = {k for k, _ in out}; free = [x for x in bk if x[0] not in have]; unmatched = 0; res = []
        for k, h in out:
            if k in base: res.append((k, h)); continue
            i = next((j for j, (_, bh) in enumerate(free) if norm(bh) == norm(h)), -1)
            if i >= 0: res.append((free.pop(i)[0], h)); continue
            unmatched += 1; res.append((k, h))
        got = {k for k, _ in res}
        return res, len(bk) > 1 and sum(k not in got for k, _ in bk) > len(bk) / 2 and unmatched > 0
    mm, ms = match(M); tt, ts = match(T)
    if ms or ts: return m
    lst, clash, _ = merge_lists(bk, mm, tt, lambda x: x[0], val=lambda x: x[1])
    same = lambda a, b: same_html(a, b)
    open_ = T["open"] if same(M["open"], B["open"]) else M["open"]
    note["lost"] = bool(clash) or (not same(M["open"], B["open"]) and not same(T["open"], B["open"]) and not same(M["open"], T["open"]))
    return f"{open_}\n" + "\n".join("  " + h for _, h in lst) + f"\n{M['close']}"


_SLIDE = re.compile(r"""<!--[\s\S]*?-->|<(script|style|textarea|title|xmp|noscript|template)\b[\s\S]*?</\1\s*>|<section\b(?:[^>"']|"[^"]*"|'[^']*')*>|</section\s*>""", re.I)


def split_deck(html):
    slides, depth, start, first, end = [], 0, -1, -1, -1
    for m in _SLIDE.finditer(html):
        if m.group(1) or m.group(0).startswith("<!--"): continue
        if m.group(0)[1] == "/":
            depth -= 1
            if depth < 0: return None
            if not depth: slides.append(html[start:m.end()]); end = m.end()
        else:
            if not depth:
                start = m.start()
                if first < 0: first = start
            depth += 1
    if depth or first < 0: return None
    return {"head": html[:first], "slides": slides, "tail": html[end:]}


def _hash(t):   # merge.js hashStr (FNV-1a, 32-bit, base 36)
    h = 2166136261
    for ch in t:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    out, digits = "", "0123456789abcdefghijklmnopqrstuvwxyz"
    while True:
        h, r = divmod(h, 36); out = digits[r] + out
        if not h: return out


_INNER_SID = re.compile(r'<section\b[^>]*\sdata-sid="([^"]+)"')
def _print(h): return re.sub(r"\s+", " ", re.sub(r">\s+<", "><", re.sub(r'\sdata-sid="[^"]*"', "", norm(h)))).strip()
def _own_key(h):
    if s := sid_of(h): return s
    m = _INNER_SID.search(h); return "stack:" + m.group(1) if m else ""


def slide_keys(lists):
    """merge.js slideKeys: ids, or content (matched to an id only when unambiguous)."""
    owners, loose = {}, [dict() for _ in lists]
    for i, l in enumerate(lists):
        for h in l:
            k, f = _own_key(h), _print(h)
            if k: owners.setdefault(f, set()).add(k)
            else: loose[i][f] = loose[i].get(f, 0) + 1
    sure = lambda f: next(iter(owners[f])) if len(owners.get(f, ())) == 1 and all(m.get(f, 0) <= 1 for m in loose) else ""
    out = []
    for l in lists:
        seen, row = {}, []
        for h in l:
            if k := _own_key(h): row.append((k, h)); continue
            f = _print(h)
            if s := sure(f): row.append((s, h)); continue
            n = seen.get(f, 0); seen[f] = n + 1; row.append((f"c:{_hash(f)}:{n}", h))
        out.append(row)
    return out


def merge_decks(base, mine, theirs):
    """Whole deck files (merge.js mergeDecks): {'html', 'both'}, or None when one can't be read as slides."""
    B, M, T = split_deck(base) if base else None, split_deck(mine), split_deck(theirs)
    if not M or not T or (base and not B): return None
    kb, km, kt = slide_keys([B["slides"] if B else [], M["slides"], T["slides"]])
    lost = []
    def both(b, m, t):
        n = {"lost": True}
        h = merge_boxes(b[1] if b else None, m[1], t[1], n) if sid_of(m[1]) else m[1]
        if n["lost"]: lost.append(m[0])
        return (m[0], h)
    lst, _, order = merge_lists(kb, km, kt, lambda x: x[0], both, lambda x: x[1])
    third = lambda b, m, t: t if (b is not None and same_html(m, b)) else m
    html = third(B["head"] if B else None, M["head"], T["head"]) + "\n\n".join(h for _, h in lst) + third(B["tail"] if B else None, M["tail"], T["tail"])
    return {"html": html, "both": [order.index(i) + 1 for i in lost if i in order]}


def main(argv):
    base, ours, theirs = argv[1:4]
    mine = argv[4] if len(argv) > 4 else "ours"
    read = lambda p: open(p, encoding="utf-8").read()
    o, a, b = read(base), read(ours), read(theirs)
    r = merge_decks(o, b, a) if mine == "theirs" else merge_decks(o, a, b)
    if r is None:   # not slides: git's line merge, mine winning where lines overlap (as history.sync did before)
        import subprocess
        return 1 if subprocess.run(["git", "merge-file", "-q", "--theirs" if mine == "theirs" else "--ours", ours, base, theirs]).returncode < 0 else 0
    with open(ours, "w", encoding="utf-8") as f: f.write(r["html"])
    if r["both"]: print(f"glideshow: deck merged; slide{'s' if len(r['both']) > 1 else ''} {', '.join(map(str, r['both']))} changed on both sides, this Mac's version kept", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
