/* ---------- transitions (Slide → Transition) ---------- */

/* Slides' transitions mapped onto reveal.js, stored per slide as data-transition / data-transition-speed.
   Dissolve and Fade both fade (written differently so the choice round-trips); Slide from left is ours. */
const TRANSITIONS = [['none', 'None'], ['fade', 'Dissolve'], ['fade-in fade-out', 'Fade'], ['slide', 'Slide from right'],
  ['sl-left', 'Slide from left'], ['sl-up', 'Slide from bottom'], ['sl-down', 'Slide from top'], ['convex', 'Flip'], ['concave', 'Cube'], ['zoom', 'Gallery'],
  // Keynote's Wipe and Move In (base.css)
  ['wipe-r', 'Wipe from left'], ['wipe-l', 'Wipe from right'], ['wipe-d', 'Wipe from top'], ['wipe-u', 'Wipe from bottom'],
  ['move-in-r', 'Move in from left'], ['move-in-l', 'Move in from right'], ['move-in-d', 'Move in from top'], ['move-in-u', 'Move in from bottom'], ['morph', 'Morph']];
const SPEEDS = ['slow', '', 'fast'];
/* Morph is reveal's Auto-Animate (Keynote's Magic Move): data-auto-animate on the slide, its speed as
   data-auto-animate-duration. Boxes pair with the previous slide's by data-morph (Duplicate slide sets it), else by id. */
const MORPH_S = { slow: '1.4', fast: '0.5' };
const kindOf = s => s.hasAttribute('data-auto-animate') ? 'morph' : s.dataset.transition || 'none';
const speedOf = s => s.hasAttribute('data-auto-animate') ? Object.keys(MORPH_S).find(k => MORPH_S[k] === s.dataset.autoAnimateDuration) || '' : s.dataset.transitionSpeed || '';
const trans = $('#ed-trans');
$('#ed-t-kind').innerHTML = TRANSITIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
function setTransPanel(open) { trans.hidden = !open; if (open) { $('#ed-objects').hidden = true; fmt.hidden = true; $('#ed-theme').hidden = true; $('#ed-comments').hidden = true; updateTransPanel(); } fit(); }
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
  // Keynote's builds (base.css): Wipe and Move In from each side, Scale, Pop
  ['wipe-r', 'Wipe from left'], ['wipe-l', 'Wipe from right'], ['wipe-d', 'Wipe from top'], ['wipe-u', 'Wipe from bottom'],
  ['move-in-r', 'Move in from left'], ['move-in-l', 'Move in from right'], ['move-in-d', 'Move in from top'], ['move-in-u', 'Move in from bottom'],
  ['scale-in', 'Scale'], ['pop-in', 'Pop'], ['line-draw', 'Line draw'],   // Line draw: lines and open drawings only (strokeOnly)
  // reveal's other fragment styles: out, dimmed, shown for one step only, and emphasis on something already there
  ['fade-out', 'Fade out'], ['line-erase', 'Line draw out'], ['semi-fade-out', 'Dim'], ['fade-in-then-out', 'Fade in, then out'], ['fade-in-then-semi-out', 'Fade in, then dim'],
  ['highlight-current-blue', 'Highlight while current'], ['grow', 'Grow'], ['shrink', 'Shrink'], ['strike', 'Strike through'],
  // Keynote's actions: Rotate by data-angle (degrees, negative counterclockwise; 360 by default), Pulse, Pop
  ['spin', 'Rotate'], ['pulse', 'Pulse'], ['pop', 'Pop (emphasis)'], ['move-to', 'Move']];
const effectOf = b => EFFECTS.find(([c]) => b.classList.contains(c))?.[0] || 'fade-in';
const animBoxes = () => boxes().filter(b => b.classList.contains('fragment'))
  .map((b, i) => [b, +(b.dataset.fragmentIndex ?? i), 'withPrevious' in b.dataset ? 1 : 0])
  .sort((a, z) => a[1] - z[1] || a[2] - z[2]).map(x => x[0]);   // within a step, the "with previous" ones follow
/* "With previous" shares the previous animation's step (same data-fragment-index); data-with-previous keeps the choice. */
const renumber = list => { let n = -1; list.forEach((b, i) => { if (!(i && 'withPrevious' in b.dataset)) n++; b.dataset.fragmentIndex = n; }); };
const openAnims = new Set();
/* Build timing, as Keynote: data-start="after" (After previous) or "transition" (after the slide's transition; the first
   build only), data-duration / data-delay in seconds, data-ease the acceleration. present.js plays them. */
