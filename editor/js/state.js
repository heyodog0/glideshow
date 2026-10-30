'use strict';
/* Slide editor. The deck is deck.html: each <section> is a 1920×1080 slide whose children are
   absolutely positioned .box elements. The editor owns box geometry and styling; anything
   inside a box's .content is free HTML. Saves go through /api/save with the file's mtime, so an
   agent editing deck.html at the same time is never silently overwritten. */

let W = 1920, H = 1080;   // the page size: data-size on the deck's .slides (File → Page setup)
const THUMB_W = 158, CLIP = 'slides-boxes:', SLIDE_CLIP = 'glideshow-slides:';
/** @type {(s: string) => any} */
const $ = s => document.querySelector(s);   // any: an element of whatever kind the selector names
// The server takes a POST only with X-Glideshow (other websites can't send it; see server.py `allowed`).
const _fetch = window.fetch.bind(window);
window.fetch = (u, o = {}) => _fetch(u, (o.method || 'GET').toUpperCase() === 'POST' ? { ...o, headers: { 'X-Glideshow': '1', ...(o.headers || {}) } } : o);

const stage = $('#ed-stage'), frame = $('#ed-frame'), canvas = $('#ed-canvas'), ui = $('#ed-ui'), guides = $('#ed-guides'), thumbs = $('#ed-thumbs');

let BASE_CSS = '', SHAPES_JS = '', PRESENT_JS = '';
let deckDoc = null, slides = [], cur = 0, sel = new Set(), editing = null, editStart = '', editFloor = 0, lastRange = null;
let mtime = null, scale = 1, busy = false, saving = false, saveTimer = null, pendingReload = false;
let hist = [], hptr = -1;
let remoteBy = '';   // who made the change coming in from elsewhere, when the live link says (glideshow.org; boot.js remoteVersion)

const uid = () => 'b' + Math.random().toString(36).slice(2, 8);
const boxes = (s = slides[cur]) => [...s.children].filter(e => e.classList.contains('box') && !e.hasAttribute('data-from-layout'));   // (a layout's objects on the slide aren't the slide's: theme.js)
const isGroup = b => b.classList.contains('group');
/* A group has no text of its own: text commands on it write to a detached stand-in, i.e. do nothing. */
const NO_CONTENT = document.createElement('div');
const content = b => b.querySelector(':scope > .content') || (isGroup(b) ? NO_CONTENT : null);
const kids = g => [...g.children].filter(e => e.classList.contains('box'));   // a group's member boxes
/* The box a click lands on: a group as a whole, not one of its members (as Slides), unless the click is
   inside the group the user has entered by double-clicking (`scope`), where members are picked one by one. */
let scope = null;
const parentBox = b => b?.parentElement?.closest('#ed-canvas .box') || null;
const topBox = el => { let b = el?.closest?.('#ed-canvas .box'); while (parentBox(b) && parentBox(b) !== scope) b = parentBox(b); return b; };
/* A group always hugs its members, as Slides: after members move or resize, its bounds follow them
   (members are shifted so the group's top-left stays their origin); a group left empty is removed. */
function fitGroups(s = slides[cur]) {
  for (const g of [...s.querySelectorAll('.box.group')].reverse()) {   // innermost first
    const ks = kids(g); if (!ks.length) { if (scope === g) scope = null; g.remove(); continue; }
    const bb = bbox(ks.map(aabb)), o = geo(g);
    if (Math.abs(bb.x) < .05 && Math.abs(bb.y) < .05 && Math.abs(bb.w - o.w) < .05 && Math.abs(bb.h - o.h) < .05) continue;
    ks.forEach(k => { const q = geo(k); setGeo(k, { ...q, x: q.x - bb.x, y: q.y - bb.y }); });
    Object.assign(g.style, { left: r1(o.x + bb.x) + 'px', top: r1(o.y + bb.y) + 'px', width: r1(bb.w) + 'px', height: r1(bb.h) + 'px' });
  }
}
const isLine = b => /^(line|arrowline|elbow|curve)$/.test(b.dataset.shape || '');
const isLocked = b => b.hasAttribute('data-locked');   // Arrange → Lock: can't be moved, resized, edited or deleted until unlocked
const isMedia = b => b.classList.contains('image') || b.classList.contains('video') || b.classList.contains('audio') || b.classList.contains('embed') || b.classList.contains('live');   // pictures, videos, web embeds: no text, aspect kept
const isStroke = b => isLine(b) || (b.dataset.shape === 'path' && !/z\s*$/i.test(b.dataset.path || ''));   // lines and open freehand paths: a stroke, no fill or text (a closed path is a shape)
const r1 = v => Math.round(v * 10) / 10;
const div = (cls) => { const d = document.createElement('div'); d.className = cls; return d; };
/* Status next to the title, worded as Slides. `icon` is a Material Symbols name (cloud states) or none. */
function setStatus(t, icon = '') {
  if (!t && document.body.classList.contains('draft')) [t, icon] = ['Not saved: add a title', 'cloud_off'];   // a draft keeps saying so
  const el = $('#ed-status');

  el.innerHTML = '<span class="icon"></span><span class="status-text"></span>';
  el.firstChild.textContent = icon; el.lastChild.textContent = t;
}
