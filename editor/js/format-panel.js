/* ---------- format options panel ---------- */

/* Right-hand panel as in Slides (Format → Format options). It edits the single selected box. */
const fmt = $('#ed-fmt'), F = id => $('#ed-f-' + id);
/* Slides shows geometry in inches: the 1920px-wide slide is 10 in. */
const PX_IN = 192, toIn = px => Math.round(px / PX_IN * 100) / 100, fromIn = v => v * PX_IN;
const fitMode = () => fmt.querySelector('[name=ed-f-fit]:checked')?.value;
function setPanel(open) { fmt.hidden = !open; if (open) { $('#ed-objects').hidden = true; $('#ed-trans').hidden = true; $('#ed-theme').hidden = true; $('#ed-comments').hidden = true; } fit(); updatePanel(); }
function updatePanel() {
  if (fmt.hidden) return;
  const b = sel.size === 1 ? [...sel][0] : null;
  fmt.querySelectorAll('input, select, button:not(#ed-fmt-close)').forEach(e => { e.disabled = !b; });
  if (!b) return;
  const g = geo(b), c = content(b), cs = getComputedStyle(c), centre = F('from').value === 'c';
  F('w').value = toIn(g.w); F('h').value = toIn(g.h);
  F('lock').checked = b.dataset.lock === 'aspect' || isMedia(b);
  F('rot').value = rot(b);
  F('x').value = toIn(centre ? g.x + g.w / 2 : g.x); F('y').value = toIn(centre ? g.y + g.h / 2 : g.y);
  const mode = b.dataset.autofit || (b.dataset.shape ? 'none' : 'resize');
  fmt.querySelectorAll('[name=ed-f-fit]').forEach(r => { r.checked = r.value === mode; });
  ['pt', 'pb', 'pl', 'pr'].forEach((k, i) => { F(k).value = toIn(parseFloat(cs[['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'][i]])); });
  F('shadow').checked = 'shadow' in b.dataset;
  const ts = c.style.webkitTextStroke.match(/([\d.]+)px\s*(.*)/); F('tout').checked = !!ts;
  F('tout-w').value = F('tout-w-n').value = ts ? ts[1] : '2'; F('tout-color').value = toHex(ts?.[2] || '#000000', '#000000');
  for (const [k, def] of Object.entries(SHADOW_UI)) { const v = b.dataset['shadow' + k[0].toUpperCase() + k.slice(1)] ?? def; F('sh-' + k).value = k === 'opacity' ? Math.round(v * 100) : v; if (F('sh-' + k + '-n')) F('sh-' + k + '-n').value = F('sh-' + k).value; }
  const img = b.querySelector('.content > img'); fmt.classList.toggle('is-image', !!img);
  const vid = b.querySelector('.content > video'); fmt.classList.toggle('is-video', !!vid);
  const tbl = b.querySelector('.content table'); fmt.classList.toggle('is-table', !!tbl);
  if (tbl) { F('tstyle').value = b.dataset.tableStyle || ''; F('hrows').value = b.dataset.headerRows || '0'; F('hcols').value = b.dataset.headerCols || '0'; F('frows').value = b.dataset.footerRows || '0';
    F('altrows').checked = b.hasAttribute('data-alt-rows'); F('altcolor').value = toHex(b.style.getPropertyValue('--alt-row'), '#f3f3f3'); }
  if (vid) { const [, st, en] = trimOf(vid); F('v-start').value = st ? clock(st) : ''; F('v-end').value = en ? clock(en) : '';
    F('v-auto').checked = vid.hasAttribute('data-autoplay'); F('v-mute').checked = vid.hasAttribute('muted'); F('v-loop').checked = vid.hasAttribute('loop'); }
  if (img) { F('opacity').value = Math.round((img.style.opacity === '' ? 1 : +img.style.opacity) * 100); F('opacity-n').value = F('opacity').value;
    const adj = adjustsOf(b); for (const k of ADJUST) F('adj-' + k).value = F('adj-' + k + '-n').value = String(adj[k] || 0); }
  F('alt').value = b.querySelector('.content > img')?.alt || b.getAttribute('aria-label') || '';
}
const one = fn => () => { const b = [...sel][0]; if (sel.size !== 1) return; fn(b); drawOverlay(); commit(); };
F('w').onchange = one(b => {
  const g = geo(b), w = Math.max(1, fromIn(+F('w').value) || g.w);
  setGeo(b, { ...g, w, h: F('lock').checked && g.w ? g.h * w / g.w : g.h });
});
F('h').onchange = one(b => {
  const g = geo(b), h = Math.max(0, Math.round(fromIn(+F('h').value || 0)));
  setGeo(b, { ...g, h, w: F('lock').checked && g.h ? g.w * h / g.h : g.w });
  if (!b.dataset.shape) b.dataset.minh = h;
});
F('lock').onchange = one(b => { if (F('lock').checked) b.dataset.lock = 'aspect'; else delete b.dataset.lock; });
F('rot').onchange = one(b => setRot(b, +F('rot').value || 0));
F('rotr').onclick = one(b => setRot(b, rot(b) + 90));
const flip = axis => one(b => {
  const f = new Set(b.dataset.flip || ''); f.has(axis) ? f.delete(axis) : f.add(axis);
  const v = ['h', 'v'].filter(a => f.has(a)).join('');
  if (v) b.dataset.flip = v; else delete b.dataset.flip;
  shadeBox(b);
});
F('fliph').onclick = flip('h'); F('flipv').onclick = flip('v');
F('x').onchange = F('y').onchange = one(b => {
  const g = geo(b), c = F('from').value === 'c';
  setGeo(b, { ...g, x: fromIn(+F('x').value) - (c ? g.w / 2 : 0), y: fromIn(+F('y').value) - (c ? g.h / 2 : 0) });
});
F('from').onchange = updatePanel;
F('fit').onchange = one(b => {
  const v = fitMode();
  if (v === (b.dataset.shape ? 'none' : 'resize')) delete b.dataset.autofit; else b.dataset.autofit = v;
  fitHeight(b);
});
['pt', 'pb', 'pl', 'pr'].forEach(k => { F(k).onchange = one(b => {
  content(b).style.padding = ['pt', 'pr', 'pb', 'pl'].map(k => Math.round(Math.max(0, fromIn(+F(k).value || 0))) + 'px').join(' ');
  fitHeight(b);
}); });
F('shadow').onclick = e => e.stopPropagation();
/* Text outline (Keynote's Outline in the Text tab): a stroke round every letter, outside the fill, as -webkit-text-stroke on .content. */
function setTextOutline(b, on) {
  const s = content(b).style;
  if (on) { s.setProperty('-webkit-text-stroke', `${Math.max(0.5, +F('tout-w').value || 2)}px ${F('tout-color').value}`); s.setProperty('paint-order', 'stroke fill'); }
  else { s.removeProperty('-webkit-text-stroke'); s.removeProperty('paint-order'); }
}
F('tout').onclick = e => e.stopPropagation();
F('tout').onchange = one(b => setTextOutline(b, F('tout').checked));
F('tout-w').oninput = () => { F('tout-w-n').value = F('tout-w').value; const b = [...sel][0]; if (b) { F('tout').checked = true; setTextOutline(b, true); } };
for (const k of ['tout-w', 'tout-w-n', 'tout-color']) F(k).onchange = one(b => { if (k === 'tout-w-n') F('tout-w').value = F('tout-w-n').value; F('tout').checked = true; setTextOutline(b, true); });
F('tout-color').oninput = () => { const b = [...sel][0]; if (b) { F('tout').checked = true; setTextOutline(b, true); } };
/* Format options → Table, as Keynote's Table tab: a style, header rows and columns (real <th> cells), footer rows, and an
   alternating row colour (data-table-style, data-header-rows / -cols, data-footer-rows, data-alt-rows with --alt-row). */
