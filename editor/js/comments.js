/* ---------- comments ---------- */
/* Comments people left on a shared deck (glideshow.org/p/…), or added here: comments.json beside deck.html, through
   /api/comments. The panel lists them (this slide's first); a pin marks each one on its slide; clicking one goes to its
   slide and selects the box it was left on. ⌘⌥M (Slides' Insert comment) comments on the selection or the slide. */
const cmPanel = $('#ed-comments'), pins = $('#ed-pins');
let cmList = [], cmDraft = null;
const cmAgo = t => { const s = (Date.now() - Date.parse(t)) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }); };
const cmEl = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

async function cmFetch(body) {
  const r = await fetch('/api/comments', body ? { method: 'POST', body: JSON.stringify(body) } : { cache: 'no-store' }).then(r => r.json()).catch(() => null);
  if (Array.isArray(r?.comments)) cmList = r.comments;
  if (r?.error && body) setStatus(r.error, 'error');
  cmRender();
}
function setCommentsPanel(open) {
  cmPanel.hidden = !open; $('#ed-comments-btn').classList.toggle('on', open);
  if (open) { $('#ed-objects').hidden = true; fmt.hidden = true; $('#ed-trans').hidden = true; $('#ed-theme').hidden = true; $('#ed-history').hidden = true; cmFetch(); }
  fit(); drawPins();
}
function cmRender() {
  const open = cmList.filter(c => !c.resolved), showDone = $('#ed-cm-resolved').checked;
  $('#ed-comments-n').textContent = open.length || '';
  drawPins();
  if (cmPanel.hidden) return;
  const here = cur + 1, list = cmList.filter(c => showDone || !c.resolved).sort((a, b) => +(b.slide === here) - +(a.slide === here) || a.slide - b.slide || a.at.localeCompare(b.at));
  const out = [];
  if (cmDraft) out.push(cmComposer());
  for (const c of list) {
    const card = cmEl('div', 'cm-card' + (cmN(c) === here ? ' here' : '') + (c.resolved ? ' done' : ''));
    const top = cmEl('div', 'cm-top'); top.append(cmEl('span', '', `Slide ${cmN(c)}`), cmEl('span', '', cmAgo(c.at))); card.append(top);
    if (c.quote) card.append(cmEl('div', 'cm-quote', c.quote));
    card.append(cmEl('div', 'cm-by', c.by?.n || c.by?.e || ''), cmEl('div', 'cm-text', c.text));
    for (const r of c.replies || []) { const d = cmEl('div', 'cm-reply' + (r.event ? ' event' : '')); d.append(cmEl('b', '', (r.by?.n || r.by?.e || '') + ' '), r.text); card.append(d); }
    const acts = cmEl('div', 'cm-acts'), reply = cmEl('input'); reply.placeholder = 'Reply';
    reply.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter' && reply.value.trim()) cmFetch({ op: 'reply', id: c.id, text: reply.value }); };
    const res = cmEl('button', '', c.resolved ? 'Reopen' : 'Resolve'); res.onclick = e => { e.stopPropagation(); cmFetch({ op: 'resolve', id: c.id, resolved: !c.resolved }); };
    const del = cmEl('button', '', 'Delete'); del.onclick = e => { e.stopPropagation(); if (confirm('Delete this comment and its replies?')) cmFetch({ op: 'delete', id: c.id }); };
    acts.append(reply, res, del); card.append(acts);
    card.onclick = e => { if (!e.target.closest('input, button, textarea')) cmShow(c); };
    out.push(card);
  }
  if (!out.length) out.push(cmEl('div', 'cm-empty', cmList.length ? 'All comments are resolved.' : 'No comments yet. People you share the deck with can comment on it; you can add your own with Comment (⌘⌥M).'));
  $('#ed-cm-list').replaceChildren(...out);
}
/* A comment's slide (1-based): the one with its data-sid, wherever slides have moved since; else the number it was left on. */
function cmN(c) { const i = c.sid ? slides.findIndex(s => s.dataset.sid === c.sid) : -1; return i >= 0 ? i + 1 : c.slide; }
function cmShow(c) {   // its slide, with the box it was left on selected
  if (cmN(c) - 1 !== cur) go(Math.min(slides.length - 1, cmN(c) - 1));
  const b = c.box && boxes().find(x => x.id === c.box);
  if (b) { sel = new Set([b]); render(); }
}
function cmComposer() {
  const card = cmEl('div', 'cm-card here'), ta = cmEl('textarea'); ta.rows = 3; ta.placeholder = `Comment on slide ${cmDraft.slide}`;
  const acts = cmEl('div', 'cm-acts'), ok = cmEl('button', '', 'Comment'), no = cmEl('button', '', 'Cancel');
  ok.onclick = () => { if (ta.value.trim()) { const d = cmDraft; cmDraft = null; cmFetch({ op: 'add', ...d, text: ta.value }); } };
  no.onclick = () => { cmDraft = null; cmRender(); };
  ta.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ok.click(); if (e.key === 'Escape') no.click(); };
  if (cmDraft.quote) card.append(cmEl('div', 'cm-quote', cmDraft.quote));
  acts.append(ok, no); card.append(ta, acts); setTimeout(() => ta.focus());
  return card;
}
function addComment() {   // on the selected box (its top-right corner), else the slide's top-left
  const b = [...sel][0], g = b && geo(b);
  cmDraft = { slide: cur + 1, sid: slides[cur]?.dataset.sid || '', box: b?.id || '', x: g ? g.x + g.w : 80, y: g ? g.y + 8 : 80, quote: (b ? content(b)?.innerText || '' : '').replace(/\s+/g, ' ').trim().slice(0, 120) };
  if (cmPanel.hidden) setCommentsPanel(true); else cmRender();
}
function drawPins() {
  const showDone = $('#ed-cm-resolved').checked, k = 1 / scale;
  pins.replaceChildren(...cmList.filter(c => cmN(c) === cur + 1 && (showDone || !c.resolved)).map((c, i) => {
    const p = cmEl('div', 'cm-pin', String(i + 1)); p.title = `${c.by?.n || ''}: ${c.text}`;
    p.style.left = c.x + 'px'; p.style.top = c.y + 'px'; p.style.scale = k; p.style.transformOrigin = '0 100%';
    p.onpointerdown = e => { e.stopPropagation(); if (cmPanel.hidden) setCommentsPanel(true); cmShow(c); };
    return p;
  }));
}
new MutationObserver(drawPins).observe(canvas, { childList: true });   // the slide on show changed
$('#ed-comments-btn').onclick = () => setCommentsPanel(cmPanel.hidden);
$('#ed-cm-close').onclick = () => setCommentsPanel(false);
$('#ed-cm-add').onclick = addComment;
$('#ed-cm-resolved').onchange = cmRender;
addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyM') { e.preventDefault(); e.stopPropagation(); addComment(); } }, true);
const cmTyping = () => [...cmPanel.querySelectorAll('input:not([type=checkbox]), textarea')].some(i => i.value.trim() || i === document.activeElement);
setInterval(() => { if (!cmPanel.hidden && !cmDraft && !cmTyping()) cmFetch(); }, 20000);   // new comments while it is open, never under someone's fingers
cmFetch();
