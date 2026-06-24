"""Lightweight face region classification for incision planning.

This deterministic classifier is the Stage 2 engineering fallback for issue
#12. It uses canonical-face bounding-box coordinates and deliberately returns
conservative confidence values until MediaPipe/FLAME topology boundaries are
clinically reviewed.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

SENSITIVE_REGIONS = {"lower_eyelid", "lip_vermilion", "nasal_ala", "nasal_tip", "oral_commissure"}
SENSITIVE_ANCHORS = {
    "left_lower_eyelid": (0.30, 0.59),
    "right_lower_eyelid": (0.70, 0.59),
    "left_nasal_ala": (0.40, 0.49),
    "right_nasal_ala": (0.60, 0.49),
    "nasal_tip": (0.50, 0.43),
    "lip_vermilion": (0.50, 0.31),
    "left_oral_commissure": (0.35, 0.32),
    "right_oral_commissure": (0.65, 0.32),
}


@dataclass(frozen=True)
class AnatomyContext:
    region: str
    subunit: str
    confidence: float
    normalized_xy: tuple[float, float]
    sensitive: bool = False
    nearby_landmarks: tuple[str, ...] = ()
    free_margin_distance_mm: float | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "region": self.region,
            "subunit": self.subunit,
            "confidence": self.confidence,
            "normalized_xy": list(self.normalized_xy),
            "sensitive": self.sensitive,
            "nearby_landmarks": list(self.nearby_landmarks),
            "free_margin_distance_mm": self.free_margin_distance_mm,
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
    if ny >= 0.80:
        region, subunit, conf = "forehead", "forehead", 0.56
    elif (nx <= 0.12 or nx >= 0.88) and 0.30 <= ny <= 0.76:
        region, subunit, conf = "ear_region", "preauricular_or_postauricular", 0.42
    elif (nx < 0.22 or nx > 0.78) and ny >= 0.58:
        region, subunit, conf = "temple_cheek", "lateral_face", 0.54
    elif 0.68 <= ny < 0.80 and 0.22 <= nx <= 0.78:
        region, subunit, conf = "upper_eyelid", "upper_eyelid", 0.58
    elif 0.55 <= ny < 0.68 and 0.43 <= nx <= 0.57:
        region, subunit, conf = "inner_canthus", "medial_canthal_region", 0.50
    elif 0.53 <= ny < 0.68 and (0.20 <= nx <= 0.42 or 0.58 <= nx <= 0.80):
        region, subunit, conf = "lower_eyelid", "free_margin", 0.66
    elif 0.50 <= ny < 0.62 and 0.43 <= nx <= 0.57:
        region, subunit, conf = "nasal_dorsum", "nasal_root_or_dorsum", 0.56
    elif 0.39 <= ny < 0.47 and 0.44 <= nx <= 0.56:
        region, subunit, conf = "nasal_tip", "nasal_tip", 0.54
    elif 0.40 <= ny < 0.56 and 0.36 <= nx <= 0.64:
        region, subunit, conf = "nasal_ala", "nose", 0.62
    elif 0.34 <= ny < 0.49 and (0.24 <= nx <= 0.38 or 0.62 <= nx <= 0.76):
        region, subunit, conf = "nasolabial_fold", "midface_crease", 0.52
    elif 0.28 <= ny < 0.40 and (0.30 <= nx < 0.39 or 0.61 < nx <= 0.70):
        region, subunit, conf = "oral_commissure", "oral_commissure", 0.54
    elif 0.34 <= ny < 0.42 and 0.39 <= nx <= 0.61:
        region, subunit, conf = "upper_lip", "white_lip", 0.58
    elif 0.24 <= ny < 0.34 and 0.34 <= nx <= 0.66:
        region, subunit, conf = "lip_vermilion", "oral_free_margin", 0.66
    elif ny < 0.22 and 0.28 <= nx <= 0.72:
        region, subunit, conf = "chin", "chin", 0.58
    elif ny < 0.30 or nx < 0.18 or nx > 0.82:
        region, subunit, conf = "jawline", "mandibular_border", 0.50
    else:
        region, subunit, conf = "cheek", "midface", 0.64

    clipped = (max(0.0, min(1.0, nx)), max(0.0, min(1.0, ny)))
    nearby: list[str] = []
    nearest_margin = None
    for name, anchor in SENSITIVE_ANCHORS.items():
        # Normalize to an adult face-height scale. This is a conservative
        # screening distance, not a clinical measurement.
        dist_mm = float(np.hypot(clipped[0] - anchor[0], clipped[1] - anchor[1]) * 180.0)
        if dist_mm <= 28.0:
            nearby.append(name)
            nearest_margin = dist_mm if nearest_margin is None else min(nearest_margin, dist_mm)

    return AnatomyContext(
        region=region,
        subunit=subunit,
        confidence=conf,
        normalized_xy=clipped,
        sensitive=region in SENSITIVE_REGIONS or bool(nearby),
        nearby_landmarks=tuple(nearby),
        free_margin_distance_mm=nearest_margin,
    )
