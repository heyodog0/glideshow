/* ---------- transitions (Slide → Transition) ---------- */

/* Slides' transitions mapped onto reveal.js, stored per slide as data-transition / data-transition-speed.
   Dissolve and Fade both fade (written differently so the choice round-trips); Slide from left is ours. */
const TRANSITIONS = [['none', 'None'], ['fade', 'Dissolve'], ['fade-in fade-out', 'Fade'], ['slide', 'Slide from right'],
  ['sl-left', 'Slide from left'], ['convex', 'Flip'], ['concave', 'Cube'], ['zoom', 'Gallery'], ['morph', 'Morph']];
const SPEEDS = ['slow', '', 'fast'];
/* Morph is reveal's Auto-Animate (Keynote's Magic Move): data-auto-animate on the slide, its speed as
   data-auto-animate-duration. Boxes pair with the previous slide's by data-morph (Duplicate slide sets it), else by id. */
const MORPH_S = { slow: '1.4', fast: '0.5' };
const kindOf = s => s.hasAttribute('data-auto-animate') ? 'morph' : s.dataset.transition || 'none';
const speedOf = s => s.hasAttribute('data-auto-animate') ? Object.keys(MORPH_S).find(k => MORPH_S[k] === s.dataset.autoAnimateDuration) || '' : s.dataset.transitionSpeed || '';
const trans = $('#ed-trans');
$('#ed-t-kind').innerHTML = TRANSITIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
function setTransPanel(open) { trans.hidden = !open; if (open) { fmt.hidden = true; $('#ed-theme').hidden = true; $('#ed-comments').hidden = true; updateTransPanel(); } fit(); }
function updateTransPanel() {
  if (trans.hidden || !slides[cur]) return;
  renderAnims();
  const s = slides[cur];
  $('#ed-t-kind').value = kindOf(s);
  $('#ed-t-speed').value = Math.max(0, SPEEDS.indexOf(speedOf(s)));
}
function writeTransition(s) {
  const k = $('#ed-t-kind').value, sp = SPEEDS[+$('#ed-t-speed').value];
  s.removeAttribute('data-auto-animate'); delete s.dataset.autoAnimateDuration;
  if (k === 'none') { delete s.dataset.transition; delete s.dataset.transitionSpeed; return; }
  if (k === 'morph') { delete s.dataset.transition; delete s.dataset.transitionSpeed; s.setAttribute('data-auto-animate', ''); if (sp) s.dataset.autoAnimateDuration = MORPH_S[sp]; return; }
  s.dataset.transition = k;
  if (sp) s.dataset.transitionSpeed = sp; else delete s.dataset.transitionSpeed;
}
$('#ed-t-kind').onchange = $('#ed-t-speed').onchange = () => { writeTransition(slides[cur]); commit(); playTransition(); renderAnims(); };
$('#ed-t-all').onclick = () => { slides.forEach(writeTransition); commit(); setStatus('Transition applied to all slides'); };
$('#ed-trans-close').onclick = () => setTransPanel(false);
$('#ed-transition').onclick = () => setTransPanel(trans.hidden);
/* Object animations, as reveal fragments in the order of data-fragment-index (Motion panel). */
const EFFECTS = [['appear', 'Appear'], ['fade-in', 'Fade in'], ['fade-right', 'Fly in from left'], ['fade-left', 'Fly in from right'],
  ['fade-up', 'Fly in from bottom'], ['fade-down', 'Fly in from top'], ['zoom-in', 'Zoom in'],
  // reveal's other fragment styles: out, dimmed, shown for one step only, and emphasis on something already there
  ['fade-out', 'Fade out'], ['semi-fade-out', 'Dim'], ['fade-in-then-out', 'Fade in, then out'], ['fade-in-then-semi-out', 'Fade in, then dim'],
  ['highlight-current-blue', 'Highlight while current'], ['grow', 'Grow'], ['shrink', 'Shrink'], ['strike', 'Strike through']];
const effectOf = b => EFFECTS.find(([c]) => b.classList.contains(c))?.[0] || 'fade-in';
const animBoxes = () => boxes().filter(b => b.classList.contains('fragment'))
  .map((b, i) => [b, +(b.dataset.fragmentIndex ?? i), 'withPrevious' in b.dataset ? 1 : 0])
  .sort((a, z) => a[1] - z[1] || a[2] - z[2]).map(x => x[0]);   // within a step, the "with previous" ones follow
