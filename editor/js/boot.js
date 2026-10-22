/* ---------- boot ---------- */

/* The library's load today, as glideshow.org says on its responses (cloud/library.js meter): 'slow', changes made
   elsewhere are checked once a minute rather than every 8 s; 'paused', no background traffic at all (no checks, no live
   socket) until a reload, and a bar says why. Saving still works. (The Mac and a library in the browser never say.) */
let loadLevel = '', changesFeed = /** @type {EventSource | null} */ (null), changesTimer = 0;
/* How changes made elsewhere come in: on the Mac and in a library kept in the browser, a stream (/api/events); on
   glideshow.org with GitHub's push webhook (worker.js githubWebhook), over the live socket, with a look every 5 minutes
   in case a push went unheard; a Drive library once a minute; otherwise every 8 s, as the stream's retry says. */
const checkChanges = () => fetch('/api/events').then(r => r.text()).then(t => remoteVersion((t.match(/^data: (.*)$/m) || [])[1] || '')).catch(() => {});
function watchChanges() {
  changesFeed?.close(); changesFeed = null; clearInterval(changesTimer); changesTimer = 0;
  if (loadLevel === 'paused') return;
  const how = /** @type {any} */ (window.GLIDESHOW_CLOUD)?.changes;
  const every = how === 'push' ? 300_000 : how === 'minute' || loadLevel === 'slow' ? 60_000 : 0;
  if (every) { changesTimer = window.setInterval(checkChanges, every); return; }
  changesFeed = new EventSource('/api/events'); changesFeed.onmessage = ev => remoteVersion(ev.data);
}
function setLoad(level) {
  if (!level || level === loadLevel || loadLevel === 'paused') return;
  loadLevel = level; watchChanges();
  if (level === 'paused') { const ws = liveSocket; liveSocket = null; try { ws?.close(); } catch {} setPeople([]); }
  const bar = $('#ed-load-bar'); if (!bar) return;   // (a page from before the bar, kept by a cache)
  $('#ed-load-what').textContent = level === 'paused'
    ? 'Glideshow paused syncing for this library until 00:00 UTC: it made an unusual number of requests today. Saving still works; reload to see changes made elsewhere.'
    : 'This library is busy today, so changes made elsewhere are checked once a minute.';
  bar.classList.toggle('paused', level === 'paused'); bar.hidden = false;
}
{ const f = window.fetch.bind(window); window.fetch = async (u, o) => { const r = await f(u, o); const l = r.headers.get('x-glideshow-load'); if (l) setLoad(l); return r; }; }
if ($('#ed-load-close')) $('#ed-load-close').onclick = () => { $('#ed-load-bar').hidden = true; };

(async () => {
  [BASE_CSS, SHAPES_JS, PRESENT_JS] = await Promise.all(['/editor/deck/base.css', '/editor/deck/shapes.js', '/editor/deck/present.js'].map(u => fetch(u, { cache: 'no-store' }).then(r => r.text())));
  fit();
  addEventListener('resize', fit);
  await load(false);
  setStatus('');
  const startTheme = new URLSearchParams(location.search).get('theme');   // the home screen's template gallery
  if (startTheme) { const t = THEMES.find(x => x.name === startTheme); if (t) setTheme({ ...t }); history.replaceState(null, '', '/edit'); }
  watchChanges();
  if (window.GLIDESHOW_CLOUD && !/** @type {any} */ (window.GLIDESHOW_CLOUD).local) live();   // (a library kept in the browser has no server to hold one)
})();
/* The deck was saved elsewhere (another editor, an agent, the Mac): take it in. While this editor is mid-gesture or
   typing, after that; with changes of its own not yet saved, merged with them (storage.js mergeIn). */
function remoteVersion(v, by = '', both = null) {   // both: slides where a library's merge kept this side's version over theirs
  if (!v || v === mtime || saving) return;
  remoteBy = by;
  if (busy || editing) { pendingReload = true; setStatus('Changed elsewhere: bringing it in after this edit', 'sync'); return; }
  (unsaved() || saveTimer ? (clearTimeout(saveTimer), saveTimer = null, mergeIn().then(() => scheduleSave())) : load(true, true)).then(() => { if (presenting()) refreshPresent(); if (both?.length) mergeNote(both, by); });
}
/* On glideshow.org a save anywhere reaches every open editor of the deck at once, over a WebSocket (cloud/library.js);
   the 8 s poll of /api/events stays for what comes from GitHub or Drive. */
let liveSocket = null;
function live(wait = 1000) {
  try { liveSocket?.close(); } catch {}
  const ws = liveSocket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`);
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.you) { meId = m.you; hereKey = ''; sendHere(); }   // who else is here: people.js
    if (m.people) setPeople(m.people);
    if (m.v) remoteVersion(m.v, m.by || '', m.both || null);
  };
  ws.onopen = () => { if (wait > 1000) checkChanges(); wait = 1000; };   // back after a break: anything missed meanwhile
  ws.onclose = ev => { if (ev.code === 4429) setLoad('paused'); if (ws === liveSocket && loadLevel !== 'paused') { setPeople([]); setTimeout(() => live(Math.min(wait * 2, 30000)), wait); } };
}
