"""遮挡处理：基于三角面朝向的背面剔除。

侧脸/转头时，背离相机的半边线条应当隐藏。对每个三角面用检测到的 3D 关键点
计算法向，判断是否朝向相机。法向符号依赖三角缠绕方向与坐标系手性，故**每帧自动标定**：
鼻尖附近的三角面一定朝向相机，用它确定“朝前”的符号。

注：MediaPipe 不提供外部遮挡（如手挡脸）的深度，故此处仅处理自遮挡（朝向）。
（手部遮挡目前仅在 web 前端实现，见 web/geometry.js。）
"""
from __future__ import annotations

import numpy as np

from ..config.constants import DEFAULT_OCCLUSION_THRESHOLD, NOSE_TIP


class BackfaceCuller:
    def __init__(self, triangles: np.ndarray, threshold: float = DEFAULT_OCCLUSION_THRESHOLD):
        """threshold: 朝向打分阈值（略小于 0，保留接近掠射的边缘三角面）。"""
        self.triangles = triangles
        self.threshold = float(threshold)
        # 预计算包含鼻尖的三角面（用于每帧符号标定）
        mask = np.any(triangles == NOSE_TIP, axis=1)
        self._nose_tris = np.where(mask)[0]

    def visible_triangles(self, landmarks_px: np.ndarray) -> np.ndarray:
        """返回 (M,) bool：每个三角面是否朝向相机。"""
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
        return (sign * nz) >= self.threshold
