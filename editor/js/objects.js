/* Insert → Word art, as Slides: one line of text drawn as filled (and optionally outlined) letters stretched to the
   box; it starts in editing with "Word art" selected, and Enter finishes. */
function addWordArt() {
  stopEdit();
  const b = makeBox({ x: 560, y: 440, w: 800, h: 200, shape: 'wordart', html: 'Word art' });
  b.style.setProperty('--fill', '#000000');
  insert(b); renderShape(b); startEdit(b);
}
function addShape(shape, g, extra = {}) {
  const line = /line$|^elbow$|^curve$|^path$/.test(shape), bent = /^(elbow|curve|path)$/.test(shape);
  const b = makeBox(g || { x: 660, y: line && !bent ? 540 : 340, w: 600, h: line && !bent ? 0 : 400, shape });
  b.dataset.shape = shape; Object.assign(b.dataset, extra.data || {}); if (extra.rot) setRot(b, extra.rot);
  if (line) { b.style.setProperty('--stroke', '#333333'); b.style.setProperty('--sw', '4px'); }
  else {   // Slides' current default shape: light grey, 1pt grey outline, 14pt text
    b.style.setProperty('--fill', '#eeeeee'); b.style.setProperty('--stroke', '#595959'); b.style.setProperty('--sw', `${Math.round(PT * 1000) / 1000}px`);   // 1pt dark grey, as Slides
    content(b).style.fontSize = Math.round(14 * PT * 100) / 100 + 'px';
  }
  renderShape(b);
  insert(b);
  return b;
}

/* Pictures larger than a slide can show are stored smaller, as Slides does: at most 2560 px on the long side (a 1920-wide
   slide, zoomed in a little), same format. A 12-megapixel phone photo goes from about 4 MB to well under 1 MB, and the
   editor decodes a sixth of the pixels. GIFs (animation), SVGs and anything that wouldn't get smaller stay as they are;
   the photo's own rotation is kept (createImageBitmap applies it). */
const MAX_PICTURE = 2560;
/** @param {Blob} file */
async function shrinkPicture(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  let bmp; try { bmp = await createImageBitmap(file); } catch { return file; }
  const k = MAX_PICTURE / Math.max(bmp.width, bmp.height);
  if (k >= 1) { bmp.close(); return file; }
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
  const out = await new Promise(r => c.toBlob(r, file.type, 0.9));
  return out && out.size < file.size ? out : file;
}

/* Replace image (keeps the box's place and size, as Slides) and Reset size (back to the picture's own proportions,
   fitted as on insertion and kept centred). */
async function uploadImage(file) {
  file = await shrinkPicture(file);
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  return (await (await fetch('/api/upload?ext=' + ext, { method: 'POST', body: file })).json()).src;
}
async function replaceImage(b, file) {
  const img = b.querySelector('.content > img'); if (!img) return;
  setStatus('Uploading image…'); img.src = await uploadImage(file); setStatus(''); renderThumbs(); commit();
}
async function resetImageSize(b) {
  const img = b.querySelector('.content > img'); if (!img) return;
  await img.decode().catch(() => {});
  let w = img.naturalWidth || 800, h = img.naturalHeight || 600; const k = Math.min(1, 1200 / w, 800 / h); w *= k; h *= k;
  const g = geo(b); setGeo(b, { x: g.x + g.w / 2 - w / 2, y: g.y + g.h / 2 - h / 2, w, h }); drawOverlay(); commit();
}
$('#ed-replace-image').onclick = () => $('#ed-replace-file').click();
$('#ed-crop').onclick = () => cropping ? endCrop() : enterCrop([...sel][0]);
$('#ed-replace-file').onchange = async e => { const f = e.target.files[0], b = [...sel][0]; e.target.value = ''; if (f && b) await replaceImage(b, f); };

/* Videos, as Slides: MP4 / WebM / MOV copied to assets/, shown as a <video> in a .box.video. The editor shows the
   poster (its first frame, captured on insert) with a play badge; decks play it with native controls, and reveal.js
   starts it when the slide appears if it has data-autoplay. Format options → Video playback sets autoplay, mute, loop. */
