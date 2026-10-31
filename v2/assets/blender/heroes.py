"""Casino Tycoon v2 hero assets.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \\
        --python assets/blender/heroes.py -- [asset-key ...]   (default: all)

Each asset is written in GAME coordinates (x right, y up, z = front, metres,
origin at the footprint's min corner) through the G wrapper, which converts to
Blender's Z-up / front = -Y frame so the glTF lands back in game space.
Every builder takes a detail level d: 0 = hero LOD0, 1 = LOD1 (fewer
segments, small props dropped), 2 = LOD2 (chunky blocks for > 72 m).

Output: assets/models/<key>.glb (meshopt), assets/sources/<key>.blend,
and a seats line per asset (copied into src/shared/catalog.ts).
"""

import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
from common import Part  # noqa: E402

TAU = 2 * math.pi


def bl(x, y, z):
    """Game (x, y-up, z-front) → Blender (x, -z, y)."""
    return (x, -z, y)


class G:
    """Game-space builder over common.Part."""

    def __init__(self, name):
        self.p = Part(name)

    def box(self, sx, sy, sz, cx, y0, cz, m, bevel=0.0, ry=0.0, rx=0.0):
        # Game rotation about y ↔ Blender rotation about z (same sign); game x-tilt ↔ Blender x (opposite).
        return self.p.box((sx, sz, sy), bl(cx, y0 + sy / 2, cz), m, bevel=bevel, rot=(-rx, 0, ry))

    def cyl(self, r1, r2, h, cx, y0, cz, m, seg=20, bevel=0.0, axis='y', smooth=True):
        if axis == 'y':
            rot = (0, 0, 0)
            loc = bl(cx, y0 + h / 2, cz)
        elif axis == 'z':  # along game z: Blender y
            rot = (math.pi / 2, 0, 0)
            loc = bl(cx, y0, cz)
        else:  # x
            rot = (0, math.pi / 2, 0)
            loc = bl(cx, y0, cz)
        return self.p.cyl(r1, r2, h, loc, m, seg=seg, rot=rot, bevel=bevel, smooth=smooth)

    def sphere(self, r, cx, cy, cz, m, seg=12, rings=8, scale=(1, 1, 1)):
        return self.p.sphere(r, bl(cx, cy, cz), m, seg=seg, rings=rings, scale=(scale[0], scale[2], scale[1]))

    def lathe(self, prof, cx, y0, cz, m, seg=24):
        return self.p.lathe(prof, bl(cx, y0, cz), m, seg=seg)

    def slab(self, outline, y0, y1, m, bevel=0.0, smooth=False):
        """Extrude a game-space (x, z) outline between heights y0..y1."""
        return self.p.extrude([(x, -z) for (x, z) in outline], y0, y1, m, bevel=bevel, smooth=smooth)

    def decal_front(self, w, h, cx, cy, z, m, tilt=0.0):
        """Decal quad facing +z (front), text up; tilt leans the top back (radians)."""
        return self.p.decal(w, h, bl(cx, cy, z), m, rot=(math.pi / 2 - tilt, 0, 0))

    def decal_back(self, w, h, cx, cy, z, m):
        return self.p.decal(w, h, bl(cx, cy, z), m, rot=(math.pi / 2, 0, math.pi))

    def decal_top(self, w, d, cx, y, cz, m):
        return self.p.decal(w, d, bl(cx, y, cz), m)

    def disc_front(self, r, cx, cy, z, m, seg=32):
        """A circular decal facing +z with planar UVs (wheel faces)."""
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new('UVMap')
        c = bm.verts.new((0, 0, 0))
        ring = [bm.verts.new((r * math.cos(TAU * i / seg), r * math.sin(TAU * i / seg), 0)) for i in range(seg)]
        for i in range(seg):
            f = bm.faces.new((c, ring[i], ring[(i + 1) % seg]))
            for loop in f.loops:
                loop[uv].uv = (0.5 + loop.vert.co.x / (2 * r), 0.5 + loop.vert.co.y / (2 * r))
        m4 = Matrix.Translation(Vector(bl(cx, cy, z))) @ common.euler((math.pi / 2, 0, 0))
        return self.p._take(bm, m4, m, smooth=False)

    def sweep(self, path, r, y, m, seg=10, closed=False, squash=1.0):
        """Sweep a circle (radius r, vertical squash) along a game-space (x, z) polyline at height y."""
        bm = bmesh.new()
        rings = []
        n = len(path)
        for i, (x, z) in enumerate(path):
            a = path[(i - 1) % n] if (closed or i > 0) else path[i]
            b = path[(i + 1) % n] if (closed or i < n - 1) else path[i]
            tx, tz = b[0] - a[0], b[1] - a[1]
            L = math.hypot(tx, tz) or 1
            nx, nz = -tz / L, tx / L  # horizontal normal
            ring = []
            for k in range(seg):
                t = TAU * k / seg
                ox = nx * math.cos(t) * r
                oz = nz * math.cos(t) * r
                oy = math.sin(t) * r * squash
                ring.append(bm.verts.new(bl(x + ox, y + oy, z + oz)))
            rings.append(ring)
        for i in range(n if closed else n - 1):
            A, B = rings[i], rings[(i + 1) % n]
            for k in range(seg):
                bm.faces.new((A[k], A[(k + 1) % seg], B[(k + 1) % seg], B[k]))
        if not closed:
            bm.faces.new(list(reversed(rings[0])))
            bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        return self.p._take(bm, Matrix.Identity(4), m, smooth=True)

    def planar_top_uv(self, faces, x0, z0, x1, z1):
        # Blender y = -z; v grows toward the back (game -z) = Blender +y.
        self.p.planar_uv(faces, x0, -z1, x1, -z0)

    def finish(self, parent):
        return self.p.finish(parent=parent)


