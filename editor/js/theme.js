/* Themes, as Slides' Themes panel: a deck font, title / body sizes and colours, and a background, kept as CSS variables in a
   marked block of <style id="deck-theme"> (the rest of that style stays the author's). Text without its own font / colour /
   size inherits them; layout placeholders size from them; slides still on the old theme background get the new one. */
const THEMES = window.THEMES;   // editor/themes.js, shared with the home screen's template gallery
const THEME_RE = /\/\* slides-theme (\{.*?\}) \*\/[\s\S]*?\/\* end slides-theme \*\/\n?/;
function theme() {
  const m = (deckDoc?.querySelector('#deck-theme')?.textContent || '').match(THEME_RE);
  let t;
  try { t = m ? { ...THEMES[0], ...JSON.parse(m[1]) } : { ...THEMES[0], implicit: true }; } catch { t = { ...THEMES[0], implicit: true }; }
  // a size that didn't measure (saved as null by an older Edit theme) falls back to Simple Light's, so placeholders never collapse
  for (const k of ['titleSize', 'bodySize']) if (!(t[k] > 0)) t[k] = THEMES[0][k];
  if (t.layouts) t.layouts = Object.fromEntries(Object.entries(t.layouts).filter(([, bs]) => bs.every(b => b[5] > 0)));
  return t;
}
const themeCSS = t => `/* slides-theme ${JSON.stringify({ name: t.name, font: t.font, titleSize: t.titleSize, bodySize: t.bodySize, title: t.title, text: t.text, bg: t.bg, ...(t.layouts ? { layouts: t.layouts } : {}) })} */
.slides { --th-title-size: ${Math.round(t.titleSize * PT * 100) / 100}px; --th-body-size: ${Math.round(t.bodySize * PT * 100) / 100}px; }
.box > .content { font-family: ${t.font}; color: ${t.text}; }
.box[data-role="title"] > .content { color: ${t.title}; }
/* end slides-theme */
`;
function setTheme(t) {
  const old = theme(), el = deckDoc.querySelector('#deck-theme') || deckDoc.head.appendChild(Object.assign(deckDoc.createElement('style'), { id: 'deck-theme' }));
  const css = el.textContent.replace(THEME_RE, '');
  el.textContent = themeCSS(t) + css.replace(/^\n+/, '\n');
  $('#ed-deck-theme-live').textContent = el.textContent;
  for (const sl of slides) if (!sl.dataset.backgroundColor || sl.dataset.backgroundColor.toLowerCase() === old.bg.toLowerCase()) sl.dataset.backgroundColor = t.bg;
  render(); commit(); scheduleSave(); updateThemePanel();
}
function setThemePanel(open) { $('#ed-theme').hidden = !open; if (open) { $('#ed-objects').hidden = true; fmt.hidden = true; $('#ed-trans').hidden = true; $('#ed-comments').hidden = true; updateThemePanel(); } fit(); }
function updateThemePanel() {
  if ($('#ed-theme').hidden) return;
  const t = theme();
  $('#ed-theme-list').replaceChildren(...THEMES.map(p => {
    const c = div('theme-card' + (p.name === t.name && !t.implicit || (t.implicit && p === THEMES[0]) ? ' on' : ''));
    c.innerHTML = `<div class="theme-pic" style="background:${p.bg};font-family:${p.font.replace(/"/g, "'")}"><b style="color:${p.title}">Click to add title</b><small style="color:${p.text}">Click to add subtitle</small></div><span></span>`;
    c.lastChild.textContent = p.name; c.onclick = () => setTheme({ ...p }); return c;
  }));
  F2('font').replaceChildren(...FONTS.filter(f => f[0]).map(([v, l]) => Object.assign(document.createElement('option'), { value: v, textContent: l })));
  F2('font').value = t.font; F2('title-size').value = t.titleSize; F2('body-size').value = t.bodySize; F2('title').value = t.title; F2('text').value = t.text; F2('bg').value = t.bg;
}
const F2 = id => $('#ed-th-' + id);
for (const [id, key, num] of [['font', 'font'], ['title-size', 'titleSize', 1], ['body-size', 'bodySize', 1], ['title', 'title'], ['text', 'text'], ['bg', 'bg']])
  F2(id).onchange = () => setTheme({ ...theme(), name: 'Custom', [key]: num ? Math.max(4, +F2(id).value || 0) : F2(id).value });
