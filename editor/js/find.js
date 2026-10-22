/* ---------- find and replace (⌘F, ⇧⌘H) ---------- */

/* Searches the text of every box on every slide. Matches on the shown slide are highlighted with the CSS
   Custom Highlight API, so the deck's markup is never touched. (A match split across formatting runs
   isn't found.) */
let found = [], foundAt = 0;
/* Ignore diacritics maps each UTF-16 unit to its base letter (é → e), which keeps indices aligned. */
const baseChars = t => t.split('').map(ch => ch.normalize('NFD')[0]).join('');
function finder() {
  const q = $('#ed-find-q').value, cs = $('#ed-find-case').checked, dia = $('#ed-find-dia').checked;
  if (!q) return null;
  let src = $('#ed-find-re').checked ? q.replace(/\\n/g, '\n').replace(/\\t/g, '\t') : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (dia) src = baseChars(src);
  try { return { re: new RegExp(src, 'g' + (cs ? '' : 'i')), dia }; } catch { return null; }   // invalid regex: no matches
}
function search() {
  const f = finder();
  found = [];
  if (f) slides.forEach((s, si) => boxes(s).forEach(b => {
    const c = content(b); if (!c) return;
    const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    for (let n; (n = /** @type {Text} */ (w.nextNode()));) {
      const t = f.dia ? baseChars(n.data) : n.data;
      for (const m of t.matchAll(f.re)) if (m[0].length) found.push({ si, b, n, i: m.index, len: m[0].length, m: [...m] });
    }
  }));
  foundAt = Math.max(0, Math.min(foundAt, found.length - 1));
  paintFound();
}
function paintFound() {
  const q = $('#ed-find-q').value;
  $('#ed-find .find-count').textContent = !q ? '' : found.length ? `${foundAt + 1} of ${found.length}` : 'No results';
  if (!window.CSS?.highlights) return;
  const range = f => { const r = new Range(); r.setStart(f.n, f.i); r.setEnd(f.n, f.i + f.len); return r; };
  CSS.highlights.set('find', new Highlight(...found.filter(f => f.si === cur).map(range)));
  const f = found[foundAt];
  if (f && f.si === cur) CSS.highlights.set('find-current', new Highlight(range(f))); else CSS.highlights.delete('find-current');
}
function refreshFind() { if (!$('#ed-find').hidden) search(); }
function findStep(d) {
  if (!found.length) return;
  foundAt = (foundAt + d + found.length) % found.length;
  if (found[foundAt].si !== cur) go(found[foundAt].si); else paintFound();
}
function replaceIn(matches, by) {
  const re = $('#ed-find-re').checked;
  const text = f => re ? by.replace(/\n/g, '\n').replace(/\t/g, '\t').replace(/\$(\d)/g, (_, d) => f.m[d] ?? '') : by;
  for (const f of [...matches].sort((a, b) => a.n === b.n ? b.i - a.i : 0)) f.n.data = f.n.data.slice(0, f.i) + text(f) + f.n.data.slice(f.i + f.len);
  boxes().filter(b => matches.some(f => f.b === b)).forEach(fitHeight);
  commit();
}
function openFind() {
  closeMenu();
  const d = $('#ed-find'), q = $('#ed-find-q'), picked = editing ? getSelection().toString() : '';
  d.hidden = false;
  if (picked && !picked.includes('\n')) q.value = picked;
  q.focus(); q.select(); foundAt = 0; search();
}
function closeFind() { $('#ed-find').hidden = true; CSS.highlights?.delete('find'); CSS.highlights?.delete('find-current'); }
$('#ed-find-q').oninput = () => { foundAt = 0; search(); };
$('#ed-find-case').onchange = $('#ed-find-re').onchange = $('#ed-find-dia').onchange = () => { foundAt = 0; search(); };
$('#ed-find-q').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); } };
$('#ed-find-next').onclick = () => findStep(1);
$('#ed-find-prev').onclick = () => findStep(-1);
$('#ed-find-one').onclick = () => { if (found[foundAt]) replaceIn([found[foundAt]], $('#ed-find-r').value); };
$('#ed-find-all').onclick = () => {
  const n = found.length; if (!n) return;
  replaceIn(found, $('#ed-find-r').value);
  $('#ed-find .find-count').textContent = `Replaced ${n}`;
};
$('#ed-find .find-close').onclick = closeFind;
addEventListener('keydown', e => { if (!$('#ed-find').hidden && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeFind(); } }, true);
