import argparse
import csv
import json
from pathlib import Path

import numpy as np
import trimesh

from headspace_eval_sim3_regions import REGIONS, COMPOSITES, region_indices, stats, write_png_table
from lmk2d_to_3d_and_prealign_weighted_multiview import apply_sim3


def load_xyz(path):
    return np.loadtxt(path, dtype=np.float64)


def snap_to_mesh(mesh, pts):
    try:
        closest, _, _ = trimesh.proximity.closest_point(mesh, pts)
        return closest
    except Exception:
        return pts


def residual_field(points, anchor_points, anchor_residuals, sigma, alpha, max_disp, cutoff):
    points = np.asarray(points, dtype=np.float64)
    diff = points[:, None, :] - anchor_points[None, :, :]
    d2 = np.sum(diff * diff, axis=2)
    nearest = np.sqrt(np.min(d2, axis=1))
    weights = np.exp(-0.5 * d2 / max(sigma * sigma, 1e-12))
    if cutoff > 0:
        weights[nearest > cutoff] = 0.0
    denom = np.sum(weights, axis=1, keepdims=True)
    safe = denom[:, 0] > 1e-12
    corr = np.zeros_like(points)
    corr[safe] = (weights[safe] @ anchor_residuals) / denom[safe]
    corr *= alpha
    norms = np.linalg.norm(corr, axis=1)
    too_large = norms > max_disp
    if np.any(too_large):
        corr[too_large] *= (max_disp / norms[too_large])[:, None]
    return corr


def eval_regions(pred, tgt, valid):
    err = np.linalg.norm(pred - tgt, axis=1)
    names = [
        "central_face",
        "brows_eyes",
        "left_eye",
        "right_eye",
        "left_brow",
        "right_brow",
        "nose",
        "mouth",
        "outer_mouth",
        "inner_mouth",
        "stable_cheek",
        "central_forehead",
        "fit_stable_face",
        "face_oval",
    ]
    rows = []
    n = len(err)
    for name in names:
        idx = region_indices(name, n)
        idx = idx[valid[idx]]
        row = {"region": name}
        row.update(stats(err[idx]))
        rows.append(row)
    return rows


def write_outputs(rows, out_dir, prefix):
    json_path = out_dir / f"{prefix}_region_error_summary.json"
    csv_path = out_dir / f"{prefix}_region_error_summary.csv"
    png_path = out_dir / f"{prefix}_region_error_summary.png"
    json_path.write_text(json.dumps({"regions": rows}, indent=2), encoding="utf-8")
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["region", "n", "mean", "median", "p90", "p95", "max"])
        writer.writeheader()
        writer.writerows(rows)
    write_png_table(rows, png_path)
    return json_path, csv_path, png_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--summary", required=True)
    ap.add_argument("--out_dir", required=True)
    ap.add_argument("--anchor_region", default="nose", choices=sorted(set(REGIONS) | set(COMPOSITES)))
    ap.add_argument("--sigma", type=float, default=14.0)
    ap.add_argument("--alpha", type=float, default=1.0)
    ap.add_argument("--max_disp", type=float, default=6.0)
    ap.add_argument("--cutoff", type=float, default=35.0)
    ap.add_argument("--write_lines", action="store_true")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    summary = json.loads(Path(args.summary).read_text(encoding="utf-8"))
    src = load_xyz(summary["source_lmk"])
    tgt = load_xyz(summary["target_lmk"])
    n = min(len(src), len(tgt))
    src = src[:n]
    tgt = tgt[:n]
    valid = np.isfinite(src).all(axis=1) & np.isfinite(tgt).all(axis=1)

    pred = apply_sim3(
        src,
        float(summary["sim3_scale"]),
        np.asarray(summary["sim3_rotation"], dtype=np.float64),
        np.asarray(summary["sim3_translation"], dtype=np.float64),
    )
    anchor_idx = region_indices(args.anchor_region, n)
    anchor_idx = anchor_idx[valid[anchor_idx]]
    anchor_points = pred[anchor_idx]
    anchor_residuals = tgt[anchor_idx] - pred[anchor_idx]
    corr = residual_field(pred, anchor_points, anchor_residuals, args.sigma, args.alpha, args.max_disp, args.cutoff)
    corrected = pred + corr
    rows = eval_regions(corrected, tgt, valid)

    meta = {
        "summary": str(Path(args.summary)),
        "anchor_region": args.anchor_region,
        "sigma": args.sigma,
        "alpha": args.alpha,
        "max_disp": args.max_disp,
        "cutoff": args.cutoff,
        "anchor_count": int(len(anchor_idx)),
        "correction_mean": float(np.mean(np.linalg.norm(corr[valid], axis=1))),
        "correction_p95": float(np.percentile(np.linalg.norm(corr[valid], axis=1), 95)),
        "correction_max": float(np.max(np.linalg.norm(corr[valid], axis=1))),
    }
    (out_dir / "local_residual_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    np.savetxt(out_dir / "corrected_landmarks.txt", corrected, fmt="%.8f")
    json_path, csv_path, png_path = write_outputs(rows, out_dir, "corrected")

    if args.write_lines:
        mesh = trimesh.load(summary["target_mesh"], process=False)
        raw_dir = out_dir / "local_residual_lines_raw"
        snap_dir = out_dir / "local_residual_lines_snapped"
        raw_dir.mkdir(exist_ok=True)
        snap_dir.mkdir(exist_ok=True)
        for rec in summary.get("lines", []):
            raw_path = Path(rec["raw"])
            pts = load_xyz(raw_path)
            pcorr = residual_field(pts, anchor_points, anchor_residuals, args.sigma, args.alpha, args.max_disp, args.cutoff)
            fixed = pts + pcorr
            snapped = snap_to_mesh(mesh, fixed)
            stem = raw_path.stem.replace("_sim3_raw", "_local_residual")
            np.savetxt(raw_dir / f"{stem}_raw.txt", fixed, fmt="%.8f")
            np.savetxt(snap_dir / f"{stem}_snapped.txt", snapped, fmt="%.8f")
        print(f"wrote lines {snap_dir}")

    print(f"wrote {json_path}")
    print(f"wrote {csv_path}")
    print(f"wrote {png_path}")
    for row in rows:
        if row["region"] in {"central_face", "brows_eyes", "nose", "mouth", "stable_cheek", "central_forehead"}:
            print(
                f"{row['region']}: n={row['n']} mean={row['mean']:.4f} median={row['median']:.4f} "
                f"p90={row['p90']:.4f} p95={row['p95']:.4f} max={row['max']:.4f}"
            )


if __name__ == "__main__":
    main()
