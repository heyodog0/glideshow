## Deck format

The deck's name is its `<title>` and its date (the talk's or meeting's) is `<meta name="date" content="YYYY-MM-DD">` in
the `<head>`; keep the date out of the title (the home screen shows and sorts by the date).

`deck.html` is a normal reveal.js file. Every slide is a 1920×1080 `<section>` whose children are absolutely positioned
boxes:

```html
<section data-background-color="#ffffff">
  <div class="box" id="fits-title" style="left: 65px; top: 93px; width: 1790px; height: 122px;">
    <div class="content" style="font-size: 74.67px;">Model fits</div>
  </div>
  <div class="box image" id="fits-fig" style="left: 120px; top: 260px; width: 900px; height: 700px;">
    <div class="content"><img src="assets/fits.png" alt="Model fits per condition"></div>
  </div>
  <div class="box" id="callout" data-shape="roundrect" style="left: 1100px; top: 300px; width: 700px; height: 300px; --fill: #fce8e6; --stroke: #d93025; --sw: 2px;">
    <div class="content" style="font-size: 36px;">Fit is worse for <i>β</i> &gt; 0.5</div>
  </div>
  <aside class="notes">Speaker notes go here.</aside>
</section>
```

Rules:
- Geometry lives only in a box's inline `left/top/width/height` (in px on the 1920×1080 canvas). Rotation is an inline `transform: rotate(Ndeg)` about the box centre (absent when 0).
- Inside `.content`, anything goes: HTML, lists, `<pre><code>` blocks, tables, iframes.
- Guides: `data-guides="v960 h540"` on the `.slides` element (vertical/horizontal, px); editor only, never drawn when presenting.
- Cropped pictures: `data-crop="top right bottom left"` on a `.box.image`, each the share (0–1) of the picture cut off that side; the box is the visible part.
- Videos: `<div class="box video" style="…"><div class="content"><video src="assets/clip.mp4" poster="assets/clip.jpg" controls playsinline></video></div></div>`;
  add `data-autoplay` (reveal.js plays it when the slide appears), `muted` and/or `loop` on the `<video>`. Trim with a media fragment: `src="assets/clip.mp4#t=5,12"`.
- Groups: `<div class="box group" style="left/top/width/height">` holding member `.box`es whose geometry is relative to the group's top-left; the group can be rotated/flipped like any box and has no `.content`. Groups can nest. The editor keeps a group's box hugging its members.
- Theme: a block in `<style id="deck-theme">` between `/* slides-theme {…} */` and `/* end slides-theme */` (written by the Themes panel) sets the deck font, text and title colours, and `--th-title-size` / `--th-body-size`; text without its own font or colour inherits it, layout placeholders size from it, and the rest of that style is left as you wrote it.
- Edited layouts live in the theme JSON (`"layouts": {"title-body": [[role, x, y, w, h, pt, valign, align], …]}`, sizes relative to 28 / 18 pt titles / bodies).
- Layouts and placeholders: `data-layout` on a `<section>` names its layout (title, section, title-body, two-columns, title-only, one-column,
  main-point, section-description, caption, big-number, blank); a box with `data-placeholder="Click to add title"` (and `data-role` title / sub / body)
  shows that prompt in the editor while empty, survives being left empty, and is hidden in the deck until it has text.
- Slide ids: the editor gives each `<section>` a `data-sid` (how edits made in two places merge, slide by slide). Keep it when you change a slide; a slide you add may leave it out (it gets one), but never copy one slide's `data-sid` onto another.
- Vertical stacks (reveal.js sub-slides): wrap slides in an outer `<section>`: `<section><section>main</section><section>below</section></section>`.
  The first is the main slide, the rest sit below it (presenting: ↓ / ↑). Numbering follows reveal: main slide 3, its sub-slides 3.1, 3.2
  (filmstrip, the slideshow pill and its slide picker). The filmstrip draws a stack as a tree (sub-slides smaller, under a rail; ▾ / ▸ on the
  main slide folds them, showing "+2", remembered per deck); grid view keeps one cell per main slide, with a stack's sub-slides in that cell under it.