/* "With previous" shares the previous animation's step (same data-fragment-index); data-with-previous keeps the choice. */
const renumber = list => { let n = -1; list.forEach((b, i) => { if (!(i && 'withPrevious' in b.dataset)) n++; b.dataset.fragmentIndex = n; }); };
const openAnims = new Set();
function setEffect(b, eff) { b.classList.remove(...EFFECTS.map(e => e[0])); b.classList.add('fragment', eff); }
function addAnim() {   // boxes animated together (several selected) share one click: the first on click, the rest with previous
  const list = animBoxes();
  [...sel].filter(b => !b.classList.contains('fragment')).forEach((b, i) => { setEffect(b, 'fade-in'); if (i) b.dataset.withPrevious = ''; list.push(b); });
  renumber(list); commit(); renderAnims();
}
function removeAnim(b) {
  b.classList.remove('fragment', ...EFFECTS.map(e => e[0])); delete b.dataset.fragmentIndex; delete b.dataset.withPrevious; delete b.dataset.build;
  renumber(animBoxes()); commit(); renderAnims();
}
function moveAnim(from, to) { const list = animBoxes(); list.splice(to, 0, ...list.splice(from, 1)); renumber(list); commit(); renderAnims(); }
const animLabel = b => (content(b)?.textContent.trim().slice(0, 40)) || (isMedia(b) ? (b.classList.contains('video') ? 'Video' : 'Image') : b.dataset.shape ? b.dataset.shape[0].toUpperCase() + b.dataset.shape.slice(1) : 'Text box');
function renderAnims() {
  const host = $('#ed-anim-list'); if (!host || trans.hidden) return;
  const canAdd = [...sel].some(b => !b.classList.contains('fragment')), kind = slides[cur] ? kindOf(slides[cur]) : 'none';
  $('#ed-anim-add').disabled = !canAdd;
  $('#ed-anim-add').lastChild.textContent = canAdd || sel.size ? 'Add animation' : 'Select an object to animate';   // Slides' empty-state label
  $('#ed-anim-play').disabled = kind === 'none' && !animBoxes().length;
  trans.classList.toggle('no-trans', kind === 'none');
  const t = TRANSITIONS.find(x => x[0] === kind); $('#ed-t-name').textContent = t ? t[1] : 'None';
  host.replaceChildren(...animBoxes().map((b, i) => {
    const open = sel.has(b) || openAnims.has(b), withPrev = 'withPrevious' in b.dataset;
    const r = div('anim-row' + (sel.has(b) ? ' on' : '') + (open ? ' open' : '')); r.draggable = true; r.dataset.i = String(i);
    r.innerHTML = `<div class="anim-head"><span class="n icon" title="Drag to reorder">drag_indicator</span><span class="icon chev">chevron_right</span>
      <span class="eff"></span><span class="what"></span><button title="Delete animation"><span class="icon">delete</span></button></div>
      <div class="anim-body"><select class="e">${EFFECTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <select class="t"><option value="click">On click</option><option value="with">With previous</option></select>
      <label class="para"><input type="checkbox"> By paragraph</label></div>`;
    r.querySelector('.eff').textContent = `${EFFECTS.find(e => e[0] === effectOf(b))[1]}${b.dataset.build === 'paragraph' ? ' by paragraph' : ''}  (${withPrev ? 'With previous' : 'On click'})`;
    r.querySelector('.what').textContent = animLabel(b);
    const se = r.querySelector('select.e'), tr = r.querySelector('select.t'); se.value = effectOf(b); tr.value = withPrev ? 'with' : 'click';
    se.onchange = () => { setEffect(b, se.value); commit(); renderAnims(); };
    tr.onchange = () => { if (tr.value === 'with') b.dataset.withPrevious = ''; else delete b.dataset.withPrevious; renumber(animBoxes()); commit(); renderAnims(); };
    const para = /** @type {HTMLInputElement} */ (r.querySelector('.para input')), textual = !isMedia(b) && !isStroke(b) && !!content(b)?.textContent.trim();
    /** @type {HTMLElement} */ (r.querySelector('.para')).hidden = !textual; para.checked = b.dataset.build === 'paragraph';   // Slides' "By paragraph": one step per paragraph or bullet
    para.onchange = () => { if (para.checked) b.dataset.build = 'paragraph'; else delete b.dataset.build; commit(); renderAnims(); };
    r.querySelector('.anim-head button').onclick = () => removeAnim(b);
    r.querySelector('.anim-head').onclick = e => {
      if (e.target.closest('button')) return;
      if (open && !sel.has(b)) openAnims.delete(b); else openAnims.add(b);
      sel = new Set([b]); drawOverlay(); updateToolbar(); renderAnims();
    };
    r.ondragstart = e => e.dataTransfer.setData('text/x-anim', String(i));
    r.ondragover = e => { e.preventDefault(); r.classList.add('drop'); };
    r.ondragleave = () => r.classList.remove('drop');
    r.ondrop = e => { e.preventDefault(); r.classList.remove('drop'); const from = +e.dataTransfer.getData('text/x-anim'); if (from !== i) moveAnim(from, i); };
    return r;
  }));
}
/* Preview: the slide's animations one after another on the canvas. */
async function playAnims() {
  const kf = { appear: [{ opacity: 0 }, { opacity: 0, offset: .99 }, { opacity: 1 }], 'fade-in': [{ opacity: 0 }, { opacity: 1 }],
    'fade-right': [{ opacity: 0, translate: '-20% 0' }, { opacity: 1, translate: '0 0' }], 'fade-left': [{ opacity: 0, translate: '20% 0' }, { opacity: 1, translate: '0 0' }],
    'fade-up': [{ opacity: 0, translate: '0 20%' }, { opacity: 1, translate: '0 0' }], 'fade-down': [{ opacity: 0, translate: '0 -20%' }, { opacity: 1, translate: '0 0' }],
    'zoom-in': [{ opacity: 0, scale: .1 }, { opacity: 1, scale: 1 }], 'fade-out': [{ opacity: 1 }, { opacity: 0 }], 'semi-fade-out': [{ opacity: 1 }, { opacity: .5 }],
    'fade-in-then-out': [{ opacity: 0 }, { opacity: 1, offset: .3 }, { opacity: 1, offset: .7 }, { opacity: 0 }], 'fade-in-then-semi-out': [{ opacity: 0 }, { opacity: 1, offset: .4 }, { opacity: .5 }],
    'highlight-current-blue': [{ color: 'inherit' }, { color: '#1b6ac9' }, { color: 'inherit' }], grow: [{ scale: 1 }, { scale: 1.3 }, { scale: 1 }],
    shrink: [{ scale: 1 }, { scale: .7 }, { scale: 1 }], strike: [{ textDecoration: 'none' }, { textDecoration: 'line-through' }] };
  const list = animBoxes();
  list.forEach(b => { b.style.visibility = 'hidden'; });
  for (const b of list) { b.style.visibility = ''; await b.animate(kf[effectOf(b)], { duration: 500, easing: 'ease' }).finished; await new Promise(r => setTimeout(r, 250)); }
}
$('#ed-anim-add').onclick = addAnim;
$('#ed-anim-play').onclick = async () => { playTransition(); await new Promise(r => setTimeout(r, 300)); playAnims(); };

