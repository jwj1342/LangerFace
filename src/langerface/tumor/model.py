"""Structured tumor inputs used by deterministic incision tools.

The model intentionally captures manual clinical inputs only. It does not
diagnose tumor type or infer safety margins.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

TumorKind = Literal["subcutaneous", "cutaneous"]


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
    source: str = "manual"
    author: str = ""

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

    def to_dict(self) -> dict[str, object]:
        return {
            "kind": self.kind,
            "center": list(self.center),
            "diameter_mm": self.diameter_mm,
            "depth_mm": self.depth_mm,
            "margin_mm": self.margin_mm,
            "boundary": [list(p) for p in self.boundary],
            "source": self.source,
            "author": self.author,
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
        source=str(data.get("source", "manual")),
        author=str(data.get("author", "")),
    )
