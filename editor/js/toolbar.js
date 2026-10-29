/* ---------- toolbar ---------- */

// Buttons must not take focus away from text being edited.
$('#ed-bar').addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });

$('#ed-undo').onclick = undo;
$('#ed-redo').onclick = redo;
$('#ed-add-text').onclick = () => { stopEdit(); startEdit(addText()); };
/* Icon buttons that open a menu, as in Slides' toolbar. */
const menuButton = (btn, items) => { btn.onclick = () => openAnchor === btn ? closeMenu() : openMenu(btn, items()); };
menuButton($('#ed-add-shape'), () => shapeItems());
menuButton($('#ed-add-line'), () => lineItems());
$('#ed-video-file').onchange = async e => { stopEdit(); for (const f of e.target.files) await addVideo(f); e.target.value = ''; };
$('#ed-file').onchange = async e => { stopEdit(); for (const f of e.target.files) await addImage(f); e.target.value = ''; };

function setVar(name, v) {
  for (const b of sel) {
    if (v == null) b.style.removeProperty(name); else b.style.setProperty(name, v);
    if (b.dataset.shape) renderShape(b);
  }
  drawOverlay();
}
/* The bar under a color icon shows the current color. */
function paintBars() { document.querySelectorAll('.swatch[data-for] .bar').forEach(bar => { bar.style.background = $('#ed-' + bar.parentElement.dataset.for).value; }); }
document.querySelectorAll('.color-input').forEach(i => i.addEventListener('input', paintBars));

/* Google's color popover: Transparent (fill, border), the 8×10 standard palette, and Custom (+ opens
   the system picker; picked colors are remembered in this browser). Applying a color goes through
   the hidden <input type=color>, so it shares the input/change handlers above. */
