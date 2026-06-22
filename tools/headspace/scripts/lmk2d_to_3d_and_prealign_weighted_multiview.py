"""多视角 2D→3D 抬升 + 加权 Sim3 预对齐（CLI）。

可复用的算法核心已收敛到 langerface 包：
  - geometry.alignment:      weighted_umeyama_sim3 / apply_sim3 / resample_polyline_arclen
  - registration.landmarks:  build_landmark_weights / normalize_view_weights /
                             medoid_fuse / fuse_landmarks_multiview
  - registration.camera:     get_cam_params / rays_world_from_pixels /
                             project_points_to_image / intersect_rays_mesh
本模块保留数据集相关的 I/O、MediaPipe 单图检测与 main() 编排，并对兄弟脚本
（facescape_to_headspace_468_sim3.py 等）re-export 这些核心符号。
"""
import argparse
import json
import os

import cv2
import numpy as np

from langerface.geometry import apply_sim3, resample_polyline_arclen, weighted_umeyama_sim3
from langerface.registration.camera import (
    get_cam_params,
    intersect_rays_mesh,
    project_points_to_image,
    rays_world_from_pixels,
    undistort_pixels_to_normalized,  # noqa: F401  (re-export for sibling scripts)
)
from langerface.registration.landmarks import (
    build_landmark_weights,
    fuse_landmarks_multiview,
    medoid_fuse,  # noqa: F401  (re-export)
    normalize_view_weights,
)

# 兄弟脚本按旧名 import；保留别名以兼容。
build_weights = build_landmark_weights


def load_xyz_txt(path: str) -> np.ndarray:
    pts = []
    with open(path, encoding="utf-8", errors="ignore") as f:
        for ln in f:
            ln = ln.strip()
            if not ln or ln.startswith("#"):
                continue
            a = ln.split()
            if len(a) >= 3:
                pts.append([float(a[0]), float(a[1]), float(a[2])])
    P = np.array(pts, dtype=np.float64)
    if P.ndim != 2 or P.shape[1] != 3:
        raise ValueError(f"Bad xyz: {path}")
    return P


def save_xyz_txt(path: str, P: np.ndarray):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    np.savetxt(path, P.astype(np.float64), fmt="%.8f")


def detect_face_landmarks_tasks(img_bgr: np.ndarray, task_path: str) -> np.ndarray:
    import mediapipe as mp
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision

    h, w = img_bgr.shape[:2]
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    base_options = python.BaseOptions(model_asset_path=task_path)
    options = vision.FaceLandmarkerOptions(
        base_options=base_options,
        running_mode=vision.RunningMode.IMAGE,
        num_faces=1,
        output_face_blendshapes=False,
        output_facial_transformation_matrixes=False,
    )
    landmarker = vision.FaceLandmarker.create_from_options(options)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=img_rgb)
    res = landmarker.detect(mp_image)
    if res.face_landmarks is None or len(res.face_landmarks) == 0:
        raise RuntimeError("MediaPipe Tasks: no face detected")
    lm = res.face_landmarks[0]
    return np.array([[p.x * w, p.y * h] for p in lm], dtype=np.float64)


def draw_points(img_bgr: np.ndarray, uv: np.ndarray, color_bgr, radius=3) -> np.ndarray:
    out = img_bgr.copy()
    h, w = out.shape[:2]
    for x, y in np.round(uv).astype(np.int32):
        if 0 <= x < w and 0 <= y < h:
            cv2.circle(out, (int(x), int(y)), radius, color_bgr, -1, cv2.LINE_AA)
    return out


def parse_float_list(values):
    if values is None:
        return None
    return [float(v) for v in values]


