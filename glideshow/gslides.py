"""`glideshow import-google`: a Google Slides deck → a deck folder, through the Google Slides API, standard library only.

    glideshow import-google <url | presentation id | saved .json> [DECK] [--pptx FILE] [--report] [--ir] [--no-open]
    glideshow import-google --login          # the one-time Google sign-in (prints the console steps if no client exists)
    glideshow import-google --bookmarklet    # the no-setup fallback: a bookmarklet that saves the deck from a signed-in tab

The API (`presentations.get`) gives every element with its transform in EMU, its text as runs (font, size, weight,
colour, bullets), fills, outlines, connectors, pictures (a short-lived download URL), tables, groups and the notes
page. Those become boxes one to one: `shapeType` names are the OOXML presets shapes.js draws. Click builds aren't in
the API: pass the deck's own .pptx download (File → Download → PowerPoint) as --pptx and they become reveal fragments;
the .pptx also gives each shape's adjust values (a dragged corner radius, arrow head …), which the API leaves out.
--ir also writes source/ir.json: what the importer drew from, inheritance followed.

Sign-in: an OAuth "Desktop app" client of your own (~/.glideshow/google.json, see LOGIN_STEPS), the consent page in the
browser once, the refresh token in ~/.glideshow/google-token.json. Scope: presentations.readonly only.
"""
import base64, hashlib, html, json, math, os, re, secrets, sys, threading, time, urllib.error, urllib.parse, urllib.request, webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from .decks import EDITOR, HOME, new_deck

CACHE = Path(os.environ.get("GLIDESHOW_CACHE") or Path.home() / ".glideshow")
CLIENT = CACHE / "google.json"
TOKEN = CACHE / "google-token.json"
SCOPE = "https://www.googleapis.com/auth/presentations.readonly"
API = "https://slides.googleapis.com/v1/presentations/"
EMU_PT = 12700
PX = 1920 / 9144000   # px per EMU on the default 10 in wide page (so 1 pt = 2.667 px, as everywhere in the editor)

LOGIN_STEPS = f"""Google import needs an OAuth client of your own (one-time, about 10 minutes; a Claude in Chrome session can do it):
  1. console.cloud.google.com → New project (e.g. "slides-import"), with the Google account that owns the decks.
  2. APIs & Services → Library → enable "Google Slides API" (only that one).
  3. APIs & Services → OAuth consent screen → User type Internal if offered (a Workspace account), else External and
     then Publish app. Not Testing mode: its sign-ins expire after 7 days.
  4. Scopes → add {SCOPE}
  5. Credentials → Create credentials → OAuth client ID → Desktop app → Download JSON → save it as
     {CLIENT}
Then run `glideshow import-google --login` and click Allow in the browser."""


# ---------------------------------------------------------------- sign-in

def _post(url: str, data: dict) -> dict:
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode(), headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Google sign-in failed: {e.read().decode()[:300]}")


def client() -> dict:
    try: c = json.loads(CLIENT.read_text())
    except (OSError, ValueError): raise SystemExit(LOGIN_STEPS)
    c = c.get("installed") or c.get("web") or c
    if not c.get("client_id"): raise SystemExit(f"{CLIENT} isn't an OAuth client file.\n\n{LOGIN_STEPS}")
    return c


def login(scope: str = SCOPE, token: Path = TOKEN) -> dict:
    """The consent page in the browser, the code caught on localhost (PKCE), tokens cached. Returns the token record."""
    c = client()
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state, got = secrets.token_urlsafe(16), {}

    class Catch(BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            ok = q.get("state", [""])[0] == state and "code" in q
            if ok: got["code"] = q["code"][0]
            self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.end_headers()
            self.wfile.write(("<p style='font: 16px system-ui; margin: 40px'>Signed in. You can close this tab and go back to the terminal.</p>" if ok
                              else "<p style='font: 16px system-ui; margin: 40px'>Sign-in failed: " + html.escape(q.get("error", ["?"])[0]) + "</p>").encode())
        def log_message(self, *a): pass

    srv = HTTPServer(("127.0.0.1", 0), Catch)
    redirect = f"http://127.0.0.1:{srv.server_address[1]}/"
    url = c.get("auth_uri", "https://accounts.google.com/o/oauth2/v2/auth") + "?" + urllib.parse.urlencode({
        "client_id": c["client_id"], "redirect_uri": redirect, "response_type": "code", "scope": scope, "state": state,
        "access_type": "offline", "prompt": "consent", "code_challenge": challenge, "code_challenge_method": "S256"})
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    print("Opening Google's sign-in page; click Allow. If no browser opens, visit:\n" + url)
    webbrowser.open(url)
    for _ in range(600):   # up to 5 minutes
        if got: break
        time.sleep(0.5)
    srv.shutdown()
    if not got: raise SystemExit("no sign-in within 5 minutes")
    tok = _post(c.get("token_uri", "https://oauth2.googleapis.com/token"), {
        "code": got["code"], "client_id": c["client_id"], "client_secret": c.get("client_secret", ""), "redirect_uri": redirect,
        "grant_type": "authorization_code", "code_verifier": verifier})
    tok["expires_at"] = time.time() + tok.get("expires_in", 3600) - 60
    CACHE.mkdir(parents=True, exist_ok=True); token.write_text(json.dumps(tok, indent=2))
    try: token.chmod(0o600)
    except OSError: pass
    print(f"Signed in; token saved in {token}")
    return tok


def access_token(scope: str = SCOPE, token: Path = TOKEN) -> str:
    """A valid access token: cached, refreshed, or (interactively) a new sign-in."""
    try: tok = json.loads(token.read_text())
    except (OSError, ValueError): tok = None
    if not tok:
        if not sys.stdin.isatty() and not os.environ.get("GLIDESHOW_GOOGLE_LOGIN"): raise SystemExit("not signed in to Google: run `glideshow import-google --login`")
        tok = login(scope, token)
    if tok.get("expires_at", 0) > time.time(): return tok["access_token"]
    c = client()
    try:
        fresh = _post(c.get("token_uri", "https://oauth2.googleapis.com/token"), {
            "refresh_token": tok.get("refresh_token", ""), "client_id": c["client_id"], "client_secret": c.get("client_secret", ""), "grant_type": "refresh_token"})
    except SystemExit as e:
        if "invalid_grant" in str(e):
            raise SystemExit("Google sign-in expired (a consent screen still in Testing mode does this every 7 days: publish it, "
                             "or set the user type to Internal). Run `glideshow import-google --login` again.")
        raise
    tok.update(fresh); tok["expires_at"] = time.time() + fresh.get("expires_in", 3600) - 60
    token.write_text(json.dumps(tok, indent=2))
    return tok["access_token"]


def presentation_id(s: str) -> str:
    m = re.search(r"/presentation/d/([\w-]+)", s)
    return m.group(1) if m else s.strip()


def api_get(path: str) -> dict:
    """One API call; a 429 (thumbnails count as "expensive reads", 60 a minute) or a 5xx waits and retries, up to ~2 minutes."""
    req = urllib.request.Request(API + path, headers={"Authorization": "Bearer " + access_token()})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read())
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:400]
            if e.code == 429 or e.code >= 500:
                wait = min(60, 5 * 2 ** attempt)
                if attempt < 5: print(f"  Google says slow down ({e.code}); waiting {wait}s"); time.sleep(wait); continue
            if e.code == 403 and "has not been used" in msg: raise SystemExit("the Google Slides API isn't enabled on your project (step 2 of the setup):\n" + msg)
            if e.code == 404: raise SystemExit("no such presentation (or this account can't open it)")
            raise SystemExit(f"Google Slides API: {e.code} {msg}")
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < 5: time.sleep(5 * 2 ** attempt); continue
            raise SystemExit(f"Google Slides API unreachable: {e}")
    raise SystemExit("Google Slides API: still rate-limited after retries; try again in a minute")


def fetch(pid: str) -> dict:
    return api_get(pid)


def thumbnails(pid: str, pres: dict, out: Path) -> list:
    """Google's own render of each slide (1600 px wide PNG) into out/slide-NN.png: the references for --report."""
    out.mkdir(parents=True, exist_ok=True)
    paths = []
    for n, s in enumerate(pres.get("slides", []), 1):
        p = out / f"slide-{n:02d}.png"
        if not p.exists():   # a re-run after a quota stop continues where it stopped
            t = api_get(f"{pid}/pages/{s['objectId']}/thumbnail?thumbnailProperties.thumbnailSize=LARGE&thumbnailProperties.mimeType=PNG")
            with urllib.request.urlopen(t["contentUrl"], timeout=60) as r: p.write_bytes(r.read())
        paths.append(p)
    return paths


# ---------------------------------------------------------------- the API's JSON → boxes

def _rgb(c: dict | None, scheme: dict[str, dict]) -> str | None:
    """An OpaqueColor → #rrggbb (theme colours through the master's scheme)."""
    if not c: return None
    c = dict(c.get("opaqueColor", c))
    if "themeColor" in c: c = scheme.get(c["themeColor"], {"rgbColor": {}})
    if any(k in c for k in ("red", "green", "blue")): c = {"rgbColor": c}   # the theme palette holds bare RgbColor values
    if "rgbColor" in c or c == {}:   # the API drops zero components, and the whole rgbColor when it is black
        v = c.get("rgbColor", {}); return "#%02x%02x%02x" % tuple(round(255 * float(v.get(k, 0))) for k in ("red", "green", "blue"))
    return None


