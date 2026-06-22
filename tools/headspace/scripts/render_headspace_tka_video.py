import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


def parse_args():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--obj", required=True)
    parser.add_argument("--tka_json", required=True)
    parser.add_argument("--out_dir", required=True)
    parser.add_argument("--out_mp4", required=True)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--frames", type=int, default=72)
    parser.add_argument("--fps", type=int, default=24)
    parser.add_argument("--yaw_deg", type=float, default=7.0)
    parser.add_argument("--brightness", type=float, default=1.0)
    parser.add_argument("--txt", nargs="*", default=[])
    parser.add_argument("--txt_dir", default="")
    parser.add_argument("--line_color", default="1,0,0")
    parser.add_argument("--paint_surface", action="store_true")
    parser.add_argument("--paint_radius", type=float, default=2.0)
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
    if hasattr(bpy.ops.wm, "obj_import"):
        bpy.ops.wm.obj_import(filepath=str(Path(obj_path)), forward_axis="Y", up_axis="Z")
    else:
        bpy.ops.import_scene.obj(filepath=str(Path(obj_path)), axis_forward="Y", axis_up="Z")
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No mesh imported from {obj_path}")
    return meshes[0]


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


def load_xyz(path):
    pts = []
    for line in Path(path).read_text(encoding="utf-8", errors="ignore").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        a = line.split()
        if len(a) >= 3:
            pts.append(Vector((float(a[0]), float(a[1]), float(a[2]))))
    return pts


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
        pts.extend(load_xyz(path))
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


def bbox_world(obj):
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    mn = Vector((min(p.x for p in corners), min(p.y for p in corners), min(p.z for p in corners)))
    mx = Vector((max(p.x for p in corners), max(p.y for p in corners), max(p.z for p in corners)))
    center = (mn + mx) * 0.5
    radius = max((p - center).length for p in corners)
    return center, radius


def setup_lights(center, radius):
    bpy.ops.object.light_add(type="AREA", location=center + Vector((0, -radius, radius * 1.5)))
    key = bpy.context.object
    key.data.energy = 850
    key.data.size = 6.0
    bpy.ops.object.light_add(type="POINT", location=center + Vector((radius, radius, radius)))
    fill = bpy.context.object
    fill.data.energy = 140


def tka_camera_basis(tka_json):
    data = json.loads(Path(tka_json).read_text(encoding="utf-8"))
    M = Matrix(data["M"])
    C = Vector((data["X"], data["Y"], data["Z"]))
    image_w, image_h = data["image_size"]

    # TKA: Pc = M @ (Pw - C), camera +Z forward, image +Y downward.
    # Blender camera local -Z is forward.
    x_world = M.transposed() @ Vector((1, 0, 0))
    y_world = M.transposed() @ Vector((0, -1, 0))
    z_world = M.transposed() @ Vector((0, 0, -1))
    return data, C, x_world.normalized(), y_world.normalized(), z_world.normalized(), int(image_w), int(image_h)


def set_camera_from_basis(scene, data, C, x_world, y_world, z_world, image_w, image_h):
    rot = Matrix(
        (
            (x_world.x, y_world.x, z_world.x),
            (x_world.y, y_world.y, z_world.y),
            (x_world.z, y_world.z, z_world.z),
        )
    ).to_4x4()
    bpy.ops.object.camera_add()
    cam = bpy.context.object
    scene.camera = cam
    cam.matrix_world = Matrix.Translation(C) @ rot
    cam.data.type = "PERSP"
    cam.data.lens = float(data["f"])
    cam.data.sensor_fit = "HORIZONTAL"
    cam.data.sensor_width = float(data["x"]) * float(image_w)
    cam.data.shift_x = (float(data["a"]) - image_w * 0.5) / image_w
    cam.data.shift_y = (image_h * 0.5 - float(data["b"])) / image_w
    cam.data.clip_end = 100000.0
    scene.render.resolution_x = image_w
    scene.render.resolution_y = image_h
    scene.render.pixel_aspect_x = 1.0
    scene.render.pixel_aspect_y = 1.0
    return cam


def make_video(ffmpeg, out_dir, fps, out_mp4):
    inp = os.path.join(str(Path(out_dir)), "frame_%04d.png").replace("\\", "/")
    out = str(Path(out_mp4)).replace("\\", "/")
    cmd = [ffmpeg, "-y", "-framerate", str(fps), "-i", inp, "-vf", "scale=720:-2,format=yuv420p", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", out]
    print("[ffmpeg]", " ".join(cmd))
    subprocess.check_call(cmd)


def main():
    args = parse_args()
    clear_scene()
    mesh = import_textured_obj(args.obj)
    make_materials_shadeless(mesh, strength=1.15)
    if args.txt and args.paint_surface:
        painted = paint_mesh_faces_near_lines(mesh, args.txt, args.line_color, args.paint_radius)
        print(f"[paint_surface] painted_faces={painted} radius={args.paint_radius}")
    center, radius = bbox_world(mesh)
    setup_lights(center, radius)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.frame_start = 1
    scene.frame_end = args.frames
    scene.render.fps = args.fps
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.color = (0.03, 0.03, 0.04)

    data, C, x0, y0, z0, image_w, image_h = tka_camera_basis(args.tka_json)
    cam = set_camera_from_basis(scene, data, C, x0, y0, z0, image_w, image_h)

    # Subtle yaw wobble around the calibrated camera center: enough to read 3D, not enough to stop being frontal.
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    yaw = args.yaw_deg
    for frame in range(1, args.frames + 1):
        t = (frame - 1) / max(args.frames - 1, 1)
        deg = -yaw + 2.0 * yaw * t
        rot_yaw = Matrix.Rotation(deg * 3.141592653589793 / 180.0, 4, y0)
        x = (rot_yaw @ x0).normalized()
        z = (rot_yaw @ z0).normalized()
        rot = Matrix(((x.x, y0.x, z.x), (x.y, y0.y, z.y), (x.z, y0.z, z.z))).to_4x4()
        cam.matrix_world = Matrix.Translation(C) @ rot
        scene.frame_set(frame)
        scene.render.filepath = str(out_dir / f"frame_{frame:04d}.png")
        scene.render.image_settings.file_format = "PNG"
        bpy.ops.render.render(write_still=True)

    make_video(args.ffmpeg, out_dir, args.fps, args.out_mp4)
    print("[Done]", args.out_mp4)


main()
