# /// script
# dependencies = ["playwright"]
# ///
"""Glideshow (cloud/) end to end in headless Chrome, against a local copy on a scratch branch of the library repo:

    git -C ~/decks push origin main:cloud-test
    cd cloud && npx wrangler dev --port 8790 --local-upstream localhost:8790   # (else links are made on glideshow.org, wrangler.toml's route); .dev.vars: the app's secrets, SESSION_KEY, DEV_LOGIN=1, DEV_REPO, DEV_BRANCH=cloud-test, GITHUB_WEBHOOK_SECRET (any value: the push webhook checks; without it they're skipped)
    uv run test/cloud.py
    uv run test/cloud.py --drive                 # a Google account's library in Drive, against test/fake_drive.py on :8791
                                                 # (.dev.vars also: DEV_DRIVE=1, DRIVE_API=http://localhost:8791,
                                                 #  GOOGLE_TOKEN_URL=http://localhost:8791/token, GOOGLE_CLIENT_ID/SECRET=anything)

Signs in through /auth/dev (wrangler dev only), as the owner and as viewers; makes, shares, comments on, moves and
removes a test deck on the branch. `--live` checks only what needs no sign-in on the real site.
"""
import argparse, json, re, subprocess, sys, tempfile, time
from pathlib import Path
from urllib.parse import quote
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("--url", default="http://localhost:8790")
ap.add_argument("--repo", default="heyodog0/decks")
ap.add_argument("--branch", default="cloud-test")
ap.add_argument("--live", action="store_true", help="the real site: the signed-out pages only")
ap.add_argument("--drive", action="store_true", help="the owner is a Google account with a Drive library (the fake Drive on :8791)")
ap.add_argument("--drive-api", default="http://localhost:8791")
args = ap.parse_args()
if not args.live and args.branch == "main": sys.exit("the full run changes its branch: point the editor at a test branch")
failures = []
SLOW = 30000 if args.drive else 120000   # ms: a library on GitHub waits on GitHub's API, a shared link's first view most of all
OWNER = {"id": "g-owner", "login": "g.heyodogo"} if args.drive else json.loads(subprocess.run(["gh", "api", "user"], capture_output=True, text=True).stdout or "{}")
drive_state = lambda: json.load(__import__("urllib.request").request.urlopen(args.drive_api + "/__state"))


def check(name, ok, detail: object = ""):
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail and not ok else ""), flush=True)
    if not ok: failures.append(name)


def gh(path, *extra):
    return subprocess.run(["gh", "api", path, *extra], capture_output=True, text=True).stdout


