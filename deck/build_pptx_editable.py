"""Rerun after editing the deck:  ..\\.venv\\Scripts\\python.exe build_pptx_editable.py  (needs Node 18+ and Microsoft Edge)

deck.html -> RISA_Growth_Strategy.pptx as native, editable PowerPoint shapes.
extract_pptx.mjs opens deck.html in headless Edge, lets the auto-fit script run, and executes pptx_extract.js,
which measures every rendered box, text block, picture and SVG (px relative to each 1920x1080 slide).
This script turns that JSON into shapes: 1 px = 6350 EMU = 0.5 pt (13.333 in / 1920 px).
Boxes -> rectangles / rounded rectangles / ovals / freeforms, borders -> outlines or line shapes,
text -> text boxes (Arial, exact line spacing, zero insets, no autofit), <img> -> cropped pictures,
inline SVG (icons, the number-line chart) -> 4x PNG pictures. Each slide's text goes into its speaker notes.
"""
from __future__ import annotations

import base64
import io
import json
import os
import subprocess
import sys
import tempfile
from urllib.parse import unquote, urlparse
from urllib.request import url2pathname

from lxml import etree
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.dml import MSO_LINE
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Pt

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'RISA_Growth_Strategy.pptx')
EMU_PX = 6350                 # 12192000 EMU / 1920 px
MIN_LINE_PT = 0.75            # thinnest outline we draw
# PowerPoint puts the baseline of an exactly-spaced line higher than CSS half-leading does, more so for tight
# line-heights; measured on this deck: shift = A + B * (line-height / font-size) em.
TEXT_DY_A, TEXT_DY_B = 0.2305, -0.164
ALIGN = {'l': PP_ALIGN.LEFT, 'ctr': PP_ALIGN.CENTER, 'r': PP_ALIGN.RIGHT, 'just': PP_ALIGN.JUSTIFY}
DASH = {'dotted': MSO_LINE.ROUND_DOT, 'dashed': MSO_LINE.DASH}


def E(v: float) -> Emu:
    return Emu(int(round(v * EMU_PX)))


def extract(path: str) -> dict:
    subprocess.run(['node', os.path.join(HERE, 'extract_pptx.mjs'), path], check=True)
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def strip_style(shape) -> None:
    """Drop the theme style reference so PowerPoint adds no theme outline, fill or shadow."""
    st = shape._element.find(qn('p:style'))
    if st is not None:
        shape._element.remove(st)


def set_line(shape, side: dict | None) -> None:
    if not side:
        shape.line.fill.background()
        return
    ln = shape.line
    ln.color.rgb = RGBColor.from_string(side['color'])
    ln.width = Pt(max(MIN_LINE_PT, side['w'] * 0.5))
    if side['style'] in DASH:
        ln.dash_style = DASH[side['style']]
        ln._get_or_add_ln().set('cap', 'rnd')


def set_fill(shape, hexcol: str | None, alpha: float = 1) -> None:
    if not hexcol:
        shape.fill.background()
        return
    shape.fill.solid()
    shape.fill.fore_color.rgb = RGBColor.from_string(hexcol)
    if alpha < 1:
        clr = shape.fill._xPr.find(qn('a:solidFill'))[0]
        etree.SubElement(clr, qn('a:alpha')).set('val', str(int(alpha * 100000)))


def freeform(slide, pts: list[list[float]]):
    k = 100  # local units of 1/100 px
    b = slide.shapes.build_freeform(pts[0][0] * k, pts[0][1] * k, scale=EMU_PX / k)
    b.add_line_segments([(x * k, y * k) for x, y in pts[1:]], close=True)
    return b.convert_to_shape()


