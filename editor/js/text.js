/* ---------- text editing ---------- */

/* Enter edit mode. With a point (a double-click), the caret goes there, as Slides; otherwise (Enter, a new
   box) all the text is selected. */
function startEdit(b, pt) {
  if (isMedia(b) || isStroke(b) || isGroup(b) || isLocked(b)) return;
  const who = typingIn(b);   // someone else is typing in it (people.js): theirs until they stop
  if (who) { setStatus(`${who.n} is typing in this box`, 'edit_off'); return; }
  editing = b; sel = new Set([b]);
  const c = content(b);
  unrenderMath(c);   // edit the source
  editStart = c.innerHTML;
  c.contentEditable = 'true'; c.spellcheck = spellOn();
  editFloor = parseFloat(b.dataset.minh) || geo(b).h;
  c.oninput = e => { if (e.inputType === 'insertText' && /^[ \u00a0]$/.test(e.data || '') && latexOn()) latexShortcut(); if (b.dataset.placeholder) markPlaceholder(c); fitHeight(b); };
  c.focus();
  let r = pt && caretAt(pt.x, pt.y);
  if (!r || !c.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(c); }
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  drawOverlay(); updateToolbar();
}
/* LaTeX shortcuts while typing (Tools → Convert LaTeX shortcuts, on unless turned off): after a space, `\alpha` becomes α
   (symbols.js' table), `^2` / `^{10}` a superscript and `_i` / `_{ij}` a subscript; the space stays. */
const latexOn = () => stored('slides-latex') !== '0';
function latexShortcut() {
  const s = getSelection(); if (!s.rangeCount || !s.isCollapsed) return;
  const n = s.anchorNode, o = s.anchorOffset; if (n?.nodeType !== 3) return;
  const t = /** @type {Text} */ (n), before = t.data.slice(0, o - 1), sp = t.data[o - 1];
  let m = before.match(/\\([A-Za-z]+)$/);
  if (m && LATEX_SYMBOLS[m[1]]) {
    t.replaceData(o - 1 - m[0].length, m[0].length, LATEX_SYMBOLS[m[1]]);
    s.collapse(n, o - m[0].length + LATEX_SYMBOLS[m[1]].length); return;
  }
  m = before.match(/([\^_])(?:\{([^{}]+)\}|([A-Za-z0-9+\-=]+))$/);
  if (!m) return;
  const el = document.createElement(m[1] === '^' ? 'sup' : 'sub'); el.textContent = m[2] ?? m[3];
  const tail = t.splitText(o - 1 - m[0].length);   // tail starts at ^ / _
  tail.deleteData(0, m[0].length);                 // tail is now the space and what followed
  tail.before(el);
  s.collapse(tail, 1);
}
function stopEdit() {
  if (!editing) return;
  const b = editing, c = content(b);
  c.removeAttribute('contenteditable'); c.removeAttribute('spellcheck'); c.oninput = null;
  editing = null; lastRange = null;
  getSelection().removeAllRanges();
  if (!b.dataset.shape && !b.dataset.placeholder && !isMedia(b) && !c.textContent.trim() && !c.querySelector('img')) {
    b.remove(); sel.delete(b);   // empty text boxes disappear, as in Google Slides
  }
  if (b.dataset.shape === 'wordart') renderShape(b);   // redraw the outlined text
  c.querySelectorAll('pre code[data-highlighted]').forEach(code => { code.textContent = code.textContent; delete code.dataset.highlighted; code.classList.remove('hljs'); });   // recolour edited code
  highlightCode(c); renderMath(c);
  drawOverlay();
  if (c.innerHTML !== editStart || !b.isConnected) commit(); else { updateToolbar(); maybeReload(); }
}
/* Text boxes grow to fit their text while typing and shrink back, never below the height the
   user dragged (data-minh; for boxes without it, the height at the start of editing). */
/* Text boxes resize to fit their text unless data-autofit="none"; shapes only with data-autofit="resize". */
function fitHeight(b) {
  if (isMedia(b) || isLine(b) || isGroup(b)) return;
  if (b.dataset.autofit === 'shrink') { fitText(b); return; }
  if (b.dataset.shape ? b.dataset.autofit !== 'resize' : b.dataset.autofit === 'none') return;
  const c = content(b), g = geo(b);
  const floor = editing === b ? editFloor : (parseFloat(b.dataset.minh) || g.h);
  c.style.height = 'auto';
  const h = Math.max(floor, c.offsetHeight);
  c.style.height = '';
  if (h !== g.h) { setGeo(b, { ...g, h }); drawOverlay(); }
}
document.addEventListener('selectionchange', () => {
  if (!editing) return;
  const s = getSelection();
  if (s.rangeCount && content(editing).contains(s.anchorNode)) lastRange = s.getRangeAt(0).cloneRange();
});