def _color(fill: dict | None, scheme: dict) -> str | None:
    """A SolidFill (colour + alpha) → CSS colour; None when there's none."""
    if not fill or "color" not in fill: return None
    rgb = _rgb(fill["color"], scheme)
    if rgb is None: return None
    a = float(fill.get("alpha", 1))
    return rgb if a >= 0.999 else rgb + "%02x" % round(a * 255)


def _emu(v: dict | None) -> float:
    if not v: return 0.0
    m = float(v.get("magnitude", 0))
    return m * EMU_PT if v.get("unit") == "PT" else m


DASH = {"DOT": "dot", "DASH": "dash", "DASH_DOT": "dashdot", "LONG_DASH": "longdash", "LONG_DASH_DOT": "longdashdot"}
ARROW = {"STEALTH_ARROW": "arrow", "FILL_ARROW": "fill-arrow", "FILL_CIRCLE": "circle", "FILL_SQUARE": "square", "FILL_DIAMOND": "diamond",
         "OPEN_ARROW": "open-arrow", "OPEN_CIRCLE": "open-circle", "OPEN_SQUARE": "open-square", "OPEN_DIAMOND": "open-diamond"}
ALIGN = {"CENTER": "center", "END": "right", "JUSTIFIED": "justify"}
VALIGN = {"TOP": "top", "BOTTOM": "bottom"}
# Google puts a line's baseline 0.351 em below its middle in every font; CSS puts it at half the font's
# hhea ascent − descent (as Chrome reads the font file), so a run in a font far from 0.351 is shifted by the difference.
# Each font's middle: editor/data/font-metrics.json (tools/font_metrics.py); a font not in it isn't shifted.
BASELINE = 0.351
# Google's default adjust values where they aren't the ECMA-376 preset's (the API doesn't give them; Google's own .pptx
# export does), scaled 0–1 as data-adj, from the box (w, h); the preset pins each to its range (a
# brace's 0.5 becomes a quarter of its height)
GOOGLE_ADJ = {"HEXAGON": lambda w, h: (0.28852,), "LEFT_BRACE": lambda w, h: (0.5,), "RIGHT_BRACE": lambda w, h: (0.5,)}
# (the export also says a wedgeRoundRectCallout's corner, adj3, is 0, but Google draws it rounded, at ECMA's 16667)
try: HHEA_MID = json.loads((EDITOR / "data" / "font-metrics.json").read_text())
except (OSError, ValueError): HHEA_MID = {}
WEBSAFE = {"Arial", "Helvetica", "Times New Roman", "Georgia", "Courier New", "Verdana", "Trebuchet MS", "Impact", "Comic Sans MS", "Calibri", "Cambria", "Tahoma"}


def preset_map() -> dict:
    """The API's shapeType names (RIGHT_ARROW) → our data-shape names (arrow), from shapes.js' PRESET_OF (rightArrow)."""
    js = (EDITOR / "deck" / "shapes.js").read_text()
    po = js[js.index("PRESET_OF = {"):js.index("};", js.index("PRESET_OF = {"))]
    ours = {}
    for name, prst in re.findall(r"['\"]?([\w-]+)['\"]?:\s*'(\w+)'", po):
        ours[re.sub(r"(?<=[a-z])(?=[A-Z0-9])", "_", prst).upper()] = name
    ours.update({"RECTANGLE": "rect", "ROUND_RECTANGLE": "roundrect", "ELLIPSE": "ellipse", "TEXT_BOX": None, "STAR_5": "star", "MATH_PLUS": "plus",
                 "WEDGE_RECTANGLE_CALLOUT": "callout", "WEDGE_ROUND_RECTANGLE_CALLOUT": "roundcallout", "WEDGE_ELLIPSE_CALLOUT": "ovalcallout"})
    # the API's names where they aren't the preset's (rtTriangle is RIGHT_TRIANGLE, round1Rect ROUND_1_RECTANGLE …)
    for api, prst in (("RIGHT_TRIANGLE", "RT_TRIANGLE"), ("DIAGONAL_STRIPE", "DIAG_STRIPE"), ("ROUND_1_RECTANGLE", "ROUND_1RECT"),
                      ("ROUND_2_DIAGONAL_RECTANGLE", "ROUND_2DIAG_RECT"), ("ROUND_2_SAME_RECTANGLE", "ROUND_2SAME_RECT"), ("SNIP_1_RECTANGLE", "SNIP_1RECT"),
                      ("SNIP_2_DIAGONAL_RECTANGLE", "SNIP_2DIAG_RECT"), ("SNIP_2_SAME_RECTANGLE", "SNIP_2SAME_RECT"), ("SNIP_ROUND_RECTANGLE", "SNIP_ROUND_RECT")):
        if prst in ours: ours[api] = ours[prst]
    return ours


def _mat(t: dict | None) -> tuple:
    if not t: return (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    u = EMU_PT if t.get("unit") == "PT" else 1
    # the API leaves out fields that are 0, scaleX / scaleY included (a 90° rotation has both at 0)
    return (float(t.get("scaleX", 0)), float(t.get("shearY", 0)), float(t.get("shearX", 0)), float(t.get("scaleY", 0)),
            float(t.get("translateX", 0)) * u, float(t.get("translateY", 0)) * u)


def _mul(p: tuple, c: tuple) -> tuple:
    """parent ∘ child (the child's transform first, then the parent's), both as (a, b, c, d, tx, ty)."""
    a, b, cc, d, tx, ty = p; a2, b2, c2, d2, tx2, ty2 = c
    return (a * a2 + cc * b2, b * a2 + d * b2, a * c2 + cc * d2, b * c2 + d * d2, a * tx2 + cc * ty2 + tx, b * tx2 + d * ty2 + ty)


class Geometry:
    """An element's box on our canvas: left/top/width/height px, rotation deg, flip, from its absolute transform and size."""
    def __init__(self, m: tuple, size: dict | None, k: float):
        a, b, c, d, tx, ty = m
        w0, h0 = _emu((size or {}).get("width")), _emu((size or {}).get("height"))
        sx, sy = math.hypot(a, b), math.hypot(c, d)
        self.w, self.h = w0 * sx * k, h0 * sy * k
        self.flip = (a * d - b * c) < 0
        self.rot = (math.degrees(math.atan2(-b, -a)) if self.flip else math.degrees(math.atan2(b, a))) if sx else 0.0   # flipped: M = R(θ)·flipH·S
        cx, cy = tx + a * w0 / 2 + c * h0 / 2, ty + b * w0 / 2 + d * h0 / 2   # the centre is where rotation doesn't move it
        self.x, self.y = cx * k - self.w / 2, cy * k - self.h / 2
        self.a, self.b, self.c, self.d, self.tx, self.ty = a, b, c, d, tx, ty
        self.k = k

    def point(self, u: float, v: float) -> tuple:
        return ((self.tx + self.a * u + self.c * v) * self.k, (self.ty + self.b * u + self.d * v) * self.k)

    def style(self) -> str:
        s = f"left: {_px(self.x)}px; top: {_px(self.y)}px; width: {_px(self.w)}px; height: {_px(self.h)}px;"
        return s + (f" transform: rotate({self.rot:.2f}deg);" if abs(self.rot) > 0.05 else "")


def _px(v: float) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".") if abs(v) >= 0.05 else "0"


def list_style(glyph: str, depth: int) -> tuple:
    """A bullet glyph → (ul|ol, list-style-type or None when it is the level's default), in the editor's own vocabulary."""
    g = glyph.strip()
    if re.match(r"^(\d+)[.)]$", g): return ("ol", None if depth == 0 else "decimal")
    if re.match(r"^[ivx]+[.)]$", g): return ("ol", "lower-roman")
    if re.match(r"^[IVX]+[.)]$", g): return ("ol", "upper-roman")
    if re.match(r"^[a-z][.)]$", g): return ("ol", "lower-alpha")
    if re.match(r"^[A-Z][.)]$", g): return ("ol", "upper-alpha")
    default = ["disc", "circle", "square"][min(depth, 2)]
    named = {"●": "disc", "•": "disc", "○": "circle", "◦": "circle", "■": "square", "▪": "square"}
    if g in named: return ("ul", None if named[g] == default else named[g])
    if g in ("-", "–", "—"): return ("ul", f"'{g}  '")
    return ("ul", f"'{g}  '" if g and "'" not in g else None)


