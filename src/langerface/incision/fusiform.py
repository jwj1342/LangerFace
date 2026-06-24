"""Fusiform incision generator for cutaneous tumors."""
from __future__ import annotations

from typing import Any

import numpy as np

from ..clinical import default_clinical_rules
from ..lines.direction import DirectionQueryResult
from ..tumor import TumorInput
from .geometry import clamp, normalize, tangent_perp


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
    axis_diameter_mm = 2.0 * float(np.max(np.abs(delta @ axis))) / units_per_mm
    perp_diameter_mm = 2.0 * float(np.max(np.abs(delta @ perp))) / units_per_mm
    tumor_center = np.asarray(tumor.center, dtype=np.float64)
    center_shift_mm = float(np.linalg.norm(center - tumor_center)) / units_per_mm
    return {
        "point_count": int(len(boundary)),
        "center": center,
        "axis_diameter_mm": axis_diameter_mm,
        "perp_diameter_mm": perp_diameter_mm,
        "center_shift_mm": center_shift_mm,
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
    target_length = max(width_mm * float(cfg["length_to_width_ratio"]), axis_coverage_mm)
    length_mm = clamp(target_length, float(cfg["min_length_mm"]), float(cfg["max_length_mm"]))
    half_l = length_mm * units_per_mm * 0.5
    half_w = width_mm * units_per_mm * 0.5
    samples = max(12, int(cfg.get("samples", 56)))
    upper: list[np.ndarray] = []
    lower: list[np.ndarray] = []
    for i in range(samples + 1):
        t = i / samples
        x = (t - 0.5) * 2.0 * half_l
        y = np.sin(np.pi * t) * half_w
        upper.append(center + axis * x + perp * y)
        lower.append(center + axis * x - perp * y)
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
        "tip_angle_deg": float(cfg["tip_angle_deg"]),
        "direction_confidence": float(confidence),
        "metrics": {
            "rstl_deviation_deg": 0.0,
            "length_to_width_ratio": length_mm / width_mm,
            "diameter_mm": tumor.diameter_mm,
            "margin_mm": tumor.margin_mm,
            "boundary_used": boundary is not None,
            "boundary_point_count": int(boundary["point_count"]) if boundary else len(tumor.boundary),
            "boundary_axis_diameter_mm": float(boundary["axis_diameter_mm"]) if boundary else None,
            "boundary_perp_diameter_mm": float(boundary["perp_diameter_mm"]) if boundary else None,
            "boundary_center_shift_mm": float(boundary["center_shift_mm"]) if boundary else None,
        },
        "provenance": {
            "generator": "fusiform_cutaneous_incision",
            "rules_version": (rules or default_clinical_rules()).get("version"),
            "boundary_source": tumor.boundary_source,
        },
    }