# ---------- shared props ----------


def stool(g, x, z, d, seat_h=0.62, top='leatherRed'):
    if d >= 2:
        return
    seg = 16 if d == 0 else 8
    g.cyl(0.2, 0.22, 0.03, x, 0, z, 'blackGloss', seg=seg)
    g.cyl(0.035, 0.035, seat_h - 0.08, x, 0.03, z, 'chrome', seg=8)
    if d == 0:
        g.p.torus(0.15, 0.012, bl(x, 0.3, z), 'chrome', seg=16, mseg=6)
    g.cyl(0.19, 0.17, 0.08, x, seat_h - 0.08, z, top, seg=seg, bevel=0.02 if d == 0 else 0)


def armchair(g, x, z, face, d, leather='leatherBlack'):
    """A club chair whose front faces angle `face` (game heading, 0 = +z)."""
    if d >= 2:
        return
    c, s = math.cos(face), math.sin(face)

    def P(lx, lz):  # chair-local (x right, z front) → game
        return (x + lx * c + lz * s, z - lx * s + lz * c)

    b = 0.03 if d == 0 else 0
    px, pz = P(0, 0)
    g.box(0.5, 0.25, 0.5, px, 0.18, pz, leather, bevel=b, ry=face)
    px, pz = P(0, -0.22)
    g.box(0.5, 0.42, 0.12, px, 0.38, pz, leather, bevel=b, ry=face)
    for sx in (-1, 1):
        px, pz = P(sx * 0.24, 0)
        g.box(0.08, 0.2, 0.5, px, 0.38, pz, leather, bevel=b, ry=face)
    if d == 0:
        for sx in (-1, 1):
            for sz in (-1, 1):
                px, pz = P(sx * 0.2, sz * 0.2)
                g.cyl(0.02, 0.015, 0.18, px, 0, pz, 'brass', seg=6)


def chips(g, x, y, z, d, n=6):
    if d >= 1:
        return
    cols = ['cabinetRed', 'cabinetBlue', 'feltGreen', 'blackGloss', 'cabinetPurple', 'gold']
    for i in range(n):
        g.cyl(0.02, 0.02, 0.04 + (i % 3) * 0.015, x + i * 0.05, y, z, cols[i % len(cols)], seg=10)


# ---------- slots ----------