function setTableHeads(b) {
  const t = b.querySelector('.content table'); if (!t) return;
  const hr = +b.dataset.headerRows || 0, hc = +b.dataset.headerCols || 0, g = cellGrid(t);
  [...t.rows].forEach((tr, r) => [...tr.cells].forEach(td => {
    const c = slotsOf(g, td)[0]?.[1] ?? 0, tag = r < hr || c < hc ? 'TH' : 'TD';
    if (td.tagName === tag) return;
    const n = document.createElement(tag); for (const a of td.attributes) n.setAttribute(a.name, a.value); n.append(...td.childNodes); td.replaceWith(n);
  }));
}
const tableNum = (k, max) => one(b => { const v = Math.max(0, Math.min(max, Math.round(+F(k === 'headerRows' ? 'hrows' : k === 'headerCols' ? 'hcols' : 'frows').value || 0)));
  if (v) b.dataset[k] = String(v); else delete b.dataset[k]; setTableHeads(b); fitHeight(b); });
F('hrows').onchange = tableNum('headerRows', 5); F('hcols').onchange = tableNum('headerCols', 5); F('frows').onchange = tableNum('footerRows', 3);
F('tstyle').onchange = one(b => { if (F('tstyle').value) b.dataset.tableStyle = F('tstyle').value; else delete b.dataset.tableStyle; });
F('altrows').onchange = one(b => { if (F('altrows').checked) { b.dataset.altRows = ''; b.style.setProperty('--alt-row', F('altcolor').value); } else { delete b.dataset.altRows; b.style.removeProperty('--alt-row'); } });
F('altcolor').oninput = () => { const b = [...sel][0]; if (b && b.hasAttribute('data-alt-rows')) b.style.setProperty('--alt-row', F('altcolor').value); };
F('altcolor').onchange = one(b => { if (!b.hasAttribute('data-alt-rows')) { b.dataset.altRows = ''; F('altrows').checked = true; } b.style.setProperty('--alt-row', F('altcolor').value); });
F('alt').onchange = one(b => {   // alt text: the image's alt, or an aria-label on other boxes
  const v = F('alt').value.trim(), img = b.querySelector('.content > img');
  if (img) img.alt = v; else if (v) b.setAttribute('aria-label', v); else b.removeAttribute('aria-label');
});
/* Image → Adjustments → Opacity: the picture only (not its border or shadow), as an inline opacity on the <img>. */
const setImgOpacity = (b, v) => { const img = b.querySelector('.content > img'); if (!img) return; v = Math.max(0, Math.min(100, +v || 0)); img.style.opacity = v >= 100 ? '' : v / 100; if (!img.getAttribute('style')) img.removeAttribute('style'); F('opacity').value = F('opacity-n').value = v; };
F('opacity').oninput = () => { const b = [...sel][0]; if (b) setImgOpacity(b, F('opacity').value); };
F('opacity').onchange = F('opacity-n').onchange = one(b => setImgOpacity(b, document.activeElement === F('opacity-n') ? F('opacity-n').value : F('opacity').value));
/* …and Keynote's Exposure, Saturation, Contrast, Highlights, Shadows, Sharpness, Temperature, Tint (-100…100), kept in
   data-adjust and drawn by shapes.js; dragging a slider redraws live, letting go commits. */
