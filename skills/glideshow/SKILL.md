---
name: glideshow
description: Make or edit slide decks with Glideshow (reveal.js decks of positioned boxes, one folder each, usually in ~/decks). Use whenever the user asks for slides, a deck, a presentation, a talk, a lab-meeting update or "a slide about …", or asks to change or add to an existing Glideshow deck. Not for Google Slides files or .pptx output.
---

A deck is one folder, usually `~/decks/<slug>/` (or a subfolder of it), holding `deck.html` (a reveal.js file) and
`assets/`. You write its slides with `glideshow put`, one `<section>` at a time; never read `deck.html` itself (it is
~180 KB of inlined CSS/JS). If the editor has the deck open, it reloads within a second and keeps what you wrote. The
background server (any of `new --no-open`, `slides`, `put`, `check`, `render`, `figure` starts it if needed; nothing
opens) makes every change a version in the deck's history, so nothing you do is lost.

Everything below uses the `glideshow` command. If the shell can't find it, Glideshow isn't installed on this computer;
say so and stop.

## Read first
1. `glideshow docs`: the guide and recipes (the commands, layout grid, colours, title + bullets, boxes in a row or grid,
   a diagram with connectors, a plot from a script, an equation, a callout on an image, Morph, speaker notes). Read it every
   time. `glideshow docs reference` is the full format reference (every `data-shape` preset, lines and connectors, images
   and crop, groups, layouts and placeholders, the theme block, notes, fragments): read it only when you need an
   attribute the guide doesn't show.
2. If the deck exists, read its outline before changing it: `glideshow slides <deck> --outline` (one line per slide: number,
   layout, title, each box's id and first words). Then `glideshow slides <deck> N` for the HTML of only the slides you
   will change. The outline shows `NOTE` stickies in full: they are instructions from the user; do them, then delete the
   note. Run `glideshow comments <deck>` too: the open comments (from the user and people the deck was shared with), each
   on the slide it's on now. Slide numbers: N in the file; the editor's 8.1 (a stack's sub-slide) works too.
3. When the user says "this", "here" or "the selected …", run `glideshow selection` first: it prints the deck open in the
   editor, the slide on show and the selected boxes (ids and text). Edit those. If it exits 1, no editor window is open:
   ask which slide they mean.

## Making a deck
- New deck: `glideshow new "<title>" --no-open` creates `~/decks/<slug>-<date>/deck.html` from the template (a title
  slide, the Simple Light theme) with an `AGENTS.md` beside it, and prints its folder; the user's editor is left alone.
  Never copy the template by hand.
- Find an existing deck: `glideshow find <words from its name>` prints its folder (nothing is opened).
- Write slides with **put**: `glideshow put <deck> --after N <<'EOF' … EOF` inserts the `<section>`s (several at once is
  fine; `--after 0` puts them first), `glideshow put <deck> N` replaces slide N (edit what `slides <deck> N` printed and
  send it back), `glideshow put <deck> --delete N …` removes slides, `glideshow put <deck> --all` replaces every slide
  (a script that builds the whole deck pipes its slides into it; never let a script rewrite `deck.html` itself). It refuses, writing nothing, on an unclosed `<div>`,
  an id the deck already uses or a copied `data-sid`; fix and send again.
- Use the **layouts**: `glideshow layout <name> --prefix <slide-name> --deck <deck>` prints a slide in that layout (its
  placeholder boxes at their exact places, with ids the deck doesn't use yet); replace the placeholders' text and put it. `glideshow layout` lists the layouts. Free boxes are fine for diagrams and figures. A deck imported from Google
  Slides styles its text inline, not by the theme: add `--like <N>` to copy slide N's title and body styles, so a new
  slide matches the deck.
- Boxes in a row, column or grid: give them the same `data-flow="row"` (or `"column"`, `"grid 3"`, then optionally an
  area `x,y,w,h` and `gap N`) and no geometry; `put` works out their pixels. Lines attached with `data-from`/`data-to`
  need no geometry either.
- Prefer `data-shape` presets, lines with `data-from`/`data-to` for diagrams, `.box.image` for pictures saved into
  `assets/`, and `<aside class="notes">` for what to say. Never hand-write SVG, `--tx-*` or `--sh*` variables, or
  editor-only attributes.
- Plots: `glideshow figure size <deck> --slide N` gives the figsize that fits the space and a script to start from (it
  declares its dependencies, uses the deck's `deck.mplstyle`, and saves with `glideshow.figure.save`, which lets `check`
  see the figure's labels); keep the script in the deck's `src/`, save into its `assets/`, then `glideshow figure add
  <deck> assets/fig.png --slide N --id <id> --alt "<what it shows>" --source "<command that makes it, {out} = the
  picture's path>"`. To update it: `glideshow figure refresh <deck> <id>`
  re-runs that command, or `glideshow figure add <deck> new.png --replace <id>` swaps a picture in place.
- Diagrams: attach arrows with `data-from` / `data-to` ("id:b"); they follow their boxes when the deck loads, so you never
  recompute an arrow after moving a box. Both ends on the same side (`a:b` → `c:b`, an elbow) draw a U (a feedback edge);
  write arrows in the direction they mean, the head on `data-end`.
- Equations are LaTeX inside `$$…$$` in a box; code goes in `<pre><code class="language-python">`.
- Beyond static slides (all in `glideshow docs`): **Morph** to build a diagram up step by step (one slide per step, ids unique in
  the deck; each later step has `data-auto-animate` and `data-morph="<id on the slide before>"` on boxes that carry over;
  the recipe in `glideshow docs`); build effects such as `fade-in-then-semi-out` with
  `data-build="paragraph"` to walk through bullets; pictures stacked to replace each other in place; a **live box** (an
  HTML page with its own script in `assets/`, sandboxed) for a demo or simulation; video or web-page backgrounds; a
  slide's own `<style class="slide-css" media="not all">`.
- One idea per slide, at most about six body lines, text at least 24 px (1 pt = 2.667 px). Every box has a unique `id`.

## Check your work
`glideshow check <deck> [N …]` (about two seconds) lists every problem: text spilling out of a box, code cut off, boxes
off the slide, text overlapping text, pictures or lines, text under 24 px or with too little contrast, pictures squeezed
into a box of another shape or without alt text, missing or duplicate ids, broken arrows, Morph steps with no partner,
notes left over, broken structure, and inside figures saved with `glideshow.figure.save`: labels overlapping or cut off,
small text, missing characters. Fix them until it says "no problems found". Then look, cheaply: `glideshow render <deck>
--sheet` puts nine slides in each picture (for balance and alignment across the deck); `glideshow render <deck> N …`
renders single slides at 960 × 540 (`--full` for 1920 × 1080 when you need to read small text). Render only the slides you
changed. If the user has the editor open, tell them which slides changed.

## Checklist before you stop
- slides written with `glideshow put`; every box has a unique `id`; geometry only in inline `left/top/width/height` (or `data-flow`)
- no SVG, no `--tx-*`/`--sh*`, no editor-only attributes written by hand
- text lives in `.content`; pictures in `assets/`, with `alt`
- placeholders used for titles and body text where a layout fits; `data-layout` set
- notes done and deleted; `glideshow check` says "no problems found" and you looked at `glideshow render --sheet` (or the changed slides)

Don't commit; the editor's own save commits when the deck is in a git repo.
