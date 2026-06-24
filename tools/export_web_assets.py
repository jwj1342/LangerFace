"""导出网页端所需资产到 web/assets/（assets/ 是唯一权威源，web/assets/ 全部派生，见 #47）：
  - triangles.json   标准网格三角拓扑 (898,3)
  - topology_mediapipe_468.json   带 topologyId 的标准网格合同
  - canonical_vertices.json   标准 3D 顶点（3D Beta 兜底几何）
  - atlas_rstl.json / atlas_langer.json   线图谱（直接复用）
  - face_landmarker.task / hand_landmarker.task   MediaPipe 模型（浏览器本地加载）

  python3 tools/export_web_assets.py

缺任一源资产（含手部模型）会显式 [warn]，不再静默漏掉。
"""
from __future__ import annotations

import json
import os
import shutil

from langerface.config import (
    ATLAS_PATHS,
    CANONICAL_OBJ,
    FACE_LANDMARKER_TASK,
    HAND_LANDMARKER_TASK,
    TOPOLOGY_ID,
    TOPOLOGY_VERSION,
)
from langerface.geometry import CanonicalFaceModel

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_ASSETS = os.path.join(REPO, "web", "assets")


def main():
    os.makedirs(WEB_ASSETS, exist_ok=True)
    c = CanonicalFaceModel.from_obj(CANONICAL_OBJ)

    with open(os.path.join(WEB_ASSETS, "triangles.json"), "w") as f:
        json.dump(c.triangles.astype(int).tolist(), f)
    print(f"[ok] triangles.json  {c.triangles.shape}")

    topology = {
        "topologyId": TOPOLOGY_ID,
        "topologyVersion": TOPOLOGY_VERSION,
        "vertexCount": int(c.vertices.shape[0]),
        "triangleCount": int(c.triangles.shape[0]),
        "triangles": c.triangles.astype(int).tolist(),
    }
    with open(os.path.join(WEB_ASSETS, "topology_mediapipe_468.json"), "w") as f:
        json.dump(topology, f)
    print(f"[ok] topology_mediapipe_468.json  {TOPOLOGY_ID}")

    # 标准 3D 顶点（y 上），3D Beta 的兜底几何
    import numpy as np
    cv = c.vertices.copy()
    cv -= cv.mean(0)
    with open(os.path.join(WEB_ASSETS, "canonical_vertices.json"), "w") as f:
        json.dump(np.round(cv, 4).tolist(), f)
    print(f"[ok] canonical_vertices.json  {cv.shape}")

    for system, path in ATLAS_PATHS.items():
        dst = os.path.join(WEB_ASSETS, os.path.basename(path))
        shutil.copyfile(path, dst)
        print(f"[ok] {os.path.basename(path)}")

    # 模型文件：从 assets/ 派生到 web/assets/，任一缺失显式 [warn]（不再静默漏掉手部模型）。
    for src, name, feature in (
        (FACE_LANDMARKER_TASK, "face_landmarker.task", "人脸关键点检测"),
        (HAND_LANDMARKER_TASK, "hand_landmarker.task", "手部遮挡"),
    ):
        if os.path.exists(src):
            shutil.copyfile(src, os.path.join(WEB_ASSETS, name))
            print(f"[ok] {name}")
        else:
            print(f"[warn] 缺 {name}（assets/ 内未找到），请先 download_assets.py —— "
                  f"否则浏览器端「{feature}」不可用")


if __name__ == "__main__":
    main()
