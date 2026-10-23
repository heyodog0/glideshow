/* The light / dark switch (a sun or moon button in the top bar, and View → Dark mode): the new theme spreads from the
   button in a circle (the View Transitions API), the icon turning as it goes. Instant where the browser lacks it or the
   system asks for reduced motion. The editor already has darkOn / setDark (js/notes.js); the home screen gets them here.
   The choice is the same one in both, remembered in this browser (slides-dark), else the system's. */
if (typeof setDark !== 'function') {   // the home screen
  const key = 'slides-dark', saved = () => { try { return localStorage.getItem(key); } catch { return null; } };
  const sys = matchMedia('(prefers-color-scheme: dark)');
  window['darkOn'] = () => { const v = saved(); return v ? v === '1' : sys.matches; };
  window['setDark'] = on => { try { localStorage.setItem(key, on ? '1' : '0'); } catch {} document.body.classList.toggle('dark', on); };
  document.body.classList.toggle('dark', darkOn());
  sys.addEventListener('change', () => { if (!saved()) document.body.classList.toggle('dark', darkOn()); });
}
{
  const btn = document.createElement('button');
  btn.id = 'theme-toggle'; btn.type = 'button';
  const label = () => {
    const dark = document.body.classList.contains('dark'), tip = dark ? 'Light mode' : 'Dark mode';
    btn.innerHTML = `<span class="icon">${dark ? 'light_mode' : 'dark_mode'}</span>`;
    btn.setAttribute('aria-label', tip); btn.dataset.tip = tip; if (!document.querySelector('#ed-bar')) btn.title = tip;   // the editor's tooltips read data-tip
  };
  const setDark0 = setDark;
  window['setDark'] = on => {
    const apply = () => { setDark0(on); label(); };
    if (on === document.body.classList.contains('dark')) return apply();
    if (!document.startViewTransition || !navigator.userActivation?.isActive || matchMedia('(prefers-reduced-motion: reduce)').matches || !btn.getClientRects().length) return apply();   // animated only for a click (button or menu); a script's call is immediate
    const r = btn.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.documentElement.classList.add('theme-turning');
    const t = document.startViewTransition(apply);
    t.ready.then(() => document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
      { duration: 700, easing: 'cubic-bezier(.65, 0, .35, 1)', pseudoElement: '::view-transition-new(root)' })).catch(() => {});
    t.finished.finally(() => document.documentElement.classList.remove('theme-turning'));
  };
  btn.onclick = () => setDark(!document.body.classList.contains('dark'));
  label();
  if (document.querySelector('#ed-comments-btn')) { btn.className = 'icon-btn'; document.querySelector('#ed-comments-btn').after(btn); }
  else {   // the home screen: in the top bar's last item (.hm-end), between GitHub and More
    btn.className = 'hm-tool'; document.querySelector('#hm-app-more').before(btn);
  }
}
