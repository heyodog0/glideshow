/* ---------- clipboard, drop, keyboard ---------- */

const inField = t => t?.closest?.('input, select, textarea, #ed-notes');

/* Slides, as Slides: ⌘C / ⌘X with the filmstrip focused copy the selected slides; ⌘V pastes them after the current one
   (with the filmstrip or the slide focused). Their files go along by the deck they came from (/library/<id>/…): pasted
   into another deck, each picture or video is copied into it. */
const slideClip = () => SLIDE_CLIP + JSON.stringify({ deck: deckId, slides: (picked.size ? pickedIdx() : [cur]).map(i => sectionHTML(slides[i], true)) });
addEventListener('copy', e => {
  if (!editing && !inField(e.target) && filmFocused()) { e.clipboardData.setData('text/plain', slideClip()); e.preventDefault(); return; }
  if (editing || inField(e.target) || !sel.size) return;
  e.clipboardData.setData('text/plain', CLIP + JSON.stringify([...sel].map(b => cleanBox(b).outerHTML)));
  e.preventDefault();
});
addEventListener('cut', e => {
  if (!editing && !inField(e.target) && filmFocused()) { e.clipboardData.setData('text/plain', slideClip()); e.preventDefault(); deleteSlides(); return; }
  if (editing || inField(e.target) || !sel.size) return;
  e.clipboardData.setData('text/plain', CLIP + JSON.stringify([...sel].map(b => cleanBox(b).outerHTML)));
  e.preventDefault();
  deleteSelection();
});
async function pasteSlides(json) {
  let clip; try { clip = JSON.parse(json); } catch { return; }
  const t = document.createElement('template'), from = clip.deck && clip.deck !== deckId ? clip.deck : '';
  const made = new Map();   // a file of the other deck → its copy here
  const bring = async src => {   // a file of the deck the slides came from, copied into this one
    if (!from || !src || /^(data|blob|https?):|^\//i.test(src)) return src;
    if (!made.has(src)) made.set(src, (async () => {
      const r = await fetch(`/library/${from}/${src.replace(/[?#].*$/, '')}`); if (!r.ok) return src;
      const ext = (src.match(/\.(\w+)(?:[?#]|$)/) || [])[1] || 'bin';
      return (await (await fetch('/api/upload?ext=' + ext, { method: 'POST', body: await r.blob() })).json()).src || src;
    })());
    return made.get(src);
  };
  if (from) setStatus('Copying the slides\u2019 pictures…', 'sync');
  const copies = [];
  for (const h of clip.slides || []) {
    t.innerHTML = h; const s = t.content.querySelector('section'); if (!s) continue;
    s.removeAttribute('data-sid'); s.removeAttribute('data-ed-stack');
    boxes(s).forEach(b => { b.id = uid(); });
    for (const el of s.querySelectorAll('[src], [poster]')) for (const a of ['src', 'poster']) { const v = el.getAttribute(a); if (v) el.setAttribute(a, await bring(v)); }
    for (const el of s.querySelectorAll('[style*="url("]')) {
      let st = el.getAttribute('style');
      for (const m of [...st.matchAll(/url\((['"]?)([^'")]+)\1\)/g)]) st = st.replace(m[2], await bring(m[2]));
      el.setAttribute('style', st);
    }
    copies.push(s);
  }
  if (!copies.length) return;
  slideOp(() => {
    const at = (picked.size ? Math.max(...pickedIdx()) : cur) + 1;
    slides.splice(at, 0, ...copies); cur = slides.indexOf(copies.at(-1)); picked = new Set(copies);
  });
  setStatus(`Pasted ${copies.length} slide${copies.length > 1 ? 's' : ''}`, 'content_paste');
}
/* Pasted HTML keeps its formatting (⇧⌘V pastes plain text instead), minus anything active or structural. */
let plainPaste = false;
function cleanPastedHTML(html) {
  const t = document.createElement('template'); t.innerHTML = html;
  t.content.querySelectorAll('script, style, meta, link, title, iframe, object, embed, form, input, button').forEach(e => e.remove());
  t.content.querySelectorAll('*').forEach(e => [...e.attributes].forEach(a => { if (!['style', 'href'].includes(a.name)) e.removeAttribute(a.name); }));
  return t.innerHTML;
}
addEventListener('paste', async e => {
  const plain = plainPaste; plainPaste = false;
  if (inField(e.target) && !editing) return;
  const cd = e.clipboardData;
  // A file copied in Finder sometimes shows up only in `items`, not in `files`.
  let files = [...cd.files];
  if (!files.length) files = [...cd.items].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
  files = files.filter(f => f.type.startsWith('image/') || isVideoFile(f));
  if (files.length) {
    e.preventDefault(); stopEdit();
    for (const f of files) await (isVideoFile(f) ? addVideo(f) : addImage(f));
    return;
  }
  const text = e.clipboardData.getData('text/plain'), html = e.clipboardData.getData('text/html');
  e.preventDefault();
  if (text.startsWith(SLIDE_CLIP)) { stopEdit(); await pasteSlides(text.slice(SLIDE_CLIP.length)); return; }   // slides, even while typing
  if (editing) {
    if (html && !plain) document.execCommand('insertHTML', false, cleanPastedHTML(html));
    else document.execCommand('insertText', false, text);
    fitHeight(editing);
    return;
  }
  if (text.startsWith(CLIP)) {
    const t = document.createElement('template');
    const taken = boxes().map(geo);
    const pasted = JSON.parse(text.slice(CLIP.length)).map(h => {
      t.innerHTML = h;
      const b = t.content.firstElementChild;
      b.id = uid();
      const g = geo(b);
      while (taken.some(o => o.x === g.x && o.y === g.y)) { g.x += 30; g.y += 30; }
      setGeo(b, g);
      return b;
    });
    insert(...pasted);
  } else if (/^https?:\/\/\S+$/.test(text.trim())) {   // a pasted web address: insert the picture it points to (fetched into assets/), as Slides
    const url = text.trim(); setStatus('Fetching image…');
    const r = await fetch('/api/fetch', { method: 'POST', body: JSON.stringify({ url }) }).then(r => r.json()).catch(() => ({}));
    setStatus('');
    if (r.src) await addImageSrc(r.src); else addText(url);
  } else if (text.trim()) {
    addText(text.trim());
  }
});

stage.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('drop-hint'); });
stage.addEventListener('dragleave', () => document.body.classList.remove('drop-hint'));
stage.addEventListener('drop', async e => {
  e.preventDefault(); document.body.classList.remove('drop-hint');
  const at = toCanvas(e);
  for (const f of [...e.dataTransfer.files].filter(f => f.type.startsWith('image/') || isVideoFile(f))) await (isVideoFile(f) ? addVideo(f, at) : addImage(f, at));
  for (const f of [...e.dataTransfer.files].filter(f => /\.pptx$/i.test(f.name))) await importPPTX(f);
  for (const f of [...e.dataTransfer.files].filter(f => /\.(ttf|otf|woff2?)$/i.test(f.name))) {   // a font file: into the deck, and onto the selection
    const fam = await useFontFile({ query: 'name=' + encodeURIComponent(f.name), body: f });
    if (fam && sel.size) setFont(`'${fam}', sans-serif`);
  }
});

function deleteSelection() {
  if (!sel.size || anyLocked()) return;
  sel.forEach(b => b.remove()); sel.clear();
  drawOverlay(); commit();
}
function duplicateSelection() {
  if (!sel.size) return;
  insert(...[...sel].map(b => {
    const c = cleanBox(b); c.id = uid();
    const g = geo(b); setGeo(c, { ...g, x: g.x + 30, y: g.y + 30 });
    return c;
  }));
}

addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (mod && e.shiftKey && (e.key === '.' || e.key === ',' || e.key === '>' || e.key === '<') && sel.size) {
    e.preventDefault(); stepSize(/[.>]/.test(e.key) ? 1 : -1); return;
  }
  if (mod && e.shiftKey && (e.code === 'Digit8' || e.code === 'Digit7') && (editing || sel.size === 1)) {
    e.preventDefault(); listText(e.code === 'Digit8' ? 'insertUnorderedList' : 'insertOrderedList'); return;
  }
  if (mod && !(e.metaKey && e.ctrlKey) && !e.shiftKey && k === 'k' && (editing || sel.size === 1)) { e.preventDefault(); linkText(); return; }
  if (mod && e.key === '\\' && sel.size) { e.preventDefault(); clearFormat(); return; }
  if (mod && !e.shiftKey && !e.altKey && !(e.metaKey && e.ctrlKey) && (k === 'b' || k === 'i' || k === 'u') && (editing || sel.size)) {   // ⌘B ⌘I ⌘U, selection or whole boxes (⌃⌘B / ⌃⌘I resize)
    e.preventDefault();
    ({ b: $('#ed-bold'), i: $('#ed-italic'), u: $('#ed-underline') })[k].click();
    return;
  }
  if (mod && e.shiftKey && 'lerj'.includes(k) && k && sel.size) { e.preventDefault(); setAlign({ l: 'left', e: 'center', r: 'right', j: 'justify' }[k]); return; }
  if (mod && e.shiftKey && k === 'x' && sel.size) { e.preventDefault(); strike(); return; }
  if (mod && !e.shiftKey && (e.key === '.' || e.key === ',') && sel.size) { e.preventDefault(); (e.key === '.' ? superscript : subscript)(); return; }
  if (mod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && sel.size && !editing) { e.preventDefault(); (e.key === 'ArrowUp' ? toFront : toBack)(); return; }
  if (mod && e.shiftKey && !e.altKey && k === 'm' && !editing) { e.preventDefault(); newSlideBelow(); return; }   // ⇧⌘M
  if (((mod && !e.ctrlKey) || (e.ctrlKey && !e.metaKey)) && !e.shiftKey && !e.altKey && k === 'm' && !editing) { e.preventDefault(); $('#ed-new-slide').click(); return; }   // Slides on Mac: ⌃M (⌘M too)
  if (mod && e.altKey && !e.shiftKey && e.code === 'KeyC') { e.preventDefault(); copyFormat(); return; }
  if (mod && e.altKey && !e.shiftKey && e.code === 'KeyV') { e.preventDefault(); pasteFormat(); return; }
  if (mod && e.shiftKey && !e.altKey && k === 'v' && (editing || !inField(e.target))) {   // ⇧⌘V: Chrome on Mac has no such key (its own is ⌥⇧⌘V), so read the clipboard
    e.preventDefault();
    navigator.clipboard?.readText().then(t => { plainPaste = true; const ev = new Event('paste', { bubbles: true }); ev.clipboardData = { files: [], items: [], getData: f => f === 'text/plain' ? t : '' }; (editing || document.body).dispatchEvent(ev); }).catch(() => {});
    return;
  }

  if (mod && e.altKey && e.shiftKey && e.code === 'KeyB') { e.preventDefault(); setTransPanel($('#ed-trans').hidden); return; }
  if (mod && e.altKey && e.shiftKey && e.code === 'KeyS') { e.preventDefault(); setNotesVisible(document.body.classList.contains('notes-off')); return; }
  if (e.ctrlKey && e.shiftKey && !e.metaKey && e.code === 'KeyF') { e.preventDefault(); toggleCompact(); return; }
  if (mod && !e.shiftKey && !e.altKey && k === 's') { e.preventDefault(); saveNow(); return; }
  if (mod && !e.shiftKey && !e.altKey && k === 'p') { e.preventDefault(); printDeck(); return; }
  if (mod && e.key === 'Enter') { e.preventDefault(); present(e.shiftKey ? 0 : cur); return; }
  if (mod && ((k === 'f' && !e.shiftKey) || (k === 'h' && e.shiftKey))) { e.preventDefault(); openFind(); return; }
  if (mod && e.altKey && e.code === 'KeyX') { e.preventDefault(); setSpelling(!spellOn()); return; }
  if (mod && e.altKey && e.shiftKey && e.code === 'KeyF') { e.preventDefault(); stopEdit(); thumbs.focus({ preventScroll: true }); return; }   // move to filmstrip
  if (mod && e.key === '/') { e.preventDefault(); showShortcuts(shortcutsDlg.hidden); return; }
  if (mod && e.shiftKey && e.code === 'Digit0') { e.preventDefault(); e.altKey ? zoomToContent() : zoomToSelection(); return; }   // Keynote: ⇧⌘0 / ⌥⇧⌘0
  if (mod && !e.altKey && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
    e.preventDefault(); e.key === '0' ? setZoom(null) : zoomStep(e.key === '-' ? -1 : 1); return;
  }
  if (mod && !e.shiftKey && (e.key === ']' || e.key === '[') && (editing || sel.size)) { e.preventDefault(); indentText(e.key === ']' ? 1 : -1); return; }
  if (editing && e.key === 'Tab' && e.altKey && !e.shiftKey && !cellAt()) {   // ⌥Tab: a tab character, to the next tab stop (Tab stays Slides' indent)
    e.preventDefault(); const s = getSelection(); if (!s.rangeCount) return;
    const r = s.getRangeAt(0); r.deleteContents(); const t = document.createElement('span'); t.className = 'tb'; t.contentEditable = 'false'; t.textContent = '\t';
    r.insertNode(t); r.setStartAfter(t); r.collapse(true); s.removeAllRanges(); s.addRange(r); lastRange = r.cloneRange(); fitTabs(editing); fitHeight(editing); return;
  }
  if (editing && e.key === 'Tab' && !cellAt()) { e.preventDefault(); indentText(e.shiftKey ? -1 : 1); return; }
  if (editing) {
    if ((e.key === 'Backspace' || e.key === 'Delete') && cellSel.size > 1) { e.preventDefault(); cellSel.forEach(td => td.replaceChildren()); fitHeight(editing); return; }   // empty the picked cells
    if (e.key === 'Tab' && cellAt()) {   // Tab / ⇧Tab: next / previous cell; Tab in the last cell adds a row
      e.preventDefault();
      const cells = [...cellAt().closest('table').querySelectorAll('td, th')], i = cells.indexOf(cellAt()) + (e.shiftKey ? -1 : 1);
      if (i >= cells.length) { tableOp('row-below', cells.at(-1)); const t = cells[0].closest('table'); focusCell(t.rows[t.rows.length - 1].cells[0]); }
      else if (i >= 0) focusCell(cells[i]);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && getSelection().anchorNode?.parentElement?.closest('pre')) { e.preventDefault(); document.execCommand('insertText', false, '\n'); return; }   // a new line inside a code block
    if (e.key === 'Enter' && editing.dataset.shape === 'wordart') { e.preventDefault(); const b = editing; stopEdit(); sel = new Set([b]); drawOverlay(); return; }   // word art is one line
    if (e.key === 'Escape') { e.preventDefault(); const b = editing; stopEdit(); if (b.isConnected) { sel = new Set([b]); drawOverlay(); } }
    if ((e.key === 'PageDown' || e.key === 'PageUp') && !mod) { e.preventDefault(); stopEdit(); go(cur + (e.key === 'PageDown' ? 1 : -1)); return; }   // Keynote: next / previous slide while typing
    if (mod && k === 'z' && !e.shiftKey && content(editing).innerHTML === editStart) { e.preventDefault(); undo(); return; }   // nothing typed yet: undo the last move, as Slides
    return;   // everything else is normal typing (⌘B/⌘I/⌘Z work natively)

  }
  if (inField(e.target)) return;
  if (filmFocused() && !e.altKey) {   // the filmstrip has focus: keys act on slides, as Slides
    const step = { ArrowUp: -1, ArrowDown: 1, PageUp: -1, PageDown: 1, ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (mod && /^Arrow/.test(e.key)) { const up = e.key === 'ArrowUp' || e.key === 'ArrowLeft'; e.preventDefault(); moveSlides(e.shiftKey ? (up ? 'start' : 'end') : (up ? 'up' : 'down')); return; }   // ⌘↑ or ⌘←, as Slides' list
    if (!mod && (step || e.key === 'Home' || e.key === 'End')) {
      e.preventDefault();
      const i = e.key === 'Home' ? 0 : e.key === 'End' ? slides.length - 1 : cur + step;
      if (e.shiftKey) extendTo(i); else go(i);
      return;
    }
    if (!mod && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); deleteSlides(); return; }
    if (!mod && e.key === 'Tab') { e.preventDefault(); indentSlides(e.shiftKey ? -1 : 1); return; }   // Keynote: indent / outdent into slide groups
    if (mod && k === 'a') { e.preventDefault(); picked = new Set(slides); slideAnchor = 0; renderThumbs(); return; }
    if (!mod && e.key === 'Enter') { e.preventDefault(); thumbs.blur(); return; }
  }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && !e.shiftKey && !e.altKey && !e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && sel.size) {   // one layer forward / back
    e.preventDefault(); (e.key === 'ArrowUp' ? stepForward : stepBackward)(); return;
  }
  if (e.metaKey && e.ctrlKey && sel.size && RESIZE_KEYS[e.code]) {   // ⌃⌘B/I/K grow, ⌃⌘W/J shrink, from the centre
    e.preventDefault();
    const [dw, dh] = RESIZE_KEYS[e.code];
    sel.forEach(b => { const g = geo(b), w = Math.max(20, g.w + dw), h = Math.max(isLine(b) ? 0 : 20, g.h + dh); setGeo(b, { x: g.x + (g.w - w) / 2, y: g.y + (g.h - h) / 2, w, h }); fitHeight(b); });
    drawOverlay(); commit(); return;
  }
  if (mod && e.altKey && e.code === 'KeyG') { e.preventDefault(); if (e.shiftKey) ungroupSel(); else groupSel(); return; }   // ⌥⌘G / ⇧⌥⌘G
  if (mod && k === 'd') { e.preventDefault(); if (filmFocused()) $('#ed-dup-slide').click(); else duplicateSelection(); return; }
  if (mod && k === 'a') { e.preventDefault(); sel = new Set(pickable()); drawOverlay(); updateToolbar(); return; }
  if (mod && !e.shiftKey && !e.altKey && 'biu'.includes(k) && k && sel.size) {   // whole selected boxes; while editing the browser does it
    e.preventDefault(); $({ b: '#ed-bold', i: '#ed-italic', u: '#ed-underline' }[k]).click(); return;
  }
  if (mod) { if (claimed(e)) e.preventDefault(); return; }   // a Slides key with nothing to act on still never reaches Chrome (⌘I opened Mail)
  if (pointEdit && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); deletePoint(); return; }
  if (pointEdit && e.key === 'Escape') { e.preventDefault(); endPointEdit(); return; }
  if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteSelection(); return; }
  if (cropping && (e.key === 'Escape' || e.key === 'Enter')) { e.preventDefault(); endCrop(); return; }
  if (e.key === 'Escape' && scope && sel.size === 1 && scope.contains([...sel][0])) { e.preventDefault(); sel = new Set([scope]); scope = null; drawOverlay(); updateToolbar(); return; }   // out of the group
  if (e.key === 'Escape') { e.preventDefault(); if (!sel.size) thumbs.focus({ preventScroll: true }); sel.clear(); drawOverlay(); updateToolbar(); return; }   // Esc with nothing selected: to the filmstrip
  if (e.key === 'Enter' && sel.size === 1) { e.preventDefault(); startEdit([...sel][0]); return; }
  if (e.key === 'Tab') {   // select next / previous object, as Slides
    e.preventDefault();
    const all = boxes(); if (!all.length) return;
    const i = sel.size ? all.indexOf([...sel].at(-1)) : (e.shiftKey ? 0 : -1);
    sel = new Set([all[(i + (e.shiftKey ? -1 : 1) + all.length) % all.length]]); drawOverlay(); updateToolbar(); return;
  }
  if (e.altKey && sel.size && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {   // ⌥←/→ rotate 15°, with ⇧ 1°
    e.preventDefault(); if (anyLocked()) return;
    const d = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 15);
    sel.forEach(b => { if (!isLine(b)) setRot(b, rot(b) + d); }); drawOverlay(); commit(); return;
  }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[e.key]) {
    e.preventDefault();
    if (!sel.size) { go(cur + (arrows[e.key][0] || arrows[e.key][1])); return; }
    if (anyLocked()) return;
    const step = e.shiftKey ? 10 : 1, [ax, ay] = arrows[e.key];
    sel.forEach(b => { const g = geo(b); setGeo(b, { ...g, x: g.x + ax * step, y: g.y + ay * step }); });
    drawOverlay(); commit();
  }
  if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); go(cur + (e.key === 'PageDown' ? 1 : -1)); }
});
/* Modifier keys docs/shortcuts.md gives the editor, by e.code; ⌘C / ⌘X / ⌘V / ⌘L / ⌘R / ⌘W stay the browser's. */
const CLAIMED = { meta: 'KeyB KeyI KeyU KeyK KeyD KeyM KeyY KeyZ KeyA KeyS KeyP KeyF Backslash Period Comma BracketLeft BracketRight Slash ArrowUp ArrowDown Enter',
  shift: 'KeyX KeyL KeyE KeyR KeyJ KeyH KeyM Digit7 Digit8 Digit0 Period Comma ArrowUp ArrowDown Enter KeyZ', alt: 'KeyC KeyV KeyG KeyX KeyK', ctrl: 'KeyB KeyI KeyK KeyW KeyJ' };
const claimed = e => (CLAIMED[e.metaKey && e.ctrlKey ? 'ctrl' : e.altKey ? 'alt' : e.shiftKey ? 'shift' : 'meta'] || '').split(' ').includes(e.code);
