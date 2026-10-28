/* Slide → Change background: Slides' dialog with a colour, an image (reveal's data-background-image, cover), and ours:
   a video (data-background-video, muted and looping) or a web page (data-background-iframe), then Reset. */
function paintBg(el, s) {
  el.style.background = ''; Object.assign(el.style, bgCss(s));   // colour, gradient, picture with its scale, opacity and tint (shapes.js)
  // a video or web page behind the slide: playing on the canvas, a still frame or a placeholder in thumbnails
  const media = fresh(s.dataset.backgroundVideo || '') || s.dataset.backgroundIframe || '', live = el === frame, old = el.querySelector(':scope > .bg-media');
  if (!media) return old?.remove();
  if (old?.dataset.src === media + live) return;
  const m = div('bg-media'); m.dataset.src = media + live;
  if (s.dataset.backgroundVideo && !live) {   // a thumbnail: the video's first frame, as a picture (render.js)
    const still = videoStill(media); if (still) m.style.background = `center / cover no-repeat url("${still}")`;
  } else if (s.dataset.backgroundVideo) {
    const v = document.createElement('video'); v.src = media; v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'metadata'; v.autoplay = true; m.append(v);
  } else if (live) { const f = document.createElement('iframe'); f.src = media; f.setAttribute('sandbox', 'allow-scripts allow-same-origin'); f.loading = 'lazy'; m.append(f); }
  else m.innerHTML = '<span class="icon">public</span>';
  old ? old.replaceWith(m) : el.prepend(m);
}
const bgDlg = $('#ed-bgdlg');
function syncBgDialog() {
  const s = slides[cur]; if (!s) return;
  $('#ed-bg-color .chip').style.background = s.dataset.backgroundColor || '#fff';
  const d = s.dataset; bgDlg.querySelectorAll('.bg-img-opt').forEach(r => { /** @type {HTMLElement} */ (r).hidden = !d.backgroundImage; });
  $('#ed-bg-size').value = d.backgroundRepeat === 'repeat' ? 'auto repeat' : d.backgroundSize || '';
  $('#ed-bg-opacity').value = $('#ed-bg-opacity-n').textContent = String(Math.round((d.backgroundOpacity === undefined ? 1 : +d.backgroundOpacity) * 100));
  $('#ed-bg-tint').value = (d.backgroundTint || '#000000').slice(0, 7);
  $('#ed-bg-color .chip').style.background = d.backgroundGradient && !d.backgroundImage ? d.backgroundGradient : d.backgroundColor || '#fff';
  $('#ed-bg-reset').disabled = !s.dataset.backgroundImage && !s.dataset.backgroundVideo && !s.dataset.backgroundIframe && /^(#fff(fff)?)?$/i.test(s.dataset.backgroundColor || '');
}
function showBgDialog(on) { closeMenu(); bgDlg.hidden = !on; if (on) syncBgDialog(); }
$('#ed-bg-color').onclick = () => {
  if (openAnchor === $('#ed-bg-color')) return closeMenu();
  openPalette($('#ed-bg-color')); const m = document.querySelector('.menu.palette'); if (m) m.style.zIndex = '60';
};
$('#ed-bg-image').onclick = () => $('#ed-bg-file').click();
$('#ed-bg-file').onchange = async e => {
  let file = e.target.files[0]; e.target.value = ''; if (!file) return;
  file = await shrinkPicture(file);
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  const { src } = await (await fetch('/api/upload?ext=' + ext, { method: 'POST', body: file })).json();
  delete slides[cur].dataset.backgroundGradient; slides[cur].dataset.backgroundImage = src; render(); syncBgDialog(); commit();
};
/* The picture's scale, opacity and tint (Keynote's Advanced Image Fill on the background): live while dragging, one commit. */
const bgSet = (k, v) => { const s = slides[cur]; if (v == null || v === '') delete s.dataset[k]; else s.dataset[k] = v; paintBg(frame, s); };
$('#ed-bg-size').onchange = () => { const v = $('#ed-bg-size').value; bgSet('backgroundRepeat', v === 'auto repeat' ? 'repeat' : null); bgSet('backgroundSize', v === 'auto repeat' ? 'auto' : v); commit(); };
$('#ed-bg-opacity').oninput = () => { const v = +$('#ed-bg-opacity').value; $('#ed-bg-opacity-n').textContent = String(v); bgSet('backgroundOpacity', v >= 100 ? null : String(v / 100)); };
$('#ed-bg-opacity').onchange = commit;
$('#ed-bg-tint').oninput = () => bgSet('backgroundTint', $('#ed-bg-tint').value + '66');   // a 40 % veil of the colour
$('#ed-bg-tint').onchange = commit;
$('#ed-bg-tint-off').onclick = () => { bgSet('backgroundTint', null); commit(); };
const clearBgMedia = s => { for (const k of ['backgroundImage', 'backgroundSize', 'backgroundRepeat', 'backgroundOpacity', 'backgroundTint', 'backgroundGradient', 'backgroundVideo', 'backgroundVideoLoop', 'backgroundVideoMuted', 'backgroundIframe', 'backgroundInteractive']) delete s.dataset[k]; };
$('#ed-bg-video').onclick = () => $('#ed-bg-vfile').click();
$('#ed-bg-vfile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
  const { src } = await (await fetch('/api/upload?ext=' + ext, { method: 'POST', body: file })).json();
  const s = slides[cur]; clearBgMedia(s); Object.assign(s.dataset, { backgroundVideo: src, backgroundVideoLoop: '', backgroundVideoMuted: '' });
  render(); syncBgDialog(); commit();
};
$('#ed-bg-page').onclick = () => { showBgDialog(false); askURL('A web page as the background', url => {
  if (!/^https:\/\//.test(url)) return setStatus('A background page needs an https:// address', 'error');
  const s = slides[cur]; clearBgMedia(s); s.dataset.backgroundIframe = url; render(); commit();
}, slides[cur]?.dataset.backgroundIframe || ''); };
$('#ed-bg-reset').onclick = () => {
  const s = slides[cur]; clearBgMedia(s); s.dataset.backgroundColor = '#ffffff';
  render(); syncBgDialog(); commit();
};
$('#ed-bg-done').onclick = bgDlg.querySelector('.sc-close').onclick = () => showBgDialog(false);
$('#ed-bg-theme').onclick = () => { setTheme({ ...theme(), name: 'Custom', bg: slides[cur].dataset.backgroundColor || '#ffffff' }); showBgDialog(false); };   // Add to theme: every slide on the theme background follows
bgDlg.addEventListener('pointerdown', e => { if (e.target === bgDlg) showBgDialog(false); });
addEventListener('keydown', e => {
  if (bgDlg.hidden || e.key !== 'Escape') return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (document.querySelector('.menu')) closeMenu(); else showBgDialog(false);
}, true);

/* Custom spacing, as Slides: paragraph spacing before / after in pt and line spacing as Slides' multiple. */
const spaceDlg = $('#ed-spacedlg'), spTargets = [];
function showSpaceDialog(on) {
  closeMenu(); spaceDlg.hidden = !on; if (!on) return;
  spTargets.splice(0, spTargets.length, ...sel);
  const c = content(spTargets[0]), pt = side => Math.round((parseFloat(c.style.getPropertyValue(`--space-${side}`)) || 0) / PT * 10) / 10;
  F_sp('before').value = pt('before'); F_sp('after').value = pt('after');
  F_sp('line').value = Math.round(parseFloat(curLh()) / NATURAL_LH * 100) / 100;
  F_sp('line').focus(); F_sp('line').select();
}
const F_sp = k => $('#ed-sp-' + k);
function applySpacing() {
  const line = parseFloat(F_sp('line').value);
  spTargets.forEach(b => {
    const c = content(b); blockify(c);
    for (const side of ['before', 'after']) {
      const v = Math.max(0, parseFloat(F_sp(side).value) || 0);
      if (v) c.style.setProperty(`--space-${side}`, `${Math.round(v * PT * 100) / 100}px`); else c.style.removeProperty(`--space-${side}`);
    }
    if (line > 0) c.style.lineHeight = String(Math.round(line * NATURAL_LH * 1000) / 1000);
    fitHeight(b);
  });
  showSpaceDialog(false); commit();
}
$('#ed-sp-apply').onclick = applySpacing;
$('#ed-sp-cancel').onclick = spaceDlg.querySelector('.sc-close').onclick = () => showSpaceDialog(false);
spaceDlg.addEventListener('pointerdown', e => { if (e.target === spaceDlg) showSpaceDialog(false); });
addEventListener('keydown', e => {
  if (spaceDlg.hidden || !['Escape', 'Enter'].includes(e.key)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (e.key === 'Enter') applySpacing(); else showSpaceDialog(false);
}, true);

/* Slideshow ▾ → Slideshow settings, as Keynote's Document settings: the presentation type (Normal, Links only, Self-playing
   with its delays), Loop and Restart if idle, saved on the deck's .slides element; present.js plays them. */
const showDlg = $('#ed-showdlg'), SD = k => /** @type {HTMLInputElement} */ ($('#ed-show-' + k));
function showShowDialog(on) {
  closeMenu(); showDlg.hidden = !on; if (!on) return;
  const d = deckDoc.querySelector('.slides').dataset;
  SD('type').value = d.play || ''; SD('slide').value = d.playSlide || '5'; SD('build').value = d.playBuild || '2';
  SD('loop').checked = 'loop' in d; SD('idle-on').checked = !!d.idle; SD('idle').value = d.idle || '5';
  syncShowDialog();
}
function syncShowDialog() { showDlg.querySelectorAll('[data-self]').forEach(r => { /** @type {HTMLElement} */ (r).hidden = SD('type').value !== 'self'; }); SD('idle').disabled = !SD('idle-on').checked; }
function saveShowSettings() {
  const d = deckDoc.querySelector('.slides').dataset, n = k => Math.max(0, +SD(k).value || 0);
  if (SD('type').value) d.play = SD('type').value; else delete d.play;
  if (SD('type').value === 'self') { d.playSlide = String(n('slide')); d.playBuild = String(n('build')); } else { delete d.playSlide; delete d.playBuild; }
  if (SD('loop').checked) d.loop = ''; else delete d.loop;
  if (SD('idle-on').checked) d.idle = String(Math.max(1, Math.round(n('idle')))); else delete d.idle;
  syncShowDialog(); scheduleSave();
}
for (const k of ['type', 'slide', 'build', 'loop', 'idle-on', 'idle']) SD(k).onchange = saveShowSettings;
$('#ed-show-done').onclick = showDlg.querySelector('.sc-close').onclick = () => showShowDialog(false);
showDlg.addEventListener('pointerdown', e => { if (e.target === showDlg) showShowDialog(false); });
addEventListener('keydown', e => { if (!showDlg.hidden && (e.key === 'Escape' || e.key === 'Enter')) { e.preventDefault(); e.stopImmediatePropagation(); saveShowSettings(); showShowDialog(false); } }, true);

/* Slide → Go to slide (⌃⌘G, Keynote's key): type a slide number, ⏎. */
const gotoDlg = $('#ed-gotodlg');
function showGoto(on) {
  closeMenu(); gotoDlg.hidden = !on; if (!on) return;
  stopEdit(); $('#ed-goto-of').textContent = `Slide (1–${slides.length})`;
  const f = $('#ed-goto-n'); f.max = String(slides.length); f.value = String(cur + 1); f.focus(); f.select();
}
function gotoSlide() {
  const n = Math.round(+$('#ed-goto-n').value);
  showGoto(false); if (n >= 1) go(Math.min(n, slides.length) - 1);
}
$('#ed-goto-ok').onclick = gotoSlide;
$('#ed-goto-cancel').onclick = gotoDlg.querySelector('.sc-close').onclick = () => showGoto(false);
gotoDlg.addEventListener('pointerdown', e => { if (e.target === gotoDlg) showGoto(false); });
addEventListener('keydown', e => {
  if (e.ctrlKey && e.metaKey && !e.shiftKey && !e.altKey && e.code === 'KeyG' && gotoDlg.hidden && Date.now() - guideChord > 2000) { e.preventDefault(); showGoto(true); return; }   // not the second key of ⌃⌘E ⌃⌘G
  if (gotoDlg.hidden || !['Escape', 'Enter'].includes(e.key)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (e.key === 'Enter') gotoSlide(); else showGoto(false);
}, true);

/* Insert → Special characters, as Slides: a category grid, search (keyword, LaTeX command or codepoint) and the
   recently used ones; a click inserts at the caret when editing, else into a new text box. */
const charsDlg = $('#ed-chars'), recentChars = () => { try { return JSON.parse(stored('slides-recent-chars')) || []; } catch { return []; } };
function showChars(on) {
  closeMenu(); charsDlg.hidden = !on; if (!on) return;
  const cat = $('#ed-chars-cat');
  if (!cat.options.length) cat.append(...CHAR_CATEGORIES.map(([n], i) => Object.assign(document.createElement('option'), { value: i, textContent: n })));
  $('#ed-chars-q').value = ''; fillChars(); $('#ed-chars-q').focus();
}
function charMatches(q) {
  q = q.trim(); if (!q) return null;
  const hex = q.match(/^(?:u\+|0x)?([0-9a-f]{4,5})$/i);
  if (hex) return [String.fromCodePoint(parseInt(hex[1], 16))];
  const cmd = q.replace(/^\\/, '');
  const tex = Object.entries(LATEX_SYMBOLS).filter(([k]) => k.toLowerCase().startsWith(cmd.toLowerCase())).map(([, v]) => v);
  const cats = CHAR_CATEGORIES.filter(([n]) => n.toLowerCase().includes(q.toLowerCase()) || n.toLowerCase().includes(q.toLowerCase().replace(/s$/, ''))).flatMap(([, c]) => c);
  return [...new Set([...tex, ...cats, ...[...q].filter(ch => ch.codePointAt(0) > 127)])];
}
function fillChars() {
  const grid = $('#ed-chars-grid'), found = charMatches($('#ed-chars-q').value);
  const cell = ch => { const b = document.createElement('button'); b.textContent = ch; b.title = 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
    b.onmouseenter = () => { $('#ed-chars-pick').innerHTML = ''; $('#ed-chars-pick').append(Object.assign(div(''), { textContent: ch }), Object.assign(document.createElement('small'), { textContent: b.title })); };
    b.onmousedown = e => e.preventDefault(); b.onclick = () => insertChar(ch); return b; };
  const sep = t => Object.assign(div('chars-sep'), { textContent: t });
  const recent = recentChars();
  grid.replaceChildren(...(found ? found.map(cell)
    : [...(recent.length ? [sep('Recently used'), ...recent.map(cell), sep(CHAR_CATEGORIES[$('#ed-chars-cat').value][0])] : []), ...CHAR_CATEGORIES[$('#ed-chars-cat').value][1].map(cell)]));
  $('#ed-chars-pick').textContent = '';
}
function insertChar(ch) {
  store('slides-recent-chars', JSON.stringify([ch, ...recentChars().filter(c => c !== ch)].slice(0, 22)));
  if (editing) { content(editing).focus(); editSelection(); document.execCommand('insertText', false, ch); fitHeight(editing); }
  else { const b = addText(ch); sel = new Set([b]); drawOverlay(); commit(); }
  fillChars();
}
$('#ed-chars-cat').onchange = fillChars;
$('#ed-chars-q').oninput = fillChars;
charsDlg.querySelector('.sc-close').onclick = () => showChars(false);
charsDlg.addEventListener('pointerdown', e => { if (e.target === charsDlg) showChars(false); });
addEventListener('keydown', e => { if (!charsDlg.hidden && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); showChars(false); } }, true);

/* Insert → Icon: the Material Symbols names (editor/data/icons.json) in a searchable grid. An icon is a box with
   data-shape="icon" data-icon="<name>"; the deck loads just the glyphs it uses through <link id="deck-icons">. */
const iconsDlg = $('#ed-icons');
let iconNames = null;
async function showIcons(on) {
  closeMenu(); iconsDlg.hidden = !on; if (!on) return;
  iconNames ??= await fetch('/editor/data/icons.json').then(r => r.json()).catch(() => []);
  $('#ed-icons-q').value = ''; fillIcons(); $('#ed-icons-q').focus();
}
function fillIcons() {
  const q = $('#ed-icons-q').value.trim().toLowerCase().replace(/\s+/g, '_');
  const hits = (q ? iconNames.filter(n => n.includes(q)).sort((a, b) => (a.startsWith(q) ? 0 : 1) - (b.startsWith(q) ? 0 : 1)) : iconNames).slice(0, 600);
  $('#ed-icons-grid').replaceChildren(...hits.map(n => { const b = document.createElement('button'); b.className = 'icon'; b.textContent = n; b.dataset.tip = n.replace(/_/g, ' '); b.onclick = () => addIcon(n); return b; }));
}
function syncDeckIcons() {   // one link with every icon the deck uses (Google wants icon_names sorted)
  const names = [...new Set(slides.flatMap(s => [...s.querySelectorAll('.box[data-shape="icon"]')].map(b => b.dataset.icon)).filter(Boolean))].sort();
  let l = deckDoc.querySelector('link#deck-icons');
  if (!names.length) { l?.remove(); return; }
  if (!l) { l = deckDoc.createElement('link'); l.id = 'deck-icons'; l.rel = 'stylesheet'; (deckDoc.querySelector('#deck-base') || deckDoc.head.lastChild).before(l); }
  l.setAttribute('href', `https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&icon_names=${names.join(',')}&display=block`);
}
function addIcon(name) {
  showIcons(false);
  const b = makeBox({ x: W / 2 - 96, y: H / 2 - 96, w: 192, h: 192, shape: 'icon' });
  b.dataset.icon = name; b.style.setProperty('--fill', '#202124'); renderShape(b);
  insert(b); syncDeckIcons(); scheduleSave();
}
$('#ed-icons-q').oninput = fillIcons;
iconsDlg.querySelector('.sc-close').onclick = () => showIcons(false);
iconsDlg.addEventListener('pointerdown', e => { if (e.target === iconsDlg) showIcons(false); });
addEventListener('keydown', e => { if (!iconsDlg.hidden && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); showIcons(false); } }, true);