class Converter:
    def __init__(self, pres: dict, deck: Path, get=None, log=None):
        self.pres, self.deck = pres, deck
        self.get = get or self._download   # url → bytes (tests pass their own)
        self.log = log if log is not None else []
        W = _emu(pres["pageSize"]["width"]); H = _emu(pres["pageSize"]["height"])
        self.k = 1920 / W
        self.height = round(H * self.k)
        self.presets = preset_map()
        self.pages = {p["objectId"]: p for p in pres.get("masters", []) + pres.get("layouts", []) + pres.get("slides", [])}
        self.elements = {}
        for p in self.pages.values():
            for e in self._walk(p.get("pageElements", [])): self.elements[e["objectId"]] = e
        self.scheme = {}
        for m in pres.get("masters", []):
            for c in m.get("pageProperties", {}).get("colorScheme", {}).get("colors", []):
                self.scheme[c["type"]] = c["color"]
        self.fonts = set()
        self.pptx_adj = {}   # adjust values from the deck's .pptx (pptx_adjusts), when one is given
        self.glyphs = set()   # characters past Latin-1 in Google Fonts runs: Google Fonts' css2 subsets may leave them out
        self.n = 0
        self.google = self._google_fonts()
        # pictures by element id, so a re-convert from the saved JSON (its download URLs expire within the hour) keeps them
        self.images_file = deck / "source" / "images.json"
        try: self.images = json.loads(self.images_file.read_text())
        except (OSError, ValueError): self.images = {}

    @staticmethod
    def _google_fonts() -> set:
        try: return {r[0] for r in json.loads((EDITOR / "data" / "fonts.json").read_text())}
        except (OSError, ValueError, TypeError): return set()

    def _walk(self, els):
        for e in els:
            yield e
            if "elementGroup" in e: yield from self._walk(e["elementGroup"].get("children", []))

    def _download(self, url: str) -> bytes:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=60) as r: return r.read()

    def nid(self) -> str:
        self.n += 1; return f"g{self.slide}-{self.n}"

    # ---- inheritance: a placeholder's parent on the layout, then the master
    def parents(self, el: dict) -> list:
        out, seen = [], set()
        while el and "shape" in el:
            pid = el["shape"].get("placeholder", {}).get("parentObjectId")
            if not pid or pid in seen or pid not in self.elements: break
            seen.add(pid); el = self.elements[pid]; out.append(el)
        return out

    def prop(self, el: dict, *path, default=None):
        """A shapeProperties value, inherited from the placeholder chain when unset / INHERIT."""
        for e in [el] + self.parents(el):
            v = e.get("shape", {}).get("shapeProperties", {})
            for p in path: v = v.get(p, {}) if isinstance(v, dict) else {}
            if v not in ({}, None): return v
        return default

    def fill(self, el: dict) -> str | None:
        for e in [el] + self.parents(el):
            f = e.get("shape", {}).get("shapeProperties", {}).get("shapeBackgroundFill")
            if not f: continue
            st = f.get("propertyState", "RENDERED")
            if st == "NOT_RENDERED": return None
            if st == "RENDERED" and "solidFill" in f: return _color(f["solidFill"], self.scheme)
        return None

    def outline(self, el: dict) -> tuple:
        """(colour, width px, dash) or (None, 0, None)."""
        for e in [el] + self.parents(el):
            o = e.get("shape", {}).get("shapeProperties", {}).get("outline")
            if not o: continue
            st = o.get("propertyState", "RENDERED")
            if st == "NOT_RENDERED": return (None, 0, None)
            if st == "RENDERED" and ("outlineFill" in o or "weight" in o):
                col = _color(o.get("outlineFill", {}).get("solidFill"), self.scheme)
                w = _emu(o.get("weight")) * self.k if o.get("weight") else 1 * EMU_PT * self.k
                return (col, w, DASH.get(o.get("dashStyle", "SOLID")))
        return (None, 0, None)

    # ---- text
    def text_defaults(self, el: dict) -> list:
        """Run and paragraph styles inherited by nesting level: [(text style, paragraph style) per level], deepest parent first."""
        chain = []
        for p in reversed(self.parents(el)):
            levels = {}
            for para in self.paragraphs(p.get("shape", {}).get("text", {})):
                lvl = para["level"]
                if lvl in levels: continue
                first = next((r for r in para["runs"] if "textRun" in r), None)
                levels[lvl] = ((first or {}).get("textRun", {}).get("style", {}), para["style"])
            chain.append(levels)
        return chain

    @staticmethod
    def paragraphs(text: dict) -> list:
        """textElements → [{style, level, bullet, runs}]: a paragraphMarker then its runs up to the next marker."""
        out, cur = [], None
        for te in text.get("textElements", []):
            if "paragraphMarker" in te:
                pm = te["paragraphMarker"]
                cur = {"style": pm.get("style", {}), "bullet": pm.get("bullet"), "level": (pm.get("bullet") or {}).get("nestingLevel", 0), "runs": []}
                out.append(cur)
            elif cur is not None:
                cur["runs"].append(te)
        return out

    def family_css(self, st: dict) -> str:
        fam = (st.get("weightedFontFamily") or {}).get("fontFamily") or st.get("fontFamily")
        if not fam: return ""
        if fam not in WEBSAFE: self.fonts.add(fam)
        return f"font-family: '{fam}'" + (", serif" if fam in ("Georgia", "Times New Roman", "Merriweather", "Lora", "Playfair Display", "EB Garamond", "Roboto Slab") else ", sans-serif")

    def run_html(self, r: dict, scale: float, para: tuple = ("", "")) -> str:
        """One resolved run (resolve_text) as a <span>. `para`: its paragraph's own font-size and font-family CSS, which
        the run inherits, so a run states them only where it differs (one place to change a paragraph's size)."""
        st, t = r["style"], r["text"]
        if t.endswith("\n"): t = t[:-1]
        if not t: return ""
        css = []
        fam = self.family_css(st)
        if fam and fam != para[1]: css.append(fam)
        if ((st.get("weightedFontFamily") or {}).get("fontFamily") or st.get("fontFamily")) in self.google:
            self.glyphs.update(ch for ch in t if ord(ch) > 0xFF and not ch.isspace())
        fpx = float((st.get("fontSize") or {}).get("magnitude", 14)) * scale * EMU_PT * self.k   # the run's size, in canvas px
        shift = BASELINE - HHEA_MID.get((st.get("weightedFontFamily") or {}).get("fontFamily") or st.get("fontFamily") or "Arial", BASELINE)
        if abs(shift) >= 0.01: css.append(f"position: relative; top: {_px(shift * fpx)}px")
        off = st.get("baselineOffset")
        if off in ("SUPERSCRIPT", "SUBSCRIPT"):   # Google: 2/3 the size, the baseline ±0.375 em, and the line keeps its height
            css.append(f"font-size: {_px(fpx * 2 / 3)}px; vertical-align: {_px(0.375 * fpx * (1 if off == 'SUPERSCRIPT' else -1))}px; line-height: 0")
        elif st.get("fontSize") and f"font-size: {_px(fpx)}px" != para[0]: css.append(f"font-size: {_px(fpx)}px")
        wt = (st.get("weightedFontFamily") or {}).get("weight")
        if st.get("bold") or (wt and wt >= 600): css.append("font-weight: bold")
        if st.get("italic"): css.append("font-style: italic")
        deco = [d for d, on in (("underline", st.get("underline")), ("line-through", st.get("strikethrough"))) if on]
        if deco: css.append("text-decoration: " + " ".join(deco))
        col = _rgb(st.get("foregroundColor"), self.scheme)   # an OptionalColor: {opaqueColor}, no alpha
        if col: css.append(f"color: {col}")
        bg = _rgb(st.get("backgroundColor"), self.scheme)
        if bg: css.append(f"background: {bg}")
        parts = [html.escape(p) for p in t.split("\v")]
        inner = "<br>".join(parts)
        if not inner.strip(): inner = "&nbsp;" * max(1, len(inner))   # a blank paragraph still takes a line (whitespace alone collapses)
        if st.get("link", {}).get("url"): inner = f'<a href="{html.escape(st["link"]["url"], quote=True)}">{inner}</a>'
        return f'<span style="{"; ".join(css)}">{inner}</span>' if css else inner

    def resolve_text(self, el: dict, text: dict) -> list:
        """The IR's paragraphs: every style with its inheritance followed (the placeholder chain per
        nesting level, then Slides' own defaults). [{level, bullet, style, base, runs: [{text, style} | {auto}]}]"""
        chain = self.text_defaults(el)
        # Slides' own defaults for text with nothing set anywhere: Arial 14 pt in the theme's text colour
        defaults = {"fontFamily": "Arial", "fontSize": {"magnitude": 14, "unit": "PT"}, "foregroundColor": {"opaqueColor": {"themeColor": "DARK1"}} if "DARK1" in self.scheme else {"opaqueColor": {"rgbColor": {}}}}
        out = []
        for para in self.paragraphs(text):
            base_t, base_p = dict(defaults), {}
            for levels in chain:
                t, p = levels.get(para["level"]) or levels.get(0) or ({}, {})
                base_t.update(t); base_p.update(p)
            runs = [{"text": r["textRun"].get("content", ""), "style": {**base_t, **r["textRun"].get("style", {})}} if "textRun" in r
                    else {"auto": r.get("autoText", {}).get("content", "")} for r in para["runs"]]
            out.append({"level": para["level"], "bullet": para["bullet"], "style": {**base_p, **para["style"]}, "base": base_t, "runs": runs})
        return out

    def text_html(self, paras: list, scale: float = 1.0, lsr: float = 1.0, in_text_box: bool = False) -> str:
        """Resolved paragraphs (resolve_text) as .content HTML. Paragraph alignment / spacing / indents inline per paragraph; bullets as lists."""
        out, stack = [], []   # stack: open list levels
        for pi, para in enumerate(paras):
            ps, base_t = para["style"], para["base"]
            texts = [r for r in para["runs"] if "text" in r]
            # the paragraph's own font size (its biggest run's, or the inherited one): line-height is computed on it, so line pitch is exact
            sizes = [float((r["style"].get("fontSize") or {}).get("magnitude", 14)) for r in texts] or [float((base_t.get("fontSize") or {}).get("magnitude", 14))]
            css = [f"font-size: {_px(min(sizes) * scale * EMU_PT * self.k)}px"]   # the smallest run: the paragraph's own strut must never exceed a line's text
            # and the first run's font: a strut in another font (other ascent/descent) would stretch every line past its line-height
            first_run = texts[0]["style"] if texts else base_t
            fam = self.family_css(first_run)
            if fam: css.append(fam)
            runs = "".join(self.run_html(r, scale, (css[0], fam)) if "text" in r else html.escape(r["auto"]) for r in para["runs"])   # runs say only what differs
            al = ALIGN.get(ps.get("alignment", ""))
            if al: css.append(f"text-align: {al}")
            # a text box wraps 2 px wider than Google's inset (a word overflowing by 1 px at 96 dpi stays): text aligned
            # right or centred is drawn back to Google's edge, justified text splits the 2 px between its two ends
            if al and in_text_box:
                css.append(f"position: relative; left: {-2 if al == 'right' else -1}px")
            # measured on Google's renders: single spacing is 1.2 × the font size, and autofit's lineSpacingReduction comes off the fraction
            ls = float(ps.get("lineSpacing", 100) or 100) / 100 - (1 - lsr)
            if len(set(sizes)) == 1:   # Google rounds a line's pitch to whole 96-dpi px (0.75 pt): 12 pt → 19 px, 24 pt → 38 px
                lh, lh1 = (round(1.2 * f * sizes[0] * scale * 4 / 3) * 0.75 * EMU_PT * self.k for f in (ls, 1))
                if lsr < 1: lh = 1.2 * ls * sizes[0] * scale * EMU_PT * self.k   # shrink on overflow's reduced spacing isn't rounded
                css.append(f"line-height: {_px(lh)}px")
                # Google keeps the first baseline where single spacing puts it (b1, from the line's top) and adds the
                # extra below; under single spacing it puts it at spacing × b1. CSS splits the leading above and
                # below the text instead: move the paragraph by the difference
                b1 = lh1 / 2 + BASELINE * sizes[0] * scale * EMU_PT * self.k
                shift = (min(ls, 1) - 1) * b1 - (lh - lh1) / 2
                if abs(shift) > 0.25: css.append(f"position: relative; top: {_px(shift)}px")
            else:   # mixed sizes: unitless, so a bigger run's line grows as Google's does
                css.append(f"line-height: {1.2 * ls:.3f}")
            # COLLAPSE_LISTS (Slides' default): no paragraph spacing between items of one list, only around the list
            same_list = lambda q: q is not None and bool(q["bullet"]) and bool(para["bullet"])   # Slides: "spacing is skipped between list elements"
            collapse = ps.get("spacingMode", "COLLAPSE_LISTS") == "COLLAPSE_LISTS" and para["bullet"]
            prev_, next_ = (paras[pi - 1] if pi else None), (paras[pi + 1] if pi + 1 < len(paras) else None)
            for key, prop, skip in (("spaceAbove", "margin-top", collapse and same_list(prev_)), ("spaceBelow", "margin-bottom", collapse and same_list(next_))):
                if not skip and ps.get(key) and float(ps[key].get("magnitude", 0)) > 0: css.append(f"{prop}: {_px(float(ps[key]['magnitude']) * EMU_PT * self.k)}px")
            ind = float(ps.get("indentStart", {}).get("magnitude", 0)) if ps.get("indentStart") else 0
            lvl = para["level"] if para["bullet"] else -1
            while len(stack) > (lvl + 1): out.append(f"</{stack.pop()[0]}>")
            if lvl >= 0:
                while len(stack) < lvl + 1:
                    glyph = (para["bullet"] or {}).get("glyph", "")
                    tag, ls = list_style(glyph, len(stack))
                    # the text starts at indentStart (Slides: 36 pt per level); the list's padding is the step from the level outside it
                    outer = stack[-1][1] if stack else 0.0
                    step = (ind if ind > 0.5 else 36.0 * (len(stack) + 1)) - outer
                    st = "; ".join(s for s in (f"list-style-type: {ls}" if ls else "", f"padding-left: {_px(step * EMU_PT * self.k)}px") if s)
                    out.append(f'<{tag} data-mk style="{st}">'); stack.append((tag, outer + step))
                # the marker: Google's glyph (or number style) in the bullet's colour, at indentFirstLine (base.css data-mk)
                first = float((ps.get("indentFirstLine") or {}).get("magnitude", 0) or 0)
                css.append(f"--mk: {_px(max(0.0, (ind if ind > 0.5 else 36.0 * (lvl + 1)) - first) * EMU_PT * self.k)}px")
                b = para["bullet"] or {}; g = b.get("glyph", "").strip()
                bcol = _rgb((b.get("bulletStyle") or {}).get("foregroundColor") or first_run.get("foregroundColor"), self.scheme)
                if bcol: css.append(f"color: {bcol}")
                fr = first_run; bl = BASELINE - HHEA_MID.get((fr.get("weightedFontFamily") or {}).get("fontFamily") or fr.get("fontFamily") or "Arial", BASELINE)
                if abs(bl) >= 0.01: css.append(f"--bl: {_px(bl * sizes[0] * scale * EMU_PT * self.k)}px")
                if stack[-1][0] == "ol":
                    num = "lower-roman" if re.match(r"^[ivx]+", g) else "upper-roman" if re.match(r"^[IVX]+", g) else "lower-alpha" if re.match(r"^[a-z]", g) else "upper-alpha" if re.match(r"^[A-Z]", g) else "decimal"
                    css.append(f"--num: {num}; --sfx: '{g[-1] if g[-1:] in '.)' else ''}'")
                elif g and "'" not in g and "\\" not in g: css.append(f"--glyph: '{g}'")
                st = ' style="' + '; '.join(css) + '"' if css else ''   # (no nested same quotes in an f-string before Python 3.12)
                out.append(f'<li{st}>{runs or "<br>"}</li>')
            else:
                if ind > 0.5: css.append(f"padding-left: {_px(ind * EMU_PT * self.k)}px")
                st = ' style="' + '; '.join(css) + '"' if css else ''
                out.append(f'<div{st}>{runs or "<br>"}</div>')
        while stack: out.append(f"</{stack.pop()[0]}>")
        return "".join(out)

    def plain_text(self, text: dict) -> str:
        return "\n".join("".join(r.get("textRun", {}).get("content", "") for r in p["runs"]).rstrip("\n") for p in self.paragraphs(text)).strip()

    # ---- elements
    def pptx_adjust(self, g: Geometry) -> list | None:
        """The shape's adjust values from the deck's own .pptx (Google's export: the API doesn't give them), matched by
        slide, position and size; None when there's no .pptx or no shape there."""
        for x, y, w, h, vals in self.pptx_adj.get(self.slide, []):
            if abs(x - g.x) < 1 and abs(y - g.y) < 1 and abs(w - g.w) < 1 and abs(h - g.h) < 1: return vals
        return None

    def resolve_shape(self, el: dict, g: Geometry) -> dict | None:
        """The IR's shape: what Google draws, inheritance followed. None for an empty placeholder."""
        sh = el["shape"]
        kind = sh.get("shapeType", "TEXT_BOX")
        ph = sh.get("placeholder", {}).get("type")
        text = sh.get("text", {})
        has_text = bool(self.plain_text(text))
        if ph and not has_text: return None   # an empty placeholder: Slides doesn't show it
        name = self.presets.get(kind, "__missing__") if kind != "TEXT_BOX" else None
        if name not in (None, "rect", "ellipse", "__missing__") and not getattr(self, "_adj_noted", False):
            self._adj_noted = True
            self.log.append("shape adjust handles (arrow head size, corner radius, X thickness …) aren't in the Slides API: presets use their defaults; fix by eye where it shows")
        if name == "__missing__":
            self.log.append(f"slide {self.slide}: shape type {kind} isn't a preset shapes.js has; drawn as a rectangle")
            name = "rect"
        sc, sw, dash = self.outline(el)
        af = self.prop(el, "autofit", default={}) or {}
        adj = self.pptx_adjust(g) if name else None
        if adj is not None and kind == "WEDGE_ROUND_RECTANGLE_CALLOUT": adj = adj[:2]   # the export says its corner is 0; Google draws ECMA's
        return {"kind": kind, "preset": name, "placeholder": ph, "fill": self.fill(el), "outline": {"color": sc, "width": sw, "dash": dash},
                "adjust": adj if adj is not None else list(GOOGLE_ADJ[kind](g.w, g.h)) if name and kind in GOOGLE_ADJ and g.w > 0 and g.h > 0 else [],
                "valign": self.prop(el, "contentAlignment", default="TOP" if not name else "MIDDLE"),
                "autofit": {"type": af.get("autofitType", "NONE"), "scale": float(af.get("fontScale", 1) or 1),
                            "lineReduction": float(af.get("lineSpacingReduction", 0) or 0)},
                "label": el.get("description") or el.get("title") or "", "paragraphs": self.resolve_text(el, text) if has_text else []}

    def shape(self, el: dict, g: Geometry) -> str | None:
        s = self.resolve_shape(el, g)
        if s is None: return None
        name, fill, (sc, sw, dash), ph = s["preset"], s["fill"], s["outline"].values(), s["placeholder"]
        style = g.style()
        attrs = ""
        if name:
            attrs += f' data-shape="{name}"'
            for n, v in enumerate(s["adjust"], 1): attrs += f' data-adj{"" if n == 1 else n}="{v}"'
            style += f" --fill: {fill or 'transparent'}; --stroke: {sc or 'transparent'}; --sw: {_px(sw)}px;"
        else:
            if fill: style += f" --fill: {fill};"
            if sc: style += f" --stroke: {sc}; --sw: {_px(sw)}px;"
        if dash and sc: attrs += f' data-dash="{dash}"'
        if g.flip: attrs += ' data-flip="h"'
        if ph in ("TITLE", "CENTERED_TITLE"): attrs += ' data-role="title"'
        elif ph == "SUBTITLE": attrs += ' data-role="sub"'
        elif ph == "BODY": attrs += ' data-role="body"'
        va = s["valign"]
        if va in VALIGN and not (name and va == "MIDDLE"): attrs += f' data-valign="{VALIGN[va]}"'
        kind_af = s["autofit"]["type"]
        if kind_af == "TEXT_AUTOFIT": attrs += ' data-autofit="shrink"'
        elif kind_af == "SHAPE_AUTOFIT": attrs += ' data-autofit="resize"'
        elif s["paragraphs"]: attrs += ' data-autofit="none"'
        if s["label"]: attrs += f' aria-label="{html.escape(s["label"], quote=True)}"'
        content = self.text_html(s["paragraphs"], s["autofit"]["scale"], 1 - s["autofit"]["lineReduction"], in_text_box=s["kind"] == "TEXT_BOX") if s["paragraphs"] else ""
        cstyle = "padding: 19.2px 17.2px 19.2px 19.2px;" if not name else ""   # Google's text box inset: 0.1 in on every side; Google keeps a word that overflows the right one by up to 1 px at 96 dpi
        return (f'  <div class="box" id="{self.nid()}"{attrs} style="{style}">'
                f'<div class="content"{f" style={chr(34)}{cstyle}{chr(34)}" if cstyle else ""}>{content}</div></div>')

    def nearest_side(self, g: Geometry, px: float, py: float) -> str:
        sides = {"t": (g.x + g.w / 2, g.y), "b": (g.x + g.w / 2, g.y + g.h), "l": (g.x, g.y + g.h / 2), "r": (g.x + g.w, g.y + g.h / 2)}
        return min(sides, key=lambda s: math.hypot(sides[s][0] - px, sides[s][1] - py))

    def line(self, el: dict, g: Geometry) -> str:
        ln = el["line"]; lp = ln.get("lineProperties", {})
        lt = ln.get("lineType", "STRAIGHT_LINE")
        shape = "elbow" if lt.startswith("BENT") else "curve" if lt.startswith("CURVED") else "line"
        (x0, y0), (x1, y1) = g.point(0, 0), g.point(_emu(el.get("size", {}).get("width")), _emu(el.get("size", {}).get("height")))
        left, top, w, h = min(x0, x1), min(y0, y1), abs(x1 - x0), abs(y1 - y0)
        col = _color(lp.get("lineFill", {}).get("solidFill"), self.scheme) or "#000000"
        sw = _emu(lp.get("weight")) * self.k if lp.get("weight") else EMU_PT * self.k
        attrs = f' data-shape="{shape}"'
        if (x1 - x0) * (y1 - y0) < 0 and w > 0.5 and h > 0.5: attrs += ' data-dir="up"'
        if (x1 < x0) and (shape != "line" or h <= 0.5 or w <= 0.5): attrs += ' data-flip="h"'   # drawn right to left: the editor's flip keeps the ends in order
        d = DASH.get(lp.get("dashStyle", "SOLID"))
        if d: attrs += f' data-dash="{d}"'
        mirrored = x1 < x0 - 0.5 or (abs(x1 - x0) <= 0.5 and y1 < y0)   # the API's start is at the right (or bottom): swap, our from is the left end
        ends = (("endArrow", "data-start"), ("startArrow", "data-end")) if mirrored else (("startArrow", "data-start"), ("endArrow", "data-end"))
        for key, attr in ends:
            a = ARROW.get(lp.get(key, "NONE"))
            if a: attrs += f' {attr}="{a}"'
        conns = (("endConnection", "data-from", (x1, y1)), ("startConnection", "data-to", (x0, y0))) if mirrored else (("startConnection", "data-from", (x0, y0)), ("endConnection", "data-to", (x1, y1)))
        for key, attr, (px_, py_) in conns:
            c = lp.get(key, {}).get("connectedObjectId")
            tgt = self.ids.get(c)
            if tgt: attrs += f' {attr}="{tgt[0]}:{self.nearest_side(tgt[1], px_, py_)}"'
        return (f'  <div class="box" id="{self.nid()}"{attrs} style="left: {_px(left)}px; top: {_px(top)}px; width: {_px(w)}px; height: {_px(h)}px; '
                f'--stroke: {col}; --sw: {_px(sw)}px;"><div class="content"></div></div>')

    def save(self, url: str | None, mime_hint: str = "", key: str = "") -> str | None:
        if not url: return None
        if key and self.images.get(key) and (self.deck / self.images[key]).exists(): return self.images[key]
        try:
            if url.startswith("data:"):
                head, b64 = url.split(",", 1); data = base64.b64decode(b64); mime = head[5:].split(";")[0]
            else:
                data = self.get(url)
                mime = {b"\x89PNG": "image/png", b"\xff\xd8": "image/jpeg", b"GIF8": "image/gif", b"RIFF": "image/webp", b"<svg": "image/svg+xml", b"<?xm": "image/svg+xml"}.get(
                    next((s for s in (b"\x89PNG", b"\xff\xd8", b"GIF8", b"RIFF", b"<svg", b"<?xm") if data.startswith(s)), b""), mime_hint or "image/png")
        except Exception as e:
            self.log.append(f"slide {self.slide}: a picture couldn't be downloaded ({e})")
            return None
        ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/svg+xml": ".svg"}.get(mime, ".png")
        name = f"s{self.slide:02d}-{hashlib.sha1(data).hexdigest()[:10]}{ext}"
        (self.deck / "assets").mkdir(parents=True, exist_ok=True)
        (self.deck / "assets" / name).write_bytes(data)
        if key: self.images[key] = f"assets/{name}"
        return f"assets/{name}"

    def image(self, el: dict, g: Geometry, url: str | None, props: dict) -> str:
        src = self.save(url, key=el.get("objectId", ""))
        attrs = ""
        cp = props.get("cropProperties", {})
        crop = [float(cp.get(k, 0)) for k in ("topOffset", "rightOffset", "bottomOffset", "leftOffset")]
        if any(c < -0.001 for c in crop):   # a negative offset shows empty space inside the box: move the box edge to the picture's
            tt, rr, bb, ll = crop
            fx, fy = 1 - ll - rr, 1 - tt - bb
            t2, r2, b2, l2 = (max(c, 0.0) for c in crop)
            if fx > 0 and fy > 0 and abs(g.rot) < 0.05:
                g.x += (l2 - ll) / fx * g.w; g.y += (t2 - tt) / fy * g.h
                g.w *= (1 - l2 - r2) / fx; g.h *= (1 - t2 - b2) / fy
                crop = [t2, r2, b2, l2]
        if any(c > 0.001 for c in crop): attrs += f' data-crop="{" ".join(f"{c:.4f}" for c in crop)}"'
        if g.flip: attrs += ' data-flip="h"'
        if props.get("shadow") and props["shadow"].get("propertyState", "RENDERED") == "RENDERED": attrs += " data-shadow"
        alt = html.escape(el.get("description") or el.get("title") or "", quote=True)
        # Slides stretches a picture to its box (the box carries the aspect ratio); the viewer's default is to letterbox
        op = " style=\"object-fit: fill" + (f'; opacity: {1 - float(props["transparency"]):.2f}' if props.get("transparency") else "") + '"'
        o = props.get("outline", {})
        style = g.style()
        if o.get("propertyState", "RENDERED") == "RENDERED" and o.get("outlineFill"):   # an outline that is present is drawn unless it says otherwise
            style += f" --stroke: {_color(o['outlineFill'].get('solidFill'), self.scheme) or '#000'}; --sw: {_px(_emu(o.get('weight')) * self.k or EMU_PT * self.k)}px;"
        img = f'<img src="{src}" alt="{alt}"{op}>' if src else ""
        return (f'  <div class="box image" id="{self.nid()}"{attrs} style="{style}"><div class="content">{img}</div></div>'
                + ("" if src else "  <!-- picture not downloadable -->"))

    def video(self, el: dict, g: Geometry) -> str:
        v = el["video"]
        if v.get("source") == "YOUTUBE" and v.get("id"):
            url = f"https://www.youtube.com/embed/{v['id']}"
            return f'  <div class="box embed" id="{self.nid()}" style="{g.style()}"><div class="content"><iframe src="{url}" allowfullscreen></iframe></div></div>'
        self.log.append(f"slide {self.slide}: a Drive video can't be downloaded through the API; left as a link box")
        return (f'  <div class="box" id="{self.nid()}" data-shape="rect" style="{g.style()} --fill: #202124; --stroke: transparent; --sw: 0px;">'
                f'<div class="content" style="color: #fff"><a href="{html.escape(v.get("url", ""), quote=True)}">Video</a></div></div>')

    def table(self, el: dict, g: Geometry) -> str:
        t = el["table"]
        # the element's size is a placeholder (3000000 EMU): the real box is the sum of the column widths and row heights
        cols = [_emu(c.get("columnWidth")) * self.k for c in t.get("tableColumns", [])]
        hts = [_emu(r.get("rowHeight")) * self.k for r in t.get("tableRows", [])]
        if cols and sum(cols) > 1: g.w = sum(cols)
        if hts and sum(hts) > 1: g.h = sum(hts)
        colgroup = "".join(f'<col style="width: {100 * c / sum(cols):.2f}%">' for c in cols) if cols and sum(cols) > 1 else ""
        # borders: Slides gives one per cell edge; the first horizontal one stands for the table (1pt black is our default)
        border = ""
        for br in t.get("horizontalBorderRows", []) + t.get("verticalBorderRows", []):
            for bc in br.get("tableBorderCells", []):
                bp = bc.get("tableBorderProperties", {})
                col = _color(bp.get("tableBorderFill", {}).get("solidFill"), self.scheme)
                if col or bp.get("weight"):
                    w = _emu(bp.get("weight")) * self.k if bp.get("weight") else EMU_PT * self.k
                    border = f"border: {_px(w)}px {'dashed' if bp.get('dashStyle', 'SOLID') != 'SOLID' else 'solid'} {col or 'transparent'}; "
                    break
            if border: break
        rows = []
        for ri, r in enumerate(t.get("tableRows", [])):
            cells = []
            for c in r.get("tableCells", []):
                span = "".join(f' {k}="{c[j]}"' for j, k in (("rowSpan", "rowspan"), ("columnSpan", "colspan")) if c.get(j, 1) > 1)
                cf = c.get("tableCellProperties", {}).get("tableCellBackgroundFill", {})
                bg = _color(cf.get("solidFill"), self.scheme) if cf.get("propertyState", "RENDERED") == "RENDERED" else None
                st = f' style="padding: 19.2px; {border}{f"background: {bg}" if bg else ""}"'   # 0.1 in cell inset: closest to Google's renders overall (see Bugs)
                cells.append(f"<td{span}{st}>{self.text_html(self.resolve_text(el, c.get('text', {}))) or '<br>'}</td>")
            rh = f' style="height: {_px(hts[ri])}px"' if ri < len(hts) and hts[ri] > 1 else ""
            rows.append(f"<tr{rh}>" + "".join(cells) + "</tr>")
        return (f'  <div class="box table" id="{self.nid()}" data-valign="top" style="{g.style()}"><div class="content" style="padding: 0px;">'
                f'<table>{colgroup}{"".join(rows)}</table></div></div>')

    def convert(self, only=None) -> list:
        """Every slide (or the 1-based numbers in `only`) as a <section> string."""
        sections = []
        for n, page in enumerate(self.pres.get("slides", []), 1):
            if only and n not in only: continue
            self.slide, self.n, self.ids = n, 0, {}
            out = []
            for e in page.get("pageElements", []): self.convert_element(e, (1, 0, 0, 1, 0, 0), out)
            out = [(g, self.line(h[1], h[2]) if isinstance(h, tuple) else h) for g, h in out]   # the deferred lines, shapes now have ids
            pg = self.resolve_page(page)
            attrs = f' data-background-color="{pg["background"]["color"]}"'
            if pg["background"]["image"]:
                src = self.save(pg["background"]["image"], key="bg:" + page.get("objectId", str(n)))
                if src: attrs += f' data-background-image="{src}"'
            if pg["hidden"]: attrs += ' data-visibility="hidden"'
            lines = [h for _, h in out]
            if pg["notes"]: lines.append(f'  <aside class="notes">{html.escape(pg["notes"])}</aside>')
            sections.append(f"<section{attrs}>\n" + "\n".join(lines) + "\n</section>")
        return sections


    def ir(self) -> dict:
        """The whole IR as plain data: pages and shapes resolved; images, lines, tables, videos and
        charts so far as their geometry and the API's own object ("raw")."""
        log, self.log = self.log, []   # resolving again would log twice
        slides = []
        for n, page in enumerate(self.pres.get("slides", []), 1):
            self.slide = n
            slides.append({"id": page.get("objectId"), **self.resolve_page(page),
                           "elements": [e for el in page.get("pageElements", []) for e in [self.element_ir(el, (1, 0, 0, 1, 0, 0))] if e]})
        self.log = log
        return {"id": self.pres.get("presentationId", ""), "title": self.pres.get("title", ""), "size": {"w": 1920, "h": self.height}, "slides": slides}

    def element_ir(self, el: dict, parent: tuple) -> dict | None:
        m = _mul(parent, _mat(el.get("transform")))
        g = Geometry(m, el.get("size"), self.k)
        box = {"id": el.get("objectId"), "x": round(g.x, 2), "y": round(g.y, 2), "w": round(g.w, 2), "h": round(g.h, 2), "rotation": round(g.rot, 2),
               "flipH": g.flip, "label": el.get("description") or el.get("title") or ""}
        if "elementGroup" in el:
            return {"type": "group", **box, "children": [e for ch in el["elementGroup"].get("children", []) for e in [self.element_ir(ch, m)] if e]}
        if "shape" in el:
            s = self.resolve_shape(el, g)
            if not s: return None
            return {"type": "shape", **box, **{k: v for k, v in s.items() if k not in ("paragraphs", "label")}, "paragraphs": [self.para_ir(q) for q in s["paragraphs"]]}
        if "line" in el:
            lp = el["line"].get("lineProperties", {})
            (x0, y0), (x1, y1) = g.point(0, 0), g.point(_emu(el.get("size", {}).get("width")), _emu(el.get("size", {}).get("height")))
            return {"type": "line", **box, "kind": el["line"].get("lineType", "STRAIGHT_LINE"), "from": [round(x0, 2), round(y0, 2)], "to": [round(x1, 2), round(y1, 2)],
                    "color": _color(lp.get("lineFill", {}).get("solidFill"), self.scheme) or "#000000", "weight": _emu(lp.get("weight")) * self.k if lp.get("weight") else EMU_PT * self.k,
                    "dash": lp.get("dashStyle", "SOLID"), "startArrow": lp.get("startArrow", "NONE"), "endArrow": lp.get("endArrow", "NONE"),
                    "connections": {k: (lp.get(k + "Connection") or {}).get("connectedObjectId") for k in ("start", "end")}}
        if "image" in el or "sheetsChart" in el:
            src = el.get("image") or el["sheetsChart"]
            pr = src.get("imageProperties") or src.get("sheetsChartProperties", {}).get("chartImageProperties", {}) or {}
            cp = pr.get("cropProperties", {}); o = pr.get("outline", {})
            return {"type": "image" if "image" in el else "chart", **box, "url": src.get("contentUrl"),
                    "crop": {k: float(cp.get(k + "Offset", 0)) for k in ("left", "top", "right", "bottom")}, "transparency": float(pr.get("transparency", 0) or 0),
                    "outline": {"color": _color(o.get("outlineFill", {}).get("solidFill"), self.scheme), "weight": _emu(o.get("weight")) * self.k}
                               if o.get("propertyState", "RENDERED") == "RENDERED" and o.get("outlineFill") else None,
                    "shadow": bool(pr.get("shadow") and pr["shadow"].get("propertyState", "RENDERED") == "RENDERED")}
        if "video" in el:
            v = el["video"]; vp = v.get("videoProperties", {})
            return {"type": "video", **box, "source": v.get("source"), "videoId": v.get("id"), "url": v.get("url"), "start": vp.get("start"), "end": vp.get("end")}
        if "table" in el:
            t = el["table"]
            cols, rows = [_emu(c.get("columnWidth")) * self.k for c in t.get("tableColumns", [])], [_emu(r.get("rowHeight")) * self.k for r in t.get("tableRows", [])]
            if sum(cols) > 1: box["w"] = round(sum(cols), 2)   # the element's own size is a placeholder: the table is its columns and rows
            if sum(rows) > 1: box["h"] = round(sum(rows), 2)
            return {"type": "table", **box, "columns": cols, "rows": rows,
                    "cells": [{"row": ri, "col": ci, "rowSpan": c.get("rowSpan", 1), "colSpan": c.get("columnSpan", 1),
                               "fill": _color(c.get("tableCellProperties", {}).get("tableCellBackgroundFill", {}).get("solidFill"), self.scheme),
                               "paragraphs": [self.para_ir(q) for q in self.resolve_text(el, c.get("text", {}))]}
                              for ri, r in enumerate(t.get("tableRows", [])) for ci, c in enumerate(r.get("tableCells", []))]}
        if "wordArt" in el: return {"type": "wordArt", **box, "text": el["wordArt"].get("renderedText", "")}
        return {"type": "unknown", **box, "keys": [k for k in el if k not in ("objectId", "size", "transform", "title", "description")]}

    def run_ir(self, st: dict) -> dict:
        """A resolved run style in the IR's units: family, weight, size pt, colours #rrggbb (theme colours resolved)."""
        wf = st.get("weightedFontFamily") or {}
        return {"font": wf.get("fontFamily") or st.get("fontFamily"), "weight": wf.get("weight", 700 if st.get("bold") else 400),
                "size": float((st.get("fontSize") or {}).get("magnitude", 14)), "bold": bool(st.get("bold")), "italic": bool(st.get("italic")),
                "underline": bool(st.get("underline")), "strikethrough": bool(st.get("strikethrough")), "smallCaps": bool(st.get("smallCaps")),
                "color": _rgb(st.get("foregroundColor"), self.scheme), "highlight": _rgb(st.get("backgroundColor"), self.scheme),
                "offset": (st.get("baselineOffset") or "NONE").lower(), "link": (st.get("link") or {}).get("url") or (st.get("link") or {}).get("slideIndex")}

    def para_ir(self, q: dict) -> dict:
        """A resolved paragraph (resolve_text) in the IR's units: pt, percent, Google's list glyph."""
        ps = q["style"]; pt = lambda k: float((ps.get(k) or {}).get("magnitude", 0) or 0)
        b = q["bullet"]
        return {"align": ps.get("alignment", "START"), "spacing": float(ps.get("lineSpacing", 100) or 100), "spaceAbove": pt("spaceAbove"), "spaceBelow": pt("spaceBelow"),
                "indentStart": pt("indentStart"), "indentFirstLine": pt("indentFirstLine"), "spacingMode": ps.get("spacingMode", "COLLAPSE_LISTS"),
                "list": {"level": q["level"], "glyph": (b.get("glyph") or "").strip(),
                         "color": _rgb((b.get("bulletStyle") or {}).get("foregroundColor"), self.scheme)} if b else None,
                "runs": [{"text": r["text"].rstrip("\n"), **self.run_ir(r["style"])} if "text" in r else {"auto": r["auto"]} for r in q["runs"]]}

    # ---- pages
    def resolve_page(self, page: dict) -> dict:
        """The IR's page: background (colour, image url) through slide → layout → master, hidden, speaker notes."""
        bg, img = self.background(page)
        return {"background": {"color": bg, "image": img}, "hidden": bool(page.get("slideProperties", {}).get("isSkipped")), "notes": self.notes(page)}

    def background(self, page: dict) -> tuple:
        """(colour, image url) with inheritance slide → layout → master."""
        chain = [page]
        sp = page.get("slideProperties", {})
        for key in ("layoutObjectId", "masterObjectId"):
            if sp.get(key) in self.pages: chain.append(self.pages[sp[key]])
        lp = page.get("layoutProperties", {})
        if lp.get("masterObjectId") in self.pages: chain.append(self.pages[lp["masterObjectId"]])
        for p in chain:
            f = p.get("pageProperties", {}).get("pageBackgroundFill")
            if not f or f.get("propertyState") == "INHERIT": continue
            if f.get("propertyState") == "NOT_RENDERED": return ("#ffffff", None)
            if "solidFill" in f: return (_color(f["solidFill"], self.scheme) or "#ffffff", None)
            if "stretchedPictureFill" in f: return ("#ffffff", f["stretchedPictureFill"].get("contentUrl"))
        return ("#ffffff", None)

    def notes(self, page: dict) -> str:
        np_ = page.get("slideProperties", {}).get("notesPage", {})
        for e in np_.get("pageElements", []):
            if e.get("shape", {}).get("placeholder", {}).get("type") == "BODY":
                return self.plain_text(e["shape"].get("text", {}))
        return ""

    def convert_element(self, el: dict, parent: tuple, out: list):
        """One element (groups recurse) → (geometry, html) into out; lines are deferred until every shape has an id."""
        m = _mul(parent, _mat(el.get("transform")))
        g = Geometry(m, el.get("size"), self.k)
        if "elementGroup" in el:
            inner = []
            for ch in el["elementGroup"].get("children", []): self.convert_element(ch, m, inner)
            inner = [(g_, self.line(h[1], h[2]) if isinstance(h, tuple) else h) for g_, h in inner]
            boxes = [b for b in inner if b[0] is not None]
            if not boxes: return
            x0 = min(b.x for b, _ in boxes); y0 = min(b.y for b, _ in boxes)
            x1 = max(b.x + b.w for b, _ in boxes); y1 = max(b.y + b.h for b, _ in boxes)
            rel = ["    " + h.replace(f"left: {_px(b.x)}px; top: {_px(b.y)}px;", f"left: {_px(b.x - x0)}px; top: {_px(b.y - y0)}px;", 1) for b, h in boxes]
            out.append((None, f'  <div class="box group" id="{self.nid()}" style="left: {_px(x0)}px; top: {_px(y0)}px; width: {_px(x1 - x0)}px; height: {_px(y1 - y0)}px;">\n'
                              + "\n".join(rel) + "\n  </div>"))
            return
        if "line" in el:   # lines are deferred so every shape they can attach to has an id
            out.append((g, ("__line__", el, g))); return
        if "shape" in el: h = self.shape(el, g)
        elif "image" in el: h = self.image(el, g, el["image"].get("contentUrl"), el["image"].get("imageProperties", {}))
        elif "sheetsChart" in el: h = self.image(el, g, el["sheetsChart"].get("contentUrl"), el["sheetsChart"].get("sheetsChartProperties", {}).get("chartImageProperties", {}))
        elif "video" in el: h = self.video(el, g)
        elif "table" in el: h = self.table(el, g)
        elif "wordArt" in el: h = (f'  <div class="box" id="{self.nid()}" data-valign="top" style="{g.style()}"><div class="content" style="font-size: {_px(g.h * 0.6)}px; font-weight: bold">'
                                   f'{html.escape(el["wordArt"].get("renderedText", ""))}</div></div>')
        else:
            self.log.append(f"slide {self.slide}: skipped an element the importer doesn't know ({', '.join(k for k in el if k not in ('objectId', 'size', 'transform', 'title', 'description'))})")
            return
        if h:
            m_ = re.search(r'id="([^"]+)"', h)
            if m_: self.ids[el["objectId"]] = (m_.group(1), g)
            out.append((g, h))