const PALETTE = `000000 434343 666666 999999 b7b7b7 cccccc d9d9d9 efefef f3f3f3 ffffff
980000 ff0000 ff9900 ffff00 00ff00 00ffff 4a86e8 0000ff 9900ff ff00ff
e6b8af f4cccc fce5cd fff2cc d9ead3 d0e0e3 c9daf8 cfe2f3 d9d2e9 ead1dc
dd7e6b ea9999 f9cb9c ffe599 b6d7a8 a2c4c9 a4c2f4 9fc5e8 b4a7d6 d5a6bd
cc4125 e06666 f6b26b ffd966 93c47d 76a5af 6d9eeb 6fa8dc 8e7cc3 c27ba0
a61c00 cc0000 e69138 f1c232 6aa84f 45818e 3c78d8 3d85c6 674ea7 a64d79
85200c 990000 b45f06 bf9000 38761d 134f5c 1155cc 0b5394 351c75 741b47
5b0f00 660000 783f04 7f6000 274e13 0c343d 1c4587 073763 20124d 4c1130`.split(/\s+/).map(c => '#' + c);
/* The default theme's colors (Slides' "Simple Light"), shown above the standard palette. */
const THEME_COLORS = ['#000000', '#ffffff', '#595959', '#eeeeee', '#4285f4', '#212121', '#78909c', '#ffab40', '#0097a7', '#eeff41'];
const recentColors = () => { try { return JSON.parse(localStorage.getItem('slides-custom-colors')) || []; } catch { return []; } };
function rememberColor(c) {
  const list = [c, ...recentColors().filter(x => x !== c)].slice(0, 10);
  try { localStorage.setItem('slides-custom-colors', JSON.stringify(list)); } catch {}
}
function setColor(input, c) { input.value = c; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change')); }
function openPalette(btn) {
  closeMenu();
  const input = $('#ed-' + btn.dataset.for), now = input.value.toLowerCase(), m = div('menu palette');
  const cell = c => {
    const e = document.createElement('button');
    e.className = 'cell' + (c === now ? ' on' : ''); e.style.background = c; e.dataset.color = c; e.dataset.tip = c;
    e.onclick = () => { closeMenu(); setColor(input, c); };
    return e;
  };
  if (btn.dataset.for !== 'color' && btn.dataset.for !== 'bg') {
    const t = document.createElement('button'), none = btn.dataset.for === 'hilite';
    t.className = 'menu-item transparent'; t.innerHTML = `<span class="icon">format_color_reset</span><span class="menu-label">${none ? 'None' : 'Transparent'}</span>`;
    t.onclick = () => { closeMenu(); if (none) hilite('transparent'); else if (btn.dataset.for === 'fill') { if (!fillCells('transparent')) { setGradient(null); setVar('--fill', 'transparent'); } commit(); } else noBorder(); };
    m.append(t, div('menu-sep'));
  }
  let solidStart = m.children.length;
  const theme = div('palette-head'); theme.textContent = 'SIMPLE LIGHT'; m.append(theme);
  const themeRow = div('cells'); THEME_COLORS.forEach(c => themeRow.append(cell(c))); m.append(themeRow);
  const head = div('palette-head'); head.textContent = 'CUSTOM'; m.append(head);
  const custom = div('cells');
  const plus = document.createElement('button');
  plus.className = 'cell plus'; plus.innerHTML = '<span class="icon">add</span>'; plus.dataset.tip = 'Custom';
  plus.onclick = () => {
    closeMenu();
    input.addEventListener('change', () => rememberColor(input.value), { once: true });
    input.click();
  };
  const drop = document.createElement('button');   // eyedropper (Chromium's EyeDropper API)
  drop.className = 'cell plus'; drop.innerHTML = '<span class="icon">colorize</span>'; drop.dataset.tip = 'Pick a color from the screen';
  drop.hidden = !window.EyeDropper;
  drop.onclick = async () => { closeMenu(); try { const { sRGBHex } = await new EyeDropper().open(); rememberColor(sRGBHex); setColor(input, sRGBHex); } catch {} };
  custom.append(plus, drop, ...recentColors().map(cell)); m.append(custom, div('menu-sep'));
  const grid = div('cells std'); PALETTE.forEach(c => grid.append(cell(c))); m.append(grid);
  if (btn.dataset.for === 'fill' && sel.size) {   // fill transparency, as Slides' custom colour: 0 % opaque … 100 % clear
    const fill = [...sel][0].style.getPropertyValue('--fill'), row = div('palette-alpha');
    row.innerHTML = '<span>Transparency</span><input type="range" min="0" max="100" step="1"><span class="pct"></span>';
    const range = row.querySelector('input'), pct = row.querySelector('.pct');
    range.value = String(Math.round((1 - alphaOf(fill)) * 100)); pct.textContent = range.value + '%';
    range.oninput = () => { pct.textContent = range.value + '%'; setVar('--fill', withAlpha(toHex([...sel][0].style.getPropertyValue('--fill'), '#4a86e8'), 1 - +range.value / 100)); };
    range.onchange = commit;
    m.append(div('menu-sep'), row);
  }
  if (btn.dataset.for === 'fill' && sel.size && !cellTargets().length) gradientTabs(m, solidStart, { get: () => gradSpec([...sel][0]), set: setGradient, image: true });
  if (btn.dataset.for === 'color' && sel.size && !editing) gradientTabs(m, solidStart, { get: () => [...sel][0]?.dataset.textGradient || '', set: setTextGradient });   // whole boxes' text
  if (btn.dataset.for === 'bg' && slides[cur]) gradientTabs(m, solidStart, { get: () => specOfCss(slides[cur].dataset.backgroundGradient || ''), set: setBgGradient });
  document.body.append(m);
  const r = btn.getBoundingClientRect();
  m.style.left = Math.min(r.left, innerWidth - m.offsetWidth - 8) + 'px'; m.style.top = r.bottom + 2 + 'px';
  btn.classList.add('open'); openMenuEl = m; openAnchor = btn;
}
/* Fill colour → Solid | Gradient, as Slides: preset gradients (each hue light to dark, linear and radial) and a custom one
   (type, angle, two colours), applied as data-gradient (shapes.js draws it); a solid colour or Transparent removes it. */
const gradSpec = b => b?.dataset.gradient || '';
function setGradient(spec) {
  for (const b of sel) {
    if (spec !== undefined) { delete b.dataset.fillImage; delete b.dataset.fillScale; }   // one fill at a time
    if (spec) { b.dataset.gradient = spec; b.style.setProperty('--fill', spec.match(/#[0-9a-f]{3,8}/i)?.[0] || '#4a86e8'); } else delete b.dataset.gradient;
    gradBox(b);
  }
  drawOverlay();
}
const cssGrad = spec => { const m = spec.split(' '); return m[0] === 'radial' ? `radial-gradient(circle, ${m.slice(1).join(', ')})` : `linear-gradient(${m[1]}deg, ${m.slice(2).join(', ')})`; };
/* The slide background's gradient (data-background-gradient, a CSS value as reveal's): a picture or video takes its place. */
const specOfCss = css => { const m = css.match(/^(linear|radial)-gradient\((?:(\d+)deg, )?(?:circle, )?(#[0-9a-f]{3,8}), (#[0-9a-f]{3,8})\)$/i); return !m ? '' : m[1] === 'radial' ? `radial ${m[3]} ${m[4]}` : `linear ${m[2] || 180} ${m[3]} ${m[4]}`; };
function setBgGradient(spec) {
  const s = slides[cur];
  if (spec) { clearBgMedia(s); s.dataset.backgroundGradient = cssGrad(spec); s.dataset.backgroundColor = spec.match(/#[0-9a-f]{3,8}/i)?.[0] || '#ffffff'; } else delete s.dataset.backgroundGradient;
  paintBg(frame, s); syncBgDialog();
}
function gradientTabs(m, solidStart, target) {
  const solid = [...m.children].slice(solidStart), pane = div('grad-pane'), tabs = div('palette-tabs');
  tabs.innerHTML = '<button data-t="solid">Solid</button><button data-t="gradient">Gradient</button>' + (target.image ? '<button data-t="image">Image</button>' : '');
  const show = t => { tabs.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.t === t)); solid.forEach(e => { /** @type {HTMLElement} */ (e).hidden = t !== 'solid'; }); pane.hidden = t !== 'gradient'; ipane.hidden = t !== 'image'; };
  tabs.onclick = e => { const t = /** @type {HTMLElement} */ (e.target).closest('button'); if (t) show(t.dataset.t); };
  const presets = div('cells'), cur = target.get(), b0 = target.image ? [...sel][0] : null, ipane = div('img-fill');
  ipane.innerHTML = `<button class="outlined pick"><span class="icon">image</span> Choose an image…</button>
    <select class="fs"><option value="fill">Scale to fill</option><option value="fit">Scale to fit</option><option value="stretch">Stretch</option><option value="tile">Tile</option><option value="original">Original size</option></select>
    <button class="outlined rm">Remove image</button><input type="file" accept="image/*" hidden>`;
  const fs = /** @type {HTMLSelectElement} */ (ipane.querySelector('.fs')), file = /** @type {HTMLInputElement} */ (ipane.querySelector('input'));
  fs.value = b0?.dataset.fillScale || 'fill'; /** @type {HTMLElement} */ (ipane.querySelector('.rm')).hidden = !b0?.dataset.fillImage;
  /** @type {HTMLElement} */ (ipane.querySelector('.pick')).onclick = () => file.click();
  file.onchange = async () => { const f = file.files?.[0]; if (!f) return; closeMenu(); setStatus('Uploading image…'); const src = await uploadImage(f); setStatus(''); setFillImage(src, fs.value); commit(); };
  fs.onchange = () => { if (b0?.dataset.fillImage) { setFillImage(b0.dataset.fillImage, fs.value); commit(); } };
  /** @type {HTMLElement} */ (ipane.querySelector('.rm')).onclick = () => { closeMenu(); setFillImage(null); commit(); };
  for (const kind of ['linear', 'radial']) for (let i = 0; i < 10; i++) {
    const spec = kind === 'linear' ? `linear 180 ${PALETTE[20 + i]} ${PALETTE[60 + i]}` : `radial ${PALETTE[20 + i]} ${PALETTE[50 + i]}`, c = document.createElement('button');
    c.className = 'cell' + (spec === cur ? ' on' : ''); c.style.background = cssGrad(spec); c.dataset.tip = kind === 'linear' ? 'Linear' : 'Radial';
    c.onclick = () => { closeMenu(); target.set(spec); commit(); }; presets.append(c);
  }
  const [k0 = 'linear', ...rest] = (cur || `linear 180 ${PALETTE[26]} ${PALETTE[66]}`).split(' '), angle0 = k0 === 'radial' ? '180' : rest[0], [c1, c2] = k0 === 'radial' ? rest : rest.slice(1);
  const custom = div('grad-custom');
  custom.innerHTML = `<select class="gk"><option value="linear">Linear</option><option value="radial">Radial</option></select>
    <label class="ga">Angle<input type="number" min="0" max="359" step="15"> °</label><input type="color" class="g1" title="Start colour"><input type="color" class="g2" title="End colour">`;
  const q = s => /** @type {HTMLInputElement} */ (custom.querySelector(s));
  q('.gk').value = k0; q('.ga input').value = angle0; q('.g1').value = c1 || PALETTE[26]; q('.g2').value = c2 || PALETTE[66];
  const apply = () => { const radial = q('.gk').value === 'radial'; q('.ga').hidden = radial;
    target.set(radial ? `radial ${q('.g1').value} ${q('.g2').value}` : `linear ${(+q('.ga input').value || 0) % 360} ${q('.g1').value} ${q('.g2').value}`); };
  q('.ga').hidden = k0 === 'radial';
  for (const s of ['.gk', '.ga input', '.g1', '.g2']) { q(s).oninput = apply; q(s).onchange = () => { apply(); commit(); }; }
  const head = div('palette-head'), head2 = div('palette-head'); head.textContent = 'PRESETS'; head2.textContent = 'CUSTOM';
  pane.append(head, presets, head2, custom);
  m.prepend(tabs); m.append(pane); if (target.image) m.append(ipane);   // Slides: the tabs on top
  show(b0?.dataset.fillImage ? 'image' : cur ? 'gradient' : 'solid');
}
document.querySelectorAll('.swatch[data-for]').forEach(btn => { btn.onclick = () => openAnchor === btn ? closeMenu() : openPalette(btn); });
$('#ed-hilite').onchange = e => hilite(e.target.value);
$('#ed-fill').oninput = e => { if (fillCells(e.target.value)) return; setGradient(null); setVar('--fill', e.target.value); };   // cells in an edited table: those cells
/* …and an Image tab, as Keynote's Image Fill: a picture with a scale (Scale to fill, Scale to fit, Stretch, Tile, Original size). */
function setFillImage(src, scale) {
  for (const b of sel) {
    if (src) { b.dataset.fillImage = src; delete b.dataset.gradient; } else delete b.dataset.fillImage;
    if (scale && scale !== 'fill' && b.dataset.fillImage) b.dataset.fillScale = scale; else delete b.dataset.fillScale;
    gradBox(b);
  }
  drawOverlay();
}
$('#ed-fill').onchange = commit;
$('#ed-stroke').oninput = e => {
  if (cellBorder('color', e.target.value)) return;   // cells in an edited table: their chosen sides
  setVar('--stroke', e.target.value);
  sel.forEach(b => { if (!parseFloat(b.style.getPropertyValue('--sw'))) { b.style.setProperty('--sw', '2px'); if (b.dataset.shape) renderShape(b); } });
};
$('#ed-stroke').onchange = commit;
function noBorder() { if (cellBorder('width', '0px')) return commit(); sel.forEach(b => { if (!isLine(b)) b.style.setProperty('--sw', '0px'); if (b.dataset.shape) renderShape(b); }); drawOverlay(); commit(); }
const curSw = () => parseFloat([...sel][0]?.style.getPropertyValue('--sw')) || 0;
/* Border dash and line ends, as Slides: pictures of each style, the current one ticked. */
const DASHES = [['', 'Solid'], ['dot', 'Dot'], ['dash', 'Dash'], ['dashdot', 'Dash-dot'], ['longdash', 'Long dash'], ['longdashdot', 'Long dash-dot']];
const ENDS = [['none', 'None'], ['arrow', 'Arrow'], ['fill-arrow', 'Filled arrow'], ['circle', 'Circle'], ['square', 'Square'], ['diamond', 'Diamond'],
  ['open-arrow', 'Open arrow'], ['open-circle', 'Open circle'], ['open-square', 'Open square'], ['open-diamond', 'Open diamond']];
const DASH_PREVIEW = { '': '', dot: '2 4', dash: '8 6', dashdot: '8 4 2 4', longdash: '14 6', longdashdot: '14 4 2 4' };
const endPreview = (v, side) => {   // a short line with the end drawn the way shapes.js draws it
  const b = div('box'); b.dataset.shape = 'line'; b.style.cssText = 'width:44px;height:0;--sw:2px;--stroke:#1f1f1f';
  b.dataset[side] = v; renderShape(b); const svg = b.querySelector('svg');
  svg.setAttribute('viewBox', '-10 -10 64 20'); svg.setAttribute('width', '48'); svg.setAttribute('height', '16'); svg.style.cssText = 'overflow:visible';
  return svg.outerHTML.replace('class="shape"', 'class="end-pic"');
};
const DASH_CSS = { '': 'solid', dot: 'dotted', dash: 'dashed', dashdot: 'dashed', longdash: 'dashed', longdashdot: 'dashed' };
const setData = (k, v) => { if (k === 'dash' && cellBorder('style', DASH_CSS[v] || 'solid')) return commit(); for (const b of sel) { if (v) b.dataset[k] = v; else delete b.dataset[k]; if (b.dataset.shape) renderShape(b); } commit(); };
menuButton($('#ed-dash'), () => DASHES.map(([v, label]) => ({ label, on: () => ([...sel][0]?.dataset.dash || '') === v, run: () => setData('dash', v),
  svg: `<svg width="64" height="8"><line x1="2" y1="4" x2="62" y2="4" stroke="#1f1f1f" stroke-width="2" stroke-dasharray="${DASH_PREVIEW[v]}"/></svg>` })));
const lineEnd = side => () => ENDS.map(([v, label]) => ({ label, svg: endPreview(v, side), run: () => setData(side, v === 'none' && side === 'start' ? '' : v),
  on: () => { const b = [...sel][0]; return (b?.dataset[side] || (side === 'end' && b?.dataset.shape === 'arrowline' ? 'fill-arrow' : 'none')) === v; } }));
menuButton($('#ed-lstart'), lineEnd('start'));
menuButton($('#ed-lend'), lineEnd('end'));
menuButton($('#ed-sw'), () => [1, 2, 3, 4, 8, 12, 16, 24].map(v => ({ label: v + 'px', narrow: true, on: () => curSw() === v, run: () => { if (!cellBorder('width', v + 'px')) setVar('--sw', v + 'px'); commit(); } })));   // Slides' weights; cells: their chosen sides

const FONTS = [['', 'Default'], ['Arial, Helvetica, sans-serif', 'Arial'], ["'Helvetica Neue', Helvetica, Arial, sans-serif", 'Helvetica'],
  ['Verdana, Geneva, sans-serif', 'Verdana'], ["'Trebuchet MS', sans-serif", 'Trebuchet MS'], ['Georgia, serif', 'Georgia'],
  ["'Times New Roman', Times, serif", 'Times New Roman'], ["Palatino, 'Palatino Linotype', serif", 'Palatino'],
  ["'Courier New', Courier, monospace", 'Courier New'], ["Menlo, 'SF Mono', Consolas, monospace", 'Menlo']];
const recentFonts = () => { try { return JSON.parse(localStorage.getItem('slides-recent-fonts')) || []; } catch { return []; } };
const setFont = v => {   // on a whole box it is the box's font: the runs' own fonts (an imported deck has them) give way
  styleText('fontName', v || 'inherit', c => { c.style.fontFamily = v; c.querySelectorAll('[style]').forEach(e => e.style.removeProperty('font-family')); });
  try { localStorage.setItem('slides-recent-fonts', JSON.stringify([v, ...recentFonts().filter(x => x !== v)].slice(0, 5))); } catch {}
};
const curFont = () => {
  const b = [...sel][0], own = b ? content(b).style.fontFamily : '', runs = b && shownStyle(b, 'fontFamily', true);
  if (runs === '') return ['', ''];   // mixed fonts: blank, as Slides
  const css = runs || own, fam = famOf(css);
  return FONTS.find(([v]) => v && fam && v.replace(/['"]/g, '').startsWith(fam)) || (fam ? [css, fam] : FONTS[0]);
};
/* What the size and font boxes show, as Slides: the text at the caret (or the selection's start) while editing, otherwise
   the box's text when it is all one size or font, and nothing when it is mixed. `own` asks only for styles the text sets
   itself (inline), so a box that just inherits the theme's font still shows Default. */
function textAt(b) {
  const s = getSelection();
  if (editing !== b || !s.rangeCount || !content(b).contains(s.anchorNode)) return null;
  const n = s.getRangeAt(0).startContainer; return n.nodeType === 1 ? n : n.parentElement;
}
function textLeaves(b) {
  const c = content(b), w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT), out = new Set();
  while (w.nextNode()) if (w.currentNode.textContent.trim()) out.add(w.currentNode.parentElement);
  return out.size ? [...out] : [c];
}
function shownStyle(b, prop, own = false) {
  const set = e => { for (let x = e; x; x = x === content(b) ? null : x.parentElement) if (x.style[prop]) return true; return false; };
  const at = textAt(b), leaves = at ? [at] : textLeaves(b);
  if (own && !leaves.some(set)) return null;   // nothing set on the text itself: the box's (or theme's) own value stands
  const vals = new Set(leaves.map(e => getComputedStyle(e)[prop]));
  return vals.size === 1 ? [...vals][0] : '';
}
function showTextStyle(b) {
  const fs = shownStyle(b, 'fontSize');
  $('#ed-size').value = fs ? String(Math.round(parseFloat(fs) / PT * 2) / 2) : '';   // in points, as Slides
  $('#ed-font .font-name').textContent = curFont()[1];
}
document.addEventListener('selectionchange', () => { if (editing && sel.has(editing)) showTextStyle(editing); });
/* The font menu, as Slides: every Google Fonts family (fetched by the server, snapshot offline) in one searchable,
   virtualised list with Used in this deck / Recent / All sections and a category filter. Each row is drawn in its own
   face from a name-only subset as it scrolls into view. Picking a Google family adds it to the deck's
   <link id="deck-fonts">, so the viewer loads it too. */
let gfonts = null;   // name → [name, category, styles, popularity, weight?]
const GENERIC = { sans: 'sans-serif', serif: 'serif', mono: 'monospace', display: 'sans-serif', handwriting: 'cursive' };
const fontsReady = () => gfonts ? Promise.resolve(gfonts) : fetch('/api/fonts').then(r => r.json()).catch(() => fetch('/editor/data/fonts.json').then(r => r.json()))
  .then(rows => (gfonts = new Map(rows.map(r => [r[0], r]))));
const famOf = css => (css || '').split(',')[0].replace(/['"]/g, '').trim();
const fontCSS = name => { const g = gfonts?.get(name); return g ? `'${name}', ${GENERIC[g[1]]}` : FONTS.find(f => f[1] === name)?.[0] || ''; };
function gfontSpec(name) {   // css2's family=… for the faces the family has
  const [, , bits, , w] = gfonts.get(name), fam = name.replace(/ /g, '+');
  if (!(bits & 1)) return `family=${fam}:wght@${w}`;
  const faces = [[0, 400, 1], [0, 700, 2], [1, 400, 4], [1, 700, 8]].filter(f => bits & f[2]);
  return faces.length === 1 ? `family=${fam}` : `family=${fam}:ital,wght@${faces.map(f => f[0] + ',' + f[1]).join(';')}`;
}
const deckFontLink = doc => doc.querySelector('link#deck-fonts');
const deckGFonts = () => [...(deckFontLink(deckDoc || document)?.getAttribute('href') || '').matchAll(/family=([^:&]+)/g)].map(m => decodeURIComponent(m[1].replace(/\+/g, ' ')));
function syncEditorFonts() {   // the editor page loads the deck's fonts the same way the deck does
  const href = deckFontLink(deckDoc)?.getAttribute('href') || '';
  let l = $('#ed-deck-fonts'); if (!l) { l = Object.assign(document.createElement('link'), { id: 'ed-deck-fonts', rel: 'stylesheet' }); document.head.append(l); }
  if (l.getAttribute('href') !== href) href ? l.setAttribute('href', href) : l.removeAttribute('href');
}
function useGFont(name) {
  if (!gfonts?.has(name) || deckGFonts().includes(name)) return;
  const names = [...deckGFonts(), name];
  let l = deckFontLink(deckDoc);
  if (!l) { l = deckDoc.createElement('link'); l.id = 'deck-fonts'; l.rel = 'stylesheet'; (deckDoc.querySelector('#deck-base') || deckDoc.head.lastChild).before(l); }
  l.setAttribute('href', 'https://fonts.googleapis.com/css2?' + names.filter(n => gfonts.has(n)).map(gfontSpec).join('&') + '&display=swap');
  syncEditorFonts(); scheduleSave();
}
const previewed = new Set();
function previewFont(name) {   // just the glyphs of its own name: a few KB
  if (!gfonts?.has(name) || previewed.has(name)) return;
  previewed.add(name);
  document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, '+')}&text=${encodeURIComponent(name)}&display=swap` }));
}
const usedFonts = () => [...new Set(slides.flatMap(s => [...s.querySelectorAll('.content, .content [style*="font-family"], font[face]')].map(e => famOf(e.style?.fontFamily || e.getAttribute('face')))))].filter(Boolean);
const FONT_CATS = [['', 'All'], ['sans', 'Sans serif'], ['serif', 'Serif'], ['mono', 'Monospace'], ['display', 'Display'], ['handwriting', 'Handwriting'], ['yours', 'Your fonts']];
/* Your fonts: files installed on this computer (listed by the server) and fonts already in the deck. Using one copies the
   file into assets/fonts/ and declares it with an @font-face in #deck-theme, so the deck carries it. */
let localFonts = null;
const deckFaces = () => [...(deckDoc?.querySelector('#deck-theme')?.textContent || '').matchAll(/@font-face\s*{[^}]*font-family:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
function addFontFace(family, src) {
  if (deckFaces().includes(family)) return;
  const el = deckDoc.querySelector('#deck-theme') || deckDoc.head.appendChild(Object.assign(deckDoc.createElement('style'), { id: 'deck-theme' }));
  el.textContent = el.textContent.replace(/\s*$/, '') + `\n@font-face { font-family: '${family}'; src: url('${src}'); font-display: swap; }\n`;
  $('#ed-deck-theme-live').textContent = el.textContent; scheduleSave();
}
async function useFontFile(q) {   // q: path=… (installed) or name=… with the bytes as body
  const j = await (await fetch('/api/font?' + q.query, { method: 'POST', body: q.body || '' })).json();
  if (j.error) { setStatus(j.error, 'error'); return null; }
  addFontFace(j.family, j.src); return j.family;
}
const previewedLocal = new Set();
function previewLocal(f) {
  if (previewedLocal.has(f.path)) return; previewedLocal.add(f.path);
  new FontFace(f.name, `url(/api/localfont?path=${encodeURIComponent(f.path)})`).load().then(ff => document.fonts.add(ff)).catch(() => {});
}
let fontCat = '';
async function openFontMenu(btn) {
  closeMenu(); fontCat = '';   // each opening starts on All
  const m = div('menu font-menu'); m.addEventListener('mousedown', e => { if (e.target.tagName !== 'INPUT') e.preventDefault(); });
  const q = Object.assign(document.createElement('input'), { type: 'search', placeholder: 'Search fonts', className: 'font-search' });
  const cats = div('font-cats'), list = div('font-list'), pad = div('font-pad');
  list.append(pad); m.append(q, cats, list);
  placeMenu(m, btn.getBoundingClientRect().left, btn.getBoundingClientRect().bottom + 2);
  btn.classList.add('open'); openMenuEl = m; openAnchor = btn;
  await fontsReady();
  if (openMenuEl !== m) return;
  const ROW = 32, cur = famOf(curFont()[0]) || curFont()[1];
  const sys = FONTS.filter(f => f[0]).map(f => [f[1], 'system']);
  const all = [...sys, ...gfonts.values()].sort((a, b) => a[0].localeCompare(b[0]));
  let rows = [];
  const build = () => {
    const t = q.value.trim().toLowerCase(), keep = r => (!fontCat || r[1] === fontCat) && (!t || r[0].toLowerCase().includes(t));
    const byName = n => all.find(r => r[0] === n), sec = (head, names) => { const rs = names.map(byName).filter(Boolean).filter(keep); return rs.length ? [{ head }, ...rs] : []; };
    if (fontCat === 'yours') {
      const ins = deckFaces().map(n => ({ face: n })), mine = (localFonts || []).map(f => ({ local: f }));
      const has = r => !t || (r.face || r.local.name).toLowerCase().includes(t);
      rows = [...(ins.length ? [{ head: 'IN THIS DECK' }, ...ins.filter(has)] : []), { head: 'ON THIS COMPUTER' }, ...mine.filter(has)];
    } else rows = t || fontCat ? all.filter(keep) : [{ name: 'Default' }, ...sec('USED IN THIS DECK', usedFonts()), ...sec('RECENT', recentFonts().map(famOf)), { head: 'ALL FONTS' }, ...all];
    pad.style.height = rows.length * ROW + 'px'; list.scrollTop = 0; paint();
  };
  const paint = () => {
    const from = Math.max(0, Math.floor(list.scrollTop / ROW) - 4), to = Math.min(rows.length, from + Math.ceil(list.clientHeight / ROW) + 8);
    pad.replaceChildren(...rows.slice(from, to).map((r, k) => {
      const top = `top:${(from + k) * ROW}px`;
      if (r.head) { const h = div('menu-head'); h.textContent = r.head; h.style.cssText = top; return h; }
      const name = r.name || r.face || r.local?.name || r[0], row = document.createElement('button'); row.className = 'menu-item';
      row.innerHTML = '<span class="menu-icon icon"></span><span class="menu-label"></span>'; row.style.cssText = top;
      row.children[0].textContent = name === cur ? 'check' : ''; row.children[1].textContent = name;
      if (r.local) previewLocal(r.local);
      if (r.face || r.local) row.children[1].style.fontFamily = `'${name}'`;
      else if (!r.name) { previewFont(name); row.children[1].style.fontFamily = fontCSS(name); }
      row.onclick = async () => {
        closeMenu();
        if (r.name) return setFont('');
        if (r.face) return setFont(`'${name}', sans-serif`);
        if (r.local) { const fam = await useFontFile({ query: 'path=' + encodeURIComponent(r.local.path) }); if (fam) setFont(`'${fam}', sans-serif`); return; }
        if (gfonts.has(name)) useGFont(name); setFont(fontCSS(name));
      };
      return row;
    }));
  };
  for (const [v, label] of FONT_CATS) {
    const c = document.createElement('button'); c.className = 'font-cat' + (v === fontCat ? ' on' : ''); c.textContent = label;
    c.onclick = async () => {
      fontCat = v; cats.querySelectorAll('.font-cat').forEach(x => x.classList.toggle('on', x === c));
      if (v === 'yours' && !localFonts) localFonts = await fetch('/api/localfonts').then(r => r.json()).catch(() => []);
      build();
    };
    cats.append(c);
  }
  q.oninput = build; list.onscroll = paint;
  build(); q.focus();
}
$('#ed-font').onclick = () => openAnchor === $('#ed-font') ? closeMenu() : openFontMenu($('#ed-font'));
$('#ed-color').oninput = e => { if (!editing) setTextGradient(null); styleText('foreColor', e.target.value, c => { c.style.color = e.target.value; }); };
/* Text colour → Gradient (Keynote's gradient text fill): the whole text of the selected boxes, as data-text-gradient. */
function setTextGradient(spec) { for (const b of sel) { if (spec) b.dataset.textGradient = spec; else delete b.dataset.textGradient; gradBox(b); } drawOverlay(); }
function setSize(v) {   // the selected characters while editing; otherwise whole boxes, the runs' own sizes giving way
  const s = editing && editSelection();
  if (s && s.rangeCount && !s.isCollapsed) { spanStyle('font-size', v + 'px'); showTextStyle(editing); return; }
  sel.forEach(b => { const c = content(b); c.style.fontSize = v + 'px'; c.querySelectorAll('[style]').forEach(e => e.style.removeProperty('font-size')); fitHeight(b); });
  commit();
}
/* Slides' points on a 10-inch slide map to our 1920px canvas at 2.667px per point (18pt = 48px). */
const PT = 192 / 72;   // 1 pt in canvas px: the 1920px slide is 10 in, as in Slides (OOXML: 12700 EMU)
$('#ed-size').onclick = () => { if (openAnchor !== $('#ed-size')) openMenu($('#ed-size'), PT_SIZES.map(v => ({ label: String(v), on: () => +$('#ed-size').value === v, run: () => setSize(Math.round(v * PT * 100) / 100) }))); };
$('#ed-size').onchange = e => { const v = parseFloat(e.target.value); if (v > 0) setSize(Math.round(v * PT * 100) / 100); };
/* Google Slides' size steps (8 9 10 11 12 14 18 24 30 36 48 60 72 96 pt), scaled ×2.5 for the 1920 canvas. */
const PT_SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96];   // Slides' size list, in points
const SIZES = PT_SIZES.map(v => Math.round(v * PT * 100) / 100);
function stepSize(dir) {   // as Slides: each size in the text moves one step, so mixed sizes keep their difference
  const b = [...sel][0]; if (!b) return;
  const step = cur => dir > 0 ? SIZES.find(v => v > cur + 0.01) : [...SIZES].reverse().find(v => v < cur - 0.01);
  const s = editing && editSelection();
  if (s && s.rangeCount && !s.isCollapsed) { const next = step(parseFloat(shownStyle(b, 'fontSize') || getComputedStyle(content(b)).fontSize)); if (next) setSize(next); return; }
  for (const x of sel) {
    const c = content(x), sized = [c, ...[...c.querySelectorAll('[style]')].filter(e => e.style.fontSize)].map(e => [e, parseFloat(getComputedStyle(e).fontSize)]);
    for (const [e, cur] of sized) { const next = step(cur); if (next) e.style.fontSize = next + 'px'; }   // measured first, then changed
    fitHeight(x);
  }
  commit();
}
const curLh = () => [...sel][0] ? content([...sel][0]).style.lineHeight || '1.3' : '';
menuButton($('#ed-lh'), () => lhItems());
const strike = () => styleText('strikeThrough', null, c => { c.style.textDecoration = c.style.textDecoration === 'line-through' ? '' : 'line-through'; });
const superscript = () => styleText('superscript', null, c => { c.style.verticalAlign = c.style.verticalAlign === 'super' ? '' : 'super'; });
const subscript = () => styleText('subscript', null, c => { c.style.verticalAlign = c.style.verticalAlign === 'sub' ? '' : 'sub'; });
$('#ed-link').onclick = linkText;
$('#ed-clear-fmt').onclick = clearFormat;
canvas.addEventListener('click', e => { if (e.target.closest('a')) e.preventDefault(); });   // links open only in the viewer
$('#ed-indent-less').onclick = () => indentText(-1);
$('#ed-indent-more').onclick = () => indentText(1);
$('#ed-ul').onclick = () => listText('insertUnorderedList');
$('#ed-ol').onclick = () => listText('insertOrderedList');
$('#ed-size-up').onclick = () => stepSize(1);
$('#ed-size-down').onclick = () => stepSize(-1);
$('#ed-bold').onclick = () => styleText('bold', null, c => { c.style.fontWeight = c.style.fontWeight === 'bold' ? '' : 'bold'; });
$('#ed-italic').onclick = () => styleText('italic', null, c => { c.style.fontStyle = c.style.fontStyle === 'italic' ? '' : 'italic'; });
$('#ed-underline').onclick = () => styleText('underline', null, c => { c.style.textDecoration = c.style.textDecoration === 'underline' ? '' : 'underline'; });
/* Align, as Slides' toolbar popover: four horizontal, three vertical. Shortcuts ⇧⌘L/E/R/J. */
const ALIGNS = [['left', 'format_align_left', 'Left align', '⇧⌘L'], ['center', 'format_align_center', 'Center align', '⇧⌘E'],
  ['right', 'format_align_right', 'Right align', '⇧⌘R'], ['justify', 'format_align_justify', 'Justify', '⇧⌘J']];
const VALIGNS = [['top', 'vertical_align_top', 'Top'], ['middle', 'vertical_align_center', 'Middle'], ['bottom', 'vertical_align_bottom', 'Bottom']];
const curAlign = () => { const b = [...sel][0]; const a = b ? getComputedStyle(content(b)).textAlign : 'left'; return a === 'start' ? 'left' : a === 'end' ? 'right' : a; };
const curValign = () => [...sel][0]?.dataset.valign || 'middle';
function setAlign(a) { sel.forEach(b => { content(b).style.textAlign = a; }); commit(); }
function setValign(v) { sel.forEach(b => { if (v === 'middle') delete b.dataset.valign; else b.dataset.valign = v; }); commit(); }
function openAlign(btn) {
  closeMenu();
  const m = div('menu align-pop');
  const row = (list, on, set) => {
    const r = div('align-row');
    for (const [v, icon, label, key] of list) {
      const e = document.createElement('button');
      e.className = 'align-btn' + (on() === v ? ' on' : ''); e.dataset.v = v; e.dataset.tip = key ? `${label} (${key})` : label;
      e.innerHTML = `<span class="icon">${icon}</span>`;
      e.onclick = () => { closeMenu(); set(v); };
      r.append(e);
    }
    return r;
  };
  m.addEventListener('mousedown', e => e.preventDefault());
  m.append(row(ALIGNS, curAlign, setAlign), div('menu-sep'), row(VALIGNS, curValign, setValign));
  const r = btn.getBoundingClientRect(); placeMenu(m, r.left, r.bottom + 2);
  btn.classList.add('open'); openMenuEl = m; openAnchor = btn;
}
$('#ed-align').onclick = () => openAnchor === $('#ed-align') ? closeMenu() : openAlign($('#ed-align'));

/* Text columns (1–3) on the whole box, via CSS columns. */
const curCols = () => +([...sel][0] && content([...sel][0]).style.columnCount) || 1;
function setColumns(n) {
  sel.forEach(b => { if (isMedia(b) || isLine(b)) return; const c = content(b).style; c.columnCount = n > 1 ? n : ''; c.columnGap = n > 1 ? '48px' : ''; fitHeight(b); });
  commit();
}
const RESIZE_KEYS = { KeyB: [20, 0], KeyI: [0, 20], KeyK: [20, 20], KeyW: [-20, 0], KeyJ: [-20, -20] };   // Slides' Mac keys (⌃⌘…)
function stepForward() {   // each selected box swaps with the next unselected box above it
  for (const b of boxes().filter(b => sel.has(b)).reverse()) { let n = b.nextElementSibling; while (n && !n.classList.contains('box')) n = n.nextElementSibling; if (n && !sel.has(n)) n.after(b); }
  commit();
}
function stepBackward() {
  for (const b of boxes().filter(b => sel.has(b))) { let n = b.previousElementSibling; while (n && !n.classList.contains('box')) n = n.previousElementSibling; if (n && !sel.has(n)) n.before(b); }
  commit();
}
function centerOnPage(axis) {
  if (anyLocked()) return;
  const g = bbox([...sel].map(aabb)), dx = axis === 'h' ? W / 2 - (g.x + g.w / 2) : 0, dy = axis === 'v' ? H / 2 - (g.y + g.h / 2) : 0;
  sel.forEach(b => { const o = geo(b); setGeo(b, { ...o, x: o.x + dx, y: o.y + dy }); }); drawOverlay(); commit();
}