/* Preview the current slide's transition on the canvas (an approximation of reveal's). */
function playTransition() {
  const s = slides[cur], k = kindOf(s), ms = { slow: 1200, fast: 400 }[speedOf(s)] || 800;
  if (k === 'morph') return playMorph(s, (+s.dataset.autoAnimateDuration || 1) * 1000);
  const frames = { fade: [{ opacity: 0 }, { opacity: 1 }], 'fade-in fade-out': [{ opacity: 0 }, { opacity: 1 }],
    slide: [{ transform: 'translateX(100%)' }, { transform: 'none' }], 'sl-left': [{ transform: 'translateX(-100%)' }, { transform: 'none' }],
    convex: [{ transform: 'perspective(2000px) rotateY(90deg)' }, { transform: 'none' }], concave: [{ transform: 'perspective(2000px) rotateY(-90deg)' }, { transform: 'none' }],
    zoom: [{ transform: 'scale(.2)', opacity: 0 }, { transform: 'none', opacity: 1 }] }[k];
  if (frames) s.animate(frames, { duration: ms, easing: 'cubic-bezier(.26,.86,.44,.985)' });
}

/* Morph's preview: each box that has a partner on the slide before moves from the partner's place and size; the rest fade in. */
function playMorph(s, ms) {
  const prev = slides[slides.indexOf(s) - 1]; if (!prev) return;
  const key = b => b.dataset.morph || b.id, before = new Map(boxes(prev).map(b => [key(b), b]));
  boxes(s).filter(b => !parentBox(b)).forEach(b => {
    const p = before.get(key(b)), at = ['left', 'top', 'width', 'height'];
    if (!p) return b.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: 'ease' });
    b.animate([Object.fromEntries(at.map(k => [k, p.style[k]])), Object.fromEntries(at.map(k => [k, b.style[k]]))], { duration: ms, easing: 'ease' });
  });
}

/* Arrange → Stack as a sequence: the selected pictures in one place, shown one after another (a plot that updates in
   place, as reveal's r-stack): the first fades out as the second appears, each middle one shows for its step only, the
   last stays. */
function stackSequence() {
  const pics = [...sel].filter(b => isMedia(b) && !parentBox(b)).sort((a, z) => boxes().indexOf(a) - boxes().indexOf(z));
  if (pics.length < 2) return setStatus('Select two or more pictures to stack', 'error');
  const g = geo(pics[0]), list = animBoxes().filter(b => !pics.includes(b));
  pics.forEach(b => { place(b, { ...geo(b), x: g.x, y: g.y, w: g.w, h: g.w * geo(b).h / geo(b).w }); b.classList.remove('fragment', ...EFFECTS.map(e => e[0])); delete b.dataset.withPrevious; delete b.dataset.build; });
  pics.slice(1).forEach((b, i) => {
    setEffect(b, i === pics.length - 2 ? 'fade-in' : 'fade-in-then-out'); list.push(b);
    if (i === 0) { setEffect(pics[0], 'fade-out'); pics[0].dataset.withPrevious = ''; list.push(pics[0]); }
  });
  renumber(list); commit(); render(); renderAnims(); setStatus(`${pics.length} pictures stacked: they show one after another`);
}
