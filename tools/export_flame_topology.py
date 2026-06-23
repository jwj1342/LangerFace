"""把 FLAME neutral 头模（OBJ）导出为 web 端可消费的拓扑契约
web/assets/topology_flame_2023.json（与 topology_mediapipe_468.json 同 schema）。

License 边界（重要）：FLAME 模型须在 https://flame.is.tue.mpg.de 注册并接受 license 后本地下载；
本仓库**不提交任何 FLAME 衍生资产**（assets/flame/ 已 gitignore）。流程：
  1. 注册下载 FLAME，导出 neutral 头模为 OBJ；
  2. 放到 assets/flame/flame_neutral.obj；
  3. 运行 `python tools/export_flame_topology.py` 生成仅含三角拓扑 + 元数据的 topology JSON。
生成的 topology_flame_2023.json 只含 triangles/计数/id，但仍建议视作 FLAME 衍生物——
是否提交到仓库由 license 复核后决定（默认不提交，运行时按需生成 / 本地加载）。
"""
import json
import os
import sys

from langerface.config.constants import TOPOLOGY_ID_FLAME, TOPOLOGY_VERSION_FLAME
from langerface.geometry.topology import topology_from_obj

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, "assets", "flame", "flame_neutral.obj")
OUT = os.path.join(REPO, "web", "assets", "topology_flame_2023.json")


def main() -> int:
    if not os.path.exists(SRC):
        print(f"[skip] 未找到 {SRC}")
        print("       请先在 https://flame.is.tue.mpg.de 注册下载 FLAME，导出 neutral 头模为 OBJ，")
        print("       放到 assets/flame/flame_neutral.obj，再运行本脚本。")
        return 0
    with open(SRC, encoding="utf-8") as f:
        topo = topology_from_obj(f.read(), TOPOLOGY_ID_FLAME, TOPOLOGY_VERSION_FLAME)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(topo, f)
    print(f"[ok] {OUT}  {topo['topologyId']}  verts={topo['vertexCount']} tris={topo['triangleCount']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
