"""Cut each glyph out of the dark row of the reference sheet onto a transparent background."""
import sys
from PIL import Image, ImageFilter, ImageChops
src, outdir = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
keys = ["team", "moderator", "certaStaff", "argusStaff", "certaUser", "argusUser", "verified"]
CX = [152 + round(i * 245.2) for i in range(7)]
CY, HALF = 512, 96          # inside the tile's glass border
LO, HI = 34, 150            # luminance -> alpha ramp (tile background sits below LO)

for key, cx in zip(keys, CX):
    tile = im.crop((cx - HALF, CY - HALF, cx + HALF, CY + HALF))
    w, h = tile.size
    px = tile.load()
    out = Image.new("RGBA", (w, h))
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            l = max(r, g, b)
            a = min(1.0, max(0.0, (l - LO) / (HI - LO)))
            if a <= 0:
                op[x, y] = (0, 0, 0, 0)
                continue
            # un-blend from the near-black tile so colours stay bright at partial alpha
            k = min(1.0 / a, 255.0 / max(l, 1))
            op[x, y] = (min(255, int(r * k)), min(255, int(g * k)), min(255, int(b * k)), int(a * 255))
    # a thin graphite edge under the solid parts so the glyph also reads on Discord's light theme
    solid = out.getchannel("A").point(lambda v: 255 if v > 150 else 0)
    edge = solid.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(0.8))
    base = Image.new("RGBA", (w, h), (24, 24, 32, 0))
    base.putalpha(edge.point(lambda v: int(v * 0.85)))
    comp = Image.alpha_composite(base, out)
    # crop to the artwork, square it, and fit it to 128x128 with a small margin
    bbox = comp.getchannel("A").point(lambda v: 255 if v > 20 else 0).getbbox()
    x0, y0, x1, y1 = bbox
    side = max(x1 - x0, y1 - y0) + 8
    cxx, cyy = (x0 + x1) // 2, (y0 + y1) // 2
    sq = Image.new("RGBA", (side, side))
    sq.paste(comp.crop((cxx - side // 2, cyy - side // 2, cxx - side // 2 + side, cyy - side // 2 + side)), (0, 0))
    final = sq.resize((128, 128), Image.LANCZOS)
    final.save(f"{outdir}/{key}.png", optimize=True)
    print(key, bbox, side)
