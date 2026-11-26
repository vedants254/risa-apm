"""RISA_Growth_Strategy.pdf -> RISA_Growth_Strategy.pptx (16:9, 3 slides).

Each slide is the rendered PDF page at 3840 px wide, so it looks exactly like the PDF. The live-app link
stays clickable (a transparent shape with a hyperlink over the button and the URL), and each slide's
text goes into the speaker notes so it is searchable and easy to present from.
Run after build_deck.py + render.sh:  ../.venv/Scripts/python.exe build_pptx.py
"""
import os

import fitz  # PyMuPDF
from pptx import Presentation
from pptx.util import Emu, Inches

HERE = os.path.dirname(os.path.abspath(__file__))
PDF = os.path.join(HERE, 'RISA_Growth_Strategy.pdf')
OUT = os.path.join(HERE, 'RISA_Growth_Strategy_flat.pptx')  # the editable deck (build_pptx_editable.py) owns RISA_Growth_Strategy.pptx
TITLES = ['How high can we aim', 'Where we place our bets', 'How we know what is working']

doc = fitz.open(PDF)
prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
blank = prs.slide_layouts[6]
tmp = os.path.join(HERE, '_pptx_tmp')
os.makedirs(tmp, exist_ok=True)

for i, page in enumerate(doc):
    W, H = page.rect.width, page.rect.height
    png = os.path.join(tmp, 'slide%d.png' % (i + 1))
    page.get_pixmap(matrix=fitz.Matrix(3840 / W, 3840 / W)).save(png)
    s = prs.slides.add_slide(blank)
    pic = s.shapes.add_picture(png, 0, 0, prs.slide_width, prs.slide_height)
    pic.name = TITLES[i]
    pic._element.nvPicPr.cNvPr.set('descr', 'Slide %d: %s' % (i + 1, TITLES[i]))
    sx, sy = prs.slide_width / W, prs.slide_height / H
    for ln in page.get_links():
        if not ln.get('uri'):
            continue
        r = ln['from']
        box = s.shapes.add_shape(1, Emu(int(r.x0 * sx)), Emu(int(r.y0 * sy)), Emu(int(r.width * sx)), Emu(int(r.height * sy)))
        box.fill.background()
        box.line.fill.background()
        box.name = 'Link: ' + ln['uri']
        box.click_action.hyperlink.address = ln['uri']
    s.notes_slide.notes_text_frame.text = page.get_text().strip()

prs.save(OUT)
for f in os.listdir(tmp):
    os.remove(os.path.join(tmp, f))
os.rmdir(tmp)
print('wrote', OUT, len(prs.slides), 'slides')
