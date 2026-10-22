/* Spelling: the browser's own spellcheck underlines words while editing text and notes (Tools → Spelling). */
const spellOn = () => stored('slides-spellcheck') !== 'off';
function setSpelling(on) {
  store('slides-spellcheck', on ? undefined : 'off');
  $('#ed-notes').spellcheck = on;
  if (editing) { const c = content(editing); c.spellcheck = on; c.blur(); c.focus(); }   // re-focus redraws the underlines
}
$('#ed-notes').spellcheck = spellOn();

/* The filmstrip has keyboard focus after a thumbnail click, until something else is clicked. */
thumbs.tabIndex = -1;
const filmFocused = () => document.activeElement === thumbs;

/* ⌃⇧F hides the title and menu rows (Slides' compact controls). */
function toggleCompact() { document.body.classList.toggle('compact'); fit(); }

/* ⌘S: saving is automatic; flush any pending save and confirm it, as Slides does. */
async function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); await save(); } else setStatus('All changes saved', 'cloud_done');
  $('#ed-status').classList.remove('flash'); void $('#ed-status').offsetWidth; $('#ed-status').classList.add('flash');
}
/* ⌘P: reveal's PDF print layout in a new tab, then the browser's print dialog. */
/* File → Download → PNG image: the current slide at 1920×1080, drawn by the browser itself (the slide's HTML and the
   deck's CSS inside an SVG foreignObject, pictures inlined as data URLs). Web fonts fall back to system fonts. */
const toDataURL = async src => { try { const b = await (await fetch(src)).blob(); return await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }); } catch { return src; } };
async function slidePNG(s = slides[cur]) {
  const c = s.cloneNode(true);
  c.querySelectorAll('[contenteditable]').forEach(e => e.removeAttribute('contenteditable'));
  c.querySelectorAll('aside.notes, .katex-mathml').forEach(e => e.remove());   // notes aren't drawn; KaTeX's MathML twin is only for screen readers
  c.querySelectorAll('iframe').forEach(f => f.replaceWith(Object.assign(div(''), { style: 'width:100%;height:100%;background:#f1f3f4' })));
  for (const img of c.querySelectorAll('img')) img.setAttribute('src', await toDataURL(img.src));
  for (const v of c.querySelectorAll('video')) { const p = v.getAttribute('poster'); v.replaceWith(Object.assign(document.createElement('img'), { src: p ? await toDataURL(new URL(p, location.href).href) : '', style: 'width:100%;height:100%;object-fit:contain;background:#000' })); }
  const bg = s.dataset.backgroundImage ? await toDataURL(new URL(s.dataset.backgroundImage, location.href).href) : '';
  c.style.cssText += `;position:absolute;left:0;top:0;width:${W}px;height:${H}px;display:block;background:${s.dataset.backgroundColor || '#fff'}${bg ? ` url("${bg}") center/cover` : ''}`;
  const css = BASE_CSS + '\n' + $('#ed-deck-theme-live').textContent;
  const NS = 'http://www.w3.org/1999/xhtml', root = document.createElementNS(NS, 'div'), st = document.createElementNS(NS, 'style'), box = document.createElementNS(NS, 'div');
  root.className = 'reveal'; root.style.cssText = `width:${W}px;height:${H}px;font-family:Arial,sans-serif`;
  const katexCSS = c.querySelector('.katex') ? await fetch(document.querySelector('link[href*="katex"]')?.href || 'data:,').then(r => r.text()).catch(() => '') : '';   // its layout (fonts fall back)
  st.textContent = BASE_CSS + '\n' + $('#ed-deck-theme-live').textContent + '\n' + katexCSS;   // the serializer escapes it for XML
  box.className = 'slides'; box.style.cssText = `position:relative;width:${W}px;height:${H}px`; box.append(c); root.append(st, box);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(root)}</foreignObject></svg>`;
  const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const cv = Object.assign(document.createElement('canvas'), { width: W, height: H }); cv.getContext('2d').drawImage(img, 0, 0);
  return new Promise(r => cv.toBlob(r, 'image/png'));
}
async function downloadSlidePNG() {
  const blob = await slidePNG(), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${($('#ed-title').value.trim() || 'slide').replace(/[^\w -]+/g, '')} - ${cur + 1}.png`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('#ed-app-icon').onclick = async e => { e.preventDefault(); await flushSave(); if (!draftEdited()) return leaveDraft(); showDraftDlg(true); };
