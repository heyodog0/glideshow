# /// script
# requires-python = ">=3.10"
# dependencies = ["python-pptx"]
# ///
"""A .pptx → deck sections, best effort: slide backgrounds, text boxes and placeholders (paragraphs with size, bold /
italic, colour, alignment), pictures (saved into the deck's assets/), tables, shapes PowerPoint and shapes.js share
(by OOXML preset name), straight lines and speaker notes. Groups are flattened. A layout's own shapes and its master's
(not placeholders: a logo, a footer) become a layout in #deck-layouts that its slides name (D5). Prints JSON:
{"slides": [html, …], "layouts": [html, …], "size": [w, h]}.

    uv run glideshow/pptx_import.py IN.pptx DECK/assets
"""
import hashlib, html, json, re, sys
from pathlib import Path

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.enum.text import PP_ALIGN

_js = (next(d for d in (Path(__file__).resolve().parent / "editor", Path(__file__).resolve().parent.parent / "editor") if d.is_dir()) / "deck" / "shapes.js").read_text()
_po = _js[_js.index("PRESET_OF = {"):_js.index("};", _js.index("PRESET_OF = {"))]
OURS = {prst: name for name, prst in re.findall(r"['\"]?([\w-]+)['\"]?:\s*'(\w+)'", _po)}   # OOXML preset → our data-shape
OURS.update({"rect": "rect", "roundRect": "roundrect", "ellipse": "ellipse"})
ALIGN = {PP_ALIGN.CENTER: "center", PP_ALIGN.RIGHT: "right", PP_ALIGN.JUSTIFY: "justify"}


def hexcolor(fmt):
    try:
        return "#" + str(fmt.rgb) if fmt.type is not None and fmt.rgb is not None else None
    except (AttributeError, KeyError, TypeError, ValueError):
        return None


def text_html(tf, k):
    paras, sizes = [], []
    for p in tf.paragraphs:
        runs = []
        for r in p.runs:
            st = []
            if r.font.size: st.append(f"font-size: {round(r.font.size.pt * 192 / 72, 2)}px"); sizes.append(r.font.size.pt)
            if r.font.bold: st.append("font-weight: bold")
            if r.font.italic: st.append("font-style: italic")
            c = hexcolor(r.font.color) if r.font.color and r.font.color.type is not None else None
            if c: st.append(f"color: {c}")
            t = html.escape(r.text)
            runs.append(f'<span style="{"; ".join(st)}">{t}</span>' if st else t)
        align = ALIGN.get(p.alignment)
        st = f' style="text-align: {align}"' if align else ''   # (no quotes or backslashes inside an f-string's braces before Python 3.12)
        paras.append(f'<div{st}>{"".join(runs) or "<br>"}</div>')
    return "".join(paras)


