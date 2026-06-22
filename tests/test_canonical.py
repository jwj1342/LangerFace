"""标准脸模型解析与点定位（需 canonical_face_model.obj）。"""
import os

import numpy as np
import pytest

from langerlines.config import CANONICAL_OBJ

pytestmark = pytest.mark.skipif(
    not os.path.exists(CANONICAL_OBJ), reason="需先下载 canonical_face_model.obj"
)


@pytest.fixture(scope="module")
def canonical():
    from langerlines.canonical import CanonicalFaceModel
    return CanonicalFaceModel.from_obj(CANONICAL_OBJ)


def test_vertex_count(canonical):
    assert canonical.vertices.shape == (468, 3)


def test_triangles_valid(canonical):
    tris = canonical.triangles
    assert tris.ndim == 2 and tris.shape[1] == 3
    assert tris.min() >= 0 and tris.max() < 468


def test_locate_reconstructs_point(canonical):
    proj = canonical.project_front()
    # 取若干三角面的质心，定位后用重心坐标重建应回到原点附近
    for ti in (0, 100, 500, len(canonical.triangles) - 1):
        a, b, c = proj[canonical.triangles[ti]]
        centroid = (a + b + c) / 3.0
        tri, bary = canonical.locate(centroid, proj=proj)
        v = canonical.triangles[tri]
        recon = bary[0] * proj[v[0]] + bary[1] * proj[v[1]] + bary[2] * proj[v[2]]
        assert np.linalg.norm(recon - centroid) < 1.0


def test_face_frame_anchors(canonical):
    origin, size = canonical.face_frame()
    assert size[0] > 0 and size[1] > 0