$('#ed-theme-btn').onclick = () => setThemePanel($('#ed-theme').hidden);
$('#ed-layout-btn').onclick = () => openAnchor === $('#ed-layout-btn') ? closeMenu() : openMenu($('#ed-layout-btn'), layoutItems);   // the layout grid, as Slides' toolbar
$('#ed-theme-close').onclick = () => setThemePanel(false);

/* Slide → Edit theme, as Slides' theme builder: the filmstrip becomes the theme (master) and its layouts, each an editable
   slide of placeholders. Move, resize and style them with the usual tools; on leaving, the layouts' geometry and sizes and the
   master's title / body size and colour are written to the theme. Reapply to all re-lays the deck's slides of that layout. */
let themeStash = null, reapply = new Set();
const SAMPLE = { title: 'Click to edit theme title style', sub: 'Click to edit theme subtitle style', body: 'Click to edit theme text style' };
function enterThemeEdit() {
  if (themeStash) return;
  stopEdit(); closeMenu(); setGrid(false);
  const t = theme(), keep = slides[cur]?.dataset.layout;
  themeStash = { slides, cur }; reapply = new Set();
  const master = blankSlide(); master.dataset.edTheme = 'master'; master.dataset.backgroundColor = t.bg;
  for (const [role, y, h] of [['title', 93, 122], ['body', 242, 721]]) {
    const b = makeBox({ x: 65, y, w: 1790, h, html: role === 'title' ? SAMPLE.title : '<ul><li>First level</li><li>Second level</li></ul>' });
    b.dataset.role = String(role); b.dataset.valign = 'top'; content(b).style.fontSize = Math.round((role === 'title' ? t.titleSize : t.bodySize) * PT * 100) / 100 + 'px';
    if (role === 'title') content(b).style.color = t.title; master.append(b);
  }
  const lays = allLayouts().filter(l => l[0] !== 'blank' || tplLayouts().some(x => x.dataset.layout === 'blank')).map(l => {
    const s = bareLayout(blankSlide(l[0])); s.dataset.edTheme = String(l[0]); s.dataset.edName = String(l[1]);
    boxes(s).forEach(b => { content(b).textContent = SAMPLE[b.dataset.role] || SAMPLE.body; delete b.dataset.placeholder; });
    const L = tplLayouts().find(x => x.dataset.layout === l[0]);   // its own objects and background (the template's)
    if (L) { for (const o of [...L.children].filter(o => o.classList.contains('box') && !(/** @type {HTMLElement} */ (o)).dataset.placeholder)) s.append(o.cloneNode(true)); if (L.dataset.backgroundColor) s.dataset.backgroundColor = L.dataset.backgroundColor; }
    return s;
  });
  slides = [master, ...lays]; cur = Math.max(0, slides.findIndex(s => s.dataset.edTheme === keep));
  document.body.classList.add('theme-mode'); $('#ed-theme-bar').hidden = false; sel.clear(); render(); fit();
}
function exitThemeEdit() {
  if (!themeStash) return;
  stopEdit();
  // font sizes are measured, and only the shown slide is in the page: measure the others from a hidden copy on the canvas
  const shown = s => { if (s.isConnected) return s; const c = s.cloneNode(true); c.classList.add('measure'); c.style.visibility = 'hidden'; canvas.append(c); return c; };
  const t = theme(), px = b => parseFloat(getComputedStyle(content(b)).fontSize), r1 = v => Math.round(v * 10) / 10, layouts = { ...(t.layouts || {}) };
  const master = shown(slides.find(s => s.dataset.edTheme === 'master')), mt = boxes(master).find(b => b.dataset.role === 'title'), mb = boxes(master).find(b => b.dataset.role === 'body');
  const next = { ...t, titleSize: mt ? r1(px(mt) / PT) : t.titleSize, bodySize: mb ? r1(px(mb) / PT) : t.bodySize, title: mt ? toHex(getComputedStyle(content(mt)).color, t.title) : t.title };
  for (const s of slides.filter(s => s.dataset.edTheme && s.dataset.edTheme !== 'master').map(shown)) {
    layouts[s.dataset.edTheme] = boxes(s).filter(b => b.dataset.role).map(b => { const g = geo(b), c = content(b), [ts, bs] = [next.titleSize, next.bodySize];

      // sizes are kept relative to the master's title / body sizes, so a later theme size change still scales them
      const pt = px(b) / PT, rel = b.dataset.role === 'title' ? pt / ts * 28 : pt / bs * 18;
      return [b.dataset.role, Math.round(g.x), Math.round(g.y), Math.round(g.w), Math.round(g.h), r1(rel), b.dataset.valign || 'middle', c.style.textAlign || 'left']; });
  }
  canvas.querySelectorAll(':scope > section.measure').forEach(c => c.remove());
  writeLayouts(slides.filter(s => s.dataset.edTheme && s.dataset.edTheme !== 'master'), t);
  slides = themeStash.slides; cur = themeStash.cur; themeStash = null; editorLayouts();

  document.body.classList.remove('theme-mode'); $('#ed-theme-bar').hidden = true;
  next.layouts = layouts; next.name = t.name === 'Custom' || t.implicit ? 'Custom' : t.name;
  setTheme(next);
  for (const name of reapply) slides.filter(s => s.dataset.layout === name).forEach(s => applyLayout(s, name));
  if (reapply.size) { render(); commit(); }
  fit();
}
function updateThemeBar() {
  if (!themeStash) return;
  const s = slides[cur], name = s?.dataset.edTheme, lay = LAYOUTS.find(l => l[0] === name), used = themeStash.slides.filter(x => x.dataset.layout === name).length;
  $('#ed-theme-what').innerHTML = `Editing: <b></b> <span class="muted"></span>`;
  $('#ed-theme-what b').textContent = `${theme().name} - ${name === 'master' ? 'Theme' : s?.dataset.edName || lay?.[1] || ''}`;
  const own = !!name && name !== 'master' && !LAYOUTS.some(l => l[0] === name);   // the deck's own layouts: renamed and deleted here
  $('#ed-lay-all').hidden = name === 'master'; $('#ed-lay-dup').hidden = name === 'master'; $('#ed-lay-ren').hidden = $('#ed-lay-del').hidden = !own;
  $('#ed-theme-what span').textContent = name === 'master' ? '' : `(Used by ${used} slide${used === 1 ? '' : 's'})`;
  $('#ed-theme-reapply').hidden = name === 'master';
}
$('#ed-theme-done').onclick = exitThemeEdit;
$('#ed-theme-reapply').onclick = () => { const n = slides[cur]?.dataset.edTheme; if (n) { reapply.add(n); setStatus('Will reapply this layout to its slides on closing'); } };