# ---------------------------------------------------------------- the deck file

def write_deck(deck: Path, sections: list, title: str, height: int, fonts: set, keep=False, glyphs: str = "") -> Path:
    path = deck / "deck.html"
    deck.mkdir(parents=True, exist_ok=True)
    if not path.exists(): new_deck(path, title)
    text = path.read_text()
    joined = "\n".join(sections)
    if keep: text = text.replace("\n</div></div>\n<script", "\n" + joined + "\n</div></div>\n<script", 1)
    else: text = re.sub(r'(<div class="slides"[^>]*>\n).*?(\n</div></div>)', lambda m: m.group(1) + joined + m.group(2), text, count=1, flags=re.S)
    if height != 1080: text = re.sub(r'<div class="slides"[^>]*>', f'<div class="slides" data-size="1920x{height}">', text, count=1)
    google = sorted(f for f in fonts if f in Converter._google_fonts())
    if google:
        link = ('<link id="deck-fonts" rel="stylesheet" href="https://fonts.googleapis.com/css2?' +
                "&".join("family=" + f.replace(" ", "+") + ":ital,wght@0,400;0,700;1,400;1,700" for f in google) + '&display=swap">')
        if 'id="deck-fonts"' in text: text = re.sub(r'<link id="deck-fonts"[^>]*>', link, text, count=1)
        else: text = text.replace("</head>", link + "\n</head>", 1)
        # the characters Google Fonts' subsets (latin, latin-ext …) may leave out, from the full fonts as Slides has them (→ in Montserrat)
        text = re.sub(r'<link id="deck-fonts-text"[^>]*>\n?', "", text, count=1)
        if glyphs:
            extra = ('<link id="deck-fonts-text" rel="stylesheet" href="https://fonts.googleapis.com/css2?' + "&".join("family=" + f.replace(" ", "+") + ":ital,wght@0,400;0,700;1,400;1,700" for f in google) +
                     "&text=" + urllib.parse.quote("".join(sorted(set(glyphs)))) + '&display=swap">')
            text = text.replace("</head>", extra + "\n</head>", 1)
    if title: text = re.sub(r"<title>.*?</title>", f"<title>{html.escape(title)}</title>", text, count=1, flags=re.S)
    path.write_text(text)
    return path