- Slide background (Slide → Change background): `data-background-color` on the `<section>`, plus optional `data-background-image="assets/….png"` (any URL or data URI), drawn to cover the slide unless `data-background-size` says otherwise (`contain`, `100% 100%`, `auto`; `data-background-repeat="repeat"` tiles), with `data-background-opacity` (0–1, the picture over the colour) and `data-background-tint` (`#rrggbbaa` laid over it). Or `data-background-gradient` = a CSS `linear-gradient(<deg>deg, #a, #b)` / `radial-gradient(circle, #a, #b)` (keep `data-background-color` as its first colour).
- Shapes: `data-shape` = `rect | roundrect | ellipse | triangle | diamond | parallelogram | trapezoid | pentagon | hexagon | octagon | star | plus | minus | multiply | divide | equal | notequal | brackets | braces | leftbracket | rightbracket | leftbrace | rightbrace | cloud | arrow | leftarrow | uparrow | downarrow | leftrightarrow | updownarrow | quadarrow | bentarrow | uturnarrow | notchedarrow | curvedarrow | curvedleftarrow | curveduparrow | curveddownarrow | leftrightuparrow | leftuparrow | bentuparrow | stripedarrow | homeplate | rightarrowcallout | leftarrowcallout | uparrowcallout | downarrowcallout | leftrightarrowcallout | quadarrowcallout | circulararrow | chevron | callout | roundcallout | ovalcallout | cloudcallout | explosion1 | explosion2 | star4 | star6 | star7 | star8 | star10 | star12 | star16 | star24 | star32 | ribbonup | ribbon | curvedribbonup | curvedribbon | vscroll | hscroll | wave | doublewave | snip1rect | snip2samerect | snip2diagrect | sniproundrect | round1rect | round2samerect | round2diagrect | rttriangle | heptagon | decagon | dodecagon | pie | arc | teardrop | chord | frame | halfframe | corner | diagstripe | cross | plaque | can | cube | bevel | donut | nosmoking | blockarc | foldedcorner | smileyface | heart | lightningbolt | sun | moon | flow-process … flow-display (Slides' 28 flowchart shapes: flow- + the OOXML name after flowChart, lowercased) | wordart | line | arrowline | elbow | curve`,
  styled with `--fill`, `--stroke`, `--sw`; `data-dash="dot|dash|dashdot|longdash|longdashdot"` dashes the outline (text boxes too). Lines take
  `data-start` / `data-end` = `none | arrow | fill-arrow | circle | square | diamond | open-arrow | open-circle | open-square | open-diamond`
  (`arrowline` is a line whose end defaults to `fill-arrow`). Ends grow with the line weight as in Slides (an arrow is ~9.4× the weight long).
  `elbow` and `curve` are connectors drawn corner to corner like lines,
  leaving and arriving horizontally (a right-angle step, or an S-curve).
  `wordart` draws the box's text as one line of letters stretched to the box (fill `--fill`, outline `--stroke` / `--sw`; font from `.content`).
  A line, arrow or connector can be attached to shapes with `data-from` / `data-to` = `"boxId:t|r|b|l"` (the middle of a side; `from` is
  the left end): whenever the deck loads (editor and slideshow), an attached line is fitted to those points, so it follows the shapes
  however they moved; with one end attached the whole line moves with that shape. The editor writes the fitted geometry back.
  An elbow connector (`data-shape="elbow"`) routes from its ends' sides: two horizontal (l/r, or unattached) or two vertical (t/b) ends give
  three segments with the middle one at `data-bend` (0..1 of the span, default 0.5; the yellow handle; right-click → Reroute connector resets it),
  one of each gives a single bend, and two ends on the same side (`b` and `b`, or `r` and `r`, …) give a U that runs `data-out` px
  (default 60; the yellow handle) past the further end: a feedback edge. A curved connector (`curve`) routes the same way, its S bending at `data-bend` (handle on the curve); with one bend it is OOXML's curvedConnector2, a gentle arc whose controls sit at the midpoints of the two legs.
  `data-shape="path"` with `data-path="M0,0 C… L…"` is a freehand stroke (Curve, Polyline, Scribble): SVG path commands in 0..1 units of the box, so it scales with it.
  Shapes are drawn from the OOXML preset geometry Google Slides uses (ECMA-376 `presetShapeDefinitions`), including where text sits.
  `data-adj`, `data-adj2`, … are the preset's adj1, adj2, … scaled 0–1 (e.g. `arrow` = rightArrow: adj1 shaft thickness of the height,
  adj2 head length of the shorter side, both 0.5 by default; `roundrect`: corner radius of the shorter side, 0.1667); the editor's yellow handles set them.
  Outlines are centred on the shape's edge, as in Slides. Lines run corner to corner (`data-dir="up"` flips them);
  height 0 gives a horizontal line. Don't write SVG; it's drawn at load time.
