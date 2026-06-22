"""从多视角视频重建个性化 3D 人头（顶点），供 3D Beta 技术路线使用。

思路：对每一帧检测 478 关键点（取前 468，与标准网格拓扑一致），用相似变换(Umeyama)
把每帧网格刚性对齐到统一参考系（标准脸朝向），再对各顶点取**中位数**得到稳定的个性化中性脸。
中位数对表情/抖动/遮挡更鲁棒。线条图谱按重心坐标贴到该网格上即"贴到 3D 人头"。

  python3 tools/reconstruct_3d.py [video]   # 默认 local_media/IMG_3458.MOV -> web/assets/recon_demo.json
"""
from __future__ import annotations

import json
import os
import sys

import cv2
import numpy as np

from langerface.geometry import CanonicalFaceModel
from langerface.config import CANONICAL_OBJ, FACE_LANDMARKER_TASK
from langerface.detection import FaceLandmarkDetector

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL_MEDIA = os.path.join(REPO, "local_media")
OUT = os.path.join(REPO, "web", "assets", "recon_demo.json")
# 刚性锚点（随表情变化小）：眼角、鼻梁、面部轮廓极值等
RIGID = [33, 263, 133, 362, 168, 6, 195, 5, 4, 1, 10, 152, 234, 454, 127, 356]


def umeyama(S, T):
    """相似变换 (scale c, rot R, trans t) 使 c*R*S+t ≈ T。S,T: (K,3)。"""
    mS, mT = S.mean(0), T.mean(0)
    Sc, Tc = S - mS, T - mT
    cov = (Tc.T @ Sc) / len(S)
    U, D, Vt = np.linalg.svd(cov)
    d = np.sign(np.linalg.det(U @ Vt))
    W = np.diag([1, 1, d])
    R = U @ W @ Vt
    varS = (Sc ** 2).sum() / len(S)
    c = np.trace(np.diag(D) @ W) / varS
    t = mT - c * (R @ mS)
    return c, R, t


def main():
    video = sys.argv[1] if len(sys.argv) > 1 else os.path.join(LOCAL_MEDIA, "IMG_3458.MOV")
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    # 参考系：标准脸翻到关键点手性 (x右, y下, z入屏)
    ref = canonical.vertices.copy()
    ref[:, 1] *= -1
    ref[:, 2] *= -1
    ref_rigid = ref[RIGID]

    det = FaceLandmarkDetector(FACE_LANDMARKER_TASK, mode="video", num_faces=1)
    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    aligned = []
    yaws = []
    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % 2 == 0:  # 抽帧加速
            faces = det.detect(frame, timestamp_ms=int(idx * 1000 / fps))
            if faces:
                lm = faces[0].landmarks_px[:468]
                c, R, t = umeyama(lm[RIGID], ref_rigid)
                aligned.append((c * (R @ lm.T)).T + t)
                nose, cl, cr = lm[1], lm[234], lm[454]
                fw = abs(cr[0] - cl[0]) or 1
                yaws.append((nose[0] - (cl[0] + cr[0]) / 2) / fw)
        idx += 1
    cap.release()

    if len(aligned) < 5:
        print(f"[err] 检测到的帧太少 ({len(aligned)})，无法重建")
        return 1

    arr = np.stack(aligned)                 # (N, 468, 3) 参考系（屏幕手性: x右 y下 z入屏）
    verts_ref = np.median(arr, axis=0)      # 鲁棒中性脸
    verts_ref -= verts_ref.mean(0)          # 居中。保持屏幕手性，便于实时配准；查看时前端翻 y/z

    data = {
        "vertices": np.round(verts_ref, 4).tolist(),
        "frames": len(aligned),
        "yaw_min": round(float(np.min(yaws)), 3),
        "yaw_max": round(float(np.max(yaws)), 3),
        "source": os.path.basename(video),
    }
    with open(OUT, "w") as f:
        json.dump(data, f)
    print(f"[ok] 重建完成：{len(aligned)} 帧, yaw [{data['yaw_min']}, {data['yaw_max']}] -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
