import argparse
import json
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree


def parse_args():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--obj", required=True)
    parser.add_argument("--tka_json", required=True)
    parser.add_argument("--out_png", required=True)
    parser.add_argument("--txt", nargs="*", default=[])
    parser.add_argument("--txt_dir", default="")
    parser.add_argument("--line_color", default="1,0,0")
    parser.add_argument("--curve_radius", type=float, default=0.9)
    parser.add_argument("--curve_strength", type=float, default=2.0)
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
        # Keep Headspace OBJ coordinates unchanged. Blender's OBJ importer
        # otherwise applies a default axis conversion, while TKA cameras and
        # transferred any_lines are already in the original OBJ coordinate
        # system.
        bpy.ops.wm.obj_import(filepath=str(Path(obj_path)), forward_axis="Y", up_axis="Z")
    else:
        bpy.ops.import_scene.obj(filepath=str(Path(obj_path)), axis_forward="Y", axis_up="Z")
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No mesh imported from {obj_path}")
    return meshes[0]


def make_materials_shadeless(obj, strength=1.0):
    for mat in obj.data.materials:
        if not mat or not mat.use_nodes:
            continue
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        out = next((n for n in nodes if n.type == "OUTPUT_MATERIAL"), None)
        if out is None:
            continue
        base_socket = None
        principled = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        if principled is not None:
            base_socket = principled.inputs.get("Base Color")
        emission = nodes.new("ShaderNodeEmission")
        emission.inputs["Strength"].default_value = strength
        if base_socket is not None and base_socket.is_linked:
            links.new(base_socket.links[0].from_socket, emission.inputs["Color"])
        elif base_socket is not None:
            emission.inputs["Color"].default_value = base_socket.default_value
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
    pts = []
    for path in line_paths:
        pts.extend(load_xyz(path))
    if not pts:
        return 0

    kd = KDTree(len(pts))
    for i, p in enumerate(pts):
        kd.insert(p, i)
    kd.balance()

    red_mat = make_diffuse_material("Surface_Painted_Lines", rgb)
    mesh_obj.data.materials.append(red_mat)
    red_idx = len(mesh_obj.data.materials) - 1

    painted = 0
    world = mesh_obj.matrix_world
    for poly in mesh_obj.data.polygons:
        center = world @ poly.center
        nearest = kd.find(center)
        if nearest and nearest[2] <= radius:
            poly.material_index = red_idx
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
    key.data.energy = 650
    key.data.size = 6.0
    bpy.ops.object.light_add(type="POINT", location=center + Vector((radius, radius, radius)))
    fill = bpy.context.object
    fill.data.energy = 90


def setup_tka_camera(scene, tka_json):
    data = json.loads(Path(tka_json).read_text(encoding="utf-8"))
    M = Matrix(data["M"])
    C = Vector((data["X"], data["Y"], data["Z"]))
    image_w, image_h = data["image_size"]

    # TKA uses Pc = M @ (Pw - C), with camera +Z forward and image +Y downward.
    # Blender camera looks along local -Z, so local Z is opposite TKA forward.
    x_world = M.transposed() @ Vector((1, 0, 0))
    y_world = M.transposed() @ Vector((0, -1, 0))
    z_world = M.transposed() @ Vector((0, 0, -1))
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
    # Match the TKA principal point. Blender camera shifts are normalized by
    # the horizontal sensor size when sensor_fit is HORIZONTAL; positive
    # shift_y moves the frame upward, opposite image +Y.
    cam.data.shift_x = (float(data["a"]) - image_w * 0.5) / image_w
    cam.data.shift_y = (image_h * 0.5 - float(data["b"])) / image_w
    cam.data.clip_end = 100000.0

    scene.render.resolution_x = int(image_w)
    scene.render.resolution_y = int(image_h)
    scene.render.pixel_aspect_x = 1.0
    scene.render.pixel_aspect_y = 1.0


def main():
    args = parse_args()
    clear_scene()
    mesh = import_textured_obj(args.obj)
    make_materials_shadeless(mesh, strength=1.15)
    center, radius = bbox_world(mesh)
    setup_lights(center, radius)

    if args.txt and args.paint_surface:
        painted = paint_mesh_faces_near_lines(mesh, args.txt, args.line_color, args.paint_radius)
        print(f"[paint_surface] painted_faces={painted} radius={args.paint_radius}")
    elif args.txt:
        mat = make_line_material("Transferred_Lines", args.line_color, args.curve_strength)
        for i, path in enumerate(args.txt):
            add_polyline_curve(f"Line_{i:03d}", load_xyz(path), mat, args.curve_radius)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.color = (0.02, 0.02, 0.05)

    setup_tka_camera(scene, args.tka_json)
    out_png = Path(args.out_png)
    out_png.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(out_png)
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    print("[Done]", out_png)


main()