/* Leaving an untitled draft: it won't be saved, so ask, as Slides asks before discarding. */
const draftDlg = $('#ed-draftdlg');
function showDraftDlg(on) { draftDlg.hidden = !on; if (on) $('#ed-draft-name').focus(); }
async function leaveDraft() { if (isDraft) await fetch('/api/discard', { method: 'POST' }).catch(() => {}); location.href = '/'; }
$('#ed-draft-discard').onclick = () => leaveDraft();
$('#ed-draft-name').onclick = () => { showDraftDlg(false); $('#ed-title').focus(); };
draftDlg.querySelector('.sc-close').onclick = () => showDraftDlg(false);
addEventListener('beforeunload', e => { if (draftEdited()) e.preventDefault(); });   // the browser's own "Leave site?" when closing the window

async function trashDeck() {   // File → Move to trash: the server opens another deck first, then the home screen shows what's left
  if (!confirm('Move this deck to the Trash?')) return;
  await flushSave();
  const j = await (await fetch('/api/deckop', { method: 'POST', body: JSON.stringify({ path: deckPath, op: 'delete' }) })).json();
  if (j.error) return setStatus(j.error, 'error');
  location.href = '/';
}
/* File → Version history, as Slides: the deck's git commits (all, or only those that changed this slide); clicking one
   shows that version read-only in the canvas and filmstrip, "Restore this version" brings it back as a new commit. */
