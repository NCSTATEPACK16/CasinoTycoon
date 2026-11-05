"""Low-poly stylised human, rigged, with the crowd clips baked to a VAT.

    Blender -b --factory-startup --python assets/blender/human.py

Writes:
  assets/sources/human.blend      rig + mesh + one action per clip
  assets/models/human.vat.bin     per LOD: uint16 indices, uint8 regions,
                                  float16 RGBA rows (F position rows, then F normal rows)
  assets/models/human.vat.json    layout + clip table

Each body part is rigidly bound to one bone (chunky stylised parts overlap at
the joints, so no blended weights are needed). Clips are posed by a small FK
function per frame, written to the pose bones and keyframed, and the evaluated
(armature-deformed) mesh is read back for the bake — the VAT is exactly what
the rig shows. Regions index the outfit palette in src/render/Crowd.ts:
  0 skin  1 hair  2 top  3 bottom  4 shoes  5 accent  6 forearm  7 eyes
"""

import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

FPS = 20

# joint: (pivot (x, y, z), parent)
JOINTS = {
    'root': ((0, 0, 0.95), None),
    'spine': ((0, 0, 1.05), 'root'),
    'chest': ((0, 0, 1.25), 'spine'),
    'neck': ((0, 0, 1.47), 'chest'),
    'head': ((0, 0, 1.53), 'neck'),
}
for side, sx in (('L', 1), ('R', -1)):
    JOINTS.update(
        {
            f'shoulder.{side}': ((0.2 * sx, 0, 1.41), 'chest'),
            f'elbow.{side}': ((0.215 * sx, 0, 1.15), f'shoulder.{side}'),
            f'wrist.{side}': ((0.225 * sx, 0, 0.92), f'elbow.{side}'),
            f'hip.{side}': ((0.09 * sx, 0, 0.92), 'root'),
            f'knee.{side}': ((0.095 * sx, 0, 0.5), f'hip.{side}'),
            f'ankle.{side}': ((0.095 * sx, 0, 0.09), f'knee.{side}'),
        }
    )
ORDER = list(JOINTS)  # parents precede children by construction

SKIN, HAIR, TOP, BOTTOM, SHOES, ACCENT, FOREARM, EYES = range(8)


# ---------- mesh ----------


def ring_loft(bm, rings, seg, cap0=True, cap1=True):
    """rings: [(cx, cy, z, rx, ry)] lofted into a closed tube."""
    loops = []
    for (cx, cy, z, rx, ry) in rings:
        loops.append(
            [bm.verts.new((cx + rx * math.cos(2 * math.pi * i / seg), cy + ry * math.sin(2 * math.pi * i / seg), z)) for i in range(seg)]
        )
    faces = []
    for a, b in zip(loops, loops[1:]):
        for i in range(seg):
            faces.append(bm.faces.new((a[i], a[(i + 1) % seg], b[(i + 1) % seg], b[i])))
    if cap0:
        faces.append(bm.faces.new(list(reversed(loops[0]))))
    if cap1:
        faces.append(bm.faces.new(loops[-1]))
    return faces


def limb(bm, p0, p1, r0, r1, seg, rings=3):
    """A tapered capsule-ish tube between two points (vertical limbs here)."""
    (x0, y0, z0), (x1, y1, z1) = p0, p1
    rs = []
    for k in range(rings + 1):
        t = k / rings
        r = r0 + (r1 - r0) * t
        # Slight bulge mid-limb reads as muscle at a distance.
        r *= 1 + 0.12 * math.sin(t * math.pi)
        rs.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t, r, r))
    # Round the ends a little past the joints so bends don't open gaps.
    rs.insert(0, (x0, y0, z0 + 0.025 * (1 if z0 > z1 else -1), r0 * 0.6, r0 * 0.6))
    rs.append((x1, y1, z1 - 0.02 * (1 if z0 > z1 else -1), r1 * 0.6, r1 * 0.6))
    if z0 > z1:
        rs.reverse()
    return ring_loft(bm, rs, seg)


def ellipsoid(bm, c, r, seg, rings_n):
    out = bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings_n, radius=1.0)
    vs = out['verts']
    for v in vs:
        v.co = Vector((c[0] + v.co.x * r[0], c[1] + v.co.y * r[1], c[2] + v.co.z * r[2]))
    return list({f for v in vs for f in v.link_faces})


