"""把投影空间 2D 折线折叠为一条图谱曲线（离线构建工具共用的下层算子）。

各资产生成脚本（build_field_atlas / build_initial_atlas / digitize_from_diagram /
annotate_atlas）此前各自手写同一段内循环：逐点 canonical.locate(p, proj=proj)、
组装 (tri, u, v)、再封装为 AtlasLine。这里收敛为单一算子，统一 dtype 为 float64。
"""
from __future__ import annotations

import numpy as np

from .atlas import AtlasLine


def atlas_line_from_points2d(canonical, name, region, pts2d, *, proj) -> AtlasLine:
    """把**投影空间**的 2D 点列折叠为一条 AtlasLine。

    pts2d 必须已是投影坐标（归一化曲线请先经 canonical.norm_to_proj 转换）。
    每点定位到标准网格三角面，编码为 (tri, u, v)；w = 1-u-v。
    """
    out = np.zeros((len(pts2d), 3), dtype=np.float64)
    for i, p in enumerate(pts2d):
        tri, bary = canonical.locate(p, proj=proj)
        out[i] = [tri, bary[0], bary[1]]
    return AtlasLine(name=name, region=region, points=out)
