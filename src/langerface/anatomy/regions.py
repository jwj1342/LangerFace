"""Lightweight face region classification for incision planning.

This is a deterministic placeholder for issue #12. It uses canonical-face
bounding-box coordinates and returns conservative confidence values.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

SENSITIVE_REGIONS = {"lower_eyelid", "lip_vermilion", "nasal_ala"}


@dataclass(frozen=True)
class AnatomyContext:
    region: str
    subunit: str
    confidence: float
    normalized_xy: tuple[float, float]
    sensitive: bool = False

    def to_dict(self) -> dict[str, object]:
        return {
            "region": self.region,
            "subunit": self.subunit,
            "confidence": self.confidence,
            "normalized_xy": list(self.normalized_xy),
            "sensitive": self.sensitive,
        }


def _bbox(vertices: np.ndarray | None) -> tuple[np.ndarray, np.ndarray]:
    if vertices is None or len(vertices) == 0:
        return np.array([-1.0, -1.0, -1.0]), np.array([1.0, 1.0, 1.0])
    V = np.asarray(vertices, dtype=np.float64)
    return V.min(axis=0), V.max(axis=0)


def classify_region(
    point: tuple[float, float, float] | list[float],
    vertices: np.ndarray | None = None,
) -> AnatomyContext:
    lo, hi = _bbox(vertices)
    span = np.maximum(hi - lo, 1e-9)
    p = np.asarray(point, dtype=np.float64)
    nx = float((p[0] - lo[0]) / span[0])
    ny = float((p[1] - lo[1]) / span[1])

    # Canonical MediaPipe y is vertical in this project. These bands are
    # intentionally broad: low confidence is safer than pretending precision.
    if ny >= 0.78:
        region, subunit, conf = "forehead", "forehead", 0.62
    elif 0.61 <= ny < 0.78 and 0.18 <= nx <= 0.82:
        region, subunit, conf = "periorbital", "upper_midface", 0.58
    elif 0.53 <= ny < 0.66 and (0.20 <= nx <= 0.40 or 0.60 <= nx <= 0.80):
        region, subunit, conf = "lower_eyelid", "free_margin", 0.66
    elif 0.40 <= ny < 0.58 and 0.38 <= nx <= 0.62:
        region, subunit, conf = "nasal_ala", "nose", 0.62
    elif 0.24 <= ny < 0.39 and 0.34 <= nx <= 0.66:
        region, subunit, conf = "lip_vermilion", "oral_free_margin", 0.66
    elif ny < 0.24:
        region, subunit, conf = "chin", "chin", 0.58
    elif nx < 0.23 or nx > 0.77:
        region, subunit, conf = "temple_cheek", "lateral_face", 0.56
    else:
        region, subunit, conf = "cheek", "midface", 0.64

    return AnatomyContext(
        region=region,
        subunit=subunit,
        confidence=conf,
        normalized_xy=(max(0.0, min(1.0, nx)), max(0.0, min(1.0, ny))),
        sensitive=region in SENSITIVE_REGIONS,
    )
