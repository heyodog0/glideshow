#!/bin/zsh
# Gives Glideshow (glideshow.org) its secrets, from files this Mac keeps (readable by you only):
#   ~/.glideshow/glideshow-app.json    the GitHub App, made once by `uv run cloud/github-app.py`
#   ~/.glideshow/google-oauth.json     optional, for "Continue with Google" (docs/self-hosting.md): the client file Google lets you
#                                   download (client_secret_….json); the newest one in ~/Downloads is copied here
# plus a new key for signing sessions, which signs every browser out.   cloud/setup.sh   (staging: cloud/setup.sh dev)
set -e
cd "${0:A:h}"
env=(${1:+--env} $1)   # (dev: the staging Worker, dev.glideshow.org)
app=~/.glideshow/glideshow-app.json google=~/.glideshow/google-oauth.json
[[ -f $app ]] || { echo "No $app yet: run  uv run cloud/github-app.py  first."; exit 1; }
dl=$(ls -t ~/Downloads/client_secret_*.json 2>/dev/null | head -1)
if [[ -n $dl && ( ! -f $google || $dl -nt $google ) ]]; then install -m 600 "$dl" "$google" && rm "$dl" && echo "Google sign-in: using $dl (moved to $google)"; fi
uv run --quiet python -I - "$app" "$google" "$(openssl rand -hex 32)" <<'PY' | npx --yes wrangler@4 secret bulk $env
import json, sys
from pathlib import Path
app = json.loads(Path(sys.argv[1]).read_text())
out = {"GITHUB_APP_ID": str(app["id"]), "GITHUB_APP_SLUG": app["slug"], "GITHUB_CLIENT_ID": app["client_id"], "GITHUB_CLIENT_SECRET": app["client_secret"],
       "GITHUB_APP_KEY": app["private_key"], "SESSION_KEY": sys.argv[3]}
g = Path(sys.argv[2])
if g.exists():
    g = json.loads(g.read_text()); g = g.get("web", g)   # Google's download wraps it in {"web": …}
    out |= {"GOOGLE_CLIENT_ID": g["client_id"], "GOOGLE_CLIENT_SECRET": g["client_secret"]}
print(json.dumps(out))
PY
for old in PASSWORD GITHUB_TOKEN; do npx --yes wrangler@4 secret delete $old $env --force >/dev/null 2>&1 || true; done   # from the password sign-in
echo "Set. Open https://${1:+$1.}glideshow.org and continue with GitHub."