def pptx_adjusts(pptx: Path, k: float) -> dict:
    """{slide number: [(x, y, w, h in canvas px, [adjust values 0–1])]} for every top-level preset shape with an avLst
    in a .pptx (standard library only: the slides' XML, in the presentation's order)."""
    import zipfile
    out = {}
    with zipfile.ZipFile(pptx) as z:
        rels = dict(re.findall(r'Id="([^"]+)"[^>]*Target="([^"]+)"', z.read("ppt/_rels/presentation.xml.rels").decode()))
        order = re.findall(r'<p:sldId [^>]*r:id="([^"]+)"', z.read("ppt/presentation.xml").decode())
        for n, rid in enumerate(order, 1):
            x = z.read("ppt/" + rels[rid].lstrip("/").replace("ppt/", "")).decode()
            tree = x[x.find("<p:spTree>"):]
            for sp in re.findall(r"<p:sp>.*?</p:sp>", tree, re.S):
                m = re.search(r'<a:off x="(-?\d+)" y="(-?\d+)"/><a:ext cx="(\d+)" cy="(\d+)"/>', sp)
                av = re.search(r'<a:prstGeom prst="\w+"><a:avLst>(.*?)</a:avLst>', sp, re.S)
                if not m or not av: continue
                gd = dict((nm, int(v)) for v, nm in re.findall(r'<a:gd fmla="val (-?\d+)" name="(\w+)"/>', av.group(1)))
                vals = [gd[a] / 100000 for a in sorted((a for a in gd if re.fullmatch(r"adj\d*", a)), key=lambda a: int(a[3:] or 1))]
                if vals: out.setdefault(n, []).append((*(int(v) * k for v in m.groups()), vals))
    return out


