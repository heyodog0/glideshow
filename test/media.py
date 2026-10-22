# /// script
# dependencies = ["playwright==1.63.0", "pillow"]
# ///
"""Pictures, GIFs and videos in the editor, in WebKit (Safari's engine) and Chromium: what the slide and the filmstrip
show, read off screenshots. Each case starts with one colour and, for the ones about a file rewritten on disk under the
same name (an agent making a plot or a clip again), changes it to another while the deck is open:

  - a PNG, rewritten: new on the slide and in the filmstrip
  - a large GIF: the filmstrip shows its first frame, not a blank (Safari reported a large GIF loaded before its first
    frame was decoded); rewritten: the new first frame
  - a video with a poster: the poster; poster rewritten: the new one
  - a video without a poster: its first frame on the slide and in the filmstrip (Safari drew it black); rewritten: the new one
  - a background video: its first frame in the filmstrip, playing on the slide; rewritten: the new one
  - and the deck on disk keeps plain paths (no ?gsv=) and no poster the editor made up (data-ed-poster)

Run: uv run test/media.py   (needs ffmpeg for the videos; without it those cases are skipped)"""
import os, shutil, struct, subprocess, sys, tempfile, time, urllib.request, zlib
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PORT = int(os.environ.get("MEDIA_PORT", "8853"))
SHOTS = ROOT / "test" / "shots" / "media"
failures = []


def check(name, ok, detail: object = ""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  ({detail})"))
    if not ok: failures.append(name)


COLORS = {"red": (255, 0, 0), "green": (0, 160, 0), "blue": (0, 0, 255), "yellow": (255, 255, 0), "magenta": (255, 0, 255),
          "cyan": (0, 255, 255), "orange": (255, 128, 0), "purple": (128, 0, 160), "teal": (0, 128, 128), "pink": (255, 160, 200),
          "white": (255, 255, 255), "black": (0, 0, 0)}


def name(rgb):
    return min(COLORS, key=lambda k: sum((a - b) ** 2 for a, b in zip(COLORS[k], rgb[:3])))


def png(rgb, w=64, h=36):
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
    rows = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


def gif(rgb, w=1600, h=1000, frames=3):
    """A large animated GIF of one colour, stored without compression (several MB, as the real ones that showed the bug)."""
    period = [256] + [0] * 250   # clear, then 250 pixels of colour 0: the code table never outgrows 9 bits
    bits = acc = 0; out = bytearray()
    for c in period * 8:   # 8 periods of 251 9-bit codes end on a byte boundary
        acc |= c << bits; bits += 9
        while bits >= 8: out.append(acc & 255); acc >>= 8; bits -= 8
    n = w * h
    assert n % 2000 == 0
    data = bytes(out) * (n // 2000) + bytes([257 & 255, 257 >> 8])   # end of information (9 bits, padded)
    blocks = b"".join(bytes([len(data[i:i + 255])]) + data[i:i + 255] for i in range(0, len(data), 255)) + b"\x00"
    palette = bytes(rgb) + b"\x00" * (768 - 3)
    head = b"GIF89a" + struct.pack("<HHBBB", w, h, 0xF7, 0, 0) + palette + b"\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00"
    frame = b"\x21\xf9\x04\x04\x0a\x00\x00\x00" + b"\x2c" + struct.pack("<HHHHB", 0, 0, w, h, 0) + b"\x08" + blocks
    return head + frame * frames + b"\x3b"


def video(color, path):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"color=c=0x{bytes(COLORS[color]).hex()}:s=320x180:d=2:r=10",
                    "-pix_fmt", "yuv420p", "-c:v", "libx264", "-movflags", "+faststart", str(path)], check=True)


def deck_html(videos):
    html = (ROOT / "test" / "fixtures" / "agent-deck.html").read_text()
    a, b = html.index('<section data-background-color="#ffffff">'), html.rindex("</section>") + len("</section>")
    box = lambda i, cls, inner: f'<div class="box {cls}" id="{i}" style="left: 200px; top: 150px; width: 1520px; height: 780px;"><div class="content">{inner}</div></div>'
    slides = [box("m-png", "image", '<img src="assets/p.png" alt="">'), box("m-gif", "image", '<img src="assets/g.gif" alt="">')]
    if videos:
        slides += [box("m-vp", "video", '<video src="assets/vp.mp4" poster="assets/vp.png" controls playsinline preload="metadata"></video>'),
                   box("m-vn", "video", '<video src="assets/vn.mp4" controls playsinline preload="metadata"></video>')]
    sections = [f'<section data-background-color="#ffffff">{s}</section>' for s in slides]
    if videos: sections.append('<section data-background-color="#ffffff" data-background-video="assets/vb.mp4" data-background-video-loop data-background-video-muted></section>')
    return html[:a] + "\n".join(sections) + html[b:]


# what each slide shows, before and after the rewrite: (file, before, after)
PLAN = [("p.png", "red", "cyan"), ("g.gif", "green", "orange"), ("vp.png", "blue", "purple"), ("vn.mp4", "yellow", "teal"), ("vb.mp4", "magenta", "pink")]


