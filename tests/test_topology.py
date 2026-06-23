"""拓扑契约导出（langerface.geometry.topology）：OBJ → topology JSON schema。

不依赖任何 FLAME 资产——用一个合成的小立方体 OBJ（非 FLAME 衍生）验证解析 / 三角化 /
越界校验与契约 schema。FLAME 真模型的导出由 tools/export_flame_topology.py 在本地资产就位后执行。
"""
import pytest

from langerface.config import TOPOLOGY_ID_FLAME, TOPOLOGY_VERSION_FLAME
from langerface.geometry.topology import build_topology_contract, parse_obj_mesh, topology_from_obj

# 合成立方体：8 顶点、6 四边形面 → 扇形三角化为 12 三角面。
_CUBE_OBJ = """
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
f 1 2 3 4
f 5 6 7 8
f 1 2 6 5
f 2 3 7 6
f 3 4 8 7
f 4 1 5 8
""".strip()


def test_parse_obj_counts_and_triangulates():
    nverts, tris = parse_obj_mesh(_CUBE_OBJ)
    assert nverts == 8
    assert len(tris) == 12  # 6 quads → 12 tris（扇形三角化）
    assert all(len(t) == 3 for t in tris)
    assert max(max(t) for t in tris) == 7  # 0-based，最大索引 = 顶点数 - 1


def test_parse_obj_strips_face_attrs():
    nverts, tris = parse_obj_mesh("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1/1/1 2/2/2 3/3/3")
    assert nverts == 3 and tris == [[0, 1, 2]]


def test_topology_from_obj_schema():
    topo = topology_from_obj(_CUBE_OBJ, TOPOLOGY_ID_FLAME, TOPOLOGY_VERSION_FLAME)
    assert topo["topologyId"] == TOPOLOGY_ID_FLAME
    assert topo["topologyVersion"] == TOPOLOGY_VERSION_FLAME
    assert topo["vertexCount"] == 8
    assert topo["triangleCount"] == 12
    assert topo["triangles"][0] == [0, 1, 2]


def test_build_topology_rejects_empty():
    with pytest.raises(ValueError):
        build_topology_contract(TOPOLOGY_ID_FLAME, TOPOLOGY_VERSION_FLAME, 0, [])


def test_build_topology_rejects_out_of_range():
    with pytest.raises(ValueError):
        build_topology_contract(TOPOLOGY_ID_FLAME, TOPOLOGY_VERSION_FLAME, 3, [[0, 1, 5]])


def test_flame_pkl_reader_synthetic(tmp_path):
    """合成 plain-dict pkl（仅 v_template/f，不需 scipy）验证 FLAME pkl 读取路径。"""
    import pickle

    import numpy as np

    from langerface.geometry.topology import flame_topology_and_vertices_from_pkl

    verts = np.array([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], dtype=float)
    faces = np.array([[0, 1, 2], [0, 2, 3]], dtype=np.int64)
    p = tmp_path / "synthetic_flame.pkl"
    with open(p, "wb") as f:
        pickle.dump({"v_template": verts, "f": faces}, f)

    topo, vlist = flame_topology_and_vertices_from_pkl(
        str(p), TOPOLOGY_ID_FLAME, TOPOLOGY_VERSION_FLAME
    )
    assert topo["topologyId"] == TOPOLOGY_ID_FLAME
    assert topo["vertexCount"] == 4 and topo["triangleCount"] == 2
    assert len(vlist) == 4 and vlist[0] == [0.0, 0.0, 0.0]
