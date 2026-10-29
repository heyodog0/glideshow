/* Code blocks: Insert → Code block → language makes a box with <pre><code class="language-…">, coloured by shapes.js'
   highlightCode; right-click → Code language changes it. */
const CODE_LANGS = [['python', 'Python'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['bash', 'Bash'], ['json', 'JSON'],
  ['cpp', 'C++'], ['rust', 'Rust'], ['go', 'Go'], ['sql', 'SQL'], ['r', 'R'], ['julia', 'Julia'], ['plaintext', 'Plain text']];
const CODE_SAMPLE = { python: 'def loss(logits, y):\n    return ce(logits, y)  # mean over the batch', javascript: 'const sum = xs => xs.reduce((a, b) => a + b, 0);' };
function addCode(lang) {
  const b = makeBox({ x: 360, y: 340, w: 1200, h: 400 }); b.dataset.valign = 'top';
  const pre = document.createElement('pre'), code = document.createElement('code');
  code.className = 'language-' + lang; code.textContent = CODE_SAMPLE[lang] || '// code'; pre.append(code);
  content(b).style.fontSize = '40px'; content(b).style.textAlign = 'left'; content(b).append(pre);
  insert(b); highlightCode(b);
}
/* Tables, as Slides: Insert → Table → a size grid (columns × rows); a `.box.table` holds a plain <table>. Cells are edited
   in place (Tab / ⇧Tab move between them, Tab in the last cell adds a row); right-click in a cell inserts or deletes rows
   and columns, deletes the table or evens out the rows / columns. */
function tableGrid() {
  const g = div('table-grid'), cap = div('table-cap'), N = 10;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const cell = div('tg-cell'); cell.dataset.r = String(r); cell.dataset.c = String(c);
    cell.onpointerenter = () => { g.querySelectorAll('.tg-cell').forEach(e => e.classList.toggle('on', +e.dataset.r <= r && +e.dataset.c <= c)); cap.textContent = `${c + 1} x ${r + 1}`; };
    cell.onclick = () => { closeMenu(); addTable(c + 1, r + 1); };
    g.append(cell);
  }
  const wrap = div('table-pick'); cap.textContent = '1 x 1'; wrap.append(g, cap); return wrap;
}
function addTable(cols, rows) {
  const w = Math.min(1600, cols * 320), h = rows * 96;
  const b = makeBox({ x: (W - w) / 2, y: (H - h) / 2, w, h, cls: 'table' }); b.dataset.valign = 'top';
  const t = document.createElement('table');
  for (let r = 0; r < rows; r++) { const tr = t.insertRow(); for (let c = 0; c < cols; c++) tr.insertCell(); }
  const c = content(b); c.style.padding = '0'; c.style.fontSize = `${Math.round(14 * PT * 100) / 100}px`; c.style.textAlign = 'left'; c.append(t);
  insert(b);
}
const cellAt = () => getSelection().anchorNode?.parentElement?.closest?.('td, th') || (getSelection().anchorNode?.closest?.('td, th'));
function focusCell(td) { const r = document.createRange(); r.selectNodeContents(td); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); lastRange = r.cloneRange(); }
/* Cell selection, as Slides and Keynote: drag across cells, or ⇧-click from the caret's cell, picks a rectangle (merged
   cells widen it); Fill colours those cells, Merge / Unmerge joins or splits them, ⌫ empties them. Marked .cell-on
   (editor only, stripped on save). */
