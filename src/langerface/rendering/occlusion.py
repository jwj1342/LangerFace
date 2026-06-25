"""遮挡处理：基于三角面朝向的背面剔除。

侧脸/转头时，背离相机的半边线条应当隐藏。对每个三角面用检测到的 3D 关键点
计算法向，判断是否朝向相机。法向符号依赖三角缠绕方向与坐标系手性，故**每帧自动标定**：
鼻尖附近的三角面一定朝向相机，用它确定“朝前”的符号。

注：MediaPipe 不提供外部遮挡（如手挡脸）的深度，故此处仅处理自遮挡（朝向）。
（手部遮挡目前仅在 web 前端实现，见 web/geometry.js。）
"""
from __future__ import annotations

import numpy as np

from ..config.constants import DEFAULT_OCCLUSION_THRESHOLD, NOSE_TIP, inner_mouth_triangles


class BackfaceCuller:
    def __init__(
        self,
        triangles: np.ndarray,
        threshold: float = DEFAULT_OCCLUSION_THRESHOLD,
        min_triangle_area_px2: float = 0.0,
    ):
        """threshold: 朝向打分阈值（略小于 0，保留接近掠射的边缘三角面）。

        min_triangle_area_px2: 投影到屏幕后叉积 z 的绝对值阈值（约等于三角面
        2 倍面积），用于剔除近共线 / 关键点坍缩造成的退化三角面。
        """
        self.triangles = triangles
        self.threshold = float(threshold)
        self.min_triangle_area_px2 = max(0.0, float(min_triangle_area_px2))
        # 预计算包含鼻尖的三角面（用于每帧符号标定）
        mask = np.any(triangles == NOSE_TIP, axis=1)
        self._nose_tris = np.where(mask)[0]
        # 预计算口裂（内唇）三角面：张嘴时背面剔除剔不掉它们，需单独永久排除（#38）
        self._inner_mouth_tris = np.fromiter(
            inner_mouth_triangles(triangles), dtype=np.intp,
        )

    def visible_triangles(self, landmarks_px: np.ndarray) -> np.ndarray:
        """返回 (M,) bool：每个三角面是否朝向相机且不属于口裂三角面。"""
        tris = self.triangles
        v0 = landmarks_px[tris[:, 0], :3]
        v1 = landmarks_px[tris[:, 1], :3]
        v2 = landmarks_px[tris[:, 2], :3]
        n = np.cross(v1 - v0, v2 - v0)        # (M, 3)
        nz = n[:, 2]
        # 自动标定：鼻尖三角面应朝前
        if self._nose_tris.size:
            ref = np.mean(nz[self._nose_tris])
            sign = 1.0 if ref >= 0 else -1.0
        else:
            sign = 1.0
        vis = (sign * nz) >= self.threshold
        if self.min_triangle_area_px2 > 0:
            vis &= np.abs(nz) >= self.min_triangle_area_px2
        # 口裂三角面无论朝向如何一律排除（张嘴时线会落进口内 / 牙齿）
        if self._inner_mouth_tris.size:
            vis[self._inner_mouth_tris] = False
        return vis
