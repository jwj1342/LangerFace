"""映射正确性（纯 numpy，不依赖 MediaPipe / 资产）。

核心保证：重心坐标映射对仿射变换不变——人脸做任意仿射变形，叠加的线条随之同样变形。
"""
import numpy as np

from langerface.lines import Atlas, AtlasLine, map_atlas


def _one_line_atlas():
    # 三角面 0 上 3 个已知重心坐标点
    pts = np.array([
        [0, 0.7, 0.2],   # 偏向 v0
        [0, 0.2, 0.7],   # 偏向 v1
        [0, 0.25, 0.25],  # 偏向 v2
    ], dtype=float)
    return Atlas(system="rstl", lines=[AtlasLine("t", "test", pts)])


def test_barycentric_reconstruction():
    tris = np.array([[0, 1, 2]])
    verts = np.array([[10, 10, 0], [110, 20, 0], [40, 130, 5]], dtype=float)
    atlas = _one_line_atlas()
    mapped = map_atlas(atlas, verts, tris)[0]

    bary = atlas.lines[0].bary()
    expected = bary @ verts
    assert np.allclose(mapped.pts, expected, atol=1e-9)


def test_affine_invariance():
    tris = np.array([[0, 1, 2]])
    verts = np.array([[10, 10, 0], [110, 20, 0], [40, 130, 5]], dtype=float)
    atlas = _one_line_atlas()
    mapped1 = map_atlas(atlas, verts, tris)[0].pts

    # 任意 2D 仿射（含旋转/缩放/平移），z 保持
    theta = 0.6
    A = np.array([[1.3 * np.cos(theta), -np.sin(theta)],
                  [np.sin(theta), 0.8 * np.cos(theta)]])
    t = np.array([25.0, -12.0])
    verts2 = verts.copy()
    verts2[:, :2] = verts[:, :2] @ A.T + t

    mapped2 = map_atlas(atlas, verts2, tris)[0].pts
    expected2 = mapped1.copy()
    expected2[:, :2] = mapped1[:, :2] @ A.T + t
    assert np.allclose(mapped2, expected2, atol=1e-9)


def test_forehead_bridge_v15_has_the_reviewed_arch_and_even_layer_offsets():
    landmarks = np.full((11, 3), [50.0, 50.0, 0.0], dtype=float)
    landmarks[0] = [30.0, 40.0, 0.0]
    landmarks[2] = [50.0, 40.0, 0.0]
    landmarks[4] = [70.0, 40.0, 0.0]
    landmarks[9] = [50.0, 50.0, 0.0]
    landmarks[10] = [50.0, 30.0, 0.0]
    triangles = np.array([[0, 2, 4]])
    points = np.array(
        [
            [0.0, 1.0, 0.0],
            [0.0, 0.5, 0.5],
            [0.0, 0.0, 1.0],
            [0.0, 0.0, 0.5],
            [0.0, 0.0, 0.0],
        ],
        dtype=float,
    )
    upper = AtlasLine("upper", "forehead_bridge_arc_v15", points)
    lower = AtlasLine("lower", "forehead_bridge_arc_v15", points.copy())

    mapped = map_atlas(Atlas(system="rstl", lines=[upper, lower]), landmarks, triangles)
    mapped_by_name = {line.name: line.pts for line in mapped}

    assert np.allclose(mapped_by_name["upper"][:, 0], [17.2, 33.6, 50.0, 66.4, 82.8])
    assert np.allclose(mapped_by_name["upper"][[0, 2, 4], 1], [31.4, 28.6, 31.4])
    assert np.allclose(
        mapped_by_name["lower"][:, 1] - mapped_by_name["upper"][:, 1],
        2.0,
    )
