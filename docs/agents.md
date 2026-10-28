# Writing slides as an agent

A deck is one folder: `deck.html` (reveal.js) plus `assets/`. Every slide is a `<section>` inside `<div class="slides">`;
everything on it is an absolutely positioned `<div class="box">` whose inline `left / top / width / height` are px on a
1920 × 1080 canvas (192 px = 1 in, 1 pt = 2.667 px). The full attribute reference is `glideshow docs reference` (the
**Deck format** section of AGENTS.md).

`deck.html` also carries about 180 KB of inlined CSS and JS: don't read it. Read a deck with `glideshow slides <deck>
--outline` (one line per slide: its layout, title, and each box's id and first words), then `glideshow slides <deck> N`
for the slides you change. Write slides with `glideshow put` (below): it sends only the `<section>`, checks it, and
writes `deck.html` in one go; the editor reloads it live and keeps what you write.

**Slide numbers.** N is a slide's number in the file (1, 2, 3 …, a stack's sub-slides counted in order). The editor
numbers a stack's sub-slides 8.1, 8.2; every command takes that form too (`glideshow slides <deck> 8.1`), and the
outline and `check` show both where they differ (`9 = 8.1`).

## The commands you need

| command | what it does |
|---|---|
| `glideshow new "Title" --no-open` | makes `~/decks/<slug>-<date>/` from the template and prints the folder; the user's editor is left alone |
| `glideshow find <words>` | prints the folder of the deck that best matches; nothing is opened |
| `glideshow slides <deck> --outline` | one line per slide: its number, layout, title, each box's id and first words, notes for you in full |
| `glideshow slides <deck> [N …]` | those slides' HTML (numbered, with their line in `deck.html`) |
| `glideshow put <deck> N` | replaces slide N with the `<section>`s on stdin; `--after N` inserts (0: first), `--delete N …` removes, `--all` replaces every slide |
| `glideshow layout [NAME]` | the layouts' exact placeholder boxes; with a name, a slide in that layout to fill in |
| `glideshow check <deck> [N …]` | only the problems, in about two seconds; exit status 1 when there are any |
| `glideshow render <deck> [N …]` | each slide as a 960 × 540 PNG (one path per line; `--full`: 1920 × 1080), then the problems |
| `glideshow render <deck> --sheet` | nine slides to a picture, each labelled with its number: a whole deck in a few pictures |
| `glideshow figure add <deck> <png> --slide N` | places a picture (or `--replace <id>` swaps one in place), recording `--source "<command>"` |
| `glideshow figure size <deck> --slide N` | the figure size that fits that space exactly, a script to start from, and the deck's `deck.mplstyle` |
| `glideshow figure refresh <deck> [id …]` | re-runs each figure's recorded command and puts the new picture in place |
| `glideshow selection` | what the user is looking at and has selected in the editor (exit 1 if no editor window reports) |
| `glideshow comments <deck>` | the open comments, each on the slide it's on now |
| `glideshow stop` | stops the background server |

`render` and `check` show each slide as it looks after its last build step (transitions and Morph off), and report: text
spilling out of its box, code cut off, boxes reaching off the slide, text overlapping other text (a label inside a shape
with words of its own too), text partly over a picture or crossed by a line, text under 24 px or hard to see against its
background, pictures that didn't load, lack alt text or are squeezed into a box of another shape, boxes without ids or
with duplicate ids, lines attached to boxes that aren't there (or to a side that isn't t/r/b/l), Morph pairings with no
partner, notes for the AI still on a slide, and broken structure (a `<div>` or `<section>` left open or closed twice).
Inside a figure saved with `glideshow.figure.save` they also report labels that overlap or are cut off at its edge, text
under 24 px on the slide and characters its font lacks. Fix what they report, then look: `render <deck> --sheet` for the
whole deck (balance, alignment), single slides only for the ones you changed.

**Versions.** `glideshow new --no-open`, `slides`, `put` and `figure add / refresh` start the background server if it isn't
running (nothing opens). It commits every change you make to a deck as its own version, a few seconds after you stop
writing, so nothing you do is lost and the user can step back through it.

## Working beside the open editor

- **"This", "here", "the selected box":** run `glideshow selection` (`--json` for the raw form). It prints the deck the
  editor has open, the slide on show (1-based, stacks counted as slides), how long ago the editor reported it, and each
  selected box: its `id`, its place among the slide's boxes, geometry and text, plus any text selected while editing.
  Change that box (find it by `id`), not a guess. Nothing selected means the whole slide. If it exits 1, no editor window
  is open: ask the user which slide they mean.
- **Your edit shows up at once:** the editor reloads, goes to the first changed slide (if the one on show didn't change),
  flashes the changed slides in the filmstrip and outlines the changed boxes. `put` writes the whole file in one go; if you
  write `deck.html` yourself, do the same (a temporary file renamed over it), not piece by piece.
- **The user can take it back:** your edit is one undo step in the editor (⌘Z), and the server commits it as its own
  version (`outside the editor: slide 3: …`) a few seconds after you stop writing, apart from the user's own changes.
- **The user's unsaved change:** the editor saves when its window loses focus, so what the user just did is on disk
  before you start. If you both change the deck at once, the editor keeps both when they touched different slides.
- **Comments:** people the deck was shared with (glideshow.org), and the user, leave comments in `comments.json` beside
  `deck.html`: `{"comments": [{"id", "slide", "sid", "box", "quote", "text", "by", "resolved", "replies": [...]}]}`.
  `sid` is the slide's `data-sid` (it finds the slide however slides have moved since), `slide` its number when the
  comment was left, `box` the id it was left on. `glideshow comments <deck>` lists the open ones on the slides they're on
  now. To answer one, make the change, then add a reply and, when it's done, set `"resolved": true` (leave its `slide` and
  `sid` as they are):
  ```json
  {"id": "r7k2m9qa", "text": "Added the citation as a footnote on slide 4.", "by": {"n": "Claude"}, "at": "2026-10-15T14:30:00Z"}
  ```
  (`id`: 8 random lowercase letters and digits; `at`: ISO 8601 UTC.)
- **Notes for the AI:** the user can leave a yellow sticky on a slide for you. It is a box with the class `note`:
  ```html
  <div class="box note" id="note-1" data-time="2026-10-15T14:02" style="left: 1400px; top: 60px; width: 420px; height: 200px;"><div class="content">Make this plot bigger and drop the legend</div></div>
  ```
  Do what each note says, then delete it. `check` lists any left over; the slideshow never shows them.

## Layouts

Every slide has a layout (`data-layout` on its `<section>`), and the layout's text lives in **placeholder boxes**
(`data-placeholder` + `data-role` title / sub / body) at exactly these places. Use them for titles and body text, so the
deck stays consistent and the editor's Layout menu works; put figures, diagrams and other free boxes anywhere else.
Text sizes come from the theme (`--th-title-size`, `--th-body-size`); don't override them unless you mean to.

{{LAYOUTS}}

`glideshow layout title-body --prefix results` prints a whole slide in that layout, ready to fill in and `put`, its ids starting
`results-` (ids must be unique in the whole deck; with `--deck <deck>` it also avoids ids the deck already uses, and
follows a theme that edits its layouts). Replace each placeholder's text, keep its box, and give every box you add its
own unique id.

**A deck imported from Google Slides** (or any deck whose slides set their own fonts, sizes and colours) doesn't follow
the theme: its boxes carry their styles inline. To add a slide that matches it, take a layout's places and the deck's
look from a slide you name: `glideshow layout title-body --prefix summary --deck <deck> --like 4` copies slide 4's title
and body text styles (font, size, colour, line spacing) into the new placeholders.

**Colours.** The default theme (Simple Light) uses titles `#000000`, text `#595959` and a white background; text you add
inherits them. Accents that sit well with it: blue `#1a73e8` (fill `#e8f0fe`), red `#d93025` (fill `#fce8e6`), green
`#188038` (fill `#e6f4ea`), yellow `#f9ab00` (fill `#fef7e0`), grey rules `#dadce0`. Shapes take `--fill`, `--stroke`,
`--sw` (outline width, px).

