/* View → Guides, as Slides: user guides across the slide, saved with the deck as data-guides="v960 h540" on
   the .slides element (px on the 1920×1080 canvas). Drag one to move it, drag it off the slide to remove it;
   dragged objects snap to them. Shown or hidden per viewer (remembered), never drawn in the deck itself. */
const userGuides = () => (deckDoc?.querySelector('.slides')?.dataset.guides || '').split(/\s+/).filter(Boolean).map(t => [t[0], +t.slice(1)]).filter(([d, v]) => 'vh'.includes(d) && isFinite(v));
const guidesShown = () => { try { return localStorage.getItem('slides-guides-off') !== '1'; } catch { return true; } };
const snapGuides = () => { try { return localStorage.getItem('slides-snap-guides') !== '0'; } catch { return true; } };
function setGuides(list) {
  const el = deckDoc.querySelector('.slides');
  if (list.length) el.dataset.guides = list.map(([d, v]) => d + Math.round(v)).join(' '); else delete el.dataset.guides;
  drawGuides(); scheduleSave();
}
function setGuidesShown(on) { store('slides-guides-off', on ? undefined : '1'); drawGuides(); }
function addGuide(d) { setGuidesShown(true); setGuides([...userGuides(), [d, d === 'v' ? W / 2 : H / 2]]); }
function drawGuides() {
  const host = $('#ed-rules'); host.replaceChildren();
  if (!guidesShown()) return;
  const k = 1 / scale;
  userGuides().forEach(([d, v], i) => {
    const r = div('rule ' + d); r.style.setProperty('--k', k + 'px');
    place(r, d === 'v' ? { x: v - 4 * k, y: 0, w: 8 * k, h: H } : { x: 0, y: v - 4 * k, w: W, h: 8 * k });
    r.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      const list = userGuides();
      drag(e, ev => { const p = toCanvas(ev); list[i] = [d, d === 'v' ? p.x : p.y]; place(r, d === 'v' ? { x: p.x - 4 * k, y: 0, w: 8 * k, h: H } : { x: 0, y: p.y - 4 * k, w: W, h: 8 * k }); },
        () => { const v2 = list[i][1]; setGuides(v2 < 0 || v2 > (d === 'v' ? W : H) ? list.filter((_, j) => j !== i) : list); });
    });
    host.append(r);
  });
}
let guideChord = 0;   // ⌃⌘E starts Slides' two-step guide shortcuts
addEventListener('keydown', e => {
  if (!(e.ctrlKey && e.metaKey) || inField(e.target)) return;
  if (e.code === 'KeyE') { e.preventDefault(); guideChord = Date.now(); return; }
  if (Date.now() - guideChord > 2000) return;
  const run = { KeyG: () => setGuidesShown(!guidesShown()), KeyV: () => addGuide('v'), KeyH: () => addGuide('h') }[e.code];
  if (run) { e.preventDefault(); e.stopImmediatePropagation(); guideChord = 0; run(); }
}, true);