def slot_cabinet(g, d, body='cabinetRed', penny=False):
    cx = 0.5
    b = 0.03 if d == 0 else 0.0
    z0, z1 = 0.12, 0.72  # cabinet depth span
    zc = (z0 + z1) / 2
    g.box(0.74, 0.1, 0.62, cx, 0, zc, 'blackGloss', bevel=b)
    if d < 2:
        g.box(0.76, 0.02, 0.64, cx, 0.1, zc, 'brass')
    # Lower cabinet with a door panel.
    g.box(0.7, 0.72, 0.58, cx, 0.12, zc, body, bevel=0.04 if d == 0 else 0)
    if d == 0:
        g.box(0.5, 0.44, 0.02, cx, 0.24, z1 + 0.005, 'blackGloss', bevel=0.01)
        g.box(0.3, 0.06, 0.02, cx, 0.52, z1 + 0.012, 'chrome', bevel=0.005)
    # Button deck: a sloped panel jutting toward the player.
    deck = g.box(0.72, 0.07, 0.26, cx, 0.82, z1 + 0.05, 'blackGloss', bevel=b, rx=-0.25)
    if d == 0:
        btn = ['buttonRed', 'buttonAmber', 'buttonAmber', 'buttonGreen', 'buttonAmber']
        for i, m in enumerate(btn):
            g.cyl(0.026, 0.026, 0.02, cx - 0.24 + i * 0.12, 0.905 - 0.0, z1 + 0.1, m, seg=12)
        g.box(0.16, 0.03, 0.06, cx + 0.22, 0.88, z1 - 0.02, 'chrome')
    elif d == 1:
        g.box(0.6, 0.02, 0.06, cx, 0.9, z1 + 0.1, 'buttonAmber')
    # Upper body.
    upper_h = 0.72 if penny else 0.62
    g.box(0.7, upper_h, 0.5, cx, 0.9, zc - 0.03, body, bevel=0.04 if d == 0 else 0)
    if penny:
        # Tall portrait video screen, leaning back slightly.
        g.box(0.62, 0.62, 0.04, cx, 0.95, z1 - 0.05, 'chrome', bevel=0.012 if d == 0 else 0, rx=0.12)
        g.decal_front(0.56, 0.56, cx, 1.26, z1 - 0.012, 'decal_pennyScreen__variant', tilt=0.12)
    else:
        # Reel window in a chrome bezel, recessed glass behind.
        g.box(0.6, 0.4, 0.04, cx, 0.98, z1 - 0.06, 'chrome', bevel=0.015 if d == 0 else 0)
        g.box(0.5, 0.3, 0.02, cx, 1.03, z1 - 0.025, 'glassDark')
        g.decal_front(0.48, 0.28, cx, 1.18, z1 - 0.01, 'decal_slotReels')
        if d == 0:
            g.box(0.6, 0.08, 0.03, cx, 1.42, z1 - 0.05, 'blackGloss')
            g.decal_front(0.56, 0.06, cx, 1.46, z1 - 0.032, 'buttonAmber')
    top_y = 0.9 + upper_h
    # Edge light strips up both front corners.
    if d < 2:
        for sx in (-1, 1):
            g.box(0.025, upper_h + 0.7, 0.025, cx + sx * 0.345, 0.2, z1 - 0.01, 'neonCyan' if penny else 'neonGold')
    # Topper: lit sign box with a bulb row on top.
    th = 0.3 if not penny else 0.26
    g.box(0.72, th, 0.36, cx, top_y, zc - 0.06, 'blackGloss', bevel=b)
    key = 'decal_pennyTopper__variant__flash' if penny else 'decal_slotTopper__variant__flash'
    g.decal_front(0.66, th - 0.05, cx, top_y + th / 2, zc + 0.125, key)
    if d == 0:
        n = 9
        for i in range(n):
            g.sphere(0.022, cx - 0.32 + i * 0.08, top_y + th + 0.02, zc + 0.1, 'bulbChase__flash__chase', seg=8, rings=5)
        # Rounded crown behind the bulb row.
        g.cyl(0.16, 0.16, 0.72, cx, top_y + th - 0.04, zc - 0.1, body, seg=20, axis='x')
    elif d == 1:
        g.box(0.66, 0.04, 0.04, cx, top_y + th, zc + 0.1, 'bulbChase__flash__chase')
    stool(g, cx, 1.12, d)


def video_poker(g, d):
    """1×2: two bar-top machines back to back across the z middle."""
    b = 0.025 if d == 0 else 0
    g.box(0.9, 0.95, 1.5, 0.5, 0, 1.0, 'mahogany', bevel=b)
    g.box(0.96, 0.05, 1.56, 0.5, 0.95, 1.0, 'marbleBlack', bevel=b)
    if d < 2:
        g.box(0.92, 0.03, 1.52, 0.5, 0.15, 1.0, 'brass')
    for side, zf in ((1, 1.5), (-1, 0.5)):
        zc = 1.0 + side * 0.18
        g.box(0.62, 0.48, 0.24, 0.5, 1.0, zc, 'gunmetal', bevel=b, rx=-0.2 * side)
        if side == 1:
            g.decal_front(0.5, 0.36, 0.5, 1.26, zc + 0.125, 'screenBlue', tilt=0.2)
        else:
            g.p.decal(0.5, 0.36, bl(0.5, 1.26, zc - 0.125), 'screenBlue', rot=(math.pi / 2 - 0.2, 0, math.pi))
        if d == 0:
            for i in range(5):
                g.cyl(0.022, 0.022, 0.02, 0.26 + i * 0.12, 1.0, zf - 0.08 * side, 'buttonAmber', seg=10)
        stool(g, 0.5, 2.05 if side == 1 else -0.05, d)


def pachinko(g, d):
    b = 0.025 if d == 0 else 0
    g.box(0.72, 0.15, 0.5, 0.5, 0, 0.42, 'blackGloss', bevel=b)
    g.box(0.68, 1.6, 0.42, 0.5, 0.15, 0.42, 'chrome', bevel=b)
    g.box(0.6, 0.85, 0.04, 0.5, 0.85, 0.64, 'glassDark')
    g.decal_front(0.56, 0.8, 0.5, 1.27, 0.665, 'decal_pachinkoFace')
    # Ball tray and handle.
    g.box(0.6, 0.12, 0.16, 0.5, 0.62, 0.7, 'chrome', bevel=b)
    if d == 0:
        g.cyl(0.04, 0.04, 0.06, 0.74, 0.55, 0.72, 'blackGloss', seg=12, axis='z')
        for i in range(7):
            g.sphere(0.02, 0.32 + i * 0.05, 0.75, 0.72, 'chrome', seg=8, rings=4)
    g.box(0.7, 0.16, 0.44, 0.5, 1.75, 0.42, 'neonPink', bevel=b)
    stool(g, 0.5, 1.08, d)


