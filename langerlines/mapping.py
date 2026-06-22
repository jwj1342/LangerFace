"""图谱 → 图像空间映射（分片仿射 / 重心插值变形）。

对图谱里每个线点 (tri, u, v, w)：
    P = u·L[i0] + v·L[i1] + w·L[i2]
其中 (i0,i1,i2) = triangles[tri]，L 为运行时检测到的关键点（图像像素 + 深度）。
该变形天然对身份、姿态、表情不变——这是稳定性的根基。
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .atlas import Atlas


@dataclass
class MappedLine:
    name: str
    region: str
    pts: np.ndarray   # (N, 3) 图像空间 (x_px, y_px, z)
    tris: np.ndarray  # (N,) 每点所属三角面 id（供遮挡剔除使用）


def map_atlas(atlas: Atlas, landmarks_px: np.ndarray, triangles: np.ndarray) -> list[MappedLine]:
    """把图谱映射到检测到的关键点上。

    landmarks_px: (>=468, 3) 图像空间关键点 (x_px, y_px, z)。
    triangles:    (M, 3) 三角拓扑（来自标准模型）。
    """
    out: list[MappedLine] = []
    for ln in atlas.lines:
        tris = ln.tris()                      # (N,)
        bary = ln.bary()                      # (N, 3)
        tri_v = triangles[tris]               # (N, 3) 顶点索引
        v0 = landmarks_px[tri_v[:, 0]]        # (N, 3)
        v1 = landmarks_px[tri_v[:, 1]]
        v2 = landmarks_px[tri_v[:, 2]]
        pts = (bary[:, 0:1] * v0 + bary[:, 1:2] * v1 + bary[:, 2:3] * v2)
        out.append(MappedLine(name=ln.name, region=ln.region, pts=pts, tris=tris))
    return out
