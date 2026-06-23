"""导出网页端所需资产到 web/assets/：
  - triangles.json   标准网格三角拓扑 (898,3)
  - topology_mediapipe_468.json   带 topologyId 的标准网格合同
  - atlas_rstl.json / atlas_langer.json   线图谱（直接复用）
  - face_landmarker.task   MediaPipe 模型（浏览器本地加载）

  python3 tools/export_web_assets.py
"""
from __future__ import annotations

import json
import os
import shutil

from langerface.config import (
    ATLAS_PATHS,
    CANONICAL_OBJ,
    FACE_LANDMARKER_TASK,
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

    if os.path.exists(FACE_LANDMARKER_TASK):
        shutil.copyfile(FACE_LANDMARKER_TASK, os.path.join(WEB_ASSETS, "face_landmarker.task"))
        print("[ok] face_landmarker.task")
    else:
        print("[warn] 缺 face_landmarker.task，请先 download_assets.py")


if __name__ == "__main__":
    main()
