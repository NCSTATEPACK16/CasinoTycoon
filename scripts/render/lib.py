"""Isometric sprite render rig (Blender headless). REQUIRES BLENDER 5.0+.

Why this exists: every prior art batch was hand-prompted in an image model, and
assets/ASSET-BRIEF-2026-08-22-p17-catalogue.md's first three sections are a catalogue of
what that cost -- glow bleed forcing hand-bisected bgTolerance values, in-context scene
mockups needing regeneration, a 2-up sheet that left a permanent preCrop in the pipeline,
and a watermark that left a permanent preErase rect.

A fixed orthographic camera makes the projection identical across every object by
construction rather than by prompt discipline, film_transparent gives true alpha so the
flood-fill background recovery stops applying, and every animated light box lands on an
exactly computable pixel rectangle instead of a measured guess.

Shading is done WITHOUT lights. Each face gets a pure Emission shader whose colour is the
base colour pre-multiplied by a fixed factor chosen from the face's normal -- top faces
full, left faces darker, right faces darker still. That is how isometric pixel art is
shaded by hand, it is perfectly flat and hard-edged, and it structurally cannot produce
the glow, bloom, specular or rim light the brief's rule 1 forbids.
"""

import json
import math

import bpy
from mathutils import Vector

# The rig requires Blender 5.x. Two APIs below pin it and they only coexist
# there: `scene.eevee.use_raytracing` is EEVEE-Next (4.2+), while the engine
# enum is spelled "BLENDER_EEVEE" only in 5.0 onward — throughout 4.2-4.5 that
# same engine is "BLENDER_EEVEE_NEXT". On a 4.2-4.5 LTS install setup() would
# raise inside Blender and render-sprites.mjs would report nothing more useful
# than "blender failed for <object>". Fail here instead, with the reason.
if bpy.app.version < (5, 0, 0):
    raise SystemExit(
        "Casino Tycoon's render rig needs Blender 5.0 or newer "
        f"(found {'.'.join(str(v) for v in bpy.app.version)}). "
        "The EEVEE engine id and raytracing toggle it sets only line up from 5.0."
    )

# The pair that produces a true 2:1 diamond, matching TILE_W=128 / TILE_H=64 in
# src/config.ts. Verified empirically: a unit plate renders at a bbox ratio of 2.0000.
CAM_PITCH = math.radians(60.0)
CAM_YAW = math.radians(45.0)

# Face-normal shading factors. Top is lit fullest, then the left face, then the right --
# matching the shipped sprites, which are lit from the upper left.
SHADE_TOP = 1.00
SHADE_LEFT = 0.72
SHADE_RIGHT = 0.52
SHADE_BOTTOM = 0.34

_MATERIALS: dict[tuple, bpy.types.Material] = {}
# Rectangles to hand to scripts/lib/light-layers.mjs, in world space. Converted to render
# pixels at the end, once the camera is known.
_LIGHT_BOXES: list[dict] = []


