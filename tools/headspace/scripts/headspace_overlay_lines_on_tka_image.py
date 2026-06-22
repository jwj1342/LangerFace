import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def load_tka_json(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    M = np.asarray(data["M"], dtype=np.float64)
    C = np.array([data["X"], data["Y"], data["Z"]], dtype=np.float64)
    fx = data["f"] / data["x"]
    fy = data["f"] / data["y"]
    cx = data["a"]
    cy = data["b"]
    return M, C, fx, fy, cx, cy


def project_tka(points, tka_json):
    M, C, fx, fy, cx, cy = load_tka_json(tka_json)
    P = np.asarray(points, dtype=np.float64)
    Pc = (M @ (P - C.reshape(1, 3)).T).T
    z = Pc[:, 2]
    uv = np.full((P.shape[0], 2), np.nan, dtype=np.float64)
    good = np.abs(z) > 1e-9
    uv[good, 0] = cx + fx * Pc[good, 0] / z[good]
    uv[good, 1] = cy + fy * Pc[good, 1] / z[good]
    return uv, z


def load_xyz(path):
    pts = []
    for line in Path(path).read_text(encoding="utf-8", errors="ignore").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        parts = line.split()
        if len(parts) >= 3:
            pts.append([float(parts[0]), float(parts[1]), float(parts[2])])
    return np.asarray(pts, dtype=np.float64)


def draw_projected_polyline(img, uv, color, thickness):
    h, w = img.shape[:2]
    finite = np.isfinite(uv).all(axis=1)
    inside = finite & (uv[:, 0] >= 0) & (uv[:, 0] < w) & (uv[:, 1] >= 0) & (uv[:, 1] < h)
    if inside.sum() < 2:
        return 0
    pts = uv[inside].round().astype(np.int32).reshape(-1, 1, 2)
    cv2.polylines(img, [pts], isClosed=False, color=color, thickness=thickness, lineType=cv2.LINE_AA)
    return int(inside.sum())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--tka_json", required=True)
    ap.add_argument("--txt_dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--color", default="0,0,255")
    ap.add_argument("--thickness", type=int, default=3)
    args = ap.parse_args()

    img = cv2.imread(args.image, cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError(f"Could not read image: {args.image}")
    color = tuple(int(x) for x in args.color.split(","))
    total_lines = 0
    visible_lines = 0
    visible_points = 0
    for path in sorted(Path(args.txt_dir).glob("*.txt")):
        pts = load_xyz(path)
        if pts.shape[0] < 2:
            continue
        total_lines += 1
        uv, z = project_tka(pts, args.tka_json)
        # Keep projected points in front of the camera according to the same convention used in fusion.
        uv[z <= 1e-9] = np.nan
        n = draw_projected_polyline(img, uv, color, args.thickness)
        if n >= 2:
            visible_lines += 1
            visible_points += n

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), img)
    summary = {
        "total_lines": total_lines,
        "visible_lines": visible_lines,
        "visible_points": visible_points,
        "image": args.image,
        "tka_json": args.tka_json,
        "txt_dir": args.txt_dir,
        "out": str(out),
    }
    out.with_suffix(".json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