def build_body(detail):
    """Returns a joined mesh object; detail 0 = LOD0, 1 = LOD1."""
    seg = 10 if detail == 0 else 6
    sph = (12, 8) if detail == 0 else (7, 5)
    pieces = []  # (bm, region, joint)

    def piece(region, joint, fn):
        bm = bmesh.new()
        fn(bm)
        pieces.append((bm, region, joint))

    # Pelvis / trousers top.
    piece(BOTTOM, 'root', lambda bm: ring_loft(bm, [(0, 0.005, 0.86, 0.15, 0.1), (0, 0, 0.96, 0.155, 0.105), (0, 0, 1.06, 0.145, 0.1)], seg))
    # Lower torso and chest (one silhouette, two bones so the spine can bend).
    piece(TOP, 'spine', lambda bm: ring_loft(bm, [(0, 0, 1.03, 0.148, 0.102), (0, 0, 1.15, 0.15, 0.1), (0, 0, 1.27, 0.16, 0.105)], seg))
    piece(
        TOP,
        'chest',
        lambda bm: ring_loft(
            bm, [(0, 0, 1.25, 0.16, 0.106), (0, -0.005, 1.34, 0.18, 0.115), (0, 0, 1.42, 0.19, 0.105), (0, 0.005, 1.47, 0.12, 0.08)], seg
        ),
    )
    # Tie / bowtie / lapel stripe on the chest front (-Y).
    piece(ACCENT, 'chest', lambda bm: ring_loft(bm, [(0, -0.112, 1.2, 0.022, 0.008), (0, -0.118, 1.33, 0.026, 0.008), (0, -0.108, 1.44, 0.02, 0.008)], 4))
    piece(SKIN, 'neck', lambda bm: ring_loft(bm, [(0, 0, 1.44, 0.05, 0.05), (0, 0, 1.56, 0.048, 0.048)], max(5, seg // 2)))
    # Head: big and round for readability from the god cam.
    piece(SKIN, 'head', lambda bm: ellipsoid(bm, (0, -0.01, 1.64), (0.105, 0.112, 0.125), *sph))
    piece(SKIN, 'head', lambda bm: ellipsoid(bm, (0, -0.118, 1.625), (0.018, 0.022, 0.026), 6, 4))  # nose
    piece(HAIR, 'head', lambda bm: ellipsoid(bm, (0, 0.012, 1.685), (0.112, 0.118, 0.1), *sph))
    if detail == 0:
        for sx in (1, -1):
            piece(EYES, 'head', lambda bm, sx=sx: ellipsoid(bm, (0.04 * sx, -0.108, 1.655), (0.016, 0.01, 0.02), 6, 4))
    for side, sx in (('L', 1), ('R', -1)):
        sh = JOINTS[f'shoulder.{side}'][0]
        el = JOINTS[f'elbow.{side}'][0]
        wr = JOINTS[f'wrist.{side}'][0]
        hp = JOINTS[f'hip.{side}'][0]
        kn = JOINTS[f'knee.{side}'][0]
        an = JOINTS[f'ankle.{side}'][0]
        lseg = max(6, seg - 2) if detail == 0 else 5
        piece(TOP, f'shoulder.{side}', lambda bm, a=sh, b=el: limb(bm, a, b, 0.052, 0.044, lseg))
        piece(FOREARM, f'elbow.{side}', lambda bm, a=el, b=wr: limb(bm, a, b, 0.043, 0.035, lseg))
        piece(SKIN, f'wrist.{side}', lambda bm, w=wr: ellipsoid(bm, (w[0], w[1] - 0.005, w[2] - 0.055), (0.03, 0.04, 0.062), 8 if detail == 0 else 5, 5 if detail == 0 else 4))
        piece(BOTTOM, f'hip.{side}', lambda bm, a=hp, b=kn: limb(bm, a, b, 0.078, 0.06, lseg))
        piece(BOTTOM, f'knee.{side}', lambda bm, a=kn, b=an: limb(bm, a, b, 0.058, 0.044, lseg))

        def shoe(bm, a=an):
            out = bmesh.ops.create_cube(bm, size=1.0)
            for v in out['verts']:
                v.co = Vector((a[0] + v.co.x * 0.1, a[1] - 0.045 + v.co.y * 0.25, 0.04 + v.co.z * 0.08))
                if v.co.y < a[1] - 0.12:
                    v.co.z = min(v.co.z, 0.065)  # toe slopes down
            if detail == 0:
                bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.015, segments=1, affect='EDGES')

        piece(SHOES, f'ankle.{side}', shoe)

    objs = []
    mats = [common.mat(f'region_{r}', color=0xFFFFFF) for r in range(8)]
    for i, (bm, region, joint) in enumerate(pieces):
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        me = bpy.data.meshes.new(f'p{i}')
        bm.to_mesh(me)
        bm.free()
        for m in mats:
            me.materials.append(m)
        for p in me.polygons:
            p.material_index = region
            p.use_smooth = region not in (SHOES,)
        ob = bpy.data.objects.new(f'p{i}', me)
        bpy.context.scene.collection.objects.link(ob)
        vg = ob.vertex_groups.new(name=joint)
        vg.add(list(range(len(me.vertices))), 1.0, 'REPLACE')
        objs.append(ob)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = f'human_LOD{detail}'
    body.data.name = body.name
    # Hard edges on the shoes: split them so VAT normals stay flat there.
    bm = bmesh.new()
    bm.from_mesh(body.data)
    sharp = [e for e in bm.edges if all(f.material_index == SHOES for f in e.link_faces) and len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(40)]
    bmesh.ops.split_edges(bm, edges=sharp)
    bm.to_mesh(body.data)
    bm.free()
    return body


def build_armature():
    arm_data = bpy.data.armatures.new('rig')
    arm = bpy.data.objects.new('rig', arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    children = {}
    for j, (_, parent) in JOINTS.items():
        children.setdefault(parent, []).append(j)
    for j, (pivot, parent) in JOINTS.items():
        b = arm_data.edit_bones.new(j)
        b.head = Vector(pivot)
        kids = children.get(j, [])
        if kids:
            b.tail = Vector(JOINTS[kids[0]][0])
        else:
            b.tail = Vector(pivot) + Vector((0, -0.08, 0) if j.startswith('ankle') else (0, 0, -0.08) if j.startswith('wrist') else (0, 0, 0.12))
        if (b.tail - b.head).length < 1e-3:
            b.tail = b.head + Vector((0, 0, 0.1))
        if parent:
            b.parent = arm_data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm


# ---------- poses ----------


def R(ax=0.0, ay=0.0, az=0.0):
    return Euler((math.radians(ax), math.radians(ay), math.radians(az)), 'XYZ').to_matrix().to_4x4()


def sit_base(p):
    p['root_off'] = (0, 0.02, -0.45)
    for s in 'LR':
        p[f'hip.{s}'] = R(-88)
        p[f'knee.{s}'] = R(88)
    p['spine'] = R(-4)


def pose(clip, t):
    """FK pose for a clip at phase t in [0, 1). Rotations are about world axes at
    each joint's rest pivot: +X lateral, front is -Y. Leg/arm swing forward is
    negative X rotation; torso/head lean forward is positive."""
    s = math.sin(2 * math.pi * t)
    c = math.cos(2 * math.pi * t)
    p = {'root_off': (0, 0, 0)}
    arms_rest = 7
    p['shoulder.L'] = R(0, -arms_rest)
    p['shoulder.R'] = R(0, arms_rest)
    if clip == 'idle':
        p['root_off'] = (0.012 * s, 0, 0.004 * math.sin(4 * math.pi * t))
        p['chest'] = R(1.5 * math.sin(4 * math.pi * t))
        p['head'] = R(2, 14 * math.sin(2 * math.pi * t + 1.0))
        p['shoulder.L'] = R(-3 * s, -arms_rest - 2 * c)
        p['shoulder.R'] = R(3 * s, arms_rest + 2 * c)
        p['elbow.L'] = R(-10)
        p['elbow.R'] = R(-10)
    elif clip == 'walk':
        p['root_off'] = (0, 0, 0.028 * abs(c) - 0.02)
        p['root'] = R(0, 0, 4 * s)
        p['chest'] = R(4, 0, -7 * s)
        p['head'] = R(-3, 0, 3 * s)
        for side, k in (('L', 1), ('R', -1)):
            ph = s * k
            p[f'hip.{side}'] = R(-28 * ph)
            # Knee flexes during the swing (leg moving forward) half of the cycle.
            swing = max(0.0, math.sin(2 * math.pi * t + (0 if k == 1 else math.pi) + math.pi / 2))
            p[f'knee.{side}'] = R(8 + 50 * swing)
            p[f'ankle.{side}'] = R(-10 * ph)
            p[f'shoulder.{side}'] = R(24 * ph, -arms_rest * k)
            p[f'elbow.{side}'] = R(-18 - 12 * max(0.0, -ph))
    elif clip == 'sit':
        sit_base(p)
        p['chest'] = R(2 * math.sin(2 * math.pi * t))
        p['head'] = R(4, 10 * s)
        for side, k in (('L', 1), ('R', -1)):
            p[f'shoulder.{side}'] = R(-30, -6 * k)
            p[f'elbow.{side}'] = R(-50)
    elif clip == 'play':
        sit_base(p)
        p['spine'] = R(6)
        p['head'] = R(10)
        p['shoulder.L'] = R(-55, -8)
        p['elbow.L'] = R(-35)
        tap = max(0.0, math.sin(4 * math.pi * t)) ** 2
        p['shoulder.R'] = R(-62 + 6 * tap, 8)
        p['elbow.R'] = R(-38 - 10 * tap)
        p['wrist.R'] = R(18 * tap)
    elif clip == 'deal':
        p['chest'] = R(8, 12 * s)
        p['head'] = R(14, 8 * s)
        p['shoulder.L'] = R(-38, -6)
        p['elbow.L'] = R(-62)
        p['shoulder.R'] = R(-48 - 8 * max(0.0, c), 10 + 22 * s)
        p['elbow.R'] = R(-40)
        p['wrist.R'] = R(-15 * s)
    elif clip == 'standplay':
        # On your feet at a rail (craps, the big six): leaning in on both
        # forearms, the right hand reaching out now and then to lay chips or
        # toss the dice, weight shifting from foot to foot.
        reach = max(0.0, math.sin(2 * math.pi * t)) ** 2
        p['root_off'] = (0.01 * math.sin(math.pi * t), -0.04, -0.01)
        p['spine'] = R(12)
        p['chest'] = R(8, 0, 2 * s)
        p['head'] = R(10 - 4 * reach, 10 * math.sin(2 * math.pi * t + 0.6))
        p['shoulder.L'] = R(-52, -6)
        p['elbow.L'] = R(-62)
        p['shoulder.R'] = R(-52 - 28 * reach, 8)
        p['elbow.R'] = R(-62 + 42 * reach)
        p['wrist.R'] = R(-12 * reach)
        for side in 'LR':
            p[f'knee.{side}'] = R(6)
            p[f'hip.{side}'] = R(-4)
    elif clip == 'cheer':
        hop = abs(math.sin(2 * math.pi * t))
        p['root_off'] = (0, 0, 0.07 * hop)
        p['chest'] = R(-8)
        p['head'] = R(-18)
        for side, k in (('L', 1), ('R', -1)):
            p[f'shoulder.{side}'] = R(-150 + 18 * hop, -22 * k)
            p[f'elbow.{side}'] = R(-25 + 15 * hop)
            p[f'knee.{side}'] = R(20 * (1 - hop))
            p[f'hip.{side}'] = R(-10 * (1 - hop))
    elif clip == 'sad':
        p['root_off'] = (0, 0, -0.015)
        p['spine'] = R(10)
        p['chest'] = R(12, 0, 3 * s)
        p['neck'] = R(8)
        p['head'] = R(12, 0, 6 * s)
        p['shoulder.L'] = R(-8, -3)
        p['elbow.L'] = R(-12)
        # Right hand rubs the back of the neck.
        p['shoulder.R'] = R(-150, 30)
        p['elbow.R'] = R(-115 + 8 * s)
    elif clip == 'eat':
        lift = 0.5 - 0.5 * math.cos(2 * math.pi * t)
        lift = lift**2
        p['head'] = R(6 - 8 * lift)
        p['shoulder.L'] = R(-28, -10)
        p['elbow.L'] = R(-80)
        p['shoulder.R'] = R(-25 - 35 * lift, 12 - 6 * lift)
        p['elbow.R'] = R(-45 - 95 * lift)
    return p


CLIPS = [  # name, seconds, loop — order = Anim ids (Idle..Eat), then 'deal', 'standplay'
    ('idle', 2.0, True),
    ('walk', 1.0, True),
    ('sit', 2.0, True),
    ('play', 1.5, True),
    ('cheer', 1.0, True),
    ('sad', 2.0, True),
    ('eat', 2.5, True),
    ('deal', 2.0, True),
    ('standplay', 2.0, True),
]


def joint_matrices(p):
    """World transform per joint for pose dict p."""
    out = {}
    off = Matrix.Translation(Vector(p['root_off']))
    for j in ORDER:
        pivot, parent = JOINTS[j]
        local = Matrix.Translation(Vector(pivot)) @ p.get(j, Matrix.Identity(4)) @ Matrix.Translation(-Vector(pivot))
        base = out[parent] if parent else off
        out[j] = base @ local
    return out


def apply_pose(arm, p):
    mats = joint_matrices(p)
    for j in ORDER:
        pb = arm.pose.bones[j]
        pb.matrix = mats[j] @ arm.data.bones[j].matrix_local
        bpy.context.view_layer.update()


def main():
    common.reset()
    bpy.context.scene.render.fps = FPS
    arm = build_armature()
    bodies = [build_body(0), build_body(1)]
    for b in bodies:
        b.parent = arm
        mod = b.modifiers.new('rig', 'ARMATURE')
        mod.object = arm
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'

    # Bake. Position rows for all clips, then normal rows.
    lod_data = []
    for b in bodies:
        me = b.data
        lod_data.append({'obj': b, 'pos': [], 'nrm': [], 'v': len(me.vertices)})
    clip_table = []
    frame = 0
    arm.animation_data_create()
    for name, secs, loop in CLIPS:
        n = max(2, round(secs * FPS))
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        arm.animation_data.action = act
        for f in range(n):
            t = f / n
            apply_pose(arm, pose(name, t))
            for pb in arm.pose.bones:
                pb.keyframe_insert('location', frame=f + 1)
                pb.keyframe_insert('rotation_quaternion', frame=f + 1)
            dg = bpy.context.evaluated_depsgraph_get()
            for L in lod_data:
                ev = L['obj'].evaluated_get(dg)
                em = ev.to_mesh()
                co = np.empty(len(em.vertices) * 3, dtype=np.float32)
                em.vertices.foreach_get('co', co)
                no = np.empty(len(em.vertices) * 3, dtype=np.float32)
                em.vertices.foreach_get('normal', no)
                ev.to_mesh_clear()
                co = co.reshape(-1, 3)
                no = no.reshape(-1, 3)
                # Blender (x, y, z) with front -Y  →  three (x, z, -y) with front +z.
                L['pos'].append(np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1))
                L['nrm'].append(np.stack([no[:, 0], no[:, 2], -no[:, 1]], axis=1))
        clip_table.append({'name': name, 'start': frame, 'frames': n, 'fps': FPS, 'loop': loop})
        frame += n

    os.makedirs(common.MODELS, exist_ok=True)
    os.makedirs(common.SOURCES, exist_ok=True)
    blob = bytearray()
    meta = {'clips': clip_table, 'frames': frame, 'lods': []}
    for L in lod_data:
        me = L['obj'].data
        me.calc_loop_triangles()
        tris = np.empty(len(me.loop_triangles) * 3, dtype=np.int32)
        me.loop_triangles.foreach_get('vertices', tris)
        # Flip winding: the y/z swap mirrors handedness only if we negate; we do
        # (x, z, -y), a proper rotation, so winding is preserved.
        idx = tris.astype(np.uint16)
        regions = np.zeros(len(me.vertices), dtype=np.uint8)
        for poly in me.polygons:
            for vi in poly.vertices:
                regions[vi] = poly.material_index
        pos = np.stack(L['pos'])  # F × V × 3
        nrm = np.stack(L['nrm'])
        F, V = pos.shape[0], pos.shape[1]
        tex = np.zeros((2 * F, V, 4), dtype=np.float16)
        tex[:F, :, :3] = pos
        tex[F:, :, :3] = nrm
        entry = {'vertexCount': V, 'indexCount': int(idx.size), 'width': V, 'height': 2 * F}

        def put(arr, key):
            while len(blob) % 4:
                blob.append(0)
            entry[key] = len(blob)
            blob.extend(arr.tobytes())

        put(idx, 'indexOffset')
        put(regions, 'regionOffset')
        put(tex, 'vatOffset')
        meta['lods'].append(entry)
        print(f"LOD {L['obj'].name}: {V} verts, {idx.size // 3} tris, VAT {V}x{2 * F}")
    with open(os.path.join(common.MODELS, 'human.vat.bin'), 'wb') as fh:
        fh.write(blob)
    with open(os.path.join(common.MODELS, 'human.vat.json'), 'w') as fh:
        json.dump(meta, fh, indent=1)
    arm.animation_data.action = bpy.data.actions['idle']
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(common.SOURCES, 'human.blend'))
    print('human: wrote', len(blob), 'bytes')


main()
