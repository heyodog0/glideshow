/* Charts (D4), Keynote's 2D column, bar, line, area, pie and scatter: Insert → Chart → type makes a `.box.chart` with
   a <table class="chart-data"> and data-chart (shapes.js renderChart draws it). Edit chart data (double-click, ⇧⌘D,
   right-click or Format options → Chart) opens the Chart data editor: a grid where a value typed in the empty row or
   column adds a series or category, each row's and column's bar deletes it, and Plot rows / Plot columns picks the series. */
const CHART_TYPES = [['column', 'Column', 'bar_chart'], ['bar', 'Bar', 'align_horizontal_left'], ['line', 'Line', 'show_chart'],
  ['area', 'Area', 'area_chart'], ['pie', 'Pie', 'pie_chart'], ['scatter', 'Scatter', 'scatter_plot']];
const CHART_SAMPLE = {
  pie: [['', '2026'], ['Series 1', '35'], ['Series 2', '25'], ['Series 3', '22'], ['Series 4', '18']],
  scatter: [['', '1', '2', '3', '4', '5', '6'], ['Series 1', '12', '19', '27', '31', '42', '48'], ['Series 2', '20', '15', '30', '26', '38', '33']],
  other: [['', 'April', 'May', 'June', 'July'], ['Region 1', '17', '26', '53', '96'], ['Region 2', '55', '43', '70', '58']],   // Keynote's (k10-chart-data)
};
const isChart = b => !!b?.classList.contains('chart');
/** @param {string[][]} rows */
function chartTable(rows) {
  const t = document.createElement('table'); t.className = 'chart-data';
  rows.forEach((r, i) => { const tr = t.insertRow(); r.forEach((v, j) => { const c = document.createElement(i === 0 || j === 0 ? 'th' : 'td'); c.textContent = v; tr.append(c); }); });
  return t;
}
const chartRows = b => { const t = b.querySelector(':scope > table.chart-data'); return t ? [...t.rows].map(r => [...r.cells].map(c => c.textContent.trim())) : [['']]; };
function setChartRows(b, rows) { const t = b.querySelector(':scope > table.chart-data'), n = chartTable(rows); if (t) t.replaceWith(n); else b.append(n); renderChart(b); }
function addChart(kind) {
  const w = 1200, h = 720, b = makeBox({ x: (W - w) / 2, y: (H - h) / 2, w, h, cls: 'chart' });
  b.dataset.chart = kind; content(b).style.padding = '0'; if (kind !== 'pie') b.dataset.legend = 'off';   // Keynote's new chart has no legend or title
  b.append(chartTable(CHART_SAMPLE[kind] || CHART_SAMPLE.other));
  insert(b); renderChart(b);
}
const chartTypeItems = () => CHART_TYPES.map(([v, label, icon]) => ({ label, icon, run: () => addChart(v) }));

