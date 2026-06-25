"""Structured tumor inputs used by deterministic incision tools.

The model intentionally captures manual clinical inputs only. It does not
diagnose tumor type or infer safety margins.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

TumorKind = Literal["subcutaneous", "cutaneous"]
TUMOR_INPUT_SCHEMA = "tumor-input/v0.2"


def _point3(value: object, field_name: str) -> tuple[float, float, float]:
    if not isinstance(value, list | tuple) or len(value) != 3:
        raise ValueError(f"{field_name} must be a 3D point")
    out = tuple(float(x) for x in value)
    if not all(x == x and abs(x) < 1e9 for x in out):
        raise ValueError(f"{field_name} must contain finite coordinates")
    return out  # type: ignore[return-value]


@dataclass(frozen=True)
class TumorInput:
    """Minimal tumor contract shared by Python, web, and the LLM agent."""

    kind: TumorKind
    center: tuple[float, float, float]
    diameter_mm: float
    depth_mm: float | None = None
    margin_mm: float = 0.0
    boundary: tuple[tuple[float, float, float], ...] = field(default_factory=tuple)
    boundary_mode: str = "center_diameter"
    boundary_source: str = "manual"
    source: str = "manual"
    author: str = ""
    units: str = "mm"

    def __post_init__(self) -> None:
        if self.kind not in {"subcutaneous", "cutaneous"}:
            raise ValueError("kind must be 'subcutaneous' or 'cutaneous'")
        if self.diameter_mm <= 0 or self.diameter_mm > 200:
            raise ValueError("diameter_mm must be in (0, 200]")
        if self.margin_mm < 0 or self.margin_mm > 100:
            raise ValueError("margin_mm must be in [0, 100]")
        if self.depth_mm is not None and (self.depth_mm < 0 or self.depth_mm > 200):
            raise ValueError("depth_mm must be in [0, 200]")
        _point3(self.center, "center")
        for p in self.boundary:
            _point3(p, "boundary point")

    @property
    def effective_diameter_mm(self) -> float:
        """Diameter including explicit safety margin for cutaneous excision."""

        return self.diameter_mm + 2.0 * self.margin_mm

    def input_quality(self) -> dict[str, object]:
        warnings: list[dict[str, object]] = []
        if not self.author:
            warnings.append({
                "code": "missing_tumor_author",
                "severity": "medium",
                "message": "Tumor input has no author/reviewer name recorded.",
            })
        if self.units != "mm":
            warnings.append({
                "code": "non_mm_tumor_units",
                "severity": "high",
                "message": "Tumor input units are not millimeters; deterministic incision rules assume mm.",
            })
        if self.kind == "subcutaneous" and self.depth_mm is None:
            warnings.append({
                "code": "missing_subcutaneous_depth",
                "severity": "medium",
                "message": (
                    "Subcutaneous tumor depth is missing; confirm ultrasound/source depth "
                    "before review."
                ),
            })
        if self.kind == "cutaneous":
            if self.margin_mm <= 0:
                warnings.append({
                    "code": "missing_cutaneous_margin",
                    "severity": "medium",
                    "message": "Cutaneous tumor margin is zero; confirm intended margin before review.",
                })
            if self.boundary_mode == "freehand" and len(self.boundary) < 6:
                warnings.append({
                    "code": "sparse_cutaneous_boundary_input",
                    "severity": "medium",
                    "message": "Freehand cutaneous boundary has fewer than 6 points.",
                })
            if self.boundary_mode != "center_diameter" and len(self.boundary) < 3:
                warnings.append({
                    "code": "missing_cutaneous_boundary",
                    "severity": "medium",
                    "message": "Cutaneous boundary mode is selected but no usable boundary was provided.",
                })
        return {
            "passed": not any(w["severity"] == "high" for w in warnings),
            "warning_count": len(warnings),
            "warnings": warnings,
            "source": self.source,
            "boundary_source": self.boundary_source,
            "author_present": bool(self.author),
            "units": self.units,
        }

    def to_dict(self) -> dict[str, object]:
        return {
            "kind": self.kind,
            "center": list(self.center),
            "diameter_mm": self.diameter_mm,
            "depth_mm": self.depth_mm,
            "margin_mm": self.margin_mm,
            "boundary": [list(p) for p in self.boundary],
            "boundary_mode": self.boundary_mode,
            "boundary_source": self.boundary_source,
            "source": self.source,
            "author": self.author,
            "units": self.units,
        }


def tumor_from_dict(data: dict[str, object]) -> TumorInput:
    boundary_raw = data.get("boundary") or []
    if not isinstance(boundary_raw, list | tuple):
        raise ValueError("boundary must be a list of 3D points")
    return TumorInput(
        kind=str(data.get("kind", "subcutaneous")),  # type: ignore[arg-type]
        center=_point3(data.get("center"), "center"),
        diameter_mm=float(data.get("diameter_mm", 8.0)),
        depth_mm=None if data.get("depth_mm") is None else float(data["depth_mm"]),
        margin_mm=float(data.get("margin_mm", 0.0)),
        boundary=tuple(_point3(p, "boundary point") for p in boundary_raw),
        boundary_mode=str(data.get("boundary_mode", "center_diameter")),
        boundary_source=str(data.get("boundary_source", "manual")),
        source=str(data.get("source", "manual")),
        author=str(data.get("author", "")),
        units=str(data.get("units", "mm")),
    )


def tumor_from_payload(payload: dict[str, object]) -> TumorInput:
    """Read either a raw tumor dict or a ``tumor-input/v0.2`` export payload."""

    raw = payload.get("tumor", payload)
    if not isinstance(raw, dict):
        raise ValueError("tumor payload must contain a tumor object")
    return tumor_from_dict(raw)