let cellSel = new Set(), cellAnchor = null;
/** @param {HTMLTableElement} t */
function cellGrid(t) {   // the table as a grid of cells, a merged cell in every slot it covers
  /** @type {HTMLTableCellElement[][]} */ const g = [];
  [...t.rows].forEach((tr, r) => { let c = 0; for (const td of tr.cells) { while (g[r]?.[c]) c++;
    for (let i = 0; i < td.rowSpan; i++) for (let j = 0; j < td.colSpan; j++) (g[r + i] ||= [])[c + j] = td; c += td.colSpan; } });
  return g;
}
const slotsOf = (g, td) => g.flatMap((row, r) => row.map((x, c) => x === td ? [r, c] : null)).filter(Boolean);
function rectCells(a, b) {
  const g = cellGrid(a.closest('table')), all = [...slotsOf(g, a), ...slotsOf(g, b)];
  let r0 = Math.min(...all.map(p => p[0])), r1 = Math.max(...all.map(p => p[0])), c0 = Math.min(...all.map(p => p[1])), c1 = Math.max(...all.map(p => p[1]));
  for (let grew = true; grew;) {   // a merged cell sticking out of the rectangle widens it
    grew = false;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) for (const [rr, cc] of slotsOf(g, g[r][c])) {
      if (rr < r0) { r0 = rr; grew = true; } if (rr > r1) { r1 = rr; grew = true; } if (cc < c0) { c0 = cc; grew = true; } if (cc > c1) { c1 = cc; grew = true; } }
  }
  const out = new Set(); for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (g[r]?.[c]) out.add(g[r][c]);
  return out;
}
function markCells() { canvas.querySelectorAll('.cell-on').forEach(c => c.classList.remove('cell-on')); cellSel.forEach(c => c.classList.add('cell-on')); }
function clearCellSel() { cellAnchor = null; if (cellSel.size) { cellSel = new Set(); markCells(); } }
/** The cells a cell command acts on: the picked ones, else the caret's (or the last caret's) cell in the edited table. */
function cellTargets() {
  if (cellSel.size) return [...cellSel];
  const td = cellAt() || lastRange?.startContainer?.parentElement?.closest('td, th') || /** @type {any} */ (lastRange?.startContainer)?.closest?.('td, th');
  return editing && td && editing.contains(td) ? [td] : [];
}
canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const td = /** @type {Element} */ (e.target).closest?.('td, th');
  if (!editing || !td || !editing.contains(td)) return clearCellSel();
  const from = cellAt();
  if (e.shiftKey && from && from !== td && from.closest('table') === td.closest('table')) { e.preventDefault(); e.stopPropagation(); cellSel = rectCells(from, td); markCells(); return; }
  clearCellSel(); cellAnchor = td;
});
canvas.addEventListener('pointermove', e => {
  if (!cellAnchor || !(e.buttons & 1)) return;
  const td = document.elementFromPoint(e.clientX, e.clientY)?.closest('td, th');
  if (!td || td.closest('table') !== cellAnchor.closest('table')) return;
  if (td === cellAnchor) { if (cellSel.size) { cellSel = new Set(); markCells(); } return; }
  cellSel = rectCells(cellAnchor, td); markCells(); getSelection().removeAllRanges();
});
addEventListener('pointerup', () => { cellAnchor = null; });
function fillCells(v) { const cs = cellTargets(); if (!cs.length) return false; cs.forEach(td => { td.style.backgroundColor = v === 'transparent' ? '' : v; if (!td.getAttribute('style')) td.removeAttribute('style'); }); return true; }
/* Cell borders, as Slides: Select borders picks which sides (all, inner, horizontal, vertical, outer, left, top, right,
   bottom of the picked block); Border colour / weight / dash then set those sides as inline border-* on the cells. */
let cellSides = 'all';
const CELL_SIDES = [['all', 'border_all', 'All borders'], ['inner', 'border_inner', 'Inner borders'], ['horizontal', 'border_horizontal', 'Horizontal borders'],
  ['vertical', 'border_vertical', 'Vertical borders'], ['outer', 'border_outer', 'Outer borders'], ['left', 'border_left', 'Left border'],
  ['top', 'border_top', 'Top border'], ['right', 'border_right', 'Right border'], ['bottom', 'border_bottom', 'Bottom border']];