/* Apply a text style: to the selected characters while editing, otherwise to whole boxes. */
function styleText(cmd, val, whole) {
  const s = editing && editSelection();
  if (s && s.rangeCount && !s.isCollapsed) {
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(cmd, false, val);
    lastRange = s.rangeCount ? s.getRangeAt(0).cloneRange() : lastRange;   // don't wait for selectionchange
    fitHeight(editing);
    return;
  }
  for (const b of sel) { whole(content(b)); fitHeight(b); }
  commit();
}

/* A CSS property on the selected text while editing, else on whole boxes' .content. Each selected run of text takes it
   (its own span, reused when it already has one), so a selection across paragraphs leaves them paragraphs and sizing
   twice doesn't nest spans. A paragraph the selection covers takes it too: an imported paragraph's own font-size
   would otherwise keep its lines as tall as before. */
function spanStyle(prop, value) {
  const s = editing && editSelection();
  if (s && s.rangeCount && !s.isCollapsed) {
    const r = s.getRangeAt(0), c = content(editing);
    const covers = (/** @type {Element} */ el) => {   // no selected-out text before or after it inside el
      const a = document.createRange(), z = document.createRange();
      a.setStart(el, 0); a.setEnd(r.startContainer, r.startOffset); z.setStart(r.endContainer, r.endOffset); z.setEnd(el, el.childNodes.length);
      return !a.toString() && !z.toString();
    };
    const blocks = [...c.querySelectorAll('div, p, li, h1, h2, h3, h4, h5, h6, blockquote')].filter(e => r.intersectsNode(e) && e.textContent && covers(e));
    const parts = /** @type {[Text, number, number][]} */ ([]), it = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    for (let n; (n = /** @type {Text} */ (it.nextNode()));) {
      if (!n.data || !r.intersectsNode(n)) continue;
      const a = n === r.startContainer ? r.startOffset : 0, z = n === r.endContainer ? r.endOffset : n.data.length;
      if (z > a) parts.push([n, a, z]);
    }
    const runs = parts.map(([n, a, z]) => {   // measured first, then split
      if (z < n.data.length) n.splitText(z);
      const t = a ? n.splitText(a) : n, p = /** @type {HTMLElement} */ (t.parentElement);
      if (p !== c && p.tagName === 'SPAN' && p.childNodes.length === 1) { p.style.setProperty(prop, value); return t; }
      const span = document.createElement('span'); span.style.setProperty(prop, value); t.replaceWith(span); span.append(t); return t;
    });
    for (const b of blocks) { b.querySelectorAll('[style]').forEach(e => /** @type {HTMLElement} */ (e).style.removeProperty(prop)); /** @type {HTMLElement} */ (b).style.setProperty(prop, value); }
    c.querySelectorAll('span[style=""]').forEach(e => e.replaceWith(...e.childNodes));
    c.querySelectorAll('[style=""]').forEach(e => e.removeAttribute('style'));
    if (runs.length) { r.setStart(runs[0], 0); r.setEnd(runs.at(-1), runs.at(-1).data.length); }
    s.removeAllRanges(); s.addRange(r); lastRange = r.cloneRange();
    fitHeight(editing); return;
  }
  for (const b of sel) { const c = content(b); if (value) c.style.setProperty(prop, value); else c.style.removeProperty(prop); fitHeight(b); }
  commit();
}
/* Capitalization, as Slides: rewrites the characters (not CSS), on the selection while editing or on whole boxes. */
function recase(mode) {
  const fix = (t, prev) => mode === 'lower' ? t.toLowerCase() : mode === 'upper' ? t.toUpperCase()
    : t.toLowerCase().replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (m, sp, ch, i) => sp + (i === 0 && !sp && /[\p{L}\p{N}'’]$/u.test(prev) ? ch : ch.toUpperCase()));
  const walk = (root, range) => {
    let prev = '';
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = /** @type {Text} */ (it.nextNode()));) {
      if (range && !range.intersectsNode(n)) continue;
      const a = range && n === range.startContainer ? range.startOffset : 0, z = range && n === range.endContainer ? range.endOffset : n.data.length;
      n.data = n.data.slice(0, a) + fix(n.data.slice(a, z), prev || n.data.slice(0, a)) + n.data.slice(z); prev = n.data.slice(0, z);
    }
  };
  const s = editing && editSelection();
  if (s && s.rangeCount && !s.isCollapsed) { walk(content(editing), s.getRangeAt(0)); return; }
  for (const b of sel) { walk(content(b)); fitHeight(b); }
  commit();
}
const LETTER_SPACING = [['Very tight', '-0.05em'], ['Tight', '-0.025em'], ['Normal', ''], ['Loose', '0.05em'], ['Very loose', '0.1em']];
const curLs = () => [...sel][0] ? content([...sel][0]).style.letterSpacing : '';
/* Run an execCommand over a whole box's text without entering edit mode. */
function onWholeText(b, fn) {
  const c = content(b), s = getSelection(), r = document.createRange();
  c.contentEditable = 'true'; r.selectNodeContents(c); s.removeAllRanges(); s.addRange(r);
  document.execCommand('styleWithCSS', false, 'true'); fn();
  c.removeAttribute('contenteditable'); s.removeAllRanges();
}
/* Highlight (background on text spans), on the selection while editing or on whole boxes. 'transparent' = none. */
function hilite(color) {
  const tidy = c => c.querySelectorAll('[style]').forEach(e => {
    if (e.style.backgroundColor === 'transparent' || e.style.backgroundColor === 'rgba(0, 0, 0, 0)') e.style.backgroundColor = '';
    if (!e.getAttribute('style')) { e.removeAttribute('style'); if (e.tagName === 'SPAN') e.replaceWith(...e.childNodes); }
  });
  // Chrome ignores hiliteColor('transparent'), so "None" clears backgrounds directly.
  const clear = (c, r) => { c.querySelectorAll('[style]').forEach(e => { if (!r || r.intersectsNode(e)) e.style.backgroundColor = ''; }); tidy(c); };
  if (editing && lastRange && !lastRange.collapsed) {
    if (color === 'transparent') { clear(content(editing), lastRange); scheduleSave(); } else { styleText('hiliteColor', color); tidy(content(editing)); }
    return;
  }
  for (const b of sel) {
    if (isMedia(b) || isLine(b)) continue;
    if (color === 'transparent') clear(content(b)); else onWholeText(b, () => document.execCommand('hiliteColor', false, color));
    tidy(content(b));
  }
  commit();
}

