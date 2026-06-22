"""图谱数据完整性。"""
import os

import numpy as np
import pytest

from langerlines.atlas import Atlas, AtlasLine
from langerlines.config import ATLAS_PATHS, CANONICAL_OBJ


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
    assert len(b.lines) == 1 and b.lines[0].points.shape == (2, 3)


@pytest.mark.skipif(not os.path.exists(CANONICAL_OBJ), reason="需先下载 canonical_face_model.obj")
def test_generated_atlases_valid():
    from langerlines.canonical import CanonicalFaceModel
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    n_tri = len(canonical.triangles)
    for system, path in ATLAS_PATHS.items():
        if not os.path.exists(path):
            pytest.skip(f"{system} 图谱未生成（先跑 build_initial_atlas.py）")
        atlas = Atlas.load(path)
        assert atlas.validate(n_tri) == [], f"{system} 图谱校验未通过"
