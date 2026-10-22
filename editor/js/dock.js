/* The insert bar (View → Show insert bar): a floating pill at the bottom of the slide with the tools that create things,
   as Figma Slides has, each calling the same action as the toolbar or Insert menu. Formatting stays at the top; the bar
   never changes with the selection. Remembered in localStorage (on by default). */
const dock = $('#ed-dock');
const dockShown = () => stored('slides-dock') !== '0';
function setDock(on) { store('slides-dock', on ? undefined : '0'); dock.hidden = !on; }
dock.hidden = !dockShown();
const DOCK_DO = {
  select: () => stopEdit(),
  text: () => $('#ed-add-text').click(),
  image: () => $('#ed-file').click(),
  equation: addEquation,
  note: () => { const b = addNote(cur, W - 620, 60, ''); sel = new Set([b]); startEdit(b); },
};
const DOCK_MENUS = { shape: () => shapeItems(), line: () => lineItems(), table: () => [{ el: tableGrid }], code: () => codeLangItems(addCode) };
dock.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });   // keep the focus where it is (as the toolbar)
dock.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const k = b.dataset.do;
  if (DOCK_MENUS[k]) return openAnchor === b ? closeMenu() : openMenu(b, DOCK_MENUS[k](), { up: true });
  closeMenu(); DOCK_DO[k]?.();
});