async function videoPoster(src) {
  const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = src;
  await new Promise(r => { v.onloadeddata = r; v.onerror = r; setTimeout(r, 4000); });
  if (!v.videoWidth) return null;
  v.currentTime = Math.min(0.1, v.duration || 0); await new Promise(r => { v.onseeked = r; setTimeout(r, 1500); });
  const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight; cv.getContext('2d').drawImage(v, 0, 0);
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85)).then(b => b && shrinkPicture(b));   // a 4K video's frame is a big picture too
  return blob ? { poster: (await (await fetch('/api/upload?ext=jpg', { method: 'POST', body: blob })).json()).src, w: v.videoWidth, h: v.videoHeight } : null;
}
/* Insert → Audio (Keynote's audio object; Slides' Insert → Audio): a speaker icon on the slide whose <audio> plays when
   it's clicked in the slideshow, or by itself (Format options → Audio playback). */
const SPEAKER = '<svg class="audio-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
async function addAudio(file) {
  setStatus('Uploading audio…');
  const ext = (file.name.split('.').pop() || 'mp3').toLowerCase();
  const { src } = await (await fetch('/api/upload?ext=' + ext, { method: 'POST', body: file })).json();
  insert(makeBox({ x: W / 2 - 48, y: H / 2 - 48, w: 96, h: 96, cls: 'audio', html: SPEAKER + `<audio src="${src}" preload="metadata"></audio>` })); setStatus('');
}
async function addVideo(file, at) {
  const mb = file.size / 1e6;
  setStatus(mb > 50 ? `Uploading a large video (${Math.round(mb)} MB): the deck folder grows by that much…` : 'Uploading video…');
  const ext = /quicktime/.test(file.type) ? 'mov' : (file.type.split('/')[1] || 'mp4');
  const { src } = await (await fetch('/api/upload?ext=' + ext, { method: 'POST', body: file })).json();
  const p = await videoPoster(src);
  let w = p?.w || 1280, h = p?.h || 720; const k = Math.min(1, 1200 / w, 800 / h); w *= k; h *= k;
  const b = makeBox({ x: (at?.x ?? W / 2) - w / 2, y: (at?.y ?? H / 2) - h / 2, w, h, cls: 'video', html: `<video src="${src}"${p ? ` poster="${p.poster}"` : ''} controls playsinline preload="metadata"></video>` });
  insert(b);
  setStatus(mb > 50 ? `Large video (${Math.round(mb)} MB) added` : '');
}
/* Web embeds (Insert → Embed, Video → By URL): a `.box.embed` holding an <iframe>. YouTube / Vimeo page addresses
   become their player addresses, as Slides does for YouTube. */
