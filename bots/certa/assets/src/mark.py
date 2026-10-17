"""Certa mark: a faceted chrome Formation dart wrapped by a tilted flight-path orbit,
inside a HUD ring that opens into a "C" for Certa. Praetor's chrome-and-violet style.
place(cx, cy, size) returns the mark centered at (cx, cy); it is drawn in a 1000-unit box."""
import math

DEFS = '''
<linearGradient id="fLo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#cfcfdf"/><stop offset="1" stop-color="#7b7b96"/></linearGradient>
<linearGradient id="fLi" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f3ff"/><stop offset="1" stop-color="#9c98c8"/></linearGradient>
<linearGradient id="fRi" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a83f0"/><stop offset="0.4" stop-color="#3a3670"/><stop offset="1" stop-color="#14131f"/></linearGradient>
<linearGradient id="fRo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#25233f"/><stop offset="1" stop-color="#0a0a10"/></linearGradient>
<linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0efff"/><stop offset="0.5" stop-color="#a49ff0"/><stop offset="1" stop-color="#5550b8"/></linearGradient>
<linearGradient id="trail" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#a59cff" stop-opacity="0.2"/><stop offset="0.35" stop-color="#c4bdff"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
<radialGradient id="flare" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffffff"/><stop offset="0.25" stop-color="#cfc9ff" stop-opacity="0.8"/><stop offset="1" stop-color="#7a70e0" stop-opacity="0"/></radialGradient>
<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12"/></filter>
<filter id="spark" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
'''

CX, CY, R = 500, 510, 340

def _pt(r, deg):
    a = math.radians(deg - 90)
    return CX + r * math.cos(a), CY + r * math.sin(a)

def _arc(r, a0, a1):
    (x0, y0), (x1, y1) = _pt(r, a0), _pt(r, a1)
    return f'M{x0:.1f} {y0:.1f} A{r} {r} 0 {int(a1 - a0 > 180)} 1 {x1:.1f} {y1:.1f}'

def _ring():
    out = [f'<circle cx="{CX}" cy="{CY}" r="{R}" fill="none" stroke="#7a70e0" stroke-opacity="0.5" stroke-width="34" filter="url(#soft)"/>']
    # main ring in four arcs, gaps at the cardinal points
    out.append(f'<path d="{_arc(R, 125, 235)}" fill="none" stroke="url(#ring)" stroke-width="14" stroke-linecap="round"/>')
    out.append(f'<path d="{_arc(R, 245, 415)}" fill="none" stroke="url(#ring)" stroke-width="14" stroke-linecap="round"/>')
    # inner hairline + outer HUD arcs
    out.append(f'<circle cx="{CX}" cy="{CY}" r="{R - 34}" fill="none" stroke="#b8b3ff" stroke-opacity="0.18" stroke-width="2"/>')
    for a0, a1 in ((300, 340), (130, 170), (195, 230)):
        out.append(f'<path d="{_arc(R + 44, a0, a1)}" fill="none" stroke="#c9c5ff" stroke-opacity="0.45" stroke-width="3"/>')
    ticks = []
    for d in range(0, 360, 10):
        if 60 < d < 120 or d % 90 == 0: continue
        r2 = R + 30 if d % 30 == 0 else R + 22
        (x0, y0), (x1, y1) = _pt(R + 12, d), _pt(r2, d)
        ticks.append(f'<line x1="{x0:.1f}" y1="{y0:.1f}" x2="{x1:.1f}" y2="{y1:.1f}" stroke-width="{2.6 if d % 30 == 0 else 1.4}"/>')
    out.append(f'<g stroke="#d6d3ff" stroke-opacity="0.5" stroke-linecap="round">{"".join(ticks)}</g>')
    # cardinal diamonds (east, west)
    for d in (240,):
        x, y = _pt(R, d)
        out.append(f'<path d="M{x:.1f} {y-16:.1f} L{x+9:.1f} {y:.1f} L{x:.1f} {y+16:.1f} L{x-9:.1f} {y:.1f} Z" fill="#e6e4ff" filter="url(#spark)"/>')
    return ''.join(out)

def _dart(tx, ty, s, faceted=True):
    """Dart with tip (tx, ty): wing half-width 290s, length 680s, notch at 500s."""
    lw, rw, n = (tx - 290*s, ty + 680*s), (tx + 290*s, ty + 680*s), (tx, ty + 500*s)
    ridge = (tx, ty + 330*s)
    P = lambda *ps: 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in ps) + ' Z'
    if not faceted:
        return f'<path d="{P((tx, ty), rw, n, lw)}" fill="url(#fLi)" opacity="0.85"/>'
    return (f'<path d="{P((tx, ty), lw, ridge)}" fill="url(#fLo)"/>'
            f'<path d="{P(ridge, lw, n)}" fill="url(#fLi)"/>'
            f'<path d="{P((tx, ty), ridge, rw)}" fill="url(#fRo)"/>'
            f'<path d="{P(ridge, n, rw)}" fill="url(#fRi)"/>'
            f'<path d="M{tx} {ty} L{lw[0]:.1f} {lw[1]:.1f}" stroke="#ffffff" stroke-width="3"/>'
            f'<path d="M{tx} {ty} L{rw[0]:.1f} {rw[1]:.1f} L{n[0]:.1f} {n[1]:.1f}" fill="none" stroke="#9e97ff" stroke-width="2.5" stroke-linejoin="round"/>'
            f'<path d="M{tx} {ty + 12} L{ridge[0]:.1f} {ridge[1]:.1f}" stroke="#ffffff" stroke-width="4" filter="url(#spark)"/>')

def mark():
    out = [_ring()]
    out.append(_dart(500, 135, 1.0))
    # flight-path orbit: tilted ellipse; back half drawn first (behind the dart), front half after
    orbit = lambda half: (f'<path d="M140 560 A370 120 -18 0 {half} 860 330" fill="none" stroke="{{c}}" '
                          f'stroke-width="{{w}}" stroke-linecap="round" {{f}}/>')
    back = orbit(1)
    front = orbit(0)
    out.insert(1, back.format(c='#8d83ff', w=6, f='opacity="0.55"'))
    out.append(front.format(c='#0b0a12', w=26, f=''))
    out.append(front.format(c='#8d83ff', w=30, f='filter="url(#soft)" opacity="0.9"'))
    out.append(front.format(c='url(#trail)', w=10, f='filter="url(#spark)"'))
    # craft on the orbit: bright glint at the leading end
    out.append('<circle cx="860" cy="330" r="60" fill="url(#flare)"/>')
    out.append('<path d="M860 296 L866 324 L894 330 L866 336 L860 364 L854 336 L826 330 L854 324 Z" fill="#ffffff"/>')
    # crystal core at the ridge
    out.append('<path d="M500 395 L540 465 L500 535 L460 465 Z" fill="#cfc9ff" filter="url(#spark)"/>'
               '<path d="M500 395 L540 465 L500 465 Z" fill="#ffffff"/><path d="M500 465 L460 465 L500 535 Z" fill="#6c64d8"/>')
    out.append('<circle cx="500" cy="140" r="34" fill="url(#flare)" opacity="0.8"/>')
    return ''.join(out)

def place(cx, cy, size):
    s = size / 1000
    return f'<g transform="translate({cx - 500*s:.2f} {cy - 500*s:.2f}) scale({s:.4f})">{mark()}</g>'
