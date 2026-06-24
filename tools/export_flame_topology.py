"""把 FLAME neutral 头模导出为 web 端可消费的拓扑契约 + neutral 顶点。

优先读 `assets/flame/flame2023_Open.pkl`（FLAME 2023 Open，CC-BY-4.0），回退到
`assets/flame/flame_neutral.obj`。产出（均写入 web/assets/，**已 gitignore，不入库**）：
  - topology_flame_2023.json    拓扑契约（topologyId/version + 三角拓扑）
  - flame_neutral_vertices.json neutral 顶点（5023×3），供 3D 查看/标注渲染

License 边界（重要）：FLAME 模型须在 https://flame.is.tue.mpg.de 注册并接受 license 后本地下载；
本仓库**不提交任何 FLAME 衍生资产**（assets/flame/ 与上述 web 产物均 gitignore）。
运行需要 numpy；读真 pkl 还需 scipy（集群上 `module load scipy-stack`）。
"""
import json
import os
import sys

from langerface.config.constants import TOPOLOGY_ID_FLAME, TOPOLOGY_VERSION_FLAME
from langerface.geometry.topology import (
    flame_topology_and_vertices_from_pkl,
    topology_from_obj,
)

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FLAME_DIR = os.path.join(REPO, "assets", "flame")
PKL = os.path.join(FLAME_DIR, "flame2023_Open.pkl")
OBJ = os.path.join(FLAME_DIR, "flame_neutral.obj")
WEB = os.path.join(REPO, "web", "assets")
OUT_TOPO = os.path.join(WEB, "topology_flame_2023.json")
OUT_VERTS = os.path.join(WEB, "flame_neutral_vertices.json")


def main() -> int:
    if os.path.exists(PKL):
        topo, verts = flame_topology_and_vertices_from_pkl(
            PKL, TOPOLOGY_ID_FLAME, TOPOLOGY_VERSION_FLAME
        )
        with open(OUT_VERTS, "w", encoding="utf-8") as f:
            json.dump(verts, f)
        print(f"[ok] {OUT_VERTS}  verts={len(verts)}")
    elif os.path.exists(OBJ):
        with open(OBJ, encoding="utf-8") as f:
            topo = topology_from_obj(f.read(), TOPOLOGY_ID_FLAME, TOPOLOGY_VERSION_FLAME)
    else:
        print(f"[skip] 未找到 {PKL} 或 {OBJ}")
        print("       请先在 https://flame.is.tue.mpg.de 注册下载 FLAME 2023 Open，")
        print("       把 flame2023_Open.pkl 放到 assets/flame/，再运行本脚本。")
        return 0
    with open(OUT_TOPO, "w", encoding="utf-8") as f:
        json.dump(topo, f)
    print(f"[ok] {OUT_TOPO}  {topo['topologyId']} verts={topo['vertexCount']} tris={topo['triangleCount']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