function embedURL(u) {
  const yt = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/), vm = u.match(/vimeo\.com\/(\d+)/);
  return yt ? `https://www.youtube.com/embed/${yt[1]}` : vm ? `https://player.vimeo.com/video/${vm[1]}` : u;
}
function addEmbed(url) {
  if (!/^https?:\/\//.test(url)) return setStatus('An embed needs a web address (https://…)', 'error');
  const src = embedURL(url), video = src !== url, w = 1280, h = video ? 720 : 800;
  const b = makeBox({ x: (W - w) / 2, y: (H - h) / 2, w, h, cls: 'embed', html: `<iframe src="${src.replace(/"/g, '&quot;')}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>` });
  insert(b);
}
/* Live boxes (Insert → Live box): a `.box.live` running a page of its own (an .html file in assets/) in a sandboxed
   iframe: its script runs, but it can't reach the deck, the editor, files or accounts (no allow-same-origin, and the
   servers send assets' HTML with a sandbox policy too). Double-click one to edit its page. */
const LIVE_START = `<!doctype html>
<html><body style="margin:0;overflow:hidden;background:#fff">
<canvas id="c"></canvas>
<script>
// A live box: this page runs on the slide, in its own sandbox. Replace it with your demo.
const c = document.getElementById('c'), x = c.getContext('2d');
const fit = () => { c.width = innerWidth; c.height = innerHeight; }; addEventListener('resize', fit); fit();
let t = 0;
(function draw() {
  t += 0.02; x.clearRect(0, 0, c.width, c.height);
  for (let i = 0; i < 12; i++) {
    const a = t + i * Math.PI / 6, r = Math.min(c.width, c.height) * 0.35;
    x.beginPath(); x.arc(c.width / 2 + Math.cos(a) * r, c.height / 2 + Math.sin(2 * a) * r * 0.5, 14, 0, 7);
    x.fillStyle = 'hsl(' + i * 30 + ' 70% 55%)'; x.fill();
  }
  requestAnimationFrame(draw);
})();
</script>
</body></html>
`;
const liveFrame = src => `<iframe src="${src.replace(/"/g, '&quot;')}" sandbox="allow-scripts allow-pointer-lock" loading="lazy" title="Live box"></iframe>`;
const saveLivePage = async text => (await (await fetch('/api/upload?ext=html', { method: 'POST', body: new Blob([text], { type: 'text/html' }) })).json()).src;
async function addLive() {
  const src = await saveLivePage(LIVE_START), w = 1280, h = 720;
  if (!src) return setStatus("Couldn't save the live box's page", 'error');
  insert(makeBox({ x: (W - w) / 2, y: (H - h) / 2, w, h, cls: 'live', html: liveFrame(src) }));
}
/* A dialog for a block of code: a live box's page, a slide's style. */
const liveDlg = $('#ed-livedlg');
function askCode(title, help, value, done) {
  closeMenu(); $('#ed-code-title').textContent = title; $('#ed-code-help').textContent = help; $('#ed-live-code').value = value;
  liveDlg.hidden = false; $('#ed-live-code').focus();
  $('#ed-live-ok').onclick = () => { liveDlg.hidden = true; done($('#ed-live-code').value); };
}
async function editLive(b) {
  const f = b.querySelector('iframe'), src = f?.getAttribute('src') || '';
  const text = src ? await fetch(src).then(r => r.ok ? r.text() : '').catch(() => '') : f?.getAttribute('srcdoc') || '';
  askCode('Live box', "A page of its own, with its script, running on the slide in a sandbox: it can draw, animate and respond to the mouse, but can't reach the deck, your files or your accounts.", text, async page => {
    const next = await saveLivePage(page); if (!next) return setStatus("Couldn't save the live box's page", 'error');
    content(b).innerHTML = liveFrame(next); commit(); render();
  });
}
/* Slide → Slide style: CSS for this slide only, kept in the slide as <style class="slide-css" media="not all"> (inert as
   written; the editor and the slideshow apply it scoped to the slide). */
const slideCSS = s => s?.querySelector(':scope > style')?.textContent.trim() || '';
function editSlideCSS() {
  const s = slides[cur];
  askCode('Slide style', 'CSS for this slide only, e.g. .box > .content { font-family: Georgia, serif; } or .box[data-role="title"] > .content { color: #2f6bff; }', slideCSS(s), css => {
    let st = s.querySelector(':scope > style');
    if (!css.trim()) st?.remove();
    else { if (!st) { st = document.createElement('style'); s.append(st); } st.className = 'slide-css'; st.media = 'not all'; st.textContent = '\n' + css.trim() + '\n'; }
    commit(); render();
  });
}
$('#ed-live-cancel').onclick = liveDlg.querySelector('.sc-close').onclick = () => { liveDlg.hidden = true; };
$('#ed-live-code').addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); } e.stopPropagation(); });   // a code box: Tab indents, keys stay here
const urlDlg = $('#ed-urldlg');
function askURL(title, done, value = '') {
  closeMenu(); $('#ed-url-title').textContent = title; $('#ed-url-in').value = value; urlDlg.hidden = false; $('#ed-url-in').focus(); $('#ed-url-in').select();
  urlDlg.onsubmit = () => { const v = $('#ed-url-in').value.trim(); urlDlg.hidden = true; if (v) done(v); };
}
$('#ed-url-ok').onclick = () => urlDlg.onsubmit?.();
$('#ed-url-cancel').onclick = urlDlg.querySelector('.sc-close').onclick = () => { urlDlg.hidden = true; };
$('#ed-url-in').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); urlDlg.onsubmit?.(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); urlDlg.hidden = true; } };
const isVideoFile = f => /^video\/(mp4|webm|quicktime)$/.test(f.type) || /\.(mp4|webm|mov)$/i.test(f.name || '');

