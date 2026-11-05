"""Casino Tycoon v2 decor assets (A10): the six pre-agreed decor items.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \\
        --python assets/blender/decor.py -- [asset-key ...]   (default: all)

Same conventions as heroes.py (game coordinates through its G wrapper, LOD0/1/2,
AO bake, seat_<n> empties), plus:
- Textured surfaces use 'decal_tex<Name>' materials (atlas tiles painted from the
  CC0 Poly Haven textures, see Atlas.ts). tex_uv() gives them a box projection
  scaled to the part's largest extent, so UVs stay inside 0..1 (atlas tiles
  can't wrap).
- 'decal_water__scroll' is fountain water: the object shader scrolls it.
- Empties 'light_<n>' mark practical lights for A8, with custom properties
  'color' (sRGB hex int) and 'radius' (metres); exported as glTF extras.
"""

import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
import heroes  # noqa: E402  (guarded: importing doesn't build the heroes)
from heroes import G, bl  # noqa: E402

TAU = 2 * math.pi

# Extra surfaces (heroes' palette covers the rest). Blender-only: the GLB
# carries the values, the runtime reads them from the material.
common.PALETTE.update(
    {
        'bronze': (0x8A5A2E, 0.32, 1.0, 0.0),
        'bronzeDark': (0x4E331C, 0.4, 1.0, 0.0),
        'stageWood': (0x6B3A1E, 0.45, 0.0, 0.0),
        'spotHead__flash': (0xFFF0C8, 0.3, 0.0, 3.0),
        'globeWarm': (0xFFE2B0, 0.35, 0.0, 2.6),
        'rope': (0xC8A040, 0.6, 0.6, 0.0),
    }
)
# Textured / special decals: white base (the atlas texel shows), some emissive.
for name, emit in (
    ('decal_texMarble', 0.0),
    ('decal_texVelvet', 0.0),
    ('decal_water__scroll', 0.35),
    ('decal_atmScreen', 1.3),
    ('decal_atmSign', 2.2),
):
    common.PALETTE[name] = (0xFFFFFF, 0.08 if 'water' in name else (0.2 if 'Marble' in name else 0.85), 0.0, emit)