/* Paint format: copy the selected box's (or selected text's) style, then click a box or select text to apply
   it. Double-clicking the button keeps it on until Esc or another click on the button. */
let paint = null;
const TEXT_KEYS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'textDecoration', 'color', 'textAlign', 'lineHeight', 'padding'];
function captureStyle() {
  const b = editing || [...sel][0];
  if (!b) return null;
  const fromText = editing && lastRange && !lastRange.collapsed;
  const node = fromText ? lastRange.startContainer : content(b).querySelector('span, b, i, u, a') || content(b);
  const el = node.nodeType === 1 ? node : node.parentElement, cs = getComputedStyle(el);
  return {
    text: { bold: +cs.fontWeight >= 600, italic: cs.fontStyle === 'italic', underline: cs.textDecorationLine.includes('underline'),
            strike: cs.textDecorationLine.includes('line-through'), color: toHex(cs.color, '#222222'), font: cs.fontFamily,
            hilite: el.closest('[style*="background"]')?.style.backgroundColor || 'transparent' },
    box: fromText ? null : {
      vars: Object.fromEntries(['--fill', '--stroke', '--sw'].map(k => [k, b.style.getPropertyValue(k)])),
      shadow: 'shadow' in b.dataset, valign: b.dataset.valign,
      content: Object.fromEntries(TEXT_KEYS.map(k => [k, content(b).style[k]])),
    },
  };
}
function startPaint(locked) {
  const style = captureStyle();
  if (!style) return;
  paint = { ...style, locked };
  document.body.classList.add('painting'); $('#ed-paint-format').classList.add('on');
}
/* ⌥⌘C / ⌥⌘V: copy the selection's formatting, apply it to another selection (paint format without clicking). */
let copiedFormat = null;
function copyFormat() { copiedFormat = captureStyle(); if (copiedFormat) setStatus('Formatting copied'); }
function pasteFormat() {
  if (!copiedFormat) return;
  const was = paint; paint = copiedFormat;
  const s = editing && editSelection();
  if (s && !s.isCollapsed) { paintSelection(); scheduleSave(); }
  else { sel.forEach(paintBox); drawOverlay(); commit(); }
  paint = was;
}
function endPaint() { paint = null; document.body.classList.remove('painting'); $('#ed-paint-format').classList.remove('on'); }
function paintBox(b) {
  const { box, text } = paint;
  if (box) {
    for (const [k, v] of Object.entries(box.vars)) if (v) b.style.setProperty(k, v); else b.style.removeProperty(k);
    if (box.shadow) b.dataset.shadow = ''; else delete b.dataset.shadow;
    if (box.valign) b.dataset.valign = box.valign; else delete b.dataset.valign;
    if (!isMedia(b) && !isLine(b)) Object.assign(content(b).style, box.content);
    if (b.dataset.shape) renderShape(b);
    shadeBox(b);
  } else if (!isMedia(b) && !isLine(b)) {
    const c = content(b).style;
    c.fontWeight = text.bold ? 'bold' : ''; c.fontStyle = text.italic ? 'italic' : ''; c.color = text.color; c.fontFamily = text.font;
    c.textDecoration = [text.underline && 'underline', text.strike && 'line-through'].filter(Boolean).join(' ');
  }
  fitHeight(b);
}
function paintSelection() {
  const t = paint.text, set = (cmd, want) => { if (document.queryCommandState(cmd) !== want) document.execCommand(cmd); };
  document.execCommand('styleWithCSS', false, 'true');
  set('bold', t.bold); set('italic', t.italic); set('underline', t.underline); set('strikeThrough', t.strike);
  document.execCommand('foreColor', false, t.color); document.execCommand('fontName', false, t.font);
  document.execCommand('hiliteColor', false, t.hilite);
  const s = getSelection(); if (s.rangeCount) lastRange = s.getRangeAt(0).cloneRange();
  fitHeight(editing);
}
$('#ed-paint-format').onclick = () => { if (paint && !paint.locked) endPaint(); else if (!paint) startPaint(false); };
$('#ed-paint-format').ondblclick = () => { endPaint(); startPaint(true); };
addEventListener('keydown', e => { if (paint && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); endPaint(); } }, true);
addEventListener('pointerup', () => {   // painting onto text selected inside the box being edited
  if (!paint || !editing) return;
  const s = getSelection();
  if (s.rangeCount && !s.isCollapsed && content(editing).contains(s.anchorNode)) { paintSelection(); if (!paint.locked) endPaint(); }
});

