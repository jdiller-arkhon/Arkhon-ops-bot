"""Cut the approved role icons out of icon-sheet.png (transparent PNG) into 128x128 Discord icons.

The artwork is used as-is: each glyph is cropped above its label, centred on a square transparent
canvas and resized. Only near-invisible alpha (the faint speckle at the edge of the glow) is dropped.

    python3 cut.py icon-sheet.png <out dir>
"""
import sys
from PIL import Image

# (key, left, top, right, bottom) in the 1774x887 sheet, above each label
BOXES = [
    ("team", 65, 28, 482, 381), ("moderator", 563, 28, 868, 381),
    ("certaStaff", 910, 28, 1260, 381), ("argusStaff", 1318, 28, 1706, 381),
    ("certaUser", 255, 448, 587, 793), ("argusUser", 705, 448, 1052, 793),
    ("verified", 1127, 448, 1508, 793),
]
SIZE, MARGIN = 128, 0.03

src, outdir = sys.argv[1], sys.argv[2]
sheet = Image.open(src).convert("RGBA")
for key, l, t, r, b in BOXES:
    glyph = sheet.crop((l, t, r, b))
    alpha = glyph.getchannel("A").point(lambda v: 0 if v < 20 else v)
    glyph.putalpha(alpha)
    glyph = glyph.crop(alpha.getbbox())
    side = int(max(glyph.size) * (1 + 2 * MARGIN))
    canvas = Image.new("RGBA", (side, side))
    canvas.paste(glyph, ((side - glyph.width) // 2, (side - glyph.height) // 2))
    canvas.resize((SIZE, SIZE), Image.LANCZOS).save(f"{outdir}/{key}.png", optimize=True)
    print(key, glyph.size)
