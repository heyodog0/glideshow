/* ---------- working beside an agent ---------- */
/* An agent (or anything) editing deck.html while the editor is open: the reload shows what changed, the agent can ask
   what you are looking at (`glideshow selection`), and your own change is on disk before you switch to its window. */

/* After a reload from disk: slides that changed flash in the filmstrip, the first one is shown if the slide on show
   didn't change, and the changed boxes on it are outlined for a moment. */
function showOutsideChanges(before) {
  const old = new Set(before.map(normHTML)), changed = slides.map((s, i) => old.has(normHTML(sectionHTML(s))) ? -1 : i).filter(i => i >= 0);
  if (!changed.length) { setStatus('Reloaded from disk', 'cloud_sync'); return; }
  if (!changed.includes(cur)) go(changed[0]);
  const list = changed.map(i => i + 1);
  setStatus(`${remoteBy ? remoteBy + ' changed' : 'Changed on disk:'} slide${list.length > 1 ? 's' : ''} ${list.length > 6 ? list.slice(0, 6).join(', ') + '…' : list.join(', ')}`, 'cloud_sync');
  requestAnimationFrame(() => {
    for (const i of changed) thumbs.children[i]?.animate([{ boxShadow: '0 0 0 3px #fbbc04' }, { boxShadow: '0 0 0 3px #fbbc04', offset: .6 }, { boxShadow: '0 0 0 0 transparent' }], { duration: 2400 });
    const was = new Set(Array.from(before[cur] ? new DOMParser().parseFromString(before[cur], 'text/html').querySelectorAll('section > .box') : [], b => normHTML(cleanBox(b).outerHTML)));
    const fresh = boxes().filter(b => !was.has(normHTML(cleanBox(b).outerHTML)));
    $('#ed-flash').replaceChildren(...fresh.map(b => { const o = div('flash-box'); place(o, aabb(b)); o.style.setProperty('--k', 1 / scale + 'px'); return o; }));
    setTimeout(() => $('#ed-flash').replaceChildren(), 2400);
  });
}

/* What you are looking at, for an agent working beside you: the slide on show and the boxes selected (with their text),
   sent to the server whenever it changes. `glideshow selection` prints it; docs/agents.md tells agents to read it when you
   say "this". */
let lastSelection = '';
function reportSelection() {
  if (typeof deckDoc === 'undefined' || !deckDoc || !slides.length) return;
  const picked = [...sel].filter(b => b.isConnected), text = editing ? String(getSelection()) : '';
  const key = JSON.stringify([cur, picked.map(b => b.id), editing?.id || '', text, slides.length]);
  if (key === lastSelection) return;
  lastSelection = key;
  const all = boxes(), [h, v] = hv(cur);
  const body = { slide: cur + 1, h, v, slides: slides.length, title: deckDoc.title,
    boxes: picked.map(b => { const g = geo(b); return { id: b.id, index: all.indexOf(b), shape: b.dataset.shape || (b.classList.contains('image') ? 'image' : 'text'),
      text: (content(b)?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300), x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.w), h: Math.round(g.h) }; }),
    editing: editing?.id || '', selectedText: text.slice(0, 1000) };
  fetch('/api/selection', { method: 'POST', body: JSON.stringify(body) }).catch(() => {});
}
setInterval(reportSelection, 400);

/* Leaving the window (to the terminal, say): what you changed goes to disk now, text being typed included, so an
   agent that writes next starts from it. */
addEventListener('blur', async () => {
  if (themeStash || histView) return;
  if (editing && content(editing).innerHTML !== editStart) { commit(); editStart = content(editing).innerHTML; }
  await flushSave();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
