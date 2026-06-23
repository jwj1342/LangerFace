"""通用拓扑契约：把任意 OBJ 头模解析为 web 端可消费的 topology JSON
（与 web/assets/topology_mediapipe_468.json 同 schema）。

用于 FLAME 等「非 MediaPipe」拓扑的导出。与 lines/atlas.py 的 topologyId 守卫（#65）配套：
每套拓扑有稳定的 topologyId/topologyVersion，图谱按之打标，杜绝跨拓扑误用。

注：OBJ 解析与 geometry/canonical.py::from_obj 有重叠，后续可统一（参 #50）。这里只取
顶点计数 + 三角面索引（多边形面做扇形三角化），不解析 UV/法向——拓扑契约只需 triangles。
"""
from __future__ import annotations


def parse_obj_mesh(text: str) -> tuple[int, list[list[int]]]:
    """从 OBJ 文本解析 (顶点数, 三角面列表)。f 行索引 1-based、丢弃 /vt/vn；多边形面扇形三角化。"""
    nverts = 0
    tris: list[list[int]] = []
    for line in text.splitlines():
        if line.startswith("v "):
            nverts += 1
        elif line.startswith("f "):
            idx = [int(tok.split("/")[0]) - 1 for tok in line.split()[1:]]
            for i in range(1, len(idx) - 1):
                tris.append([idx[0], idx[i], idx[i + 1]])
    return nverts, tris


def build_topology_contract(
    topology_id: str,
    topology_version: str,
    nverts: int,
    triangles: list[list[int]],
) -> dict:
    """组装拓扑契约 dict；校验非空 + 三角面索引不越界。"""
    if nverts <= 0 or not triangles:
        raise ValueError("拓扑为空：未解析到顶点或三角面")
    max_idx = max(max(t) for t in triangles)
    if max_idx >= nverts:
        raise ValueError(f"三角面索引越界（max={max_idx} >= verts={nverts}），OBJ 解析异常")
    return {
        "topologyId": topology_id,
        "topologyVersion": topology_version,
        "vertexCount": int(nverts),
        "triangleCount": len(triangles),
        "triangles": triangles,
    }


def topology_from_obj(text: str, topology_id: str, topology_version: str) -> dict:
    """OBJ 文本 → 拓扑契约 dict。"""
    nverts, tris = parse_obj_mesh(text)
    return build_topology_contract(topology_id, topology_version, nverts, tris)
