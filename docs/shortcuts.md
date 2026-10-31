# Google Slides shortcuts (macOS) to clone

Source of truth for key bindings. Implement exactly these; don't invent alternatives. Items marked
*(verify)* come from memory and should be checked against Google's "Keyboard shortcuts for Google
Slides" help page (search it) before implementing. Tick each line as it lands.

`uv run test/keys.py` presses every key below in its context and checks its effect and that the keydown is
prevented (nothing reaches Chrome); the ⌘/ dialog (`SHORTCUTS` in editor.js) must list exactly the keys that pass.
A new binding needs a row in both.


## Editor: common

- [x] ⌘M new slide (next main slide); ⇧⌘M new sub-slide below (reveal vertical stack; not in Slides) — ⌘M and Slides' Mac key ⌃M (verified: Google lists Ctrl+M); ⇧⌘M adds a sub-slide under the current slide
- [x] ⌘D duplicate (selected objects; selected slide when the filmstrip has focus)
- [x] ⇧⌘D Chart data editor when a chart is selected (Keynote's key; Slides has none)
- [x] ⌘Z / ⇧⌘Z undo / redo (⌘Y also redo)
- [x] ⌘C ⌘X ⌘V copy cut paste; ⇧⌘V paste without formatting (⌘V into text now keeps formatting, cleaned)
- [x] ⌥⌘C / ⌥⌘V copy / paste formatting (paint format)
- [x] ⌘A select all (objects on the slide; all slides when the filmstrip has focus)
- [x] ⌘K insert or edit link
- [x] ⌘F find; ⇧⌘H find and replace
- [x] ⌘/ keyboard shortcuts dialog
- [x] ⌘S "saves" (flash "All changes saved"); ⌘P print (opens PDF print mode)
- [x] ⌘⏎ present from current slide; ⇧⌘⏎ present from the first slide
- [x] ⌃⌥⇧G grid view toggle *(Slides' View menu lists Grid view as ⌘⌥1; bound to ⌘⌥1)*; ⌃⇧F compact controls toggle *(verified: "Hide or show menus")*
- [x] ⌘+ / ⌘− zoom in / out *(verified: Google lists ⌘+ / ⌘−; the editor intercepts them before Chrome)*
- [x] ⌥⌘M insert comment (on the selected object, else the slide; opens the Comments panel) *(verified: Google lists ⌘+Option+M)*
- [x] ⌥⇧⌘S speaker notes pane toggle *(verified: "Open speaker notes panel"; was guessed as ⌃⌥⇧N/P)*

## Editor: text formatting

- [x] ⌘B ⌘I ⌘U bold italic underline (selected text, or whole selected boxes); ⇧⌘X strikethrough
- [x] ⌘. superscript; ⌘, subscript
- [x] ⌘\ clear formatting
- [x] ⇧⌘. / ⇧⌘, increase / decrease font size
- [x] ⇧⌘L ⇧⌘E ⇧⌘R ⇧⌘J align left / center / right / justify
- [x] ⇧⌘7 numbered list; ⇧⌘8 bulleted list
- [x] ⌘] / ⌘[ increase / decrease indent (Tab / ⇧Tab inside a list)
- [x] ⌥⌘1…6 apply heading-like text styles *(not in Slides; skipped on purpose)*

## Editor: objects

- [x] ⏎ edit text of the selected shape; Esc exit text editing (keeps the shape selected); Esc again deselects
- [x] Tab / ⇧Tab select next / previous object on the slide
- [x] ← → ↑ ↓ nudge 1px; ⇧+arrow nudge 10px
- [x] ⌥⌘G group; ⇧⌥⌘G ungroup — verified keys; Arrange → Group / Ungroup
- [x] ⌘↑ / ⌘↓ bring forward / send backward; ⇧⌘↑ / ⇧⌘↓ bring to front / send to back
- [x] ⌥← / ⌥→ rotate 15° counter-clockwise / clockwise; ⇧⌥← / ⇧⌥→ rotate 1° *(verified)*
- [x] ⌃⌘B / ⌃⌘I larger horizontally / vertically; ⌃⌘K / ⌃⌘J larger / smaller; ⌃⌘W smaller horizontally *(verified: Google's Mac keys use ⌃⌘, not ⌃⌥, and have no ⇧ variants; "smaller vertically" has no Mac key — ⌃⌘Q would lock the screen)*
- [x] ⇧-drag constrain to axis / keep aspect / 15° rotation; ⌥-drag copy; ⌥-resize from the centre; ⌘-drag suppresses guides *(verified)*
- [x] ⌫ / ⌦ delete selection

## Editor: filmstrip (when a slide, not an object, is selected)

Also ⌥⇧⌘F moves focus to the filmstrip (verified in Google's list).

- [x] ↑ ↓ / PgUp PgDn previous / next slide; Home / End first / last slide
- [x] ⌘↑ / ⌘↓ move slide up / down; ⇧⌘↑ / ⇧⌘↓ move to beginning / end (⌘← / ⌘→ and ⇧⌘← / ⇧⌘→ too, as Slides' own shortcut list shows)
- [x] ⇧-click / ⇧↑↓ extend slide selection; ⌘-click toggle
- [x] ⌫ delete selected slides
- [x] ⌘D duplicate selected slides
- [x] ⏎ focus the slide canvas; Esc back to filmstrip

## Presenting (viewer, must match Google Slides, overriding reveal.js defaults where they differ)

- [x] → N next main slide, ← P previous; ↓ ↑ within a vertical stack; Space / ⏎ / PgDn next in reading order (through stacks), ⇧Space / PgUp back; on a deck with no stacks this is identical to Slides
- [x] Home / End first / last slide
- [x] type a number then ⏎ to jump to that slide
- [x] B black screen; W white screen (toggle)
- [x] L laser pointer toggle (a red dot following the cursor)
- [x] Keynote's where Slides has none: ⇧→ / ⇧↓ next slide skipping its builds (no transition), ⇧← / ⇧↑ back one build, Z back through the slides as viewed, C hide / show the pointer, ? or / the keys, Q end the show; reveal's H / J / K are off
- [x] S open speaker notes (presenter view in a new window, reveal's notes plugin)
- [x] M note for the AI at the pointer (ours, not Slides': only when presenting from the editor; ⏎ keeps it on the slide as a `.box.note`, Esc drops it)
- [ ] A toggle auto-advance *(verify)*; F toggle fullscreen (opt-in; presenting starts windowed, see BACKLOG) — F done (reveal's own, works in the in-place frame too); A not yet verified/implemented
- [x] Esc exit presentation (in the editor: restores the chrome on the current slide; in a standalone deck.html tab: leaves fullscreen if entered, otherwise nothing)
- [x] ⌘⇧C toggle captions *(skipped on purpose; no speech API)*
- [x] Reveal defaults to disable or remap so they don't surprise: O / Esc overview (Esc must exit), ? help (map to ⌘/), V pause (B/W replace it), Alt-click zoom off
