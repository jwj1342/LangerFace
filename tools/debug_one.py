"""单帧高清调试：叠加线 + 人脸轮廓边界，裁到脸部区域，便于判断线是否越界。

  python3 tools/debug_one.py local_media/IMG_3458.MOV 156 rstl
"""
import os
import sys

import cv2
import numpy as np

from langerface.config import Config
from langerface.detection import FaceLandmarkDetector
from langerface.pipeline import LinePipeline

# MediaPipe 面部轮廓（face oval）关键点索引
FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365,
             379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93,
             234, 127, 162, 21, 54, 103, 67, 109]

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL_MEDIA = os.path.join(REPO, "local_media")


def main():
    video = sys.argv[1] if len(sys.argv) > 1 else os.path.join(LOCAL_MEDIA, "IMG_3458.MOV")
    idx = int(sys.argv[2]) if len(sys.argv) > 2 else 156
    system = sys.argv[3] if len(sys.argv) > 3 else "rstl"

    cap = cv2.VideoCapture(video)
    cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
    ok, frame = cap.read()
    cap.release()
    assert ok

    cfg = Config(system=system)
    from langerface.config import LineStyle
    cfg.styles[system] = LineStyle(color=(255, 0, 255), thickness=3, alpha=1.0)  # 高对比品红，便于目检
    pipe = LinePipeline(cfg, mode="image")
    det = FaceLandmarkDetector(cfg.landmarker_task, mode="image", num_faces=1)

    faces = det.detect(frame)
    overlay = pipe.process(frame.copy())

    if faces:
        lm = faces[0].landmarks_px
        # 画面部轮廓（红）
        oval = lm[FACE_OVAL, :2].astype(np.int32)
        cv2.polylines(overlay, [oval], True, (0, 0, 255), 2, cv2.LINE_AA)
        # 裁剪到脸部 bbox + 边距
        xs, ys = lm[:468, 0], lm[:468, 1]
        x0, x1 = int(xs.min()), int(xs.max())
        y0, y1 = int(ys.min()), int(ys.max())
        pad = int(0.25 * (x1 - x0))
        x0 = max(0, x0 - pad); y0 = max(0, y0 - pad)
        x1 = min(frame.shape[1], x1 + pad); y1 = min(frame.shape[0], y1 + pad)
        crop = overlay[y0:y1, x0:x1]
    else:
        crop = overlay

    out = f"debug_frames/one_{system}_{idx:04d}.png"
    cv2.imwrite(out, crop)
    print(f"saved {out}  shape={crop.shape}")


if __name__ == "__main__":
    main()
