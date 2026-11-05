"""Shared helpers for the Casino Tycoon v2 Blender asset scripts.

Run headless from v2/:
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python assets/blender/heroes.py -- [asset ...]

Conventions (the runtime's AssetLibrary relies on them):
- Blender is Z-up; glTF export turns Blender -Y into +z. So every asset is
  modelled with its FRONT facing -Y and its footprint at x in [0, w],
  y in [-h, 0]; that lands as x in [0, w], z in [0, h] with +z front.
- Meshes are parented to empties LOD0 / LOD1 / LOD2.
- Materials are named '<name>[__flash][__chase][__variant]' or 'decal_<key>'.
- The colour attribute 'AO' holds a Cycles AO bake (exported as COLOR_0).
- Seat empties 'seat_<n>' mark where a player sits, local +Y... facing -Y.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.normpath(os.path.join(HERE, '..', 'models'))
SOURCES = os.path.normpath(os.path.join(HERE, '..', 'sources'))

# Same names and values as src/render/assets/Palette.ts. Colours are sRGB hex.
PALETTE = {
    'brass': (0xD9A441, 0.28, 1.0, 0.0),
    'gold': (0xF2C14E, 0.22, 1.0, 0.0),
    'chrome': (0xD8DDE3, 0.12, 1.0, 0.0),
    'gunmetal': (0x3A3F4B, 0.35, 0.8, 0.0),
    'blackGloss': (0x14141A, 0.18, 0.1, 0.0),
    'blackMatte': (0x1C1B22, 0.7, 0.0, 0.0),
    'leatherRed': (0x7A1424, 0.55, 0.0, 0.0),
    'leatherBlack': (0x221C22, 0.5, 0.0, 0.0),
    'mahogany': (0x5A2414, 0.38, 0.0, 0.0),
    'walnut': (0x3E2414, 0.42, 0.0, 0.0),
    'oak': (0x9A6A3C, 0.5, 0.0, 0.0),
    'feltGreen': (0x1A7A42, 0.95, 0.0, 0.0),
    'cabinetRed': (0xB3172F, 0.3, 0.4, 0.0),
    'cabinetBlue': (0x1D4FB8, 0.3, 0.4, 0.0),
    'cabinetPurple': (0x6A2BB0, 0.3, 0.4, 0.0),
    'cabinetTeal': (0x0F8A8A, 0.3, 0.4, 0.0),
    'cabinetOrange': (0xE0661A, 0.3, 0.4, 0.0),
    'glassDark': (0x0B0D14, 0.05, 0.2, 0.0),
    'marbleWhite': (0xECE6DC, 0.2, 0.0, 0.0),
    'marbleBlack': (0x26232A, 0.2, 0.0, 0.0),
    'tileWhite': (0xE8EEF2, 0.3, 0.0, 0.0),
    'plaster': (0xE9DCC6, 0.85, 0.0, 0.0),
    'stainless': (0xB8BEC6, 0.3, 1.0, 0.0),
    'ceramic': (0xF4F4F4, 0.15, 0.0, 0.0),
    'velvet': (0x9C0F2A, 0.9, 0.0, 0.0),
    'white': (0xFFFFFF, 0.6, 0.0, 0.0),
    'cream': (0xF1E3C8, 0.5, 0.0, 0.0),
    'bulbWarm__flash': (0xFFD27A, 0.4, 0.0, 3.2),
    'bulbChase__flash__chase': (0xFFD27A, 0.4, 0.0, 3.5),
    'lampWarm': (0xFFE2B0, 0.5, 0.0, 2.2),
    'neonPink': (0xFF2E88, 0.4, 0.0, 4.0),
    'neonCyan': (0x33E6FF, 0.4, 0.0, 4.0),
    'neonGold': (0xFFC94D, 0.4, 0.0, 4.0),
    'neonPurple': (0xA64DFF, 0.4, 0.0, 4.0),
    'buttonRed': (0xFF3344, 0.3, 0.0, 1.6),
    'buttonGreen': (0x33FF77, 0.3, 0.0, 1.4),
    'buttonAmber': (0xFFB020, 0.3, 0.0, 1.4),
}


def srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(h):
    return (srgb_to_linear((h >> 16) & 255), srgb_to_linear((h >> 8) & 255), srgb_to_linear(h & 255), 1.0)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in (bpy.data.meshes, bpy.data.materials, bpy.data.objects):
        for x in list(c):
            c.remove(x)


_mats = {}


def mat(name, color=None, rough=None, metal=None, emit=None):
    """Get or create a Principled material. Palette names need no values;
    'decal_<key>' materials are white so the atlas texel shows through."""
    key = name
    if key in _mats and _mats[key].name in bpy.data.materials:
        return _mats[key]
    base = name.split('__')[0]
    if name in PALETTE:
        pc, pr, pm, pe = PALETTE[name]
    elif base in PALETTE:
        pc, pr, pm, pe = PALETTE[base]
    else:
        pc, pr, pm, pe = 0xFFFFFF, 0.5, 0.0, 0.0
    color = pc if color is None else color
    rough = pr if rough is None else rough
    metal = pm if metal is None else metal
    emit = pe if emit is None else emit
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    rgba = hex_rgba(color)
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emit > 0:
        bsdf.inputs['Emission Color'].default_value = rgba
        bsdf.inputs['Emission Strength'].default_value = emit
    m.diffuse_color = rgba
    _mats[key] = m
    return m


# ---------- geometry ----------


class Part:
    """Accumulates bmesh geometry into one object, one material slot per name."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.slots = []

    def _slot(self, mname):
        if mname not in self.slots:
            self.slots.append(mname)
        return self.slots.index(mname)

    def _tag(self, geom, mname, smooth=False):
        idx = self._slot(mname)
        for f in [g for g in geom if isinstance(g, bmesh.types.BMFace)]:
            f.material_index = idx
            f.smooth = smooth

    def _take(self, src_bm, matrix, mname, smooth=False):
        src_bm.transform(matrix)
        me = bpy.data.meshes.new('tmp')
        src_bm.to_mesh(me)
        src_bm.free()
        before = set(self.bm.faces)
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        self.bm.faces.ensure_lookup_table()
        new = [f for f in self.bm.faces if f not in before]
        self._tag(new, mname, smooth)
        return new

    def box(self, size, loc, mname, bevel=0.0, rot=(0, 0, 0), segments=2):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
        if bevel > 0:
            b = min(bevel, min(size) * 0.45)
            bmesh.ops.bevel(bm, geom=bm.edges[:], offset=b, segments=segments, profile=0.5, affect='EDGES')
        m = Matrix.Translation(Vector(loc)) @ euler(rot)
        return self._take(bm, m, mname, smooth=False)

    def cyl(self, r1, r2, depth, loc, mname, seg=24, rot=(0, 0, 0), bevel=0.0, smooth=True, cap=True):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=depth)
        if bevel > 0:
            rim = [e for e in bm.edges if len(e.link_faces) == 2 and abs(e.calc_face_angle(0)) > 0.8]
            bmesh.ops.bevel(bm, geom=rim, offset=bevel, segments=2, profile=0.5, affect='EDGES')
        m = Matrix.Translation(Vector(loc)) @ euler(rot)
        faces = self._take(bm, m, mname, smooth=smooth)
        if smooth:
            self._harden(faces)
        return faces

    def sphere(self, r, loc, mname, seg=16, rings=8, scale=(1, 1, 1), rot=(0, 0, 0)):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
        bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
        m = Matrix.Translation(Vector(loc)) @ euler(rot)
        return self._take(bm, m, mname, smooth=True)

    def torus(self, R, r, loc, mname, seg=32, mseg=8, rot=(0, 0, 0), arc=2 * math.pi):
        bm = bmesh.new()
        verts = []
        for i in range(seg + (0 if arc >= 2 * math.pi - 1e-6 else 1)):
            a = arc * i / seg
            ring = []
            for j in range(mseg):
                b = 2 * math.pi * j / mseg
                x = (R + r * math.cos(b)) * math.cos(a)
                y = (R + r * math.cos(b)) * math.sin(a)
                z = r * math.sin(b)
                ring.append(bm.verts.new((x, y, z)))
            verts.append(ring)
        closed = arc >= 2 * math.pi - 1e-6
        n = len(verts)
        for i in range(n if closed else n - 1):
            a, b = verts[i], verts[(i + 1) % n]
            for j in range(mseg):
                bm.faces.new((a[j], b[j], b[(j + 1) % mseg], a[(j + 1) % mseg]))
        m = Matrix.Translation(Vector(loc)) @ euler(rot)
        return self._take(bm, m, mname, smooth=True)

    def lathe(self, profile, loc, mname, seg=32, smooth=True):
        """Revolve [(r, z), ...] around Z."""
        bm = bmesh.new()
        rings = []
        for (r, z) in profile:
            ring = []
            for i in range(seg):
                a = 2 * math.pi * i / seg
                ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
            rings.append(ring)
        for k in range(len(rings) - 1):
            a, b = rings[k], rings[k + 1]
            for i in range(seg):
                bm.faces.new((a[i], a[(i + 1) % seg], b[(i + 1) % seg], b[i]))
        if profile[0][0] > 1e-4:
            bm.faces.new(list(reversed(rings[0])))
        if profile[-1][0] > 1e-4:
            bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        faces = self._take(bm, Matrix.Translation(Vector(loc)), mname, smooth=smooth)
        if smooth:
            self._harden(faces)
        return faces

    def extrude(self, outline, z0, z1, mname, bevel=0.0, smooth=False, loc=(0, 0, 0)):
        """Extrude a closed XY outline [(x, y), ...] from z0 to z1."""
        bm = bmesh.new()
        bot = [bm.verts.new((x, y, z0)) for (x, y) in outline]
        top = [bm.verts.new((x, y, z1)) for (x, y) in outline]
        n = len(outline)
        bm.faces.new(list(reversed(bot)))
        bm.faces.new(top)
        for i in range(n):
            bm.faces.new((bot[i], bot[(i + 1) % n], top[(i + 1) % n], top[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        if bevel > 0:
            rim = [e for e in bm.edges if e.verts[0].co.z == e.verts[1].co.z]
            bmesh.ops.bevel(bm, geom=rim, offset=bevel, segments=2, profile=0.5, affect='EDGES')
        faces = self._take(bm, Matrix.Translation(Vector(loc)), mname, smooth=smooth)
        if smooth:
            self._harden(faces)
        return faces

    def decal(self, w, h, loc, mname, rot=(0, 0, 0)):
        """A flat quad, UV 0..1, facing +Z before rotation (texture top = +Y)."""
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new('UVMap')
        vs = [bm.verts.new(p) for p in ((-w / 2, -h / 2, 0), (w / 2, -h / 2, 0), (w / 2, h / 2, 0), (-w / 2, h / 2, 0))]
        f = bm.faces.new(vs)
        for loop, t in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uv].uv = t
        m = Matrix.Translation(Vector(loc)) @ euler(rot)
        return self._take(bm, m, mname, smooth=False)

    def planar_uv(self, faces, x0, y0, x1, y1):
        """Top-down UVs for the given faces mapped from the XY rect (felt layouts).
        v grows toward +Y (the back), matching the atlas' 'top = far side'."""
        uv = self.bm.loops.layers.uv.verify()
        for f in faces:
            for loop in f.loops:
                co = loop.vert.co
                loop[uv].uv = ((co.x - x0) / (x1 - x0), (co.y - y0) / (y1 - y0))

    def _harden(self, faces):
        # Flat-shade caps (faces whose normal is axis-aligned with the cylinder axis
        # get split by EdgeSplit later); here we just keep smooth flags.
        pass

    def finish(self, collection=None, parent=None, edge_split_deg=40):
        me = bpy.data.meshes.new(self.name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for s in self.slots:
            me.materials.append(mat(s))
        ob = bpy.data.objects.new(self.name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        if parent:
            ob.parent = parent
        if edge_split_deg:
            mod = ob.modifiers.new('split', 'EDGE_SPLIT')
            mod.split_angle = math.radians(edge_split_deg)
        return ob


def euler(rot):
    from mathutils import Euler

    return Euler(rot, 'XYZ').to_matrix().to_4x4()


def empty(name, loc=(0, 0, 0), parent=None, rot=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    e.location = loc
    e.rotation_euler = rot
    bpy.context.scene.collection.objects.link(e)
    if parent:
        e.parent = parent
    return e


def apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)


def decimate_copy(ob, ratio, name, parent):
    """LOD copy: collapse-decimate the (modifier-applied) mesh."""
    me = ob.data.copy()
    cp = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(cp)
    cp.parent = parent
    cp.matrix_parent_inverse = ob.matrix_parent_inverse.copy()
    cp.location = ob.location
    if ratio < 1:
        mod = cp.modifiers.new('dec', 'DECIMATE')
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        apply_modifiers(cp)
    return cp


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def bake_ao(objects, samples=48, distance=0.6):
    """Bake Cycles AO into a colour attribute 'AO' on each object (exported as COLOR_0)."""
    scn = bpy.context.scene
    try:
        scn.render.engine = 'CYCLES'
    except TypeError:
        return
    scn.cycles.samples = samples
    scn.cycles.device = 'CPU'
    scn.world = scn.world or bpy.data.worlds.new('w')
    scn.world.light_settings.distance = distance
    for ob in objects:
        me = ob.data
        if 'AO' in me.color_attributes:
            me.color_attributes.remove(me.color_attributes['AO'])
        attr = me.color_attributes.new('AO', 'BYTE_COLOR', 'CORNER')
        me.color_attributes.active_color = attr
        me.color_attributes.render_color_index = me.color_attributes.find('AO')
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    scn.render.bake.target = 'VERTEX_COLORS'
    scn.render.bake.margin = 0
    bpy.ops.object.bake(type='AO')
    # AO straight from Cycles is harsh for a stylised look; lift it.
    for ob in objects:
        attr = ob.data.color_attributes['AO']
        for d in attr.data:
            v = d.color[0]
            v = 0.35 + 0.65 * v
            d.color = (v, v, v, 1.0)


def export_glb(path, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:
        ob.select_set(True)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kw = dict(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials='EXPORT',
        export_animations=False,
        export_extras=False,
        export_cameras=False,
        export_lights=False,
    )
    props = bpy.ops.export_scene.gltf.get_rna_type().properties
    if 'export_vertex_color' in props:
        kw['export_vertex_color'] = 'NAME'
        kw['export_vertex_color_name'] = 'AO'
        kw['export_all_vertex_colors'] = False
    if 'export_meshopt_compression_enable' in props:
        kw['export_meshopt_compression_enable'] = True
        kw['export_meshopt_extension'] = 'EXT_meshopt_compression'
    bpy.ops.export_scene.gltf(**kw)


def args():
    argv = sys.argv
    return argv[argv.index('--') + 1 :] if '--' in argv else []
