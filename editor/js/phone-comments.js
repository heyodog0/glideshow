/* ---------- phone: comments and share ---------- */
/* Adding a comment, as 15-comments.png: the top bar gives way to a "⊗ Cancel" pill, the object the comment is on stays
   outlined, a card says "Tap any object to re-anchor your comment" (a tap on another object or on nothing moves it),
   and a bar at the bottom holds @ and an "Add a new comment" field with send. The comments themselves (comments.js)
   open full screen, and so does Share (file.js), in the app's dark look. */
if (PHONE) (() => {
  const el = (tag, cls, html = '') => Object.assign(document.createElement(tag), { className: cls, innerHTML: html });
  const root = document.documentElement;
  const cancel = el('button', 'ph-cm-cancel', '<span class="icon">cancel</span><span>Cancel</span>');
  const hint = el('div', 'ph-cm-hint'), bar = el('div', 'ph-cm-bar'), at = el('button', 'ph-icon-btn ph-cm-at', '<span class="icon">alternate_email</span>');
  const field = el('div', 'ph-cm-field'), input = /** @type {HTMLTextAreaElement} */ (el('textarea', 'ph-cm-input')), send = el('button', 'ph-icon-btn ph-cm-send', '<span class="icon">send</span>');
  hint.textContent = 'Tap any object to re-anchor your comment';
  input.rows = 1; input.placeholder = 'Add a new comment'; at.title = 'Mention someone'; send.title = 'Send';
  field.append(input, send); bar.append(at, field);
  document.body.append(cancel, hint, bar);

  const anchor = b => {   // the comment goes on b (its top-right corner) or, with no b, the slide's top-left
    const g = b && geo(b);
    Object.assign(cmDraft, { box: b?.id || '', x: g ? g.x + g.w : 80, y: g ? g.y + 8 : 80, quote: (b ? content(b)?.innerText || '' : '').replace(/\s+/g, ' ').trim().slice(0, 120) });
    sel = b ? new Set([b]) : new Set(); drawOverlay();
  };
  function stop() { cmDraft = null; root.classList.remove('ph-commenting'); input.value = ''; input.blur(); send.disabled = true; drawOverlay(); }
  window['addComment'] = () => {
    if (!root.classList.contains('ph-edit')) phoneState('edit');
    stopEdit(); phoneSheet.close();
    cmDraft = { slide: cur + 1 }; anchor([...sel][0]);
    root.classList.add('ph-commenting'); send.disabled = true;
    setTimeout(() => input.focus(), 50);
  };
  input.oninput = () => { send.disabled = !input.value.trim(); };
  input.onkeydown = e => e.stopPropagation();   // typing isn't a shortcut
  send.onclick = () => { if (!input.value.trim() || !cmDraft) return; const d = cmDraft, text = input.value; stop(); cmFetch({ op: 'add', ...d, text }); };
  cancel.onclick = stop;
  at.onclick = () => { input.focus(); input.setRangeText('@', input.selectionStart, input.selectionEnd, 'end'); input.oninput(null); };
  stage.addEventListener('pointerdown', e => {   // while commenting, a tap re-anchors it
    if (!root.classList.contains('ph-commenting')) return;
    e.stopImmediatePropagation(); e.preventDefault();
    anchor(topBox(/** @type {Element} */ (e.target)));
  }, true);

  /* the comments panel and Share: full screen, with ✕ to close (the logic stays the desktop's) */
  const panelClose = $('#ed-cm-close'); if (panelClose) panelClose.title = 'Close';
})();