/* Layouts, as Slides' Simple Light theme: placeholder text boxes (data-placeholder, grey "Click to add title" while empty,
   kept when left empty, hidden in decks until filled) at the theme's positions on the 1920×1080 canvas. */
const PH = { title: 'Click to add title', sub: 'Click to add subtitle', body: 'Click to add text' };
const LAYOUTS = [
  ['title', 'Title slide', [['title', 65, 152, 1790, 431, 52, 'bottom', 'center'], ['sub', 65, 590, 1790, 166, 28, 'top', 'center']]],
  ['section', 'Section header', [['title', 65, 452, 1790, 172, 36, 'middle', 'center']]],
  ['title-body', 'Title and body', [['title', 65, 93, 1790, 122, 28, 'top', 'left'], ['body', 65, 242, 1790, 721, 18, 'top', 'left']]],
  ['two-columns', 'Title and two columns', [['title', 65, 93, 1790, 122, 28, 'top', 'left'], ['body', 65, 242, 841, 721, 18, 'top', 'left'], ['body', 1013, 242, 841, 721, 18, 'top', 'left']]],
  ['title-only', 'Title only', [['title', 65, 93, 1790, 122, 28, 'top', 'left']]],
  ['one-column', 'One column text', [['title', 65, 117, 600, 160, 24, 'bottom', 'left'], ['body', 65, 292, 600, 590, 18, 'top', 'left']]],
  ['main-point', 'Main point', [['title', 65, 169, 1545, 742, 48, 'middle', 'left']]],
  ['section-description', 'Section title and description', [['title', 108, 259, 812, 311, 42, 'bottom', 'left'], ['sub', 108, 589, 812, 259, 21, 'top', 'left'], ['body', 1037, 152, 815, 776, 18, 'middle', 'left']]],
  ['caption', 'Caption', [['body', 65, 888, 1260, 127, 14, 'middle', 'left']]],
  ['big-number', 'Big number', [['title', 65, 232, 1790, 413, 120, 'bottom', 'center'], ['body', 65, 662, 1790, 273, 18, 'top', 'center']]],
  ['blank', 'Blank', []],
];
/* Layouts with their own objects and background (D5): <template id="deck-layouts"> in the deck (shapes.js applyLayouts
   draws them); the deck's own layouts beyond Slides' eleven live there too. The editor puts the objects on its slides
   (not selectable, dropped when saving) and edits them in Slide → Edit theme. */