def import_deck(pres: dict, deck: Path, pptx: Path | None = None, get=None) -> dict:
    """The whole thing for a fetched presentation: sections into deck/deck.html (+ assets/), notes/builds from a .pptx. Returns a summary."""
    conv = Converter(pres, deck, get=get)
    if pptx: conv.pptx_adj = pptx_adjusts(pptx, conv.k)
    sections = conv.convert()
    if pptx:
        sections = apply_pptx(sections, pptx, pres)
    write_deck(deck, sections, pres.get("title", ""), conv.height, conv.fonts, glyphs="".join(conv.glyphs))
    if conv.images:
        conv.images_file.parent.mkdir(parents=True, exist_ok=True); conv.images_file.write_text(json.dumps(conv.images, indent=1))
    log = deck / "source" / "import-log.txt"
    if conv.log:
        log.parent.mkdir(parents=True, exist_ok=True)
        log.write_text("glideshow import-google: things to check by hand\n\n" + "".join(l + "\n" for l in conv.log))
    elif log.exists(): log.unlink()
    return {"slides": len(sections), "fonts": sorted(conv.fonts), "log": conv.log, "height": conv.height}


def apply_pptx(sections: list, pptx: Path, pres: dict) -> list:
    """Speaker notes (when the API gave none) and click builds as fragments, from the deck's own .pptx download."""
    sys.path.insert(0, str(EDITOR.parent / "tools"))
    try:
        from gslides2deck import pptx_extras, apply_builds
    except ImportError:
        print("--pptx needs tools/gslides2deck.py (a checkout); skipped"); return sections
    W = _emu(pres["pageSize"]["width"])
    try: ex = pptx_extras(pptx, W)   # geometry in EMU, same units as the API
    except ImportError:   # python-pptx isn't installed: notes and builds are skipped (adjust values don't need it)
        print("--pptx: speaker notes and click builds need python-pptx (uv run --with python-pptx …); skipped"); return sections
    k = 1920 / W
    out = []
    for n, sec in enumerate(sections, 1):
        e = ex.get(n, {})
        lines = sec.split("\n")
        if e.get("builds"): lines = apply_builds(lines, e["builds"], k)
        if e.get("notes") and '<aside class="notes">' not in sec:
            lines.insert(-1, f'  <aside class="notes">{html.escape(e["notes"])}</aside>')
        out.append("\n".join(lines))
    return out


