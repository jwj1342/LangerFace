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

FOREHEAD_LOWER_LONG_ARC_REGION = "forehead_lower_long_arc_v13"
FOREHEAD_BRIDGE_ARC_REGION = "forehead_bridge_arc_v15"


def _extend_forehead_lower_long_arc(
    points: np.ndarray,
    landmarks_px: np.ndarray,
) -> np.ndarray:
    """Apply the historical v13 forehead expansion used by the browser runtime."""
    if len(points) == 0 or len(landmarks_px) <= 10:
        return points
    anchor = landmarks_px[9, :2]
    axis = landmarks_px[10, :2] - anchor
    axis_norm = float(np.linalg.norm(axis))
    if axis_norm <= 1e-9:
        return points
    axis /= axis_norm
    lateral_axis = np.array([-axis[1], axis[0]], dtype=np.float64)

    out = points.copy()
    relative = out[:, :2] - anchor
    parallel = relative @ axis
    lateral = relative @ lateral_axis
    out[:, :2] += (0.86 * parallel)[:, None] * axis

    current_half_width = float(np.max(np.abs(lateral)))
    face_width = float(np.ptp(landmarks_px[:, 0]))
    if current_half_width > 1e-9 and face_width > 1e-9:
        factor = 0.82 * face_width / current_half_width
        out[:, :2] += ((factor - 1.0) * lateral)[:, None] * lateral_axis

    for _ in range(5):
        smoothed = out.copy()
        smoothed[1:-1, :2] = (
            0.25 * out[:-2, :2] + 0.5 * out[1:-1, :2] + 0.25 * out[2:, :2]
        )
        out = smoothed

    laterals = (out[:, :2] - anchor) @ lateral_axis
    half_width = float(np.max(np.abs(laterals)))
    face_height = float(np.ptp(landmarks_px[:, 1]))
    if half_width > 1e-9 and face_height > 1e-9:
        normalized = np.clip(np.abs(laterals) / half_width, 0.0, 1.0)
        arch = 0.055 * face_height * (1.0 - normalized**2.4)
        out[:, :2] += arch[:, None] * axis
    return out


def _extend_forehead_bridge(
    points: np.ndarray,
    landmarks_px: np.ndarray,
    layer_rank: float,
) -> np.ndarray:
    """Map a canonical v15 bridge arc onto the visible forehead/scalp area."""
    if len(points) == 0 or len(landmarks_px) <= 10:
        return points
    anchor = landmarks_px[9, :2]
    axis = landmarks_px[10, :2] - anchor
    axis_norm = float(np.linalg.norm(axis))
    if axis_norm <= 1e-9:
        return points
    axis /= axis_norm
    lateral_axis = np.array([-axis[1], axis[0]], dtype=np.float64)

    out = points.copy()
    relative = out[:, :2] - anchor
    parallel = relative @ axis
    lateral = relative @ lateral_axis
    out[:, :2] += (0.86 * parallel)[:, None] * axis

    current_half_width = float(np.max(np.abs(lateral)))
    face_width = float(np.ptp(landmarks_px[:, 0]))
    if current_half_width > 1e-9 and face_width > 1e-9:
        width_factor = 0.82 * face_width / current_half_width
        out[:, :2] += ((width_factor - 1.0) * lateral)[:, None] * lateral_axis

    for _ in range(5):
        smoothed = out.copy()
        smoothed[1:-1, :2] = (
            0.25 * out[:-2, :2] + 0.5 * out[1:-1, :2] + 0.25 * out[2:, :2]
        )
        out = smoothed

    smoothed_lateral = (out[:, :2] - anchor) @ lateral_axis
    half_width = float(np.max(np.abs(smoothed_lateral)))
    face_height = float(np.ptp(landmarks_px[:, 1]))
    if half_width > 1e-9 and face_height > 1e-9:
        normalized = np.clip(np.abs(smoothed_lateral) / half_width, 0.0, 1.0)
        arch = 0.140 * face_height * (1.0 - normalized**2.0)
        out[:, :2] += arch[:, None] * axis
    if face_height > 1e-9:
        out[:, :2] -= 0.100 * layer_rank * face_height * axis
    return out


def _forehead_bridge_ranks(
    atlas: Atlas,
    landmarks_px: np.ndarray,
    triangles: np.ndarray,
) -> dict[str, float]:
    bridge_lines = [line for line in atlas.lines if line.region == FOREHEAD_BRIDGE_ARC_REGION]
    if not bridge_lines:
        return {}
    if len(landmarks_px) > 10:
        anchor = landmarks_px[9, :2]
        axis = landmarks_px[10, :2] - anchor
        axis_norm = float(np.linalg.norm(axis))
        if axis_norm > 1e-9:
            axis /= axis_norm

            def mean_height(line) -> float:
                vertices = triangles[line.tris()]
                bary = line.bary()
                raw = (
                    bary[:, 0:1] * landmarks_px[vertices[:, 0]]
                    + bary[:, 1:2] * landmarks_px[vertices[:, 1]]
                    + bary[:, 2:3] * landmarks_px[vertices[:, 2]]
                )
                return float(np.mean((raw[:, :2] - anchor) @ axis))

            bridge_lines = sorted(bridge_lines, key=mean_height, reverse=True)
    denominator = max(len(bridge_lines) - 1, 1)
    return {line.name: index / denominator for index, line in enumerate(bridge_lines)}


@dataclass
class MappedLine:
    name: str
    region: str
    pts: np.ndarray   # (N, 3) 图像空间 (x_px, y_px, z)
    tris: np.ndarray  # (N,) 每点所属三角面 id（供遮挡剔除使用）


def map_atlas(
    atlas: Atlas,
    landmarks_px: np.ndarray,
    triangles: np.ndarray,
    *,
    expand_forehead: bool = True,
) -> list[MappedLine]:
    """把图谱映射到检测到的关键点上。

    landmarks_px: (>=468, 3) 图像空间关键点 (x_px, y_px, z)。
    triangles:    (M, 3) 三角拓扑（来自标准模型）。
    """
    out: list[MappedLine] = []
    forehead_bridge_ranks = _forehead_bridge_ranks(atlas, landmarks_px, triangles)
    for ln in atlas.lines:
        tris = ln.tris()                      # (N,)
        bary = ln.bary()                      # (N, 3)
        tri_v = triangles[tris]               # (N, 3) 顶点索引
        v0 = landmarks_px[tri_v[:, 0]]        # (N, 3)
        v1 = landmarks_px[tri_v[:, 1]]
        v2 = landmarks_px[tri_v[:, 2]]
        pts = bary[:, 0:1] * v0 + bary[:, 1:2] * v1 + bary[:, 2:3] * v2
        if (
            expand_forehead
            and ln.region == FOREHEAD_LOWER_LONG_ARC_REGION
            and not ln.disable_runtime_expansion
        ):
            pts = _extend_forehead_lower_long_arc(pts, landmarks_px)
        elif (
            expand_forehead
            and ln.region == FOREHEAD_BRIDGE_ARC_REGION
            and not ln.disable_runtime_expansion
        ):
            pts = _extend_forehead_bridge(
                pts,
                landmarks_px,
                forehead_bridge_ranks.get(ln.name, 0.0),
            )
        out.append(MappedLine(name=ln.name, region=ln.region, pts=pts, tris=tris))
    return out