# ---------- tables ----------


def kidney_outline(x0, x1, zb, zf, seg):
    """Straight dealer edge at zb, semi-elliptical player arc out to zf."""
    cx = (x0 + x1) / 2
    rx = (x1 - x0) / 2
    rz = zf - zb
    pts = [(x0, zb)]
    for i in range(seg + 1):
        a = math.pi - math.pi * i / seg  # left → right across the front
        pts.append((cx + rx * math.cos(a), zb + rz * math.sin(a)))
    return pts[1:]  # first arc point is (x0, zb)


def inset(pts, k, cx, cz):
    return [(cx + (x - cx) * k, cz + (z - cz) * k) for (x, z) in pts]


def card_table(g, d, felt, rail='leatherRed', wood='mahogany', trim='brass', seats=5, hl=False):
    seg = 28 if d == 0 else 12 if d == 1 else 8
    x0, x1, zb, zf = 0.06, 1.94, 0.32, 1.42
    cx = 1.0
    outer = kidney_outline(x0, x1, zb, zf, seg)
    # Pedestal.
    if d < 2:
        g.cyl(0.32, 0.36, 0.04, cx - 0.45, 0, 0.75, 'blackGloss', seg=16)
        g.cyl(0.32, 0.36, 0.04, cx + 0.45, 0, 0.75, 'blackGloss', seg=16)
        g.box(0.18, 0.6, 0.18, cx - 0.45, 0.04, 0.75, wood, bevel=0.02 if d == 0 else 0)
        g.box(0.18, 0.6, 0.18, cx + 0.45, 0.04, 0.75, wood, bevel=0.02 if d == 0 else 0)
    else:
        g.box(1.2, 0.64, 0.4, cx, 0, 0.75, wood)
    # Apron and top.
    g.slab(outer, 0.62, 0.74, wood, bevel=0.015 if d == 0 else 0)
    inner = inset(outer, 0.9, cx, zb)
    top = g.slab(inner, 0.74, 0.76, f'decal_{felt}')
    g.planar_top_uv(top, x0, zb - 0.02, x1, zf + 0.02)
    # Padded rail around the player arc; trim line under it.
    if d < 2:
        arc = inset(outer, 0.96, cx, zb)
        g.sweep(arc, 0.055, 0.77, rail, seg=12 if d == 0 else 6, squash=0.75)
        if d == 0:
            g.sweep(inset(outer, 1.0, cx, zb), 0.012, 0.66, trim, seg=6)
    else:
        g.slab(inset(outer, 0.98, cx, zb), 0.76, 0.8, rail)
    # Dealer edge: wood lip, chip rack, shoe, discard tray.
    g.box(1.86, 0.06, 0.08, cx, 0.74, zb + 0.02, wood)
    if d < 2:
        g.box(0.62, 0.05, 0.18, cx, 0.75, zb + 0.14, 'blackGloss')
        chips(g, cx - 0.26, 0.77, zb + 0.14, d, n=11)
        g.box(0.14, 0.09, 0.22, cx + 0.62, 0.76, zb + 0.18, 'blackGloss', ry=0.3)
        if d == 0:
            g.box(0.1, 0.06, 0.14, cx - 0.62, 0.76, zb + 0.16, 'chrome')
            # A few cards and bets on the felt.
            for i in range(3):
                a = math.pi * (0.32 + i * 0.18)
                px = cx + math.cos(a) * 0.62
                pz = zb + math.sin(a) * 0.7
                g.box(0.06, 0.004, 0.085, px, 0.762, pz, 'white', ry=a - math.pi / 2)
                chips(g, px - 0.04, 0.762, pz + 0.1, d, n=2)
    if hl and d == 0:
        g.cyl(0.012, 0.012, 0.35, cx + 0.8, 0.76, zb + 0.08, 'gold', seg=6)
        g.sphere(0.06, cx + 0.8, 1.14, zb + 0.08, 'lampWarm', seg=10, rings=6)
    # Seats around the arc, facing the table.
    out = []
    for i in range(seats):
        a = math.pi * (0.16 + 0.68 * i / max(1, seats - 1))
        sx = cx - math.cos(a) * 1.0
        sz = zb + math.sin(a) * 1.38
        sz = min(sz, 1.88)
        face = math.atan2(cx - sx, zb + 0.3 - sz)
        if hl:
            armchair(g, sx, sz, face + math.pi, d)
        else:
            stool(g, sx, sz, d)
        out.append((sx, sz, face))
    return out


