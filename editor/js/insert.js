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
