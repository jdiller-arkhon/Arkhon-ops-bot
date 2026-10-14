"""Build the role icons from the approved design sheet (reference-sheet.png).

For each glyph in the sheet's dark row: cut it out onto transparency, drop stray specks and the
tile's floor reflection, re-shade it in the website's charcoal-to-white metal with the logo's
periwinkle glow, add a thin charcoal edge for Discord's light theme, and fit it to 128x128.

    python3 extract.py reference-sheet.png <out dir>
"""
import colorsys
import sys
from collections import deque

from PIL import Image, ImageFilter

KEYS = ["team", "moderator", "certaStaff", "argusStaff", "certaUser", "argusUser", "verified"]
CX = [152 + round(i * 245.2) for i in range(7)]
CY, HALF = 512, 96          # sample area inside each tile's glass border
LO, HI = 34, 150            # brightness -> opacity ramp; the tile background sits below LO

# Website palette (app/globals.css): charcoal ink to white, plus the logo star's periwinkle.
METAL = [(0.0, (17, 17, 19)), (0.35, (43, 43, 46)), (0.55, (72, 72, 76)), (0.78, (201, 201, 207)), (1.0, (255, 255, 255))]
GLOW = (119, 123, 196)
EDGE = (29, 29, 31)


def ramp(t):
    t = max(0.0, min(1.0, t))
    for (t0, c0), (t1, c1) in zip(METAL, METAL[1:]):
        if t <= t1:
            k = (t - t0) / (t1 - t0)
            return tuple(int(a + (b - a) * k) for a, b in zip(c0, c1))
    return METAL[-1][1]


def contrast(t):
    # gentle S-curve: deeper facet shadows, crisper highlights
    return t * t * (3 - 2 * t) * 0.6 + t * 0.4


def keep_main_parts(alpha, w, h, min_share=0.008, solid=0.15):
    """Zero out connected pieces smaller than min_share of the largest piece (specks, reflections)."""
    seen = [[False] * w for _ in range(h)]
    parts = []
    for y in range(h):
        for x in range(w):
            if seen[y][x] or alpha[y][x] < solid:
                continue
            q, part = deque([(x, y)]), []
            seen[y][x] = True
            while q:
                cx, cy = q.popleft()
                part.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and alpha[ny][nx] >= solid:
                        seen[ny][nx] = True
                        q.append((nx, ny))
            parts.append(part)
    if not parts:
        return alpha
    biggest = max(len(p) for p in parts)
    keep = [[False] * w for _ in range(h)]
    for part in parts:
        if len(part) >= biggest * min_share:
            for x, y in part:
                keep[y][x] = True
    # keep faint glow only where it is close to a kept piece
    near = Image.new("L", (w, h))
    near.putdata([255 if keep[y][x] else 0 for y in range(h) for x in range(w)])
    near = near.filter(ImageFilter.MaxFilter(15)).load()
    return [[alpha[y][x] if (keep[y][x] or (alpha[y][x] < solid and near[x, y])) else 0.0 for x in range(w)] for y in range(h)]


def build(sheet, key, cx, floor_cut=None, min_share=0.008, solid=0.15):
    tile = sheet.crop((cx - HALF, CY - HALF, cx + HALF, CY + HALF))
    w, h = tile.size
    px = tile.load()
    alpha = [[0.0] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            alpha[y][x] = max(0.0, min(1.0, (max(px[x, y]) - LO) / (HI - LO)))
            if floor_cut and y > floor_cut(x):
                alpha[y][x] = 0.0
    alpha = keep_main_parts(alpha, w, h, min_share, solid)

    out = Image.new("RGBA", (w, h))
    op = out.load()
    for y in range(h):
        for x in range(w):
            a = alpha[y][x]
            if a <= 0:
                continue
            r, g, b = px[x, y]
            hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            lum = min(1.0, (0.3 * r + 0.59 * g + 0.11 * b) / 255 / max(a, 0.05))
            metal = ramp(contrast(lum))
            # saturated lavender (the glow) becomes the logo periwinkle
            tint = min(1.0, max(0.0, (s - 0.12) / 0.25)) * (1 - min(1.0, a * 1.4) * 0.5)
            col = tuple(int(m * (1 - tint) + gcol * tint) for m, gcol in zip(metal, GLOW))
            op[x, y] = col + (int(a * 255),)

    # thin charcoal edge under the solid metal so the glyph reads on light backgrounds
    solid = out.getchannel("A").point(lambda v: 255 if v > 170 else 0)
    edge = solid.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
    base = Image.new("RGBA", (w, h), EDGE + (0,))
    base.putalpha(edge.point(lambda v: int(v * 0.9)))
    comp = Image.alpha_composite(base, out)

    x0, y0, x1, y1 = comp.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    side = max(x1 - x0, y1 - y0) + 8
    mx, my = (x0 + x1) // 2, (y0 + y1) // 2
    sq = Image.new("RGBA", (side, side))
    sq.paste(comp.crop((mx - side // 2, my - side // 2, mx - side // 2 + side, my - side // 2 + side)), (0, 0))
    icon = sq.resize((128, 128), Image.LANCZOS)
    return icon.filter(ImageFilter.UnsharpMask(radius=1.2, percent=70, threshold=2))


if __name__ == "__main__":
    src, outdir = sys.argv[1], sys.argv[2]
    sheet = Image.open(src).convert("RGB")
    for key, cx in zip(KEYS, CX):
        # the Team tile has a floor reflection under the A; drop small pieces more aggressively there
        build(sheet, key, cx, **({"min_share": 0.02, "solid": 0.3} if key == "team" else {})).save(f"{outdir}/{key}.png", optimize=True)
        print(key)