def detect_and_intersect_views(img_paths, view_ids, params, mesh_path, mp_task, scale, rt_mode):
    import trimesh

    mesh = trimesh.load(mesh_path, process=False)
    uv_all, p3d_all, hit_all = [], [], []
    for img_path, view_id in zip(img_paths, view_ids):
        img = cv2.imread(img_path)
        if img is None:
            raise FileNotFoundError(img_path)
        uv = detect_face_landmarks_tasks(img, mp_task)
        K, Rt, dist, _ = get_cam_params(params, view_id, scale)
        origins, dirs = rays_world_from_pixels(uv, K, Rt, dist, rt_mode)
        p3d, hit = intersect_rays_mesh(origins, dirs, mesh)
        uv_all.append(uv)
        p3d_all.append(p3d)
        hit_all.append(hit)
    return uv_all, p3d_all, hit_all


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mp_task", type=str, default="assets/face_landmarker.task")
    ap.add_argument("--preset", type=str, default="fine", choices=["dense", "fine"])
    ap.add_argument("--w_fine", type=float, default=4.0)
    ap.add_argument("--w_contour", type=float, default=0.25)

    ap.add_argument("--src_views", type=int, nargs="+", required=True)
    ap.add_argument("--src_imgs", type=str, nargs="+", required=True)
    ap.add_argument("--src_params", type=str, required=True)
    ap.add_argument("--src_mesh", type=str, required=True)
    ap.add_argument("--src_rt_mode", type=str, default="w2c", choices=["w2c", "c2w"])

    ap.add_argument("--tgt_views", type=int, nargs="+", required=True)
    ap.add_argument("--tgt_imgs", type=str, nargs="+", required=True)
    ap.add_argument("--tgt_params", type=str, required=True)
    ap.add_argument("--tgt_mesh", type=str, required=True)
    ap.add_argument("--tgt_rt_mode", type=str, default="w2c", choices=["w2c", "c2w"])

    ap.add_argument("--src_view_weights", nargs="*")
    ap.add_argument("--tgt_view_weights", nargs="*")
    ap.add_argument("--fuse_inlier_thresh", type=float, default=0.015)
    ap.add_argument("--min_support", type=int, default=2)

    ap.add_argument("--src_face_xyz", type=str, required=True)
    ap.add_argument("--src_lines", type=str, nargs="+", required=True)
    ap.add_argument("--outdir", type=str, required=True)
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--min_hits", type=int, default=80)
    ap.add_argument("--sim3_no_scale", action="store_true")
    ap.add_argument("--viz", action="store_true")

    args = ap.parse_args()

    if len(args.src_views) != len(args.src_imgs):
        raise ValueError("src_views and src_imgs count mismatch")
    if len(args.tgt_views) != len(args.tgt_imgs):
        raise ValueError("tgt_views and tgt_imgs count mismatch")

    os.makedirs(args.outdir, exist_ok=True)
    prealign_dir = os.path.join(args.outdir, "prealign")
    os.makedirs(prealign_dir, exist_ok=True)

    src_params = json.load(open(args.src_params, encoding="utf-8"))
    tgt_params = json.load(open(args.tgt_params, encoding="utf-8"))

    src_view_weights = normalize_view_weights(len(args.src_views), parse_float_list(args.src_view_weights))
    tgt_view_weights = normalize_view_weights(len(args.tgt_views), parse_float_list(args.tgt_view_weights))

    src_uv_views, src_lmk3d_views, src_hit_views = detect_and_intersect_views(
        args.src_imgs, args.src_views, src_params, args.src_mesh, args.mp_task, args.scale, args.src_rt_mode
    )
    tgt_uv_views, tgt_lmk3d_views, tgt_hit_views = detect_and_intersect_views(
        args.tgt_imgs, args.tgt_views, tgt_params, args.tgt_mesh, args.mp_task, args.scale, args.tgt_rt_mode
    )

    n_lmk = src_uv_views[0].shape[0]
    if tgt_uv_views[0].shape[0] != n_lmk:
        raise RuntimeError(f"src/tgt landmark count mismatch: {n_lmk} vs {tgt_uv_views[0].shape[0]}")

    w_all = build_weights(n_lmk, args.preset, args.w_fine, args.w_contour)
    src_fused, src_hit, src_support = fuse_landmarks_multiview(
        src_lmk3d_views, src_hit_views, src_view_weights, args.fuse_inlier_thresh
    )
    tgt_fused, tgt_hit, tgt_support = fuse_landmarks_multiview(
        tgt_lmk3d_views, tgt_hit_views, tgt_view_weights, args.fuse_inlier_thresh
    )

    good = (
        src_hit
        & tgt_hit
        & np.isfinite(src_fused[:, 0])
        & np.isfinite(tgt_fused[:, 0])
        & (src_support >= args.min_support)
        & (tgt_support >= args.min_support)
    )
    if good.sum() < args.min_hits:
        raise RuntimeError(
            f"Too few fused 3D landmarks: {good.sum()} (min_hits={args.min_hits}, min_support={args.min_support})"
        )

    src_lmk3d = src_fused[good]
    tgt_lmk3d = tgt_fused[good]
    w_used = w_all[good]

    save_xyz_txt(os.path.join(args.outdir, "src_lmk3d_fused.txt"), src_lmk3d)
    save_xyz_txt(os.path.join(args.outdir, "tgt_lmk3d_fused.txt"), tgt_lmk3d)
    np.savetxt(os.path.join(args.outdir, "src_lmk_support.txt"), src_support.astype(np.int32), fmt="%d")
    np.savetxt(os.path.join(args.outdir, "tgt_lmk_support.txt"), tgt_support.astype(np.int32), fmt="%d")
    np.savetxt(os.path.join(args.outdir, "lmk_weights.txt"), w_used.astype(np.float64), fmt="%.6f")

    with_scale = not args.sim3_no_scale
    s, R, t = weighted_umeyama_sim3(src_lmk3d, tgt_lmk3d, w_used, with_scale=with_scale)
    T = np.eye(4, dtype=np.float64)
    T[:3, :3] = s * R
    T[:3, 3] = t.reshape(3)
    np.savetxt(os.path.join(args.outdir, "sim3_T44.txt"), T, fmt="%.10f")

    src_face = load_xyz_txt(args.src_face_xyz)
    src_face_a = apply_sim3(src_face, s, R, t)
    save_xyz_txt(os.path.join(prealign_dir, "exp1_face_sim3.txt"), src_face_a)

    for lp in args.src_lines:
        line = load_xyz_txt(lp)
        line_a = apply_sim3(line, s, R, t)
        line_a = resample_polyline_arclen(line_a, n_samples=len(line_a), smooth=0.0)
        stem = os.path.splitext(os.path.basename(lp))[0]
        save_xyz_txt(os.path.join(prealign_dir, f"{stem}_sim3.txt"), line_a)

    if args.viz:
        viz_idx = len(args.tgt_views) // 2
        viz_img = cv2.imread(args.tgt_imgs[viz_idx])
        if viz_img is not None:
            K_t, Rt_t, dist_t, _ = get_cam_params(tgt_params, args.tgt_views[viz_idx], args.scale)
            uv_tgt = tgt_uv_views[viz_idx][good]
            uv_src_to_tgt = project_points_to_image(
                apply_sim3(src_lmk3d, s, R, t), K_t, Rt_t, dist_t, args.tgt_rt_mode
            )
            img_t = draw_points(viz_img, uv_tgt, (0, 255, 0), radius=2)
            img_t = draw_points(img_t, uv_src_to_tgt, (255, 0, 0), radius=2)
            cv2.imwrite(os.path.join(args.outdir, f"viz_tgt_landmarks_view{args.tgt_views[viz_idx]}.png"), img_t)

    print("[OK] Multi-view weighted Sim(3) prealign done.")
    print(" - src fused:", os.path.join(args.outdir, "src_lmk3d_fused.txt"))
    print(" - tgt fused:", os.path.join(args.outdir, "tgt_lmk3d_fused.txt"))
    print(" - prealign face:", os.path.join(prealign_dir, "exp1_face_sim3.txt"))
    print(" - prealign lines:", prealign_dir)


if __name__ == "__main__":
    main()