- Line spacing: the editor's Single / 1.15 / 1.5 / Double mean what they mean in Slides (multiples of the font's natural line height, about 1.15), written as CSS `line-height` 1.15 / 1.323 / 1.725 / 2.3; a `.content` without one keeps 1.3.
- Page size: `<div class="slides" data-size="1920x1440">` makes every slide 1920 × 1440 (4:3; 192 px = 1 in); absent means 1920 × 1080. shapes.js sizes the sections and tells reveal.js. File → Page setup sets it (16:9, 16:10, 4:3 or W x H inches); objects keep their positions.
- Fonts: `font-family` on `.content` (or a `<span>`), e.g. `style="font-family: 'Roboto Slab', serif"`. A Google Fonts family also needs
  `<link id="deck-fonts" rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@400;700&display=swap">` in the head
  (one link, `family=` repeated per font); the font menu writes it. Web-safe fonts (Arial, Georgia, …) need nothing.
  A font file of your own goes in `assets/fonts/` with an `@font-face` in `#deck-theme`, e.g.
  `@font-face { font-family: 'My Font'; src: url('assets/fonts/My-Font.ttf'); font-display: swap; }`; the font menu's Your fonts tab
  (fonts in `~/Library/Fonts` and `/Library/Fonts`) and dropping a .ttf / .otf / .woff / .woff2 on the slide write both.
- Equations: LaTeX between `$…$` / `\(…\)` (inline) or `$$…$$` / `\[…\]` (display) in any box is typeset by KaTeX (shapes.js loads it
  from jsDelivr; `--build` vendors it). The deck keeps the source; Insert → Equation adds one, double-click shows the source to edit.
- Tables: `<div class="box table" data-valign="top" …><div class="content" style="padding: 0px"><table><tr><td>…</td></tr></table></div></div>`;
  the table fills the box with 1pt black rules (base.css). Insert → Table picks the size; while editing, Tab / ⇧Tab move between
  cells (Tab in the last cell adds a row) and right-click inserts or deletes rows and columns.
- Web embeds: `<div class="box embed" …><div class="content"><iframe src="https://…" allowfullscreen></iframe></div></div>` shows a live page
  (or a YouTube / Vimeo player: Insert → Video → By URL converts the page address). The editor shows it but doesn't pass clicks
  to it; the slideshow does.
- Live boxes (Insert → Live box): a box running a page of its own, for a demo, a simulation or a plot you can hover:
  `<div class="box live" …><div class="content"><iframe src="assets/demo.html" sandbox="allow-scripts allow-pointer-lock"></iframe></div></div>`.
  Write the page as an ordinary HTML file in `assets/` (its own `<script>`, sized to the window: the box's size). It runs in a
  sandbox: it can draw, animate and take the mouse and keys, and load things from the web, but can't reach the deck, other
  files or anyone's accounts. Keep the `sandbox` attribute exactly so. The editor shows it running; double-clicking it edits the page.
- Code: `<pre><code class="language-python">…</code></pre>` inside a box's `.content` is coloured by highlight.js (reveal.js' highlight
  plugin, loaded by shapes.js beside reveal.js); any highlight.js language name works. Insert → Code block picks the language,
  right-click → Code language changes it; Enter inside a code block adds a line.
