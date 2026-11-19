"""PDF を画像にする。確認用の一覧画像（--sheet）と、動画用の高解像度画像（--dpi 288）の両方に使う。

  python3 render_pages.py manual.pdf outdir [--dpi 110] [--pages 1,4,7] [--sheet]
--sheet を付けると、6 ページずつ並べた sheet-N.jpg も作る（目視確認用）。
"""
import argparse
from pathlib import Path

import pymupdf
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('pdf')
ap.add_argument('outdir')
ap.add_argument('--dpi', type=int, default=110)
ap.add_argument('--pages')
ap.add_argument('--sheet', action='store_true')
a = ap.parse_args()

out = Path(a.outdir)
out.mkdir(parents=True, exist_ok=True)
doc = pymupdf.open(a.pdf)
pages = [int(p) for p in a.pages.split(',')] if a.pages else range(1, doc.page_count + 1)
files = []
for n in pages:
    f = out / f's{n:02d}.png'
    doc[n - 1].get_pixmap(dpi=a.dpi).save(f)
    files.append(f)
print(f'{len(files)} pages -> {out}')

if a.sheet:
    for k in range(0, len(files), 6):
        ims = [Image.open(f) for f in files[k:k + 6]]
        w, h = ims[0].size
        sheet = Image.new('RGB', (w * 2, h * 3), 'white')
        for i, im in enumerate(ims):
            sheet.paste(im, ((i % 2) * w, (i // 2) * h))
        p = out / f'sheet-{k // 6 + 1}.jpg'
        sheet.save(p, quality=85)
        print(p)