/* Crop, as Slides: double-click a picture (or the toolbar Crop button) and drag its black marks; the box shrinks and
   the picture stays where it is. ↵, Esc or a click elsewhere ends. Stored as data-crop (see cropBox in shapes.js). */
let cropping = null;
const cropOf = b => { const v = (b.dataset.crop || '0 0 0 0').split(/\s+/).map(Number); return { t: v[0] || 0, r: v[1] || 0, b: v[2] || 0, l: v[3] || 0 }; };
function enterCrop(b) { if (!b?.querySelector('.content > img')) return; stopEdit(); cropping = b; sel = new Set([b]); drawOverlay(); updateToolbar(); $('#ed-crop')?.classList.add('on'); }
function endCrop() { if (!cropping) return; cropping = null; $('#ed-crop')?.classList.remove('on'); drawOverlay(); }
function startCrop(e, dir) {
  const b = cropping, g0 = geo(b), c0 = cropOf(b), p0 = toCanvas(e);
  const fw = g0.w / (1 - c0.l - c0.r), fh = g0.h / (1 - c0.t - c0.b), X0 = g0.x - c0.l * fw, Y0 = g0.y - c0.t * fh;   // the whole picture
  busy = true;
  drag(e, ev => {
    const p = toCanvas(ev), dx = (p.x - p0.x) / fw, dy = (p.y - p0.y) / fh, c = { ...c0 }, min = 0.05;
    if (dir.includes('w')) c.l = Math.max(0, Math.min(1 - c.r - min, c0.l + dx));
    if (dir.includes('e')) c.r = Math.max(0, Math.min(1 - c.l - min, c0.r - dx));
    if (dir.includes('n')) c.t = Math.max(0, Math.min(1 - c.b - min, c0.t + dy));
    if (dir.includes('s')) c.b = Math.max(0, Math.min(1 - c.t - min, c0.b - dy));
    const r3 = v => Math.round(v * 1000) / 1000;
    if (c.t || c.r || c.b || c.l) b.dataset.crop = [c.t, c.r, c.b, c.l].map(r3).join(' '); else delete b.dataset.crop;
    setGeo(b, { x: X0 + c.l * fw, y: Y0 + c.t * fh, w: (1 - c.l - c.r) * fw, h: (1 - c.t - c.b) * fh }); cropBox(b); drawOverlay();
  }, () => { busy = false; commit(); });
}
/* Mask image (Slides' Crop ▾; Keynote's Mask with Shape): the picture clipped to a shape (data-mask), Rectangle takes it
   off, then crop mode to fit it. In crop mode the whole picture shows faintly around the frame; dragging the picture moves
   it inside the frame and the bar's slider scales it about the frame's middle (Keynote's mask bar), Done ends. */