- Icons: `<div class="box" data-shape="icon" data-icon="lightbulb" style="…; --fill: #202124">` draws that Material Symbols glyph
  (any name from fonts.google.com/icons) filling the box, coloured by `--fill`. The deck needs
  `<link id="deck-icons" rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&icon_names=lightbulb&display=block">`
  (every icon used, comma-separated and sorted); Insert → Icon writes both.
- Letter spacing: CSS `letter-spacing` on `.content` (whole box) or on a `<span>` (selected text); Format → Text → Letter spacing writes -0.05em / -0.025em / normal / 0.05em / 0.1em. Capitalization (lowercase / UPPERCASE / Title Case) rewrites the characters themselves, so it needs no attribute.
- Paragraph spacing: `--space-before` / `--space-after` on `.content` (e.g. `style="--space-after: 26.67px"`, 10pt) become top / bottom margins on each paragraph (every block child and list item). The line-spacing menu's Add / Remove space before / after paragraph toggles 10pt.
- Text insets: the editor writes Slides' defaults on new boxes (`padding: 9.6px 19.2px` on `.content`, i.e. 0.05 in / 0.1 in); a `.content` without its own padding gets 8 px / 16 px.
- Gradient fill (Fill colour → Gradient): `data-gradient="linear <deg> #from #to"` (CSS angles: 90 runs left to right, 180 top to bottom; more colours allowed) or `"radial #inner #outer"` on a shape or text box; keep `--fill` as its first colour (what other programs fall back to).
- Image fill (Fill colour → Image): `data-fill-image="assets/….png"` on a shape or text box, with `data-fill-scale` = `fit | stretch | tile | original` (left out: scale to fill). It takes the place of the colour or gradient.
- Text boxes can also take `--fill`, `--stroke`, `--sw`. A translucent fill is just a colour with alpha (`--fill: #4a86e880`); an image's opacity is an inline `opacity` on its `<img>`. `data-valign="top|bottom"` changes vertical alignment.
- Optional box attributes (Format → Format options): `data-flip="h|v|hv"` mirrors the box (text stays readable),
  `data-shadow` adds a drop shadow (tuned by `data-shadow-color` `#rrggbb`, `-opacity` 0–1, `-angle` deg with 90 = down, `-distance` and `-blur` px; defaults #000000, 0.3, 90, 6, 8), `data-lock="aspect"` keeps proportions when resizing, `data-locked` (Arrange → Lock) keeps the box from being moved, resized, edited or deleted in the editor (the slideshow ignores it),
  `data-autofit="none|shrink|resize"`: no fitting, shrink the text to fit the box (done at load by `#deck-shapes`), or grow the box to fit the text (the default for text boxes).
- Text boxes grow to fit their text while editing. `data-minh` is the height the user dragged; the editor never shrinks a box below it (optional; defaults to the current height).
- Links (Insert → Link): text links are `<a href>`; a picture, line, drawing or group links as a whole with `data-link` on its `.box`. Either takes a URL, `mailto:` / `tel:`, or a slideshow target: `#next`, `#previous`, `#first`, `#last` (slides, not builds), `#slide=<data-sid>` (that slide, wherever it moves), `#exit` (end the slideshow). present.js follows them; a click on a link doesn't also advance.
- Slide transitions: `data-transition` on the `<section>` = `fade` (Dissolve) | `fade-in fade-out` (Fade) | `slide` | `sl-left` | `convex` (Flip) | `concave` (Cube) | `zoom` (Gallery), optional `data-transition-speed="slow|fast"`.
- Morph (Keynote's Magic Move, reveal's Auto-Animate): `data-auto-animate` on a `<section>` (instead of `data-transition`)
  animates from the slide before: each box that has a partner there moves, resizes and recolours into place, and the rest fade.
  A box's partner is the box on the slide before whose `id` equals this box's `data-morph` (or, without one, its own `id`);
  ids stay unique in the deck, so a copied box gets a new id and `data-morph` names the one it continues. In the editor:
  duplicate the slide (Duplicate slide sets `data-morph` on each copy), change the copy, and give it `data-auto-animate`. By
  hand, see "Building a diagram up step by step" above. Optional `data-auto-animate-duration` in seconds (0.5 fast, 1.4 slow).
- Object animations are reveal fragments on the box: `class="box fragment fade-in"` (or `appear`, `fade-right` = fly in from left, `fade-left`, `fade-up`, `fade-down`, `zoom-in`), ordered by `data-fragment-index` (`data-with-previous` marks one that plays with the one before it, sharing its index). Alt text: the image's `alt`, or `aria-label` on the box.
- Image adjustments (Format options → Adjustments): `data-adjust="exposure:20 saturation:-30"` on an image's box, any of `exposure saturation contrast highlights shadows sharpness temperature tint`, each -100…100 (0 = left out). shapes.js draws them as an SVG filter on the `<img>` (derived, never saved).
  More effects: `fade-out`, `semi-fade-out` (dim), `fade-in-then-out`, `fade-in-then-semi-out` (fade in, then dim when the
  next step comes: walking through bullets), `highlight-current-blue` (coloured while it is the current step), `grow`, `shrink`,
  `strike`. `data-build="paragraph"` on an animated text box makes each paragraph or bullet its own step with the box's effect; `"highlight"` the same, dimming the ones already shown; `"word"` / `"character"` keep one step, the text arriving a word or letter at a time over `data-duration` (default 1 s; in-effects only). On a table box `"row"`, `"column"` or `"cell"` makes each its own step.
  Timing (Motion panel): `data-start="after"` plays a build by itself once the one before has finished, `data-start="transition"` (the slide's first build) once the slide's transition has; `data-duration` and `data-delay` in seconds (defaults reveal's ~0.5 s and 0); `data-ease` = `linear | ease-in | ease-out | ease-in-out`.
  Pictures that replace each other in one place (a plot that updates): stack them at the same position, the first
  `fade-out` with the second's step, each middle one `fade-in-then-out`, the last `fade-in` (Arrange → Stack as a sequence).
- Backgrounds beyond colour and image (reveal's own): `data-background-video="assets/clip.mp4"` (with `data-background-video-loop`
  and `data-background-video-muted`) or `data-background-iframe="https://…"` (a live web page) on the `<section>`.
- A slide's own style: `<style class="slide-css" media="not all">` inside the `<section>`, holding ordinary CSS rules
  (`.box > .content { … }`) that apply to that slide only. `media="not all"` keeps it from applying to anything else; the
  editor and the slideshow scope it to its slide (Slide → Slide style).
- Any deck reads as a scrolling page with `?view=scroll` (reveal's scroll view; narrow phone screens get it by themselves).
- Figures: a `.box.image` may carry `data-source` (the command that makes its picture; `{out}` is the picture's path, run in the
  deck's folder by `glideshow figure refresh`) and `data-made` (when it was last made, ISO time). Both are optional.
- Give every box a unique `id`. Ids starting with `ed-` are reserved for the editor's own interface. Put deck-specific CSS in `<style id="deck-theme">`.
- Don't edit `#deck-base`, `#deck-shapes` or `#deck-present`. The editor overwrites them from `editor/` on every save.

The editor watches `deck.html`: edits made on disk appear within a second. Saves are tied to the
file's mtime, so if the file changed underneath the editor, it reloads instead of overwriting it.
