# /// script
# dependencies = ["playwright"]
# ///
"""Play a deck into a movie or an animated GIF: `glideshow movie` and File → Download → Movie / Animated GIF (Keynote's
Export → Movie and Animated GIF). Headless Chrome plays deck.html as a self-playing show (the next build after BUILD
seconds, the next slide after SLIDE seconds, transitions and builds as in the slideshow) while Playwright records the
page; ffmpeg turns the recording into an .mp4 (H.264) or a .gif. Without ffmpeg only .webm can be written.

    uv run glideshow/movie.py DECK_DIR OUT.(mp4|gif|webm) [--from N] [--to M] [--slide 5] [--build 2] [--size 1280x720] [--fps 30]
"""
import argparse, shutil, subprocess, sys, tempfile, time
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).parent))
from render import serve   # noqa: E402  (deck.html over http, so assets and fonts load as in a browser)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("deck", type=Path); ap.add_argument("out", type=Path)
    ap.add_argument("--from", dest="first", type=int, default=1); ap.add_argument("--to", dest="last", type=int, default=0)
    ap.add_argument("--slide", type=float, default=5.0); ap.add_argument("--build", type=float, default=2.0)
    ap.add_argument("--size", default="1280x720"); ap.add_argument("--fps", type=int, default=30)
    a = ap.parse_args()
    kind = a.out.suffix.lower().lstrip(".")
    if kind not in ("mp4", "gif", "webm"): raise SystemExit("the movie must be .mp4, .gif or .webm")
    ff = shutil.which("ffmpeg")
    if kind != "webm" and not ff: raise SystemExit(f"a .{kind} needs ffmpeg (https://ffmpeg.org); without it, ask for .webm")
    w, h = (int(v) for v in a.size.lower().split("x"))
    port = serve(a.deck.resolve())
    tmp = Path(tempfile.mkdtemp())
    with sync_playwright() as p:
        try: browser = p.chromium.launch(channel="chrome")
        except Exception: browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": w, "height": h}, record_video_dir=str(tmp), record_video_size={"width": w, "height": h})
        page = ctx.new_page(); t_open = time.monotonic()
        page.goto(f"http://127.0.0.1:{port}/deck.html")
        page.wait_for_function("window.Reveal?.isReady?.()", timeout=30000)
        page.add_style_tag(content=".sl-bar, .sl-laser { display: none !important; } * { cursor: none !important; }")
        total = page.evaluate("Reveal.getSlides().filter(s => !s.querySelector(':scope > section')).length")
        last = min(a.last or total, total); first = max(1, min(a.first, last))
        page.evaluate(f"(() => {{ Reveal.configure({{ margin: 0, controls: false, progress: false, keyboard: false }}); Reveal.layout(); const s = Reveal.getSlides()[{first - 1}]; const i = Reveal.getIndices(s); Reveal.slide(i.h, i.v || 0, -1); }})()")
        page.wait_for_timeout(600)   # settled on the first slide: the movie starts here
        start = time.monotonic() - t_open
        leaf = "(() => { const s = Reveal.getCurrentSlide(); return Reveal.getSlides().indexOf(s) + 1; })()"
        while True:
            more = page.evaluate("Reveal.availableFragments().next")
            if more:
                page.wait_for_timeout(int(a.build * 1000)); page.evaluate("Reveal.nextFragment()")
                continue
            page.wait_for_timeout(int(a.slide * 1000))
            if page.evaluate(leaf) >= last or page.evaluate("Reveal.isLastSlide()"): break
            page.evaluate("Reveal.next()")
        length = time.monotonic() - t_open - start
        video = page.video; ctx.close(); src = Path(video.path()); browser.close()
    if kind == "webm" and not ff: shutil.move(src, a.out); print(a.out); return
    trim = ["-ss", f"{start:.2f}", "-t", f"{length:.2f}", "-i", str(src)]
    if kind == "gif":
        cmd = [ff, "-y", "-loglevel", "error", *trim, "-vf", f"fps={a.fps},scale={w}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse", str(a.out)]
    elif kind == "mp4":
        cmd = [ff, "-y", "-loglevel", "error", *trim, "-r", str(a.fps), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(a.out)]
    else:
        cmd = [ff, "-y", "-loglevel", "error", *trim, "-c", "copy", str(a.out)]
    subprocess.run(cmd, check=True)
    print(a.out)


if __name__ == "__main__":
    main()
