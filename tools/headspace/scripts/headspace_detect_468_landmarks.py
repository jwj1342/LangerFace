import argparse
import csv
import json
import re
from pathlib import Path

import cv2
import numpy as np


def parse_subjects(text):
    out = []
    for part in re.split(r"[\s,]+", str(text).strip()):
        if part:
            out.append(int(part))
    return out


class FaceLandmarker:
    def __init__(self, task_path):
        import mediapipe as mp
        from mediapipe.tasks import python
        from mediapipe.tasks.python import vision

        self.mp = mp
        base_options = python.BaseOptions(model_asset_path=str(task_path))
        options = vision.FaceLandmarkerOptions(
            base_options=base_options,
            running_mode=vision.RunningMode.IMAGE,
            num_faces=1,
            output_face_blendshapes=False,
            output_facial_transformation_matrixes=False,
        )
        self.landmarker = vision.FaceLandmarker.create_from_options(options)

    def detect(self, img_bgr):
        h, w = img_bgr.shape[:2]
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        mp_image = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=img_rgb)
        result = self.landmarker.detect(mp_image)
        if result.face_landmarks is None or len(result.face_landmarks) == 0:
            return None
        lm = result.face_landmarks[0]
        return np.array([[p.x * w, p.y * h, p.z] for p in lm], dtype=np.float64)


def landmark_score(lmk_xyz, width, height):
    if lmk_xyz is None or lmk_xyz.ndim != 2 or lmk_xyz.shape[0] < 468:
        return 0.0, {"reason": "missing_or_too_few"}

    uv = lmk_xyz[:, :2]
    finite = np.isfinite(uv).all(axis=1)
    inside = (
        finite
        & (uv[:, 0] >= 0)
        & (uv[:, 0] < width)
        & (uv[:, 1] >= 0)
        & (uv[:, 1] < height)
    )
    inside_ratio = float(inside.mean())
    if inside_ratio < 0.80:
        return 0.0, {"inside": inside_ratio, "reason": "mostly_outside"}

    good = uv[finite]
    mn = good.min(axis=0)
    mx = good.max(axis=0)
    size = np.maximum(mx - mn, 1.0)
    center = 0.5 * (mn + mx)
    img_center = np.array([width * 0.5, height * 0.5], dtype=np.float64)
    center_dist = np.linalg.norm((center - img_center) / np.array([width, height], dtype=np.float64))
    area = float((size[0] * size[1]) / max(1.0, width * height))

    nose = uv[1]
    left_cheek = uv[234]
    right_cheek = uv[454]
    cheek_span = abs(float(right_cheek[0] - left_cheek[0])) + 1e-6
    cheek_sym = abs(abs(float(nose[0] - left_cheek[0])) - abs(float(right_cheek[0] - nose[0]))) / cheek_span

    left_eye = uv[[33, 133, 159, 145]].mean(axis=0)
    right_eye = uv[[263, 362, 386, 374]].mean(axis=0)
    eye_span = np.linalg.norm(right_eye - left_eye) + 1e-6
    roll = abs(float(right_eye[1] - left_eye[1])) / eye_span

    score = (
        np.sqrt(max(area, 0.0))
        * np.exp(-5.0 * cheek_sym)
        * np.exp(-2.5 * roll)
        * np.exp(-3.0 * center_dist)
        * inside_ratio
    )
    details = {
        "score": float(score),
        "area": area,
        "center_dist": float(center_dist),
        "cheek_sym": float(cheek_sym),
        "roll": float(roll),
        "inside": inside_ratio,
    }
    return float(score), details


def parse_tka(path):
    text = Path(path).read_text(errors="ignore")
    vals = {}
    m = re.search(r"%M\s+([^\n]+)\n([^\n]+)\n([^\n]+)", text)
    if m:
        rows = []
        for row in m.groups():
            rows.append([float(x) for x in row.split()])
        vals["M"] = rows
    for key in ["X", "Y", "Z", "f", "K", "K2", "S", "x", "y", "a", "b", "c"]:
        mm = re.search(rf"%{re.escape(key)}\s+([-+0-9.eE]+)", text)
        if mm:
            vals[key] = float(mm.group(1))
    mm = re.search(r"%is\s+(\d+)\s+(\d+)", text)
    if mm:
        vals["image_size"] = [int(mm.group(1)), int(mm.group(2))]
    return vals


def find_capture_dirs(png_tka_root, sid):
    subj = Path(png_tka_root) / "subjects" / f"{sid:05d}"
    if not subj.exists():
        return []
    return [p for p in sorted(subj.iterdir()) if p.is_dir()]


def resolve_online_assets(online_root, sid, capture_name):
    subj = Path(online_root) / "subjects" / f"{sid:05d}"
    obj = subj / f"{capture_name}.obj"
    mtl = subj / f"{capture_name}.mtl"
    tex = subj / f"{capture_name}.bmp"
    return {
        "subject_dir": str(subj),
        "obj": str(obj) if obj.exists() else "",
        "mtl": str(mtl) if mtl.exists() else "",
        "texture": str(tex) if tex.exists() else "",
    }


