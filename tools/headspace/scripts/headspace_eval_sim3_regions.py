import argparse
import csv
import json
from pathlib import Path

import numpy as np

from lmk2d_to_3d_and_prealign_weighted_multiview import apply_sim3


REGIONS = {
    "left_eye": [33, 133, 160, 159, 158, 157, 173, 246, 7, 163, 144, 145, 153, 154, 155],
    "right_eye": [263, 362, 387, 386, 385, 384, 398, 466, 249, 390, 373, 374, 380, 381, 382],
    "left_brow": [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
    "right_brow": [336, 296, 334, 293, 300, 285, 295, 282, 283, 276],
    "nose": [1, 2, 4, 5, 6, 19, 94, 98, 168, 195, 197, 236, 327, 456],
    "outer_mouth": [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291],
    "inner_mouth": [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308],
    "stable_cheek": [50, 101, 118, 119, 120, 187, 205, 206, 207, 280, 330, 347, 348, 349, 411, 425, 426, 427],
    "central_forehead": [8, 9, 10, 151, 108, 109, 337, 338],
    "face_oval": [
        10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
        400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
        54, 103, 67, 109,
    ],
}


COMPOSITES = {
    "brows_eyes": ["left_eye", "right_eye", "left_brow", "right_brow"],
    "mouth": ["outer_mouth", "inner_mouth"],
    "central_face": ["left_eye", "right_eye", "left_brow", "right_brow", "nose", "outer_mouth", "inner_mouth"],
    "fit_stable_face": [
        "left_eye",
        "right_eye",
        "left_brow",
        "right_brow",
        "nose",
        "outer_mouth",
        "inner_mouth",
        "stable_cheek",
        "central_forehead",
    ],
}


def load_xyz(path):
    return np.loadtxt(path, dtype=np.float64)


def unique_valid(indices, n):
    used = set()
    out = []
    for idx in indices:
        idx = int(idx)
        if 0 <= idx < n and idx not in used:
            used.add(idx)
            out.append(idx)
    return np.asarray(out, dtype=np.int32)


def stats(values):
    values = np.asarray(values, dtype=np.float64)
    if values.size == 0:
        return {"n": 0, "mean": None, "median": None, "p90": None, "p95": None, "max": None}
    return {
        "n": int(values.size),
        "mean": float(np.mean(values)),
        "median": float(np.median(values)),
        "p90": float(np.percentile(values, 90)),
        "p95": float(np.percentile(values, 95)),
        "max": float(np.max(values)),
    }


def format_value(value):
    if value is None:
        return ""
    if isinstance(value, int):
        return str(value)
    return f"{value:.4f}"


def region_indices(name, n):
    if name in REGIONS:
        return unique_valid(REGIONS[name], n)
    names = COMPOSITES[name]
    indices = []
    for part in names:
        indices.extend(REGIONS[part])
    return unique_valid(indices, n)


def write_png_table(rows, out_png):
    try:
        import matplotlib.pyplot as plt
    except Exception:
        return False

    headers = ["region", "n", "mean", "median", "p90", "p95", "max"]
    cell_text = [[row[h] if h == "region" else format_value(row[h]) for h in headers] for row in rows]
    fig_h = max(2.8, 0.38 * len(rows) + 0.8)
    fig, ax = plt.subplots(figsize=(9.5, fig_h))
    ax.axis("off")
    table = ax.table(cellText=cell_text, colLabels=headers, loc="center", cellLoc="center")
    table.auto_set_font_size(False)
    table.set_fontsize(9)
    table.scale(1, 1.25)
    for (r, c), cell in table.get_celld().items():
        if r == 0:
            cell.set_text_props(weight="bold")
            cell.set_facecolor("#dbeafe")
        elif rows[r - 1]["p90"] is not None and rows[r - 1]["p90"] > 12:
            cell.set_facecolor("#fee2e2")
        elif rows[r - 1]["p90"] is not None and rows[r - 1]["p90"] < 8:
            cell.set_facecolor("#dcfce7")
    fig.tight_layout()
    fig.savefig(out_png, dpi=180)
    plt.close(fig)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--summary", required=True)
    ap.add_argument("--out_dir", required=True)
    args = ap.parse_args()

    summary_path = Path(args.summary)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    summary = json.loads(summary_path.read_text(encoding="utf-8"))
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
    for name in names:
        idx = region_indices(name, n)
        idx = idx[valid[idx]]
        row = {"region": name}
        row.update(stats(err[idx]))
        rows.append(row)

    json_path = out_dir / "region_error_summary.json"
    csv_path = out_dir / "region_error_summary.csv"
    png_path = out_dir / "region_error_summary.png"

    json_path.write_text(json.dumps({"summary": str(summary_path), "regions": rows}, indent=2), encoding="utf-8")
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["region", "n", "mean", "median", "p90", "p95", "max"])
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
    wrote_png = write_png_table(rows, png_path)

    print(f"wrote {json_path}")
    print(f"wrote {csv_path}")
    if wrote_png:
        print(f"wrote {png_path}")
    for row in rows:
        print(
            f"{row['region']}: n={row['n']} mean={format_value(row['mean'])} "
            f"median={format_value(row['median'])} p90={format_value(row['p90'])} "
            f"p95={format_value(row['p95'])} max={format_value(row['max'])}"
        )


if __name__ == "__main__":
    main()