**Sizes.** Keep body text at 24 px (9 pt) or more, at most about six lines of it per slide, one idea per slide.

## Recipes

**Title and bullets** (from `glideshow layout title-body --prefix results`), added after slide 3:
```sh
glideshow put <deck> --after 3 <<'EOF'
<section data-background-color="#ffffff" data-layout="title-body">
  <div class="box" id="results-title" data-placeholder="Click to add title" data-role="title" data-valign="top" style="left: 65px; top: 93px; width: 1790px; height: 122px;"><div class="content" style="font-size: calc(var(--th-title-size, 74.67px) * 1); text-align: left; padding: 9.6px 19.2px;">Results</div></div>
  <div class="box" id="results-body" data-placeholder="Click to add text" data-role="body" data-valign="top" style="left: 65px; top: 242px; width: 1790px; height: 721px;"><div class="content" style="font-size: calc(var(--th-body-size, 48px) * 1); text-align: left; padding: 9.6px 19.2px;">
    <ul><li>Agents learn the task in 2 k steps</li><li>Transfer holds across seeds</li></ul></div></div>
</section>
EOF
```
`put` prints the new slide's outline line and the `check` to run. To change a slide, `glideshow slides <deck> N`, edit
that, and `glideshow put <deck> N` it back (its `data-sid` is kept). It refuses, writing nothing, when a `<div>` isn't
closed, an id is already used elsewhere in the deck, or a slide carries another slide's `data-sid`. A script that builds
the whole deck prints its `<section>`s and pipes them into `glideshow put <deck> --all`; don't let it rewrite `deck.html`
(a pattern that cuts the file at the wrong `</div>` leaves slides outside the deck).