def craps_table(g, d):
    seg = 6 if d == 0 else 3
    x0, x1, z0, z1 = 0.05, 1.95, 0.32, 1.62
    r = 0.25

    def rrect(a0, b0, a1, b1, rr):
        pts = []
        for (cx, cz, start) in ((a1 - rr, b1 - rr, 0), (a0 + rr, b1 - rr, 90), (a0 + rr, b0 + rr, 180), (a1 - rr, b0 + rr, 270)):
            for k in range(seg + 1):
                t = math.radians(start + 90 * k / seg)
                pts.append((cx + rr * math.cos(t), cz + rr * math.sin(t)))
        return pts

    outer = rrect(x0, z0, x1, z1, r)
    inner = rrect(x0 + 0.12, z0 + 0.12, x1 - 0.12, z1 - 0.12, r * 0.6)
    if d < 2:
        for x in (0.45, 1.55):
            g.box(0.24, 0.62, 0.7, x, 0, 0.97, 'mahogany', bevel=0.02 if d == 0 else 0)
    g.slab(outer, 0.62, 0.95, 'mahogany', bevel=0.02 if d == 0 else 0)
    felt = g.slab(inner, 0.95, 0.955, 'decal_crapsFelt')
    g.planar_top_uv(felt, x0 + 0.12, z0 + 0.12, x1 - 0.12, z1 - 0.12)
    # The tub: a felt floor sunk below a high padded rail.
    if d < 2:
        rail = [(x, z) for (x, z) in rrect(x0 + 0.04, z0 + 0.04, x1 - 0.04, z1 - 0.04, r * 0.85)]
        g.sweep(rail, 0.06, 1.0, 'leatherBlack', seg=10 if d == 0 else 6, closed=True, squash=0.8)
        g.sweep(rrect(x0 + 0.1, z0 + 0.1, x1 - 0.1, z1 - 0.1, r * 0.6), 0.025, 0.98, 'brass', seg=6, closed=True)
    else:
        g.slab(outer, 0.95, 1.02, 'leatherBlack')
    if d == 0:
        # The stick and a boxman's chip stacks. No dice: a watched table throws
        # the real roll as live parts (src/render/fx/dice.ts), and a pair baked
        # in here would lie beside them showing a number nobody rolled.
        g.cyl(0.006, 0.006, 1.0, 0.6, 1.08, 1.6, 'oak', seg=6, axis='x')
        chips(g, 0.8, 0.955, 0.48, d, n=8)
    # Players stand around the rail.
    spots = []
    for i in range(4):
        spots.append((0.3 + i * 0.47, 1.9, math.pi))
    spots += [(-0.1, 0.97, math.pi / 2), (2.1, 0.97, -math.pi / 2)]
    return spots


def roulette_table(g, d):
    b = 0.02 if d == 0 else 0
    x0, x1, z0, z1 = 0.08, 1.92, 0.42, 1.58
    if d < 2:
        for x in (0.35, 1.0, 1.65):
            g.box(0.14, 0.62, 0.14, x, 0, 1.0, 'mahogany', bevel=b)
    g.box(x1 - x0, 0.12, z1 - z0, (x0 + x1) / 2, 0.62, (z0 + z1) / 2, 'mahogany', bevel=b)
    felt = g.box(1.22, 0.02, 0.84, 0.72, 0.74, 1.04, 'decal_rouletteFelt')
    g.planar_top_uv(felt, 0.11, 0.62, 1.33, 1.46)
    # Wheel bowl at the right end.
    seg = 40 if d == 0 else 16 if d == 1 else 10
    g.lathe([(0.0, 0.0), (0.36, 0.0), (0.4, 0.06), (0.38, 0.16), (0.33, 0.17), (0.0, 0.17)], 1.55, 0.62, 1.0, 'mahogany', seg=seg)
    if d < 2:
        disc = g.p.decal(0.62, 0.62, bl(1.55, 0.795, 1.0), 'decal_rouletteWheel')
        g.cyl(0.04, 0.02, 0.1, 1.55, 0.79, 1.0, 'gold', seg=12)
        g.p.torus(0.315, 0.015, bl(1.55, 0.79, 1.0), 'gold', seg=32 if d == 0 else 12, mseg=6)
    # Padded rail along the front and the layout's sides.
    if d < 2:
        g.sweep([(0.08, 0.5), (0.08, 1.56), (1.2, 1.56)], 0.045, 0.78, 'leatherRed', seg=10 if d == 0 else 6, squash=0.75)
    if d == 0:
        g.cyl(0.03, 0.03, 0.18, 0.5, 0.76, 0.55, 'chrome', seg=10)  # dolly
        chips(g, 1.1, 0.76, 0.52, d, n=6)
    spots = []
    for i in range(4):
        x = 0.25 + i * 0.36
        stool(g, x, 1.88, d)
        spots.append((x, 1.88, math.pi))
    return spots


