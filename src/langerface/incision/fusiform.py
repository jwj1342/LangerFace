"""Fusiform incision generator for cutaneous tumors."""
from __future__ import annotations

from typing import Any

import numpy as np

from ..clinical import default_clinical_rules
from ..lines.direction import DirectionQueryResult
from ..tumor import TumorInput
from .geometry import clamp, normalize, tangent_perp
from .provenance import direction_provenance


def _polygon_area(points: np.ndarray) -> float:
    if len(points) < 3:
        return 0.0
    x = points[:, 0]
    y = points[:, 1]
    return 0.5 * abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))


def _orientation(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    return float((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))


def _on_segment(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> bool:
    eps = 1e-9
    return (
        min(a[0], c[0]) - eps <= b[0] <= max(a[0], c[0]) + eps
        and min(a[1], c[1]) - eps <= b[1] <= max(a[1], c[1]) + eps
        and abs(_orientation(a, b, c)) <= eps
    )


def _segments_intersect(a: np.ndarray, b: np.ndarray, c: np.ndarray, d: np.ndarray) -> bool:
    eps = 1e-9
    o1 = _orientation(a, b, c)
    o2 = _orientation(a, b, d)
    o3 = _orientation(c, d, a)
    o4 = _orientation(c, d, b)
    if o1 * o2 < -eps and o3 * o4 < -eps:
        return True
    return (
        _on_segment(a, c, b)
        or _on_segment(a, d, b)
        or _on_segment(c, a, d)
        or _on_segment(c, b, d)
    )


def _polygon_self_intersects(points: np.ndarray) -> bool:
    n = len(points)
    if n < 4:
        return False
    for i in range(n):
        a = points[i]
        b = points[(i + 1) % n]
        for j in range(i + 1, n):
            if abs(i - j) <= 1 or {i, j} == {0, n - 1}:
                continue
            c = points[j]
            d = points[(j + 1) % n]
            if _segments_intersect(a, b, c, d):
                return True
    return False


def _boundary_profile(
    tumor: TumorInput,
    axis: np.ndarray,
    perp: np.ndarray,
    units_per_mm: float,
) -> dict[str, Any] | None:
    """Return conservative projected boundary extents for a cutaneous lesion."""

    if len(tumor.boundary) < 3 or units_per_mm <= 0:
        return None
    boundary = np.asarray(tumor.boundary, dtype=np.float64)
    center = boundary.mean(axis=0)
    delta = boundary - center
    projected = np.column_stack((delta @ axis, delta @ perp))
    axis_diameter_mm = 2.0 * float(np.max(np.abs(projected[:, 0]))) / units_per_mm
    perp_diameter_mm = 2.0 * float(np.max(np.abs(projected[:, 1]))) / units_per_mm
    area_mm2 = _polygon_area(projected) / (units_per_mm * units_per_mm)
    nominal_disk_area_mm2 = float(np.pi * (tumor.diameter_mm * 0.5) ** 2)
    tumor_center = np.asarray(tumor.center, dtype=np.float64)
    center_shift_mm = float(np.linalg.norm(center - tumor_center)) / units_per_mm
    return {
        "point_count": int(len(boundary)),
        "center": center,
        "axis_diameter_mm": axis_diameter_mm,
        "perp_diameter_mm": perp_diameter_mm,
        "area_mm2": area_mm2,
        "area_ratio_to_diameter_disk": area_mm2 / max(nominal_disk_area_mm2, 1e-9),
        "self_intersection": _polygon_self_intersects(projected),
        "center_shift_mm": center_shift_mm,
    }


def _hermite_half_width(u: float, tip_slope: float) -> float:
    """Cubic half-profile from tip (0) to center (1) with controlled tip slope."""

    return (tip_slope - 2.0) * u**3 + (3.0 - 2.0 * tip_slope) * u**2 + tip_slope * u


def _fusiform_profile(
    center: np.ndarray,
    axis: np.ndarray,
    perp: np.ndarray,
    *,
    half_l: float,
    half_w: float,
    samples: int,
    tip_angle_deg: float,
) -> tuple[list[np.ndarray], list[np.ndarray], dict[str, float | bool | str]]:
    if half_l <= 1e-9 or half_w <= 1e-9:
        raise ValueError("fusiform profile requires positive length and width")
    ratio = half_l / half_w
    target_angle = clamp(float(tip_angle_deg), 8.0, 75.0)
    target_slope = float(np.tan(np.deg2rad(target_angle / 2.0)))
    requested_shape_slope = ratio * target_slope
    # Cubic Hermite profiles stay monotone for endpoint slope <= 3.
    shape_slope = min(requested_shape_slope, 2.95)
    actual_slope = shape_slope / ratio
    actual_angle = float(np.rad2deg(2.0 * np.arctan(actual_slope)))

    upper: list[np.ndarray] = []
    lower: list[np.ndarray] = []
    for i in range(samples + 1):
        t = i / samples
        x = (t - 0.5) * 2.0 * half_l
        u = 2.0 * t if t <= 0.5 else 2.0 * (1.0 - t)
        y = _hermite_half_width(u, shape_slope) * half_w
        upper.append(center + axis * x + perp * y)
        lower.append(center + axis * x - perp * y)

    return upper, lower, {
        "profile": "cubic_hermite_tip_angle_constrained",
        "tip_angle_target_deg": target_angle,
        "tip_angle_estimated_deg": actual_angle,
        "tip_angle_error_deg": abs(actual_angle - target_angle),
        "tip_angle_limited_by_ratio": shape_slope < requested_shape_slope,
    }


def fusiform_cutaneous_incision(
    tumor: TumorInput,
    direction: DirectionQueryResult | dict[str, Any],
    *,
    normal: tuple[float, float, float] | list[float] | np.ndarray | None = None,
    rules: dict[str, Any] | None = None,
    units_per_mm: float = 1.0,
) -> dict[str, Any]:
    if tumor.kind != "cutaneous":
        raise ValueError("fusiform_cutaneous_incision requires a cutaneous tumor")
    cfg = (rules or default_clinical_rules())["fusiform_cutaneous"]  # type: ignore[index]
    axis_raw = direction.vector if isinstance(direction, DirectionQueryResult) else direction["vector"]
    axis = normalize(axis_raw)
    perp = tangent_perp(axis, None if normal is None else np.asarray(normal, dtype=np.float64))
    boundary = _boundary_profile(tumor, axis, perp, units_per_mm)
    center = (
        np.asarray(boundary["center"], dtype=np.float64)
        if boundary is not None
        else np.asarray(tumor.center, dtype=np.float64)
    )
    lesion_axis_mm = max(tumor.diameter_mm, float(boundary["axis_diameter_mm"]) if boundary else 0.0)
    lesion_width_mm = max(tumor.diameter_mm, float(boundary["perp_diameter_mm"]) if boundary else 0.0)
    width_mm = max(lesion_width_mm + 2.0 * tumor.margin_mm, 1e-6)
    axis_coverage_mm = lesion_axis_mm + 2.0 * tumor.margin_mm
    ratio_length_mm = width_mm * float(cfg["length_to_width_ratio"])
    target_length = max(ratio_length_mm, axis_coverage_mm)
    min_length_mm = float(cfg["min_length_mm"])
    max_length_mm = float(cfg["max_length_mm"])
    length_mm = clamp(target_length, min_length_mm, max_length_mm)
    axis_coverage_deficit_mm = max(0.0, axis_coverage_mm - length_mm)
    half_l = length_mm * units_per_mm * 0.5
    half_w = width_mm * units_per_mm * 0.5
    samples = max(12, int(cfg.get("samples", 56)))
    upper, lower, profile_metrics = _fusiform_profile(
        center,
        axis,
        perp,
        half_l=half_l,
        half_w=half_w,
        samples=samples,
        tip_angle_deg=float(cfg["tip_angle_deg"]),
    )
    outline = upper + list(reversed(lower[1:-1]))
    confidence = (
        direction.confidence
        if isinstance(direction, DirectionQueryResult)
        else float(direction.get("confidence", 0))
    )
    return {
        "id": "fusiform_cutaneous_candidate",
        "type": "fusiform",
        "tumor_kind": tumor.kind,
        "center": list(map(float, center)),
        "axis": list(map(float, axis)),
        "width_axis": list(map(float, perp)),
        "endpoints": [
            list(map(float, center - axis * half_l)),
            list(map(float, center + axis * half_l)),
        ],
        "outline": [list(map(float, p)) for p in outline],
        "polyline": [list(map(float, p)) for p in outline] + [list(map(float, outline[0]))],
        "length_mm": length_mm,
        "width_mm": width_mm,
        "length_units": length_mm * units_per_mm,
        "width_units": width_mm * units_per_mm,
        "tip_angle_deg": float(profile_metrics["tip_angle_estimated_deg"]),
        "direction_confidence": float(confidence),
        "metrics": {
            "rstl_deviation_deg": 0.0,
            "length_to_width_ratio": length_mm / width_mm,
            **profile_metrics,
            "diameter_mm": tumor.diameter_mm,
            "margin_mm": tumor.margin_mm,
            "length_target_mm": target_length,
            "length_ratio_target_mm": ratio_length_mm,
            "axis_coverage_required_mm": axis_coverage_mm,
            "axis_coverage_deficit_mm": axis_coverage_deficit_mm,
            "length_clamped_by_min": target_length < min_length_mm,
            "length_clamped_by_max": target_length > max_length_mm,
            "boundary_used": boundary is not None,
            "boundary_point_count": int(boundary["point_count"]) if boundary else len(tumor.boundary),
            "boundary_axis_diameter_mm": float(boundary["axis_diameter_mm"]) if boundary else None,
            "boundary_perp_diameter_mm": float(boundary["perp_diameter_mm"]) if boundary else None,
            "boundary_area_mm2": float(boundary["area_mm2"]) if boundary else None,
            "boundary_area_ratio_to_diameter_disk": (
                float(boundary["area_ratio_to_diameter_disk"]) if boundary else None
            ),
            "boundary_self_intersection": bool(boundary["self_intersection"]) if boundary else False,
            "boundary_center_shift_mm": float(boundary["center_shift_mm"]) if boundary else None,
        },
        "provenance": {
            "generator": "fusiform_cutaneous_incision",
            "rules_version": (rules or default_clinical_rules()).get("version"),
            "boundary_source": tumor.boundary_source,
            **direction_provenance(direction),
        },
    }
