"""抽取若干帧跑图像管线，保存 原图|关键点|叠加 三联图，供人工目检。

  python3 tools/inspect_frames.py IMG_3458.MOV
"""
from __future__ import annotations

import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from langerlines.config import Config             # noqa: E402
from langerlines.detector import FaceLandmarkDetector  # noqa: E402
from langerlines.pipeline import LinePipeline     # noqa: E402


def main():
    video = sys.argv[1] if len(sys.argv) > 1 else "IMG_3458.MOV"
    outdir = "debug_frames"
    os.makedirs(outdir, exist_ok=True)

    cap = cv2.VideoCapture(video)
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fracs = [0.1, 0.3, 0.5, 0.7, 0.9]

    cfg = Config(system="rstl")
    pipe = LinePipeline(cfg, mode="image")
    det = FaceLandmarkDetector(cfg.landmarker_task, mode="image", num_faces=1)

    for f in fracs:
        idx = int(f * n)
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            print(f"frame {idx}: read fail")
            continue

        faces = det.detect(frame)
        kp = frame.copy()
        if faces:
            for p in faces[0].landmarks_px[:468]:
                cv2.circle(kp, (int(p[0]), int(p[1])), 1, (0, 255, 0), -1)
        overlay = pipe.process(frame.copy())

        h, w = frame.shape[:2]
        scale = 540 / w
        trio = np.hstack([cv2.resize(frame, None, fx=scale, fy=scale),
                          cv2.resize(kp, None, fx=scale, fy=scale),
                          cv2.resize(overlay, None, fx=scale, fy=scale)])
        path = os.path.join(outdir, f"frame_{idx:04d}.png")
        cv2.imwrite(path, trio)
        print(f"frame {idx}: faces={len(faces)} -> {path}")

    cap.release()


if __name__ == "__main__":
    main()