const layoutTpl = () => /** @type {HTMLTemplateElement | null} */ (deckDoc?.getElementById('deck-layouts'));
const tplLayouts = () => /** @type {HTMLElement[]} */ ([...(layoutTpl()?.content.children || [])].filter(l => l.classList.contains('layout')));
/** @returns {any[]} */
const allLayouts = () => [...LAYOUTS, ...tplLayouts().filter(l => !LAYOUTS.some(x => x[0] === l.dataset.layout)).map(l => [l.dataset.layout, l.dataset.name || l.dataset.layout, []])];
const layoutName = name => allLayouts().find(l => l[0] === name)?.[1] || name;
function editorLayouts(list = slides) {
  const tpl = layoutTpl(), bg = (theme().bg || '').toLowerCase(), withBg = new Set(tplLayouts().filter(l => l.dataset.backgroundColor || l.dataset.backgroundImage).map(l => l.dataset.layout));
  for (const s of list) if (withBg.has(s.dataset.layout) && !('bgFromLayout' in s.dataset) && (s.dataset.backgroundColor || '').toLowerCase() === bg && !s.dataset.backgroundImage) delete s.dataset.backgroundColor;   // only the theme's: the layout's shows
  window.applyLayouts?.(list.filter(s => !s.dataset.edTheme), tpl);
}
const bareLayout = s => { window.applyLayouts?.([s], null); return s; };   // a layout editor slide: none of the layouts' copies on it
function applyLayout(s, name) {
  const lay = allLayouts().find(l => l[0] === name); if (!lay) return;
  const boxesOf = theme().layouts?.[name] || lay[2];   // edited in Slide → Edit theme, else Simple Light's
  const old = boxes(s).filter(b => b.dataset.placeholder), kept = { title: [], sub: [], body: [] };
  old.forEach(b => { const r = b.dataset.role || 'body'; if (content(b).textContent.trim()) kept[r].push(content(b).innerHTML); b.remove(); });
  for (const [role, x, y, w, h, pt, va, ta] of boxesOf) {
    const b = makeBox({ x, y, w, h, html: kept[role].shift() || '' });
    b.dataset.placeholder = PH[role]; b.dataset.role = String(role); if (va !== 'middle') b.dataset.valign = va;
    // sizes follow the theme: Title and body's title / body sizes are 28 / 18 pt, other layouts scale from them
    const [v, base] = role === 'title' ? ['--th-title-size', 28] : ['--th-body-size', 18];
    Object.assign(content(b).style, { fontSize: `calc(var(${v}, ${Math.round(base * PT * 100) / 100}px) * ${Math.round(pt / base * 1000) / 1000})`, textAlign: ta });
    s.insertBefore(b, s.querySelector(':scope > .box:not([data-placeholder]):not([data-from-layout])'));
  }
  s.dataset.layout = name;
  editorLayouts([s]);
}
/* In Thermal a layout's picture is a wireframe rather than Slides' outlines and prompts: its title a canopy-blue bar
   (a large one for a big number), a subtitle a shorter grey bar, body text a few soft lines, aligned as the layout
   aligns them; coloured by thermal.css (.lp-*). */
