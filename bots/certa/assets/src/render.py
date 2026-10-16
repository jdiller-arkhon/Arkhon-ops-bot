"""Certa bot app icon (1024x1024) and profile banner (1360x480), matched to Praetor's
(bots/ops/assets/app-icon.png, app-banner.png): the approved Certa Staff glyph from the role-icon
design sheet on the same charcoal, ring, violet glow and grid. Artwork is used as-is.

    python3 src/render.py <geist fonts dir>   (from bots/certa/assets; needs Pillow + Playwright)
"""
import base64, io, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent.parent
ROOT = HERE.parent.parent.parent
SHEET = ROOT / 'bots/ops/assets/role-icons/src/icon-sheet.png'
CERTA_STAFF = (910, 28, 1260, 381)          # box above the label (see role-icons/src/cut.py)
ROW = [('certaUser', (255, 448, 587, 793)), ('verified', (1127, 448, 1508, 793)), ('team', (65, 28, 482, 381))]

def glyph(box):
    g = Image.open(SHEET).convert('RGBA').crop(box)
    a = g.getchannel('A').point(lambda v: 0 if v < 20 else v)
    g.putalpha(a)
    return g.crop(a.getbbox())

def data_uri(img):
    buf = io.BytesIO(); img.save(buf, 'PNG'); return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()

def font_uri(path):
    return 'data:font/woff2;base64,' + base64.b64encode(Path(path).read_bytes()).decode()

FONTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None

hero = glyph(CERTA_STAFF)
hero_uri = data_uri(hero)
ratio = hero.height / hero.width

ICON = f'''<svg id="art" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<defs>
<radialGradient id="bg" cx="0.5" cy="0.45" r="0.72"><stop offset="0" stop-color="#202025"/><stop offset="0.55" stop-color="#18181b"/><stop offset="1" stop-color="#0d0d0f"/></radialGradient>
<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#7a70e0" stop-opacity="0.62"/><stop offset="0.45" stop-color="#5550b0" stop-opacity="0.28"/><stop offset="1" stop-color="#2a2850" stop-opacity="0"/></radialGradient>
</defs>
<rect width="1024" height="1024" fill="url(#bg)"/>
<circle cx="512" cy="512" r="451" fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="2"/>
<circle cx="512" cy="508" r="380" fill="url(#glow)"/>
<image href="{hero_uri}" x="{512 - 300}" y="{508 - 300 * ratio:.1f}" width="600" height="{600 * ratio:.1f}"/>
</svg>'''

icons = ''.join(
    f'<image href="{data_uri(glyph(box))}" x="{420 + i * 64}" y="396" width="40" height="40" preserveAspectRatio="xMidYMid meet"/>'
    for i, (_, box) in enumerate(ROW))
grid = ''.join(f'<line x1="{1 + 68 * k}" y1="0" x2="{1 + 68 * k}" y2="480"/>' for k in range(21)) + \
       ''.join(f'<line x1="0" y1="{1 + 68 * k}" x2="1360" y2="{1 + 68 * k}"/>' for k in range(8))
fonts = ''
if FONTS:
    fonts = (f"@font-face{{font-family:GeistLight;src:url({font_uri(FONTS / 'geist-sans/Geist-Light.woff2')})}}"
             f"@font-face{{font-family:Geist;src:url({font_uri(FONTS / 'geist-sans/Geist-Regular.woff2')})}}"
             f"@font-face{{font-family:GeistMono;src:url({font_uri(FONTS / 'geist-mono/GeistMono-Regular.woff2')})}}")
BANNER = f'''<svg id="art" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1360 480" width="1360" height="480">
<defs>
<style>{fonts}</style>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0c0c0e"/><stop offset="0.45" stop-color="#151518"/><stop offset="1" stop-color="#26262c"/></linearGradient>
<radialGradient id="glow" cx="1128" cy="238" r="300" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#6660c8" stop-opacity="0.72"/><stop offset="0.5" stop-color="#433f8c" stop-opacity="0.3"/><stop offset="1" stop-color="#26262c" stop-opacity="0"/></radialGradient>
<linearGradient id="gridFade" x1="0" y1="0" x2="1" y2="0"><stop offset="0.18" stop-color="#fff" stop-opacity="0"/><stop offset="0.55" stop-color="#fff" stop-opacity="0.5"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient>
<mask id="gm"><rect width="1360" height="480" fill="url(#gridFade)"/></mask>
<linearGradient id="rule" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7276bb"/><stop offset="0.75" stop-color="#7276bb" stop-opacity="0.55"/><stop offset="1" stop-color="#7276bb" stop-opacity="0"/></linearGradient>
</defs>
<rect width="1360" height="480" fill="url(#bg)"/>
<g mask="url(#gm)" stroke="#ffffff" stroke-opacity="0.075" stroke-width="1.4">{grid}</g>
<rect width="1360" height="480" fill="url(#glow)"/>
<text x="420" y="121" font-family="GeistMono" font-size="19.5" letter-spacing="5.4" fill="#9a9cc8">ARKHON INDUSTRIES</text>
<text x="420" y="230" font-family="GeistLight" font-size="82" letter-spacing="13" fill="#f5f5f7">CERTA</text>
<rect x="420" y="276" width="300" height="2" fill="url(#rule)"/>
<text x="420" y="331" font-family="Geist" font-size="24" letter-spacing="0.3" fill="#a1a1aa">Flight log · Currency · Preflight</text>
{icons}
<image href="{hero_uri}" x="{1128 - 168}" y="{238 - 168 * ratio:.1f}" width="336" height="{336 * ratio:.1f}"/>
</svg>'''

out = HERE
with tempfile.TemporaryDirectory() as tmp:
    for name, svg, w, h in [('app-icon.png', ICON, 1024, 1024), ('app-banner.png', BANNER, 1360, 480)]:
        page = Path(tmp) / f'{name}.html'
        page.write_text(f'<!doctype html><html><body style="margin:0;background:#000">{svg}</body></html>')
        subprocess.run(['node', str(HERE / 'src/shot.mjs'), str(page), str(out / name), str(w), str(h)], check=True)
        Image.open(out / name).convert('RGB').save(out / name, optimize=True)
        print('wrote', out / name)
