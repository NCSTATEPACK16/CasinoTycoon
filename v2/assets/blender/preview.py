"""Render quick workbench previews of a .blend (dev aid).
    Blender -b <file.blend> --python assets/blender/preview.py -- <out_dir> [action|object ...]"""
import math, os, sys
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
out = argv[0]
names = argv[1:]
scn = bpy.context.scene
try:
    scn.render.engine = 'BLENDER_WORKBENCH'
except TypeError as err:
    print('engine', err)
scn.display.shading.light = 'STUDIO'
scn.display.shading.color_type = 'MATERIAL'
scn.display.shading.show_cavity = True
scn.render.resolution_x = 480
scn.render.resolution_y = 480
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scn.collection.objects.link(cam)
scn.camera = cam
def frame(target_objs, view=(1, -1.3, 0.8)):
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for o in target_objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
    ctr = (mn + mx) / 2; r = (mx - mn).length
    d = Vector(view).normalized()
    cam.location = ctr + d * r * 1.25
    cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 50
rig = bpy.data.objects.get('rig')
if rig:
    for o in bpy.data.objects:
        if o.name.startswith('human_LOD1'): o.hide_render = True
    for a in names or [a.name for a in bpy.data.actions]:
        rig.animation_data.action = bpy.data.actions[a]
        for k, f in enumerate([1, 6, 11]):
            scn.frame_set(f)
            frame([bpy.data.objects['human_LOD0']])
            scn.render.filepath = os.path.join(out, f'{a}_{k}.png')
            bpy.ops.render.render(write_still=True)
else:
    for n in names:
        ob = bpy.data.objects[n]
        for o in bpy.data.objects:
            o.hide_render = not (o == ob or o.parent == ob or (o.parent and o.parent.parent == ob))
        kids = [o for o in bpy.data.objects if not o.hide_render and o.type == 'MESH']
        for k, v in enumerate([(1, -1.3, 0.9), (-0.4, -1, 1.6)]):
            frame(kids, v)
            scn.render.filepath = os.path.join(out, f'{n}_{k}.png')
            bpy.ops.render.render(write_still=True)
