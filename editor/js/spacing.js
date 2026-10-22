const noSel = () => !sel.size, noText = () => !sel.size && !editing;
/* Line spacing as Slides means it: "Single" is the font's natural line height (about 1.15 × the size for Arial),
   so Slides' value v is CSS line-height v × 1.15. Older decks keep their CSS values; the menu ticks the nearest. */
const NATURAL_LH = 1.15;
const lhItems = () => /** @type {any[]} */ (/** @type {[number, string][]} */ ([[1, 'Single'], [1.15, '1.15'], [1.5, '1.5'], [2, 'Double']]).map(([v, label]) => ({
  label, on: () => Math.abs(parseFloat(curLh()) / NATURAL_LH - v) < 0.04, off: noSel,
  run: () => { sel.forEach(b => { content(b).style.lineHeight = String(Math.round(v * NATURAL_LH * 1000) / 1000); fitHeight(b); }); commit(); },
}))).concat('-', ['before', 'after'].map(side => ({
  label: `${spaceOn(side) ? 'Remove' : 'Add'} space ${side} paragraph`, off: noSel,
  run: () => { const on = spaceOn(side); sel.forEach(b => { const c = content(b); blockify(c); if (on) c.style.removeProperty(`--space-${side}`); else c.style.setProperty(`--space-${side}`, PARA_SPACE); fitHeight(b); }); commit(); },
})), '-', { label: 'Custom spacing', run: () => showSpaceDialog(true), off: noSel });
/* Paragraph spacing, as Slides' "Add space before/after paragraph": 10pt on every paragraph of the box, stored as
   --space-before / --space-after on .content (base.css turns them into block margins). */
const PARA_SPACE = `${Math.round(10 * PT * 100) / 100}px`;
const spaceOn = side => !!([...sel][0] && content([...sel][0]).style.getPropertyValue(`--space-${side}`));
/* Bare text before the first block (contenteditable leaves the first line unwrapped) becomes a <div> so it is a paragraph too. */
function blockify(c) {
  const lead = [];
  for (const n of c.childNodes) { if (n.nodeType === 1 && getComputedStyle(n).display !== 'inline') break; lead.push(n); }
  if (!lead.some(n => n.textContent.trim())) return;
  const d = document.createElement('div'); c.insertBefore(d, lead[0]); lead.forEach(n => d.appendChild(n));
  if (d.lastChild?.nodeName === 'BR' && d.nextSibling) d.lastChild.remove();
}