/* Toggle a list: on the selection while editing, otherwise on the whole box (edit, select all, apply). */
function listText(cmd) {
  const b = editing || (sel.size === 1 ? [...sel][0] : null);
  if (!b || isMedia(b) || isLine(b)) return;
  const was = !!editing;
  if (!was) startEdit(b);
  else if (lastRange) { const s = getSelection(); s.removeAllRanges(); s.addRange(lastRange); }
  document.execCommand(cmd);
  // Chrome copies computed font-family / transparent backgrounds inline when unlisting; drop the no-ops.
  content(b).querySelectorAll('[style]').forEach(e => {
    if (e.style.backgroundColor === 'rgba(0, 0, 0, 0)') e.style.backgroundColor = '';
    const f = e.style.fontFamily;
    if (f) { const was = getComputedStyle(e).fontFamily; e.style.fontFamily = ''; if (getComputedStyle(e).fontFamily !== was) e.style.fontFamily = f; }
    if (!e.getAttribute('style')) e.removeAttribute('style');
  });
  // Chrome puts the list inside an <a> that wrapped the whole text; move the link onto each item instead.
  content(b).querySelectorAll('a > ul, a > ol').forEach(list => {
    const a = list.parentElement;
    list.querySelectorAll(':scope > li').forEach(li => { const l = a.cloneNode(false); l.append(...li.childNodes); li.append(l); });
    a.replaceWith(...a.childNodes);
  });
  const s = getSelection(); if (s.rangeCount) lastRange = s.getRangeAt(0).cloneRange();
  fitHeight(b);
  if (!was) stopEdit();
}

/* The selection to act on while editing: the live one if it's in the box, else the last one seen there
   (a toolbar or menu click can move it). */
function editSelection() {
  const s = getSelection();
  if (!(s.rangeCount && content(editing).contains(s.anchorNode)) && lastRange) { s.removeAllRanges(); s.addRange(lastRange); }
  return s;
}

/* Indent / outdent, as Slides: inside a list it nests or un-nests the items (Tab / ⇧Tab, ⌘] / ⌘[);
   for plain text it steps the box's left padding. Without a text selection it acts on whole boxes. */
