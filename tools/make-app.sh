#!/bin/bash
# Builds ~/Applications/Glideshow.app: a Dock-launchable app that starts the editor server (if it isn't
# running) and opens it in a Chrome app window (own window, no tabs or address bar).
#
#   bash ~/code/lab/glideshow/tools/make-app.sh
#
# Re-run after moving the repo. The launcher asks `glideshow url` for the one background server (starting it if
# needed) and opens the home screen. Logs: ~/.glideshow/server.log
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Applications/Glideshow.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/MacOS/Glideshow" <<EOF
#!/bin/bash
export PATH="\$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:\$PATH"
REPO="$REPO"
LOG="\$HOME/Library/Logs/glideshow.log"; mkdir -p "\$(dirname "\$LOG")"
# \`glideshow url\` finds the one background server (starting it, or replacing one on old code) and prints its address.
URL=\$(uv run --quiet --project "\$REPO" glideshow url 2>> "\$LOG" | tail -1)
case "\$URL" in http://*) ;; *) osascript -e 'display alert "Glideshow" message "The editor server did not start. See ~/.glideshow/server.log"'; exit 1 ;; esac
# A Chrome app window. Chrome's own binary hands --app to an already running Chrome (where launching it through open(1) can be
# ignored); without Chrome, the default browser.
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "\$CHROME" ] || CHROME="\$HOME\$CHROME"
# Its own small Chrome profile (~/.glideshow/chrome-app): a separate, empty Chrome that opens only this window, so it starts
# fast even when your browser is closed, never restores your tabs, and quitting it leaves your browser alone.
PROFILE="\$HOME/.glideshow/chrome-app"; mkdir -p "\$PROFILE"
if [ -x "\$CHROME" ]; then
  # Not running yet: a DevToolsActivePort left by a Chrome that didn't exit cleanly would point the watcher below at nothing.
  pgrep -f -- "--user-data-dir=\$PROFILE" > /dev/null || rm -f "\$PROFILE/DevToolsActivePort"
  nohup "\$CHROME" --user-data-dir="\$PROFILE" --no-first-run --no-default-browser-check --disable-session-crashed-bubble \\
    --remote-debugging-port=0 --app="\$URL" --window-size=1520,900 >> "\$LOG" 2>&1 &
  PID=\$!
  # When the last Glideshow window closes, this Chrome quits too. A Mac keeps an app running with no windows, and an idle
  # Chrome on this empty profile then catches a click on Chrome in the Dock: the "Welcome to Chrome profiles" picker in
  # place of your own browser. It is asked (its DevTools port, local only) every 2 s for its pages; none left, it quits.
  # (If this profile's Chrome was running already, the process above just hands it the window and exits, and the watcher
  # started with that Chrome keeps watching.)
  nohup bash -c 'pid=\$1; dir=\$2; sleep 8
    while kill -0 "\$pid" 2>/dev/null; do
      port=\$(head -1 "\$dir/DevToolsActivePort" 2>/dev/null)
      if [ -n "\$port" ] && list=\$(curl -sf -m 2 "http://127.0.0.1:\$port/json/list") && ! printf "%s" "\$list" | grep -q "\\"type\\": *\\"page\\""; then
        kill "\$pid"; break
      fi
      sleep 2
    done' _ "\$PID" "\$PROFILE" >> "\$LOG" 2>&1 &
else open "\$URL"; fi

EOF
chmod +x "$APP/Contents/MacOS/Glideshow"

cat > "$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Glideshow</string>
  <key>CFBundleDisplayName</key><string>Glideshow</string>
  <key>CFBundleIdentifier</key><string>org.glideshow.app</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Glideshow</string>
  <key>CFBundleIconFile</key><string>Glideshow</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
EOF

# Icon: the mascot (editor/glideshow.svg, rendered with the margin macOS icons have as editor/glideshow-1024.png) as an .icns.
ICONSET="$(mktemp -d)/Glideshow.iconset"; mkdir -p "$ICONSET"
uv run --with pillow python - "$ICONSET" "$REPO/editor/glideshow-1024.png" <<'EOF'
import sys
from PIL import Image
out, src = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
for n in (16, 32, 128, 256, 512):
    for scale in (1, 2):
        px = n * scale
        im.resize((px, px), Image.LANCZOS).save(f"{out}/icon_{n}x{n}{'@2x' if scale == 2 else ''}.png")
EOF
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/Glideshow.icns"
touch "$APP"   # make Finder/Dock notice the new icon
echo "Built $APP"
echo "Open it from Launchpad / Spotlight (\"Glideshow\") or drag it to the Dock. To start the server at login, see README."