def rounded_pts(x, y, w, h, radii, n=8):
    import math
    tl, tr, br, bl = radii
    pts = []
    for (cx, cy, r, a0) in ((x + w - tr, y + tr, tr, -90), (x + w - br, y + h - br, br, 0),
                            (x + bl, y + h - bl, bl, 90), (x + tl, y + tl, tl, 180)):
        if r < 0.5:  # square corner
            pts.append([x + w if a0 in (-90, 0) else x, y if a0 in (-90, 180) else y + h])
            continue
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append([cx + r * math.cos(a), cy + r * math.sin(a)])
    return pts


def add_box(slide, it: dict) -> None:
    x, y, w, h = it['x'], it['y'], it['w'], it['h']
    sides = it['sides']
    real = [s for s in sides if s]
    uniform = len(real) == 4 and all((s['w'], s['style'], s['color']) == (real[0]['w'], real[0]['style'], real[0]['color']) for s in real)
    shapes = []
    if it.get('poly'):
        sp = freeform(slide, it['poly'])
        strip_style(sp); set_fill(sp, it['fill'], it['fillA']); set_line(sp, None)
        shapes.append(sp)
    elif it['fill'] or uniform:
        inset = real[0]['w'] / 2 if uniform else 0
        gx, gy, gw, gh = x + inset, y + inset, w - 2 * inset, h - 2 * inset
        radii = [max(0.0, r - inset) for r in it['radii']]
        if max(radii) < 0.5:
            sp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, E(gx), E(gy), E(gw), E(gh))
        elif max(radii) - min(radii) < 0.5:
            r = radii[0]
            if abs(gw - gh) < 1 and r >= gw / 2 - 0.5:
                sp = slide.shapes.add_shape(MSO_SHAPE.OVAL, E(gx), E(gy), E(gw), E(gh))
            else:
                sp = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, E(gx), E(gy), E(gw), E(gh))
                sp.adjustments[0] = min(0.5, r / min(gw, gh))
        else:
            sp = freeform(slide, rounded_pts(gx, gy, gw, gh, radii))
        strip_style(sp)
        set_fill(sp, it['fill'], it['fillA'])
        set_line(sp, real[0] if uniform else None)
        shapes.append(sp)
    if not uniform:
        for i, s in enumerate(sides):
            if not s:
                continue
            o = s['w'] / 2
            x1, y1, x2, y2 = [(x, y + o, x + w, y + o), (x + w - o, y, x + w - o, y + h),
                              (x, y + h - o, x + w, y + h - o), (x + o, y, x + o, y + h)][i]
            ln = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, E(x1), E(y1), E(x2), E(y2))
            strip_style(ln)
            set_line(ln, s)
            shapes.append(ln)
    for sp in shapes:
        sp.name = ('Box ' + (it.get('cls') or it.get('tag') or '')).strip()
        if it.get('link'):
            sp.click_action.hyperlink.address = it['link']