# ---------------------------------------------------------------- report (our render vs Google's thumbnails)

def report(deck: Path, refs: list) -> list:
    """Mean |difference| per slide (0–255, at 480 × 270, lightly blurred) between our render (test/snap.py) and Google's thumbnail. Needs playwright."""
    try: from playwright.sync_api import sync_playwright
    except ImportError:
        print("scores need playwright (`uv run --with playwright`); skipped"); return []
    import subprocess, tempfile
    snap = EDITOR.parent / "test" / "snap.py"
    out = Path(tempfile.mkdtemp(prefix="slides-snap-"))
    subprocess.run([sys.executable, str(snap), str(deck), str(out)], check=False, capture_output=True)
    scores = []
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome"); pg = b.new_page()
        for n, ref in enumerate(refs, 1):
            ours = out / f"slide-{n:02d}.png"
            if not ours.exists(): scores.append(None); continue
            a = "data:image/png;base64," + base64.b64encode(ref.read_bytes()).decode()
            c = "data:image/png;base64," + base64.b64encode(ours.read_bytes()).decode()
            scores.append(pg.evaluate("""async ([a, b]) => { const load = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = s; });
              const [ia, ib] = await Promise.all([load(a), load(b)]); const W = 480, H = 270;
              // a slight blur first, so a text line a few pixels off reads as a small difference, not a missing line
              const px = i => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.filter = 'blur(1.5px)'; x.drawImage(i, 0, 0, W, H); return x.getImageData(0, 0, W, H).data; };
              const pa = px(ia), pb = px(ib); let s = 0; for (let i = 0; i < pa.length; i += 4) s += Math.abs(pa[i] - pb[i]) + Math.abs(pa[i+1] - pb[i+1]) + Math.abs(pa[i+2] - pb[i+2]);
              return s / (pa.length / 4 * 3); }""", [a, c]))
        b.close()
    return scores


