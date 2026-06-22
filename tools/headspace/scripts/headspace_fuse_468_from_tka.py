import argparse
import json
from pathlib import Path

import cv2
import numpy as np
import trimesh


def load_tka_json(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    M = np.asarray(data["M"], dtype=np.float64)
    C = np.array([data["X"], data["Y"], data["Z"]], dtype=np.float64)
    fx = data["f"] / data["x"]
    fy = data["f"] / data["y"]
    cx = data["a"]
    cy = data["b"]
    return M, C, fx, fy, cx, cy


def rays_from_pixels_tka(uv, tka_json):
    M, C, fx, fy, cx, cy = load_tka_json(tka_json)
    x = (uv[:, 0] - cx) / fx
    y = (uv[:, 1] - cy) / fy
    dirs_cam = np.stack([x, y, np.ones_like(x)], axis=1)
    dirs_cam /= np.linalg.norm(dirs_cam, axis=1, keepdims=True) + 1e-12
    dirs_world = (M.T @ dirs_cam.T).T
    dirs_world /= np.linalg.norm(dirs_world, axis=1, keepdims=True) + 1e-12
    origins = np.repeat(C.reshape(1, 3), uv.shape[0], axis=0)
    return origins, dirs_world


def project_tka(P, tka_json):
    M, C, fx, fy, cx, cy = load_tka_json(tka_json)
    Pc = (M @ (P - C.reshape(1, 3)).T).T
    z = Pc[:, 2]
    uv = np.full((P.shape[0], 2), np.nan, dtype=np.float64)
    good = np.abs(z) > 1e-9
    uv[good, 0] = cx + fx * Pc[good, 0] / z[good]
    uv[good, 1] = cy + fy * Pc[good, 1] / z[good]
    return uv


def intersect_rays(mesh, origins, dirs):
    loc, ray_id, _ = mesh.ray.intersects_location(origins, dirs, multiple_hits=False)
    pts = np.full((origins.shape[0], 3), np.nan, dtype=np.float64)
    hit = np.zeros((origins.shape[0],), dtype=bool)
    if len(ray_id):
        pts[ray_id] = loc
        hit[ray_id] = True
    return pts, hit


def weighted_fuse(view_points, view_hits, view_weights, min_support=1):
    n = view_points[0].shape[0]
    out = np.full((n, 3), np.nan, dtype=np.float64)
    support = np.zeros((n,), dtype=np.int32)
    for i in range(n):
        pts = []
        w = []
        for P, H, ww in zip(view_points, view_hits, view_weights):
            if H[i] and np.isfinite(P[i]).all():
                pts.append(P[i])
                w.append(ww)
        support[i] = len(pts)
        if len(pts) >= min_support:
            pts = np.asarray(pts, dtype=np.float64)
            w = np.asarray(w, dtype=np.float64)
            w = w / (w.sum() + 1e-12)
            center = (pts * w[:, None]).sum(axis=0)
            out[i] = center
    return out, support


def draw_overlay(image_path, uv_detected, uv_reprojected, out_path):
    img = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if img is None:
        return
    h, w = img.shape[:2]
    for x, y in np.round(uv_detected).astype(np.int32):
        if 0 <= x < w and 0 <= y < h:
            cv2.circle(img, (int(x), int(y)), 1, (0, 255, 0), -1, cv2.LINE_AA)
    for x, y in np.round(uv_reprojected).astype(np.int32):
        if 0 <= x < w and 0 <= y < h:
            cv2.circle(img, (int(x), int(y)), 2, (0, 0, 255), -1, cv2.LINE_AA)
    cv2.imwrite(str(out_path), img)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--headspace_detect_dir", required=True)
    ap.add_argument("--obj", required=True)
    ap.add_argument("--min_support", type=int, default=1)
    ap.add_argument("--out_dir", default="")
    args = ap.parse_args()

    root = Path(args.headspace_detect_dir)
    out_dir = Path(args.out_dir) if args.out_dir else root / "mp468_3d_tka_mesh"
    out_dir.mkdir(parents=True, exist_ok=True)

    meta = json.loads((root / "meta.json").read_text(encoding="utf-8"))
    records = [r for r in meta["records"] if r.get("status") == "ok" and r.get("landmark_path") and r.get("camera_json")]
    if not records:
        raise RuntimeError(f"No usable records in {root}")

    mesh = trimesh.load(args.obj, process=False)
    view_points = []
    view_hits = []
    weights = []
    used = []
    for rec in sorted(records, key=lambda r: r["score"], reverse=True):
        lmk = np.loadtxt(rec["landmark_path"], dtype=np.float64)
        uv = lmk[:, :2]
        origins, dirs = rays_from_pixels_tka(uv, rec["camera_json"])
        pts, hit = intersect_rays(mesh, origins, dirs)
        view_points.append(pts)
        view_hits.append(hit)
        weights.append(max(float(rec["score"]), 1e-6))
        used.append(
            {
                "view": rec["view"],
                "score": float(rec["score"]),
                "num_landmarks": int(uv.shape[0]),
                "hit_count": int(hit.sum()),
                "landmark_path": rec["landmark_path"],
                "camera_json": rec["camera_json"],
                "image_path": rec["image_path"],
            }
        )

    fused, support = weighted_fuse(view_points, view_hits, np.asarray(weights), min_support=args.min_support)
    np.savetxt(out_dir / "headspace_lmk3d_478_tka_mesh.txt", fused, fmt="%.8f")
    np.savetxt(out_dir / "support.txt", support, fmt="%d")

    reproj = []
    valid = np.isfinite(fused).all(axis=1)
    for rec in used[:2]:
        lmk = np.loadtxt(rec["landmark_path"], dtype=np.float64)
        uv_proj = project_tka(fused[valid], rec["camera_json"])
        uv_full = np.full((fused.shape[0], 2), np.nan, dtype=np.float64)
        uv_full[valid] = uv_proj
        finite = np.isfinite(uv_full).all(axis=1)
        diff = uv_full[finite] - lmk[finite, :2]
        err = np.linalg.norm(diff, axis=1)
        overlay = out_dir / f"reproject_{rec['view']}.jpg"
        draw_overlay(rec["image_path"], lmk[:, :2], uv_full, overlay)
        reproj.append(
            {
                "view": rec["view"],
                "reproject_mean_px": float(np.mean(err)) if len(err) else None,
                "reproject_median_px": float(np.median(err)) if len(err) else None,
                "reproject_p90_px": float(np.percentile(err, 90)) if len(err) else None,
                "overlay": str(overlay),
            }
        )

    summary = {
        "detect_dir": str(root),
        "obj": args.obj,
        "num_views_used": len(used),
        "num_landmarks": int(fused.shape[0]),
        "valid_3d": int(valid.sum()),
        "support_ge_1": int((support >= 1).sum()),
        "support_ge_2": int((support >= 2).sum()),
        "used_views": used,
        "reprojection": reproj,
        "out_lmk3d": str(out_dir / "headspace_lmk3d_478_tka_mesh.txt"),
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