**Boxes in a row, a column or a grid** (no pixels to work out): give the boxes the same `data-flow` and leave out their
`left / top / width / height`; `put` lays them out in the slide's body area, equal sizes 40 px apart, and writes their
pixels. `data-flow="row"`, `"column"` or `"grid 3"` (3 to a row), then optionally an area (`body`, or `x,y,w,h`) and a
gap: `data-flow="row 65,400,1790,240 gap 120"`. Boxes with another `data-flow` value form another group. Lines attached
with `data-from` / `data-to` need no place either.
```html
<div class="box" id="p-collect" data-shape="roundrect" data-flow="row 65,400,1790,240 gap 120" style="--fill: #e8f0fe;"><div class="content" style="font-size: 40px;">Collect</div></div>
<div class="box" id="p-train" data-shape="roundrect" data-flow="row 65,400,1790,240 gap 120" style="--fill: #e8f0fe;"><div class="content" style="font-size: 40px;">Train</div></div>
<div class="box" id="p-arrow" data-shape="line" data-end="fill-arrow" data-from="p-collect:r" data-to="p-train:l" style="--stroke: #5f6368; --sw: 5px;"><div class="content"></div></div>
```

**Two columns:** `glideshow layout two-columns --prefix compare` (two body placeholders, `compare-body` and `compare-body-2`).

**A diagram: nodes and arrows.** Give nodes ids and attach each arrow with `data-from` / `data-to` = `"id:t|r|b|l"` (the
middle of that side). Attached lines are fitted to their nodes whenever the deck loads, in the editor and the slideshow,
so move a node and its arrows follow; the geometry you write for the line only matters if an end isn't attached.
```html
<div class="box" id="env" data-shape="roundrect" style="left: 160px; top: 440px; width: 400px; height: 200px; --fill: #e8f0fe; --stroke: #1a73e8; --sw: 3px;"><div class="content" style="font-size: 44px;">Environment</div></div>
<div class="box" id="agent" data-shape="roundrect" style="left: 1360px; top: 440px; width: 400px; height: 200px; --fill: #fce8e6; --stroke: #d93025; --sw: 3px;"><div class="content" style="font-size: 44px;">Agent</div></div>
<div class="box" id="env-to-agent" data-shape="line" data-end="fill-arrow" data-from="env:r" data-to="agent:l" style="left: 560px; top: 540px; width: 800px; height: 0px; --stroke: #5f6368; --sw: 4px;"><div class="content"></div></div>
```
A step-shaped connector is `data-shape="elbow"` (`data-bend` 0..1 slides its middle segment). **A feedback edge** under a
pipeline (from the bottom of the last node back to the bottom of the first) is an elbow with both ends on the same side:
it draws a U that runs `data-out` px (default 60) below the lower of them. Write it in the direction it means, from →
to with the head on `data-end`; Glideshow keeps the left end as `data-from` when it loads the deck, swapping the ends and
their heads for you:
```html
<div class="box" id="sync" data-shape="elbow" data-end="fill-arrow" data-from="learner:b" data-to="actors:b" data-out="80" style="left: 0px; top: 0px; width: 0px; height: 0px; --stroke: #5f6368; --sw: 4px;"><div class="content"></div></div>
```

