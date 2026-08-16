"""Deterministic fusiform-incision geometry shared with the web workflow.

The implementation mirrors ``web/src/services/incisionCandidateTools.ts``.
It deliberately keeps the 3:1 ratio and 30 degree tip angle configurable:
these are draft engineering defaults, not validated clinical instructions.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from math import atan, degrees, isfinite, pi, radians, tan
from typing import Any

import numpy as np
from numpy.typing import NDArray

FloatArray = NDArray[np.float64]
Point3 = Sequence[float]


@dataclass(frozen=True)
class FusiformRules:
    """Parameterised draft rules for a cutaneous fusiform candidate."""

    length_to_width_ratio: float = 3.0
    tip_angle_deg: float = 30.0
    min_length_mm: float = 12.0
    max_length_mm: float = 80.0
    samples: int = 56
    version: str = "0.3-deterministic-incision-workflow"

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any] | None) -> FusiformRules:
        if value is None:
            return cls()
        return cls(
            length_to_width_ratio=float(value.get("length_to_width_ratio", 3.0)),
            tip_angle_deg=float(value.get("tip_angle_deg", 30.0)),
            min_length_mm=float(value.get("min_length_mm", 12.0)),
            max_length_mm=float(value.get("max_length_mm", 80.0)),
            samples=int(value.get("samples", 56)),
            version=str(value.get("version", "0.3-deterministic-incision-workflow")),
        )

    def validate(self) -> None:
        values = (
            self.length_to_width_ratio,
            self.tip_angle_deg,
            self.min_length_mm,
            self.max_length_mm,
        )
        if not all(isfinite(value) for value in values):
            raise ValueError("fusiform rules must be finite")
        if self.length_to_width_ratio <= 0:
            raise ValueError("length_to_width_ratio must be positive")
        if self.min_length_mm <= 0 or self.max_length_mm < self.min_length_mm:
            raise ValueError("fusiform length limits are invalid")
        if self.samples < 12:
            raise ValueError("fusiform samples must be at least 12")


def _vec3(value: Point3, field: str) -> FloatArray:
    point = np.asarray(value, dtype=np.float64)
    if point.shape != (3,) or not np.all(np.isfinite(point)):
        raise ValueError(f"{field} must be a finite 3D point")
    return point


def _norm(value: Point3, field: str) -> FloatArray:
    vector = _vec3(value, field)
    length = float(np.linalg.norm(vector))
    if length <= 1e-12:
        raise ValueError(f"{field} must be non-zero")
    return vector / length


def _tangent_perp(axis: FloatArray, normal: Point3) -> FloatArray:
    surface_normal = _norm(normal, "normal")
    perpendicular = np.cross(surface_normal, axis)
    if float(np.linalg.norm(perpendicular)) < 1e-9:
        perpendicular = np.asarray([-axis[1], axis[0], 0.0])
    return _norm(perpendicular, "width axis")


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def _hermite_half_width(u: float, tip_slope: float) -> float:
    return (tip_slope - 2.0) * u**3 + (3.0 - 2.0 * tip_slope) * u**2 + tip_slope * u


def fusiform_profile(
    center: Point3,
    axis: Point3,
    perpendicular: Point3,
    half_length: float,
    half_width: float,
    samples: int,
    tip_angle_deg: float,
) -> dict[str, Any]:
    """Build symmetric C1 cubic-Hermite halves and tip-angle metrics."""

    if not isfinite(half_length) or not isfinite(half_width) or half_length <= 1e-9 or half_width <= 1e-9:
        raise ValueError("fusiform profile requires positive finite length and width")
    if samples < 12:
        raise ValueError("fusiform profile requires at least 12 samples")

    c = _vec3(center, "center")
    a = _norm(axis, "axis")
    p = _norm(perpendicular, "perpendicular")
    ratio = half_length / half_width
    target_angle = _clamp(float(tip_angle_deg or 30.0), 8.0, 75.0)
    target_slope = tan(radians(target_angle / 2.0))
    requested_shape_slope = ratio * target_slope
    shape_slope = min(requested_shape_slope, 2.95)
    actual_angle = degrees(2.0 * atan(shape_slope / ratio))

    upper: list[list[float]] = []
    lower: list[list[float]] = []
    for index in range(samples + 1):
        t = index / samples
        x = (t - 0.5) * 2.0 * half_length
        u = 2.0 * t if t <= 0.5 else 2.0 * (1.0 - t)
        y = _hermite_half_width(u, shape_slope) * half_width
        base = c + a * x
        upper.append((base + p * y).tolist())
        lower.append((base - p * y).tolist())

    return {
        "upper": upper,
        "lower": lower,
        "metrics": {
            "profile": "cubic_hermite_tip_angle_constrained",
            "tip_angle_target_deg": target_angle,
            "tip_angle_estimated_deg": actual_angle,
            "tip_angle_error_deg": abs(actual_angle - target_angle),
            "tip_angle_limited_by_ratio": shape_slope < requested_shape_slope,
        },
    }


def _orientation(a: FloatArray, b: FloatArray, c: FloatArray) -> float:
    return float((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))


def _on_segment(a: FloatArray, b: FloatArray, c: FloatArray) -> bool:
    epsilon = 1e-9
    return (
        min(a[0], c[0]) - epsilon <= b[0] <= max(a[0], c[0]) + epsilon
        and min(a[1], c[1]) - epsilon <= b[1] <= max(a[1], c[1]) + epsilon
        and abs(_orientation(a, b, c)) <= epsilon
    )


def _segments_intersect(a: FloatArray, b: FloatArray, c: FloatArray, d: FloatArray) -> bool:
    epsilon = 1e-9
    o1 = _orientation(a, b, c)
    o2 = _orientation(a, b, d)
    o3 = _orientation(c, d, a)
    o4 = _orientation(c, d, b)
    if o1 * o2 < -epsilon and o3 * o4 < -epsilon:
        return True
    return (
        _on_segment(a, c, b)
        or _on_segment(a, d, b)
        or _on_segment(c, a, d)
        or _on_segment(c, b, d)
    )


def _polygon_self_intersects(points: FloatArray) -> bool:
    if len(points) < 4:
        return False
    for first in range(len(points)):
        a, b = points[first], points[(first + 1) % len(points)]
        for second in range(first + 1, len(points)):
            if abs(first - second) <= 1 or (first == 0 and second == len(points) - 1):
                continue
            c, d = points[second], points[(second + 1) % len(points)]
            if _segments_intersect(a, b, c, d):
                return True
    return False


def _polygon_area(points: FloatArray) -> float:
    if len(points) < 3:
        return 0.0
    shifted = np.roll(points, -1, axis=0)
    return abs(float(np.sum(points[:, 0] * shifted[:, 1] - points[:, 1] * shifted[:, 0]))) * 0.5


def _project(
    points: FloatArray,
    center: FloatArray,
    axis: FloatArray,
    perpendicular: FloatArray,
) -> FloatArray:
    offsets = points - center
    return np.column_stack((offsets @ axis, offsets @ perpendicular))


def _boundary_profile(
    boundary: FloatArray,
    tumor_center: FloatArray,
    diameter_mm: float,
    axis: FloatArray,
    perpendicular: FloatArray,
    units_per_mm: float,
) -> dict[str, Any] | None:
    if len(boundary) < 3:
        return None
    center = np.mean(boundary, axis=0)
    projected = _project(boundary, center, axis, perpendicular)
    selected_center_projected = _project(boundary, tumor_center, axis, perpendicular)
    max_axis = float(np.max(np.abs(projected[:, 0])))
    max_perpendicular = float(np.max(np.abs(projected[:, 1])))
    area_mm2 = _polygon_area(projected) / units_per_mm**2
    nominal_disk_area_mm2 = pi * (diameter_mm * 0.5) ** 2
    return {
        "point_count": len(boundary),
        "center": center,
        "axis_diameter_mm": 2.0 * max_axis / units_per_mm,
        "perp_diameter_mm": 2.0 * max_perpendicular / units_per_mm,
        "selected_center_axis_diameter_mm": (
            2.0 * float(np.max(np.abs(selected_center_projected[:, 0]))) / units_per_mm
        ),
        "selected_center_perp_diameter_mm": (
            2.0 * float(np.max(np.abs(selected_center_projected[:, 1]))) / units_per_mm
        ),
        "area_mm2": area_mm2,
        "area_ratio_to_diameter_disk": area_mm2 / max(nominal_disk_area_mm2, 1e-9),
        "self_intersection": _polygon_self_intersects(projected),
        "center_shift_mm": float(np.linalg.norm(center - tumor_center)) / units_per_mm,
    }


def _interpolate_half_width(x: float, profile: FloatArray) -> float:
    if x < profile[0, 0]:
        return -(float(profile[0, 0]) - x)
    if x > profile[-1, 0]:
        return -(x - float(profile[-1, 0]))
    for index in range(len(profile) - 1):
        a, b = profile[index], profile[index + 1]
        if a[0] <= x <= b[0]:
            span = float(b[0] - a[0])
            t = (x - float(a[0])) / span if abs(span) > 1e-12 else 0.0
            return abs(float(a[1])) + (abs(float(b[1])) - abs(float(a[1]))) * t
    return 0.0


def _outline_metrics(
    upper: FloatArray,
    lower: FloatArray,
    outline: FloatArray,
    boundary: FloatArray,
    center: FloatArray,
    axis: FloatArray,
    perpendicular: FloatArray,
    units_per_mm: float,
) -> dict[str, Any]:
    upper_projected = _project(upper, center, axis, perpendicular)
    lower_projected = _project(lower, center, axis, perpendicular)
    outline_projected = _project(outline, center, axis, perpendicular)
    widths = np.abs(upper_projected[:, 1])
    midpoint = len(widths) // 2
    epsilon = 1e-7
    monotone = bool(
        np.all(widths[:midpoint] <= widths[1 : midpoint + 1] + epsilon)
        and np.all(widths[midpoint:-1] >= widths[midpoint + 1 :] - epsilon)
    )
    symmetry = np.column_stack(
        (upper_projected[:, 0] - lower_projected[:, 0], upper_projected[:, 1] + lower_projected[:, 1])
    )
    symmetry_max = float(np.max(np.linalg.norm(symmetry, axis=1)))

    minimum_margin: float | None = None
    outside_count = 0
    if len(boundary) >= 3:
        boundary_projected = _project(boundary, center, axis, perpendicular)
        margins = np.asarray(
            [
                (_interpolate_half_width(float(x), upper_projected) - abs(float(y))) / units_per_mm
                for x, y in boundary_projected
            ]
        )
        minimum_margin = float(np.min(margins))
        outside_count = int(np.count_nonzero(margins < -1e-6))

    return {
        "outline_area_mm2": _polygon_area(outline_projected) / units_per_mm**2,
        "outline_self_intersection": _polygon_self_intersects(outline_projected),
        "outline_half_width_monotone": monotone,
        "outline_symmetry_max_error_mm": symmetry_max / units_per_mm,
        "boundary_envelope_min_margin_mm": minimum_margin,
        "boundary_envelope_outside_count": outside_count,
    }


def _optional_direction_value(direction: Mapping[str, Any], key: str) -> Any:
    value = direction.get(key)
    return value if value is not None else None


def generate_fusiform_incision(
    tumor: Mapping[str, Any],
    direction: Mapping[str, Any],
    units_per_mm: float,
    normal: Point3 = (0.0, 0.0, 1.0),
    rules: FusiformRules | Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Generate a JSON-serialisable cutaneous fusiform candidate.

    ``direction["vector"]`` is treated as the local RSTL long axis.  Any
    clinician rotation remains an outer workflow concern and should retain its
    edit provenance there.
    """

    cfg = rules if isinstance(rules, FusiformRules) else FusiformRules.from_mapping(rules)
    cfg.validate()
    if tumor.get("kind") != "cutaneous":
        raise ValueError("fusiform incision requires cutaneous tumor")
    if not isfinite(units_per_mm) or units_per_mm <= 0:
        raise ValueError("units_per_mm must be positive and finite")

    tumor_center = _vec3(tumor.get("center", ()), "tumor.center")
    diameter_mm = float(tumor.get("diameter_mm", 0.0))
    margin_mm = float(tumor.get("margin_mm", 0.0))
    if not isfinite(diameter_mm) or diameter_mm <= 0:
        raise ValueError("tumor.diameter_mm must be positive and finite")
    if not isfinite(margin_mm) or margin_mm < 0:
        raise ValueError("tumor.margin_mm must be non-negative and finite")

    axis = _norm(direction.get("vector", (1.0, 0.0, 0.0)), "direction.vector")
    perpendicular = _tangent_perp(axis, normal)
    raw_boundary = tumor.get("boundary", [])
    boundary_points = [_vec3(point, "tumor.boundary point") for point in raw_boundary]
    boundary = np.asarray(boundary_points, dtype=np.float64).reshape((-1, 3))
    boundary_summary = _boundary_profile(
        boundary,
        tumor_center,
        diameter_mm,
        axis,
        perpendicular,
        units_per_mm,
    )
    # The detector-confirmed center is authoritative. An asymmetric boundary
    # grows the symmetric candidate; it never silently moves that center.
    center = tumor_center
    lesion_axis_mm = max(
        diameter_mm,
        float(boundary_summary["selected_center_axis_diameter_mm"]) if boundary_summary else 0.0,
    )
    lesion_width_mm = max(
        diameter_mm,
        float(boundary_summary["selected_center_perp_diameter_mm"]) if boundary_summary else 0.0,
    )
    requested_width_mm = lesion_width_mm + 2.0 * margin_mm
    width_mm = requested_width_mm
    axis_coverage_mm = lesion_axis_mm + 2.0 * margin_mm
    ratio_length_mm = width_mm * cfg.length_to_width_ratio
    target_length_mm = max(ratio_length_mm, axis_coverage_mm)
    length_mm = _clamp(target_length_mm, cfg.min_length_mm, cfg.max_length_mm)
    axis_coverage_deficit_mm = max(0.0, axis_coverage_mm - length_mm)

    envelope_length_iterations = 0
    envelope_width_iterations = 0
    while True:
        half_length = length_mm * units_per_mm * 0.5
        half_width = width_mm * units_per_mm * 0.5
        profile = fusiform_profile(
            center,
            axis,
            perpendicular,
            half_length,
            half_width,
            cfg.samples,
            cfg.tip_angle_deg,
        )
        upper = np.asarray(profile["upper"], dtype=np.float64)
        lower = np.asarray(profile["lower"], dtype=np.float64)
        outline = np.concatenate((upper, lower[1:-1][::-1]), axis=0)
        outline_metrics = _outline_metrics(
            upper,
            lower,
            outline,
            boundary,
            center,
            axis,
            perpendicular,
            units_per_mm,
        )
        if not boundary_summary or int(outline_metrics["boundary_envelope_outside_count"]) == 0:
            break
        upper_projected = _project(upper, center, axis, perpendicular)
        boundary_projected = _project(boundary, center, axis, perpendicular)
        outside = [
            (float(x), float(y))
            for x, y in boundary_projected
            if _interpolate_half_width(float(x), upper_projected) < abs(float(y)) - 1e-7
        ]
        near_tapered_tip = any(abs(x) >= half_length * 0.88 for x, _ in outside)
        maximum_width_mm = min(requested_width_mm * 2.0, length_mm / 2.2)
        if not near_tapered_tip and width_mm < maximum_width_mm - 1e-9:
            width_mm = min(maximum_width_mm, max(width_mm + 0.5, width_mm * 1.1))
            envelope_width_iterations += 1
        else:
            next_length_mm = min(cfg.max_length_mm, max(length_mm + 1.0, length_mm * 1.08))
            if next_length_mm > length_mm + 1e-9:
                length_mm = next_length_mm
                envelope_length_iterations += 1
            elif width_mm < maximum_width_mm - 1e-9:
                width_mm = min(maximum_width_mm, max(width_mm + 0.5, width_mm * 1.1))
                envelope_width_iterations += 1
            else:
                break
        if envelope_length_iterations + envelope_width_iterations >= 32:
            break
    half_length = length_mm * units_per_mm * 0.5
    axis_coverage_deficit_mm = max(0.0, axis_coverage_mm - length_mm)
    endpoints = [center - axis * half_length, center + axis * half_length]
    metrics = {
        "rstl_deviation_deg": 0.0,
        "length_to_width_ratio": length_mm / width_mm,
        **profile["metrics"],
        "diameter_mm": diameter_mm,
        "margin_mm": margin_mm,
        "length_target_mm": target_length_mm,
        "boundary_envelope_length_expansion_iterations": envelope_length_iterations,
        "boundary_envelope_width_expansion_iterations": envelope_width_iterations,
        "boundary_envelope_width_expanded": width_mm > requested_width_mm + 1e-9,
        "length_ratio_target_mm": ratio_length_mm,
        "axis_coverage_required_mm": axis_coverage_mm,
        "axis_coverage_deficit_mm": axis_coverage_deficit_mm,
        "length_clamped_by_min": target_length_mm < cfg.min_length_mm,
        "length_clamped_by_max": target_length_mm > cfg.max_length_mm,
        "boundary_used": boundary_summary is not None,
        "boundary_point_count": int(boundary_summary["point_count"]) if boundary_summary else len(boundary),
        "boundary_axis_diameter_mm": (
            float(boundary_summary["axis_diameter_mm"]) if boundary_summary else None
        ),
        "boundary_perp_diameter_mm": (
            float(boundary_summary["perp_diameter_mm"]) if boundary_summary else None
        ),
        "boundary_selected_center_axis_diameter_mm": (
            float(boundary_summary["selected_center_axis_diameter_mm"]) if boundary_summary else None
        ),
        "boundary_selected_center_perp_diameter_mm": (
            float(boundary_summary["selected_center_perp_diameter_mm"]) if boundary_summary else None
        ),
        "boundary_area_mm2": float(boundary_summary["area_mm2"]) if boundary_summary else None,
        "boundary_area_ratio_to_diameter_disk": (
            float(boundary_summary["area_ratio_to_diameter_disk"]) if boundary_summary else None
        ),
        "boundary_self_intersection": (
            bool(boundary_summary["self_intersection"]) if boundary_summary else False
        ),
        "boundary_center_shift_mm": (
            float(boundary_summary["center_shift_mm"]) if boundary_summary else None
        ),
        **outline_metrics,
    }
    direction_confidence = direction.get("confidence")
    return {
        "id": "fusiform_cutaneous_candidate",
        "type": "fusiform",
        "tumor_kind": "cutaneous",
        "center": np.asarray(center).tolist(),
        "axis": axis.tolist(),
        "width_axis": perpendicular.tolist(),
        "endpoints": [point.tolist() for point in endpoints],
        "outline": outline.tolist(),
        "polyline": np.concatenate((outline, outline[:1]), axis=0).tolist(),
        "length_mm": length_mm,
        "width_mm": width_mm,
        "length_units": length_mm * units_per_mm,
        "width_units": width_mm * units_per_mm,
        "tip_angle_deg": profile["metrics"]["tip_angle_estimated_deg"],
        "direction_confidence": float(direction_confidence) if direction_confidence is not None else None,
        "metrics": metrics,
        "provenance": {
            "generator": "generateFusiformIncision",
            "rules_version": cfg.version,
            "candidate_version": 1,
            "edit_history": [],
            "direction_source": _optional_direction_value(direction, "source"),
            "direction_nearest_distance": _optional_direction_value(direction, "nearest_distance"),
            "direction_support_count": _optional_direction_value(direction, "support_count"),
            "direction_angular_spread_deg": _optional_direction_value(direction, "angular_spread_deg"),
            "direction_confidence_reasons": list(direction.get("confidence_reasons", [])),
        },
    }
