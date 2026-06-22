import argparse
import math
import os
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--obj", required=True)
    parser.add_argument("--out_dir", required=True)
    parser.add_argument("--out_mp4", required=True)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--res", type=int, default=1024)
    parser.add_argument("--fps", type=int, default=24)
    parser.add_argument("--frames", type=int, default=72)
    parser.add_argument("--elev_deg", type=float, default=8.0)
    parser.add_argument("--dist_scale", type=float, default=2.4)
    parser.add_argument("--start_deg", type=float, default=-55.0)
    parser.add_argument("--end_deg", type=float, default=55.0)
    parser.add_argument("--txt", nargs="*", default=[])
    parser.add_argument("--txt_dir", default="")
    parser.add_argument("--line_color", default="1,0,0")
    parser.add_argument("--curve_radius", type=float, default=0.9)
    parser.add_argument("--curve_strength", type=float, default=2.0)
    parser.add_argument("--paint_surface", action="store_true")
    parser.add_argument("--paint_radius", type=float, default=2.0)
    parser.add_argument("--center_on_lines", action="store_true")
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
        bpy.ops.wm.obj_import(filepath=obj_path, forward_axis="Y", up_axis="Z")
    else:
        bpy.ops.import_scene.obj(filepath=obj_path, axis_forward="Y", axis_up="Z")
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No mesh imported from {obj_path}")
    root = meshes[0]
    bpy.context.view_layer.objects.active = root
    root.select_set(True)
    return root


def make_materials_shadeless(obj, strength=1.15):
    for mat in obj.data.materials:
        if not mat or not mat.use_nodes:
            continue
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        out = next((n for n in nodes if n.type == "OUTPUT_MATERIAL"), None)
        principled = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        if out is None or principled is None:
            continue
        base = principled.inputs.get("Base Color")
        emission = nodes.new("ShaderNodeEmission")
        emission.inputs["Strength"].default_value = strength
        if base is not None and base.is_linked:
            links.new(base.links[0].from_socket, emission.inputs["Color"])
        elif base is not None:
            emission.inputs["Color"].default_value = base.default_value
        else:
            emission.inputs["Color"].default_value = mat.diffuse_color
        links.new(emission.outputs["Emission"], out.inputs["Surface"])


def bbox_world(obj):
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    mn = Vector((min(p.x for p in corners), min(p.y for p in corners), min(p.z for p in corners)))
    mx = Vector((max(p.x for p in corners), max(p.y for p in corners), max(p.z for p in corners)))
    center = (mn + mx) * 0.5
    radius = max((p - center).length for p in corners)
    return center, radius


def bbox_points(points):
    pts = [Vector(p) for p in points]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    center = (mn + mx) * 0.5
    radius = max((p - center).length for p in pts)
    return center, radius


def load_all_line_points(paths):
    pts = []
    for path in paths:
        pts.extend(load_xyz(path))
    return pts


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def setup_lights():
    bpy.ops.object.light_add(type="AREA", location=(0, -3, 4))
    key = bpy.context.object
    key.name = "Key_Area"
    key.data.energy = 450
    key.data.size = 5.0
    bpy.ops.object.light_add(type="POINT", location=(0, 3, 2))
    fill = bpy.context.object
    fill.name = "Fill_Point"
    fill.data.energy = 80


def load_xyz(path):
    pts = []
    for line in Path(path).read_text(encoding="utf-8", errors="ignore").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        a = line.split()
        if len(a) >= 3:
            pts.append([float(a[0]), float(a[1]), float(a[2])])
    return pts


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


def make_diffuse_material(name, rgb):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (rgb[0], rgb[1], rgb[2], 1.0)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    for node in list(nodes):
        nodes.remove(node)
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
    emission.inputs["Strength"].default_value = 1.4
    out = nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(emission.outputs["Emission"], out.inputs["Surface"])
    return mat


def paint_mesh_faces_near_lines(mesh_obj, line_paths, rgb, radius):
    from mathutils.kdtree import KDTree

    pts = []
    for path in line_paths:
        pts.extend(Vector(p) for p in load_xyz(path))
    if not pts:
        return 0
    kd = KDTree(len(pts))
    for i, p in enumerate(pts):
        kd.insert(p, i)
    kd.balance()
    mat = make_diffuse_material("Surface_Painted_Lines", rgb)
    mesh_obj.data.materials.append(mat)
    mat_idx = len(mesh_obj.data.materials) - 1
    painted = 0
    world = mesh_obj.matrix_world
    for poly in mesh_obj.data.polygons:
        center = world @ poly.center
        nearest = kd.find(center)
        if nearest and nearest[2] <= radius:
            poly.material_index = mat_idx
            painted += 1
    return painted


