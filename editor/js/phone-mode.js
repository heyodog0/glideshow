/* ---------- phone mode ---------- */
/* Loaded first in <head>: on a phone (a coarse pointer and a short screen side of 600 CSS px or less, in portrait or
   landscape; not an iPad) the page gets Google Slides' iPhone app instead of the desktop chrome. `phone` on <html>
   switches editor/phone.css on, PHONE tells editor/js/phone-*.js. ?phone=1 / ?phone=0 force it for this load. */
const PHONE = (() => {
  const q = new URLSearchParams(location.search).get('phone');
  return q === '1' || (q !== '0' && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 600);
})();
if (PHONE) {
  document.documentElement.classList.add('phone');
  if ('phoneViewport' in document.documentElement.dataset && !document.querySelector('meta[name=viewport]')) {
    const m = document.createElement('meta'); m.name = 'viewport';
    m.content = 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content';
    document.head.append(m);
  }
}
/* A home-screen app on iOS (WebKit bug 297779 and others, iOS 17–26): after the keyboard, WebKit can keep laying the page
   out for a viewport about a status bar shorter than the screen, until the app is quit: the page rides up under the
   status bar with a band at the bottom. So there the page keeps the tallest height the app has had in this orientation
   (never more than the screen), not a viewport unit (html.ph-app, --ph-app-h, phone.css): iOS 27 gives 100lvh more
   than the screen, and 100% or dvh can be left short. While the keyboard is up (html.ph-kb) the page is the visible
   area instead, its height and where it is (iOS slides the visible area down the page to show the caret: --ph-vv-top),
   so the text toolbar sits on the keyboard. And when the height stays short once nothing is being typed,
   hiding the page and showing it again makes WebKit measure afresh (the scroll positions inside kept); at most once a
   second, so it can't loop. */
if (PHONE && (matchMedia('(display-mode: standalone)').matches || navigator['standalone'])) (() => {
  const root = document.documentElement;
  /** @type {Record<number, number>} */ const tall = {};   // the largest height seen, per width (each orientation)
  const typing = () => { const a = document.activeElement; return !!a && (/** @type {HTMLElement} */ (a).isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); };
  const size = () => {
    const w = innerWidth, screenH = w > innerHeight ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
    tall[w] = Math.min(screenH, Math.max(tall[w] || 0, innerHeight));
    const vv = visualViewport, seen = Math.min(innerHeight, vv?.height || innerHeight), kb = typing() && tall[w] - seen > 120;   // a keyboard is at least this tall
    root.classList.toggle('ph-kb', kb);
    root.style.setProperty('--ph-app-h', (kb ? Math.round(seen) : tall[w]) + 'px');
    root.style.setProperty('--ph-vv-top', (kb ? Math.round(vv?.offsetTop || 0) : 0) + 'px');
    return w;
  };
  root.classList.add('ph-app'); size();
  let last = 0;
  const heal = () => {
    const w = size();
    if (typing() || tall[w] - innerHeight <= 4 || Date.now() - last < 1000 || !document.body) return;
    last = Date.now();
    const keep = [...document.querySelectorAll('*')].filter(e => e.scrollTop || e.scrollLeft).map(e => ({ e, t: e.scrollTop, l: e.scrollLeft }));
    const b = document.body; b.style.display = 'none'; void b.offsetHeight; b.style.display = '';
    keep.forEach(({ e, t, l }) => { e.scrollTop = t; e.scrollLeft = l; });
  };
  const soon = () => setTimeout(heal, 150);
  addEventListener('focusout', soon); addEventListener('focusin', () => setTimeout(size, 150)); addEventListener('pageshow', soon); addEventListener('resize', heal);
  visualViewport?.addEventListener('resize', heal); visualViewport?.addEventListener('scroll', () => requestAnimationFrame(size));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) soon(); });
})();
/* The light / dark switch on the phone (Thermal only; the app's own look is always dark): a sun or moon button that
   flips the same choice as the desktop's (setDark: js/notes.js in the editor, js/theme-toggle.js on Home). */
function phoneThemeButton() {
  const b = document.createElement('button'); b.className = 'ph-icon-btn ph-theme'; b.type = 'button';
  const show = () => { const dark = document.body.classList.contains('dark'); b.innerHTML = `<span class="icon">${dark ? 'light_mode' : 'dark_mode'}</span>`; b.title = dark ? 'Light mode' : 'Dark mode'; };
  b.onclick = () => window['setDark']?.(!document.body.classList.contains('dark'));
  new MutationObserver(show).observe(document.body, { attributes: true, attributeFilter: ['class'] }); show();
  return b;
}
/* Phone layouts, all three on by default: thumb: the editing actions in a pill above the
   filmstrip, the title on top. float: the format bar floats over the selection. shelf: Home as one column, the latest
   deck large, the rest as rows. ?layout=thumb,float,shelf picks some (remembered); ?layout= turns them all off. */
if (PHONE) {
  const q = new URLSearchParams(location.search), all = 'shelf thumb float';
  let lay = all;
  try { if (q.has('layout')) localStorage.setItem('glideshow-phone-layout', q.get('layout') || 'none'); lay = localStorage.getItem('glideshow-phone-layout') ?? all; }
  catch { if (q.has('layout')) lay = q.get('layout') || 'none'; }
  if (lay && lay !== 'none') document.documentElement.dataset.layout = lay.split(/[\s,+]+/).filter(Boolean).join(' ');
}
const phoneLayout = l => (document.documentElement.dataset.layout || '').split(' ').includes(l);