/* The Chart data editor: one chart at a time, floating over the canvas; edits redraw the chart as they're typed. */
let cedBox = null;
const ced = div('find chart-ed'); ced.id = 'ed-chart-ed'; ced.hidden = true; ced.setAttribute('role', 'dialog'); ced.setAttribute('aria-label', 'Chart data');
ced.innerHTML = `<header><h2>Chart data</h2><span class="ced-plot"><button data-plot="rows" title="Plot rows as series"><span class="icon">table_rows</span></button><button data-plot="columns" title="Plot columns as series"><span class="icon">view_column</span></button></span><button class="ced-close" title="Close"><span class="icon">close</span></button></header><div class="ced-wrap"><table class="ced-grid"></table></div>`;
document.body.append(ced);
const cedGrid = /** @type {HTMLTableElement} */ (ced.querySelector('.ced-grid'));
function openChartData(b = [...sel][0]) {
  if (!isChart(b)) return;
  cedBox = b; ced.hidden = false; drawChartData();
  /** @type {HTMLInputElement} */ (cedGrid.querySelector('input'))?.focus();
}
function closeChartData() { if (ced.hidden) return; ced.hidden = true; if (cedBox?.isConnected) { setChartRows(cedBox, trimRows(chartRows(cedBox))); commit(); } cedBox = null; }
const trimRows = rows => {   // drop empty trailing rows and columns (the editor's spare ones)
  const used = r => r.some(v => v !== '');
  while (rows.length > 1 && !used(rows[rows.length - 1])) rows.pop();
  let n = Math.max(1, ...rows.map(r => r.length));
  while (n > 1 && rows.every(r => !(r[n - 1] ?? ''))) n--;
  return rows.map(r => Array.from({ length: n }, (_, i) => r[i] ?? ''));
};
function drawChartData() {
  const rows = trimRows(chartRows(cedBox)), nr = rows.length + 1, nc = Math.max(...rows.map(r => r.length)) + 1;
  const cols = cedBox.dataset.plot === 'columns', pal = CHART_COLORS[+cedBox.dataset.palette || 0] || CHART_COLORS[0];   // the series' bars carry their colour, as Keynote's
  ced.querySelectorAll('.ced-plot button').forEach(x => x.classList.toggle('on', (/** @type {HTMLElement} */ (x).dataset.plot === 'columns') === (cedBox.dataset.plot === 'columns')));
  cedGrid.replaceChildren();
  const bars = cedGrid.insertRow(); bars.className = 'ced-bars'; bars.insertCell();
  for (let j = 0; j < nc; j++) { const c = bars.insertCell(); if (j < nc - 1 && j > 0) c.append(cedBar('col', j, cols ? pal[(j - 1) % pal.length] : '')); }
  for (let i = 0; i < nr; i++) {
    const tr = cedGrid.insertRow(), bar = tr.insertCell(); bar.className = 'ced-rowbar'; if (i > 0 && i < nr - 1) bar.append(cedBar('row', i, cols ? '' : pal[(i - 1) % pal.length]));
    for (let j = 0; j < nc; j++) {
      const td = tr.insertCell(), inp = document.createElement('input');
      inp.value = rows[i]?.[j] ?? ''; inp.dataset.r = String(i); inp.dataset.c = String(j);
      if (i === 0 || j === 0) td.className = 'ced-head';
      if (i === 0 && j === 0) inp.disabled = true;
      td.append(inp);
    }
  }
}
function cedBar(kind, k, color) {
  const x = document.createElement('button'); x.className = 'ced-bar ' + kind; x.title = kind === 'row' ? 'Row' : 'Column'; if (color) x.style.background = color;
  x.onclick = () => openMenu(x, [{ label: kind === 'row' ? 'Delete row' : 'Delete column', icon: 'delete', run: () => {
    const rows = chartRows(cedBox); if (kind === 'row') rows.splice(k, 1); else rows.forEach(r => r.splice(k, 1));
    setChartRows(cedBox, trimRows(rows)); drawChartData(); commit(); } }]);
  return x;
}
cedGrid.addEventListener('input', e => {
  const inp = /** @type {HTMLInputElement} */ (e.target), r = +inp.dataset.r, c = +inp.dataset.c, rows = chartRows(cedBox);
  while (rows.length <= r) rows.push([]);
  rows.forEach(row => { while (row.length <= c) row.push(''); });
  rows[r][c] = inp.value.trim();
  const grew = r >= trimRows(chartRows(cedBox)).length || c >= Math.max(...chartRows(cedBox).map(x => x.length));
  setChartRows(cedBox, rows.map(row => [...row]));
  if (grew && inp.value.trim()) { drawChartData(); const n = /** @type {HTMLInputElement} */ (cedGrid.querySelector(`input[data-r="${r}"][data-c="${c}"]`)); n?.focus(); n?.setSelectionRange(n.value.length, n.value.length); }
});
cedGrid.addEventListener('change', () => commit());
cedGrid.addEventListener('keydown', e => {   // ↵ goes down a row, as a spreadsheet; Esc closes
  const inp = /** @type {HTMLInputElement} */ (e.target);
  if (e.key === 'Enter') { e.preventDefault(); const n = /** @type {HTMLInputElement} */ (cedGrid.querySelector(`input[data-r="${+inp.dataset.r + (e.shiftKey ? -1 : 1)}"][data-c="${inp.dataset.c}"]`)); n?.focus(); n?.select(); }
});
addEventListener('keydown', e => { if (e.key === 'Escape' && !ced.hidden && !openMenuEl) { e.preventDefault(); e.stopImmediatePropagation(); closeChartData(); } }, true);   // Esc closes it, wherever the focus is
ced.querySelector('.ced-close').addEventListener('click', closeChartData);
ced.querySelectorAll('.ced-plot button').forEach(x => x.addEventListener('click', () => {
  if (/** @type {HTMLElement} */ (x).dataset.plot === 'columns') cedBox.dataset.plot = 'columns'; else delete cedBox.dataset.plot;
  renderChart(cedBox); drawChartData(); commit();
}));
