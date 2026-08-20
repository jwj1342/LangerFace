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
SUPRAORBITAL_SHORT_ARC_REGIONS_V67 = frozenset(
    {
        "supraorbital_lateral_short_arc_v67",
        "supraorbital_medial_short_arc_v67",
    }
)
SUPRAORBITAL_UPWARD_SHIFT_FACE_HEIGHT_V67 = 0.080
SUPRAORBITAL_MEDIAL_SHORT_ARC_REGION_V68 = "supraorbital_medial_short_arc_v68"
SUPRAORBITAL_MEDIAL_UPWARD_SHIFT_FACE_HEIGHT_V68 = 0.040


def _raise_supraorbital_short_arc(
    points: np.ndarray,
    landmarks_px: np.ndarray,
    shift_face_height: float,
) -> np.ndarray:
    """Translate a local brow arc along the detected facial upward axis."""
    if len(points) == 0 or len(landmarks_px) <= 10:
        return points
    anchor = landmarks_px[9, :2]
    axis = landmarks_px[10, :2] - anchor
    axis_norm = float(np.linalg.norm(axis))
    face_height = float(np.ptp(landmarks_px[:, 1]))
    if axis_norm <= 1e-9 or face_height <= 1e-9:
        return points
    axis /= axis_norm
    out = points.copy()
    out[:, :2] += (
        shift_face_height * face_height * axis
    )
    return out


def _smooth_mapped_curve(points: np.ndarray, passes: int) -> np.ndarray:
    """Fair mapped x/y coordinates while preserving both curve endpoints."""
    out = points.copy()
    for _ in range(max(0, min(32, int(passes)))):
        if len(out) < 3:
            break
        smoothed = out.copy()
        smoothed[1:-1, :2] = (
            0.25 * out[:-2, :2] + 0.5 * out[1:-1, :2] + 0.25 * out[2:, :2]
        )
        out = smoothed
    return out


def _fair_mapped_curve_cubic(points: np.ndarray) -> np.ndarray:
    """Fit one fixed-endpoint cubic to mapped x/y coordinates."""
    out = points.copy()
    if len(out) < 4:
        return out
    segment = np.linalg.norm(np.diff(out[:, :2], axis=0), axis=1)
    cumulative = np.r_[0.0, np.cumsum(segment)]
    length = float(cumulative[-1])
    if length <= 1e-9:
        return out
    source_xy = out[:, :2].copy()
    t = cumulative / length
    one_minus_t = 1.0 - t
    b0 = one_minus_t**3
    b1 = 3.0 * one_minus_t**2 * t
    b2 = 3.0 * one_minus_t * t**2
    b3 = t**3
    residual = out[:, :2] - b0[:, None] * out[0, :2] - b3[:, None] * out[-1, :2]
    a11 = float(b1 @ b1)
    a12 = float(b1 @ b2)
    a22 = float(b2 @ b2)
    determinant = a11 * a22 - a12 * a12
    if abs(determinant) <= 1e-12:
        return out
    r1 = b1 @ residual
    r2 = b2 @ residual
    control1 = (a22 * r1 - a12 * r2) / determinant
    control2 = (a11 * r2 - a12 * r1) / determinant
    out[:, :2] = (
        b0[:, None] * out[0, :2]
        + b1[:, None] * control1
        + b2[:, None] * control2
        + b3[:, None] * out[-1, :2]
    )
    segments = np.diff(out[:, :2], axis=0)
    turn_cross = (
        segments[:-1, 0] * segments[1:, 1]
        - segments[:-1, 1] * segments[1:, 0]
    )
    turn_scale = np.linalg.norm(segments[:-1], axis=1) * np.linalg.norm(
        segments[1:], axis=1
    )
    turn_sine = turn_cross / np.maximum(turn_scale, 1e-12)
    if np.any(turn_sine < -1e-6) and np.any(turn_sine > 1e-6):
        q0 = one_minus_t**2
        q1 = 2.0 * one_minus_t * t
        q2 = t**2
        quadratic_residual = (
            source_xy - q0[:, None] * source_xy[0] - q2[:, None] * source_xy[-1]
        )
        denominator = float(q1 @ q1)
        if denominator > 1e-12:
            control = (q1 @ quadratic_residual) / denominator
            out[:, :2] = (
                q0[:, None] * source_xy[0]
                + q1[:, None] * control
                + q2[:, None] * source_xy[-1]
            )
    out[0, :2] = points[0, :2]
    out[-1, :2] = points[-1, :2]
    return out