const INDENT = 48;
function indentText(dir) {
  const cmd = dir > 0 ? 'indent' : 'outdent';
  const pad = b => { const c = content(b), p = parseFloat(getComputedStyle(c).paddingLeft); c.style.paddingLeft = Math.max(16, p + dir * INDENT) + 'px'; };
  if (editing) {
    const s = editSelection();
    const at = s.anchorNode?.nodeType === 1 ? s.anchorNode : s.anchorNode?.parentElement;
    if (at?.closest('li')) { document.execCommand('styleWithCSS', false, 'false'); document.execCommand(cmd); if (s.rangeCount) lastRange = s.getRangeAt(0).cloneRange(); }
    else pad(editing);
    fitHeight(editing); scheduleSave(); return;
  }
  for (const b of sel) {
    if (isMedia(b) || isLine(b)) continue;
    if (content(b).querySelector('li')) onWholeText(b, () => { document.execCommand('styleWithCSS', false, 'false'); document.execCommand(cmd); });
    else pad(b);
    fitHeight(b);
  }
  commit();
}

/* List styles from Format → Bullets & numbering: set list-style-type on the list(s) — the one holding the
   caret while editing, otherwise every list of that kind in the selected boxes (making one if needed). */
const BULLETS = [['disc', '●  ○  ■'], ['circle', '○'], ['square', '■'], ['"➤  "', '➤'], ['"✓  "', '✓'], ['"–  "', '–']];
const NUMBERS = [['decimal', '1.  2.  3.'], ['lower-alpha', 'a.  b.  c.'], ['lower-roman', 'i.  ii.  iii.'], ['upper-alpha', 'A.  B.  C.'], ['upper-roman', 'I.  II.  III.']];
function setListStyle(tag, type) {
  const cmd = tag === 'ul' ? 'insertUnorderedList' : 'insertOrderedList';
  const style = l => { if (['disc', 'decimal'].includes(type)) l.style.listStyleType = ''; else l.style.listStyleType = type; if (!l.getAttribute('style')) l.removeAttribute('style'); };
  if (editing) {
    const s = editSelection();
    const at = () => (s.anchorNode?.nodeType === 1 ? s.anchorNode : s.anchorNode?.parentElement)?.closest('ul, ol');
    if (at()?.tagName.toLowerCase() !== tag) listText(cmd);
    const l = at(); if (l) style(l);
    scheduleSave(); return;
  }
  for (const b of sel) {
    if (isMedia(b) || isLine(b)) continue;
    if (!content(b).querySelector(tag)) { sel = new Set([b]); listText(cmd); }
    content(b).querySelectorAll(tag).forEach(l => { if (!l.parentElement.closest(tag)) style(l); });
  }
  commit();
}

/* ⌘K: link the selected text (whole box if not editing). An empty URL removes the link. */
function linkText() {
  const b = editing || (sel.size === 1 ? [...sel][0] : null);
  if (!b || isMedia(b) || isLine(b)) return;
  const was = !!editing;
  if (!was) startEdit(b);
  else if (lastRange) { const s = getSelection(); s.removeAllRanges(); s.addRange(lastRange); }
  const s = getSelection();
  if (!s.rangeCount || s.isCollapsed) { if (!was) stopEdit(); return; }
  const range = s.getRangeAt(0).cloneRange();
  const cur = s.anchorNode?.parentElement?.closest('a')?.getAttribute('href') || '';
  const url = prompt('Link URL', cur || 'https://');
  if (url === null) { if (!was) stopEdit(); return; }
  s.removeAllRanges(); s.addRange(range);   // the prompt may have cleared the selection
  if (url.trim() && url.trim() !== 'https://') document.execCommand('createLink', false, url.trim());
  else document.execCommand('unlink');
  if (s.rangeCount) lastRange = s.getRangeAt(0).cloneRange();
  if (!was) stopEdit();
}

/* ⌘\: clear formatting. On a selection: the browser's removeFormat + unlink. On whole boxes: drop the
   text styles set on .content and unwrap every inline styling element, keeping lists and line breaks. */
function clearFormat() {
  if (editing && lastRange && !lastRange.collapsed) {
    const s = getSelection(); s.removeAllRanges(); s.addRange(lastRange);
    document.execCommand('removeFormat'); document.execCommand('unlink');
    if (s.rangeCount) lastRange = s.getRangeAt(0).cloneRange();
    fitHeight(editing);
    return;
  }
  for (const b of sel) {
    if (isMedia(b) || isLine(b)) continue;
    const c = content(b);
    ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'textDecoration', 'verticalAlign', 'color', 'lineHeight', 'textAlign'].forEach(k => { c.style[k] = ''; });
    if (!c.getAttribute('style')) c.removeAttribute('style');
    c.querySelectorAll('span, b, strong, i, em, u, s, strike, sup, sub, a, font').forEach(e => e.replaceWith(...e.childNodes));
    c.querySelectorAll('[style]').forEach(e => e.removeAttribute('style'));
    c.normalize();
    fitHeight(b);
  }
  commit();
}