with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    errors = []

    def page():
        pg = b.new_context(viewport={"width": 1400, "height": 900}).new_page(); pg.set_default_timeout(SLOW)
        pg.on("pageerror", lambda e: errors.append(str(e)))
        return pg

    def as_(pg, next="/", **who):   # wrangler dev's sign-in, as anyone
        pg.goto(f"{args.url}/auth/dev?next={quote(next)}&" + "&".join(f"{k}={quote(str(v))}" for k, v in who.items()))

    pg = page()
    api = lambda path: pg.evaluate("p => fetch(p).then(r => r.json())", path)
    post = lambda path, body: pg.evaluate("([p, b]) => fetch(p, { method: 'POST', headers: { 'X-Glideshow': '1' }, body: JSON.stringify(b) }).then(r => r.json())", [path, body])

    pg.goto(args.url + "/")
    check("signed out: the public home page, with the privacy policy and terms (Google asks for them)", pg.locator("a", has_text="Sign in").count() == 1
          and all(pg.evaluate(f"fetch('{u}').then(r => r.ok)") for u in ("/privacy", "/terms")))
    pg.goto(args.url + "/edit")
    check("signed out: the editor asks you to sign in, with GitHub", "/login" in pg.url and pg.locator("a", has_text="Continue with GitHub").count() == 1, pg.url)
    r = pg.evaluate("() => fetch('/api/decks').then(r => r.status)")
    check("signed out: the API refuses", r == 401, r)
    g = lambda nxt: pg.evaluate("n => fetch('/login?next=' + encodeURIComponent(n)).then(r => r.text()).then(t => (t.match(/href=\"(\\/auth\\/google[^\"]*)\"/) || [])[1] || '')", nxt)
    home, link = g("/"), g("/p/someone/some-deck/")
    check("Continue with Google asks for Drive too when you sign in to make decks, and only who you are for a shared link",
          not home or ("drive=1" in home and "drive=1" not in link), (home, link))
    if args.live:
        check("robots are kept out", "Disallow: /" in pg.evaluate("() => fetch('/robots.txt').then(r => r.text())"))
    else:
        # no account, a folder on this computer (editor/lib/store-folder.js): the browser's private file system stands in for
        # the folder a person picks, which a test can't click through
        fp = page(); fdir = "(await (await navigator.storage.getDirectory()).getDirectoryHandle('decks', { create: true }))"
        fp.goto(args.url + "/"); check("the front page offers Use a folder on this computer (Chrome)", fp.is_visible("#use-folder"))
        fp.evaluate(f"async () => (await import('/editor/lib/store-folder.js')).setFolder({fdir})")
        fp.goto(args.url + "/start"); fp.wait_for_url(args.url + "/", timeout=SLOW); fp.wait_for_selector("#hm-new", timeout=SLOW)
        check("folder mode: the home screen has the folder and says the decks are only there", fp.evaluate("window.GLIDESHOW_CLOUD?.folder") == {"name": "decks", "ok": True}
              and "in the folder “decks” on this computer" in fp.inner_text(".hm-move"))
        fp.click("#hm-new"); fp.wait_for_url("**/edit"); fp.wait_for_selector("body.draft"); fp.fill("#ed-title", "Folder deck"); fp.keyboard.press("Enter")
        fp.wait_for_function("!document.body.classList.contains('draft')", timeout=20000)
        fp.evaluate("() => { content(slides[0].querySelector('[data-role=title]')).textContent = 'Written to the folder'; render(); commit(); }")
        files = f"""async () => {{ const out = {{}}, walk = async (d, at) => {{ for await (const [n, h] of d.entries()) h.kind === 'directory' ? await walk(h, at + n + '/') : out[at + n] = await (await h.getFile()).text(); }};
          await walk({fdir}, ''); return out; }}"""
        path = ""
        for _ in range(60):   # (wait_for_function would take the promise itself as done)
            path = next((k for k, v in fp.evaluate(files).items() if k.endswith("deck.html") and "Written to the folder" in v), "")
            if path: break
            fp.wait_for_timeout(500)
        check("…a saved deck is a real folder with its deck.html in the picked folder", path.count("/") == 1, path)
        fp.evaluate(f"""async ([p, from, to]) => {{ const [d, n] = p.split('/'), fh = await (await {fdir}.getDirectoryHandle(d)).getFileHandle(n);
          const t = (await (await fh.getFile()).text()).replace(from, to), w = await fh.createWritable(); await w.write(t); await w.close(); }}""", [path, "Written to the folder", "Changed by an agent"])
        for _ in range(30):
            if "Changed by an agent" in fp.evaluate("fetch('/api/deck').then(r => r.json()).then(j => j.html)"): break
            fp.wait_for_timeout(1000)
        hist = fp.evaluate("fetch('/api/history').then(r => r.json())")
        check("…an edit made in the folder from outside comes into the open deck, as its own version", any("outside the editor" in (h.get("message") or "") for h in hist), hist[:3])
        fp.goto(args.url + "/"); fp.wait_for_selector("#hm-new"); fp.click("#hm-app-more"); fp.click("text=Stop using this folder"); fp.wait_for_timeout(1500); fp.wait_for_selector(".hm-card")
        check("…Stop using this folder: back to the library in this browser, the deck still there", fp.evaluate("window.GLIDESHOW_CLOUD?.folder") is None
              and "Folder deck" in fp.inner_text("#hm-grid"))
        fp.context.close()

        # no account: Start a deck keeps a library in this browser (editor/local/sw.js)
        lp = page(); here = "document.querySelector('#ed-status').innerText.includes('All changes saved')"
        lp.goto(args.url + "/start"); lp.wait_for_url(args.url + "/", timeout=SLOW); lp.wait_for_selector("#hm-new", timeout=SLOW)
        check("Start a deck: the editor without an account, its library in this browser", lp.evaluate("!!navigator.serviceWorker.controller && window.GLIDESHOW_CLOUD?.local === true"))
        check("…which says the decks live only in this browser, and how to keep them", "only in this browser" in lp.inner_text(".hm-move"))
        lp.click("#hm-new"); lp.wait_for_url("**/edit"); lp.wait_for_selector("body.draft")
        lp.fill("#ed-title", "Browser deck"); lp.keyboard.press("Enter")
        lp.wait_for_function("!document.body.classList.contains('draft')", timeout=20000)
        lp.evaluate("() => { content(slides[0].querySelector('[data-role=title]')).textContent = 'Kept in this browser'; render(); commit(); }")
        lp.wait_for_function(here, timeout=20000)
        src = lp.evaluate("""async () => { const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
          const big = new Uint8Array(6000); big.set(png); crypto.getRandomValues(big.subarray(png.length));
          return (await (await fetch('/api/upload?ext=png', { method: 'POST', headers: { 'X-Glideshow': '1' }, body: big })).json()).src; }""")
        lp.evaluate("s => { slides[0].append(makeBox({ x: 100, y: 100, w: 200, h: 200, cls: 'image', html: `<img src=\"${s}\">` })); render(); commit(); }", src)
        img = lp.evaluate("s => fetch('/deck/' + s).then(r => r.ok && r.headers.get('content-type').startsWith('image/'))", src)
        check("…pictures are kept in the browser and served from it", bool(src) and img, src)
        lp.evaluate("addLive()"); lp.wait_for_function("boxes(slides[cur]).some(b => b.classList.contains('live'))", timeout=20000)
        live = lp.evaluate("""async () => { const f = boxes(slides[cur]).find(b => b.classList.contains('live')).querySelector('iframe'), r = await fetch(f.getAttribute('src'));
          return [f.getAttribute('sandbox'), r.status, r.headers.get('content-security-policy')]; }""")
        check("…a live box's page is kept in the browser and served sandboxed, its script allowed", live == ["allow-scripts allow-pointer-lock", 200, "sandbox allow-scripts allow-pointer-lock"], live)
        lp.reload(); lp.wait_for_function("document.querySelector('#ed-title')?.value === 'Browser deck'", timeout=SLOW)
        check("…the deck is still there after a reload", "Kept in this browser" in lp.evaluate("fetch('/api/deck').then(r => r.json()).then(j => j.html)") and lp.input_value("#ed-title") == "Browser deck")
        hist = []
        for _ in range(10):
            hist = lp.evaluate("fetch('/api/history').then(r => r.json())")
            if hist: break
            lp.wait_for_timeout(1000)
        check("…with its versions (version history works)", isinstance(hist, list) and len(hist) >= 1, hist)
        lp.evaluate("() => { content(slides[0].querySelector('[data-role=title]')).textContent = 'Kept in this browser, twice'; render(); commit(); }")
        lp.wait_for_function(here, timeout=20000)
        swap = lp.evaluate("""async () => {   // Restore the version before, then the newest again (what follows needs it)
          const j = p => fetch(p).then(r => r.json()), restore = rev => fetch('/api/restore', { method: 'POST', body: JSON.stringify({ rev }) }).then(r => r.json());
          const deck = async () => (await j('/api/deck')).html;
          let hist = []; for (let i = 0; i < 20 && hist.length < 2; i++) { hist = await j('/api/history'); if (hist.length < 2) await new Promise(r => setTimeout(r, 500)); }
          if (hist.length < 2) return { n: hist.length };
          await restore(hist[1].rev); const old = await deck();
          await restore(hist[0].rev); const again = await deck();
          return { n: hist.length, back: old.includes('Kept in this browser') && !old.includes(', twice'), again: again.includes(', twice') }; }""")
        check("…and Restore brings an older one back (and the newest again)", swap.get("back") and swap.get("again"), swap)
        lp.reload(); lp.wait_for_selector("#ed-title"); lp.wait_for_function("typeof deckDoc !== 'undefined' && !!deckDoc && slides.length > 0")
        with lp.expect_download() as dl:
            lp.evaluate("downloadOneFile()")
        one = Path(tempfile.mkdtemp(prefix="glideshow-onefile-")) / dl.value.suggested_filename; dl.value.save_as(one); body = one.read_text()
        check("Download → one file: the pictures and reveal.js inside", "data:image/png;base64," in body and "data-glideshow-src=" in body and "Kept in this browser" in body)
        off = b.new_context(offline=True).new_page(); off.goto("file://" + str(one)); off.wait_for_selector(".reveal.ready", timeout=15000)
        check("…it presents with no network at all", "Kept in this browser" in off.inner_text(".reveal"))
        off.context.close()
        with lp.expect_file_chooser() as fc:
            lp.evaluate("openDeckFile()")
        with lp.expect_navigation(timeout=SLOW):
            fc.value.set_files(str(one))   # brought in, then the editor reloads on it
        lp.wait_for_selector("#ed-title", timeout=20000)
        back = lp.evaluate("fetch('/api/deck').then(r => r.json()).then(j => j.html)")
        pic = (__import__("re").search(r'src="(assets/[^"]+)"', back) or [None, ""])[1]
        check("Open a deck file… brings it back, its picture a file again", "Kept in this browser" in back and "data-glideshow-src" not in back and pic and lp.evaluate("p => fetch('/deck/' + p).then(r => r.ok)", pic), pic)
        big = lp.evaluate("""async () => {   // one 8 MB picture: a pattern over its base64 overflowed the browser's regex engine
          const { unpack } = await import('/editor/lib/onefile.js'), b64 = 'QUJD'.repeat(2_800_000);
          const r = await unpack(`<!doctype html><html><head><title>t</title></head><body><section><img src="data:image/jpeg;base64,${b64}"></section></body></html>`);
          return { files: Object.values(r.files).map(b => b.length), inline: r.html.includes('base64,') };
        }""")
        check("…a deck file with an 8 MB picture comes apart into the deck and its picture", big["files"] == [8_400_000] and not big["inline"], big)
        trap = Path(one).with_name("trap.html")   # a deck file someone sends you, rigged to run as you
        trap.write_text(body.replace("Kept in this browser", 'Trapped<img src="x" onerror="window.pwned=1">'
                                     '<a href="javascript:window.pwned=2">x</a><iframe srcdoc="<script>parent.pwned=3</script>"></iframe>')
                            .replace("</body>", "<script>window.pwned=4</script></body>"))
        with lp.expect_file_chooser() as fc:
            lp.evaluate("openDeckFile()")
        with lp.expect_navigation(timeout=SLOW):
            fc.value.set_files(str(trap))
        lp.wait_for_selector("#ed-title", timeout=20000); lp.wait_for_timeout(1500)
        got = lp.evaluate("fetch('/api/deck').then(r => r.json()).then(j => j.html)")
        check("…and a rigged file comes in cleaned: its scripts, event handlers and javascript: links gone, nothing ran",
              "Trapped" in got and 'onerror="' not in got and "javascript:" not in got and "srcdoc" not in got and "pwned=4" not in got
              and lp.evaluate("window.pwned") is None and 'id="deck-present"' in got,
              {k: k in got for k in ("Trapped", 'onerror="', "javascript:", "srcdoc", "pwned=4", 'id="deck-present"')} | {"ran": lp.evaluate("window.pwned")})
        pruned = lp.evaluate("""async () => {   // 130 versions of one file: the newest 100 stay, older versions' files go
          const { BrowserStore } = await import('/editor/lib/store-browser.js'), { keys } = await import('/editor/lib/browser-db.js');
          const st = new BrowserStore({ base: null }); let base = await st.head(null) || { id: 'root', tree: {} };
          const before = (await keys('blobs')).length;
          for (let i = 0; i < 130; i++) base = (await st.write(base, [{ path: 'prune-test/x.txt', bytes: new TextEncoder().encode('v' + i) }], 'v' + i)).base;
          const hist = await st.history('prune-test/x.txt', 1000), blobs = (await keys('blobs')).length;
          base = (await st.write(base, [{ path: 'prune-test/x.txt', del: true }], 'clean up')).base;
          return { hist: hist.length, grew: blobs - before };
        }""")
        check("…and clears out old versions and their files (the newest 100 stay; it tidies every 25 saves)", pruned["hist"] < 125 and pruned["grew"] < 125, pruned)
        share = lp.evaluate("fetch('/api/publish').then(r => r.json())")
        check("…sharing asks you to sign in", "Sign in" in share.get("error", ""), share)
        lp.goto(args.url + "/"); lp.wait_for_selector(".hm-card", timeout=20000)
        check("…and the home screen lists it", "Browser deck" in lp.inner_text("body"))
        lp.goto(args.url + "/login"); lp.wait_for_timeout(1500); lp.goto(args.url + "/")
        check("signing in leaves browser mode", lp.locator("a", has_text="Start a deck").count() == 1)
        lp.goto(args.url + "/start"); lp.wait_for_url(args.url + "/", timeout=SLOW); lp.wait_for_selector(".hm-card", timeout=20000)
        check("…and Start a deck finds the browser's decks again", "Browser deck" in lp.inner_text("body"))

        if args.drive:
            __import__("urllib.request").request.urlopen(args.drive_api + "/__reset")   # an empty Drive
            as_(pg, p="google", u=OWNER["id"], l="heyodogo@gmail.com", n="Test Owner", e="heyodogo@gmail.com")
            pg.wait_for_selector("#hm-new", timeout=SLOW)
            check("a Google account signs in to a library in its Drive (a Glideshow folder)", "Glideshow" in drive_state() and pg.locator("#hm-new").count() == 1, drive_state())
            LAB = f"Lab {int(time.time())}"
            check("make a folder (a Drive folder)", post("/api/folder", {"op": "create", "path": "", "name": LAB}).get("ok") and drive_state().get(f"Glideshow/{LAB}") == "<folder>", drive_state())
            pg.reload(); pg.wait_for_selector(".hm-folder", timeout=20000)
        else:
            as_(pg, p="github", u=OWNER["id"], l=OWNER["login"], n="Test Owner")
            pg.wait_for_selector(".hm-card", timeout=SLOW)
            left = [d["path"] for d in api("/api/decks") if re.fullmatch(r"(cloud-test-\d+|browser-deck(-\d+)?|trap(-\d+)?)", d["path"])]
            for d in left: post("/api/deckop", {"path": d, "op": "delete"})   # what a run that stopped partway left on the branch
            if left: print(f"(removed {len(left)} decks earlier runs left: {', '.join(left)})")
        check("the owner signs in to their library", pg.locator(".hm-folder").count() > 0 and (args.drive or pg.locator(".hm-card").count() > 0))
        # the decks made in lp's browser without an account move in once it signs in
        lp.goto(args.url + "/login"); lp.wait_for_timeout(1000)
        if args.drive: as_(lp, p="google", u=OWNER["id"], l="heyodogo@gmail.com", n="Test Owner", e="heyodogo@gmail.com")
        else: as_(lp, p="github", u=OWNER["id"], l=OWNER["login"], n="Test Owner")
        lp.wait_for_selector(".hm-move", timeout=SLOW)
        before = {d["path"] for d in api("/api/decks")}
        lp.click(".hm-move-go"); lp.wait_for_selector(".hm-move", state="detached", timeout=120000)   # done: the page reloads without it
        lp.wait_for_selector(".hm-card", timeout=SLOW)
        mine = [d["path"] for d in api("/api/decks")]
        pics = [k for k in drive_state() if k.startswith("Glideshow/browser-deck") and "/assets/" in k] if args.drive else ["(not checked on GitHub)"]
        check("after signing in, the browser's decks move into the library, pictures and all", any(p.startswith("browser-deck") for p in mine) and pics and lp.locator(".hm-move").count() == 0, (mine, pics))
        for d in set(mine) - before: post("/api/deckop", {"path": d, "op": "delete"})   # every deck that came in from the browser
        pg.click("#hm-app-more")
        check("⋮ offers Sign out", pg.locator(".menu-item", has_text="Sign out").count() == 1)
        pg.mouse.click(5, 5); pg.goto(args.url + "/start"); pg.wait_for_selector("#hm-new", timeout=20000)
        check("signed in, Start a deck goes to your own decks (not a second library in the browser)", pg.url.rstrip("/") == args.url and not pg.evaluate("window.GLIDESHOW_CLOUD?.local"))
        pg.mouse.click(5, 5)
        r = pg.evaluate("() => fetch('/api/save', { method: 'POST', body: '{}' }).then(r => r.status)")
        check("a POST without X-Glideshow is refused", r == 403, r)

        pg.click("#hm-new"); pg.wait_for_url("**/edit"); pg.wait_for_selector("body.draft")
        title = f"Cloud test {int(time.time())}"
        pg.fill("#ed-title", title); pg.keyboard.press("Enter")
        pg.wait_for_function("!document.body.classList.contains('draft')", timeout=20000)
        deck = api("/api/ping")["deck"]
        check("a titled draft moves into the library", deck.startswith("cloud-test-"), deck)
        saved = "document.querySelector('#ed-status').innerText.includes('All changes saved')"
        pg.evaluate("() => { content(slides[0].querySelector('[data-role=title]')).textContent = 'Hello from the cloud'; render(); commit(); }")
        pg.wait_for_function(saved, timeout=20000)
        # editing together, stage 2: a second editor on the deck hears a save at once (a WebSocket, not the 8 s poll), and
        # edits made in both at the same time merge slide by slide
        two = pg.context.new_page(); two.on("pageerror", lambda e: errors.append(str(e)))
        two.goto(args.url + "/edit"); two.wait_for_function("typeof slides !== 'undefined' && slides.length > 0 && !!mtime", timeout=SLOW); two.wait_for_timeout(1500)
        live_open = two.evaluate("liveSocket?.readyState === 1")
        t0 = time.time()
        pg.evaluate("() => { newSlideWith('title-only'); content(boxes()[0]).textContent = 'Seen at once'; render(); commit(); }")
        two.wait_for_function("slides.some(s => s.textContent.includes('Seen at once'))", timeout=20000); took = time.time() - t0
        check("a second editor on the deck shows a save made in the first within about a second (over its WebSocket)", live_open and took < 4, f"open={live_open} took={took:.1f}s")
        pg.evaluate("() => { go(0); content(slides[0].querySelector('[data-role=title]')).textContent = 'Title from one'; render(); commit(); }")
        two.evaluate("() => { go(1); content(boxes()[0]).textContent = 'Seen at once, edited in two'; render(); commit(); newSlideWith('title-only'); content(boxes()[0]).textContent = 'Added in two'; render(); commit(); }")
        want = ("Title from one", "Seen at once, edited in two", "Added in two")
        for _ in range(60):
            one_html, two_html = pg.evaluate("deckHTML()"), two.evaluate("deckHTML()")
            if all(w in one_html and w in two_html for w in want) and pg.evaluate("slides.length") == two.evaluate("slides.length"): break
            time.sleep(0.5)
        check("edits made in both at once: both kept, the new slide too, and both editors show the same", all(w in one_html and w in two_html for w in want) and pg.evaluate("slides.length") == two.evaluate("slides.length") == 3,
              [w for w in want if w not in one_html or w not in two_html])
        settled = "!saving && !saveTimer && !unsaved()"   # (the status may read Merged… rather than All changes saved)
        two.close(); pg.wait_for_function(settled, timeout=20000)
        pg.evaluate("() => { slides.splice(1); go(0); content(slides[0].querySelector('[data-role=title]')).textContent = 'Hello from the cloud'; render(); commit(); }"); pg.wait_for_function(settled, timeout=20000)
        # the Mac pushes an agent's edit of the deck while a save made here waits for its commit (the data loss of
        # 2026-10-21): to another slide (here slide A only, the agent slide B), then to the same slide (other boxes).
        # The save is merged with the push rather than committed over it, and the editor shows both.
        # GitHub's push webhook (worker.js githubWebhook), as GitHub sends it to glideshow.org: signed with the app's
        # webhook secret (GITHUB_WEBHOOK_SECRET, in .dev.vars for wrangler dev)
        import hashlib, hmac, urllib.error, urllib.request
        secret = next((l.split("=", 1)[1].strip() for l in (Path(__file__).resolve().parent.parent / "cloud" / ".dev.vars").read_text().splitlines() if l.startswith("GITHUB_WEBHOOK_SECRET=")), "")
        def webhook(sign=secret):
            body = json.dumps({"ref": f"refs/heads/{args.branch}", "repository": {"full_name": args.repo}}).encode()
            req = urllib.request.Request(args.url + "/github/webhook", data=body, method="POST", headers={"content-type": "application/json", "x-github-event": "push",
                                         "x-hub-signature-256": "sha256=" + hmac.new(sign.encode(), body, hashlib.sha256).hexdigest()})
            try: return urllib.request.urlopen(req).status
            except urllib.error.HTTPError as e: return e.code
        if secret and not args.drive:
            import base64
            forged = webhook("not the secret")
            # an idle editor hears nothing for 20 s: no 8 s checks (the live socket and the webhook bring changes)
            polls = []; watch = lambda r: polls.append(r.url) if "/api/events" in r.url else None
            pg.on("request", watch); pg.wait_for_timeout(20000); pg.remove_listener("request", watch)
            # a push from elsewhere reaches the open editor at once
            for _ in range(90):   # the library commits after 30 s of quiet
                j = json.loads(gh(f"repos/{args.repo}/contents/{deck}/deck.html?ref={args.branch}") or "{}")
                if "Hello from the cloud" in base64.b64decode(j.get("content", "")).decode(): break
                time.sleep(1)
            text = base64.b64decode(j["content"]).decode().replace("Hello from the cloud", "Hello from the Mac", 1)
            gh(f"repos/{args.repo}/contents/{deck}/deck.html", "-X", "PUT", "-f", "message=outside the editor: title", "-f", f"branch={args.branch}", "-f", f"sha={j['sha']}", "-f", "content=" + base64.b64encode(text.encode()).decode())
            t0 = time.time(); hook = webhook()
            pg.wait_for_function("slides.some(s => s.textContent.includes('Hello from the Mac'))", timeout=20000); took = time.time() - t0
            check("GitHub's push webhook: a push reaches the open editor within seconds; an idle editor makes no 8 s checks; a webhook not signed with the secret is refused",
                  hook == 200 and took < 5 and not polls and forged == 401, f"hook={hook} took={took:.1f}s polls={len(polls)} forged={forged}")
            pg.evaluate("() => { content(slides[0].querySelector('[data-role=title]')).textContent = 'Hello from the cloud'; render(); commit(); }"); pg.wait_for_function(settled, timeout=20000)
        if not args.drive:
            import base64
            gh_file = lambda: gh(f"repos/{args.repo}/contents/{deck}/deck.html?ref={args.branch}", "-H", "Accept: application/vnd.github.raw")
            def committed(*want, n=120):   # on GitHub (the library commits after 30 s of quiet)
                for _ in range(n):
                    text = gh_file()
                    if all(w in text for w in want): return []
                    time.sleep(1)
                return [w for w in want if w not in gh_file()]
            def mac_pushes(sid, fn, message):   # what the Mac's sync does with an agent's edit: a commit on the branch
                j = json.loads(gh(f"repos/{args.repo}/contents/{deck}/deck.html?ref={args.branch}"))
                text = base64.b64decode(j["content"]).decode(); a = text.index(f'data-sid="{sid}"'); z = text.index("</section>", a)
                text = text[:a] + fn(text[a:z]) + text[z:]
                out = gh(f"repos/{args.repo}/contents/{deck}/deck.html", "-X", "PUT", "-f", f"message=outside the editor: {message}", "-f", f"branch={args.branch}",
                          "-f", f"sha={j['sha']}", "-f", "content=" + base64.b64encode(text.encode()).decode())
                webhook()   # what GitHub then sends glideshow.org
                return out
            sid_a, sid_b = pg.evaluate("""(() => { const mk = (t, id) => { const s = blankSlide(), b = makeBox({ x: 100, y: 300, w: 600, h: 100, html: t }); b.id = id; s.append(b); return s; };
              const a = mk('Slide A', 'mx-a'), b = mk('Slide B', 'mx-b'); slides.push(a, b); ensureSids(); go(1); render(); commit(); return [a.dataset.sid, b.dataset.sid]; })()""")
            pg.wait_for_function(settled, timeout=20000)
            ready = not committed("Slide A", "Slide B")
            pg.evaluate("() => { content(slides.find(s => s.querySelector('#mx-a')).querySelector('#mx-a')).textContent = 'A edited here'; render(); commit(); }"); pg.wait_for_function(settled, timeout=20000)
            mac_pushes(sid_b, lambda sec: sec.replace(">Slide B<", ">Atari grid by the agent<"), "slide B")
            lost = committed("A edited here", "Atari grid by the agent")
            pg.wait_for_function("slides.some(s => s.textContent.includes('Atari grid by the agent'))", timeout=60000); pg.wait_for_function(settled, timeout=20000)
            shown = pg.evaluate("[slides.some(s => s.textContent.includes('A edited here')), slides.some(s => s.textContent.includes('Atari grid by the agent'))]")
            check("the Mac pushes an edit of slide B while a save of slide A here waits for its commit: both committed, and both shown here (slide B isn't reverted)",
                  ready and not lost and shown == [True, True], f"ready={ready} lost={lost} shown={shown}")
            pg.evaluate("() => { const b = slides.flatMap(s => [...s.querySelectorAll('#mx-a')])[0]; b.style.left = '900px'; render(); commit(); }"); pg.wait_for_function(settled, timeout=20000)
            mac_pushes(sid_a, lambda sec: sec + '  <div class="box" id="mx-mario" style="left: 100px; top: 600px; width: 400px; height: 100px;"><div class="content">Mario tile by the agent</div></div>\n', "slide A")
            lost = committed("Mario tile by the agent", 'id="mx-a" style="left: 900px')
            pg.wait_for_function("slides.some(s => !!s.querySelector('#mx-mario'))", timeout=60000); pg.wait_for_function(settled, timeout=20000)
            shown = pg.evaluate("[slides.some(s => !!s.querySelector('#mx-mario')), slides.flatMap(s => [...s.querySelectorAll('#mx-a')])[0]?.style.left]")
            check("the Mac pushes a new box on a slide whose other box was moved here, before that save's commit: both boxes committed and shown, the move too",
                  not lost and shown == [True, "900px"], f"lost={lost} shown={shown}")
            pg.evaluate("() => { slides.splice(1); go(0); render(); commit(); }"); pg.wait_for_function(settled, timeout=20000)

        # requests: an editing session stays within a budget (2026-10-21: a slide of looping videos downloaded every video
        # on each edit, 354 requests in 30 s, and the account's free Durable Object day was gone in 3 hours)
        import shutil
        if shutil.which("ffmpeg"):
            import base64
            mp4 = Path(tempfile.mkdtemp()) / "loop.mp4"
            subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x180:rate=15", "-pix_fmt", "yuv420p", str(mp4)], check=True)
            srcs = pg.evaluate("""async b64 => { const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)), out = [];
              for (let i = 0; i < 3; i++) out.push((await (await fetch('/api/upload?ext=mp4', { method: 'POST', body: bytes })).json()).src);
              return out; }""", base64.b64encode(mp4.read_bytes()).decode())
            pg.evaluate("""srcs => { const s = blankSlide(); srcs.forEach((src, i) => { const b = makeBox({ x: 60 + i * 620, y: 300, w: 580, h: 326, cls: 'video', html: `<video src="${src}" muted loop playsinline autoplay></video>` }); b.dataset.autoplay = ''; s.append(b); });
              const t = makeBox({ x: 60, y: 80, w: 800, h: 100, html: 'Videos' }); s.append(t); slides.push(s); go(slides.length - 1); render(); commit(); }""", srcs)
            pg.wait_for_function(settled, timeout=20000); pg.wait_for_timeout(4000)
            got = []; count = lambda r: got.append(r.url.split("?")[0].replace(args.url, "")) if r.url.startswith(args.url) else None
            pg.on("response", count)
            for i in range(15):   # an edit on the video slide every 2 s, as one does
                pg.evaluate("() => { const b = boxes().find(b => content(b)?.textContent.includes('Videos')); b.style.left = (parseFloat(b.style.left) + 2) + 'px'; render(); commit(); }"); pg.wait_for_timeout(2000)
            pg.remove_listener("response", count)
            videos = sum(u.endswith(".mp4") for u in got)
            check("requests: 30 s of editing a slide with three looping videos stays within budget (under 40 requests; videos at most 10 partial fetches, not one per edit: 354 when they were refetched)",
                  len(got) < 40 and videos <= 10, f"{len(got)} requests, {videos} videos: {sorted(set(got))[:8]}")
            pg.evaluate("() => { slides.pop(); go(0); render(); commit(); }"); pg.wait_for_function(settled, timeout=20000)
        # a library's day: past LIB_SLOW the editor checks for changes once a minute, past LIB_PAUSE its background traffic
        # stops (and is refused), saving still works; back to normal the next day (here: the count set back, and a reload)
        use = lambda n: post("/api/__usage", {"n": n})
        toml = (Path(__file__).resolve().parent.parent / "cloud" / "wrangler.toml").read_text()
        def limit(k, d):
            m = re.search(rf'^{k} = "(\d+)"', toml, re.M)
            return int(m.group(1)) if m else d
        SLOW_AT, PAUSE_AT = limit("LIB_SLOW", 20_000), limit("LIB_PAUSE", 50_000)
        slow = use(SLOW_AT)
        pg.evaluate("() => { content(slides[0].querySelector('[data-role=title]')).textContent = 'Hello from the cloud.'; render(); commit(); }"); pg.wait_for_function(settled, timeout=20000)
        slow_ui = pg.evaluate("[loadLevel, !$('#ed-load-bar').hidden, !changesFeed && !!changesTimer]")
        use(PAUSE_AT)
        pg.evaluate("() => { content(slides[0].querySelector('[data-role=title]')).textContent = 'Hello from the cloud'; render(); commit(); }"); pg.wait_for_function(settled, timeout=20000)
        paused_ui = pg.evaluate("[loadLevel, $('#ed-load-bar').classList.contains('paused'), !liveSocket, !changesFeed && !changesTimer]")
        refused = pg.evaluate("() => fetch('/api/events').then(r => r.status)")
        kept = "Hello from the cloud" in gh(f"repos/{args.repo}/contents/{deck}/deck.html?ref={args.branch}", "-H", "Accept: application/vnd.github.raw") or pg.evaluate("!unsaved()")
        use(0); pg.goto(args.url + "/edit"); pg.wait_for_function("typeof slides !== 'undefined' && slides.length > 0 && !!mtime", timeout=SLOW); pg.wait_for_timeout(1500)
        back = pg.evaluate("[loadLevel, liveSocket?.readyState === 1, !!(changesFeed || changesTimer)]")
        check("a library's day: past its slow mark the editor checks once a minute and says so; past its pause, no live socket or checks, those refused (429), saving still works; normal again after",
              slow.get("load") == "slow" and slow_ui == ["slow", True, True] and paused_ui == ["paused", True, True, True] and refused == 429 and kept and back == ["", True, True],
              f"slow={slow} {slow_ui} paused={paused_ui} refused={refused} kept={kept} back={back}")

        # the deck's first slide gets speaker notes, for the shared link's speaker view (below)
        pg.evaluate("() => { go(0); const a = document.createElement('aside'); a.className = 'notes'; a.textContent = 'Say hello first'; slides[0].append(a); render(); commit(); }"); pg.wait_for_function(settled, timeout=20000)
        # Share: anyone with the link
        pg.click("#ed-share"); pg.wait_for_selector("#ed-sharedlg:not([hidden])")
        pg.click("#ed-share-on"); pg.wait_for_function("!$('#ed-share-linkrow').hidden", timeout=60000)
        link = pg.input_value("#ed-share-url"); path = link.split(args.url, 1)[-1]
        check("Share makes a glideshow link to the deck", f"/p/{OWNER['login'].lower()}/cloud-test-" in link, link)
        anon = page(); anon.goto(link); anon.wait_for_selector(".reveal.ready", timeout=SLOW)
        check("anyone with the link sees the deck, without signing in, with the Comments button", "Hello from the cloud" in anon.content() and anon.locator(".gs-toggle").count() == 1)
        # speaker notes on a shared link (S): Glideshow's speaker page, kept in step; its Next moves the deck
        with anon.context.expect_page() as sp_info:
            anon.keyboard.press("s")
        sp = sp_info.value; sp.wait_for_load_state(); sp.wait_for_function("document.getElementById('notes')?.textContent.includes('Say hello first')", timeout=20000)
        at0 = anon.evaluate("Reveal.getIndices().h"); sp.click("#next"); anon.wait_for_timeout(800); at1 = anon.evaluate("Reveal.getIndices().h")
        sp_ok = [sp.url.split("?")[0].endswith("/share/speaker.html"), sp.evaluate("document.getElementById('n').textContent"), at1 != at0, sp.locator("iframe").count()]
        sp.close()
        check("speaker notes on a shared link (S) open Glideshow's speaker page: the slide's notes, its number, two pictures, and Next moves the deck",
              sp_ok[0] and sp_ok[1].startswith("Slide 1 of") and (sp_ok[2] or sp_ok[1] == "Slide 1 of 1") and sp_ok[3] == 2, str(sp_ok))
        own = pg.context.new_page(); own.on("pageerror", lambda e: errors.append(str(e)))
        res = own.goto(link); own.wait_for_selector(".reveal.ready", timeout=SLOW)
        check("a shared deck is served sandboxed, with an origin of its own", "sandbox" in (res.headers.get("content-security-policy") or "") and own.evaluate("origin") == "null",
              res.headers.get("content-security-policy"))
        r = own.evaluate("() => fetch('/api/decks').then(r => r.status).catch(() => 'blocked')")
        check("…so a deck's script can't use the viewer's session (here, the owner's)", r in ("blocked", 401, 403), r)
        r = own.evaluate("() => fetch('https://example.com/collect', { method: 'POST', body: 'typed password' }).then(r => r.status).catch(() => 'blocked')")
        check("…nor send what you type to another site", r == "blocked", r)
        own.close()
        pg.click("#ed-share-done")
        pg.evaluate("() => { content(slides[0].querySelector('[data-role=title]')).textContent = 'Changed later'; render(); commit(); }")
        pg.wait_for_function(saved, timeout=20000)
        for _ in range(30):   # (the save reaches the library's history within seconds)
            anon.reload(); anon.wait_for_selector(".reveal.ready")
            if "Changed later" in anon.content(): break
            time.sleep(2)
        check("the link shows the latest version (no Update needed)", "Changed later" in anon.content() and not pg.evaluate("!!document.querySelector('#ed-share-update')"))
        pg.click("#ed-share")

        # only people I add
        pg.select_option("#ed-share-access", "people"); pg.wait_for_function("!$('#ed-share-peoplerow').hidden")
        pg.fill("#ed-share-people", "friend@example.org, @lab.example.edu"); pg.press("#ed-share-people", "Tab")
        pg.wait_for_function("$('#ed-share-status').textContent === 'Saved.'", timeout=SLOW)
        check("…and keeps its address when who can open it changes", pg.input_value("#ed-share-url") == link)
        check("…and Saved. means saved: both changes (Only people I add, then the names) are in, in order", api("/api/publish").get("people") == ["friend@example.org", "@lab.example.edu"], api("/api/publish"))
        anon.goto(link)
        check("only people I add: signed out, you're asked to sign in", "/login" in anon.url and "shared with specific people" in anon.content(), anon.url)
        as_(anon, path, p="google", u="g1", l="friend@example.org", n="Friend", e="friend@example.org")
        anon.wait_for_selector(".reveal.ready", timeout=SLOW)
        check("…a listed email opens it", "Changed later" in anon.content())
        info = anon.evaluate("() => ({ pass: window.GLIDESHOW?.pass || '', base: document.baseURI })")
        fresh = b.new_context()   # no cookies, as the sandboxed page's own requests
        r1, r2 = fresh.request.get(link + "~" + info["pass"] + "/deck.html"), fresh.request.get(link + "~nope/deck.html")
        check("…its files load on the viewer's pass, which rides in the page's <base>", "~" in info["base"] and r1.status == 200 and "Changed later" in r1.text(), (info["base"][:80], r1.status))
        check("…and not without one", "Changed later" not in r2.text())
        fresh.close()
        lab = page(); as_(lab, path, p="google", u="g2", l="pi@lab.example.edu", n="PI", e="pi@lab.example.edu"); lab.wait_for_selector(".reveal.ready", timeout=SLOW)
        check("…so does anyone at a listed @domain", "Changed later" in lab.content())
        other = page(); as_(other, path, p="google", u="g3", l="stranger@example.com", n="Stranger", e="stranger@example.com")
        check("…anyone else gets No access", "No access" in other.content() and "stranger@example.com" in other.content())

        # comments from viewers, seen by the owner
        anon.click(".gs-toggle"); anon.click(".gs-primary:has-text('Add a comment')")
        anon.mouse.click(500, 400); anon.wait_for_selector(".gs-new textarea")
        anon.fill(".gs-new textarea", "Could this be bigger?"); anon.click(".gs-new .gs-primary")
        anon.wait_for_selector(".gs-card[data-id]", timeout=20000)
        check("a viewer comments on a spot on the slide (a pin marks it)", anon.locator(".gs-marker").count() == 1)
        left = pg.evaluate("fetch('/api/comments').then(r => r.json())").get("comments", [{}])[-1]
        check("…and the comment keeps the slide's id (so it stays with the slide when slides move)", bool(left.get("sid")), left)
        lab.click(".gs-toggle"); lab.wait_for_selector(".gs-card[data-id]", timeout=20000)
        lab.fill(".gs-card .gs-in", "Agreed"); lab.press(".gs-card .gs-in", "Enter"); lab.wait_for_selector(".gs-reply", timeout=20000)
        check("another viewer sees it and replies", "Agreed" in lab.inner_text(".gs-card"))
        seen = lab.evaluate("() => fetch(GLIDESHOW.comments, { headers: { 'X-Glideshow-View': GLIDESHOW.pass } }).then(r => r.json())")
        check("viewers see commenters' names, not their addresses", "friend@example.org" not in json.dumps(seen) and seen["comments"][0]["by"]["n"] == "Friend", str(seen)[:200])

        # editing together, stage 3: "Can edit" in Share; an editor gets an Edit button on the link and the editor for that
        # one deck (/e/…), saving into the owner's deck (cleaned) live; everyone else, and every other deck, kept out
        before3 = api("/api/deck")["html"]   # (put back after this block: the checks after it expect the deck as it is)
        if pg.evaluate("$('#ed-sharedlg').hidden"): pg.click("#ed-share")
        pg.fill("#ed-share-editors", "pi@lab.example.edu"); pg.press("#ed-share-editors", "Tab")
        pg.wait_for_function("$('#ed-share-status').textContent === 'Saved.'", timeout=SLOW)
        check("Share → Can edit: a person added as a pill is kept", api("/api/publish").get("editors") == ["pi@lab.example.edu"], api("/api/publish"))
        pg.click("#ed-share-done")
        epath = path.replace("/p/", "/e/", 1)
        lab.goto(link); lab.wait_for_selector(".reveal.ready", timeout=SLOW); anon.goto(link); anon.wait_for_selector(".reveal.ready", timeout=SLOW)
        check("…they see an Edit button on the link; a viewer who can't edit doesn't", lab.locator(".gs-edit").count() == 1 and lab.get_attribute(".gs-edit", "href") == epath and anon.locator(".gs-edit").count() == 0,
              [lab.locator(".gs-edit").count(), anon.locator(".gs-edit").count()])
        lab.click(".gs-edit"); lab.wait_for_url("**" + epath, timeout=SLOW); lab.wait_for_function("typeof slides !== 'undefined' && slides.length > 0 && !!mtime", timeout=SLOW); lab.wait_for_timeout(1500)
        ui = lab.evaluate("[document.documentElement.classList.contains('collab'), !!document.querySelector('#ed-share')?.offsetParent, MENUS.File.map(i => i.label), document.querySelector('#ed-app-icon').getAttribute('href'), liveSocket?.readyState]")
        check("…Edit opens the editor for that deck: no Share, no library in File, the logo back to the link, live", ui[0] and not ui[1] and ui[2] == ["Download", "Print preview", "Print"] and ui[3] == path and ui[4] == 1, ui)
        pg.goto(args.url + "/edit"); pg.wait_for_function("typeof slides !== 'undefined' && slides.length > 0 && !!mtime", timeout=SLOW); pg.wait_for_timeout(1000)
        lab.evaluate("() => { go(0); content(slides[0].querySelector('[data-role=title]')).textContent = 'Edited by the PI'; render(); commit(); }")
        pg.wait_for_function("slides[0].textContent.includes('Edited by the PI')", timeout=20000)
        check("…what they type reaches the owner's editor at once", True)
        pg.evaluate("() => { go(0); newSlideWith('title-only'); content(boxes()[0]).textContent = 'Owner adds a slide'; render(); commit(); }")
        lab.wait_for_function("slides.some(s => s.textContent.includes('Owner adds a slide'))", timeout=20000)
        check("…and the owner's edits reach theirs", True)
        # editing together, stage 4: who else is here, where they are, the box they type in; undo that keeps others' edits
        others = "[...document.querySelectorAll('#ed-people .person')].map(e => e.dataset.tip)"
        pg.wait_for_function(f"{others}.some(t => t.startsWith('PI'))", timeout=10000); lab.wait_for_function(f"{others}.some(t => t.startsWith('Test Owner'))", timeout=10000)
        check("…each sees the other's initials by Share (named on hover, with the slide they're on), and not their own", pg.evaluate(others) == [f"PI · slide {lab.evaluate('cur') + 1}"] and lab.evaluate(others) == [f"Test Owner · slide {pg.evaluate('cur') + 1}"]
              and pg.inner_text("#ed-people .person") == "P", [pg.evaluate(others), lab.evaluate(others)])
        lab2 = lab.context.new_page(); lab2.goto(args.url + epath); lab2.wait_for_function("typeof slides !== 'undefined' && slides.length > 0 && liveSocket?.readyState === 1", timeout=SLOW); lab2.wait_for_timeout(1500)
        check("…the same person in two windows shows once", [t.split(" ·")[0] for t in pg.evaluate(others)] == ["PI"], pg.evaluate(others)); lab2.close()
        lab.evaluate("go(1)")
        pg.wait_for_function("thumbs.children[1]?.querySelector('.thumb-people .person')?.title === 'PI' && !thumbs.children[0].querySelector('.thumb-people')", timeout=5000)
        check("…the filmstrip shows who is on which slide, and follows them", pg.evaluate(others) == ["PI · slide 2"], pg.evaluate(others))
        pg.evaluate("go(1)"); lab.evaluate("startEdit(boxes()[0])")
        pg.wait_for_function("document.querySelector('#ed-people-on .person-ring.typing .person-tag')?.textContent === 'PI'", timeout=5000)
        pg.evaluate("startEdit(boxes()[0])")
        lk = pg.evaluate("[!!editing, $('#ed-status').innerText]")
        check("…the box someone is typing in carries their name, and the other can't start typing in it", lk[0] is False and "PI is typing in this box" in lk[1], lk)
        lab.evaluate("stopEdit()"); pg.wait_for_function("!document.querySelector('#ed-people-on .person-ring.typing')", timeout=5000)
        pg.evaluate("startEdit(boxes()[0])"); freed = pg.evaluate("!!editing"); pg.evaluate("stopEdit()")
        check("…and once they stop, it's free again", freed)
        pg.wait_for_timeout(1000)   # (the owner's own last move told first, so only the leaving can update the list)
        lab.goto(args.url + "/"); pg.wait_for_function("$('#ed-people').hidden", timeout=10000)
        check("…someone who leaves is gone from the others' editors", pg.evaluate("$('#ed-people').hidden"))
        lab.goto(args.url + epath); lab.wait_for_function("typeof slides !== 'undefined' && slides.length > 1 && liveSocket?.readyState === 1", timeout=SLOW); lab.wait_for_timeout(1000)
        pg.evaluate("() => { go(0); content(slides[0].querySelector('[data-role=title]')).textContent = 'Owner step'; render(); commit(); }"); pg.wait_for_function(settled, timeout=20000)
        lab.wait_for_function("slides[0].textContent.includes('Owner step')", timeout=20000)
        lab.evaluate("() => { go(1); content(boxes()[0]).textContent = 'PI later'; render(); commit(); }")
        pg.wait_for_function("slides[1].textContent.includes('PI later')", timeout=20000); pg.wait_for_function(settled, timeout=20000)
        pg.evaluate("undo()"); pg.wait_for_function(settled, timeout=20000)
        lab.wait_for_function("slides[0].textContent.includes('Edited by the PI')", timeout=20000)
        u = [pg.evaluate("slides.map(s => s.textContent.trim())"), lab.evaluate("slides.map(s => s.textContent.trim())")]
        check("…⌘Z takes back the owner's own change and keeps the PI's, made since (and both editors agree)", all("Edited by the PI" in x[0] and "Owner step" not in x[0] and x[1] == "PI later" for x in u), u)
        pg.evaluate("() => { go(1); content(boxes()[0]).textContent = 'Owner on 2'; render(); commit(); }"); pg.wait_for_function(settled, timeout=20000)
        lab.wait_for_function("slides[1].textContent.includes('Owner on 2')", timeout=20000)
        lab.evaluate("() => { go(1); content(boxes()[0]).textContent = 'PI on 2'; render(); commit(); }")
        pg.wait_for_function("slides[1].textContent.includes('PI on 2')", timeout=20000); pg.wait_for_function(settled, timeout=20000)
        pg.evaluate("undo()"); pg.wait_for_timeout(1500)
        u = [pg.evaluate("[slides[1].textContent.trim(), $('#ed-status').innerText]"), lab.evaluate("slides[1].textContent.trim()")]
        check("…but not over the PI's change to the same slide: it says so, and their text stays", u[0][0] == "PI on 2" and "PI has since changed slide 2" in u[0][1] and u[1] == "PI on 2", u)
        # a collaborator's save keeps the owner's slides they didn't touch exactly (scripts too); only the one they edit is cleaned
        dk0 = api("/api/deck"); h0 = dk0["html"]; cut = h0.index("</section>")
        m0 = post("/api/save", {"html": h0[:cut] + "<script>window.ownerSlide = 1</script>\n" + h0[cut:], "mtime": dk0["mtime"]})["mtime"]
        lab.wait_for_function(f"mtime === '{m0}' && !saving && !saveTimer", timeout=20000); pg.wait_for_function(settled, timeout=20000)
        lab.evaluate("() => { go(1); content(boxes()[0]).textContent = 'PI keeps your script'; render(); commit(); }"); lab.wait_for_function(settled, timeout=20000)
        o = api("/api/deck")["html"]; first = o.split("</section>", 1)[0]
        check("…a collaborator's save keeps, exactly, the owner's slides they didn't touch (a script in one too)", "window.ownerSlide = 1" in first and "PI keeps your script" in o, first[-300:])
        lab.evaluate("() => { go(0); content(slides[0].querySelector('[data-role=title]')).textContent = 'PI edits that slide'; render(); commit(); }"); lab.wait_for_function(settled, timeout=20000)
        o = api("/api/deck")["html"]
        check("…and the slide they edit comes through cleaned (the script goes, their text stays)", "window.ownerSlide" not in o and "PI edits that slide" in o and "PI keeps your script" in o, o.split("</section>", 1)[0][-300:])
        # what a collaborator can't do, through the API itself
        ep = lambda p: args.url + epath + p
        dk = lab.evaluate("p => fetch(p).then(r => r.json())", epath + "api/deck")
        attack = '<section data-sid="evil"><div class="box" id="ev1"><div class="content"><img src="x" onerror="window.pwned=1"><script>window.pwned=2</script><a href="javascript:alert(1)">x</a><iframe srcdoc="<script>parent.pwned=3</script>"></iframe></div></div></section>'
        theirs = dk["html"].split('<div class="slides">', 1)[1].rsplit("</div>\n</div>", 1)[0] if '<div class="slides">' in dk["html"] else ""
        sv = lab.evaluate("([p, b]) => fetch(p, { method: 'POST', headers: { 'X-Glideshow': '1' }, body: JSON.stringify(b) }).then(r => r.json())", [epath + "api/save", {"html": "<title>Evil</title>", "slides": theirs + attack, "mtime": dk["mtime"]}])
        owner_html = api("/api/deck")["html"]
        slides_part = owner_html.split('<div class="slides"', 1)[1].split("<script", 1)[0]   # the slides, not the deck's own scripts after them
        bad_at = [slides_part[max(0, m.start() - 100):m.start() + 30] for m in re.finditer(r"onerror|javascript:|srcdoc|pwned=2", slides_part)]
        check("…a save sent by hand is cleaned: no handler, script, javascript: link or frame of theirs reaches the owner's deck",
              bool(sv.get("mtime")) and 'id="ev1"' in owner_html and not bad_at, [sv, bad_at])
        check("…and the owner's deck keeps its own scripts (the collaborator's copy had none)", "deck-present" in owner_html and "<script" not in dk["html"].lower(), dk["html"].lower().count("<script"))
        race = lab.evaluate("""async p => { const out = [];
          for (let i = 0; i < 6; i++) { const d = await (await fetch(p + 'api/deck', { cache: 'no-store' })).json(), sl = new DOMParser().parseFromString(d.html, 'text/html').querySelector('.slides').innerHTML;
            const s = () => fetch(p + 'api/save', { method: 'POST', headers: { 'X-Glideshow': '1' }, body: JSON.stringify({ html: '<title>Race</title>', slides: sl, mtime: d.mtime }) }).then(r => r.status);
            out.push((await Promise.all([s(), s()])).sort().join()); }
          return out; }""", epath)
        check("…two of their saves from one version at the same moment: one written, the other told it clashed", all(r == "200,409" for r in race), race)
        status = lambda p, m="GET": lab.evaluate("([p, m]) => fetch(p, { method: m, headers: { 'X-Glideshow': '1' } }).then(r => r.status)", [p, m])
        reach = {k: status(epath + p) for k, p in {"decks": "api/decks", "publish": "api/publish", "folders": "api/folders", "other": "deck/../" + deck + "x/deck.html", "library": "api/library"}.items()}
        reach.update({"POST " + k: status(epath + k, "POST") for k in ("api/publish", "api/deckop", "api/restore", "api/importdeck", "api/folder", "api/open")})
        check("…their editor reaches that deck only: no listing, Share, folders, another deck's files, or the library's own changes", all(v == 404 for v in reach.values()) and lab.evaluate("p => fetch(p).then(r => r.json())", epath + "api/recent") == [], reach)
        up = {ext: lab.evaluate("([p, e]) => fetch(p + '?ext=' + e, { method: 'POST', headers: { 'X-Glideshow': '1' }, body: new Uint8Array([137, 80, 78, 71]) }).then(r => r.status)", [epath + "api/upload", ext]) for ext in ("png", "svg", "html")}
        check("…uploads: a picture yes, an SVG or a page no", up == {"png": 200, "svg": 415, "html": 415}, up)
        anon.goto(args.url + epath)
        check("someone who may view but not edit gets Can't edit at /e/…", "Can't edit" in anon.content() and "friend@example.org" in anon.content(), anon.url)
        nob = b.new_context().new_page(); nob.goto(args.url + epath)
        check("signed out, /e/… asks you to sign in to edit", "/login" in nob.url and "Sign in to edit this deck" in nob.content(), nob.url); nob.context.close()
        lab.goto(link); lab.wait_for_selector(".reveal.ready", timeout=SLOW)
        now3 = api("/api/deck"); post("/api/save", {"html": before3, "mtime": now3["mtime"]})
        pg.reload(); pg.wait_for_function("typeof slides !== 'undefined' && slides.length > 0 && !!mtime", timeout=SLOW); pg.wait_for_timeout(500)

        # reports and takedowns
        rep = page(); rep.goto(args.url + "/report?link=" + quote(path))
        rep.fill("textarea[name=text]", "cloud test report"); rep.click("button:has-text('Send report')")
        check("anyone can report a shared deck", "Thanks" in rep.content())
        check("…and only admins see /admin", "Not found" in (other.goto(args.url + "/admin") and other.content()))
        adm = page(); as_(adm, "/admin", p="github", u="gh-admin" if args.drive else OWNER["id"], l="heyodog0", n="Test Owner")
        check("admins see reports at /admin", "cloud test report" in adm.content() and path in adm.content())
        adm.click("li:has-text('cloud test report') button:has-text('Take down link')"); adm.wait_for_load_state()
        lab.goto(link)
        check("a link taken down says so", "Taken down" in lab.content())
        key = "/".join(path.strip("/").split("/")[1:3]).lower()
        adm.click(f"li:has-text('{key}') button:has-text('Restore')"); adm.wait_for_load_state()
        adm.click("li:has-text('cloud test report') button:has-text('Dismiss')"); adm.wait_for_load_state()
        lab.goto(link); lab.wait_for_selector(".reveal.ready", timeout=SLOW)
        check("…Restore brings it back, and Dismiss clears the report", "Changed later" in lab.content() and "cloud test report" not in adm.content())
        owner_key = path.strip("/").split("/")[1].lower()
        adm.goto(args.url + "/admin"); rep.goto(args.url + "/report?link=" + quote(path)); rep.click("button:has-text('Send report')")
        adm.reload(); adm.click(f"li:has-text('{path}') button:has-text('Suspend')"); adm.wait_for_load_state()
        lab.goto(link); r = pg.evaluate("() => fetch('/api/decks').then(r => r.status)")
        check("suspending an owner takes down all their links and locks their library", "Taken down" in lab.content() and r == 403, r)
        adm.click(f"li:has-text('{owner_key}') button:has-text('Restore')"); adm.wait_for_load_state()
        adm.click(f"li:has-text('{path}') button:has-text('Dismiss')"); adm.wait_for_load_state()
        lab.goto(link); lab.wait_for_selector(".reveal.ready", timeout=SLOW)
        check("…and Restore undoes it", "Changed later" in lab.content() and pg.evaluate("() => fetch('/api/decks').then(r => r.status)") == 200)
        if not pg.evaluate("$('#ed-sharedlg').hidden"): pg.click("#ed-share-done")
        pg.click("#ed-comments-btn"); pg.wait_for_selector("#ed-comments .cm-card", timeout=20000)
        cm = pg.inner_text("#ed-cm-list")
        check("the owner sees the comment and the reply in the editor", "Could this be bigger?" in cm and "Agreed" in cm and "Friend" in cm, cm[:200])
        on_gh = ""
        for _ in range(25):   # comments are committed with the quiet-spell commit
            on_gh = drive_state().get(f"Glideshow/{deck}/comments.json", "") if args.drive else gh(f"repos/{args.repo}/contents/{deck}/comments.json?ref={args.branch}", "-H", "Accept: application/vnd.github.raw")
            if "Agreed" in on_gh: break
            time.sleep(3)
        check("comments are kept in comments.json beside the deck in the library", "Could this be bigger?" in on_gh and "Agreed" in on_gh, on_gh[:200])
        hist = api("/api/history")
        check("version history lists the deck's saved versions", isinstance(hist, list) and len(hist) >= 2 and api(f"/api/version?rev={hist[-1]['rev']}").get("html", "").startswith("<!doctype"), str(hist)[:200])

        # Version history → Restore: a version with a picture, a later one without it, then the first brought back
        def stored(has, tries=40):   # the newest stored version whose deck.html passes `has` (saves reach the store with the quiet-spell commit)
            for _ in range(tries):
                for h in api("/api/history")[:6]:
                    if has(api(f"/api/version?rev={h['rev']}").get("html", "")): return h["rev"]
                time.sleep(3)
            return None
        title = "content(slides[0].querySelector('[data-role=title]'))"
        pic = pg.evaluate("""async () => { const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
          const { src } = await (await fetch('/api/upload?ext=png', { method: 'POST', body: png })).json(); await addImageSrc(src); return src; }""")
        pg.wait_for_function(saved, timeout=20000)
        with_pic = stored(lambda h: pic in h and "Changed later" in h)
        pg.evaluate(f"() => {{ slides[0].querySelector('.box.image').remove(); {title}.textContent = 'A later version'; render(); commit(); }}")
        pg.wait_for_function(saved, timeout=20000)
        later = stored(lambda h: "A later version" in h and pic not in h)
        pg.click("#ed-menubar [data-menu=File]"); pg.click(".menu-item:has-text('Version history')"); pg.wait_for_selector(".hist-row >> nth=2")
        pg.evaluate("rev => previewVersion(rev)", with_pic); pg.wait_for_function("document.body.classList.contains('history-mode')")
        shown = pg.evaluate(f"[{title}.textContent, !!slides[0].querySelector('.box.image img')]")
        check("Version history previews an earlier version, its picture and all", bool(with_pic and later) and shown == ["Changed later", True], (with_pic, later, shown))
        pg.click("#ed-hist-restore")
        pg.wait_for_function(f"!document.body.classList.contains('history-mode') && {title}.textContent === 'Changed later'", timeout=20000)
        pg.wait_for_function("document.querySelector('#ed-status').innerText.includes('Version restored')", timeout=20000)
        back = pg.evaluate("src => fetch('/deck/' + src).then(r => r.ok && r.headers.get('content-type').startsWith('image/'))", pic)
        check("…Restore this version brings it back, and the picture it used still loads", back and pic in api("/api/deck")["html"], back)
        top = stored(lambda h: "Changed later" in h and pic in h)
        revs = [h["rev"] for h in api("/api/history")]
        check("…as a new version on top, keeping the one it replaced (a restore can be undone)", bool(top) and top not in (with_pic,) and later in revs and revs.index(top) < revs.index(later), (top, with_pic, later, revs[:5]))

        if args.drive:   # Drive drops past versions after 30 days (or past 100) unless kept: the last version of each day is kept
            drive_revs = lambda: json.load(__import__("urllib.request").request.urlopen(f"{args.drive_api}/__revisions?path={quote(f'Glideshow/{deck}/deck.html')}"))
            age = lambda days: __import__("urllib.request").request.urlopen(f"{args.drive_api}/__age?days={days}")
            age(2)   # two days pass; then an edit
            pg.evaluate(f"() => {{ {title}.textContent = 'Two days on'; render(); commit(); }}"); pg.wait_for_function(saved, timeout=20000)
            stored(lambda h: "Two days on" in h)
            kept = [r for r in drive_revs() if r["kept"]]
            check("Drive: the first save of a new day keeps the day before's last version forever (and only that one)",
                  len(kept) == 1 and "Changed later" in kept[0]["data"] and pic in kept[0]["data"], [(r["time"], r["kept"], r["data"][-80:]) for r in drive_revs()])
            age(40)   # past Drive's 30 days: the unkept versions go
            hist = api("/api/history"); htmls = [api(f"/api/version?rev={h['rev']}").get("html", "") for h in hist]
            check("…40 days later, that version is still in Version history and the others of its day are gone",
                  len(hist) == 2 and "Changed later" in htmls[1] and not any("A later version" in h for h in htmls), [h[-60:] for h in htmls])
            r = post("/api/restore", {"rev": hist[1]["rev"]})
            check("…and it can be restored", "mtime" in r and "Changed later" in api("/api/deck")["html"], r)
            pg.reload(); pg.wait_for_function("typeof slides !== 'undefined' && slides.length")
            urlopen = __import__("urllib.request").request.urlopen
            urlopen(f"{args.drive_api}/__seed?path={quote(f'Glideshow/{deck}/deck.html')}&kept=60")   # 60 earlier days' versions, all kept
            age(1)
            pg.evaluate(f"() => {{ {title}.textContent = 'A day later'; render(); commit(); }}"); pg.wait_for_function(saved, timeout=20000)
            stored(lambda h: "A day later" in h)
            kept = [r for r in drive_revs() if r["kept"]]
            check("…at most 50 days are kept: the oldest go, but never the first", len(kept) == 50 and kept[0]["data"] == "seeded day 0" and "seeded day 1" not in [r["data"] for r in kept],
                  (len(kept), [r["data"][:20] for r in kept[:3]]))
        if args.drive:
            check("move a deck into a folder (Drive moves the files)", post("/api/deckop", {"path": deck, "op": "move", "folder": LAB}).get("ok"))
            st = drive_state(); deck = f"{LAB}/" + deck
            check("…it's in the folder in Drive, and not where it was", f"Glideshow/{deck}/deck.html" in st and not any(k.startswith(f"Glideshow/{deck.split('/', 1)[1]}/") for k in st), sorted(st)[:12])

        # expiry, then clean up
        post("/api/publish", {"op": "settings", "expires": "2020-01-01"})
        anon.goto(link)
        check("an expired link says so", "Link expired" in anon.content())
        post("/api/publish", {"op": "unpublish"})
        anon.goto(link)
        check("Stop sharing takes the link down", "Link not found" in anon.content())
        post("/api/publish", {"op": "publish"})   # shared again, then removed: the removal takes the share with it
        check("remove", post("/api/deckop", {"path": deck, "op": "delete"}).get("ok"))
        check("removed decks are gone", deck not in [d["path"] for d in api("/api/decks")])
        led = ""
        for _ in range(20):
            led = drive_state().get("Glideshow/published.json", "") if args.drive else gh(f"repos/{args.repo}/contents/published.json?ref={args.branch}", "-H", "Accept: application/vnd.github.raw")
            if led and deck.split("/")[-1] not in led: break
            time.sleep(3)
        check("…and a removed deck stops being shared (its entry leaves published.json)", bool(led) and deck.split("/")[-1] not in led, led[:300])
        if args.drive:   # a deck with a picture: its assets/ folder used to keep the deck's folder alive in Drive
            pic = pg.evaluate("""async lab => { const { bringIn } = await import('/editor/lib/onefile.js');
              return bringIn({ name: 'with-picture', folder: lab, html: '<!doctype html><html><head><title>p</title></head><body><div class="slides"><section></section></div></body></html>', files: { 'assets/a.png': new Uint8Array(3000) } }); }""", LAB)
            post("/api/folder", {"op": "create", "path": LAB, "name": "spare"})   # a library change: commits the picture to Drive now
            had = any(k.startswith(f"Glideshow/{pic['path']}/assets/") for k in drive_state())
            post("/api/deckop", {"path": pic["path"], "op": "delete"}); post("/api/folder", {"op": "delete", "path": f"{LAB}/spare"})
            check("…and a removed deck's folder goes with it, pictures folder and all", had and pic["path"] not in api("/api/folders") and not any(k.startswith(f"Glideshow/{pic['path']}") for k in drive_state()), (had, api("/api/folders")))
        if args.drive:
            st = drive_state()
            check("removed decks go to the Drive trash, and the shared copy too", not any(deck in k for k in st) and not any(k.startswith("Glideshow/.shares/") for k in st), sorted(st)[:12])
            check("remove the (empty) folder", post("/api/folder", {"op": "delete", "path": LAB}).get("ok") and f"Glideshow/{LAB}" not in drive_state())
        else:
            log = gh(f"repos/{args.repo}/commits?sha={args.branch}&per_page=12", "--jq", ".[].commit.message")
            check("sharing and removal are committed", "library: share" in log and "library: remove" in log, log[:300])
            check("commits name the person who made them", gh(f"repos/{args.repo}/commits?sha={args.branch}&per_page=1", "--jq", ".[0].commit.author.name").strip() == "Test Owner")

    check("no page errors", not errors, errors[:3])
    b.close()

print("ALL PASSED" if not failures else f"{len(failures)} FAILED: {', '.join(failures)}")
sys.exit(1 if failures else 0)
