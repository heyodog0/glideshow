/* ---------- menus ---------- */

/* A menu is a list of { label, key, run, off } items and '-' dividers, shown under its anchor. */
/* One Material-style menu for the menu bar, toolbar dropdowns and (later) context menus. Items are
   { label, icon, key, run, off, on, items, style } or '-' for a divider; `items` (an array or a function
   returning one) makes a submenu, shown with ▸. `on` puts a check in the icon column. Arrow keys, Enter
   and Esc work while a menu is open. */
/* Shortcut labels as Google writes them: ⌘Z, ⌘+Shift+V, ⌘+Option+Shift+B, Ctrl+M, Option+/. */
function gkey(k) {
  if (!k) return '';
  if (/^⌃⌘\w ⌃⌘\w$/.test(k)) return k.replace(/⌃⌘/g, 'Ctrl+⌘');   // two-step chords, written as Slides does: Ctrl+⌘E Ctrl+⌘G
  const mods = { '⌘': '⌘', '⌃': 'Ctrl', '⌥': 'Option', '⇧': 'Shift' }, has = c => k.includes(c);
  const key = k.replace(/[⌘⌃⌥⇧]/g, '').replace('↵', 'Enter');
  const list = ['⌘', '⌃', '⌥', '⇧'].filter(has).map(c => mods[c]);
  if (!list.length) return key;
  return list.length === 1 && list[0] === '⌘' ? '⌘' + key : list.join('+') + '+' + key;
}
let openMenuEl = null, openAnchor = null, subMenus = [];   // open submenus, outermost first
const val = v => typeof v === 'function' ? v() : v;
const levelOf = m => m === openMenuEl ? 0 : subMenus.indexOf(m) + 1;
function closeSub(level = 0) { subMenus.splice(level).forEach(m => m.remove()); }   // close submenus deeper than `level`
function closeMenu() { closeSub(); openMenuEl?.remove(); openAnchor?.classList.remove('open'); openMenuEl = openAnchor = null; }
function buildMenu(items) {
  const m = div('menu');
  m.addEventListener('mousedown', e => e.preventDefault());   // keep the text selection being formatted
  for (const it of val(items)) {
    if (it === '-') { m.append(div('menu-sep')); continue; }
    if (it.head) { const h = div('menu-head'); h.textContent = it.head; m.append(h); continue; }
    if (it.el) { m.append(it.el()); continue; }   // a custom body, e.g. the table size grid
    const row = document.createElement('button');
    row.className = 'menu-item'; row.disabled = !!val(it.off);
    row.innerHTML = '<span class="menu-icon icon"></span><span class="menu-label"></span><span class="menu-key"></span>';
    row.children[0].textContent = val(it.on) ? 'check' : it.icon || '';
    row.children[1].textContent = it.label;
    if (it.cell) row.classList.add('cell-item');
    if (it.tile) row.classList.add('tile-item');
    if (it.svg) { row.children[1].innerHTML = it.svg; row.setAttribute('aria-label', it.label); row.dataset.label = it.label; }   // a picture instead of words, as Slides' dash / line-end menus
    if (it.style) row.children[1].style.cssText = it.style;
    if (it.tip) row.dataset.tip = it.tip;
    if (it.items) {
      row.classList.add('has-sub'); row.children[2].className = 'menu-key icon'; row.children[2].textContent = 'arrow_right';
      row.onpointerenter = row.onclick = () => openSub(row, it.items);
    } else {
      row.children[2].textContent = gkey(it.key);
      row.onpointerenter = () => closeSub(levelOf(m));
      row.onclick = () => { closeMenu(); it.run(); };
    }
    m.append(row);
  }
  if (val(items).every(it => it === '-' || it.svg || it.narrow || it.el)) m.classList.add('pics');
  if (val(items).every(it => it.cell || it === '-')) m.classList.add('cell-grid');   // Slides' shape grids
  if (val(items).every(it => it.tile)) { m.classList.add('tile-grid'); m.querySelectorAll('.tile-item').forEach((r, i) => r.children[1].insertAdjacentHTML('beforeend', `<span class="cap">${val(items)[i].label}</span>`)); }   // layout pictures with names   // picture-only menus are narrow, as Slides
  return m;
}
function placeMenu(m, x, y, flipX) {
  document.body.append(m);
  if (x + m.offsetWidth > innerWidth - 8) x = flipX ?? innerWidth - m.offsetWidth - 8;
  m.style.left = Math.max(8, x) + 'px'; m.style.top = Math.max(8, Math.min(y, innerHeight - m.offsetHeight - 8)) + 'px';
}
function openMenu(anchor, items, { up = false } = {}) {
  closeMenu();
  const m = buildMenu(items), r = anchor.getBoundingClientRect();
  if (up) { document.body.append(m); placeMenu(m, r.left, r.top - m.offsetHeight - 6); }   // the insert bar: menus open above it
  else placeMenu(m, r.left, r.bottom + 2);
  anchor.classList.add('open'); openMenuEl = m; openAnchor = anchor;
}

function openSub(row, items) {
  const list = val(items);
  if (list?.then) return list.then(l => row.isConnected && openSub(row, l));   // a fetched submenu (File → Open's recent decks)
  const level = levelOf(row.parentElement);
  if (subMenus[level]?.dataset.from === row.textContent) return;
  closeSub(level);
  const m = buildMenu(list), r = row.getBoundingClientRect();
  m.dataset.from = row.textContent;
  placeMenu(m, r.right - 2, r.top - 6, r.left - m.offsetWidth + 2);
  subMenus.push(m);
}
addEventListener('pointerdown', e => {
  if (openMenuEl && ![openMenuEl, ...subMenus, openAnchor].some(el => el?.contains(e.target))) closeMenu();
}, true);
addEventListener('keydown', e => {
  if (!openMenuEl) return;
  const menu = [...subMenus].reverse().find(m => m.contains(document.activeElement)) || openMenuEl, level = levelOf(menu);
  const rows = [...menu.querySelectorAll('.menu-item:not(:disabled)')], i = rows.indexOf(document.activeElement);
  const take = () => { e.preventDefault(); e.stopImmediatePropagation(); };
  const back = () => { const from = menu.dataset.from, parent = level > 1 ? subMenus[level - 2] : openMenuEl; closeSub(level - 1); [...parent.children].find(r => r.textContent === from)?.focus(); };
  if (e.key === 'Escape') { take(); if (level) back(); else closeMenu(); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { take(); rows[(i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus(); }
  else if (e.key === 'ArrowRight' && document.activeElement?.classList.contains('has-sub')) { take(); document.activeElement.click(); subMenus.at(-1)?.querySelector('.menu-item:not(:disabled)')?.focus(); }
  else if (e.key === 'ArrowLeft' && level) { take(); back(); }
  else if (e.key === 'Enter' && i >= 0) { take(); rows[i].click(); }
}, true);