let histView = null, histRev = null, histList = [];   // while previewing: the real slides, and the version shown
if ($('#ed-merge-bar')) {   // (a page from before the bar, kept by a cache, has none)
  $('#ed-merge-close').onclick = () => { $('#ed-merge-bar').hidden = true; };
  $('#ed-merge-history').onclick = () => { $('#ed-merge-bar').hidden = true; showHistory(true); };
}
async function showHistory(on) {
  closeMenu();
  $('#ed-history').hidden = !on;
  if (on) { stopEdit(); fmt.hidden = true; $('#ed-trans').hidden = true; $('#ed-theme').hidden = true; $('#ed-comments').hidden = true; await listHistory(); } else endVersionPreview();
  fit();
}
async function listHistory() {
  const list = histList = await fetch('/api/history' + ($('#ed-hist-scope').value ? `?slide=${(histView?.cur ?? cur) + 1}` : '')).then(r => r.json()).catch(() => []);
  const row = (title, sub, rev, who, url) => { const r = div('hist-row' + ((rev ?? null) === histRev ? ' on' : '')); r.innerHTML = '<b></b><small></small><i class="who"></i>'; r.firstChild.textContent = title; r.children[1].textContent = sub;
    if (who) r.lastChild.textContent = who; else r.lastChild.remove();   // the commit's author, as Slides names the editor
    if (rev) { const m = document.createElement('button'); m.className = 'hist-more icon'; m.textContent = 'more_vert'; m.title = 'More actions';
      m.onclick = e => { e.stopPropagation(); openMenu(m, [{ label: 'Name this version', icon: 'edit', run: () => nameVersion(rev) }, { label: 'Restore this version', icon: 'restore', run: async () => { await previewVersion(rev); $('#ed-hist-restore').click(); } },
        ...(url ? ['-', { label: 'View on GitHub', icon: 'open_in_new', run: () => window.open(url, '_blank', 'noopener') }] : [])]); };   // pushed commits, when origin is on GitHub
      r.append(m); }
    r.onclick = () => rev ? previewVersion(rev) : endVersionPreview(); return r; };
  const fmtT = t => new Date(t * 1000).toLocaleString([], { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  $('#ed-hist-list').replaceChildren(row('Current version', 'what you are editing', null), ...list.map(c => row(c.name || fmtT(c.time), c.name ? `${fmtT(c.time)} · ${c.message}` : c.message, c.rev, c.author, c.url)),

    ...(list.length ? [] : [Object.assign(div('hist-none'), { textContent: 'No saved versions: this deck is not in a git repo (glideshow serve DECK --init).' })]));
  $('#ed-hist-restore').hidden = !histRev;
}
async function previewVersion(rev) {
  const { html } = await fetch('/api/version?rev=' + rev).then(r => r.json());
  if (!histView) histView = { slides, cur };
  histRev = rev; slides = parseSlides(new DOMParser().parseFromString(html, 'text/html'));
  if ($('#ed-hist-highlight').checked && histList[histList.findIndex(c => c.rev === rev) + 1]) {   // Highlight changes: outline what differs from the version before (the first version has none)
    const i = histList.findIndex(c => c.rev === rev), prev = histList[i + 1] ? parseSlides(new DOMParser().parseFromString((await fetch('/api/version?rev=' + histList[i + 1].rev).then(r => r.json())).html, 'text/html')) : [];
    const key = b => cleanBox(b).outerHTML;
    slides.forEach((sl, k) => { const was = new Set(prev[k] ? [...prev[k].querySelectorAll(':scope > .box')].map(key) : []);
      sl.querySelectorAll(':scope > .box').forEach(b => { if (!was.has(key(b))) b.classList.add('hist-changed'); }); });
  }
  cur = Math.min(histView.cur, slides.length - 1); sel.clear(); document.body.classList.add('history-mode'); render(); listHistory();
}
function endVersionPreview() {
  if (!histView) return;
  ({ slides, cur } = histView); histView = histRev = null; document.body.classList.remove('history-mode'); render(); if (!$('#ed-history').hidden) listHistory();
}
$('#ed-hist-close').onclick = () => showHistory(false);
$('#ed-hist-scope').onchange = listHistory;
$('#ed-hist-highlight').onchange = () => histRev && previewVersion(histRev);
async function nameVersion(rev) {
  const c = histList.find(x => x.rev === rev), name = prompt('Name this version', c?.name || '');
  if (name === null) return;
  await fetch('/api/name', { method: 'POST', body: JSON.stringify({ rev, name }) }); listHistory();
}
$('#ed-hist-restore').onclick = async () => {
  const rev = histRev; endVersionPreview(); await flushSave();
  const j = await (await fetch('/api/restore', { method: 'POST', body: JSON.stringify({ rev }) })).json();
  if (j.error) return setStatus(j.error, 'error');
  await load(true); setStatus('Version restored', 'history'); listHistory();
};
/* File → Download → Glideshow deck (.html): the deck as one file, pictures and reveal.js inside (lib/onefile.js), that opens
   and presents in any browser; File → Open a deck file… brings one back (online: lib/library.js /api/importdeck). */
const ONEFILE = '/editor/lib/onefile.js';   // an ES module, loaded when needed
async function downloadOneFile() {
  await flushSave(); setStatus('Making the file…', 'download');
  const { pack } = await import(ONEFILE);
  const html = await pack(deckHTML(), async p => { const r = await fetch(p); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; });   // relative to the deck (<base>)
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = ($('#ed-title').value.trim() || deckName()).replace(/[\\/:*?"<>|]+/g, '-') + '.html';
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  setStatus('Downloaded: open the file in any browser to present it', 'download');
}
function openDeckFile() {
  const pick = Object.assign(document.createElement('input'), { type: 'file', accept: '.html,.htm,text/html' });
  pick.onchange = async () => {
    const f = pick.files?.[0]; if (!f) return;
    setStatus('Bringing the deck in…', 'upload_file');
    const { unpack, bringIn } = await import(ONEFILE), { html, files } = await unpack(await f.text());
    if (!/<section[\s>]/.test(html)) return setStatus("That file isn't a slide deck.", 'error');
    const j = await bringIn({ name: f.name.replace(/\.html?$/i, ''), folder: deckPath.split('/').slice(0, -1).join('/'), html, files });
    if (j.error) return setStatus(j.error, 'error');
    await switchDeck({ path: j.path });
  };
  pick.click();
}
async function switchDeck(req) {
  await flushSave();
  const j = await (await fetch('/api/open', { method: 'POST', body: JSON.stringify(req) })).json();
  if (j.error) return setStatus(j.error, 'error');
  location.reload();
}
let deckPath = '';
const deckName = () => deckPath.split('/').pop() || 'deck';
fetch('/api/recent').then(r => r.json()).then(l => { deckPath = l.find(d => d.current)?.path || ''; }).catch(() => {});
/* File → Page setup, as Slides: 16:9, 16:10, 4:3 or a custom size in inches (192 px each; the width stays 10 in for the
   presets). Stored as data-size="WxH" on the deck's .slides (absent = 1920x1080); objects keep their positions. */
const PAGE_SIZES = [['16:9', 1920, 1080], ['16:10', 1920, 1200], ['4:3', 1920, 1440]];
function applySize() {
  const m = (deckDoc?.querySelector('.slides')?.dataset.size || '').match(/^(\d+)x(\d+)$/);
  [W, H] = m ? [+m[1], +m[2]] : [1920, 1080];
  const r = document.documentElement.style;
  r.setProperty('--slide-w', W + 'px'); r.setProperty('--slide-h', H + 'px'); r.setProperty('--slide-ar', `${W} / ${H}`);
}
function setPageSize(w, h) {
  const el = deckDoc.querySelector('.slides');
  if (w === 1920 && h === 1080) delete el.dataset.size; else el.dataset.size = `${Math.round(w)}x${Math.round(h)}`;
  applySize(); fit(); thumbEpoch++; render(); scheduleSave();
}
function pageSetup() {
  const cur = PAGE_SIZES.find(([, w, h]) => w === W && h === H)?.[0] || 'custom';
  askURL('Page setup: 16:9, 16:10, 4:3, or width x height in inches (e.g. 10 x 7.5)', v => {
    const p = PAGE_SIZES.find(([n]) => n === v.trim()), m = v.match(/^\s*([\d.]+)\s*[x×]\s*([\d.]+)\s*$/);
    if (p) setPageSize(p[1], p[2]); else if (m && +m[1] > 0 && +m[2] > 0) setPageSize(+m[1] * 192, +m[2] * 192); else setStatus('Page size: 16:9, 16:10, 4:3 or W x H inches', 'error');
  }, cur === 'custom' ? `${W / 192} x ${H / 192}` : String(cur));
}
/* File → Import slides (or drop a .pptx on the slide): the server converts it with pptx_import.py and the slides
   are added after the current one. */
async function importPPTX(file) {
  setStatus('Importing ' + file.name + '…');
  const j = await (await fetch('/api/importpptx', { method: 'POST', body: file })).json();
  insertImported(j, file.name);
}
/* File → Import from Google Slides: the server fetches the deck through the Slides API (after `glideshow import-google --login`)
   and converts it; pictures land in assets/. Google Fonts the deck uses are added to #deck-fonts. */
async function importGoogle(url) {
  setStatus('Importing from Google Slides…');
  const j = await (await fetch('/api/importgslides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })).json();
  if (!j.error && j.fonts?.length) await fontsReady().then(() => j.fonts.forEach(useGFont));
  insertImported(j, j.title || 'Google Slides');
}
function insertImported(j, label) {
  if (j.error) return setStatus('Import failed: ' + j.error.split('\n')[0], 'error');
  const t = document.createElement('template'); t.innerHTML = j.slides.join('');
  const added = [...t.content.children].filter(e => e.tagName === 'SECTION');
  added.forEach(s => s.querySelectorAll('.box').forEach(b => { b.id ||= uid(); }));
  slides.splice(cur + 1, 0, ...added); go(cur + 1); commit();
  setStatus(`Imported ${added.length} slide${added.length === 1 ? '' : 's'} from ${label}` + (j.log?.length ? ` (${j.log.length} to check: see the terminal)` : ''));
  if (j.log?.length) console.warn('Google Slides import:\n' + j.log.join('\n'));
}
$('#ed-pptx-file').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importPPTX(f); };
async function printDeck() {
  if (saveTimer) { clearTimeout(saveTimer); await save(); }
  const w = window.open('deck.html?print-pdf', '_blank');
  // print once reveal has laid out the pages and the fonts (KaTeX, Google Fonts, icons) are in; 4 s at most
  w?.addEventListener('load', () => {
    let done = false; const go = () => { if (!done) { done = true; w.document.fonts.ready.then(() => setTimeout(() => w.print(), 300)); } };
    w.Reveal?.on?.('pdf-ready', go); setTimeout(go, 4000);
  });
}

/* Toolbar extras from the fidelity pass: + new slide, print, select tool, Background, hide-menus ^, filmstrip toggle. */
$('#ed-new-slide-btn').onclick = () => $('#ed-new-slide').click();
menuButton($('#ed-new-slide-more'), newSlideItems);

$('#ed-print').onclick = printDeck;
$('#ed-select-tool').onclick = () => { stopEdit(); };
$('#ed-background').onclick = () => showBgDialog(true);
$('#ed-collapse').onclick = toggleCompact;
$('#ed-film-toggle').onclick = () => { document.body.classList.toggle('film-off'); store('slides-film-off', document.body.classList.contains('film-off') ? '1' : undefined); fit(); };
if (stored('slides-film-off')) document.body.classList.add('film-off');

/* Share (the button beside Slideshow, or File → Share): a link to the deck at glideshow.org/p/… (an entry in the library's
   published.json; `glideshow publish`) that always shows its latest version; turning it off takes it down. Who can open it: anyone with the link, or only the people listed (they sign in with Google or GitHub);
   it can expire on a date. */
const shareDlg = $('#ed-sharedlg');
async function showShare(on = true) {
  closeMenu(); shareDlg.hidden = !on; if (!on) return;
  $('#ed-share-title').textContent = deckDoc?.title || 'Untitled deck';
  shareState(await fetch('/api/publish').then(r => r.json()).catch(() => ({ url: '' })));
}
function shareState({ url = '', inLibrary = true, error = '', busy = '', access = 'link', people = [], editors = [], expires = '' }) {
  $('#ed-share-on').checked = !!url; $('#ed-share-on').disabled = !!busy || !inLibrary;
  $('#ed-share-accessrow').hidden = !url; $('#ed-share-access').value = access; $('#ed-share-peoplerow').hidden = access !== 'people';
  if (document.activeElement !== $('#ed-share-people')) { peopleField.list = people.slice(); peopleField.draw(); }
  if (document.activeElement !== $('#ed-share-editors')) { editorsField.list = editors.slice(); editorsField.draw(); }
  $('#ed-share-expires').value = expires; $('#ed-share-noexp').hidden = !expires;
  $('#ed-share .icon').textContent = !url ? 'lock' : access === 'people' ? 'group' : 'public';
  $('#ed-share-linkrow').hidden = !url; $('#ed-share-url').value = url;
  $('#ed-share').classList.toggle('on', !!url);
  const st = $('#ed-share-status'); st.classList.toggle('err', !!error);
  st.textContent = error || busy || (!inLibrary ? (window.GLIDESHOW_CLOUD ? 'Give the presentation a title first.' : 'Only decks in your library (~/decks) can be shared.') : '');
}
async function publishDeck(op) {
  await flushSave();
  shareState({ url: op === 'unpublish' ? '' : $('#ed-share-url').value, busy: op === 'unpublish' ? 'Taking it down…' : 'Sharing…' });
  const j = await fetch('/api/publish', { method: 'POST', body: JSON.stringify({ op }) }).then(r => r.json()).catch(e => ({ error: String(e) }));
  shareState(j.error ? { url: op === 'unpublish' ? $('#ed-share-url').value : '', error: j.error } : j);
  if (j.url && op === 'publish') $('#ed-share-status').textContent = j.access === 'people' ? 'Shared: the people listed can open it.' : 'Shared: anyone with the link can view it.';
}
/* Who can open it, and until when: the link stays the same. Changes go one at a time, in order (picking "Only people I
   add" and then typing the names are two), so an earlier one never lands last; "Saved." waits for the last of them. */
let shareQueue = Promise.resolve(), sharePending = 0;
function shareSettings(change) {
  sharePending++; $('#ed-share-status').classList.remove('err'); $('#ed-share-status').textContent = 'Saving…';
  return (shareQueue = shareQueue.then(async () => {
    const j = await fetch('/api/publish', { method: 'POST', body: JSON.stringify({ op: 'settings', ...change }) }).then(r => r.json()).catch(e => ({ error: String(e) }));
    const last = !--sharePending;
    if (j.error || last) shareState(j.error ? { url: $('#ed-share-url').value, error: j.error } : j);
    if (!j.error && last) $('#ed-share-status').textContent = 'Saved.';
  }));
}
$('#ed-share-access').onchange = e => { peopleField.take(); shareSettings({ access: e.target.value, people: peopleField.list.join(', ') }); };
/* People, each a pill (Who can open it, and Can edit): Enter, a comma, a space, Tab, a pasted list or leaving the field
   turns what's typed into pills; a pill's × or Backspace in the empty field takes one off. Each change is saved at once.
   Something that isn't an email address, @domain or GitHub username is kept, outlined red, so it can be seen and removed. */
const PERSON = /^(@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}|[^\s@,;]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}|[a-z0-9](-?[a-z0-9]){0,38})$/i;
function pillField(boxSel, inputSel, save, empty) {
  const box = $(boxSel), input = $(inputSel), f = { list: /** @type {string[]} */ ([]), draw, take };
  function draw() {
    box.querySelectorAll('.person').forEach(c => c.remove());
    f.list.forEach((who, i) => {
      const chip = div('person' + (PERSON.test(who) ? '' : ' bad')), x = document.createElement('button');
      chip.append(Object.assign(document.createElement('span'), { textContent: who }));
      chip.title = PERSON.test(who) ? who : `${who}: not an email address, @domain or GitHub username`;
      x.className = 'icon'; x.type = 'button'; x.textContent = 'close'; x.title = `Remove ${who}`;
      x.onmousedown = e => e.preventDefault();   // the field keeps focus (and what's half typed in it)
      x.onclick = e => { e.stopPropagation(); f.list.splice(i, 1); draw(); save(); input.focus(); };
      chip.append(x); box.insertBefore(chip, input);
    });
    input.placeholder = f.list.length ? 'Add another' : empty;
  }
  /** What's typed into the field, as pills. @returns {boolean} whether the list changed */
  function take() {
    const typed = input.value.split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
    if (!typed.length) return false;   // (no redraw: a click on a pill's × is under way when the field loses focus)
    input.value = '';
    const before = f.list.length;
    for (const who of typed) if (!f.list.includes(who)) f.list.push(who);
    draw(); return f.list.length !== before;
  }
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (['Enter', ',', ';', ' ', 'Tab'].includes(e.key) && input.value.trim()) { if (e.key !== 'Tab') e.preventDefault(); if (take()) save(); }
    else if (e.key === 'Backspace' && !input.value && f.list.length) { e.preventDefault(); f.list.pop(); draw(); save(); }
  });
  input.addEventListener('paste', () => setTimeout(() => { if (/[\s,;]/.test(input.value) && take()) save(); }));
  input.addEventListener('blur', () => { if (take()) save(); });
  box.addEventListener('mousedown', e => { if (e.target === e.currentTarget) { e.preventDefault(); input.focus(); } });
  return f;
}
const peopleField = pillField('#ed-share-chips', '#ed-share-people', () => shareSettings({ people: peopleField.list.join(', ') }), 'Emails, @harvard.edu for everyone there, or GitHub usernames');
const editorsField = pillField('#ed-share-echips', '#ed-share-editors', () => shareSettings({ editors: editorsField.list.join(', ') }), 'Emails, @domain or GitHub usernames of people who can edit');
$('#ed-share-expires').onchange = e => shareSettings({ expires: e.target.value });
$('#ed-share-noexp').onclick = () => shareSettings({ expires: '' });
$('#ed-share').onclick = () => showShare(true);
$('#ed-share-on').onchange = e => publishDeck(e.target.checked ? 'publish' : 'unpublish');
$('#ed-share-copy').onclick = async () => { await navigator.clipboard?.writeText($('#ed-share-url').value).catch(() => {}); $('#ed-share-url').select(); $('#ed-share-status').textContent = 'Link copied.'; };

$('#ed-share-done').onclick = shareDlg.querySelector('.sc-close').onclick = () => showShare(false);
shareDlg.addEventListener('pointerdown', e => { if (e.target === shareDlg) showShare(false); });
addEventListener('keydown', e => { if (!shareDlg.hidden && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); showShare(false); } }, true);
