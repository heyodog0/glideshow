/* ---------- speaker notes ---------- */

/* The pane under the slide edits the slide's <aside class="notes"> (what reveal's speaker view shows).
   Its height and whether it's shown are remembered per browser. */
const notesPane = $('#ed-notes'), store = (k, v) => { try { v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
const stored = k => { try { return localStorage.getItem(k); } catch { return null; } };
document.body.classList.toggle('ruler-off', !rulersShown());
/* Dark chrome: the stored choice, else the system's. */
const darkOn = () => { const v = stored('slides-dark'); return v ? v === '1' : matchMedia('(prefers-color-scheme: dark)').matches; };
function setDark(on) { store('slides-dark', on ? '1' : '0'); document.body.classList.toggle('dark', on); drawRulers(); }
document.body.classList.toggle('dark', darkOn());
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!stored('slides-dark')) { document.body.classList.toggle('dark', darkOn()); drawRulers(); } });
/* Sticky notes (Notes for AI, .box.note) on the slide and in the filmstrip: View → Show sticky notes, remembered per
   browser. Hidden, they can't be picked by Select all or a drag either (so nothing moves or deletes them unseen); the list
   above the speaker notes still names them, and choosing one there, or adding a note, shows them again. */
const stickiesShown = () => stored('slides-stickies') !== '0';
function setStickies(/** @type {boolean} */ on) {
  store('slides-stickies', on ? undefined : '0'); document.body.classList.toggle('stickies-off', !on);
  if (!on && [...sel].some(b => b.classList.contains('note'))) { stopEdit(); sel = new Set([...sel].filter(b => !b.classList.contains('note'))); drawOverlay(); updateToolbar(); }
  renderThumbs?.();
}
document.body.classList.toggle('stickies-off', !stickiesShown());
/** The boxes one can pick on this slide: all of them, but sticky notes only while they're shown. */
const pickable = () => boxes().filter(b => stickiesShown() || !b.classList.contains('note'));
/* This slide's notes for the AI, listed above the speaker notes (click one to select it). */
function showAINotes() {
  const list = [...(slides[cur]?.querySelectorAll('.box.note') || [])], host = $('#ed-ai-notes');
  host.hidden = !list.length;
  host.replaceChildren(...list.map(b => { const c = div('ai-note'); c.innerHTML = '<span class="icon">sticky_note_2</span><span></span><small></small>';
    c.children[1].textContent = b.textContent.trim() || '(empty)'; c.children[2].textContent = (b.dataset.time || '').replace('T', ' ');
    c.onclick = () => { stopEdit(); if (!stickiesShown()) setStickies(true); sel = new Set([b]); drawOverlay(); updateToolbar(); }; return c; }));
}
function showNotes() {
  showAINotes();
  if (document.activeElement === notesPane && notesPane.dataset.slide === String(cur)) return;   // don't move the caret
  notesPane.innerHTML = slides[cur]?.querySelector(':scope > aside.notes')?.innerHTML.trim() || '';
  notesPane.dataset.slide = cur;
}
notesPane.oninput = () => {
  const s = slides[cur];
  let a = s.querySelector(':scope > aside.notes');
  const html = notesPane.textContent.trim() ? notesPane.innerHTML.trim() : '';
  if (!html) { a?.remove(); } else { if (!a) { a = document.createElement('aside'); a.className = 'notes'; s.append(a); } a.innerHTML = html; }
  scheduleSave();
};
notesPane.onblur = () => { pushHistory(); };
function setNotesVisible(on) {   // collapsed to a thin bar by default, as Slides; the choice is remembered
  document.body.classList.toggle('notes-off', !on);
  store('slides-notes-off', on ? '0' : '1');
  fit();
}
function setNotesHeight(h) {
  notesPane.style.height = Math.max(48, Math.min(h, innerHeight * 0.6)) + 'px';
  store('slides-notes-h', parseInt(notesPane.style.height));
  fit();
}
$('#ed-splitter').addEventListener('pointerdown', e => {
  const y0 = e.clientY, h0 = notesPane.offsetHeight;
  if (document.body.classList.contains('notes-off')) setNotesVisible(true);
  drag(e, ev => setNotesHeight(h0 - (ev.clientY - y0)), () => {});
});
if (stored('slides-notes-h')) notesPane.style.height = stored('slides-notes-h') + 'px';
if (stored('slides-notes-off') !== '0') document.body.classList.add('notes-off');