function maskImage(shape) {
  const pics = [...sel].filter(b => b.querySelector(':scope > .content > img'));
  if (!pics.length) return setStatus('Select a picture to mask', 'error');
  pics.forEach(b => { if (shape === 'rect') delete b.dataset.mask; else b.dataset.mask = shape; cropBox(b); });
  commit(); render(); if (pics.length === 1) enterCrop(pics[0]);
}
const setCrop = (b, c) => { const r3 = v => Math.round(v * 1000) / 1000; if (c.t || c.r || c.b || c.l) b.dataset.crop = [c.t, c.r, c.b, c.l].map(r3).join(' '); else delete b.dataset.crop; cropBox(b); };
function drawCropExtras(b, g, k, host) {
  const img = b.querySelector(':scope > .content > img'); if (!img || b.style.transform) return;   // (not on a turned picture)
  const gh = div('crop-ghost'), pan = /** @type {HTMLElement} */ (b.cloneNode(true)), bar = div('mask-bar'); gh.append(img.cloneNode());   // the frame's part over the faint whole
  pan.removeAttribute('id'); pan.querySelectorAll('[id]').forEach(e => e.removeAttribute('id')); pan.classList.add('crop-pan'); pan.title = gh.title = 'Drag to move the picture inside its frame';
  let c = cropOf(b);
  const show = () => { const fw = g.w / (1 - c.l - c.r), fh = g.h / (1 - c.t - c.b), x0 = g.x - c.l * fw, y0 = g.y - c.t * fh;
    gh.style.cssText = `left:${x0}px;top:${y0}px;width:${fw}px;height:${fh}px`; if (b.dataset.crop) pan.dataset.crop = b.dataset.crop; else delete pan.dataset.crop; cropBox(pan); return { fw, fh }; };
  show();
  gh.onpointerdown = pan.onpointerdown = e => {
    e.stopPropagation(); const p0 = toCanvas(e), c0 = c, { fw, fh } = show(); busy = true;
    drag(e, ev => { const p = toCanvas(ev), l = Math.max(0, Math.min(c0.l + c0.r, c0.l - (p.x - p0.x) / fw)), t = Math.max(0, Math.min(c0.t + c0.b, c0.t - (p.y - p0.y) / fh));
      c = { l, r: c0.l + c0.r - l, t, b: c0.t + c0.b - t }; setCrop(b, c); show(); }, () => { busy = false; commit(); drawOverlay(); });
  };
  const vw = 1 - c.l - c.r, vh = 1 - c.t - c.b, k0 = 1 / vw;   // the picture's width over the frame's
  bar.innerHTML = `<span class="icon" title="Scale the picture">photo_size_select_large</span><input type="range" min="${Math.ceil(k0 * Math.max(vw, vh) * 100)}" max="400" value="${Math.round(k0 * 100)}" aria-label="Scale the picture"><button>Done</button>`;
  bar.style.cssText = `left:${g.x + g.w / 2}px;top:${g.y + g.h + 14 * k}px;--k:${k}px`;
  const sl = /** @type {HTMLInputElement} */ (bar.querySelector('input'));
  sl.oninput = () => { const s = +sl.value / 100 / k0, cx = c.l + (1 - c.l - c.r) / 2, cy = c.t + (1 - c.t - c.b) / 2, nw = vw / s, nh = vh / s;   // about the frame's middle
    const fit = (mid, n) => { const a = Math.max(0, Math.min(1 - n, mid - n / 2)); return [a, Math.max(0, 1 - n - a)]; };
    const [l, r] = fit(cx, nw), [t, bt] = fit(cy, nh); c = { l, r, t, b: bt }; setCrop(b, c); show(); };
  sl.onchange = () => { commit(); drawOverlay(); };
  bar.querySelector('button').onclick = () => endCrop();
  bar.onpointerdown = bar.onmousedown = e => e.stopPropagation();
  host.append(gh, pan, bar);
}

/* Remove background (Keynote's Instant Alpha, r01): the colour touching the picture's edges goes at once (shown faint);
   click or drag across another colour to take it too, dragging further taking in more shades (each contiguous from where
   you pressed). Reset brings it all back, Done (↵) writes a new PNG beside the original (data-original keeps the old one
   for Reset image) and trims the frame to what's left (data-crop), Esc leaves it as it was. */
