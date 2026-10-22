/* ---------- who else is here (glideshow.org) ---------- */
/* Everyone else with this deck open: their initials by Share (a click goes to their slide), a dot with their initials
   on the slide each is on in the filmstrip, and a ring in their colour round the boxes each has selected, with their
   name on the one they are typing in. That box is theirs while they type: others can still select and move it, but
   not type in it (startEdit asks typingIn). It all comes over the live WebSocket (boot.js live; cloud/library.js
   tellPeople); without one (the Mac, a library in the browser) there is nobody else to show. */
/** @type {{id: string, k: string, n: string, sid: string, box: string, sel: string[]}[]} */
let people = [];
let meId = '', hereKey = '';
const PERSON_COLORS = ['#e8710a', '#1e8e3e', '#a142f4', '#d01884', '#129eaf', '#c5221f', '#7b5800', '#b06000'];   // (no blue: that's your own selection)
const personColor = k => PERSON_COLORS[parseInt(hashStr(k), 36) % PERSON_COLORS.length];
const initials = n => (String(n).trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();
/* Others: not this window, nor another window of the same person (one person, one face). */
const others = () => { const mine = people.find(p => p.id === meId)?.k, seen = new Set(); return people.filter(p => p.id !== meId && p.k !== mine && !seen.has(p.k) && seen.add(p.k)); };
/** The person typing in box `b` on the slide on show, if someone else is. */
const typingIn = b => others().find(p => p.box && p.box === b?.id && p.sid === slides[cur]?.dataset.sid);

function setPeople(list) { people = Array.isArray(list) ? list : []; drawPeople(); }

/* Where this editor is (the slide on show, the boxes selected, the one being typed in), sent when it changes. */
function sendHere() {
  if (!liveSocket || liveSocket.readyState !== 1 || !meId || !slides.length) return;
  const here = { sid: slides[cur]?.dataset.sid || '', box: editing?.id || '', sel: [...sel].filter(b => b.isConnected && b.id).map(b => b.id).slice(0, 20) };
  const key = JSON.stringify(here);
  if (key === hereKey) return;
  hereKey = key;
  try { liveSocket.send(JSON.stringify({ here })); } catch {}
}

function drawPeople() {
  const list = others(), bar = $('#ed-people');
  bar.hidden = !list.length;
  bar.replaceChildren(...list.map(p => {
    const b = document.createElement('button'), at = slides.findIndex(s => s.dataset.sid === p.sid);
    b.className = 'person'; b.textContent = initials(p.n); b.style.setProperty('--c', personColor(p.k));
    b.dataset.tip = p.n + (at >= 0 ? ` · slide ${at + 1}` : '');
    b.setAttribute('aria-label', b.dataset.tip);
    b.onclick = () => { const i = slides.findIndex(s => s.dataset.sid === p.sid); if (i >= 0) go(i); };
    return b;
  }));
  drawPeopleThumbs(); drawPeopleOn();
}
/* The filmstrip: a dot for each person on the slide they're on. */
function drawPeopleThumbs() {
  thumbs.querySelectorAll('.thumb-people').forEach(e => e.remove());
  const by = new Map();
  for (const p of others()) { const i = slides.findIndex(s => s.dataset.sid === p.sid); if (i >= 0) by.set(i, [...(by.get(i) || []), p]); }
  for (const [i, ps] of by) {
    const t = thumbs.children[i]; if (!t) continue;
    const row = div('thumb-people');
    row.append(...ps.map(p => { const d = div('person'); d.textContent = initials(p.n); d.title = p.n; d.style.setProperty('--c', personColor(p.k)); return d; }));
    t.append(row);
  }
}
/* The slide on show: a ring round each box someone else has selected; the box they type in also carries their name. */
function drawPeopleOn() {
  const layer = $('#ed-people-on'), s = slides[cur];
  if (!layer || !people.length && !layer.childElementCount) return;
  layer.replaceChildren();
  if (!s) return;
  const rc = canvas.getBoundingClientRect(), k = 1 / scale;
  for (const p of others()) {
    if (p.sid !== s.dataset.sid) continue;
    for (const id of new Set([...(p.sel || []), ...(p.box ? [p.box] : [])])) {
      const b = [...s.querySelectorAll('.box')].find(x => x.id === id); if (!b) continue;
      const r = b.getBoundingClientRect(), o = div('person-ring' + (id === p.box ? ' typing' : ''));
      place(o, { x: (r.left - rc.left) * k, y: (r.top - rc.top) * k, w: r.width * k, h: r.height * k });
      o.style.setProperty('--c', personColor(p.k)); o.style.setProperty('--k', k + 'px');
      if (id === p.box) { const tag = div('person-tag'); tag.textContent = p.n; o.append(tag); }
      layer.append(o);
    }
  }
}
