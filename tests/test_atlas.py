"""图谱数据完整性。"""
import os

import numpy as np
import pytest

from langerface.config import ATLAS_PATHS, TOPOLOGY_ID, TOPOLOGY_VERSION
from langerface.lines import Atlas, AtlasLine


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
