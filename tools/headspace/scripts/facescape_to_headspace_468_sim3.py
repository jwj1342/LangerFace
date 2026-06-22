import argparse
import json
import os
from pathlib import Path

import numpy as np
import trimesh

from lmk2d_to_3d_and_prealign_weighted_multiview import build_weights, weighted_umeyama_sim3, apply_sim3


def load_xyz(path):
    return np.loadtxt(path, dtype=np.float64)


def unique_valid(indices, n):
    seen = []
    used = set()
    for i in indices:
        if 0 <= int(i) < n and int(i) not in used:
            used.add(int(i))
            seen.append(int(i))
    return np.asarray(seen, dtype=np.int32)


def landmark_subset_indices(name, n):
    left_eye = [33, 133, 160, 159, 158, 157, 173, 246, 7, 163, 144, 145, 153, 154, 155]
    right_eye = [263, 362, 387, 386, 385, 384, 398, 466, 249, 390, 373, 374, 380, 381, 382]
    left_brow = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46]
    right_brow = [336, 296, 334, 293, 300, 285, 295, 282, 283, 276]
    nose = [1, 2, 4, 5, 6, 19, 94, 98, 168, 195, 197, 236, 327, 456]
    outer_mouth = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291]
    inner_mouth = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308]
    stable_cheek = [50, 101, 118, 119, 120, 187, 205, 206, 207, 280, 330, 347, 348, 349, 411, 425, 426, 427]
    central_forehead = [8, 9, 10, 151, 108, 109, 337, 338]

    fine = set()
    for group in [left_eye, right_eye, left_brow, right_brow, nose, outer_mouth, inner_mouth]:
        fine.update(group)

    if name in {"all", "weighted_all"}:
        return np.arange(n, dtype=np.int32)
    if name == "fine_only":
        return unique_valid(sorted(fine), n)
    if name == "central_face":
        return unique_valid(left_eye + right_eye + left_brow + right_brow + nose + outer_mouth + inner_mouth, n)
    if name == "pose_stable":
        return unique_valid(left_eye + right_eye + left_brow + right_brow + outer_mouth + inner_mouth + central_forehead, n)
    if name == "pose_plus_nose":
        return unique_valid(left_eye + right_eye + left_brow + right_brow + outer_mouth + inner_mouth + central_forehead + nose, n)
    if name == "pose_plus_cheek":
        return unique_valid(left_eye + right_eye + left_brow + right_brow + outer_mouth + inner_mouth + central_forehead + stable_cheek, n)
    if name == "stable_face":
        return unique_valid(
            left_eye
            + right_eye
            + left_brow
            + right_brow
            + nose
            + outer_mouth
            + inner_mouth
            + stable_cheek
            + central_forehead,
            n,
        )
    raise ValueError(f"Unknown landmark_subset: {name}")


def line_key(path):
    return Path(path).stem.replace("_xyz", "")


def snap_to_mesh(mesh, pts):
    try:
        closest, _, _ = trimesh.proximity.closest_point(mesh, pts)
        return closest
    except Exception:
        # Keep the transformed line if proximity backend is unavailable.
        return pts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source_lmk", required=True)
    ap.add_argument("--target_lmk", required=True)
    ap.add_argument("--source_lines_dir", required=True)
    ap.add_argument("--target_mesh", required=True)
    ap.add_argument("--out_dir", required=True)
    ap.add_argument("--w_fine", type=float, default=4.0)
    ap.add_argument("--w_contour", type=float, default=0.25)
    ap.add_argument("--preset", default="fine")
    ap.add_argument(
        "--landmark_subset",
        default="all",
        choices=["all", "fine_only", "central_face", "pose_stable", "pose_plus_nose", "pose_plus_cheek", "stable_face"],
    )
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    line_dir = out_dir / "sim3_lines_snapped"
    raw_line_dir = out_dir / "sim3_lines_raw"
    line_dir.mkdir(parents=True, exist_ok=True)
    raw_line_dir.mkdir(parents=True, exist_ok=True)

    src = load_xyz(args.source_lmk)
    tgt = load_xyz(args.target_lmk)
    n = min(src.shape[0], tgt.shape[0])
    src = src[:n]
    tgt = tgt[:n]
    valid = np.isfinite(src).all(axis=1) & np.isfinite(tgt).all(axis=1)
    w = build_weights(n, args.preset, args.w_fine, args.w_contour)
    subset = landmark_subset_indices(args.landmark_subset, n)
    fit_mask = valid.copy()
    if args.landmark_subset != "all":
        allowed = np.zeros((n,), dtype=bool)
        allowed[subset] = True
        fit_mask &= allowed
    if fit_mask.sum() < 8:
        raise RuntimeError(f"Too few valid landmarks for subset {args.landmark_subset}: {fit_mask.sum()}")
    s, R, t = weighted_umeyama_sim3(src[fit_mask], tgt[fit_mask], w[fit_mask], with_scale=True)
    pred = apply_sim3(src[valid], s, R, t)
    err = np.linalg.norm(pred - tgt[valid], axis=1)
    fit_pred = apply_sim3(src[fit_mask], s, R, t)
    fit_err = np.linalg.norm(fit_pred - tgt[fit_mask], axis=1)

    mesh = trimesh.load(args.target_mesh, process=False)
    line_records = []
    for lp in sorted(Path(args.source_lines_dir).glob("*_xyz.txt")):
        pts = load_xyz(lp)
        sim = apply_sim3(pts, s, R, t)
        snapped = snap_to_mesh(mesh, sim)
        raw_out = raw_line_dir / f"{line_key(lp)}_sim3_raw.txt"
        snap_out = line_dir / f"{line_key(lp)}_sim3_snapped.txt"
        np.savetxt(raw_out, sim, fmt="%.8f")
        np.savetxt(snap_out, snapped, fmt="%.8f")
        line_records.append({"source": str(lp), "raw": str(raw_out), "snapped": str(snap_out), "points": int(len(pts))})

    summary = {
        "source_lmk": args.source_lmk,
        "target_lmk": args.target_lmk,
        "target_mesh": args.target_mesh,
        "num_common": int(n),
        "num_valid": int(valid.sum()),
        "landmark_subset": args.landmark_subset,
        "num_fit_landmarks": int(fit_mask.sum()),
        "sim3_scale": float(s),
        "sim3_rotation": R.tolist(),
        "sim3_translation": t.tolist(),
        "lmk_error_mean": float(np.mean(err)),
        "lmk_error_median": float(np.median(err)),
        "lmk_error_p90": float(np.percentile(err, 90)),
        "lmk_error_p95": float(np.percentile(err, 95)),
        "lmk_error_max": float(np.max(err)),
        "fit_lmk_error_mean": float(np.mean(fit_err)),
        "fit_lmk_error_median": float(np.median(fit_err)),
        "fit_lmk_error_p90": float(np.percentile(fit_err, 90)),
        "fit_lmk_error_p95": float(np.percentile(fit_err, 95)),
        "fit_lmk_error_max": float(np.max(fit_err)),
        "line_count": len(line_records),
        "line_dir": str(line_dir),
        "lines": line_records,
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
