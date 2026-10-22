# /// script
# dependencies = []
# ///
"""Creates the Glideshow GitHub App with GitHub's manifest flow: opens github.com with the app's settings filled in, you
press Create, and its credentials come back here and are saved to ~/.glideshow/glideshow-app.json (readable by you only).
cloud/setup.sh then uploads them to the Worker.

    uv run cloud/github-app.py            # once; run setup.sh afterwards

The app asks for one thing: the contents of the repos you install it on (read and write, to save decks there). People
signing in with it are known by their GitHub username (and public email, if they have one). It is public, so anyone can sign in with it;
glideshow.org decides who may use it (ALLOWED_USERS in wrangler.toml)."""

import html, json, secrets, subprocess, threading, urllib.request, webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PORT = 47811
OUT = Path.home() / ".glideshow" / "glideshow-app.json"
SITE = "https://glideshow.org"
STATE = secrets.token_urlsafe(16)
MANIFEST = {
    "name": "Glideshow Slides",   # "Glideshow" is taken on GitHub (a user of that name)
    "url": SITE,
    "description": "Slides you own: decks are HTML files in your GitHub repo, edited at glideshow.org.",
    "hook_attributes": {"url": f"{SITE}/github/hook", "active": False},
    "redirect_url": f"http://localhost:{PORT}/done",
    "callback_urls": [f"{SITE}/auth/github/callback", "http://localhost:8790/auth/github/callback"],
    "setup_url": f"{SITE}/setup",
    "setup_on_update": True,
    "public": True,
    "default_permissions": {"contents": "write", "metadata": "read"},
    "default_events": [],
}
done = threading.Event()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def page(self, body: str, code=200):
        data = f"<!doctype html><meta charset=utf-8><title>Glideshow app</title><body style='font:16px system-ui;margin:60px auto;max-width:560px'>{body}".encode()
        self.send_response(code); self.send_header("content-type", "text/html; charset=utf-8"); self.send_header("content-length", str(len(data))); self.end_headers(); self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path); q = parse_qs(url.query)
        if url.path == "/":   # a form that posts the manifest to GitHub (it must be a POST from the browser)
            return self.page(f"""<p>Opening GitHub…</p><form id=f method=post action="https://github.com/settings/apps/new?state={STATE}">
<input type=hidden name=manifest value="{html.escape(json.dumps(MANIFEST))}"><button>Continue to GitHub</button></form><script>f.submit()</script>""")
        if url.path == "/done":
            if q.get("state", [""])[0] != STATE: return self.page("State mismatch: start again with uv run cloud/github-app.py.", 400)
            code = q.get("code", [""])[0]
            req = urllib.request.Request(f"https://api.github.com/app-manifests/{code}/conversions", method="POST", headers={"accept": "application/vnd.github+json", "user-agent": "glideshow-setup"})
            app = json.load(urllib.request.urlopen(req, timeout=30))
            # Workers' WebCrypto imports PKCS#8 keys; GitHub hands out PKCS#1
            pkcs8 = subprocess.run(["openssl", "pkcs8", "-topk8", "-nocrypt"], input=app["pem"], capture_output=True, text=True, check=True).stdout
            OUT.parent.mkdir(parents=True, exist_ok=True)
            OUT.touch(mode=0o600); OUT.chmod(0o600)
            OUT.write_text(json.dumps({"id": app["id"], "slug": app["slug"], "client_id": app["client_id"], "client_secret": app["client_secret"],
                                       "private_key": pkcs8, "html_url": app["html_url"], "owner": app["owner"]["login"]}, indent=2))
            self.page(f"<p>Created <b>{html.escape(app['name'])}</b> ({html.escape(app['html_url'])}).</p><p>Back in the terminal: run <code>cloud/setup.sh</code>.</p>")
            print(f"Created {app['html_url']}; credentials saved to {OUT}")
            return done.set()
        self.page("not found", 404)


if __name__ == "__main__":
    if OUT.exists(): raise SystemExit(f"{OUT} already exists (the app was made). Delete it first to make another.")
    srv = HTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    print(f"Opening http://localhost:{PORT}/ … press Create GitHub App on the page GitHub shows.")
    webbrowser.open(f"http://localhost:{PORT}/")
    done.wait()
    srv.shutdown()
