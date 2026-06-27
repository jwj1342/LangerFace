"""把 Python 端在若干真实帧上的 关键点 + 映射结果 + 可见性 导出为 ground truth，
供 Node 对拍验证 JS 移植是否一致。

两条入口，职责分离（SoC）：

  * ``main()``      —— 关键点的**来源**：用 mediapipe/cv2 从私有视频抽帧检测关键点。
                       需要本机有 mediapipe、cv2 及私有素材，CI 不跑。
  * ``regen()``     —— **纯**重算路径：只吃 expected.json 里**已嵌入**的关键点 + 图谱 + 三角拓扑，
                       重算每帧 lines[].pts / lines[].vis 以及 One-Euro 夹具。无 mediapipe / 无 cv2 /
                       无私有素材，CI 与本地都可一键复现金标（见 docs/CROSS_LANG_PARITY.md）。

更新金标（生产数学合法变更后）：

  python3 tools/dump_landmarks.py            # 仅当需要换帧/换关键点来源时（需私有素材）
  python3 tools/dump_landmarks.py --regen    # 常规：从已嵌入关键点重算 pts/vis/oneEuro
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np

from langerface.config import ATLAS_PATHS, CANONICAL_OBJ
from langerface.config.constants import (
    ONEEURO_BETA,
    ONEEURO_DCUTOFF,
    ONEEURO_MIN_CUTOFF,
)
from langerface.detection import LandmarkSmoother
from langerface.geometry import CanonicalFaceModel
from langerface.lines import Atlas, map_atlas
from langerface.rendering import BackfaceCuller

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL_MEDIA = os.path.join(REPO, "local_media")
OUT = os.path.join(REPO, "web", "test", "expected.json")

# 帧索引（main() 抽帧用）
FRAME_INDICES = (50, 156, 219)
PTS_DECIMALS = 4   # lines[].pts 的舍入位数（金标契约，JS/Py/golden 三方一致）
LM_DECIMALS = 6    # 嵌入关键点的舍入位数


# ── 纯重算路径（无 mediapipe / 无 cv2 / 无私有素材）────────────────────────────
def compute_frame_lines(atlas: Atlas, landmarks_px, triangles, culler: BackfaceCuller):
    """给定一帧关键点，重算 lines[].pts（np.round 到 PTS_DECIMALS）与 lines[].vis。

    vis 经 map_atlas + BackfaceCuller.visible_triangles，**含 #38 口裂三角面排除**，
    与生产渲染完全一致。返回 [{name, pts, vis}, ...]。
    """
    lm = np.asarray(landmarks_px, dtype=np.float64)
    mapped = map_atlas(atlas, lm, triangles)
    vis_tri = culler.visible_triangles(lm)
    lines = []
    for ml in mapped:
        lines.append({
            "name": ml.name,
            "pts": np.round(ml.pts, PTS_DECIMALS).tolist(),
            "vis": vis_tri[ml.tris].astype(int).tolist(),
        })
    return lines


def build_one_euro_fixture():
    """确定性 One-Euro 跨语言夹具：固定时间戳 + 带抖动的小轨迹，及其 Python 端期望平滑输出。

    用项目 One-Euro 常量（ONEEURO_*）。Web TypeScript OneEuro 用同一组常量 → 逐位一致。
    输入/输出都进 expected.json，由 Python 与 .ts 双方断言。
    """
    # 两个点 (N=2)、三分量，沿时间做带抖动的平移轨迹（30fps 等间隔时间戳）
    base = np.array([[100.0, 200.0, 0.0], [300.0, 50.0, 5.0]])
    jitter = np.array([
        [0.0, 0.0, 0.0], [1.3, -0.8, 0.2], [-0.7, 1.1, -0.3], [2.1, 0.4, 0.5],
        [-1.5, -1.2, 0.1], [0.9, 1.7, -0.4], [-0.3, -0.6, 0.3], [1.8, 0.2, -0.2],
        [-2.0, 1.0, 0.4], [0.5, -1.4, -0.1], [1.1, 0.7, 0.2], [-0.9, -0.5, -0.3],
    ])
    drift = np.array([[1.0, -0.5, 0.05], [-0.8, 0.6, -0.05]])
    inputs = []
    times = []
    for i in range(jitter.shape[0]):
        frame = base + drift * i + jitter[i]
        inputs.append(np.round(frame, LM_DECIMALS).tolist())
        times.append(round(i / 30.0, 6))

    sm = LandmarkSmoother(
        min_cutoff=ONEEURO_MIN_CUTOFF, beta=ONEEURO_BETA, dcutoff=ONEEURO_DCUTOFF,
    )
    outputs = []
    for frame, t in zip(inputs, times):
        out = sm.filter(np.asarray(frame, dtype=np.float64), t)
        outputs.append(np.asarray(out, dtype=np.float64).tolist())

    return {
        "minCutoff": ONEEURO_MIN_CUTOFF,
        "beta": ONEEURO_BETA,
        "dcutoff": ONEEURO_DCUTOFF,
        "times": times,
        "inputs": inputs,
        "expected": outputs,
    }


def regen(path: str = OUT):
    """从 expected.json 已嵌入的关键点重算 lines[].pts/.vis 与 One-Euro 夹具，并写回。

    纯路径：不触碰 mediapipe / cv2 / 私有素材。生产数学变更后用它一键刷新金标。
    """
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    tris = canonical.triangles
    culler = BackfaceCuller(tris)
    atlas = Atlas.load(ATLAS_PATHS["rstl"])

    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    for fr in data["frames"]:
        fr["lines"] = compute_frame_lines(atlas, fr["landmarks"], tris, culler)
    data["oneEuro"] = build_one_euro_fixture()

    with open(path, "w") as f:
        json.dump(data, f)
    print(f"[ok] regen -> {path} ({len(data['frames'])} frames)")


# ── 关键点来源路径（需 mediapipe + cv2 + 私有素材，CI 不跑）────────────────────
def main():
    import cv2  # noqa: PLC0415 —— 仅来源路径需要，纯重算路径不应被 cv2 缺失阻断

    from langerface.config import FACE_LANDMARKER_TASK  # noqa: PLC0415
    from langerface.detection import FaceLandmarkDetector  # noqa: PLC0415

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    tris = canonical.triangles
    culler = BackfaceCuller(tris)
    atlas = Atlas.load(ATLAS_PATHS["rstl"])
    det = FaceLandmarkDetector(FACE_LANDMARKER_TASK, mode="image", num_faces=1)

    cap = cv2.VideoCapture(os.path.join(LOCAL_MEDIA, "IMG_3458.MOV"))
    frames_out = []
    for idx in FRAME_INDICES:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            continue
        faces = det.detect(frame)
        if not faces:
            continue
        lm = faces[0].landmarks_px
        lines = compute_frame_lines(atlas, lm, tris, culler)
        frames_out.append({
            "idx": idx,
            "landmarks": np.round(lm, LM_DECIMALS).tolist(),
            "lines": lines,
        })
        print(f"frame {idx}: {len(lines)} lines")

    cap.release()
    out = {"system": "rstl", "frames": frames_out, "oneEuro": build_one_euro_fixture()}
    with open(OUT, "w") as f:
        json.dump(out, f)
    print(f"[ok] -> {OUT}")


if __name__ == "__main__":
    if "--regen" in sys.argv[1:]:
        regen()
    else:
        main()