def add_polyline_curve(name, pts, mat, radius):
    if len(pts) < 2:
        return None
    curve = bpy.data.curves.new(name, type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 2
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    spl = curve.splines.new("POLY")
    spl.points.add(len(pts) - 1)
    for p, co in zip(spl.points, pts):
        p.co = (co[0], co[1], co[2], 1.0)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def setup_camera(scene, center, radius, args):
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=center)
    rig = bpy.context.object
    rig.name = "Turntable_Rig"

    bpy.ops.object.camera_add()
    cam = bpy.context.object
    scene.camera = cam
    cam.parent = rig

    dist = max(radius * args.dist_scale, 1.0)
    elev = math.radians(args.elev_deg)
    cam.location = (0.0, -dist * math.cos(elev), dist * math.sin(elev))
    # Camera is parented to a rig located at the mesh center, so it should
    # look at the rig's local origin rather than the world-space center.
    look_at(cam, (0.0, 0.0, 0.0))
    cam.data.lens = 55

    scene.frame_start = 1
    scene.frame_end = args.frames
    for frame, deg in [(scene.frame_start, args.start_deg), (scene.frame_end, args.end_deg)]:
        scene.frame_set(frame)
        rig.rotation_euler = (0.0, 0.0, math.radians(deg))
        rig.keyframe_insert(data_path="rotation_euler", frame=frame)
    action = getattr(getattr(rig, "animation_data", None), "action", None)
    fcurves = getattr(action, "fcurves", None)
    if fcurves is not None:
        for fc in fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"


def render_sequence(scene, out_dir):
    out_dir = str(Path(out_dir))
    os.makedirs(out_dir, exist_ok=True)
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = os.path.join(out_dir, "frame_")
    bpy.ops.render.render(animation=True)


def ffmpeg_make_mp4(ffmpeg, out_dir, fps, out_mp4):
    inp = os.path.join(str(Path(out_dir)), "frame_%04d.png").replace("\\", "/")
    out = str(Path(out_mp4)).replace("\\", "/")
    cmd = [ffmpeg, "-y", "-framerate", str(fps), "-i", inp, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", out]
    print("[ffmpeg]", " ".join(cmd))
    subprocess.check_call(cmd)


def main():
    args = parse_args()
    clear_scene()
    obj = import_textured_obj(args.obj)
    make_materials_shadeless(obj, strength=1.15)
    center, radius = bbox_world(obj)
    if args.center_on_lines and args.txt:
        line_pts = load_all_line_points(args.txt)
        if line_pts:
            center, line_radius = bbox_points(line_pts)
            radius = max(line_radius * 2.0, radius * 0.35)
            print(f"[center_on_lines] center={tuple(round(v, 3) for v in center)} radius={radius:.3f}")
    setup_lights()
    if args.txt and args.paint_surface:
        painted = paint_mesh_faces_near_lines(obj, args.txt, args.line_color, args.paint_radius)
        print(f"[paint_surface] painted_faces={painted} radius={args.paint_radius}")
    elif args.txt:
        mat = make_line_material("Transferred_Lines", args.line_color, args.curve_strength)
        for i, path in enumerate(args.txt):
            pts = load_xyz(path)
            add_polyline_curve(f"Line_{i:03d}", pts, mat, args.curve_radius)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = args.res
    scene.render.resolution_y = args.res
    scene.render.fps = args.fps
    scene.frame_start = 1
    scene.frame_end = args.frames
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.color = (0.02, 0.02, 0.05)

    setup_camera(scene, center, radius, args)
    render_sequence(scene, args.out_dir)
    try:
        ffmpeg_make_mp4(args.ffmpeg, args.out_dir, args.fps, args.out_mp4)
        print("[Done]", args.out_mp4)
    except Exception as exc:
        print("[WARN] ffmpeg failed:", repr(exc))
        print("[Frames]", args.out_dir)


main()
