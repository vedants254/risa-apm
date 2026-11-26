#!/bin/bash
# deck.html -> RISA_Growth_Strategy.pdf, then preview PNGs (arg1 = folder, arg2 = dpi)
cd "$(dirname "$0")"
OUT="$(cygpath -w "$PWD")\RISA_Growth_Strategy.pdf"
timeout 120 "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu --no-pdf-header-footer --virtual-time-budget=8000 --print-to-pdf="$OUT" "file:///$(cygpath -m "$PWD")/deck.html" 2>/dev/null
../.venv/Scripts/python.exe -c "
import fitz,sys
d=fitz.open('RISA_Growth_Strategy.pdf'); print('pages',len(d))
for i,p in enumerate(d): p.get_pixmap(dpi=int(sys.argv[2])).save(sys.argv[1]+'/rk%d.png'%(i+1))
" "$1" "${2:-60}"