def reset_scene() -> bpy.types.Scene:
    """Empty factory state. Nothing inherited from a .blend or from a previous object."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _MATERIALS.clear()
    _LIGHT_BOXES.clear()
    return bpy.context.scene


# --------------------------------------------------------------------------- materials


def _emission(colour: tuple[float, float, float], factor: float) -> bpy.types.Material:
    """A flat unlit material. Cached, so a 400-bulb array costs three materials."""
    key = (round(colour[0], 4), round(colour[1], 4), round(colour[2], 4), round(factor, 3))
    hit = _MATERIALS.get(key)
    if hit is not None:
        return hit

    mat = bpy.data.materials.new(name=f"emit_{len(_MATERIALS)}")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    emit = nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (
        colour[0] * factor,
        colour[1] * factor,
        colour[2] * factor,
        1.0,
    )
    emit.inputs["Strength"].default_value = 1.0
    links.new(emit.outputs["Emission"], out.inputs["Surface"])
    _MATERIALS[key] = mat
    return mat


def _shade_factor(normal: Vector) -> float:
    """Pick a shading factor from which way a face points, in camera terms.

    The camera yaw is 45 degrees, so +X and +Y are the two faces the viewer sees. Which of
    them reads as "left" is fixed because the camera never moves.
    """
    if normal.z > 0.5:
        return SHADE_TOP
    if normal.z < -0.5:
        return SHADE_BOTTOM
    if normal.y < -0.5:
        return SHADE_LEFT
    if normal.x > 0.5:
        return SHADE_RIGHT
    # Curved sides (cylinders, spheres): interpolate between the two visible faces so a
    # drum reads as round without a gradient ramp.
    t = (normal.x + 1.0) * 0.5
    return SHADE_LEFT + (SHADE_RIGHT - SHADE_LEFT) * t


def apply_shading(obj: bpy.types.Object, colour: tuple[float, float, float], flat: bool = False) -> None:
    """Assign a per-face emission material chosen by that face's normal.

    `flat=True` skips the shading and paints every face at full brightness -- used for
    screens, sign panels and bulbs, which the brief requires be drawn "fully ON, at full
    brightness, as flat paint" so the build can derive the OFF state by dimming.
    """
    mesh = obj.data
    mesh.materials.clear()
    slot_of: dict[int, int] = {}
    for poly in mesh.polygons:
        factor = 1.0 if flat else _shade_factor(poly.normal)
        mat = _emission(colour, factor)
        idx = slot_of.get(id(mat))
        if idx is None:
            mesh.materials.append(mat)
            idx = len(mesh.materials) - 1
            slot_of[id(mat)] = idx
        poly.material_index = idx


# --------------------------------------------------------------------------- primitives
#
# World units are grid tiles: a 1x1 footprint object lives inside x,y in [-0.5, 0.5], with
# z=0 as the floor. Sizes below are therefore fractions of a tile.


def box(name, center, size, colour, flat=False):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=center)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    apply_shading(obj, colour, flat)
    return obj


def cylinder(name, center, radius, depth, colour, rotation=(0, 0, 0), verts=24, flat=False):
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius, depth=depth, location=center, rotation=rotation, vertices=verts
    )
    obj = bpy.context.object
    obj.name = name
    apply_shading(obj, colour, flat)
    return obj


def sphere(name, center, radius, colour, flat=False):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=center, segments=20, ring_count=10)
    obj = bpy.context.object
    obj.name = name
    apply_shading(obj, colour, flat)
    return obj


def bulb_strip(name, start, end, count, radius, colour, ring_colour):
    """A straight run of bulbs on the front face, each a hard-edged flat disc in a darker ring.

    The brief is explicit that a light is "a hard-edged flat disc of bright colour with a
    darker ring", never a glow -- the liveliness comes from the game alpha-tweening the
    crop, not from the art. Returns the created objects so the caller can hand the whole
    group to `mark_light_box`.
    """
    made = []
    face = (math.radians(90.0), 0.0, 0.0)  # disc normal -> -Y, the near-facing wall
    for i in range(count):
        t = 0.0 if count == 1 else i / (count - 1)
        c = tuple(start[j] + (end[j] - start[j]) * t for j in range(3))
        made.append(
            cylinder(f"{name}_ring_{i}", c, radius, 0.004, ring_colour, rotation=face, verts=12, flat=True)
        )
        made.append(
            cylinder(
                f"{name}_bulb_{i}",
                (c[0], c[1] - 0.004, c[2]),
                radius * 0.62,
                0.004,
                colour,
                rotation=face,
                verts=12,
                flat=True,
            )
        )
    return made


def panel(name, center, size, colour, bezel_colour, bezel=0.014, flat=True):
    """A flat rectangle with a hard bezel, mounted on the near (-Y) face.

    The brief's rule C: screens and sign panels are flat rectangles with a hard 1px bezel,
    presented straight-on within the isometric plane, with nothing overlapping them. The
    bezel earns its place beyond looks -- it puts the animated crop's edge on dark pixels,
    so a light that would otherwise fade into the surrounding surface still has a clean box.

    `center` is world (x, y, z) with y the face plane; `size` is (width, height).
    """
    back = box(
        f"{name}_bezel",
        center,
        (size[0] + bezel, 0.006, size[1] + bezel),
        bezel_colour,
        flat=True,
    )
    face = box(
        f"{name}_face",
        (center[0], center[1] - 0.006, center[2]),
        (size[0], 0.006, size[1]),
        colour,
        flat=flat,
    )
    return face, back


# ------------------------------------------------------------------------- light boxes


def mark_light_box(kind: str, name: str, objs) -> None:
    """Record a region the build pipeline will slice into an animated overlay.

    `kind` is 'light' (crop bright, dim the base, alpha-tween -- the shipped slot machine's
    pattern) or 'spin' (crop an ellipse and rotate it in place over an unmodified base).

    The region is given as the geometry itself, not as hand-written numbers: `render`
    projects the union of these objects' bounding boxes through the same fixed orthographic
    camera that drew them. That is the whole reason the rig exists -- the shipped
    slot-machine's crops were measured off finished art by hand, and these are exact.
    """
    if not isinstance(objs, (list, tuple)):
        objs = [objs]
    _LIGHT_BOXES.append({"kind": kind, "name": name, "objs": list(objs)})


# ------------------------------------------------------------------------------ camera


def _fit_camera(scene, margin: float):
    """Frame every mesh in the scene, then pad. Ortho scale is derived, never hand-tuned."""
    cam = scene.camera
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()

    xs, ys = [], []
    for obj in scene.objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            v = inv @ (obj.matrix_world @ Vector(corner))
            xs.append(v.x)
            ys.append(v.y)

    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    span_x, span_y = max(xs) - min(xs), max(ys) - min(ys)
    # Fit the LONGER axis; the render is square and the post-pass crops to content.
    scale = max(span_x, span_y) * (1.0 + margin)
    cam.data.ortho_scale = scale
    # Recentre by shifting the camera in its own screen plane.
    cam.location = cam.location + (cam.matrix_world.to_3x3() @ Vector((cx, cy, 0.0)))
    bpy.context.view_layer.update()
    return scale


def setup(scene=None, margin: float = 0.06):
    """Install the fixed iso camera and the flat, lightless render settings."""
    scene = scene or bpy.context.scene
    cam_data = bpy.data.cameras.new("iso_cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("iso_cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.rotation_euler = (CAM_PITCH, 0.0, CAM_YAW)
    # Blender cameras look down their own -Z, so back off along +Z in camera space.
    cam.location = cam.rotation_euler.to_matrix() @ Vector((0.0, 0.0, 40.0))

    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.compression = 0
    # Pure emission shading means there is nothing for these to do but cost time and,
    # worse, soften the hard edges the house style depends on.
    scene.eevee.use_raytracing = False
    scene.eevee.taa_render_samples = 1
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    return cam, margin


def _project(scene, cam, world: Vector):
    """World point -> render pixel. Orthographic, so this is exact and linear."""
    v = cam.matrix_world.inverted() @ world
    res_x = scene.render.resolution_x
    res_y = scene.render.resolution_y
    px_per_unit = res_x / cam.data.ortho_scale
    return (res_x / 2.0 + v.x * px_per_unit, res_y / 2.0 - v.y * px_per_unit)


def render(out_png: str, out_boxes: str, resolution: int, margin: float = 0.06) -> None:
    scene = bpy.context.scene
    cam = scene.camera
    scene.render.resolution_x = resolution
    scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    _fit_camera(scene, margin)

    scene.render.filepath = out_png
    bpy.ops.render.render(write_still=True)

    # Project every marked region's geometry through the same camera that drew it. The
    # axis-aligned bbox of the projected corners is the crop rectangle -- the shipped
    # slot-machine's overlays are bounding rects of a parallelogram face too, and that is
    # fine: the overlay is drawn at the same position, so it registers exactly.
    boxes = []
    for b in _LIGHT_BOXES:
        px, py = [], []
        for obj in b["objs"]:
            for corner in obj.bound_box:
                sx, sy = _project(scene, cam, obj.matrix_world @ Vector(corner))
                px.append(sx)
                py.append(sy)
        boxes.append(
            {
                "kind": b["kind"],
                "name": b["name"],
                "x": round(min(px), 2),
                "y": round(min(py), 2),
                "w": round(max(px) - min(px), 2),
                "h": round(max(py) - min(py), 2),
            }
        )

    with open(out_boxes, "w") as fh:
        json.dump({"resolution": resolution, "boxes": boxes}, fh, indent=2)
    print(f"RENDER_OK {out_png} boxes={len(boxes)}")
