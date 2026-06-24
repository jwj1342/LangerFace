"""图谱数据完整性。"""
import os

import numpy as np
import pytest

from langerface.config import ATLAS_PATHS, TOPOLOGY_ID, TOPOLOGY_VERSION
from langerface.lines import Atlas, AtlasLine, atlas_line_from_points2d


def test_validate_catches_bad_index():
    bad = Atlas(system="rstl", lines=[
        AtlasLine("x", "r", np.array([[999, 0.3, 0.3], [999, 0.2, 0.2]], dtype=float)),
    ])
    issues = bad.validate(num_triangles=100)
    assert any("越界" in s for s in issues)


def test_validate_catches_short_line():
    short = Atlas(system="rstl", lines=[
        AtlasLine("x", "r", np.array([[0, 0.3, 0.3]], dtype=float)),
    ])
    issues = short.validate(num_triangles=100)
    assert any("点数" in s for s in issues)


def test_roundtrip(tmp_path):
    a = Atlas(system="rstl", lines=[
        AtlasLine("l0", "forehead", np.array([[0, 0.5, 0.3], [1, 0.2, 0.2]], dtype=float)),
    ], provenance="test", validated=True)
    p = tmp_path / "atlas.json"
    a.save(str(p))
    b = Atlas.load(str(p))
    assert b.system == "rstl" and b.validated is True
    assert b.topology_id == TOPOLOGY_ID and b.topology_version == TOPOLOGY_VERSION
    assert len(b.lines) == 1 and b.lines[0].points.shape == (2, 3)


def test_validate_catches_topology_mismatch():
    a = Atlas(system="rstl", topology_id="flame-2023", lines=[
        AtlasLine("l0", "forehead", np.array([[0, 0.5, 0.3], [1, 0.2, 0.2]], dtype=float)),
    ])
    issues = a.validate(num_triangles=100, expected_topology_id=TOPOLOGY_ID)
    assert any("拓扑" in s for s in issues)


def test_validate_catches_topology_version_mismatch():
    a = Atlas(system="rstl", topology_version="other", lines=[
        AtlasLine("l0", "forehead", np.array([[0, 0.5, 0.3], [1, 0.2, 0.2]], dtype=float)),
    ])
    issues = a.validate(num_triangles=100, expected_topology_version=TOPOLOGY_VERSION)
    assert any("拓扑版本" in s for s in issues)


def test_generated_atlases_valid(canonical):
    n_tri = len(canonical.triangles)
    for system, path in ATLAS_PATHS.items():
        if not os.path.exists(path):
            pytest.skip(f"{system} 图谱未生成（先跑 build_field_atlas.py）")
        atlas = Atlas.load(path)
        assert atlas.validate(
            n_tri,
            expected_topology_id=TOPOLOGY_ID,
            expected_topology_version=TOPOLOGY_VERSION,
        ) == [], f"{system} 图谱校验未通过"


def test_atlas_line_from_points2d_matches_locate(canonical):
    """辅助函数逐点结果应与 canonical.locate 完全一致，dtype/shape 固定。"""
    proj = canonical.project_front()
    # 直接取投影空间的若干顶点作为线点（已是 proj 坐标）。
    pts2d = proj[[0, 10, 50, 120, 200]]
    ln = atlas_line_from_points2d(canonical, "probe", "test", pts2d, proj=proj)
    assert isinstance(ln, AtlasLine)
    assert ln.name == "probe" and ln.region == "test"
    assert ln.points.shape == (len(pts2d), 3)
    assert ln.points.dtype == np.float64
    for i, p in enumerate(pts2d):
        tri, bary = canonical.locate(p, proj=proj)
        assert ln.points[i, 0] == tri
        assert ln.points[i, 1] == bary[0]
        assert ln.points[i, 2] == bary[1]


def test_atlas_line_from_points2d_equals_manual_loop(canonical):
    """合成归一化线经 norm_to_proj + 辅助函数，应与重构前的手写循环逐字节相等。"""
    proj = canonical.project_front()
    t = np.linspace(0, 1, 12)
    norm_pts = np.column_stack([0.3 + 0.4 * t, 0.2 + 0.6 * t])
    world = canonical.norm_to_proj(norm_pts)

    # 重构前的手写循环（build_initial_atlas / annotate_atlas 旧逻辑）。
    expected = np.zeros((len(world), 3), dtype=np.float64)
    for i, p in enumerate(world):
        tri, bary = canonical.locate(p, proj=proj)
        expected[i] = [tri, bary[0], bary[1]]

    ln = atlas_line_from_points2d(canonical, "x", "r", world, proj=proj)
    assert ln.points.dtype == expected.dtype
    assert np.array_equal(ln.points, expected)
    assert ln.points.tobytes() == expected.tobytes()