def _sample_xy_by_arclength(points: np.ndarray, count: int) -> np.ndarray:
    if count <= 1:
        return points[:1].copy()
    segment_lengths = np.linalg.norm(np.diff(points, axis=0), axis=1)
    cumulative = np.r_[0.0, np.cumsum(segment_lengths)]
    if cumulative[-1] <= 1e-9:
        return np.repeat(points[:1], count, axis=0)
    targets = np.linspace(0.0, cumulative[-1], count)
    return np.column_stack(
        [np.interp(targets, cumulative, points[:, axis]) for axis in range(2)]
    )


def _apply_temporal_cubic_face_ratio(
    points: np.ndarray,
    landmarks_px: np.ndarray,
    line_name: str,
    specification: tuple[
        int,
        tuple[float, float],
        tuple[float, float],
        tuple[float, float],
    ] | None,
    absolute_endpoint: bool,
    boundary_margin_face_ratio: float,
) -> np.ndarray:
    """Rebuild a temporal prefix beyond the mesh while retaining a smooth join."""
    if specification is None or len(points) < 5 or len(landmarks_px) == 0:
        return points
    join_index, first_offset, second_offset, tangent_handle_offset = specification
    if join_index < 2 or join_index >= len(points) - 2:
        return points
    face_width = float(np.ptp(landmarks_px[:, 0]))
    if face_width <= 1e-9:
        return points

    out = points.copy()
    join = out[join_index, :2].copy()
    if len(landmarks_px) > 263:
        right_axis = landmarks_px[263, :2] - landmarks_px[33, :2]
        right_axis_norm = float(np.linalg.norm(right_axis))
    else:
        right_axis = np.asarray((1.0, 0.0), dtype=np.float64)
        right_axis_norm = 1.0
    if right_axis_norm <= 1e-9:
        return points
    right_axis /= right_axis_norm
    if len(landmarks_px) > 152:
        down_axis = landmarks_px[152, :2] - landmarks_px[10, :2]
        down_axis -= float(down_axis @ right_axis) * right_axis
        down_axis_norm = float(np.linalg.norm(down_axis))
    else:
        down_axis = np.asarray((0.0, 1.0), dtype=np.float64)
        down_axis_norm = 1.0
    if down_axis_norm <= 1e-9:
        return points
    down_axis /= down_axis_norm
    outward_axis = right_axis if line_name.endswith("_left") else -right_axis

    old_outward_distance = float((out[0, :2] - join) @ outward_axis) / face_width
    requested_outward_distance = (
        min(0.22, max(0.0, first_offset[0]))
        if absolute_endpoint
        else min(0.22, max(first_offset[0], old_outward_distance + 0.03))
    )
    target_outward_distance = requested_outward_distance
    if absolute_endpoint and len(landmarks_px) > 389:
        boundary_indices = (
            (356, 389, 251, 284, 332, 297, 338, 10)
            if line_name.endswith("_left")
            else (127, 162, 21, 54, 103, 67, 109, 10)
        )
        boundary_points = landmarks_px[list(boundary_indices), :2]
        boundary_down = boundary_points @ down_axis
        boundary_outward = boundary_points @ outward_axis
        endpoint_down = float(join @ down_axis) + face_width * first_offset[1]
        outward_candidates: list[float] = []
        for boundary_segment_index in range(len(boundary_indices) - 1):
            down0 = float(boundary_down[boundary_segment_index])
            down1 = float(boundary_down[boundary_segment_index + 1])
            if endpoint_down < min(down0, down1) or endpoint_down > max(down0, down1):
                continue
            ratio = (
                (endpoint_down - down0) / (down1 - down0)
                if abs(down1 - down0) > 1e-9
                else 0.5
            )
            outward_candidates.append(
                float(boundary_outward[boundary_segment_index])
                + ratio
                * float(
                    boundary_outward[boundary_segment_index + 1]
                    - boundary_outward[boundary_segment_index]
                )
            )
        if outward_candidates:
            boundary_outward_at_endpoint = max(outward_candidates)
        else:
            nearest_index = int(np.argmin(np.abs(boundary_down - endpoint_down)))
            boundary_outward_at_endpoint = float(boundary_outward[nearest_index])
        # Negative margins allow a small, explicit outset beyond MediaPipe's
        # inner face oval while remaining bounded by the atlas contract.
        boundary_margin = min(0.1, max(-0.05, boundary_margin_face_ratio))
        boundary_limit = (
            boundary_outward_at_endpoint
            - boundary_margin * face_width
            - float(join @ outward_axis)
        ) / face_width
        target_outward_distance = min(
            target_outward_distance,
            max(0.0, boundary_limit),
        )
    outward_extra = max(0.0, target_outward_distance - first_offset[0])

    def local_offset(offset: tuple[float, float], extra_scale: float) -> np.ndarray:
        outward, down = offset
        return face_width * (
            (outward + extra_scale * outward_extra) * outward_axis
            + down * down_axis
        )

    first = join + (
        face_width
        * (
            target_outward_distance * outward_axis
            + first_offset[1] * down_axis
        )
        if absolute_endpoint
        else local_offset(first_offset, 1.0)
    )
    second_outward_distance = second_offset[0] + 0.55 * outward_extra
    boundary_clamped = (
        absolute_endpoint
        and target_outward_distance < requested_outward_distance - 1e-9
    )
    if boundary_clamped:
        second_outward_distance = min(
            second_outward_distance,
            0.70 * target_outward_distance,
        )
    second = join + face_width * (
        second_outward_distance * outward_axis
        + second_offset[1] * down_axis
    )
    old_endpoint = out[0, :2]
    endpoint_delta = first - old_endpoint
    outward_extension = float(endpoint_delta @ outward_axis)
    correction = (
        np.zeros(2, dtype=np.float64)
        if absolute_endpoint
        else max(0.0, 0.03 * face_width - outward_extension) * outward_axis
    )
    upward_shift = float(endpoint_delta @ down_axis)
    if not absolute_endpoint and upward_shift < -0.02 * face_width:
        correction += (-0.02 * face_width - upward_shift) * down_axis
    first += correction
    second += 0.55 * correction
    handle_length = face_width * float(np.linalg.norm(tangent_handle_offset))
    outgoing = out[join_index + 1, :2] - join
    outgoing_norm = float(np.linalg.norm(outgoing))
    if outgoing_norm <= 1e-9:
        return points
    outgoing /= outgoing_norm
    control_tangent = out[join_index + 1, :2] - out[join_index - 1, :2]
    control_tangent_norm = float(np.linalg.norm(control_tangent))
    if control_tangent_norm <= 1e-9:
        return points
    third = join - handle_length * control_tangent / control_tangent_norm
    if boundary_clamped:
        third_outward_distance = float((third - join) @ outward_axis) / face_width
        clamped_third_outward_distance = min(
            max(0.0, third_outward_distance),
            0.70 * second_outward_distance,
        )
        third += face_width * (
            clamped_third_outward_distance - third_outward_distance
        ) * outward_axis

    t = np.linspace(0.0, 1.0, 192)
    one_minus = 1.0 - t
    dense = (
        (one_minus**3)[:, None] * first
        + (3.0 * one_minus**2 * t)[:, None] * second
        + (3.0 * one_minus * t**2)[:, None] * third
        + (t**3)[:, None] * join
    )
    prefix = _sample_xy_by_arclength(dense, join_index + 1)
    terminal_segment_length = float(np.linalg.norm(prefix[-1] - prefix[-2]))
    prefix[-2] = join - terminal_segment_length * outgoing
    out[: join_index + 1, :2] = prefix
    return out


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
        elif ln.region in SUPRAORBITAL_SHORT_ARC_REGIONS_V67:
            pts = _raise_supraorbital_short_arc(
                pts,
                landmarks_px,
                SUPRAORBITAL_UPWARD_SHIFT_FACE_HEIGHT_V67,
            )
        elif ln.region == SUPRAORBITAL_MEDIAL_SHORT_ARC_REGION_V68:
            pts = _raise_supraorbital_short_arc(
                pts,
                landmarks_px,
                SUPRAORBITAL_MEDIAL_UPWARD_SHIFT_FACE_HEIGHT_V68,
            )
        pts = _apply_temporal_cubic_face_ratio(
            pts,
            landmarks_px,
            ln.name,
            ln.post_map_temporal_cubic_face_ratio,
            ln.post_map_temporal_absolute_endpoint,
            ln.post_map_temporal_boundary_margin_face_ratio,
        )
        if ln.post_map_smoothing_passes > 0:
            pts = _smooth_mapped_curve(pts, ln.post_map_smoothing_passes)
        if ln.post_map_cubic_fairing:
            pts = _fair_mapped_curve_cubic(pts)
        out.append(MappedLine(name=ln.name, region=ln.region, pts=pts, tris=tris))
    return out
