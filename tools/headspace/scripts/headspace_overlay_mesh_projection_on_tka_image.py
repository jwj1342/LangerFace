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


def project_tka(points, tka_json):
    M, C, fx, fy, cx, cy = load_tka_json(tka_json)
    P = np.asarray(points, dtype=np.float64)
    Pc = (M @ (P - C.reshape(1, 3)).T).T
    z = Pc[:, 2]
    uv = np.full((P.shape[0], 2), np.nan, dtype=np.float64)
    good = z > 1e-9
    uv[good, 0] = cx + fx * Pc[good, 0] / z[good]
    uv[good, 1] = cy + fy * Pc[good, 1] / z[good]
    return uv, z


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--tka_json", required=True)
    ap.add_argument("--obj", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--max_points", type=int, default=35000)
    ap.add_argument("--point_radius", type=int, default=1)
    ap.add_argument("--color", default="0,255,0")
    ap.add_argument("--alpha", type=float, default=0.65)
    args = ap.parse_args()

    img = cv2.imread(args.image, cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError(f"Could not read image: {args.image}")

    mesh = trimesh.load(args.obj, process=False)
    if isinstance(mesh, trimesh.Scene):
        mesh = trimesh.util.concatenate(tuple(mesh.geometry.values()))
    verts = np.asarray(mesh.vertices, dtype=np.float64)

    if verts.shape[0] > args.max_points:
        rng = np.random.default_rng(1234)
        idx = rng.choice(verts.shape[0], size=args.max_points, replace=False)
        verts = verts[idx]

    uv, z = project_tka(verts, args.tka_json)
    h, w = img.shape[:2]
    finite = np.isfinite(uv).all(axis=1)
    inside = finite & (z > 1e-9) & (uv[:, 0] >= 0) & (uv[:, 0] < w) & (uv[:, 1] >= 0) & (uv[:, 1] < h)

    overlay = img.copy()
    color = tuple(int(x) for x in args.color.split(","))
    pts = uv[inside].round().astype(np.int32)
    for x, y in pts:
        cv2.circle(overlay, (int(x), int(y)), args.point_radius, color, -1, lineType=cv2.LINE_AA)
    out_img = cv2.addWeighted(overlay, args.alpha, img, 1.0 - args.alpha, 0)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), out_img)

    summary = {
        "image": args.image,
        "tka_json": args.tka_json,
        "obj": args.obj,
        "out": str(out),
        "sampled_vertices": int(verts.shape[0]),
        "visible_vertices": int(inside.sum()),
        "visible_fraction": float(inside.mean()) if len(inside) else 0.0,
    }
    out.with_suffix(".json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