def walk(shapes, k, assets, out):
    for sh in shapes:
        if sh.shape_type == MSO_SHAPE_TYPE.GROUP:
            walk(sh.shapes, k, assets, out); continue
        if sh.left is None or sh.width is None:
            continue
        x, y, w, h = (round(v * k, 1) for v in (sh.left, sh.top, sh.width, sh.height))
        pos = f"left: {x}px; top: {y}px; width: {w}px; height: {h}px;"
        if sh.shape_type == MSO_SHAPE_TYPE.PICTURE:
            blob = sh.image.blob
            name = f"{hashlib.sha1(blob).hexdigest()[:12]}.{sh.image.ext}"
            (assets / name).write_bytes(blob)
            out.append(f'<div class="box image" style="{pos}"><div class="content"><img src="assets/{name}" alt=""></div></div>'); continue
        if sh.has_table if hasattr(sh, "has_table") else False:
            rows = "".join("<tr>" + "".join(f"<td>{html.escape(c.text)}</td>" for c in r.cells) + "</tr>" for r in sh.table.rows)
            out.append(f'<div class="box table" data-valign="top" style="{pos}"><div class="content" style="padding: 0px;"><table>{rows}</table></div></div>'); continue
        if sh.shape_type in (MSO_SHAPE_TYPE.LINE,) or sh.__class__.__name__ == "Connector":
            col = hexcolor(sh.line.color) if sh.line.fill.type is not None else None
            sw = round(sh.line.width * k, 2) if sh.line.width else 2.67
            up = sh.begin_y > sh.end_y if hasattr(sh, "begin_y") else False
            updir = ' data-dir="up"' if up else ''
            out.append(f'<div class="box" data-shape="line"{updir} style="{pos} --sw: {sw}px;{f" --stroke: {col};" if col else ""}"><div class="content"></div></div>'); continue
        attrs, style = "", pos
        if sh.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE:
            try: prst = sh.auto_shape_type and sh.auto_shape_type.xml_value
            except (NotImplementedError, ValueError, AttributeError): prst = None
            name = OURS.get(prst or "", "rect")
            attrs = f' data-shape="{name}"'
            try:
                if sh.fill.type is not None: style += f" --fill: {hexcolor(sh.fill.fore_color) or '#eeeeee'};"
                else: style += " --fill: transparent;"
            except (TypeError, AttributeError): pass
            try:
                if sh.line.fill.type is not None:
                    c = hexcolor(sh.line.color)
                    style += f" --stroke: {c or '#595959'}; --sw: {round((sh.line.width or 12700) * k, 2)}px;"
            except (TypeError, AttributeError): pass
        inner = text_html(sh.text_frame, k) if sh.has_text_frame and sh.text_frame.text.strip() else ""
        if not attrs and not inner:
            continue
        valign = "" if attrs else ' data-valign="top"'   # text boxes hang from the top; shapes centre their text, as in both apps
        left = '' if attrs else ' style="text-align: left;"'
        out.append(f'<div class="box"{attrs}{valign} style="{style}"><div class="content"{left}>{inner}</div></div>')


def convert(src: Path, assets: Path):
    prs = Presentation(src)
    assets.mkdir(parents=True, exist_ok=True)
    k = 1920 / prs.slide_width   # px per EMU
    slides, layouts = [], {}   # layout part → (key or None, its <div class="layout">)
    for s in prs.slides:
        lay = s.slide_layout; part = str(lay.part.partname)
        if part not in layouts:
            lo: list = []
            walk([sh for sh in [*lay.slide_master.shapes, *lay.shapes] if not sh.is_placeholder], k, assets, lo)
            if lo:
                key = "p-" + hashlib.sha1(lay.part.blob + lay.slide_master.part.blob).hexdigest()[:8]   # the same layout imported again: the same key
                lo = [b.replace('<div class="box', f'<div id="{key}-{i}" class="box', 1) for i, b in enumerate(lo, 1)]
                lbg = ""
                try:
                    if lay.background.fill.type is not None: lbg = hexcolor(lay.background.fill.fore_color) or ""
                except (TypeError, AttributeError): pass
                bga = f' data-background-color="{lbg}"' if lbg else ""
                layouts[part] = (key, f'<div class="layout" data-layout="{key}" data-name="{html.escape(lay.name or key, quote=True)}"{bga}>\n  ' + "\n  ".join(lo) + "\n</div>")
            else: layouts[part] = (None, "")
        named = f' data-layout="{layouts[part][0]}"' if layouts[part][0] else ""
        bg = ""
        try:
            if s.background.fill.type is not None: bg = hexcolor(s.background.fill.fore_color) or ""
        except (TypeError, AttributeError): pass
        out = []
        walk(s.shapes, k, assets, out)
        if s.has_notes_slide and s.notes_slide.notes_text_frame.text.strip():
            out.append(f'<aside class="notes">{html.escape(s.notes_slide.notes_text_frame.text.strip())}</aside>')
        slides.append(f'<section data-background-color="{bg or "#ffffff"}"{named}>\n  ' + "\n  ".join(out) + "\n</section>")
    return {"slides": slides, "layouts": [h for key, h in layouts.values() if key], "size": [1920, round(prs.slide_height * k)]}


if __name__ == "__main__":
    print(json.dumps(convert(Path(sys.argv[1]), Path(sys.argv[2]))))