function layoutWire(lay) {
  const bar = (x, y, w, h, cls) => `<rect class="${cls}" x="${Math.round(x)}" y="${Math.round(y)}" width="${Math.round(w)}" height="${Math.round(h)}" rx="${Math.round(h / 2)}"/>`;
  const at = (x, w, bw, align) => align === 'center' ? x + (w - bw) / 2 : x + 40;
  const parts = lay[2].map(([role, x, y, w, h, pt, valign, align]) => {
    if (role === 'title') {
      const big = lay[0] === 'big-number', bh = big ? Math.min(h - 40, 260) : Math.min(h - 30, pt >= 40 ? 120 : 84), bw = big ? Math.min(w * .32, 560) : Math.min(w - 80, w * (lay[0] === 'main-point' ? .7 : .55));
      const by = valign === 'bottom' ? y + h - bh - 20 : valign === 'middle' ? y + (h - bh) / 2 : y + 18;
      return bar(at(x, w, bw, align), by, bw, bh, 'lp-title');
    }
    if (role === 'sub') { const bw = Math.min(w - 80, w * .4), bh = Math.min(h - 30, 56); return bar(at(x, w, bw, align), valign === 'top' ? y + 22 : y + (h - bh) / 2, bw, bh, 'lp-sub'); }
    const n = Math.max(1, Math.min(4, Math.floor((h - 40) / 110))), lh = 40, step = Math.min(110, (h - 40) / n), widths = [.86, .72, .8, .6];
    const top = valign === 'middle' ? y + (h - n * step) / 2 + (step - lh) / 2 : y + 30;
    return `<rect class="lp-box" x="${x}" y="${y}" width="${w}" height="${h}" rx="28"/>` + widths.slice(0, n).map((f, i) => bar(at(x, w, (w - 80) * f, align), top + i * step, (w - 80) * f, lh, 'lp-line')).join('');
  });
  return `<svg class="lp" viewBox="0 0 1920 1080" width="140" height="79"><rect class="lp-bg" width="1920" height="1080"/>` +
    (lay[0] === 'section-description' ? '<rect class="lp-pane" x="960" width="960" height="1080"/>' : '') + parts.join('') + '</svg>';
}
const layoutPic = lay => document.documentElement.dataset.look === 'thermal' ? layoutWire(lay) : `<svg viewBox="0 0 1920 1080" width="120" height="68"><rect width="1920" height="1080" fill="#fff" stroke="#c7c7c7" stroke-width="12"/>` +
  (lay[0] === 'section-description' ? '<rect x="960" width="960" height="1080" fill="#eee"/>' : '') +
  lay[2].map(([role, x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#9aa0a6" stroke-width="8"/>`
    + `<text x="${x + 30}" y="${y + Math.min(h / 2 + 30, 110)}" font-size="${role === 'title' ? 90 : 60}" fill="#5f6368" font-family="Arial">${role === 'title' ? 'Click to add title' : ''}</text>`).join('') + '</svg>';
const layoutItems = () => allLayouts().map(lay => ({ label: lay[1], tile: true, svg: layoutPic(lay), on: () => slides[cur]?.dataset.layout === lay[0],
  run: () => slideOp(() => applyLayout(slides[cur], lay[0])) }));

function addText(text = 'Text', at) {
  const w = 800, h = 160;
  const b = makeBox({ x: (at?.x ?? W / 2) - w / 2, y: (at?.y ?? H / 2) - h / 2, w, h });
  b.dataset.minh = String(h);
  content(b).textContent = text;
  insert(b);
  return b;
}

/* The layout editor's own: on leaving, each layout's objects and background (and a deck layout's placeholders) are written
   to <template id="deck-layouts">; Slides' layouts with nothing of their own are left out of it. */
function writeLayouts(laySlides, t) {
  const out = [];
  for (const s of laySlides) {
    const name = s.dataset.edTheme || '', builtin = LAYOUTS.some(l => l[0] === name), objs = boxes(s).filter(b => !b.dataset.role);
    const bg = s.dataset.backgroundColor && s.dataset.backgroundColor.toLowerCase() !== (t.bg || '').toLowerCase() ? s.dataset.backgroundColor : '';
    if (builtin && !objs.length && !bg) continue;
    const L = deckDoc.createElement('div'); L.className = 'layout'; L.dataset.layout = name; L.dataset.name = s.dataset.edName || layoutName(name);
    if (bg) L.dataset.backgroundColor = bg;
    for (const b of boxes(s)) { const c = cleanBox(b); if (b.dataset.role) { c.dataset.placeholder = PH[b.dataset.role] || PH.body; const cc = c.querySelector(':scope > .content'); if (cc) cc.textContent = ''; } L.append(deckDoc.importNode(c, true)); }
    out.push(L);
  }
  let tpl = layoutTpl();
  if (!out.length) { tpl?.remove(); return; }
  if (!tpl) { tpl = deckDoc.createElement('template'); tpl.id = 'deck-layouts'; (deckDoc.querySelector('.reveal') || deckDoc.body.firstElementChild)?.after(tpl); }
  tpl.content.replaceChildren(...out.map(L => tpl.content.ownerDocument.importNode(L, true)));
}
$('#ed-lay-all').onclick = () => {   // the selected objects onto every layout, where this one has them
  const objs = [...sel].filter(b => !b.dataset.role); if (!objs.length) return setStatus('Select the objects to add to every layout', 'error');
  slides.filter(s => s.dataset.edTheme && s.dataset.edTheme !== 'master' && s !== slides[cur]).forEach(s => objs.forEach(b => { const c = /** @type {HTMLElement} */ (b.cloneNode(true)); c.id = uid(); c.querySelectorAll('[id]').forEach(e => { e.id = uid(); }); s.append(c); }));
  render(); setStatus(`Added to ${slides.filter(s => s.dataset.edTheme && s.dataset.edTheme !== 'master').length - 1} other layouts`);
};
$('#ed-lay-new').onclick = () => { const s = bareLayout(blankSlide('title-only')); s.dataset.edTheme = 'own-' + Date.now().toString(36); s.dataset.edName = 'New layout'; boxes(s).forEach(b => { content(b).textContent = SAMPLE[b.dataset.role] || SAMPLE.body; delete b.dataset.placeholder; }); slides.push(s); go(slides.length - 1); };
$('#ed-lay-dup').onclick = () => { const o = slides[cur], s = /** @type {HTMLElement} */ (o.cloneNode(true)); s.dataset.edTheme = 'own-' + Date.now().toString(36); s.dataset.edName = (o.dataset.edName || layoutName(o.dataset.edTheme)) + ' copy'; s.querySelectorAll('[id]').forEach(e => { e.id = uid(); }); slides.splice(cur + 1, 0, s); go(cur + 1); };
$('#ed-lay-ren').onclick = () => { const s = slides[cur]; askURL('Rename layout', v => { s.dataset.edName = v; updateThemeBar(); }, s.dataset.edName || ''); $('#ed-url-in').type = 'text'; };
$('#ed-lay-del').onclick = () => { if (LAYOUTS.some(l => l[0] === slides[cur].dataset.edTheme)) return; slides.splice(cur, 1); go(Math.min(cur, slides.length - 1)); };