# ---------- big six ----------


def big_six(g, d):
    b = 0.025 if d == 0 else 0
    g.box(0.84, 0.82, 0.5, 0.5, 0, 0.5, 'mahogany', bevel=b)
    g.box(0.88, 0.05, 0.54, 0.5, 0.82, 0.5, 'brass')
    g.box(0.12, 0.5, 0.12, 0.5, 0.86, 0.45, 'gold', bevel=b)
    seg = 40 if d == 0 else 16 if d == 1 else 10
    cy = 1.86
    g.cyl(0.62, 0.62, 0.1, 0.5, 0.4, cy, 'mahogany', seg=seg, axis='z')  # wheel rim (y0 = z centre)
    g.disc_front(0.58, 0.5, cy, 0.551, 'decal_bigSixFace', seg=seg)
    if d < 2:
        g.cyl(0.05, 0.05, 0.14, 0.5, 0.58, cy, 'gold', seg=12, axis='z')
        n = 28 if d == 0 else 12
        for i in range(n):
            a = TAU * i / n
            g.sphere(0.022, 0.5 + math.cos(a) * 0.6, cy + math.sin(a) * 0.6, 0.53, 'bulbChase__flash__chase', seg=6, rings=4)
        # Clapper on top.
        g.box(0.03, 0.14, 0.02, 0.5, cy + 0.56, 0.56, 'leatherBlack')
        g.box(0.2, 0.06, 0.08, 0.5, cy + 0.66, 0.5, 'gold', bevel=b)
    return [(0.5, 1.15, math.pi)]


# ---------- services ----------


def bar_counter(g, d):
    b = 0.02 if d == 0 else 0
    # Back bar: shelves of bottles against the back edge.
    g.box(1.96, 2.1, 0.26, 1.0, 0, 0.14, 'walnut', bevel=b)
    g.decal_front(1.84, 1.05, 1.0, 1.42, 0.275, 'decal_barShelf')
    g.box(1.96, 0.1, 0.32, 1.0, 2.1, 0.16, 'brass', bevel=b)
    if d < 2:
        g.box(1.8, 0.04, 0.02, 1.0, 1.95, 0.29, 'neonPurple')
    # Front counter.
    g.box(1.96, 1.05, 0.38, 1.0, 0, 0.74, 'mahogany', bevel=b)
    g.box(2.0, 0.06, 0.5, 1.0, 1.05, 0.72, 'marbleBlack', bevel=b)
    if d < 2:
        g.cyl(0.025, 0.025, 1.9, 0.05, 0.2, 0.98, 'brass', seg=10, axis='x')
        g.box(1.9, 0.03, 0.02, 1.0, 0.9, 0.94, 'neonPurple')
    if d == 0:
        for i in range(3):
            g.cyl(0.02, 0.02, 0.28, 0.5 + i * 0.12, 1.11, 0.6, 'chrome', seg=8)
            g.box(0.05, 0.08, 0.03, 0.5 + i * 0.12, 1.36, 0.62, ['cabinetRed', 'gold', 'feltGreen'][i])
        for i in range(4):
            g.lathe([(0, 0), (0.03, 0), (0.035, 0.12), (0.0, 0.12)], 1.2 + i * 0.16, 1.11, 0.82, 'glassDark', seg=10)
    out = []
    for x in (0.5, 1.5):
        stool(g, x, 1.25, d, seat_h=0.78, top='leatherBlack')
        out.append((x, 1.25, math.pi))
    return out


def food_counter(g, d):
    b = 0.02 if d == 0 else 0
    g.box(0.94, 0.95, 0.42, 0.5, 0, 0.62, 'cabinetOrange', bevel=b)
    g.box(0.98, 0.04, 0.48, 0.5, 0.95, 0.62, 'stainless')
    if d < 2:
        # Food trays under a sneeze guard.
        cols = ['cabinetRed', 'gold', 'feltGreen', 'oak']
        for i in range(4):
            g.box(0.18, 0.05, 0.2, 0.17 + i * 0.22, 0.99, 0.6, cols[i])
        g.box(0.9, 0.02, 0.24, 0.5, 1.28, 0.62, 'glassDark', rx=0.2)
        for x in (0.07, 0.93):
            g.cyl(0.015, 0.015, 0.33, x, 0.99, 0.62, 'chrome', seg=6)
    # Back wall, posts and a striped awning.
    g.box(0.98, 2.0, 0.1, 0.5, 0, 0.08, 'plaster')
    if d < 2:
        for x in (0.04, 0.96):
            g.cyl(0.025, 0.025, 1.0, x, 0.99, 0.82, 'chrome', seg=8)
    n = 7 if d < 2 else 1
    for i in range(n):
        w = 1.0 / n
        g.box(w, 0.04, 0.55, w * (i + 0.5), 2.0, 0.5, 'cabinetRed' if i % 2 == 0 else 'white', rx=-0.35)
    g.decal_front(0.9, 0.38, 0.5, 1.72, 0.14, 'decal_menuBoard')
    return [(0.5, 1.15, math.pi)]


