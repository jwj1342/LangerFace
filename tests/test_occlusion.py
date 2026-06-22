"""背面剔除（BackfaceCuller）：纯 numpy，不依赖资产/MediaPipe。

重点覆盖鼻尖符号自动标定这一容易出错的分支。
"""
import numpy as np

from langerface.config import NOSE_TIP
from langerface.rendering import BackfaceCuller


def _square_mesh_facing(sign: float):
    """构造 4 个顶点、2 个三角面的小网格，z 法向朝 +sign。

    顶点 1 = 鼻尖（NOSE_TIP），保证它被包含在三角面里以触发标定分支。
    """
    # 顶点放在 z=0 平面，按缠绕方向决定叉积法向的 z 符号
    verts = np.zeros((max(NOSE_TIP + 1, 4), 3), dtype=float)
    verts[0] = [0, 0, 0]
    verts[1] = [1, 0, 0]   # NOSE_TIP
    verts[2] = [0, 1, 0]
    verts[3] = [1, 1, 0]
    if sign < 0:           # 反转缠绕 -> 法向 z 反号
        tris = np.array([[0, 2, 1], [1, 2, 3]])
    else:
        tris = np.array([[0, 1, 2], [1, 3, 2]])
    return verts, tris


def test_frontfacing_visible_regardless_of_winding():
    """无论缠绕方向如何，朝相机的面都应判为可见（靠鼻尖标定符号）。"""
    for sign in (+1.0, -1.0):
        verts, tris = _square_mesh_facing(sign)
        culler = BackfaceCuller(tris)
        assert culler._nose_tris.size > 0      # 鼻尖确实落在某些三角面里
        vis = culler.visible_triangles(verts)
        assert vis.all(), f"sign={sign} 下朝前的面被误剔除"


def test_backface_culled_when_flipped_in_depth():
    """把网格沿 z 推到背面（顶点 z 取负的法向）后，应被剔除。"""
    verts, tris = _square_mesh_facing(+1.0)
    culler = BackfaceCuller(tris)
    # 制造一个明显朝后的三角面：把第二个三角面顶点 z 抬高，使叉积 z 反向且超阈值
    flipped = verts.copy()
    flipped[3, 2] = 50.0
    flipped[1, 1] = -5.0
    vis = culler.visible_triangles(flipped)
    assert vis.shape == (2,)
    assert vis.dtype == bool
