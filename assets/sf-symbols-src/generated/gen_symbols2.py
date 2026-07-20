#!/usr/bin/env python3
"""Generate the 6 custom SF Symbol .symbolset folders — v2, using the REAL Apple
export template (foxhunt.svg) so actool accepts them (a flat SVG is rejected:
"must have a glyph for Regular weight Medium size").

We keep the template's Notes + Guides + the 3 weight groups (Ultralight/Regular/
Black-S) verbatim, and swap the foxhunt artwork for ours — mapped from our 24x24
design box into the template cell (origin on Baseline-S, centered horizontally,
sized to ~cap-height), same framing the real icon uses.
"""
import os, re, json, numpy as np
from svgpathtools import parse_path
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union
import masters as M

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "symbols")
TEMPLATE = open(os.path.join(HERE, "foxhunt.svg")).read()

# ---- template cell geometry (from foxhunt.svg guides) ----
CAP_H = 696 - 625.541          # 70.459  (Baseline-S - Capline-S)
MARGIN_W = 1494.13 - 1405.56   # 88.57   (Regular-S right-left margin)
CX = MARGIN_W / 2.0            # 44.285  horizontal center (local)
CY = -CAP_H / 2.0             # -35.23  vertical center (local, above baseline)
S = 84.0                      # side our 24-box maps to. TUNE if the icon looks too
                              # big/small on device (this is the knob). 70 ≈ cap
                              # height (device-tested: too small — artwork only
                              # fills ~20/24 of the box). 84 = 70×24/20, so the
                              # ~20-unit Figma artwork renders at full cap height.
SCALE = S / 24.0
TX_IN = CX - S / 2.0          # inner-g translate x
TY_IN = CY - S / 2.0          # inner-g translate y
CLS = 'monochrome-0 multicolor-0:tintColor hierarchical-0:primary SFSymbolsPreviewWireframe'

# The 3 identical foxhunt artwork paths inside <g id="Symbols"> (unique via class).
FOX_ART_RE = re.compile(r'<path class="monochrome-0.*?/>', re.DOTALL)


def stroke_to_fill(d, width, offset=(0.0, 0.0)):
    """Expand a stroked path to filled polygons. `offset` translates raw (e.g.
    nav-bar-space Figma) coordinates into the 24x24 design box first."""
    ox, oy = offset
    polys = []
    for sub in parse_path(d).continuous_subpaths():
        n = max(64, int(sub.length() * 12))
        pts = [(p.real + ox, p.imag + oy) for p in (sub.point(t) for t in np.linspace(0, 1, n))]
        clean = [pts[0]]
        for c in pts[1:]:
            if abs(c[0]-clean[-1][0]) > 1e-6 or abs(c[1]-clean[-1][1]) > 1e-6:
                clean.append(c)
        if len(clean) >= 2:
            polys.append(LineString(clean).buffer(width/2, cap_style="round", join_style="round", quad_segs=18))
    return unary_union(polys)


def fills_to_geom(paths, offset=(0.0, 0.0)):
    ox, oy = offset
    polys = []
    for d in paths:
        for sub in parse_path(d).continuous_subpaths():
            n = max(48, int(sub.length() * 12))
            ring = [(p.real + ox, p.imag + oy) for p in (sub.point(t) for t in np.linspace(0, 1, n))]
            if len(ring) >= 3:
                polys.append(Polygon(ring).buffer(0))
    return unary_union(polys)


def _bake(x, y):
    """Map our 24x24 design coords into the template cell's LOCAL space (origin on
    the baseline). Baked into the path data directly — the SF Symbol compiler does
    NOT honor a nested <g transform> inside a weight group, so the path must sit
    straight in the group like the real template does."""
    return SCALE * x + TX_IN, SCALE * y + TY_IN


def geom_to_pathdata(geom):
    parts = []
    geoms = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
    for poly in geoms:
        for ring in [poly.exterior, *poly.interiors]:
            cs = list(ring.coords)
            if len(cs) < 3:
                continue
            x0, y0 = _bake(*cs[0])
            d = "M%.3f %.3f" % (x0, y0)
            for x, y in cs[1:]:
                bx, by = _bake(x, y)
                d += "L%.3f %.3f" % (bx, by)
            parts.append(d + "Z")
    return "".join(parts)


def artwork_markup(pathdata_list):
    """Direct filled paths (coords already baked into cell space) — no wrapper <g>,
    exactly like the real template's weight groups."""
    return "".join('<path class="%s" fill-rule="evenodd" d="%s"/>' % (CLS, d) for d in pathdata_list)


LINEUP_FILL = M.LINEUP_FILL_PATHS

ARTWORK = {
    # Outlines: exact Figma nav-bar vectors (stroke 1), recentred via offsets.
    "co.swellyo.lineup":       [geom_to_pathdata(stroke_to_fill(M.LINEUP_STROKE, M.LINEUP_STROKE_WIDTH, M.LINEUP_STROKE_OFFSET))],
    "co.swellyo.lineup.fill":  [geom_to_pathdata(fills_to_geom(LINEUP_FILL, M.LINEUP_FILL_OFFSET))],
    "co.swellyo.trips":        [geom_to_pathdata(stroke_to_fill(M.TRIPS_STROKE, M.TRIPS_STROKE_WIDTH, M.TRIPS_STROKE_OFFSET))],
    "co.swellyo.trips.fill":   [geom_to_pathdata(fills_to_geom(M.TRIPS_FILL_PATHS))],
    "co.swellyo.profile":      [geom_to_pathdata(stroke_to_fill(M.PROFILE_STROKE, M.PROFILE_STROKE_WIDTH, M.PROFILE_STROKE_OFFSET))],
    "co.swellyo.profile.fill": [geom_to_pathdata(fills_to_geom(M.PROFILE_FILL_PATHS))],
}


def build_svg(name):
    art = artwork_markup(ARTWORK[name])
    svg, n = FOX_ART_RE.subn(art, TEMPLATE)
    assert n == 3, "expected 3 weight-group artwork replacements, got %d for %s" % (n, name)
    svg = svg.replace("custom.foxhunt", name).replace('glyph: "foxhunt"', 'glyph: "%s"' % name)
    return svg


for name, art in ARTWORK.items():
    folder = os.path.join(OUT, name + ".symbolset")
    os.makedirs(folder, exist_ok=True)
    fn = name + ".svg"
    with open(os.path.join(folder, fn), "w") as f:
        f.write(build_svg(name))
    with open(os.path.join(folder, "Contents.json"), "w") as f:
        json.dump({"info": {"author": "xcode", "version": 1},
                   "symbols": [{"idiom": "universal", "filename": fn}]}, f, indent=2)
    print("wrote", name + ".symbolset")
print("done (S=%.1f, scale=%.4f, center=(%.2f,%.2f))" % (S, SCALE, CX, CY))