def restroom_block(g, d):
    t = 0.06
    for x in (t / 2, 1 - t / 2):
        g.box(t, 2.2, 0.96, x, 0, 0.5, 'tileWhite')
    g.box(1.0, 2.2, t, 0.5, 0, t / 2, 'tileWhite')
    g.box(1.0, 0.06, 1.0, 0.5, 2.2, 0.5, 'brass')
    # Door ajar at the front.
    g.box(0.6, 1.9, 0.04, 0.38, 0.12, 0.92, 'oak', bevel=0.01 if d == 0 else 0, ry=-0.5)
    if d < 2:
        g.lathe([(0, 0), (0.14, 0), (0.17, 0.28), (0.2, 0.4), (0, 0.42)], 0.5, 0, 0.32, 'ceramic', seg=16 if d == 0 else 8)
        g.box(0.36, 0.38, 0.14, 0.5, 0.42, 0.12, 'ceramic', bevel=0.02 if d == 0 else 0)
        g.decal_front(0.9, 0.3, 0.5, 2.0, 1.0, 'decal_restroomSign')
    return [(0.5, 0.4, math.pi)]


def cashier_cage(g, d):
    b = 0.02 if d == 0 else 0
    g.box(1.96, 2.4, 0.12, 1.0, 0, 0.08, 'mahogany', bevel=b)
    g.box(1.96, 1.05, 0.5, 1.0, 0, 1.55, 'mahogany', bevel=b)
    g.box(2.0, 0.06, 0.62, 1.0, 1.05, 1.55, 'marbleWhite', bevel=b)
    # Brass bars over the counter, arched window heads.
    if d < 2:
        n = 26 if d == 0 else 10
        for i in range(n):
            x = 0.08 + i * (1.84 / (n - 1))
            g.cyl(0.01, 0.01, 0.95, x, 1.11, 1.38, 'brass', seg=6)
        g.box(1.96, 0.08, 0.06, 1.0, 2.06, 1.38, 'gold')
        for i in range(3):
            g.box(0.5, 0.02, 0.08, 0.33 + i * 0.67, 1.12, 1.34, 'brass')
        # Cashier stations behind.
        for i in range(3):
            g.box(0.4, 0.75, 0.4, 0.33 + i * 0.67, 0, 0.6, 'walnut', bevel=b)
            if d == 0:
                g.box(0.28, 0.2, 0.04, 0.33 + i * 0.67, 0.85, 0.55, 'screenBlue', rx=0.2)
    g.box(1.96, 0.36, 0.14, 1.0, 2.14, 1.38, 'blackGloss', bevel=b)
    g.decal_front(1.6, 0.3, 1.0, 2.32, 1.455, 'decal_cageSign')
    return [(0.33 + i * 0.67, 2.0, math.pi) for i in range(3)]


def keno_lounge(g, d):
    g.box(1.6, 0.06, 0.2, 1.0, 0, 0.15, 'blackGloss')
    for x in (0.3, 1.7):
        g.cyl(0.03, 0.03, 1.4, x, 0.06, 0.15, 'brass', seg=8)
    g.box(1.6, 0.85, 0.08, 1.0, 1.0, 0.15, 'blackGloss', bevel=0.02 if d == 0 else 0)
    g.decal_front(1.5, 0.75, 1.0, 1.425, 0.195, 'decal_kenoBoard')
    out = []
    for row, z in enumerate((0.95, 1.6)):
        for i in range(3):
            x = 0.35 + i * 0.65
            armchair(g, x, z, 0.0 + math.pi, d, leather='leatherRed')
            if d == 0 and i < 2:
                g.cyl(0.1, 0.1, 0.5, x + 0.32, 0, z - 0.1, 'walnut', seg=12)
            out.append((x, z, math.pi))
    if d == 2:
        g.box(1.8, 0.6, 1.0, 1.0, 0, 1.3, 'leatherRed')
    return out