let unbg = null;
const UNBG_MAX = 2400;   // the working size, in pixels along the longer side
async function removeBackground(b) {
  const img = /** @type {HTMLImageElement | null} */ (b?.querySelector(':scope > .content > img')); if (!img) return;
  endCrop(); stopEdit(); endUnbg(false);
  const pic = new Image(); pic.src = img.currentSrc || img.src; await pic.decode().catch(() => {});
  if (!pic.naturalWidth) return setStatus("Can't read this picture", 'error');
  const t0 = performance.now(), z = Math.min(1, UNBG_MAX / Math.max(pic.naturalWidth, pic.naturalHeight)), cw = Math.round(pic.naturalWidth * z), ch = Math.round(pic.naturalHeight * z);
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const x = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d', { willReadFrequently: true }));
  x.drawImage(pic, 0, 0, cw, ch); const orig = x.getImageData(0, 0, cw, ch);
  unbg = { b, img, cv, x, orig, cw, ch, gone: new Uint8Array(cw * ch), view: div('unbg'), bar: div('mask-bar unbg-bar') };
  const d = orig.data, corner = [0, cw - 1, (ch - 1) * cw, ch * cw - 1].map(i => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2], d[i * 4 + 3]]);
  const ref = corner.reduce((best, c) => corner.filter(o => near(o, c, 40)).length > corner.filter(o => near(o, best, 40)).length ? c : best);   // the edges' colour: what most corners share
  const seeds = []; for (let i = 0; i < cw; i++) seeds.push(i, (ch - 1) * cw + i); for (let j = 0; j < ch; j++) seeds.push(j * cw, j * cw + cw - 1);
  flood(unbg.gone, seeds, ref, 40);
  unbg.view.append(cv); sel = new Set([b]); img.style.visibility = 'hidden'; paintUnbg(); drawOverlay(); updateToolbar();
  setStatus(`Background removed in ${Math.round(performance.now() - t0)} ms`);
  addEventListener('keydown', unbgKeys, true);
}
const near = (a, c, tol) => (a[0] - c[0]) ** 2 + (a[1] - c[1]) ** 2 + (a[2] - c[2]) ** 2 + (a[3] - c[3]) ** 2 <= tol * tol;
/* Takes into `gone` every pixel joined to a seed whose colour is within tol of ref. */
function flood(gone, seeds, ref, tol) {
  const { cw, ch, orig: { data: d } } = unbg, seen = new Uint8Array(cw * ch), stack = new Int32Array(cw * ch + seeds.length); let n = 0;
  const ok = i => { const p = i * 4; return (d[p] - ref[0]) ** 2 + (d[p + 1] - ref[1]) ** 2 + (d[p + 2] - ref[2]) ** 2 + (d[p + 3] - ref[3]) ** 2 <= tol * tol; };
  for (const s of seeds) if (!seen[s] && ok(s)) { seen[s] = 1; stack[n++] = s; }
  while (n) { const i = stack[--n]; gone[i] = 1; const xx = i % cw;
    for (const j of [xx > 0 ? i - 1 : -1, xx < cw - 1 ? i + 1 : -1, i - cw, i + cw]) if (j >= 0 && j < cw * ch && !seen[j] && ok(j)) { seen[j] = 1; stack[n++] = j; } }
}
function paintUnbg(final = false, u = unbg) {   // removed pixels faint while editing, gone when done
  const { x, orig, gone } = u, out = new ImageData(new Uint8ClampedArray(orig.data), orig.width, orig.height), a = final ? 0 : 0.3;
  for (let i = 0; i < gone.length; i++) if (gone[i]) out.data[i * 4 + 3] *= a;
  x.putImageData(out, 0, 0);
}
function drawUnbg(host, g, k) {   // the picture as it will be, over its box, with Keynote's bar under it
  const { b, view, bar } = unbg, c = cropOf(b), fw = g.w / (1 - c.l - c.r), fh = g.h / (1 - c.t - c.b);
  place(view, g); view.style.transform = b.style.transform; Object.assign(unbg.cv.style, { left: -c.l * fw + 'px', top: -c.t * fh + 'px', width: fw + 'px', height: fh + 'px' });
  if (!bar.firstChild) {
    bar.innerHTML = '<span>Background removed. Click or drag across colors to also make them transparent.</span><button class="reset">Reset</button><button class="done">Done</button>';
    bar.querySelector('.reset').onclick = () => { unbg.gone.fill(0); paintUnbg(); };
    bar.querySelector('.done').onclick = () => endUnbg(true);
    bar.onpointerdown = bar.onmousedown = e => e.stopPropagation();
    view.onmousedown = e => e.stopPropagation();
    view.onpointerdown = e => {   // click or drag across a colour: that colour goes too, more shades the further you drag
      e.stopPropagation(); e.preventDefault(); const r = unbg.cv.getBoundingClientRect(), px = Math.floor((e.clientX - r.left) / r.width * unbg.cw), py = Math.floor((e.clientY - r.top) / r.height * unbg.ch);
      if (px < 0 || py < 0 || px >= unbg.cw || py >= unbg.ch) return;
      const seed = py * unbg.cw + px, d = unbg.orig.data, ref = [d[seed * 4], d[seed * 4 + 1], d[seed * 4 + 2], d[seed * 4 + 3]], before = unbg.gone.slice(); let raf = 0;
      const take = dist => { unbg.gone = before.slice(); flood(unbg.gone, [seed], ref, Math.min(200, 30 + dist * 0.6)); paintUnbg(); };
      take(0); busy = true;
      drag(e, ev => { const dist = Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY); cancelAnimationFrame(raf); raf = requestAnimationFrame(() => take(dist)); }, () => { busy = false; });
    };
  }
  bar.style.cssText = `left:${g.x + g.w / 2}px;top:${g.y + g.h + 14 * k}px;--k:${k}px`;
  host.append(view, bar);
}
function unbgKeys(e) { if (!unbg) return; if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); endUnbg(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endUnbg(false); } }
async function endUnbg(keep) {
  if (!unbg) return; const u = unbg; unbg = null; removeEventListener('keydown', unbgKeys, true);
  u.img.style.visibility = ''; if (!u.img.getAttribute('style')) u.img.removeAttribute('style');
  if (!keep || !u.gone.includes(1)) { drawOverlay(); return; }
  paintUnbg(true, u);
  let x0 = u.cw, y0 = u.ch, x1 = -1, y1 = -1;   // what's left, to trim the frame to
  for (let j = 0; j < u.ch; j++) for (let i = 0; i < u.cw; i++) if (!u.gone[j * u.cw + i]) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
  const blob = await new Promise(r => u.cv.toBlob(r, 'image/png'));
  const { src } = await (await fetch('/api/upload?ext=png', { method: 'POST', body: blob })).json();
  const b = u.b, g = geo(b), c = cropOf(b), fw = g.w / (1 - c.l - c.r), fh = g.h / (1 - c.t - c.b), X0 = g.x - c.l * fw, Y0 = g.y - c.t * fh;
  b.dataset.original ||= plainSrc(u.img.getAttribute('src') || ''); u.img.setAttribute('src', src);
  if (x1 >= 0) { const n = { l: Math.max(c.l, x0 / u.cw), r: Math.max(c.r, 1 - (x1 + 1) / u.cw), t: Math.max(c.t, y0 / u.ch), b: Math.max(c.b, 1 - (y1 + 1) / u.ch) };
    setCrop(b, n); setGeo(b, { x: X0 + n.l * fw, y: Y0 + n.t * fh, w: (1 - n.l - n.r) * fw, h: (1 - n.t - n.b) * fh }); }
  commit(); render(); drawOverlay(); setStatus('Background removed');
}

async function addImage(file, at) {
  setStatus('Uploading image…');
  file = await shrinkPicture(file);
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  const r = await fetch('/api/upload?ext=' + ext, { method: 'POST', body: file });
  const { src } = await r.json();
  await addImageSrc(src, at);
}
async function addImageSrc(src, at) {   // a picture already in assets/, sized as Slides inserts one
  const img = new Image(); img.src = src;
  await img.decode().catch(() => {});
  let w = img.naturalWidth || 800, h = img.naturalHeight || 600;
  const k = Math.min(1, 1200 / w, 800 / h); w *= k; h *= k;
  const b = makeBox({ x: (at?.x ?? W / 2) - w / 2, y: (at?.y ?? H / 2) - h / 2, w, h, cls: 'image', html: `<img src="${src}" alt="">` });
  insert(b);
}
