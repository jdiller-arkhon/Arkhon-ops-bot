"""Certa bot app icon (1024x1024) and profile banner (1360x480), in the same layout as Praetor's
(bots/ops/assets/app-icon.png, app-banner.png): charcoal, faint ring, violet glow and grid, with
the Certa mark from src/mark.py (a Formation dart and check inside a certification ring).

    python3 src/render.py <geist fonts dir>   (from bots/certa/assets; needs Pillow + Playwright)
"""
import base64, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parent))
from mark import DEFS, place

HERE = Path(__file__).resolve().parent.parent
FONTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None

def font_uri(path):
    return 'data:font/woff2;base64,' + base64.b64encode(Path(path).read_bytes()).decode()

ICON = f'''<svg id="art" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<defs>{DEFS}
<radialGradient id="bg" cx="0.5" cy="0.45" r="0.72"><stop offset="0" stop-color="#202025"/><stop offset="0.55" stop-color="#18181b"/><stop offset="1" stop-color="#0d0d0f"/></radialGradient>
<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#7a70e0" stop-opacity="0.5"/><stop offset="0.45" stop-color="#5550b0" stop-opacity="0.2"/><stop offset="1" stop-color="#2a2850" stop-opacity="0"/></radialGradient>
</defs>
<rect width="1024" height="1024" fill="url(#bg)"/>
<circle cx="512" cy="512" r="451" fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="2"/>
<circle cx="512" cy="512" r="400" fill="url(#glow)"/>
{place(512, 512, 760)}
</svg>'''

grid = ''.join(f'<line x1="{1 + 68 * k}" y1="0" x2="{1 + 68 * k}" y2="480"/>' for k in range(21)) + \
       ''.join(f'<line x1="0" y1="{1 + 68 * k}" x2="1360" y2="{1 + 68 * k}"/>' for k in range(8))
fonts = ''
if FONTS:
    fonts = (f"@font-face{{font-family:GeistLight;src:url({font_uri(FONTS / 'geist-sans/Geist-Light.woff2')})}}"
             f"@font-face{{font-family:Geist;src:url({font_uri(FONTS / 'geist-sans/Geist-Regular.woff2')})}}"
             f"@font-face{{font-family:GeistMono;src:url({font_uri(FONTS / 'geist-mono/GeistMono-Regular.woff2')})}}")
BANNER = f'''<svg id="art" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1360 480" width="1360" height="480">
<defs>{DEFS}
<style>{fonts}</style>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0c0c0e"/><stop offset="0.45" stop-color="#151518"/><stop offset="1" stop-color="#26262c"/></linearGradient>
<radialGradient id="bglow" cx="1128" cy="240" r="300" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#6660c8" stop-opacity="0.4"/><stop offset="1" stop-color="#6660c8" stop-opacity="0"/></radialGradient>
<linearGradient id="gfade" x1="0" y1="0" x2="1" y2="0"><stop offset="0.2" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>
<mask id="gm"><rect width="1360" height="480" fill="url(#gfade)"/></mask>
<linearGradient id="rule" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7276bb"/><stop offset="0.75" stop-color="#7276bb" stop-opacity="0.55"/><stop offset="1" stop-color="#7276bb" stop-opacity="0"/></linearGradient>
</defs>
<rect width="1360" height="480" fill="url(#bg)"/>
<g mask="url(#gm)" stroke="#ffffff" stroke-opacity="0.075" stroke-width="1.4">{grid}</g>
<rect width="1360" height="480" fill="url(#bglow)"/>
<text x="420" y="121" font-family="GeistMono" font-size="19.5" letter-spacing="5.4" fill="#9a9cc8">ARKHON INDUSTRIES</text>
<text x="420" y="230" font-family="GeistLight" font-size="82" letter-spacing="13" fill="#f5f5f7">CERTA</text>
<rect x="420" y="276" width="300" height="2" fill="url(#rule)"/>
<text x="420" y="331" font-family="Geist" font-size="24" letter-spacing="0.3" fill="#a1a1aa">Flight log · Currency · Preflight</text>
<text x="420" y="414" font-family="GeistMono" font-size="14" letter-spacing="3" fill="#6e6f8f">ARKHON PILOT NETWORK</text>
{place(1128, 240, 400)}
</svg>'''

with tempfile.TemporaryDirectory() as tmp:
    for name, svg, w, h in [('app-icon.png', ICON, 1024, 1024), ('app-banner.png', BANNER, 1360, 480)]:
        page = Path(tmp) / f'{name}.html'
        page.write_text(f'<!doctype html><html><body style="margin:0;background:#000">{svg}</body></html>')
        subprocess.run(['node', str(HERE / 'src/shot.mjs'), str(page), str(HERE / name), str(w), str(h)], check=True)
        Image.open(HERE / name).convert('RGB').save(HERE / name, optimize=True)
        print('wrote', HERE / name)
