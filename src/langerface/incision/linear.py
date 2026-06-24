"""Linear incision generator for subcutaneous tumors."""
from __future__ import annotations

from typing import Any

import numpy as np

from ..clinical import default_clinical_rules
from ..lines.direction import DirectionQueryResult
from ..tumor import TumorInput
from .geometry import clamp, normalize


def linear_subcutaneous_incision(
    tumor: TumorInput,
    direction: DirectionQueryResult | dict[str, Any],
    *,
    rules: dict[str, Any] | None = None,
    units_per_mm: float = 1.0,
) -> dict[str, Any]:
    if tumor.kind != "subcutaneous":
        raise ValueError("linear_subcutaneous_incision requires a subcutaneous tumor")
    cfg = (rules or default_clinical_rules())["linear_subcutaneous"]  # type: ignore[index]
    axis_raw = direction.vector if isinstance(direction, DirectionQueryResult) else direction["vector"]
    axis = normalize(axis_raw)
    length_mm = clamp(
        tumor.diameter_mm * float(cfg["length_multiplier"]),
        float(cfg["min_length_mm"]),
        float(cfg["max_length_mm"]),
    )
    half = axis * (length_mm * units_per_mm * 0.5)
    center = np.asarray(tumor.center, dtype=np.float64)
    p0 = center - half
    p1 = center + half
    confidence = (
        direction.confidence
        if isinstance(direction, DirectionQueryResult)
        else float(direction.get("confidence", 0))
    )
    return {
        "id": "linear_subcutaneous_candidate",
        "type": "linear",
        "tumor_kind": tumor.kind,
        "center": list(map(float, center)),
        "axis": list(map(float, axis)),
        "endpoints": [list(map(float, p0)), list(map(float, p1))],
        "polyline": [list(map(float, p0)), list(map(float, p1))],
        "length_mm": length_mm,
        "length_units": length_mm * units_per_mm,
        "direction_confidence": float(confidence),
        "metrics": {
            "rstl_deviation_deg": 0.0,
            "diameter_mm": tumor.diameter_mm,
            "length_multiplier": length_mm / tumor.diameter_mm,
        },
        "provenance": {
            "generator": "linear_subcutaneous_incision",
            "rules_version": (rules or default_clinical_rules()).get("version"),
        },
    }