const START_LABEL = { click: 'On click', with: 'With previous', after: 'After previous', transition: 'After transition' };
const EASES = [['', 'Acceleration: default'], ['linear', 'None'], ['ease-in', 'Ease in'], ['ease-out', 'Ease out'], ['ease-in-out', 'Ease in and out']];
const TIMING = ['start', 'duration', 'delay', 'ease', 'angle', 'to'];   // and Rotate's angle and Move's end, copied and removed with them
/* Delivery (data-build), as Keynote: a text box by paragraph, by highlighted paragraph (the earlier ones dim), by word
   or by character; a table by row, column or cell. present.js plays them. */
const DELIVERY_TEXT = [['', 'All at once'], ['paragraph', 'By paragraph'], ['highlight', 'By highlighted paragraph'], ['word', 'By word'], ['character', 'By character']];
const DELIVERY_TABLE = [['', 'All at once'], ['row', 'By row'], ['column', 'By column'], ['cell', 'By cell']];
const deliveries = b => isMedia(b) || isStroke(b) || isGroup(b) ? [] : content(b)?.querySelector('table') ? DELIVERY_TABLE : content(b)?.textContent.trim() ? DELIVERY_TEXT : [];
const startOf = b => 'withPrevious' in b.dataset ? 'with' : b.dataset.start || 'click';
function setStart(b, v) { delete b.dataset.withPrevious; delete b.dataset.start; if (v === 'with') b.dataset.withPrevious = ''; else if (v !== 'click') b.dataset.start = v; }
function setEffect(b, eff) { b.classList.remove(...EFFECTS.map(e => e[0])); b.classList.add('fragment', eff); if (b.dataset.shape) renderShape(b); if (eff === 'move-to' && !b.dataset.to) b.dataset.to = defaultTo(b); }   // (Line draw measures the stroke)
/* Keynote offers Line Draw only on drawings: here lines and open freehand paths. */
const STROKE_ONLY = ['line-draw', 'line-erase'], effectsFor = b => EFFECTS.filter(([v]) => isStroke(b) || !STROKE_ONLY.includes(v));
function addAnim() {   // boxes animated together (several selected) share one click: the first on click, the rest with previous
  const list = animBoxes();
  [...sel].filter(b => !b.classList.contains('fragment')).forEach((b, i) => { setEffect(b, 'fade-in'); if (i) b.dataset.withPrevious = ''; list.push(b); });
  renumber(list); commit(); renderAnims();
}
/* Edit → Copy animation / Paste animation, as Keynote: the effect, its delivery (by paragraph) and its start
   (on click or with previous) onto the selection. An object not yet animated joins the end of the order. */
