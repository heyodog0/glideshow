"""A stand-in for the parts of Google's Drive API (and its token endpoint) that cloud/store-drive.js uses, for testing
Drive libraries with `wrangler dev` (DRIVE_API=http://localhost:8791, GOOGLE_TOKEN_URL=http://localhost:8791/token).

    uv run test/fake_drive.py [port]       # state in memory; GET /__state lists every live file by path

Past versions follow Drive's rules for files that aren't Google Docs: a version older than 30 days, or beyond the newest
100, is purged unless it is marked keepForever (the current version always stays). GET /__age?days=N makes every
version N days older, as if that much time had passed; /__revisions?path=… lists a file's versions; /__seed?path=…&kept=N
adds N kept versions on past days.
"""
import hashlib, json, re, sys, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

FILES = {}   # id -> {id, name, mimeType, parents, trashed, data, revisions: [{id, data, t, keepForever}]}
FOLDER = "application/vnd.google-apps.folder"
iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(t))
now = lambda: iso(time.time())


def revision(data, t=None, kept=False): return {"id": uuid.uuid4().hex[:12], "data": data, "t": time.time() if t is None else t, "keepForever": kept}


def purge(f):   # Drive's rule for a binary file's past versions: 30 days, or the newest 100, unless kept forever
    revs, cut = f["revisions"], time.time() - 30 * 86400
    keep = [r for i, r in enumerate(revs) if r["keepForever"] or i == len(revs) - 1 or r["t"] >= cut]
    while len(keep) > 100:
        old = next((r for r in keep[:-1] if not r["keepForever"]), None)
        if not old: break
        keep.remove(old)
    f["revisions"] = keep


def make(name, mime, parents, data=b""):
    f = {"id": uuid.uuid4().hex[:20], "name": name, "mimeType": mime, "parents": parents or ["myroot"], "trashed": False, "data": data, "revisions": []}
    if mime != FOLDER: f["revisions"].append(revision(data))
    FILES[f["id"]] = f
    return f


def meta(f):
    out = {k: f[k] for k in ("id", "name", "mimeType", "parents", "trashed")}
    out["modifiedTime"] = iso(f["revisions"][-1]["t"]) if f["revisions"] else now()
    if f["mimeType"] != FOLDER: out["md5Checksum"] = hashlib.md5(f["data"]).hexdigest()
    return out


def live(f):   # as Drive: what's inside a trashed folder is trashed too
    while True:
        if f["trashed"]: return False
        if f["parents"][0] not in FILES: return True
        f = FILES[f["parents"][0]]


