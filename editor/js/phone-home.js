/* ---------- phone: the home screen ---------- */
/* The Slides app's home on a phone: a search bar with the menu, folder and account buttons; the sort label and the
   grid/list toggle under it; two columns of decks; a round + at the bottom right. It rearranges home.html's own
   controls (their handlers stay), and phone.css styles them. */
if (PHONE) (() => {
  const el = (tag, cls, html = '') => Object.assign(document.createElement(tag), { className: cls, innerHTML: html });
  const iconBtn = (icon, title) => { const b = el('button', 'ph-icon-btn', `<span class="icon">${icon}</span>`); b.title = title; return b; };
  const app = $('#hm-app-more'), q = $('#hm-q');
  // the search bar: ≡ | Search | folder | account
  const bar = el('div', 'ph-search'), menu = iconBtn('menu', 'Menu'), folder = iconBtn('folder', 'Folders'), me = el('button', 'ph-avatar');
  const cloud = window.GLIDESHOW_CLOUD, user = typeof cloud === 'object' ? cloud?.name || cloud?.user : '';
  me.title = user || 'Glideshow'; me.innerHTML = user ? '' : '<img src="/editor/glideshow.svg" alt="">'; if (user) me.textContent = user[0].toUpperCase();
  q.placeholder = 'Search in Glideshow';
  bar.append(menu, q, folder, me);
  $('.hm-search').replaceWith(bar);
  menu.onclick = me.onclick = e => {   // the app menu, under the button tapped (home.html anchors it to its own ⋮, hidden here)
    e.stopPropagation(); app.click();
    const m = /** @type {HTMLElement} */ (document.querySelector('.menu')), r = /** @type {Element} */ (e.currentTarget).getBoundingClientRect();
    if (m) { m.classList.add('ph-menu'); m.style.left = Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8)) + 'px'; m.style.top = r.bottom + 8 + 'px'; }
  };
  // the folder button: the library's folders (and a new one), to go into
  folder.onclick = async e => {
    e.stopPropagation();
    const fs = await fetch('/api/folders').then(r => r.json()).catch(() => []);
    const go = f => () => { location.hash = f ? '/' + f.split('/').map(encodeURIComponent).join('/') : ''; };
    const items = [['home', 'All decks', go('')], ...(Array.isArray(fs) ? fs : []).map(f => ['folder', f.replace(/\//g, ' › '), go(f)]), '-', ['create_new_folder', 'New folder', () => $('#hm-newfolder').click()]];
    document.querySelector('.menu')?.remove();
    const m = el('div', 'menu ph-menu');
    for (const it of items) {
      if (it === '-') { m.append(el('div', 'menu-sep')); continue; }
      const [icon, label, run] = it, b = el('button', 'menu-item', `<span class="menu-icon icon">${icon}</span><span class="menu-label"></span>`);
      b.querySelector('.menu-label').textContent = label; b.onclick = ev => { ev.stopPropagation(); m.remove(); run(); }; m.append(b);
    }
    document.body.append(m);
    const r = folder.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8)) + 'px'; m.style.top = r.bottom + 4 + 'px';
    setTimeout(() => addEventListener('pointerdown', ev => { if (!m.contains(/** @type {Node} */ (ev.target))) m.remove(); }, { once: true }));
  };
  // under the search: "Last opened by me ↓" (or "Title"), which flips the sort, and the grid/list toggle
  const sort = $('#hm-sort'), view = $('#hm-view'), row = el('div', 'ph-sortrow'), label = el('button', 'ph-sort');
  const showSort = () => { label.innerHTML = `<span></span><span class="icon">arrow_downward</span>`; label.firstChild.textContent = sort.classList.contains('on') ? 'Title' : 'Last opened by me'; };
  new MutationObserver(showSort).observe(sort, { attributes: true, attributeFilter: ['class'] }); showSort();
  label.onclick = () => sort.click();
  const tools = el('span', 'ph-sorttools'); tools.append(phoneThemeButton(), view);
  row.append(label, tools);
  $('.hm-head').after(row);
  // + : a new presentation, as the round button at the bottom right
  const fab = $('#hm-new'); fab.className = 'ph-fab'; fab.title = 'New presentation'; fab.innerHTML = '<span class="icon">add</span>';
  fab.addEventListener('click', () => { try { sessionStorage.setItem('ph-open-edit', '1'); } catch {} }, true);   // a new deck opens for editing, as the app
  document.body.append(fab);
})();
