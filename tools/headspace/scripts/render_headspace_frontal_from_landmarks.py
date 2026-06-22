import argparse
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


def parse_args():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--obj", required=True)
    parser.add_argument("--landmarks", required=True)
    parser.add_argument("--out_png", required=True)
    parser.add_argument("--res", type=int, default=1400)
    parser.add_argument("--txt", nargs="*", default=[])
    parser.add_argument("--txt_dir", default="")
    parser.add_argument("--line_color", default="1,0,0")
    parser.add_argument("--curve_radius", type=float, default=0.9)
    parser.add_argument("--curve_strength", type=float, default=2.0)
    parser.add_argument("--dist_scale", type=float, default=2.1)
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else []
    args, _ = parser.parse_known_args(argv)
    if args.txt_dir:
        args.txt.extend(str(p) for p in sorted(Path(args.txt_dir).glob("*.txt")))
    args.line_color = tuple(float(x) for x in args.line_color.split(","))
    return args


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def import_textured_obj(obj_path):
    obj_path = str(Path(obj_path))
    if hasattr(bpy.ops.wm, "obj_import"):
        bpy.ops.wm.obj_import(filepath=obj_path)
    else:
        bpy.ops.import_scene.obj(filepath=obj_path)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No mesh imported from {obj_path}")
    return meshes[0]


def load_xyz(path):
    pts = []
    for line in Path(path).read_text(encoding="utf-8", errors="ignore").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        a = line.split()
        if len(a) >= 3:
            pts.append(Vector((float(a[0]), float(a[1]), float(a[2]))))
    return pts


def mean_vec(points, indices):
    vals = [points[i] for i in indices if i < len(points)]
    if not vals:
        raise ValueError(f"No valid landmark indices from {indices}")
    out = Vector((0.0, 0.0, 0.0))
    for v in vals:
        out += v
    return out / len(vals)


def bbox_world(obj):
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    mn = Vector((min(p.x for p in corners), min(p.y for p in corners), min(p.z for p in corners)))
    mx = Vector((max(p.x for p in corners), max(p.y for p in corners), max(p.z for p in corners)))
    center = (mn + mx) * 0.5
    radius = max((p - center).length for p in corners)
    return center, radius


def make_face_basis(landmarks):
    # MediaPipe FaceMesh stable anchors. This is only for camera orientation, not evaluation.
    left_eye = mean_vec(landmarks, [33, 133, 159, 145])
    right_eye = mean_vec(landmarks, [362, 263, 386, 374])
    eye_mid = (left_eye + right_eye) * 0.5
    mouth = mean_vec(landmarks, [13, 14, 61, 291])
    nose_tip = mean_vec(landmarks, [1, 4, 5])

    x_axis = (right_eye - left_eye).normalized()
    y_down = (mouth - eye_mid)
    y_down = (y_down - x_axis * y_down.dot(x_axis)).normalized()
    normal = x_axis.cross(y_down).normalized()
    if normal.dot(nose_tip - eye_mid) < 0:
        normal.negate()
    y_up = -y_down
    center = mean_vec(landmarks, [1, 4, 5, 33, 133, 263, 362, 13, 14, 61, 291])
    return center, x_axis, y_up, normal


def setup_lights(center, normal, y_up, radius):
    bpy.ops.object.light_add(type="AREA", location=center + normal * radius * 2.0 + y_up * radius * 0.8)
    key = bpy.context.object
    key.name = "Frontal_Key_Area"
    key.data.energy = 600
    key.data.size = 5.5
    bpy.ops.object.light_add(type="POINT", location=center - normal * radius * 0.6 + y_up * radius * 0.5)
    fill = bpy.context.object
    fill.name = "Frontal_Fill_Point"
    fill.data.energy = 80


def setup_frontal_camera(scene, center, x_axis, y_up, normal, radius, dist_scale):
    bpy.ops.object.camera_add()
    cam = bpy.context.object
    scene.camera = cam
    dist = max(radius * dist_scale, 1.0)
    cam.location = center + normal * dist

    z_cam = (cam.location - center).normalized()
    x_cam = x_axis.normalized()
    y_cam = y_up.normalized()
    # Blender camera looks along local -Z; matrix columns are local X, Y, Z in world.
    rot = Matrix(((x_cam.x, y_cam.x, z_cam.x), (x_cam.y, y_cam.y, z_cam.y), (x_cam.z, y_cam.z, z_cam.z))).to_4x4()
    cam.matrix_world = Matrix.Translation(cam.location) @ rot
    cam.data.lens = 70
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = radius * 1.25


def make_line_material(name, rgb, strength):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    for node in list(nodes):
        nodes.remove(node)
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
    emission.inputs["Strength"].default_value = strength
    out = nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(emission.outputs["Emission"], out.inputs["Surface"])
    return mat


def add_polyline_curve(name, pts, mat, radius):
    if len(pts) < 2:
        return
    curve = bpy.data.curves.new(name, type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 2
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    spl = curve.splines.new("POLY")
    spl.points.add(len(pts) - 1)
    for p, co in zip(spl.points, pts):
        p.co = (co.x, co.y, co.z, 1.0)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)


def main():
    args = parse_args()
    clear_scene()
    mesh = import_textured_obj(args.obj)
    landmarks = load_xyz(args.landmarks)
    center, x_axis, y_up, normal = make_face_basis(landmarks)
    _, radius = bbox_world(mesh)

    if args.txt:
        mat = make_line_material("Transferred_Lines", args.line_color, args.curve_strength)
        for i, path in enumerate(args.txt):
            add_polyline_curve(f"Line_{i:03d}", load_xyz(path), mat, args.curve_radius)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = args.res
    scene.render.resolution_y = args.res
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.color = (0.02, 0.02, 0.05)

    setup_lights(center, normal, y_up, radius)
    setup_frontal_camera(scene, center, x_axis, y_up, normal, radius, args.dist_scale)

    out_png = Path(args.out_png)
    out_png.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(out_png)
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    print("[Done]", out_png)


main()