def seg(d, hi, lo):
    return hi if d == 0 else (lo if d == 1 else max(6, lo // 2))


def tex_uv(g, faces):
    """Box-project UVs for faces (Blender space), normalised by the faces' largest extent."""
    if not faces:
        return
    vs = [v.co for f in faces for v in f.verts]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    ext = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z) or 1.0
    uv = g.p.bm.loops.layers.uv.verify()
    for f in faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for loop in f.loops:
            c = loop.vert.co - lo
            if ax == 2:
                u, v = c.x, c.y
            elif ax == 0:
                u, v = c.y, c.z
            else:
                u, v = c.x, c.z
            loop[uv].uv = (min(1.0, max(0.0, u / ext)), min(1.0, max(0.0, v / ext)))


def limb(g, a, b, r1, r2, m, s=8):
    """A tapered cylinder between two game-space points."""
    A, B = Vector(bl(*a)), Vector(bl(*b))
    d = B - A
    q = d.to_track_quat('Z', 'Y').to_euler()
    mid = (A + B) / 2
    return g.p.cyl(r1, r2, d.length, tuple(mid), m, seg=s, rot=(q.x, q.y, q.z))


# ---------- builders: (g, d) → (seats, lights) ----------


def statue(g, d):
    """Bronze figure (Lady Luck holding up a star) on a marble plinth."""
    cx, cz = 0.5, 0.5
    b = 0.015 if d == 0 else 0
    mk = 'decal_texMarble'
    t = []
    t += g.box(0.84, 0.12, 0.84, cx, 0, cz, mk, bevel=b)
    t += g.box(0.64, 0.78, 0.64, cx, 0.12, cz, mk, bevel=b)
    t += g.box(0.76, 0.1, 0.76, cx, 0.9, cz, mk, bevel=b)
    tex_uv(g, t)
    if d < 2:
        g.box(0.66, 0.03, 0.66, cx, 0.86, cz, 'brass')
        g.box(0.66, 0.03, 0.66, cx, 0.15, cz, 'brass')
        # Brass name plaque on the front.
        g.box(0.36, 0.14, 0.012, cx, 0.42, cz + 0.326, 'brass', bevel=0.004 if d == 0 else 0)
    y0 = 1.0
    if d == 2:
        g.cyl(0.08, 0.24, 1.3, cx, y0, cz, 'bronze', seg=8)
        g.sphere(0.11, cx, y0 + 1.42, cz, 'bronze', seg=8, rings=5)
        return [], []
    s = seg(d, 24, 10)
    # Robe flaring to the base, cinched waist, shoulders.
    g.lathe(
        [(0, 0), (0.27, 0), (0.25, 0.08), (0.19, 0.45), (0.14, 0.72), (0.17, 0.88), (0.18, 0.98), (0.1, 1.06), (0, 1.07)],
        cx, y0, cz, 'bronze', seg=s,
    )
    g.cyl(0.045, 0.05, 0.1, cx, y0 + 1.05, cz, 'bronze', seg=8)  # neck
    g.sphere(0.105, cx, y0 + 1.22, cz + 0.005, 'bronze', seg=seg(d, 16, 8), rings=seg(d, 10, 6))
    if d == 0:
        g.sphere(0.07, cx, y0 + 1.27, cz - 0.08, 'bronzeDark', seg=10, rings=6)  # hair bun
        # Robe folds: three raised ribs down the front.
        for k in (-1, 0, 1):
            limb(g, (cx + k * 0.07, y0 + 0.7, cz + 0.13), (cx + k * 0.12, y0 + 0.05, cz + 0.24), 0.018, 0.026, 'bronze', 6)
    # Right arm raised, holding a star.
    sh = (cx + 0.17, y0 + 0.97, cz)
    el = (cx + 0.26, y0 + 1.17, cz + 0.04)
    ha = (cx + 0.28, y0 + 1.45, cz + 0.05)
    limb(g, sh, el, 0.045, 0.04, 'bronze', seg(d, 8, 6))
    limb(g, el, ha, 0.04, 0.032, 'bronze', seg(d, 8, 6))
    g.sphere(0.075, ha[0], ha[1] + 0.09, ha[2], 'gold', seg=seg(d, 12, 6), rings=seg(d, 8, 4))
    if d == 0:
        for i in range(5):
            a = TAU * i / 5 + math.pi / 2
            tip = (ha[0] + math.cos(a) * 0.15, ha[1] + 0.09 + math.sin(a) * 0.15, ha[2])
            limb(g, (ha[0], ha[1] + 0.09, ha[2]), tip, 0.03, 0.004, 'gold', 4)
    # Left arm down, holding a laurel wreath.
    sl = (cx - 0.17, y0 + 0.97, cz)
    el2 = (cx - 0.25, y0 + 0.72, cz + 0.06)
    hl = (cx - 0.22, y0 + 0.5, cz + 0.12)
    limb(g, sl, el2, 0.045, 0.04, 'bronze', seg(d, 8, 6))
    limb(g, el2, hl, 0.04, 0.032, 'bronze', seg(d, 8, 6))
    if d == 0:
        g.p.torus(0.09, 0.018, bl(hl[0], hl[1] - 0.06, hl[2] + 0.02), 'gold', seg=16, mseg=6, rot=(0, math.pi / 2, 0))
    return [], []


def fountain(g, d):
    """3x3 basin with a two-tier marble and bronze centrepiece; scrolling water."""
    cx = cz = 1.5
    s = seg(d, 40, 16)
    mk = 'decal_texMarble'
    t = []
    # Basin wall: an outer lip and an inner face, plus a floor.
    t += g.lathe([(1.42, 0), (1.46, 0.05), (1.46, 0.42), (1.5, 0.46), (1.5, 0.52), (1.3, 0.52), (1.28, 0.46), (1.28, 0.1), (0, 0.1)],
                 cx, 0, cz, mk, seg=s)
    tex_uv(g, t)
    water = g.cyl(1.285, 1.285, 0.02, cx, 0.36, cz, 'decal_water__scroll', seg=s)
    tex_uv(g, water)
    if d == 2:
        g.cyl(0.18, 0.28, 1.5, cx, 0.1, cz, 'marbleWhite', seg=8)
        g.cyl(0.6, 0.6, 0.12, cx, 1.1, cz, 'bronze', seg=8)
        return [], []
    # Pedestal, lower bowl, stem, upper bowl, finial.
    t = g.lathe([(0, 0.1), (0.36, 0.1), (0.3, 0.2), (0.17, 0.3), (0.15, 0.9), (0.2, 0.95), (0, 0.95)], cx, 0, cz, mk, seg=seg(d, 24, 10))
    tex_uv(g, t)
    g.lathe([(0.12, 0.92), (0.4, 0.98), (0.66, 1.1), (0.7, 1.17), (0.64, 1.17), (0.38, 1.06), (0.12, 1.02)], cx, 0, cz, 'bronze',
            seg=seg(d, 32, 12))
    w2 = g.cyl(0.64, 0.64, 0.015, cx, 1.13, cz, 'decal_water__scroll', seg=seg(d, 32, 12))
    tex_uv(g, w2)
    g.cyl(0.07, 0.09, 0.55, cx, 1.15, cz, 'bronze', seg=seg(d, 12, 6))
    g.lathe([(0.06, 1.66), (0.22, 1.72), (0.33, 1.8), (0.3, 1.82), (0.18, 1.76), (0.06, 1.74)], cx, 0, cz, 'bronze', seg=seg(d, 24, 10))
    g.sphere(0.07, cx, 1.86, cz, 'gold', seg=seg(d, 12, 6), rings=seg(d, 8, 4))
    # Falling water: open sheets from each bowl's rim down to the water below.
    for (r, ytop, ybot) in ((0.66, 1.12, 0.37), (0.31, 1.78, 1.14)):
        h = ytop - ybot
        sheet = g.p.cyl(r + 0.03, r - 0.01, h, bl(cx, ybot + h / 2, cz), 'decal_water__scroll', seg=seg(d, 32, 12), cap=False)
        tex_uv(g, sheet)
    if d == 0:
        # Spout jet from the finial and a bronze rim band on the basin.
        g.p.cyl(0.02, 0.035, 0.25, bl(cx, 2.0, cz), 'decal_water__scroll', seg=8, cap=False)
        g.p.torus(1.49, 0.02, bl(cx, 0.52, cz), 'brass', seg=48, mseg=6)
    return [], []


def lamp_post(g, d):
    """Brass lamp post with a cluster of three warm globes."""
    cx = cz = 0.5
    s = seg(d, 20, 8)
    g.lathe([(0, 0), (0.2, 0), (0.2, 0.05), (0.15, 0.12), (0.09, 0.24), (0.06, 0.4), (0, 0.4)], cx, 0, cz, 'blackGloss', seg=s)
    g.cyl(0.04, 0.05, 2.15, cx, 0.4, cz, 'brass', seg=seg(d, 12, 6))
    if d < 2:
        for y in (0.42, 1.2, 2.5):
            g.cyl(0.065, 0.065, 0.05, cx, y, cz, 'brass', seg=seg(d, 12, 6))
    lights = []
    hub = 2.55
    if d == 2:
        g.sphere(0.32, cx, hub + 0.15, cz, 'globeWarm', seg=8, rings=5)
        return [], [(cx, hub + 0.2, cz, 0xFFD9A0, 4.5)]
    for i in range(3):
        a = TAU * i / 3 + math.pi / 6
        x, z = cx + math.cos(a) * 0.24, cz + math.sin(a) * 0.24
        limb(g, (cx, hub, cz), (x, hub + 0.12, z), 0.02, 0.018, 'brass', 6)
        g.cyl(0.05, 0.035, 0.05, x, hub + 0.1, z, 'brass', seg=seg(d, 10, 6))
        g.sphere(0.12, x, hub + 0.26, z, 'globeWarm', seg=seg(d, 16, 8), rings=seg(d, 10, 6))
    g.sphere(0.14, cx, hub + 0.42, cz, 'globeWarm', seg=seg(d, 16, 8), rings=seg(d, 10, 6))
    g.cyl(0.03, 0.01, 0.12, cx, hub + 0.55, cz, 'brass', seg=6)
    lights.append((cx, hub + 0.3, cz, 0xFFD9A0, 4.5))
    return [], lights


def lounge_seating(g, d):
    """2x1 velvet sofa facing +z (front), brass feet; two seats."""
    b = 0.04 if d == 0 else 0
    vv = 'decal_texVelvet'
    t = []
    t += g.box(1.9, 0.22, 0.78, 1.0, 0.12, 0.5, vv, bevel=b)          # base
    t += g.box(1.9, 0.5, 0.2, 1.0, 0.34, 0.2, vv, bevel=b * 1.5)      # back
    for x in (0.12, 1.88):
        t += g.box(0.2, 0.3, 0.78, x, 0.34, 0.5, vv, bevel=b * 1.2)   # arms
    if d < 2:
        for x in (0.57, 1.43):
            t += g.box(0.82, 0.12, 0.58, x, 0.34, 0.6, vv, bevel=b * 1.5)  # seat cushions
            if d == 0:
                t += g.box(0.74, 0.34, 0.12, x, 0.5, 0.32, vv, bevel=0.05, rx=-0.12)  # back cushions
                # Button tufting on the back.
                for k in (-1, 0, 1):
                    g.sphere(0.018, x + k * 0.22, 0.7, 0.315, 'gold', seg=6, rings=4)
    tex_uv(g, t)
    if d < 2:
        for x in (0.1, 1.9):
            for z in (0.18, 0.82):
                g.cyl(0.03, 0.022, 0.12, x, 0, z, 'brass', seg=seg(d, 8, 6))
        g.box(1.92, 0.03, 0.8, 1.0, 0.12, 0.5, 'gold')  # brass piping along the base
    return [(0.57, 0.62, 0.0), (1.43, 0.62, 0.0)], []


def atm(g, d):
    """ATM kiosk: gunmetal body, brass trim, lit screen and ATM sign."""
    b = 0.02 if d == 0 else 0
    g.box(0.78, 0.08, 0.6, 0.5, 0, 0.45, 'blackGloss', bevel=b)
    g.box(0.72, 1.28, 0.54, 0.5, 0.08, 0.42, 'gunmetal', bevel=b)
    # Sloped fascia with the screen.
    g.box(0.66, 0.42, 0.06, 0.5, 1.02, 0.67, 'blackGloss', bevel=b, rx=-0.32)
    if d < 2:
        g.decal_front(0.46, 0.3, 0.5, 1.24, 0.715, 'decal_atmScreen', tilt=0.32)
        # Keypad shelf, keys, card slot and cash slot.
        g.box(0.6, 0.04, 0.2, 0.5, 0.96, 0.76, 'stainless', bevel=0.01 if d == 0 else 0)
        if d == 0:
            for r in range(4):
                for c in range(3):
                    g.box(0.04, 0.012, 0.03, 0.42 + c * 0.055, 1.0, 0.71 + r * 0.035,
                          'buttonGreen' if (r, c) == (3, 2) else ('buttonRed' if (r, c) == (3, 0) else 'chrome'))
            g.box(0.12, 0.02, 0.02, 0.66, 1.0, 0.74, 'buttonAmber')
        g.box(0.36, 0.05, 0.03, 0.5, 0.74, 0.69, 'blackMatte')
        g.box(0.74, 0.03, 0.56, 0.5, 1.36, 0.42, 'brass')
    # Lit header with the ATM sign.
    g.box(0.74, 0.3, 0.5, 0.5, 1.39, 0.4, 'blackGloss', bevel=b)
    g.decal_front(0.66, 0.24, 0.5, 1.54, 0.652, 'decal_atmSign')
    return [(0.5, 1.12, math.pi)], [(0.5, 1.5, 0.75, 0x7FD8FF, 2.0)]


def stage(g, d):
    """4x3 raised stage: wood deck, marble apron, velvet curtain, lighting truss."""
    b = 0.02 if d == 0 else 0
    mk = 'decal_texMarble'
    t = g.box(4.0, 0.5, 2.5, 2.0, 0, 1.25, mk, bevel=b)  # apron / riser
    tex_uv(g, t)
    g.box(3.96, 0.04, 2.46, 2.0, 0.5, 1.25, 'stageWood')
    if d < 2:
        g.box(4.02, 0.05, 0.06, 2.0, 0.46, 2.5, 'gold')  # nosing
        # Steps down to the floor in front, centred.
        for i, (h, z) in enumerate(((0.34, 2.67), (0.17, 2.85))):
            st = g.box(1.4, h, 0.18, 2.0, 0, z, mk, bevel=b)
            tex_uv(g, st)
    # Curtain: a pleated velvet sheet across the back, valance on top.
    pleats = 18 if d == 0 else (8 if d == 1 else 0)
    if pleats:
        front, back = [], []
        n = pleats * 4
        for i in range(n + 1):
            x = 0.12 + 3.76 * i / n
            z = 0.2 + 0.07 * math.sin(i / 4 * TAU)
            front.append((x, z + 0.025))
            back.append((x, z - 0.025))
        cur = g.slab(front + list(reversed(back)), 0.54, 3.3, 'decal_texVelvet')
        tex_uv(g, cur)
        val = g.box(3.9, 0.4, 0.1, 2.0, 3.1, 0.3, 'decal_texVelvet', bevel=b)
        tex_uv(g, val)
        g.box(3.92, 0.05, 0.12, 2.0, 3.06, 0.32, 'gold')
    else:
        cur = g.box(3.8, 2.8, 0.1, 2.0, 0.5, 0.2, 'decal_texVelvet')
        tex_uv(g, cur)
    # Truss: two posts and a box-section bar over the front of the deck, four spot heads.
    lights = []
    tz = 1.9
    for x in (0.1, 3.9):
        g.box(0.12, 3.6, 0.12, x, 0.5, tz, 'gunmetal')
    g.box(3.92, 0.14, 0.14, 2.0, 3.96, tz, 'gunmetal')
    if d == 0:
        # Lattice on the bar.
        for i in range(16):
            x0 = 0.1 + i * 0.238
            limb(g, (x0, 3.97, tz + 0.07), (x0 + 0.238, 4.09, tz + 0.07), 0.008, 0.008, 'chrome', 4)
            limb(g, (x0, 3.97, tz - 0.07), (x0 + 0.238, 4.09, tz - 0.07), 0.008, 0.008, 'chrome', 4)
    heads = [0.7, 1.55, 2.45, 3.3]
    for i, x in enumerate(heads):
        if d < 2:
            g.box(0.03, 0.14, 0.03, x, 3.82, tz, 'gunmetal')
            # Can light aimed down at the deck, lens toward the stage.
            limb(g, (x, 3.8, tz + 0.08), (x, 3.62, tz - 0.12), 0.09, 0.09, 'blackMatte', seg(d, 12, 6))
            g.p.cyl(0.075, 0.075, 0.01, bl(x, 3.61, tz - 0.13), 'spotHead__flash', seg=seg(d, 12, 6),
                    rot=(math.pi / 2 - 0.84, 0, 0))
        lights.append((x, 3.6, tz - 0.14, [0xFFE7B8, 0xFF7AC8, 0x7FD0FF, 0xFFE7B8][i], 5.0))
    return [], lights


ASSETS = {
    # key: (footprint w, h, builder)
    'statue': (1, 1, statue),
    'fountain': (3, 3, fountain),
    'lamp-post': (1, 1, lamp_post),
    'lounge-seating': (2, 1, lounge_seating),
    'atm': (1, 1, atm),
    'stage': (4, 3, stage),
}


def build(key):
    common.reset()
    common._mats.clear()
    w, h, fn = ASSETS[key]
    lods = []
    seats, lights = [], []
    for d in range(3):
        root = common.empty(f'LOD{d}')
        g = G(f'{key}_lod{d}')
        s, li = fn(g, d)
        if d == 0:
            seats, lights = s or [], li or []
        ob = g.finish(root)
        common.apply_modifiers(ob)
        lods.append((root, ob))
    for i, (x, z, face) in enumerate(seats):
        common.empty(f'seat_{i}', loc=bl(x, 0, z), rot=(0, 0, face))
    for i, (x, y, z, color, radius) in enumerate(lights):
        e = common.empty(f'light_{i}', loc=bl(x, y, z))
        e['color'] = color
        e['radius'] = radius
    floor = bpy.data.objects.new('aofloor', bpy.data.meshes.new('aofloor'))
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=w + h + 2)
    bm.to_mesh(floor.data)
    bm.free()
    floor.location = (w / 2, -h / 2, 0)
    bpy.context.scene.collection.objects.link(floor)
    for d in (0, 1):
        for k, (_, ob) in enumerate(lods):
            ob.hide_render = k != d
        common.bake_ao([lods[d][1]])
    for _, ob in lods:
        ob.hide_render = False
    bpy.data.objects.remove(floor)
    tris = [common.tri_count(ob) for _, ob in lods]
    objs = [o for o in bpy.data.objects]
    path = os.path.join(common.MODELS, f'{key}.glb')
    common.export_glb(path, objs, extras=True)
    os.makedirs(common.SOURCES, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(common.SOURCES, f'{key}.blend'))
    print(
        f'ASSET {key} tris={tris} bytes={os.path.getsize(path)} '
        f'seats={json.dumps([[round(x, 3), round(z, 3), round(f, 3)] for x, z, f in seats])} '
        f'lights={json.dumps([[round(x, 2), round(y, 2), round(z, 2), hex(c), r] for x, y, z, c, r in lights])}'
    )


def main():
    keys = common.args() or list(ASSETS)
    for k in keys:
        build(k)


main()