/** @param {'color' | 'width' | 'style'} prop */
function cellBorder(prop, v) {
  const cs = cellTargets(); if (!cs.length) return false;
  const g = cellGrid(cs[0].closest('table')), slots = cs.flatMap(td => slotsOf(g, td));
  const r0 = Math.min(...slots.map(p => p[0])), r1 = Math.max(...slots.map(p => p[0])), c0 = Math.min(...slots.map(p => p[1])), c1 = Math.max(...slots.map(p => p[1]));
  for (const td of cs) {
    const s = slotsOf(g, td), edge = { top: Math.min(...s.map(p => p[0])) === r0, bottom: Math.max(...s.map(p => p[0])) === r1, left: Math.min(...s.map(p => p[1])) === c0, right: Math.max(...s.map(p => p[1])) === c1 };
    const want = side => ({ all: true, outer: edge[side], inner: !edge[side], horizontal: /top|bottom/.test(side) && !edge[side], vertical: /left|right/.test(side) && !edge[side] })[cellSides] ?? (cellSides === side && edge[side]);
    for (const side of ['top', 'right', 'bottom', 'left']) if (want(side)) { td.style.setProperty(`border-${side}-${prop}`, v); if (prop !== 'style' && !td.style.getPropertyValue(`border-${side}-style`)) td.style.setProperty(`border-${side}-style`, 'solid'); }
  }
  return true;
}
menuButton($('#ed-cell-borders'), () => CELL_SIDES.map(([v, icon, label]) => ({ label, icon, on: () => cellSides === v, run: () => { cellSides = v; $('#ed-cell-borders .icon').textContent = icon; } })));
function mergeCells() {
  const cs = [...cellSel]; if (cs.length < 2) return;
  const t = cs[0].closest('table'), g = cellGrid(t), slots = cs.flatMap(td => slotsOf(g, td));
  const r0 = Math.min(...slots.map(p => p[0])), r1 = Math.max(...slots.map(p => p[0])), c0 = Math.min(...slots.map(p => p[1])), c1 = Math.max(...slots.map(p => p[1])), keep = g[r0][c0];
  for (const td of cs) if (td !== keep) { if (td.textContent.trim()) keep.append(document.createElement('br'), ...td.childNodes); td.remove(); }   // Slides keeps every cell's text
  keep.colSpan = c1 - c0 + 1; keep.rowSpan = r1 - r0 + 1;
  cellSel = new Set([keep]); markCells(); focusCell(keep); fitHeight(editing);
}
function unmergeCells() {
  for (const td of cellTargets().filter(td => td.colSpan > 1 || td.rowSpan > 1)) {
    const t = td.closest('table'), g = cellGrid(t), [r0, c0] = slotsOf(g, td)[0], rs = td.rowSpan, cs = td.colSpan;
    td.colSpan = 1; td.rowSpan = 1;
    for (let r = r0; r < r0 + rs; r++) {
      const tr = t.rows[r], after = [...tr.cells].find(x => x !== td && slotsOf(g, x)[0]?.[1] > c0 + cs - 1);   // the first cell right of the merged block
      for (let c = c0; c < c0 + cs; c++) { if (r === r0 && c === c0) continue; const n = document.createElement(td.tagName.toLowerCase()); n.style.cssText = td.style.cssText; after ? after.before(n) : tr.append(n); }
    }
  }
  clearCellSel(); fitHeight(editing);
}
/** @param {any} td a table cell */
function tableOp(op, td = cellAt()) {
  if (!td || !editing) return;
  const tr = /** @type {HTMLTableRowElement} */ (td.parentElement), t = td.closest('table'), ci = td.cellIndex, ri = tr.rowIndex, rows = [...t.rows];
  const blankRow = () => { const n = t.insertRow(-1); n.remove(); for (let i = 0; i < tr.cells.length; i++) n.insertCell(); return n; };
  if (op === 'row-above') tr.before(blankRow());
  if (op === 'row-below') tr.after(blankRow());
  if (op === 'col-left' || op === 'col-right') rows.forEach(r => r.insertCell(op === 'col-left' ? ci : ci + 1));
  if (op === 'del-row') { if (rows.length > 1) tr.remove(); else return tableOp('del-table', td); }
  if (op === 'del-col') { if (tr.cells.length > 1) rows.forEach(r => r.cells[ci]?.remove()); else return tableOp('del-table', td); }
  if (op === 'del-table') { const b = editing; stopEdit(); b.remove(); sel.clear(); drawOverlay(); commit(); return; }
  if (op === 'dist-rows') rows.forEach(r => r.style.removeProperty('height'));
  if (op === 'dist-cols') rows.forEach(r => [...r.cells].forEach(c => c.style.removeProperty('width')));
  setTableHeads(editing);   // new rows and columns take the header cells' kind
  const keep = t.rows[Math.min(ri, t.rows.length - 1)]?.cells[Math.min(ci, t.rows[0].cells.length - 1)];
  if (keep) focusCell(keep);
  fitHeight(editing);
}
const tableItems = () => [
  { label: 'Insert row above', icon: 'add', run: () => tableOp('row-above') }, { label: 'Insert row below', icon: 'add', run: () => tableOp('row-below') },
  { label: 'Insert column left', icon: 'add', run: () => tableOp('col-left') }, { label: 'Insert column right', icon: 'add', run: () => tableOp('col-right') },
  '-',
  { label: 'Delete row', icon: 'delete', run: () => tableOp('del-row') }, { label: 'Delete column', icon: 'delete', run: () => tableOp('del-col') },
  { label: 'Delete table', icon: 'delete', run: () => tableOp('del-table') },
  '-',
  { label: 'Merge cells', icon: 'cell_merge', run: mergeCells, off: () => cellSel.size < 2 },
  { label: 'Unmerge cells', run: unmergeCells, off: () => !cellTargets().some(td => td.colSpan > 1 || td.rowSpan > 1) },
  '-',
  { label: 'Distribute rows', icon: 'vertical_distribute', run: () => tableOp('dist-rows') }, { label: 'Distribute columns', icon: 'horizontal_distribute', run: () => tableOp('dist-cols') },
];
/* Insert → Equation: a box holding display-math source; KaTeX typesets it, double-click edits the source. */
function addEquation() {
  const b = makeBox({ x: 460, y: 440, w: 1000, h: 200 });
  content(b).style.fontSize = '48px'; content(b).style.textAlign = 'center'; content(b).textContent = '\\[ e^{i\\pi} + 1 = 0 \\]';
  insert(b); renderMath(content(b));
}
const codeOf = b => b && content(b).querySelector('pre code');
function setCodeLang(lang) {
  for (const b of sel) { const c = codeOf(b); if (!c) continue; c.className = 'language-' + lang; c.textContent = c.textContent; delete c.dataset.highlighted; highlightCode(b); }
  commit();
}
const codeLangItems = (run, on) => CODE_LANGS.map(([v, label]) => ({ label, run: () => run(v), on: on && (() => on(v)) }));