def bingo_hall(g, d):
    g.box(3.6, 1.0, 0.1, 2.0, 0.9, 0.12, 'blackGloss', bevel=0.02 if d == 0 else 0)
    g.decal_front(3.4, 0.9, 2.0, 1.4, 0.175, 'decal_bingoBoard')
    for x in (0.25, 3.75):
        g.cyl(0.04, 0.04, 1.9, x, 0, 0.12, 'brass', seg=8)
    # Caller's podium with the ball blower.
    g.box(0.6, 0.9, 0.4, 2.0, 0, 0.55, 'mahogany', bevel=0.02 if d == 0 else 0)
    if d < 2:
        g.sphere(0.18, 2.0, 1.1, 0.55, 'glassDark', seg=16 if d == 0 else 8, rings=10 if d == 0 else 6)
        if d == 0:
            for i in range(8):
                a = TAU * i / 8
                g.sphere(0.035, 2.0 + math.cos(a) * 0.09, 1.08 + (i % 3) * 0.04, 0.55 + math.sin(a) * 0.09,
                         ['cabinetRed', 'gold', 'cabinetBlue', 'white'][i % 4], seg=8, rings=5)
    out = []
    for row in range(2):
        z = 1.35 + row * 0.85
        g.box(3.4, 0.05, 0.4, 2.0, 0.72, z, 'tileWhite', bevel=0.01 if d == 0 else 0)
        if d < 2:
            for x in (0.5, 3.5):
                g.box(0.06, 0.72, 0.34, x, 0, z, 'chrome')
            for i in range(5):
                x = 0.5 + i * 0.75
                if d == 0:
                    g.box(0.2, 0.004, 0.14, x, 0.77, z - 0.05, 'white')
                g.box(0.38, 0.06, 0.36, x, 0.42, z + 0.35, 'leatherRed', bevel=0.02 if d == 0 else 0)
                g.box(0.38, 0.38, 0.05, x, 0.48, z + 0.52, 'leatherRed', bevel=0.02 if d == 0 else 0)
                g.cyl(0.02, 0.02, 0.42, x, 0, z + 0.35, 'chrome', seg=6)
                out.append((x, z + 0.35, math.pi))
    return out


# ---------- registry ----------

ASSETS = {
    # key: (footprint w, h, builder(g, d) → seats or None)
    'slot-cabinet': (1, 1, lambda g, d: slot_cabinet(g, d, 'cabinetRed') or [(0.5, 1.12, math.pi)]),
    'slot-cabinet-penny': (1, 1, lambda g, d: slot_cabinet(g, d, 'cabinetPurple', penny=True) or [(0.5, 1.12, math.pi)]),
    'video-poker-bank': (1, 2, lambda g, d: video_poker(g, d) or [(0.5, 2.05, math.pi), (0.5, -0.05, 0.0)]),
    'pachinko': (1, 1, lambda g, d: pachinko(g, d) or [(0.5, 1.08, math.pi)]),
    'table-blackjack': (2, 2, lambda g, d: card_table(g, d, 'bjFelt')),
    'table-blackjack-hl': (2, 2, lambda g, d: card_table(g, d, 'bjFeltHL', rail='leatherBlack', wood='walnut', trim='gold', seats=3, hl=True)),
    'table-uth': (2, 2, lambda g, d: card_table(g, d, 'uthFelt', rail='leatherBlack', seats=4)),
    'table-carnival': (2, 2, lambda g, d: card_table(g, d, 'carnivalFelt', rail='leatherRed', seats=5)),
    'table-craps': (2, 2, craps_table),
    'table-roulette': (2, 2, roulette_table),
    'big-six': (1, 1, big_six),
    'bar-counter': (2, 1, bar_counter),
    'food-counter': (1, 1, food_counter),
    'restroom-block': (1, 1, restroom_block),
    'cashier-cage': (2, 2, cashier_cage),
    'keno-lounge': (2, 2, keno_lounge),
    'bingo-hall': (4, 3, bingo_hall),
}


def build(key):
    common.reset()
    common._mats.clear()
    w, h, fn = ASSETS[key]
    lods = []
    seats = []
    for d in range(3):
        root = common.empty(f'LOD{d}')
        g = G(f'{key}_lod{d}')
        s = fn(g, d)
        if d == 0:
            seats = s or []
        ob = g.finish(root)
        common.apply_modifiers(ob)
        lods.append((root, ob))
    for i, (x, z, face) in enumerate(seats):
        # Seat empties: Blender rotation about Z by `face` points local -Y (glTF +z) along the heading.
        common.empty(f'seat_{i}', loc=bl(x, 0, z), rot=(0, 0, face))
    # AO: bake each detailed LOD alone over a floor plane so bases darken.
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
    common.export_glb(os.path.join(common.MODELS, f'{key}.glb'), objs)
    os.makedirs(common.SOURCES, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(common.SOURCES, f'{key}.blend'))
    print(f'ASSET {key} tris={tris} seats={json.dumps([[round(x, 3), round(z, 3), round(f, 3)] for x, z, f in seats])}')


def main():
    keys = common.args() or list(ASSETS)
    for k in keys:
        build(k)


main()