def write(d, which, videos):
    a = d / "assets"; a.mkdir(exist_ok=True)
    col = {f: (before if which == 0 else after) for f, before, after in PLAN}
    (a / "p.png").write_bytes(png(COLORS[col["p.png"]])); (a / "g.gif").write_bytes(gif(COLORS[col["g.gif"]]))
    if videos:
        (a / "vp.png").write_bytes(png(COLORS[col["vp.png"]], 320, 180))
        if which == 0: video("black", a / "vp.mp4")   # the poster is what shows; the clip behind it is another colour
        video(col["vn.mp4"], a / "vn.mp4"); video(col["vb.mp4"], a / "vb.mp4")


def sample(pg, shot):
    """The colour in the middle of the slide (a little off the centre guides) and of each thumbnail."""
    pg.screenshot(path=str(shot)); im = Image.open(shot).convert("RGB"); k = im.width / pg.viewport_size["width"]
    pts = pg.evaluate("""(() => { const f = document.querySelector('#ed-frame').getBoundingClientRect();
      return { stage: [f.left + f.width * .38, f.top + f.height * .38],
               thumbs: [...document.querySelectorAll('#ed-thumbs .thumb .thumb-view')].map(t => { const r = t.getBoundingClientRect(); return [r.left + r.width * .4, r.top + r.height * .4]; }) }; })()""")
    px = lambda p: name(im.getpixel((int(p[0] * k), int(p[1] * k))))
    return px(pts["stage"]), [px(p) for p in pts["thumbs"]]


def run(p, engine, videos):
    tmp = Path(tempfile.mkdtemp(prefix="glideshow-media-")); d = tmp / "home" / "Media" / "deck"; d.mkdir(parents=True)
    (d / "deck.html").write_text(deck_html(videos)); write(d, 0, videos)
    env = {**os.environ, "GLIDESHOW_HOME": str(tmp / "home"), "GLIDESHOW_CACHE": str(tmp / "cache"), "GLIDESHOW_OFFLINE": "1"}
    srv = subprocess.Popen(["uv", "run", "--quiet", "--project", str(ROOT), "python", "-m", "glideshow.server", str(d), "--port", str(PORT),
                            "--no-open", "--no-git", "--exit-with", str(os.getpid())], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://localhost:{PORT}/"
    for _ in range(60):
        try: urllib.request.urlopen(url + "api/ping", timeout=1); break
        except Exception: time.sleep(0.5)
    try:
        b = p.webkit.launch() if engine == "webkit" else p.chromium.launch(channel="chrome")
        pg = b.new_page(viewport={"width": 1440, "height": 900}); errors = []; pg.on("pageerror", lambda e: errors.append(str(e)))
        n = len(PLAN) if videos else 2
        pg.goto(url + "edit"); pg.wait_for_function(f"typeof slides !== 'undefined' && slides.length === {n}", timeout=30000)
        seen = {}
        for which in (0, 1):
            if which:   # rewritten on disk under the same names, and the deck touched (as an agent's run would)
                write(d, 1, videos); (d / "deck.html").write_text((d / "deck.html").read_text().replace("top: 150px", "top: 151px"))
                pg.wait_for_function("slides.some(s => s.innerHTML.includes('top: 151px'))", timeout=15000)
            stage = []
            for i in range(n):
                pg.evaluate(f"go({i})"); pg.wait_for_timeout(2500 if i == 0 else 1500)
                stage.append(sample(pg, SHOTS / f"{engine}-{which}-{i}.png")[0])
            pg.wait_for_timeout(1500); thumbs = sample(pg, SHOTS / f"{engine}-{which}-strip.png")[1]
            seen[which] = (stage, thumbs)
        want = lambda which: [plan[1 + which] for plan in PLAN[:n]]
        labels = ["a PNG", "a large GIF", "a video's poster", "a video without a poster", "a background video"][:n]
        for which, when in ((0, "at first"), (1, "rewritten on disk")):
            stage, thumbs = seen[which]
            for i, label in enumerate(labels):
                if label != "a large GIF":   # (the slide plays the GIF: any frame, so only its still is checked)
                    check(f"{engine}: {label}, {when}: right on the slide", stage[i] == want(which)[i], f"{stage[i]}, want {want(which)[i]}")
                check(f"{engine}: {label}, {when}: right in the filmstrip", thumbs[i] == want(which)[i], f"{thumbs[i]}, want {want(which)[i]}")
        pg.evaluate("(() => { const b = boxes(slides[cur])[0] || boxes(slides[0])[0]; if (b) { b.style.left = '201px'; commit(); } else { slides[cur].dataset.x = '1'; commit(); } })()")
        pg.evaluate("flushSave()"); pg.wait_for_timeout(1500)
        disk = (d / "deck.html").read_text()
        check(f"{engine}: the deck on disk keeps plain paths and no poster the editor made up", "gsv=" not in disk and "data-ed-poster" not in disk and 'src="assets/p.png"' in disk,
              f"gsv={'gsv=' in disk} data-ed-poster={'data-ed-poster' in disk}")
        check(f"{engine}: no page errors", not errors, errors[:3])
        b.close()
    finally:
        srv.terminate()


def main():
    SHOTS.mkdir(parents=True, exist_ok=True)
    videos = bool(shutil.which("ffmpeg"))
    if not videos: print("SKIP the video cases: ffmpeg isn't installed")
    with sync_playwright() as p:
        for engine in ("webkit", "chromium"):
            run(p, engine, videos)
    print("ALL PASSED" if not failures else f"{len(failures)} FAILED: {', '.join(failures)}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
