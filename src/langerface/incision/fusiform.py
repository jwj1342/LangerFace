"""Fusiform incision generator for cutaneous tumors."""
from __future__ import annotations

from typing import Any

import numpy as np

from ..clinical import default_clinical_rules
from ..lines.direction import DirectionQueryResult
from ..tumor import TumorInput
from .geometry import clamp, normalize, tangent_perp


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
    width_mm = max(tumor.effective_diameter_mm, 1e-6)
    target_length = width_mm * float(cfg["length_to_width_ratio"])
    length_mm = clamp(target_length, float(cfg["min_length_mm"]), float(cfg["max_length_mm"]))
    center = np.asarray(tumor.center, dtype=np.float64)
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
        },
        "provenance": {
            "generator": "fusiform_cutaneous_incision",
            "rules_version": (rules or default_clinical_rules()).get("version"),
        },
    }