let copiedAnim = null;
const animSel = () => [...sel].find(b => b.classList.contains('fragment'));
function copyAnim() {
  const b = animSel(); if (!b) return;
  copiedAnim = { eff: effectOf(b), build: b.dataset.build, withPrevious: 'withPrevious' in b.dataset, timing: Object.fromEntries(TIMING.map(k => [k, b.dataset[k]])) }; setStatus('Animation copied');
}
function pasteAnim() {
  if (!copiedAnim || !sel.size) return;
  const list = animBoxes(), { eff, build, withPrevious, timing } = copiedAnim;
  [...sel].forEach((b, i) => {
    const was = b.classList.contains('fragment');
    setEffect(b, eff);
    if (build && deliveries(b).some(([v]) => v === build)) b.dataset.build = build; else delete b.dataset.build;
    for (const k of TIMING) if (timing[k] != null) b.dataset[k] = timing[k]; else delete b.dataset[k];
    if (withPrevious || (i && !was)) { b.dataset.withPrevious = ''; delete b.dataset.start; } else delete b.dataset.withPrevious;
    if (!was) list.push(b);
  });
  renumber(list); commit(); renderAnims();
}
function removeAnim(b) {
  b.classList.remove('fragment', ...EFFECTS.map(e => e[0])); if (b.dataset.shape) renderShape(b); delete b.dataset.fragmentIndex; delete b.dataset.withPrevious; delete b.dataset.build; TIMING.forEach(k => delete b.dataset[k]);
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
  const all = animBoxes();
  host.replaceChildren(...all.map((b, i) => {
    const open = sel.has(b) || openAnims.has(b), start = startOf(b), step = +(b.dataset.fragmentIndex ?? i) + 1;
    // Keynote's Build Order: ⌘- or ⇧-click rows to edit several builds at once; a change in one open row goes to all of them
    const each = fn => { (sel.has(b) && sel.size > 1 ? all.filter(x => sel.has(x)) : [b]).forEach(fn); };
    const r = div('anim-row' + (sel.has(b) ? ' on' : '') + (open ? ' open' : '')); r.draggable = true; r.dataset.i = String(i);
    r.innerHTML = `<div class="anim-head"><span class="n icon" title="Drag to reorder">drag_indicator</span><span class="icon chev">chevron_right</span>
      <span class="step" title="Build ${step}">${step}</span><span class="eff"></span><span class="what"></span><button title="Delete animation"><span class="icon">delete</span></button></div>
      <div class="anim-body"><select class="e">${effectsFor(b).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <select class="t">${Object.entries(START_LABEL).filter(([v]) => v !== 'transition' || !i).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <div class="timing"><label>Duration (s)<input class="dur" type="number" min="0.1" max="20" step="0.1" placeholder="0.5"></label>
      <label>Delay (s)<input class="del" type="number" min="0" max="60" step="0.1" placeholder="0"></label></div>
      <div class="timing pos"><label>Position X (in)<input class="mx" type="number" step="0.01"></label><label>Y (in)<input class="my" type="number" step="0.01"></label></div>
      <label class="ang">Angle (°)<input type="number" min="-3600" max="3600" step="15" placeholder="360"></label>
      <select class="ease">${EASES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <select class="dl"></select></div>`;
    const when = start === 'with' ? `With build ${step}` : start === 'after' && i ? `After build ${step - 1}` : START_LABEL[start] || 'On click';   // Keynote names the build it follows
    const dl = deliveries(b), how = dl.find(([v]) => v && v === b.dataset.build)?.[1];
    r.querySelector('.eff').textContent = `${EFFECTS.find(e => e[0] === effectOf(b))[1]}${how ? ' ' + how.toLowerCase() : ''}  (${when})`;
    r.querySelector('.what').textContent = animLabel(b);
    const se = r.querySelector('select.e'), tr = r.querySelector('select.t'); se.value = effectOf(b); tr.value = start;
    se.onchange = () => { each(x => setEffect(x, se.value)); commit(); renderAnims(); };
    tr.onchange = () => { each(x => setStart(x, tr.value === 'transition' && x !== all[0] ? 'after' : tr.value)); renumber(animBoxes()); commit(); renderAnims(); };
    const num = (cls, key) => { const f = /** @type {HTMLInputElement} */ (r.querySelector(cls)); f.value = b.dataset[key] ?? '';
      f.onchange = () => { const v = parseFloat(f.value); each(x => { if (v >= 0 && isFinite(v)) x.dataset[key] = String(Math.round(v * 100) / 100); else delete x.dataset[key]; }); commit(); renderAnims(); }; };
    num('.dur', 'duration'); num('.del', 'delay');
    const ang = /** @type {HTMLElement} */ (r.querySelector('.ang')), af = /** @type {HTMLInputElement} */ (ang.firstElementChild);
    ang.hidden = effectOf(b) !== 'spin'; af.value = b.dataset.angle ?? '';
    const pos = /** @type {HTMLElement} */ (r.querySelector('.pos')), [mx, my] = /** @type {HTMLInputElement[]} */ ([...pos.querySelectorAll('input')]), [tx, ty] = moveTo(b);
    pos.hidden = effectOf(b) !== 'move-to'; mx.value = String(toIn(tx)); my.value = String(toIn(ty));
    mx.onchange = my.onchange = () => { const x = parseFloat(mx.value), y = parseFloat(my.value); if (!isFinite(x) || !isFinite(y)) return;
      b.dataset.to = `${Math.round(fromIn(x))},${Math.round(fromIn(y))}`; commit(); drawOverlay(); renderAnims(); };
    af.onchange = () => { const v = parseFloat(af.value); each(x => { if (isFinite(v)) x.dataset.angle = String(Math.round(v)); else delete x.dataset.angle; }); commit(); renderAnims(); };
    const ez = /** @type {HTMLSelectElement} */ (r.querySelector('select.ease')); ez.value = b.dataset.ease || '';
    ez.onchange = () => { each(x => { if (ez.value) x.dataset.ease = ez.value; else delete x.dataset.ease; }); commit(); renderAnims(); };
    const ds = /** @type {HTMLSelectElement} */ (r.querySelector('select.dl'));
    ds.hidden = !dl.length; ds.innerHTML = dl.map(([v, l]) => `<option value="${v}">${l}</option>`).join(''); ds.value = b.dataset.build || '';
    ds.onchange = () => { each(x => { if (ds.value && deliveries(x).some(([v]) => v === ds.value)) x.dataset.build = ds.value; else delete x.dataset.build; }); commit(); renderAnims(); };
    r.querySelector('.anim-head button').onclick = () => removeAnim(b);
    r.querySelector('.anim-head').onclick = e => {
      if (e.target.closest('button')) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey) { if (sel.has(b)) sel.delete(b); else sel.add(b); drawOverlay(); updateToolbar(); renderAnims(); return; }
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
/* Keynote's Move action (class move-to): the box moves to data-to="x,y" (its top-left at the end, in slide px) and stays
   there. With the Motion panel open, the selected box shows a ghost at the end joined centre to centre by a red line;
   dragging the ghost sets the end (with a readout), and moving the box keeps it. present.js plays it as a translate. */
function defaultTo(b) {   // beside the box, as Keynote (to its right, or its left when there's no room)
  const g = geo(b), right = Math.min(g.x + g.w + 60, W - g.w);
  return `${Math.round(right > g.x + g.w / 2 ? right : Math.max(0, g.x - g.w - 60))},${Math.round(g.y)}`;
}
function moveTo(b) { const [x, y] = (b.dataset.to || '').split(',').map(Number); if (isFinite(x) && isFinite(y) && b.dataset.to) return [x, y]; const g = geo(b); return [g.x, g.y]; }
function drawMovePath() {
  if (trans.hidden || sel.size !== 1 || editing) return;
  const b = [...sel][0]; if (!b.classList.contains('move-to')) return;
  const g = geo(b), host = frameFor(b), k = 1 / scale; let [tx, ty] = moveTo(b);
  const gh = /** @type {HTMLElement} */ (b.cloneNode(true)); gh.removeAttribute('id'); gh.classList.remove('fragment'); gh.classList.add('move-ghost');
  gh.querySelectorAll('[id]').forEach(e => e.removeAttribute('id')); gh.title = 'Drag to set where the Move ends';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  svg.classList.add('move-line'); svg.append(ln); ln.setAttribute('stroke-width', String(2 * k));
  const at = () => { gh.style.left = tx + 'px'; gh.style.top = ty + 'px';
    ln.setAttribute('x1', String(g.x + g.w / 2)); ln.setAttribute('y1', String(g.y + g.h / 2)); ln.setAttribute('x2', String(tx + g.w / 2)); ln.setAttribute('y2', String(ty + g.h / 2)); };
  at(); host.append(svg, gh);
  gh.onmousedown = e => e.stopPropagation();
  gh.onpointerdown = e => {
    e.stopPropagation(); e.preventDefault(); gh.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY, x0 = tx, y0 = ty, tip = div('move-tip'); tip.style.setProperty('--k', k + 'px'); host.append(tip);
    gh.onpointermove = m => { tx = Math.round(x0 + (m.clientX - sx) / scale); ty = Math.round(y0 + (m.clientY - sy) / scale); at();
      tip.textContent = `x ${toIn(tx)} in  y ${toIn(ty)} in`; tip.style.left = tx + g.w / 2 + 'px'; tip.style.top = ty + g.h / 2 + 'px'; };
    gh.onpointerup = () => { gh.onpointermove = gh.onpointerup = null; tip.remove(); b.dataset.to = `${tx},${ty}`; commit(); drawOverlay(); renderAnims(); };
  };
}
/* Preview: the slide's animations one after another on the canvas. */
async function playAnims() {
  const kf = { appear: [{ opacity: 0 }, { opacity: 0, offset: .99 }, { opacity: 1 }], 'fade-in': [{ opacity: 0 }, { opacity: 1 }],
    'fade-right': [{ opacity: 0, translate: '-20% 0' }, { opacity: 1, translate: '0 0' }], 'fade-left': [{ opacity: 0, translate: '20% 0' }, { opacity: 1, translate: '0 0' }],
    'fade-up': [{ opacity: 0, translate: '0 20%' }, { opacity: 1, translate: '0 0' }], 'fade-down': [{ opacity: 0, translate: '0 -20%' }, { opacity: 1, translate: '0 0' }],
    'zoom-in': [{ opacity: 0, scale: .1 }, { opacity: 1, scale: 1 }], 'fade-out': [{ opacity: 1 }, { opacity: 0 }], 'semi-fade-out': [{ opacity: 1 }, { opacity: .5 }],
    'fade-in-then-out': [{ opacity: 0 }, { opacity: 1, offset: .3 }, { opacity: 1, offset: .7 }, { opacity: 0 }], 'fade-in-then-semi-out': [{ opacity: 0 }, { opacity: 1, offset: .4 }, { opacity: .5 }],
    'highlight-current-blue': [{ color: 'inherit' }, { color: '#1b6ac9' }, { color: 'inherit' }], grow: [{ scale: 1 }, { scale: 1.3 }, { scale: 1 }],
    shrink: [{ scale: 1 }, { scale: .7 }, { scale: 1 }], strike: [{ textDecoration: 'none' }, { textDecoration: 'line-through' }],
    'wipe-r': [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0)' }], 'wipe-l': [{ clipPath: 'inset(0 0 0 100%)' }, { clipPath: 'inset(0)' }],
    'wipe-d': [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0)' }], 'wipe-u': [{ clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0)' }],
    'move-in-r': [{ translate: `-${W}px 0` }, { translate: '0 0' }], 'move-in-l': [{ translate: `${W}px 0` }, { translate: '0 0' }],
    'move-in-d': [{ translate: `0 -${H}px` }, { translate: '0 0' }], 'move-in-u': [{ translate: `0 ${H}px` }, { translate: '0 0' }],
    'scale-in': [{ scale: 0 }, { scale: 1 }], 'pop-in': [{ scale: 0 }, { scale: 1.12, offset: .6 }, { scale: .96, offset: .8 }, { scale: 1 }],
    pulse: [{ scale: 1 }, { scale: 1.15 }, { scale: 1 }], pop: [{ scale: 1 }, { scale: 1.25, offset: .3 }, { scale: .95, offset: .6 }, { scale: 1 }] };
  const spin = b => [{ rotate: '0deg' }, { rotate: (b.dataset.angle ?? 360) + 'deg' }];
  const move = b => { const g = geo(b), [x, y] = moveTo(b); return [{ translate: '0 0' }, { translate: `${x - g.x}px ${y - g.y}px` }]; };
  const list = animBoxes(), wait = ms => new Promise(r => setTimeout(r, ms));
  list.forEach(b => { b.style.visibility = 'hidden'; });
  const steps = []; list.forEach(b => { if (startOf(b) === 'with' && steps.length) steps.at(-1).push(b); else steps.push([b]); });   // one step per click or After previous
  for (const [i, step] of steps.entries()) {
    if (i && !['after', 'transition'].includes(startOf(step[0]))) await wait(250);   // a click, in the preview
    if (['after', 'transition'].includes(startOf(step[0]))) await wait((+step[0].dataset.delay || 0) * 1000);
    await Promise.all(step.map(b => { b.style.visibility = '';
      const ln = STROKE_ONLY.includes(effectOf(b)) && b.querySelector('svg.shape path.l[pathLength]');   // Line draw: the stroke draws (or undraws)
      if (ln) { ln.style.strokeDasharray = '1 1'; const draw = [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }];
        return ln.animate(effectOf(b) === 'line-draw' ? draw : draw.reverse(), { duration: (+b.dataset.duration || 0.5) * 1000, easing: b.dataset.ease || 'ease' }).finished.then(() => { ln.style.strokeDasharray = ''; }); }
      return b.animate(effectOf(b) === 'spin' ? spin(b) : effectOf(b) === 'move-to' ? move(b) : kf[effectOf(b)], { duration: (+b.dataset.duration || 0.5) * 1000, delay: startOf(b) === 'with' || startOf(b) === 'click' ? (+b.dataset.delay || 0) * 1000 : 0, easing: b.dataset.ease || 'ease', fill: 'backwards' }).finished; }));
  }
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
    zoom: [{ transform: 'scale(.2)', opacity: 0 }, { transform: 'none', opacity: 1 }],
    'sl-up': [{ transform: 'translateY(100%)' }, { transform: 'none' }], 'sl-down': [{ transform: 'translateY(-100%)' }, { transform: 'none' }],
    'wipe-r': [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0)' }], 'wipe-l': [{ clipPath: 'inset(0 0 0 100%)' }, { clipPath: 'inset(0)' }],
    'wipe-d': [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0)' }], 'wipe-u': [{ clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0)' }],
    'move-in-r': [{ transform: 'translateX(-100%)' }, { transform: 'none' }], 'move-in-l': [{ transform: 'translateX(100%)' }, { transform: 'none' }],
    'move-in-d': [{ transform: 'translateY(-100%)' }, { transform: 'none' }], 'move-in-u': [{ transform: 'translateY(100%)' }, { transform: 'none' }] }[k];
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