def add_text(slide, it: dict) -> None:
    first = next(r for p in it['paras'] for r in p['runs'] if not r.get('br'))
    dy = 0.0 if it.get('vert') else (TEXT_DY_A + TEXT_DY_B * it['L'] / first['size']) * first['size']
    tb = slide.shapes.add_textbox(E(it['x']), E(it['y'] + dy), E(it['w']), E(it['h']))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.auto_size = MSO_AUTO_SIZE.NONE
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE if it.get('anchor') == 'ctr' else MSO_ANCHOR.TOP
    if it.get('vert'):
        tf._txBody.find(qn('a:bodyPr')).set('vert', it['vert'])
    for pi, para in enumerate(it['paras']):
        p = tf.paragraphs[0] if pi == 0 else tf.add_paragraph()
        p.alignment = ALIGN.get(it['align'], PP_ALIGN.LEFT)
        p.line_spacing = Pt(it['L'] * 0.5)
        if para.get('spaceBefore'):
            p.space_before = Pt(para['spaceBefore'] * 0.5)
        if para.get('bullet'):
            pPr = p._p.get_or_add_pPr()
            pPr.set('marL', str(int(round(para['marL'] * EMU_PX))))
            pPr.set('indent', str(-int(round(para['marL'] * EMU_PX))))
            etree.SubElement(pPr, qn('a:buSzPct')).set('val', '115000')  # Chrome's disc is a little larger than Arial's bullet
            etree.SubElement(pPr, qn('a:buFont')).set('typeface', 'Arial')
            etree.SubElement(pPr, qn('a:buChar')).set('char', '•')
        for r in para['runs']:
            if r.get('br'):
                p.add_line_break()
                continue
            run = p.add_run()
            run.text = r['t']
            f = run.font
            f.name = r['font']
            f.size = Pt(r['size'] * 0.5)
            f.bold = r['bold']
            f.italic = r['italic']
            f.color.rgb = RGBColor.from_string(r['color'])
            rPr = run._r.get_or_add_rPr()
            if r['ls']:
                rPr.set('spc', str(int(round(r['ls'] * 50))))
            for tag in ('a:ea', 'a:cs'):
                etree.SubElement(rPr, qn(tag)).set('typeface', r['font'])
    text = ''.join(r.get('t', ' ') for p in it['paras'] for r in p['runs'])
    tb.name = 'Text: ' + text[:40]
    if it.get('link'):
        tb.click_action.hyperlink.address = it['link']


def add_picture(slide, it: dict, tmpdir: str) -> None:
    if it['kind'] == 'svg':
        data = base64.b64decode(it['png'].split(',', 1)[1])
        pic = slide.shapes.add_picture(io.BytesIO(data), E(it['x']), E(it['y']), E(it['w']), E(it['h']))
        pic.name = 'Icon'
        return
    u = urlparse(it['src'])
    path = url2pathname(unquote(u.path)) if u.scheme == 'file' else it['src']
    pic = slide.shapes.add_picture(path, E(it['x']), E(it['y']), E(it['w']), E(it['h']))
    c = it['crop']
    pic.crop_left, pic.crop_top, pic.crop_right, pic.crop_bottom = c['l'], c['t'], c['r'], c['b']
    pic.name = 'Picture ' + (it.get('alt') or os.path.basename(path))
    if it.get('radius', 0) > 0.5:
        geom = pic._element.spPr.find(qn('a:prstGeom'))
        geom.set('prst', 'roundRect')
        av = geom.find(qn('a:avLst'))
        if av is None:
            av = etree.SubElement(geom, qn('a:avLst'))
        etree.SubElement(av, qn('a:gd'), name='adj', fmla='val %d' % int(it['radius'] / min(it['w'], it['h']) * 100000))


def build(layout: dict, out: str) -> None:
    prs = Presentation()
    prs.slide_width, prs.slide_height = Emu(1920 * EMU_PX), Emu(1080 * EMU_PX)
    blank = prs.slide_layouts[6]
    tmpdir = tempfile.mkdtemp(prefix='pptx-img-')
    for sd in layout['slides']:
        slide = prs.slides.add_slide(blank)
        for it in sd['items']:
            k = it['kind']
            if k == 'box' and it.get('tag') == 'section':
                slide.background.fill.solid()
                slide.background.fill.fore_color.rgb = RGBColor.from_string(it['fill'])
            elif k == 'box':
                add_box(slide, it)
            elif k == 'text':
                add_text(slide, it)
            else:
                add_picture(slide, it, tmpdir)
        slide.notes_slide.notes_text_frame.text = sd['notes']
    prs.save(out)
    print('wrote', out, len(prs.slides), 'slides')


if __name__ == '__main__':
    # optional: build_pptx_editable.py [out.pptx] [keep-layout.json]
    out = sys.argv[1] if len(sys.argv) > 1 else OUT
    if len(sys.argv) > 2:
        layout = extract(sys.argv[2])
    else:
        with tempfile.TemporaryDirectory() as td:
            layout = extract(os.path.join(td, 'layout.json'))
    build(layout, out)
