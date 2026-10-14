"""Alleggerisce i PNG delle icone (128 colori, trasparenza conservata). Uso: python3 scripts/shrink_pngs.py assets/food"""
import os, sys
from PIL import Image
d = sys.argv[1]
for f in os.listdir(d):
    if f.endswith('.png'):
        p = os.path.join(d, f)
        Image.open(p).convert('RGBA').quantize(colors=128, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(p, optimize=True)