const adjustsOf = b => Object.fromEntries((b.dataset.adjust || '').split(/\s+/).map(p => p.split(':')).filter(([k, v]) => ADJUST.includes(k) && +v).map(([k, v]) => [k, +v]));
function setAdjust(b, k, v) {
  const a = adjustsOf(b); a[k] = Math.max(-100, Math.min(100, Math.round(+v || 0)));
  const s = ADJUST.filter(x => a[x]).map(x => `${x}:${a[x]}`).join(' ');
  if (s) b.dataset.adjust = s; else delete b.dataset.adjust;
  adjustImage(b); F('adj-' + k).value = F('adj-' + k + '-n').value = String(a[k]);
}
for (const k of ADJUST) {
  F('adj-' + k).oninput = () => { const b = [...sel][0]; if (b) setAdjust(b, k, F('adj-' + k).value); };
  F('adj-' + k).onchange = F('adj-' + k + '-n').onchange = one(b => setAdjust(b, k, document.activeElement === F('adj-' + k + '-n') ? F('adj-' + k + '-n').value : F('adj-' + k).value));
}
F('adj-reset').onclick = one(b => { setImgOpacity(b, 100); delete b.dataset.adjust; adjustImage(b); updatePanel(); });
/* Drop shadow controls, as Slides: changing one turns the shadow on. Defaults are left out of the deck. */
const SHADOW_UI = { color: '#000000', opacity: 0.3, angle: 90, distance: 6, blur: 8 };
for (const k of Object.keys(SHADOW_UI)) {
  const key = 'shadow' + k[0].toUpperCase() + k.slice(1), apply = (b, raw) => {
    const v = k === 'color' ? raw : k === 'opacity' ? Math.max(0, Math.min(100, +raw || 0)) / 100 : Math.max(0, +raw || 0);
    if (String(v) === String(SHADOW_UI[k])) delete b.dataset[key]; else b.dataset[key] = v;
    b.dataset.shadow = ''; F('shadow').checked = true; shadeBox(b);
  };
  F('sh-' + k).oninput = () => { const b = [...sel][0]; if (b) { apply(b, F('sh-' + k).value); if (F('sh-' + k + '-n')) F('sh-' + k + '-n').value = F('sh-' + k).value; } };
  F('sh-' + k).onchange = one(b => apply(b, F('sh-' + k).value));
  if (F('sh-' + k + '-n')) F('sh-' + k + '-n').onchange = one(b => { F('sh-' + k).value = F('sh-' + k + '-n').value; apply(b, F('sh-' + k + '-n').value); });
}
/* Video trim, as Slides' Start at / End at (m:ss or seconds): a #t=start,end media fragment on the src. */
const clock = t => { const s = Math.round(t % 60 * 10) / 10; return `${Math.floor(t / 60)}:${s < 10 ? '0' : ''}${s}`; };
const secs = v => { v = (v || '').trim(); if (!v) return 0; const p = v.split(':').map(Number); return p.some(isNaN) ? 0 : p.reduce((a, x) => a * 60 + x, 0); };
const trimOf = v => { const [base, frag = ''] = (v.getAttribute('src') || '').split('#'), m = frag.match(/^t=([\d.]*)(?:,([\d.]+))?$/); return [base, m ? +m[1] || 0 : 0, m && m[2] ? +m[2] : 0]; };
F('v-start').onchange = F('v-end').onchange = one(b => {
  const v = b.querySelector('.content > video'); if (!v) return;
  const [base] = trimOf(v), st = secs(F('v-start').value), en = secs(F('v-end').value);
  v.setAttribute('src', base + (st || en ? `#t=${st}${en > st ? ',' + en : ''}` : ''));
});
for (const [id, attr] of [['v-auto', 'data-autoplay'], ['v-mute', 'muted'], ['v-loop', 'loop']])
  F(id).onchange = one(b => { const v = b.querySelector('.content > video'); if (v) v.toggleAttribute(attr, F(id).checked); });
F('shadow').onchange = one(b => { if (F('shadow').checked) b.dataset.shadow = ''; else delete b.dataset.shadow; shadeBox(b); });
$('#ed-fmt-close').onclick = () => setPanel(false);
$('#ed-format-options').onclick = () => setPanel(fmt.hidden);
$('#ed-animate').onclick = () => { setTransPanel(true); addAnim(); };
