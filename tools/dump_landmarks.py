"""把 Python 端在若干真实帧上的 关键点 + 映射结果 + 可见性 导出为 ground truth，
供 Node 对拍验证 JS 移植是否一致。

  python3 tools/dump_landmarks.py
"""
from __future__ import annotations

import json
import os
import sys

import cv2
import numpy as np

from langerface.lines import Atlas
from langerface.geometry import CanonicalFaceModel
from langerface.config import CANONICAL_OBJ, ATLAS_PATHS, FACE_LANDMARKER_TASK
from langerface.detection import FaceLandmarkDetector
from langerface.lines import map_atlas
from langerface.rendering import BackfaceCuller

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "web", "test", "expected.json")


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    tris = canonical.triangles
    culler = BackfaceCuller(tris)
    atlas = Atlas.load(ATLAS_PATHS["rstl"])
    det = FaceLandmarkDetector(FACE_LANDMARKER_TASK, mode="image", num_faces=1)

    cap = cv2.VideoCapture(os.path.join(REPO, "IMG_3458.MOV"))
    frames_out = []
    for idx in (50, 156, 219):
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            continue
        faces = det.detect(frame)
        if not faces:
            continue
        lm = faces[0].landmarks_px
        mapped = map_atlas(atlas, lm, tris)
        vis_tri = culler.visible_triangles(lm)
        lines = []
        for ml in mapped:
            pervis = vis_tri[ml.tris].astype(int).tolist()
            lines.append({
                "name": ml.name,
                "pts": np.round(ml.pts, 4).tolist(),
                "vis": pervis,
            })
        frames_out.append({"idx": idx, "landmarks": np.round(lm, 6).tolist(), "lines": lines})
        print(f"frame {idx}: {len(lines)} lines")

    cap.release()
    with open(OUT, "w") as f:
        json.dump({"system": "rstl", "frames": frames_out}, f)
    print(f"[ok] -> {OUT}")


if __name__ == "__main__":
    main()