# ---------------------------------------------------------------- the command

def bookmarklet() -> str:
    """The embed-viewer capture (tools/gslides2deck.py snippet) as a bookmarklet, for accounts that can't add an OAuth client."""
    tool = EDITOR.parent / "tools" / "gslides2deck.py"
    import subprocess
    r = subprocess.run([sys.executable, str(tool), "snippet"], capture_output=True, text=True)
    if r.returncode: raise SystemExit("tools/gslides2deck.py snippet failed:\n" + r.stderr[-400:])
    return "javascript:" + urllib.parse.quote("void(async()=>{" + r.stdout.strip() + "})()", safe="")   # the snippet awaits: it needs an async wrapper


def main(argv: list):
    args = [a for a in argv]
    flags = {a for a in args if a.startswith("--") and "=" not in a}
    pptx = None
    if "--pptx" in args:
        i = args.index("--pptx"); pptx = Path(args[i + 1]).expanduser(); del args[i:i + 2]
    only = None
    if "--slides" in args:
        i = args.index("--slides"); only = set();
        for part in args[i + 1].split(","):
            a, _, b = part.partition("-"); only.update(range(int(a), int(b or a) + 1))
        del args[i:i + 2]
    pos = [a for a in args if not a.startswith("--")]
    if "--login" in flags:
        login(); return
    if "--bookmarklet" in flags:
        print("Drag this to the bookmarks bar, open the deck in Google Slides, click it; then: glideshow import-google gslides-<id>.json\n")
        print(bookmarklet()); return
    if not pos: raise SystemExit(__doc__)
    src, dest = pos[0], pos[1] if len(pos) > 1 else None
    if src.endswith(".json") and Path(src).expanduser().exists():
        data = json.loads(Path(src).expanduser().read_text())
        if "slides" in data and "pageSize" not in data:   # a capture from the bookmarklet / snippet: the SVG converter handles it
            import subprocess
            deck = Path(dest).expanduser() if dest else HOME / _slug(data.get("title") or Path(src).stem)
            cmd = [sys.executable, str(EDITOR.parent / "tools" / "gslides2deck.py"), "convert", str(Path(src).expanduser()), str(deck)] + (["--pptx", str(pptx)] if pptx else [])
            subprocess.run(cmd, check=True); return _open(deck, flags)
        pres, pid = data, data.get("presentationId", "")
    else:
        pid = presentation_id(src)
        print(f"Fetching {pid} from the Google Slides API…")
        pres = fetch(pid)
    title = pres.get("title") or "Imported deck"
    deck = Path(dest).expanduser() if dest and ("/" in dest or Path(dest).exists()) else HOME / _slug(dest or title)
    deck.mkdir(parents=True, exist_ok=True)
    if pid:
        (deck / "source").mkdir(exist_ok=True)
        (deck / "source" / f"gslides-api-{pid}.json").write_text(json.dumps(pres))   # the raw response, so a re-run needs no network
    info = import_deck(pres, deck, pptx=pptx)
    if "--ir" in flags:   # the IR beside the raw response, for reading what the importer drew from
        (deck / "source").mkdir(exist_ok=True)
        (deck / "source" / "ir.json").write_text(json.dumps(Converter(pres, deck).ir(), indent=1, ensure_ascii=False))
    print(f"wrote {deck / 'deck.html'}: {info['slides']} slides" + (f", Google Fonts: {', '.join(info['fonts'])}" if info["fonts"] else ""))
    for l in info["log"]: print("  " + l)
    if "--report" in flags:
        if not pid: print("--report needs the live deck (thumbnails come from the API)")
        else:
            refs = thumbnails(pid, pres, deck / "refs")
            scores = report(deck, refs)
            if scores:
                print("mean pixel difference vs Google's render (under 3 is at parity, over 6 needs a look):")
                for n, s in enumerate(scores, 1): print(f"  slide {n:>3}  {'-' if s is None else f'{s:5.1f}'}")
            print(f"references in {deck / 'refs'}")
    _open(deck, flags)


def _slug(title: str) -> str:
    import datetime
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or "deck"
    return f"{s}-{datetime.date.today().isoformat()}"


def _open(deck: Path, flags: set):
    if "--no-open" in flags: return
    from .cli import serve
    serve(deck, True)


if __name__ == "__main__":
    main(sys.argv[1:])