**A plot from a script.** Size the figure for its space, save it into the deck's `assets/`, and place it with the command
that made it, so it can be remade when the data changes:
```sh
glideshow figure size <deck> --slide 4            # the figsize that fits the body area exactly, and a script to start from
uv run src/plot.py --out assets/curves.png        # your script (in the deck's folder), from that start
glideshow figure add <deck> assets/curves.png --slide 4 --id curves --alt "Return over training, 10 seeds" \
  --source "uv run src/plot.py --out {out}"
glideshow figure refresh <deck> curves            # later: new data → re-run, new picture in the same place
glideshow figure add <deck> other.png --replace curves   # or swap in a different picture, keeping the box's place
```
The script it starts you on declares its own dependencies (`matplotlib` and `glideshow`, so `uv run` needs no setup),
uses the deck's `deck.mplstyle` (`figure size` writes it: the theme's font and colours, accents that suit it, sizes that
read on a slide, and KaTeX's maths font) and saves with `glideshow.figure.save(fig, out)`. That writes the picture at 2×
the slide's pixels and, beside it, where each piece of its text is (`curves.png.json`), so `check` can see inside it.
`figure add` keeps the file's name, gives the box an id and alt text, fits the picture into the slide's body area (or
`--at x,y,w,h`), and records `data-source` (`{out}` stands for the picture's path) and `data-made`. `figure refresh` says
when a picture came out the same (and leaves the deck alone) and when its font lacks a character. In matplotlib, a
figure 1 in wide fills 192 px of slide, so a point in the figure is a point on the slide: labels at 12–16 pt read well.

**An equation.** Any box: `<div class="content" style="font-size: 48px; text-align: center;">$$\mathcal{L} = -\sum_t \log \pi_\theta(a_t \mid h_{<t})$$</div>`.
The deck keeps the LaTeX; KaTeX typesets it.

**Code.** `<pre><code class="language-python">…</code></pre>` in a box. Code doesn't wrap: make the box wide enough, or the
lines short or the font smaller (`check` reports code that is cut off).

**A callout on an image.** A picture box, then a shape after it (later boxes sit on top), e.g. a `roundcallout` whose tail
(`data-adj` / `data-adj2`, 0..1 of the box, may be negative) points at the feature, or an `ellipse` with
`--fill: transparent; --stroke: #d93025; --sw: 6px` around it.

**Building a diagram up step by step (Morph).** One slide per step. Each step's boxes have ids unique in the whole deck,
and each step after the first has `data-auto-animate` and pairs every box that carries over with `data-morph="<its id on
the slide before>"`; a box with no partner fades in. The first step has no `data-auto-animate`.
```html
<section data-layout="title-only">
  <div class="box" id="s1-title" data-placeholder="Click to add title" data-role="title" data-valign="top" style="left: 65px; top: 93px; width: 1790px; height: 122px;"><div class="content" style="font-size: calc(var(--th-title-size, 74.67px) * 1); text-align: left; padding: 9.6px 19.2px;">The pipeline</div></div>
  <div class="box" id="s1-actors" data-shape="roundrect" style="left: 160px; top: 500px; width: 400px; height: 200px;"><div class="content">Actors</div></div>
</section>
<section data-layout="title-only" data-auto-animate>
  <div class="box" id="s2-title" data-morph="s1-title" data-placeholder="Click to add title" data-role="title" data-valign="top" style="left: 65px; top: 93px; width: 1790px; height: 122px;"><div class="content" style="font-size: calc(var(--th-title-size, 74.67px) * 1); text-align: left; padding: 9.6px 19.2px;">The pipeline</div></div>
  <div class="box" id="s2-actors" data-morph="s1-actors" data-shape="roundrect" style="left: 160px; top: 500px; width: 400px; height: 200px;"><div class="content">Actors</div></div>
  <div class="box" id="s2-learner" data-shape="roundrect" style="left: 1360px; top: 500px; width: 400px; height: 200px;"><div class="content">Learner</div></div>
</section>
```
A third step pairs with the second's ids (`data-morph="s2-actors"`), and so on. `check` reports pairings with no partner;
`glideshow render <deck> --morph` lists each step's pairs (what moves, resizes, recolours, fades in or out) and saves a
picture halfway through each animation.

**A table that doesn't fit.** A `.box.table` grows with its rows. Imported tables carry Google's cell padding
(`padding: 19.2px` on each `<td>`) and font sizes: to make one fit, lower the padding on its cells (a rule in the slide's
own `<style class="slide-css" media="not all">`, such as `.box.table td { padding: 6px 12px; }`, does every cell at once)
and its font size, then set the box's height to what `check` says it needs. A table that runs off the bottom of the
slide (`check`: "runs … off the bottom of the slide") must lose rows or size; a taller box won't help.

**A footnote or citation.** A small text box at the foot of the slide, not a superscript in the body (one makes its line
taller): `<div class="box" id="s4-cite" style="left: 65px; top: 1000px; width: 1790px; height: 50px;"><div class="content" style="font-size: 24px; color: #5f6368;">Tenenbaum et al., 2011</div></div>`.
Mark the claim with a short `[1]` in the text if there are several.

**Speaker notes:** `<aside class="notes">…</aside>` inside the section, after its boxes.

## Conventions

- Name the deck in `<title>` without a date, and put the date in `<meta name="date" content="YYYY-MM-DD">` (new decks
  get today's).
- Every box has a unique `id` (`check` reports any without one); ids starting with `ed-` are reserved for the editor.
- Don't write SVG or `--tx-*` / `--sh*` style variables: they are derived when the deck loads.
- The editor commits every save to git when the deck is in a repo, so `git log` / `git diff` show what the person
  changed. Don't commit yourself.
- Your own test library, apart from the user's: `GLIDESHOW_HOME=/tmp/x/decks GLIDESHOW_CACHE=/tmp/x/cache
  GLIDESHOW_PORT=48900 glideshow …` (a server on its own port never finds or replaces the user's).
