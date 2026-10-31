/* ---------- keyboard shortcuts dialog (⌘/) ---------- */

/* Grouped as Slides' dialog; lists only what this editor does. */
const SHORTCUTS = {
  'Common actions': [['Search the menus', '⌥/'], ['Undo', '⌘Z'], ['Redo', '⇧⌘Z or ⌘Y'], ['Copy', '⌘C'], ['Cut', '⌘X'], ['Paste', '⌘V'], ['Paste without formatting', '⇧⌘V'],
    ['Copy formatting', '⌥⌘C'], ['Paste formatting', '⌥⌘V'], ['Duplicate (slide when the filmstrip has focus)', '⌘D'], ['Delete', '⌫'],
    ['Select all', '⌘A'], ['Insert or edit link', '⌘K'], ['New slide', '⌃M or ⌘M'], ['New sub-slide below', '⇧⌘M'], ['Find', '⌘F'], ['Find and replace', '⇧⌘H'],
    ['Save', '⌘S'], ['Print', '⌘P'], ['Hide menus', '⌃⇧F'], ['Show speaker notes', '⌥⇧⌘S'], ['Show spelling suggestions', '⌥⌘X'], ['Grid view', '⌥⌘1'], ['Insert comment', '⌥⌘M'], ['Keyboard shortcuts', '⌘/']],
  'Text formatting': [['Bold', '⌘B'], ['Italic', '⌘I'], ['Underline', '⌘U'], ['Strikethrough', '⇧⌘X'], ['Superscript', '⌘.'],
    ['Subscript', '⌘,'], ['Increase font size', '⇧⌘.'], ['Decrease font size', '⇧⌘,'], ['Clear formatting', '⌘\\']],
  'Paragraph formatting': [['Bulleted list', '⇧⌘8'], ['Numbered list', '⇧⌘7'], ['Increase / decrease indent', '⌘] / ⌘['], ['Indent in a list', 'Tab / ⇧Tab'], ['Tab character (to the next tab stop)', '⌥Tab'],
    ['Align left / center / right', '⇧⌘L / ⇧⌘E / ⇧⌘R'], ['Justify', '⇧⌘J']],
  'Objects': [['Select next / previous object', 'Tab / ⇧Tab'], ['Bring forward / send backward', '⌘↑ / ⌘↓'],
    ['Rotate 15° / 1°', '⌥← ⌥→ / ⇧⌥← ⇧⌥→'], ['Larger horizontally / vertically / both', '⌃⌘B / ⌃⌘I / ⌃⌘K'],
    ['Smaller horizontally / both', '⌃⌘W / ⌃⌘J'], ['Resize from the centre', '⌥ + resize']],
  'Actions': [['Edit text in the selected box', '↵'], ['Finish editing / deselect', 'Esc'], ['Nudge', '← ↑ → ↓'], ['Nudge 10 px', '⇧ + arrows'],
    ['Group / ungroup', '⌥⌘G / ⇧⌥⌘G'], ['Bring to front', '⇧⌘↑'], ['Send to back', '⇧⌘↓'], ['Chart data editor (a chart selected)', '⇧⌘D'], ['Constrain a drag', '⇧ + drag'], ['Drag a copy', '⌥ + drag'],
    ['Drag without snapping', '⌘ + drag'], ['Rotate in 15° steps', '⇧ + rotate'], ['Resize freely / keep proportions', '⇧ + resize']],
  'Filmstrip (click a slide first)': [['Previous / next slide', '↑ ↓ or PgUp PgDn'], ['First / last slide', 'Home / End'],
    ['Move slides up / down', '⌘↑ or ⌘← / ⌘↓ or ⌘→'], ['Move slides to beginning / end', '⇧⌘↑ or ⇧⌘← / ⇧⌘↓ or ⇧⌘→'],
 ['Extend / toggle slide selection', '⇧-click, ⇧↑↓ / ⌘-click'],
    ['Delete / duplicate selected slides', '⌫ / ⌘D'], ['Select all slides', '⌘A'], ['Back to the slide / to the filmstrip', '⏎ / Esc'], ['Move to filmstrip', '⌥⇧⌘F']],
  'Navigation': [['Next / previous slide (nothing selected)', '↓ / ↑'], ['Next / previous slide', 'Page Down / Page Up'],
    ['Next / previous slide while typing', 'Page Down / Page Up'], ['Go to slide', '⌃⌘G'], ['Next / previous comment', '⌥⌘K / ⌥⇧⌘K'],
    ['Zoom in', '⌘+'], ['Zoom out', '⌘−'], ['Fit', '⌘0'], ['Zoom to selection', '⇧⌘0'], ['Zoom to fit content', '⌥⇧⌘0']],
  'Presenting': [['Present from this slide', '⌘↵'], ['Present from beginning', '⇧⌘↵'], ['Next / previous slide', '→ / ← or N / P'], ['Up / down in a stack', '↓ / ↑'],
    ['Next / back in reading order', 'Space / ⇧Space or PgDn / PgUp'], ['First / last slide', 'Home / End'], ['Go to slide n', 'n then ↵'],
    ['Next slide, skipping builds', '⇧→'], ['Previous build', '⇧←'], ['Back through viewed slides', 'Z'],
    ['Black / white screen', 'B / W'], ['Laser pointer', 'L'], ['Show / hide the pointer', 'C'], ['Full screen', 'F'], ['Speaker view', 'S'], ['Show the keys', '?'],
    ['Note for the AI (presenting from the editor)', 'M'], ['Exit', 'Esc or Q']],
};
/* Keys drawn as keycaps, Google-style: ⇧⌘V → [⌘][Shift][V]; alternatives joined with "or"; "+ drag" stays text. */
function keycaps(k) {
  const esc = t => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const cap = t => `<kbd>${esc(t)}</kbd>`;
  const combo = t => {
    if (/ \+ /.test(t)) return t.split(' + ').map(x => /^[⌘⌃⌥⇧]+$/.test(x) ? combo(x) : esc(x)).join(' + ');
    if (/^[A-Za-z][a-z]+( [A-Za-z]+)?$/.test(t) && !/^[A-Z]$/.test(t)) return cap(t);   // Esc, Tab, Home, Page Down
    const mods = ['⌘', '⌃', '⌥', '⇧'].filter(m => t.includes(m)).map(m => ({ '⌘': '⌘', '⌃': 'Ctrl', '⌥': 'Option', '⇧': 'Shift' })[m]);
    const rest = t.replace(/[⌘⌃⌥⇧]/g, '').replace('↵', 'Enter').trim();
    return [...mods, ...(rest ? rest.split(' ') : [])].map(cap).join('');
  };
  return k.split(/ or | \/ /).map(t => t.split(' then ').map(combo).join(' then ')).join(' <span class="or">or</span> ');

}
const shortcutsDlg = $('#ed-shortcuts');
function renderShortcuts(q = '') {
  q = q.trim().toLowerCase();
  const body = shortcutsDlg.querySelector('.sc-body');
  body.replaceChildren(...Object.entries(SHORTCUTS).flatMap(([cat, rows]) => {
    const hits = rows.filter(([label, key]) => !q || label.toLowerCase().includes(q) || key.toLowerCase().includes(q) || cat.toLowerCase().includes(q));
    if (!hits.length) return [];
    const sec = div('sc-section'), h = document.createElement('h3'); h.textContent = cat; sec.append(h);
    for (const [label, key] of hits) {
      const r = div('sc-row'), l = document.createElement('span'), k = document.createElement('span'); k.className = 'keys';
      l.textContent = label; k.innerHTML = keycaps(key); r.append(l, k); sec.append(r);
    }
    return [sec];
  }));
  if (!body.children.length) { const e = div('sc-empty'); e.textContent = 'No shortcuts match'; body.append(e); }
}
function showShortcuts(on) {
  closeMenu();
  shortcutsDlg.hidden = !on;
  if (on) { const i = shortcutsDlg.querySelector('input'); i.value = ''; renderShortcuts(); i.focus(); }
}
shortcutsDlg.querySelector('input').oninput = e => renderShortcuts(e.target.value);
shortcutsDlg.querySelector('.sc-close').onclick = () => showShortcuts(false);
shortcutsDlg.addEventListener('pointerdown', e => { if (e.target === shortcutsDlg) showShortcuts(false); });
addEventListener('keydown', e => { if (!shortcutsDlg.hidden && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); showShortcuts(false); } }, true);