def draw_montage(records, out_path, max_views=6):
    thumbs = []
    for rec in sorted(records, key=lambda r: r["score"], reverse=True)[:max_views]:
        img = cv2.imread(rec["image_path"])
        if img is None:
            continue
        lmk = np.loadtxt(rec["landmark_path"], dtype=np.float64)
        for x, y in np.round(lmk[:, :2]).astype(np.int32):
            if 0 <= x < img.shape[1] and 0 <= y < img.shape[0]:
                cv2.circle(img, (int(x), int(y)), 2, (0, 255, 0), -1, cv2.LINE_AA)
        cv2.putText(
            img,
            f"{rec['view']} score={rec['score']:.3f}",
            (24, 48),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.0,
            (0, 0, 255),
            2,
            cv2.LINE_AA,
        )
        img = cv2.resize(img, (360, 472))
        thumbs.append(img)
    if thumbs:
        cv2.imwrite(str(out_path), np.hstack(thumbs))


def process_capture(detector, capture_dir, online_root, sid, out_root):
    capture_name = Path(capture_dir).name
    out_dir = Path(out_root) / f"{sid:05d}" / capture_name
    lmk_dir = out_dir / "mp468_2d"
    cam_dir = out_dir / "tka"
    lmk_dir.mkdir(parents=True, exist_ok=True)
    cam_dir.mkdir(parents=True, exist_ok=True)

    records = []
    for img_path in sorted(Path(capture_dir).glob("*.png")):
        view = img_path.stem
        tka_path = Path(capture_dir) / f"calib_{view}.tka"
        img = cv2.imread(str(img_path), cv2.IMREAD_COLOR)
        if img is None:
            continue
        lmk = detector.detect(img)
        score, details = landmark_score(lmk, img.shape[1], img.shape[0])
        status = "ok" if score > 0 else "no_detect"
        out_lmk = lmk_dir / f"{view}.txt"
        if lmk is not None:
            np.savetxt(out_lmk, lmk, fmt="%.8f")
        cam_json = cam_dir / f"{view}.json"
        if tka_path.exists():
            cam_json.write_text(json.dumps(parse_tka(tka_path), indent=2), encoding="utf-8")
        records.append(
            {
                "sid": sid,
                "capture": capture_name,
                "view": view,
                "status": status,
                "score": float(score),
                "num_landmarks": int(0 if lmk is None else lmk.shape[0]),
                "image_path": str(img_path),
                "tka_path": str(tka_path) if tka_path.exists() else "",
                "landmark_path": str(out_lmk) if lmk is not None else "",
                "camera_json": str(cam_json) if tka_path.exists() else "",
                **details,
            }
        )

    ok = [r for r in records if r["status"] == "ok"]
    if ok:
        draw_montage(ok, out_dir / "mp468_detected_montage.jpg")

    meta = {
        "sid": sid,
        "capture": capture_name,
        "assets": resolve_online_assets(online_root, sid, capture_name),
        "num_views": len(records),
        "num_ok": len(ok),
        "best_views": [
            {"view": r["view"], "score": r["score"], "num_landmarks": r["num_landmarks"]}
            for r in sorted(ok, key=lambda x: x["score"], reverse=True)[:6]
        ],
        "records": records,
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--png_tka_root", required=True)
    ap.add_argument("--online_root", required=True)
    ap.add_argument("--subjects", default="1")
    ap.add_argument("--max_captures", type=int, default=1)
    ap.add_argument("--mp_task", default="assets/face_landmarker.task")
    ap.add_argument("--out_root", required=True)
    args = ap.parse_args()

    detector = FaceLandmarker(args.mp_task)
    rows = []
    for sid in parse_subjects(args.subjects):
        captures = find_capture_dirs(args.png_tka_root, sid)[: args.max_captures]
        if not captures:
            rows.append({"sid": sid, "capture": "", "status": "missing_capture", "num_views": 0, "num_ok": 0})
            continue
        for capture in captures:
            try:
                meta = process_capture(detector, capture, args.online_root, sid, args.out_root)
                rows.append(
                    {
                        "sid": sid,
                        "capture": meta["capture"],
                        "status": "ok",
                        "num_views": meta["num_views"],
                        "num_ok": meta["num_ok"],
                        "best_score": max([v["score"] for v in meta["best_views"]], default=0.0),
                        "out_dir": str(Path(args.out_root) / f"{sid:05d}" / meta["capture"]),
                        "obj": meta["assets"]["obj"],
                    }
                )
            except Exception as exc:
                rows.append({"sid": sid, "capture": Path(capture).name, "status": "error", "error": repr(exc)})

    out_root = Path(args.out_root)
    out_root.mkdir(parents=True, exist_ok=True)
    summary_json = out_root / "coverage_summary.json"
    summary_json.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    summary_csv = out_root / "coverage_summary.csv"
    with summary_csv.open("w", newline="", encoding="utf-8") as f:
        fieldnames = sorted({k for row in rows for k in row.keys()})
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(json.dumps(rows, indent=2, ensure_ascii=False))
    print(f"[OK] summary: {summary_json}")
    print(f"[OK] csv: {summary_csv}")


if __name__ == "__main__":
    main()
