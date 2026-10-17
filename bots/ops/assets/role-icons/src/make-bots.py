# Builds bots.png (the Arkhon Systems role icon): a chrome hex frame around the four-point star
# cut from icon-sheet.png, to match the other role icons.
#   python3 make-bots.py icon-sheet.png ../bots.png
import math, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops

SHEET, OUT = sys.argv[1], sys.argv[2]
N = 1024
C = N / 2

def hexagon(r, rot=0):
    return [(C + r * math.cos(math.radians(60 * i + rot)), C + r * math.sin(math.radians(60 * i + rot))) for i in range(6)]

def mask_poly(pts):
    m = Image.new('L', (N, N), 0); ImageDraw.Draw(m).polygon(pts, fill=255); return m

# Chrome hex ring (pointy-top), with a gap at top and bottom like the sheet's broken rings
outer, inner = mask_poly(hexagon(440, 30)), mask_poly(hexagon(362, 30))
ring = ImageChops.subtract(outer, inner)
gap = Image.new('L', (N, N), 0); d = ImageDraw.Draw(gap)
for vy in (C - 440, C + 440):
    d.polygon([(C, vy - 120), (C + 70, vy), (C, vy + 120), (C - 70, vy)], fill=255)
ring = ImageChops.subtract(ring, gap)

# Chrome shading: diagonal light bands + bevel (light top-left edge, dark lower-right)
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
t = (xx * 0.55 + yy) / N
band = 0.72 + 0.28 * np.cos(t * math.pi * 3.2 - 0.6)
dist = np.array(ring.filter(ImageFilter.GaussianBlur(10)), np.float32) / 255
shade = np.clip(band * (0.55 + 0.45 * dist), 0, 1)
r = (200 + 55 * shade) * shade + 25
g = (198 + 57 * shade) * shade + 22
b = (215 + 40 * shade) * shade + 40
chrome = np.stack([r, g, b], -1).clip(0, 255).astype(np.uint8)
# dark inner rim for depth
rim = np.array(ImageChops.subtract(ring, ring.filter(ImageFilter.MinFilter(25))), np.float32) / 255
rimin = mask_poly(hexagon(376, 30)); rimin = np.array(rimin, np.float32) / 255 * rim
chrome = (chrome * (1 - 0.75 * rimin[..., None])).astype(np.uint8)
ring_img = Image.fromarray(chrome, 'RGB').convert('RGBA'); ring_img.putalpha(ring)

# Violet glow behind the ring and inside the core
glow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
gl = ring.filter(ImageFilter.GaussianBlur(22)).point(lambda v: int(v * 0.55))
glow.paste((140, 120, 255, 255), (0, 0), gl)
core = Image.new('L', (N, N), 0); ImageDraw.Draw(core).ellipse([C-150, C-150, C+150, C+150], fill=255); core = core.filter(ImageFilter.GaussianBlur(80)).point(lambda v: int(v * 0.35))
glow.paste((118, 92, 255, 255), (0, 0), core)

# Small diamond nodes at the gaps (like the sheet's satellite diamonds)
nodes = Image.new('RGBA', (N, N), (0, 0, 0, 0)); dn = ImageDraw.Draw(nodes)
for cy in (C - 440, C + 440):
    dn.polygon([(C, cy - 60), (C + 32, cy), (C, cy + 60), (C - 32, cy)], fill=(236, 232, 255, 255))
    dn.polygon([(C, cy - 60), (C + 32, cy), (C, cy)], fill=(170, 150, 255, 255))
    dn.polygon([(C, cy), (C - 32, cy), (C, cy + 60)], fill=(120, 100, 220, 255))
nglow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
nglow.paste((150, 130, 255, 255), (0, 0), nodes.split()[3].filter(ImageFilter.GaussianBlur(14)))

# Star core: the real four-point star from the sheet's Certa Staff icon
sheet = Image.open(SHEET).convert('RGBA')
x0, y0, x1, y1 = 910, 28, 1260, 381
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2 + 2
half = 118
star = sheet.crop((cx - half, cy - half, cx + half, cy + half))
# keep only the star: fade out the ring/diamond remnants near the crop edge
fade = Image.new('L', star.size, 0)
ImageDraw.Draw(fade).ellipse([44, 44, star.size[0] - 44, star.size[1] - 44], fill=255)
fade = fade.filter(ImageFilter.GaussianBlur(18))
star.putalpha(ImageChops.multiply(star.split()[3], fade))
star = star.resize((600, 600), Image.LANCZOS)

out = Image.new('RGBA', (N, N), (0, 0, 0, 0))
for layer in (glow, nglow, ring_img, nodes):
    out.alpha_composite(layer)
out.alpha_composite(star, (int(C - 300), int(C - 300)))
out.save(OUT.replace('.png', '-1024.png'))
small = out.resize((128, 128), Image.LANCZOS)
small.save(OUT, optimize=True)