def path_of(f):
    parts = [f["name"]]
    while f["parents"][0] in FILES:
        f = FILES[f["parents"][0]]; parts.insert(0, f["name"])
    return "/".join(parts)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def reply(self, obj=None, code=200, raw=None):
        body = raw if raw is not None else json.dumps(obj or {}).encode()
        self.send_response(code); self.send_header("content-length", str(len(body)))
        self.send_header("content-type", "application/octet-stream" if raw is not None else "application/json"); self.end_headers(); self.wfile.write(body)

    def body(self): return self.rfile.read(int(self.headers.get("content-length") or 0))

    def route(self, method):
        u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}; p = u.path
        if p == "/token": return self.reply({"access_token": "fake-access", "expires_in": 3600})
        if p == "/__state": return self.reply({path_of(f): f["data"].decode(errors="replace")[:5000] if f["mimeType"] != FOLDER else "<folder>" for f in FILES.values() if live(f)})
        if p == "/__reset": FILES.clear(); return self.reply({"ok": True})
        if p == "/__age":   # time passes: every version is that many days older
            for f in FILES.values():
                for r in f["revisions"]: r["t"] -= float(q.get("days", 1)) * 86400
                purge(f)
            return self.reply({"ok": True})
        if p in ("/__revisions", "/__seed"):
            f = next((f for f in FILES.values() if live(f) and path_of(f) == q.get("path")), None)
            if not f: return self.reply({"error": "no such file"}, 404)
            if p == "/__seed":   # N kept versions, one a day, before the oldest there is
                first = f["revisions"][0]["t"]
                f["revisions"][:0] = [revision(f"seeded day {i}".encode(), first - (int(q["kept"]) - i) * 86400, True) for i in range(int(q["kept"]))]
            return self.reply([{"id": r["id"], "time": iso(r["t"]), "kept": r["keepForever"], "data": r["data"].decode(errors="replace")} for r in f["revisions"]])
        if not (self.headers.get("authorization") or "").startswith("Bearer "): return self.reply({"error": {"message": "no token"}}, 401)
        body = self.body() if method in ("POST", "PATCH") else b""
        if p == "/drive/v3/files" and method == "GET":
            return self.reply({"files": [meta(f) for f in reversed(FILES.values()) if live(f)]})   # newest first: Drive promises no order, so nothing may depend on one
        if p == "/drive/v3/files" and method == "POST":
            m = json.loads(body or b"{}"); return self.reply(meta(make(m["name"], m.get("mimeType", "application/octet-stream"), m.get("parents"))))
        if p == "/upload/drive/v3/files" and method == "POST":   # multipart/related: metadata, then the media
            boundary = re.search(r"boundary=(\S+)", self.headers["content-type"]).group(1).encode()
            parts = [x for x in body.split(b"--" + boundary) if x.strip() not in (b"", b"--")]
            m = json.loads(parts[0].split(b"\r\n\r\n", 1)[1]); data = parts[1].split(b"\r\n\r\n", 1)[1].rsplit(b"\r\n", 1)[0]
            return self.reply(meta(make(m["name"], "application/octet-stream", m.get("parents"), data)))
        m = re.fullmatch(r"/upload/drive/v3/files/(\w+)", p)
        if m and method == "PATCH":
            f = FILES[m.group(1)]; f["data"] = body; f["revisions"].append(revision(body)); purge(f)
            return self.reply(meta(f))
        m = re.fullmatch(r"/drive/v3/files/(\w+)(/copy|/revisions(?:/(\w+))?)?", p)
        if not m or m.group(1) not in FILES: return self.reply({"error": {"message": "not found"}}, 404)
        f = FILES[m.group(1)]
        if m.group(2) == "/copy":
            c = json.loads(body or b"{}"); return self.reply(meta(make(c.get("name", f["name"]), f["mimeType"], c.get("parents") or f["parents"], f["data"])))
        if m.group(2) and m.group(2).startswith("/revisions"):
            purge(f)
            listed = lambda r: {"id": r["id"], "modifiedTime": iso(r["t"]), "keepForever": r["keepForever"], "lastModifyingUser": {"displayName": "Test Owner"}}
            if m.group(3):
                r = next((r for r in f["revisions"] if r["id"] == m.group(3)), None)
                if not r: return self.reply({"error": {"message": "revision not found"}}, 404)
                if method == "PATCH":   # keepForever: as Drive, at most 200 kept versions of a file
                    c = json.loads(body or b"{}")
                    if c.get("keepForever") and not r["keepForever"] and sum(x["keepForever"] for x in f["revisions"]) >= 200:
                        return self.reply({"error": {"message": "too many kept revisions"}}, 403)
                    if "keepForever" in c: r["keepForever"] = bool(c["keepForever"])
                    return self.reply(listed(r))
                return self.reply(raw=r["data"]) if q.get("alt") == "media" else self.reply(listed(r))
            return self.reply({"revisions": [listed(r) for r in f["revisions"]]})
        if method == "GET": return self.reply(raw=f["data"]) if q.get("alt") == "media" else self.reply(meta(f))
        if method == "PATCH":
            c = json.loads(body or b"{}")
            if "name" in c: f["name"] = c["name"]
            if "trashed" in c: f["trashed"] = c["trashed"]
            if q.get("removeParents"): f["parents"] = [x for x in f["parents"] if x != q["removeParents"]]
            if q.get("addParents"): f["parents"] = [q["addParents"], *f["parents"]]
            return self.reply(meta(f))
        self.reply({"error": {"message": "unsupported"}}, 400)

    do_GET = lambda self: self.route("GET")
    do_POST = lambda self: self.route("POST")
    do_PATCH = lambda self: self.route("PATCH")


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8791), Handler).serve_forever()
