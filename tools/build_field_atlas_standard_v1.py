"""Build the doctor-standard RSTL atlas from an extracted continuous tangent field.

The authoritative visual sources are ``langer线-cc/standard_1.png`` and
``langer线-cc/standard_2.png``. Only their thin gray RSTL field is represented;
red incision/scar annotations are explicitly excluded.

This is the single-command standard-v8 generator:

    python tools/build_field_atlas_standard_v1.py
"""
from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

REPO = Path(__file__).resolve().parents[1]
SRC = REPO / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from langerface.config import (  # noqa: E402
    ATLAS_VERSION,
    CANONICAL_OBJ,
    SYSTEM_RSTL,
    TOPOLOGY_ID,
    TOPOLOGY_VERSION,
)
from langerface.geometry import CanonicalFaceModel  # noqa: E402
from langerface.lines import Atlas, AtlasLine, atlas_line_from_points2d  # noqa: E402

REFERENCE = REPO / "assets" / "rstl_standard_reference_v1.json"
OUTPUT = REPO / "assets" / "atlas_rstl_standard_v8.json"
STANDARD_ATLAS_VERSION = "8.1.68"
CENTER_X = 0.5
_FACE_POLYGON: np.ndarray | None = None
_FOREHEAD_MIN_Y = 0.060
_NOSE_ROOT_HORIZONTAL_PATCH = False
_GLABELLA_BLUE_LOCAL_REVISION = False
_UPPER_FACE_INDEPENDENT_FAMILIES = False
_FOREHEAD_EXPANDED_COVERAGE_V2 = False
_FOREHEAD_NEAR_EQUAL_LENGTH_V3 = False
_FOREHEAD_CURVED_ARCS_V4 = False
_FOREHEAD_SCALP_ARCS_V5 = False
_FOREHEAD_CONTINUOUS_CROSS_MIDLINE_V6 = False
_NOSE_ROOT_CONTINUOUS_LATERAL_BLEND_V8 = False
_NASAL_BRIDGE_TURNDOWN_V9 = False
_NOSTRIL_APERTURE_MASK_V9 = False
_PHILTRUM_NASAL_BASE_STOP_V10 = False
_ORBITAL_BROW_UPTURN_V11 = False
_ORBITAL_BROW_FOREHEAD_CLEARANCE_V12 = False
_FOREHEAD_LOWER_LONG_ARCS_V13 = False
_YELLOW_GUIDE_CONTINUITY_V14 = False
_FOREHEAD_BRIDGE_ARCS_V15 = False
_FOREHEAD_DENSE_BRIDGE_ARCS_V16 = False
_NASAL_TIP_MEDIAL_CONVERGENCE_V17 = False
_ORBITAL_NASAL_FRAGMENT_REPLACEMENT_V18 = False
_REMOVED_ORBITAL_NASAL_FRAGMENT_V18 = "removed_orbital_nasal_fragment_v18"
_ORBITAL_NASAL_CONTINUOUS_BUNDLE_V19 = False
_REMOVED_ORBITAL_NASAL_BUNDLE_V19 = "removed_orbital_nasal_bundle_v19"
_ORBITAL_NASAL_PRESERVE_V22_BUNDLE_V20 = False
_REMOVED_ORBITAL_NASAL_FRAGMENT_V20 = "removed_orbital_nasal_fragment_v20"
_NASAL_BUNDLE_UPWARD_SHIFT_V21 = False
_PERIORAL_CHEEK_SEPARATRIX_V22 = False
_PERIORAL_CHEEK_ALAR_ORIGIN_V23 = False
_CHEEK_LONG_ARC_FAN_V24 = False
_CHEEK_LONG_ARC_FAN_REGION_V24 = "cheek_long_arc_fan_v24"
_REMOVED_CHEEK_LONG_ARC_FAN_V24 = "removed_cheek_long_arc_fan_v24"
_INFRAORBITAL_WAVE_V25 = False
_NASAL_BUNDLE_ADDITIONAL_UPWARD_SHIFT_V26 = False
_NASAL_BUNDLE_ADDITIONAL_UPWARD_SHIFT = 0.004
_CHEEK_LONG_ARC_ALAR_ORIGIN_V27 = False
_CHEEK_LONG_ARC_LAYERED_BLUE_TRACE_V28 = False
_NASAL_BUNDLE_MID_NOSE_BLUE_TRACE_V29 = False
_NASAL_BUNDLE_EXPANDED_SPACING_V30 = False
_NASAL_BUNDLE_RIGID_UPWARD_SHIFT_V31 = False
_CHEEK_LONG_ARC_EXPANDED_SPACING_V32 = False
_CHEEK_LONG_ARC_BLUE_DIRECTION_V33 = False
_CHEEK_LONG_ARC_BLUE_SPACING_V34 = False
_CHEEK_LONG_ARC_BLUE_ADDITIONAL_SPACING_V35 = False
_CHEEK_LONG_ARC_BLUE_BOUNDARY_COVERAGE_V36 = False
_PERIORAL_CONTINUOUS_FAN_V37 = False
_REMOVED_PERIORAL_CONTINUOUS_FAN_V37 = "removed_perioral_continuous_fan_v37"
_PERIORAL_VORTEX_FAN_V38 = False
_CHEEK_SEPARATRIX_PROJECTION_CLEARANCE_V39 = False
_GLABELLA_UPWARD_EXTENSION_V40 = False
_CHEEK_LONG_ARC_LATERAL_DENSITY_V41 = False
_CHEEK_LONG_ARC_DENSITY_REGION_V41 = "cheek_long_arc_density_v41"
_CHEEK_LONG_ARC_FULL_DENSITY_V42 = False
_CHEEK_LONG_ARC_REDUCED_DENSITY_V43 = False
_CHEEK_LOWER_DIVERGENT_ARCS_V44 = False
_CHEEK_LOWER_DIVERGENT_ARC_REGION_V44 = "cheek_lower_divergent_arc_v44"
_CHEEK_ALAR_ORIGIN_SPACING_V45 = False
_CHEEK_ALAR_BOUNDARY_ANCHORS_V46 = False
_CHEEK_LONG_ARC_TEN_LINE_DENSITY_V47 = False
_REMOVED_CHEEK_LONG_ARC_DENSITY_V47 = "removed_cheek_long_arc_density_v47"
_PERIORAL_CHIN_CONTINUITY_V48 = False
_REMOVED_PERIORAL_CHIN_FRAGMENT_V48 = "removed_perioral_chin_fragment_v48"
_PERIORAL_COMMISSURE_SWIRL_V49 = False
_PERIORAL_COMMISSURE_SWIRL_REGION_V49 = "perioral_commissure_swirl_v49"
_PERIORAL_COMMISSURE_FOCUS_V50 = False
_PERIORAL_COMMISSURE_RADIAL_REGION_V50 = "perioral_commissure_radial_v50"
_PERIORAL_COMMISSURE_PIXEL_CLEARANCE_V51 = False
_PERIORAL_COMMISSURE_STROKE_CLEARANCE_V52 = False
_CHEEK_GAP_DENSITY_V53 = False
_CHEEK_GAP_DENSITY_REGION_V53 = "cheek_gap_density_v53"
_CHEEK_GAP_BRIDGE_CONTINUITY_V54 = False
_CHEEK_GAP_NASAL_TIP_EXTENSION_V55 = False
_CHEEK_NASAL_TRANSITION_DENSITY_V56 = False
_CHEEK_NASAL_TRANSITION_DENSITY_REGION_V56 = "cheek_nasal_transition_density_v56"
_SUPERIOR_ORBITAL_LATERAL_TAIL_REMOVAL_V57 = False
_SUPERIOR_ORBITAL_GUIDE_REMOVAL_V58 = False
_REMOVED_SUPERIOR_ORBITAL_GUIDE_V58 = "removed_superior_orbital_guide_v58"
_ORBITAL_BROW_DENSITY_EXTENSION_V59 = False
_ORBITAL_BROW_MEDIAL_ENDPOINT_EXTENSION_V60 = False
_ORBITAL_BROW_MEDIAL_LONGER_EXTENSION_V61 = False
_FOREHEAD_FOURTEEN_ARCHED_DENSITY_V62 = False
_FOREHEAD_RIGID_DOWNWARD_SHIFT_V63 = False
_FOREHEAD_ADDITIONAL_DOWNWARD_SHIFT_V64 = False
_LATERAL_CANTHUS_SHORT_ARCS_V65 = False

_NASAL_BUNDLE_LAYER_SPACING_V30 = 0.015
_NASAL_BUNDLE_OUTER_X_STEP_V30 = 0.004
_NASAL_BUNDLE_INNER_X_STEP_V30 = 0.0105
_NASAL_BUNDLE_RIGID_UPWARD_SHIFT_AMOUNT_V31 = 0.030
_CHEEK_LONG_ARC_LAYER_SPACING_INCREMENT_V32 = 0.002
_CHEEK_LONG_ARC_BLUE_SPACING_INCREMENT_V34 = 0.001
_CHEEK_LONG_ARC_BLUE_ADDITIONAL_SPACING_INCREMENT_V35 = 0.0005
_CHEEK_LONG_ARC_BLUE_BOUNDARY_OFFSETS_V36 = (
    -0.016,
    -0.012,
    -0.008,
    -0.004,
    0.0,
    0.0005,
    0.001,
    0.0015,
    0.002,
)
_PERIORAL_REPLACED_SOURCE_INDICES_V37 = frozenset(
    {28, 29, 30, 31, 37, 40, 50, 53, 57, 58, 72, 73}
)
_CHEEK_SEPARATRIX_PROJECTION_OFFSETS_V39 = (
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.006,
    0.012,
    0.018,
)
_CHEEK_SEPARATRIX_PROJECTION_TAPER_END_V39 = 0.52
_GLABELLA_FOREHEAD_CLEARANCE_V40 = 0.010
_CHEEK_DENSITY_SAMPLES_V41 = 400
_CHEEK_DENSITY_MIN_LATERAL_GAP_V41 = 0.018
_CHEEK_DENSITY_DOUBLE_GAP_V41 = 0.030
_CHEEK_DENSITY_REDUCED_MIN_LATERAL_GAP_V43 = 0.024
_CHEEK_DENSITY_TRIM_GAP_V41 = 0.018
_CHEEK_DENSITY_TRIM_GAP_DOUBLE_V41 = 0.027
_CHEEK_DENSITY_MIN_LENGTH_V41 = 0.05
_CHEEK_GAP_UPPER_MAX_X_V53 = 0.310
_CHEEK_GAP_MIDDLE_RANGE_V53 = (0.02, 0.82)
_CHEEK_GAP_LOWER_RANGE_V53 = (0.08, 0.88)
_CHEEK_GAP_MIDDLE_RANGE_V55 = (0.02, 1.00)
_CHEEK_GAP_LOWER_RANGE_V55 = (0.08, 1.00)
_CHEEK_GAP_UPPER_BOUNDARY_LATERAL_SHIFT_V55 = 0.0045
_CHEEK_GAP_LOWER_BOUNDARY_LATERAL_SHIFT_V55 = 0.008
_CHEEK_GAP_UPPER_TAPER_V55 = (0.70, 0.96)
_CHEEK_GAP_LOWER_TAPER_V55 = (0.70, 0.96)
_CHEEK_NASAL_TRANSITION_CORNER_SHIFT_V56 = 0.008
_CHEEK_NASAL_TRANSITION_DENSITY_FRACTIONS_V56 = (1.0 / 3.0, 2.0 / 3.0)
_CHEEK_NASAL_TRANSITION_END_X_V56 = (0.402, 0.392)
_SUPERIOR_ORBITAL_LATERAL_START_X_V57 = 0.24
_ORBITAL_BROW_OUTER_EXTENSION_V59 = 0.020
_ORBITAL_BROW_INNER_EXTENSION_V59 = 0.005
_ORBITAL_BROW_BOTTOM_EXPANSION_V59 = 0.003
_ORBITAL_BROW_MEDIAL_ADDITIONAL_EXTENSION_V60 = 0.020
_ORBITAL_BROW_FOREHEAD_CLEARANCE_V60 = 0.0015
_ORBITAL_BROW_MEDIAL_EXTENSION_RANGE_V61 = (0.0085, 0.0105)
_FOREHEAD_ARCHED_LEVELS_V62 = (
    0.040000,
    0.052305,
    0.063020,
    0.072459,
    0.081735,
    0.090628,
    0.098975,
    0.107284,
    0.115521,
    0.123676,
    0.131700,
    0.139598,
    0.147298,
    0.155000,
)
_FOREHEAD_ARCHED_CROWN_RISE_V62 = 0.030
_FOREHEAD_RIGID_DOWNWARD_AMOUNT_V63 = 0.012
_FOREHEAD_TOTAL_DOWNWARD_AMOUNT_V64 = 0.037
_LATERAL_CANTHUS_NEW_START_X_V65 = 0.030
_LATERAL_CANTHUS_NEW_END_X_V65 = 0.205
_LATERAL_CANTHUS_UNDEREYE_START_X_V65 = 0.030
_LATERAL_CANTHUS_UNDEREYE_BLEND_X_V65 = 0.235
_LATERAL_CANTHUS_UNDEREYE_OUTER_Y_V65 = (0.390, 0.410, 0.427)
_LATERAL_CANTHUS_SHORT_ARC_REGION_V65 = "lateral_canthus_short_arc_v65"
_CHEEK_GAP_BRIDGE_SHIFT_V54 = 0.006
_CHEEK_GAP_BRIDGE_WINDOW_V54 = (0.26, 0.48)
_CHEEK_GAP_BRIDGE_ROOT_OFFSET_V54 = 0.010
_CHEEK_LOWER_FAN_CLEARANCE_OFFSETS_V44 = (0.003, 0.006, 0.009)
_CHEEK_LOWER_DIVERGENT_BLEND_V44 = ((0.33, 0.40), (0.67, 0.80))
_CHEEK_ALAR_ORIGIN_ADDITIONAL_OFFSETS_V45 = (0.004, 0.008, 0.012)
_CHEEK_ALAR_ORIGIN_HOLD_END_V45 = 0.10
_CHEEK_ALAR_ORIGIN_TAPER_END_V45 = 0.42
_CHEEK_LOWER_DIVERGENT_BLEND_SPACED_V45 = ((0.28, 0.40), (0.72, 0.80))
_CHEEK_ALAR_ATTACHMENT_X_V46 = 0.409
_CHEEK_ALAR_ATTACHMENT_GAP_V46 = 0.006
_CHEEK_ALAR_ATTACHMENT_MAX_Y_V46 = 0.528
_CHEEK_ALAR_ATTACHMENT_JOIN_FRACTION_V46 = 0.14
_PERIORAL_CHIN_FRAGMENT_INDICES_V48 = frozenset({78, 80, 82, 83, 85, 86, 87})
_PERIORAL_CHIN_TARGETS_V48 = (
    (0.267, 0.928),
    (0.275, 0.936),
    (0.283, 0.944),
)
_PERIORAL_SWIRL_CHANNELS_V49 = (
    ((0.335, 0.705), (0.328, 0.708), (0.322, 0.722)),
    ((0.354, 0.693), (0.351, 0.6985), (0.337, 0.710), (0.329, 0.726)),
    ((0.367, 0.6885), (0.3535, 0.7005), (0.344, 0.710), (0.336, 0.730)),
    ((0.384, 0.685), (0.369, 0.6925), (0.359, 0.7005), (0.3505, 0.711), (0.343, 0.734)),
    (
        (0.402, 0.684),
        (0.389, 0.6865),
        (0.381, 0.690),
        (0.364, 0.700),
        (0.358, 0.712),
        (0.350, 0.738),
    ),
)
_PERIORAL_SWIRL_CORRIDOR_WAYPOINTS_V49 = (
    (0.300, 0.762),
    (0.308, 0.768),
    (0.316, 0.774),
    (0.324, 0.780),
    (0.332, 0.786),
)
_PERIORAL_SWIRL_TARGETS_V49 = (
    (0.268, 0.920),
    (0.27225, 0.9255),
    (0.2765, 0.931),
    (0.28075, 0.9365),
    (0.285, 0.942),
)
_PERIORAL_COMMISSURE_RADIAL_GUIDES_V50 = (
    ((0.318, 0.665), (0.334, 0.666), (0.346, 0.680), (0.352, 0.690)),
    ((0.313, 0.682), (0.330, 0.681), (0.348, 0.689), (0.356, 0.699)),
    ((0.311, 0.703), (0.330, 0.699), (0.350, 0.701), (0.358, 0.706)),
    ((0.313, 0.727), (0.332, 0.726), (0.350, 0.720), (0.358, 0.715)),
    ((0.318, 0.748), (0.335, 0.744), (0.347, 0.731), (0.354, 0.724)),
)
_PERIORAL_COMMISSURE_RADIAL_GUIDES_V51 = (
    ((0.318, 0.665), (0.326, 0.666), (0.333, 0.680), (0.336, 0.690)),
    ((0.313, 0.682), (0.322, 0.683), (0.328, 0.692), (0.334, 0.699)),
    ((0.308, 0.703), (0.312, 0.702), (0.312, 0.704), (0.316, 0.706)),
    ((0.304, 0.727), (0.311, 0.725), (0.315, 0.719), (0.319, 0.715)),
    ((0.300, 0.748), (0.301, 0.744), (0.303, 0.738), (0.305, 0.733)),
)
_PERIORAL_COMMISSURE_RADIAL_GUIDES_V52 = (
    _PERIORAL_COMMISSURE_RADIAL_GUIDES_V51[0],
    _PERIORAL_COMMISSURE_RADIAL_GUIDES_V51[1],
    ((0.302, 0.703), (0.306, 0.702), (0.306, 0.704), (0.310, 0.706)),
    _PERIORAL_COMMISSURE_RADIAL_GUIDES_V51[3],
    ((0.293, 0.748), (0.294, 0.744), (0.296, 0.738), (0.298, 0.733)),
)
_PERIORAL_COMMISSURE_RADIAL_TRIM_RANGES_V52 = (
    (0.00, 0.50),
    (0.00, 0.72),
    (0.00, 1.00),
    (0.00, 0.58),
    (0.00, 1.00),
)

_CHEEK_LONG_ARC_BLUE_DIRECTION_GUIDES_V33 = (
    ((0.417200, 0.460419), (0.292933, 0.513627), (0.173331, 0.564537), (0.044693, 0.601785)),
    ((0.405392, 0.479462), (0.291911, 0.535017), (0.172419, 0.582145), (0.050226, 0.621060)),
    ((0.410495, 0.504374), (0.295349, 0.562893), (0.179646, 0.622263), (0.064468, 0.665740)),
    ((0.408874, 0.520917), (0.297630, 0.589398), (0.185239, 0.664224), (0.068487, 0.706127)),
    ((0.415731, 0.541346), (0.315564, 0.620425), (0.233218, 0.725630), (0.112934, 0.767235)),
)

_CHEEK_LONG_ARC_LAYERED_GUIDES_V28 = (
    ((0.404277, 0.478205), (0.251535, 0.501776)),
    ((0.402388, 0.492662), (0.274949, 0.541135)),
    ((0.407119, 0.510781), (0.271815, 0.570916)),
    ((0.407494, 0.530903), (0.275548, 0.587633)),
)

_NASAL_BUNDLE_MID_NOSE_GUIDES_V29 = (
    (
        (0.493097, 0.389500),
        (0.452000, 0.335000),
        (0.210000, 0.370000),
        (0.071345, 0.381241),
    ),
    (
        (0.493782, 0.419736),
        (0.454000, 0.365000),
        (0.211000, 0.395000),
        (0.069074, 0.402216),
    ),
)

_INFRAORBITAL_WAVE_LEFT_ANCHORS_V25 = (
    (
        (0.112808, 0.339242),
        (0.155829, 0.346069),
        (0.198851, 0.346545),
        (0.241872, 0.351236),
        (0.284893, 0.356082),
        (0.327915, 0.353311),
        (0.370936, 0.340302),
        (0.413957, 0.328401),
        (0.456979, 0.318937),
        (0.500000, 0.315235),
    ),
    (
        (0.098177, 0.361145),
        (0.142824, 0.361515),
        (0.187471, 0.363804),
        (0.232118, 0.367848),
        (0.276765, 0.376867),
        (0.321412, 0.374448),
        (0.366059, 0.364059),
        (0.410706, 0.342145),
        (0.455353, 0.331864),
        (0.500000, 0.331223),
    ),
)


@dataclass
class Curve:
    region: str
    points: np.ndarray


def resample(points: np.ndarray, spacing: float = 0.004) -> np.ndarray:
    segment = np.linalg.norm(np.diff(points, axis=0), axis=1)
    cumulative = np.r_[0.0, np.cumsum(segment)]
    length = float(cumulative[-1])
    if length <= 1e-10:
        return points[:1].copy()
    count = max(4, int(np.ceil(length / spacing)) + 1)
    target = np.linspace(0.0, length, count)
    return np.column_stack(
        [np.interp(target, cumulative, points[:, axis]) for axis in range(2)]
    )


def mirror(points: np.ndarray) -> np.ndarray:
    out = points.copy()
    out[:, 0] = 1.0 - out[:, 0]
    return out


class RasterDirectionField:
    """Bilinear sampler for the standard image's unsigned double-angle field."""

    def __init__(self, payload: dict[str, object]):
        self.cos2 = np.asarray(payload["cos2"], dtype=np.float64)
        self.sin2 = np.asarray(payload["sin2"], dtype=np.float64)
        self.confidence = np.asarray(payload["confidence"], dtype=np.float64)
        if self.cos2.shape != self.sin2.shape or self.cos2.shape != self.confidence.shape:
            raise ValueError("direction-field arrays must have identical shapes")
        self.height, self.width = self.cos2.shape

    def _sample(self, grid: np.ndarray, p: np.ndarray) -> float:
        x = float(np.clip(p[0] * self.width - 0.5, 0, self.width - 1))
        y = float(np.clip(p[1] * self.height - 0.5, 0, self.height - 1))
        x0, y0 = int(math.floor(x)), int(math.floor(y))
        x1, y1 = min(x0 + 1, self.width - 1), min(y0 + 1, self.height - 1)
        tx, ty = x - x0, y - y0
        return float(
            (1 - ty) * ((1 - tx) * grid[y0, x0] + tx * grid[y0, x1])
            + ty * ((1 - tx) * grid[y1, x0] + tx * grid[y1, x1])
        )

    def direction(self, p: np.ndarray) -> np.ndarray:
        theta = 0.5 * math.atan2(self._sample(self.sin2, p), self._sample(self.cos2, p))
        return np.array([math.cos(theta), math.sin(theta)], dtype=np.float64)

    def quality(self, p: np.ndarray) -> float:
        return self._sample(self.confidence, p)


class SpatialHash:
    def __init__(self, cell: float):
        self.cell = cell
        self.points: dict[tuple[int, int], list[np.ndarray]] = {}

    def _key(self, p: np.ndarray) -> tuple[int, int]:
        return int(p[0] / self.cell), int(p[1] / self.cell)

    def add(self, p: np.ndarray) -> None:
        self.points.setdefault(self._key(p), []).append(p.copy())

    def too_close(self, p: np.ndarray, distance: float) -> bool:
        kx, ky = self._key(p)
        radius = max(1, int(math.ceil(distance / self.cell)))
        distance2 = distance * distance
        for ix in range(kx - radius, kx + radius + 1):
            for iy in range(ky - radius, ky + radius + 1):
                for q in self.points.get((ix, iy), ()):
                    if float(np.dot(p - q, p - q)) < distance2:
                        return True
        return False


def _standard_mask(p: np.ndarray) -> bool:
    """Half-face skin mask; eye and mouth apertures remain empty."""
    x, y = float(p[0]), float(p[1])
    if x < 0.055 or x > 0.5005 or y < _FOREHEAD_MIN_Y or y > 0.995:
        return False
    if ((x - 0.5) / 0.465) ** 2 + ((y - 0.515) / 0.505) ** 2 > 1.0:
        return False
    if _FACE_POLYGON is not None:
        point = (x, y)
        reflected = (1.0 - x, y)
        if cv2.pointPolygonTest(_FACE_POLYGON, point, False) < 0:
            return False
        if cv2.pointPolygonTest(_FACE_POLYGON, reflected, False) < 0:
            return False
    eye_rx, eye_ry = ((0.115, 0.026) if _UPPER_FACE_INDEPENDENT_FAMILIES else (0.125, 0.047))
    if ((x - 0.300) / eye_rx) ** 2 + ((y - 0.319) / eye_ry) ** 2 < 1.0:
        return False
    if ((x - 0.500) / 0.140) ** 2 + ((y - 0.711) / 0.036) ** 2 < 1.0:
        return False
    glabella_left = 0.385 if _UPPER_FACE_INDEPENDENT_FAMILIES else 0.405
    glabella_top = 0.140 if _UPPER_FACE_INDEPENDENT_FAMILIES else 0.205
    if _GLABELLA_BLUE_LOCAL_REVISION and x >= glabella_left and glabella_top <= y <= 0.325:
        return False
    if _NASAL_BRIDGE_TURNDOWN_V9 and x >= 0.385 and 0.325 < y < 0.505:
        # Mid-bridge band: traced lines stop at the flank so the explicit
        # crest-and-descend hook family can take over without collisions.
        return False
    if _NOSTRIL_APERTURE_MASK_V9 and (
        ((x - 0.405) / 0.034) ** 2 + ((y - 0.530) / 0.052) ** 2 < 1.0
    ):
        # Nostril aperture: like the eye and mouth apertures, the nostril
        # openings and alar rims stay empty (user: philtrum lines must not
        # reach the nostrils). Covers the alar groove top down to the alar
        # base. Mirroring covers the other side.
        return False
    if _NOSE_ROOT_HORIZONTAL_PATCH and x >= 0.395 and 0.325 <= y <= 0.405:
        return False
    return True


def _aligned(raw: np.ndarray, reference: np.ndarray) -> np.ndarray:
    return -raw if float(np.dot(raw, reference)) < 0 else raw


def _in_cheek_smoothing_zone(p: np.ndarray) -> bool:
    distance = abs(float(p[0]) - 0.5)
    return 0.09 <= distance <= 0.45 and 0.35 <= float(p[1]) <= 0.85


def _in_chin_smoothing_zone(p: np.ndarray) -> bool:
    distance = abs(float(p[0]) - 0.5)
    return distance <= 0.37 and 0.70 <= float(p[1]) <= 0.995


def _in_alar_smoothing_zone(p: np.ndarray) -> bool:
    distance = abs(float(p[0]) - 0.5)
    return 0.04 <= distance <= 0.17 and 0.34 <= float(p[1]) <= 0.70


def _in_philtrum_smoothing_zone(p: np.ndarray) -> bool:
    distance = abs(float(p[0]) - 0.5)
    return distance <= 0.15 and 0.50 <= float(p[1]) <= 0.74


def _in_nose_smoothing_zone(p: np.ndarray) -> bool:
    distance = abs(float(p[0]) - 0.5)
    return distance <= 0.13 and 0.28 <= float(p[1]) <= 0.62


def _in_curvature_limited_zone(p: np.ndarray) -> bool:
    return (
        _in_cheek_smoothing_zone(p)
        or _in_chin_smoothing_zone(p)
        or _in_alar_smoothing_zone(p)
        or _in_philtrum_smoothing_zone(p)
        or _in_nose_smoothing_zone(p)
    )


def _limit_tangent_turn(previous: np.ndarray, target: np.ndarray, max_degrees: float) -> np.ndarray:
    """Rotate toward ``target`` without concentrating curvature in one integration step."""
    target = _aligned(target, previous)
    cross = float(previous[0] * target[1] - previous[1] * target[0])
    dot = float(np.clip(np.dot(previous, target), -1.0, 1.0))
    angle = float(np.clip(math.atan2(cross, dot), -math.radians(max_degrees), math.radians(max_degrees)))
    cosine, sine = math.cos(angle), math.sin(angle)
    return np.array(
        [cosine * previous[0] - sine * previous[1], sine * previous[0] + cosine * previous[1]],
        dtype=np.float64,
    )


def constrained_smooth(
    points: np.ndarray,
    iterations: int,
    max_displacement: float,
) -> np.ndarray:
    """Laplacian-smooth a curve while fixing endpoints and bounding anatomical drift."""
    original = points.copy()
    result = points.copy()
    for _ in range(iterations):
        candidate = result.copy()
        candidate[1:-1] = 0.25 * result[:-2] + 0.5 * result[1:-1] + 0.25 * result[2:]
        displacement = candidate - original
        distance = np.linalg.norm(displacement, axis=1)
        scale = np.minimum(1.0, max_displacement / np.maximum(distance, 1e-12))
        result = original + displacement * scale[:, None]
        result[[0, -1]] = original[[0, -1]]
    return result


def _trace_half(
    seed: np.ndarray,
    field: RasterDirectionField,
    spatial: SpatialHash,
    sign: float,
    step: float,
    separation: float,
    max_steps: int = 360,
) -> list[np.ndarray]:
    points = [seed.copy()]
    p = seed.copy()
    previous = sign * field.direction(p)
    for _ in range(max_steps):
        raw_mid = _aligned(field.direction(p + 0.5 * step * previous), previous)
        raw_mid /= max(float(np.linalg.norm(raw_mid)), 1e-9)
        direction = (
            _limit_tangent_turn(previous, raw_mid, 2.5)
            if _in_curvature_limited_zone(p)
            else raw_mid
        )
        if float(np.dot(direction, previous)) < math.cos(math.radians(52.0)):
            break
        nxt = p + step * direction
        if (
            not _standard_mask(nxt)
            or spatial.too_close(nxt, 0.54 * separation)
        ):
            break
        # Prevent tight loops caused by uncertain orientation around junctions.
        if len(points) > 14:
            old = np.asarray(points[:-10])
            if np.any(np.linalg.norm(old - nxt, axis=1) < 2.2 * step):
                break
        points.append(nxt.copy())
        p, previous = nxt, direction
    return points


def _segments_cross(a: np.ndarray, b: np.ndarray, c: np.ndarray, d: np.ndarray) -> bool:
    def orient(p: np.ndarray, q: np.ndarray, r: np.ndarray) -> float:
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    return orient(a, b, c) * orient(a, b, d) < 0.0 and orient(c, d, a) * orient(c, d, b) < 0.0


def _trim_at_crossing(points: np.ndarray, obstacle: np.ndarray) -> np.ndarray | None:
    """Cut a curve at the segment where it crosses ``obstacle`` and keep the
    longer remaining piece, so the crow's-feet fan keeps its density instead
    of losing the whole strand. Returns ``None`` when nothing worth keeping
    is left.
    """
    for index in range(len(points) - 1):
        a, b = points[index], points[index + 1]
        for c, d in zip(obstacle[:-1], obstacle[1:]):
            if _segments_cross(a, b, c, d):
                first, second = points[: index + 1], points[index + 1 :]
                chosen = first if len(first) >= len(second) else second
                return chosen if len(chosen) >= 9 else None
    return points


def _trim_at_crossing_prefer_medial(
    points: np.ndarray,
    obstacle: np.ndarray,
) -> np.ndarray | None:
    """Cut at ``obstacle`` and keep the half-face fragment nearer the midline."""
    for index in range(len(points) - 1):
        a, b = points[index], points[index + 1]
        for c, d in zip(obstacle[:-1], obstacle[1:]):
            if _segments_cross(a, b, c, d):
                first, second = points[: index + 1], points[index + 1 :]
                if float(np.mean(first[:, 0])) >= float(np.mean(second[:, 0])):
                    medial, lateral = first, second
                else:
                    medial, lateral = second, first
                medial_length = float(
                    np.sum(np.linalg.norm(np.diff(medial, axis=0), axis=1))
                )
                if len(medial) >= 4 and medial_length >= 0.018:
                    return medial
                return lateral if len(lateral) >= 9 else None
    return points


def _nostril_top_y(x: float) -> float:
    """Upper boundary y of the nostril aperture ellipse at a given x."""
    t = (x - 0.405) / 0.034
    if abs(t) >= 1.0:
        return math.inf
    return 0.530 - 0.052 * math.sqrt(max(0.0, 1.0 - t * t))


def _crest_clothoid(
    p0: np.ndarray, theta0: float, turn: float, length: float, samples: int = 64
) -> np.ndarray:
    """Curvature-ramped crest: the heading moves from ``theta0`` to
    ``theta0 + turn`` quadratically along the arc, so curvature grows linearly
    from zero and the audited outer part of the crest stays gentle.
    """
    s = np.linspace(0.0, length, samples)
    theta = theta0 + turn * (s / max(length, 1e-9)) ** 2
    steps = np.diff(s, prepend=s[0])
    points = np.empty((samples, 2), dtype=np.float64)
    points[:, 0] = p0[0] + np.cumsum(np.cos(theta) * steps)
    points[:, 1] = p0[1] + np.cumsum(np.sin(theta) * steps)
    points[0] = p0
    return points


def _solve_crest_length(
    p0: np.ndarray,
    theta0: float,
    turn: float,
    target_dx: float,
    min_length: float = 0.104,
    tol: float = 1e-4,
) -> np.ndarray:
    """Solve the crest arc length for a prescribed horizontal travel. The
    floor keeps the arc gentle enough for the audited turn window.
    """
    length = max(target_dx / 0.72, min_length)
    points = _crest_clothoid(p0, theta0, turn, length)
    for _ in range(6):
        dx = float(points[-1, 0] - p0[0])
        if abs(dx - target_dx) < tol or dx <= 1e-6:
            break
        new_length = length * target_dx / dx
        if new_length < min_length:
            length = min_length
            points = _crest_clothoid(p0, theta0, turn, length)
            break
        length = new_length
        points = _crest_clothoid(p0, theta0, turn, length)
    return points


def _apply_nasal_bridge_turndown(curves: list[Curve]) -> list[Curve]:
    """User-annotated nasal-root/bridge topology (v9).

    - the nasal-root vertical fan is suppressed upstream (user blue box);
    - a few complete cross-face lines run over the nasal root WITHOUT ever
      passing over the eyeball: the top line stays above the eye aperture,
      the lower two run below it on real traced strands (user green/blue
      lines, upper block);
    - mid-bridge side lines crest and turn down inside the ramped direction
      field just like the standard; instead of packing to the philtrum they
      are truncated at staggered depths so each side line stops at the
      bridge, mirrored, without crossing the midline (user green lines,
      mid block). Central curtain strands keep only the tip core below.
    """

    stoppers: list[tuple[float, np.ndarray]] = []
    kept: list[Curve] = []
    for curve in curves:
        points = curve.points
        if points[0, 0] > points[-1, 0]:
            points = points[::-1]
        outer, inner = points[0], points[-1]
        forehead_clearance_curve = (
            _ORBITAL_BROW_UPTURN_V11
            and not _ORBITAL_BROW_FOREHEAD_CLEARANCE_V12
            and curve.region
            in {
                "forehead",
                "forehead_extended",
                "forehead_extended_v2",
                "forehead_extended_v3",
                "forehead_curved_v4",
                "forehead_scalp_arc_v5",
            }
        )
        at_edge = (
            0.372 <= float(inner[0]) <= 0.400
            and not forehead_clearance_curve
        )
        long_lateral = outer[0] <= 0.30 and len(points) >= 9
        if at_edge and 0.320 <= float(inner[1]) <= 0.512 and long_lateral:
            stoppers.append((float(inner[1]), points))
        elif (at_edge and 0.240 <= float(inner[1]) <= 0.512) or (
            0.372 <= float(outer[0]) <= 0.400 and 0.240 <= float(outer[1]) <= 0.512
        ):
            continue  # mask-edge fragment; dropped to avoid dangling endpoints
        else:
            kept.append(curve)

    # Crest hooks: an evenly spaced subset of the arrivals (matching the
    # standard's ~6 fine hooks per side) is continued over the crest and down
    # the bridge by a curvature-ramped clothoid that starts on the arrival's
    # own heading (kink-free) and turns gently into vertical, then stops at a
    # staggered depth. The rest stay as natural approach stubs at the flank.
    ordered = sorted(stoppers)
    # The two arrivals running lowest beside the root already pass the eye
    # zone below the aperture: their traced bases become the lower pair of
    # the upper block. Trim each where it reaches the connector level and
    # bridge it over the nasal root with a tangent-matched connector, so each
    # becomes one complete bridge-crossing line that never crosses the
    # eyeball (user's blue annotation on man.jpg).
    cross_strands = ordered[:2]
    hook_stoppers = ordered[2:]
    total = len(hook_stoppers)
    keep_count = min(6, total)
    keep_indices = (
        {int(round(i)) for i in np.linspace(0, total - 1, keep_count)} if total else set()
    )
    rebuilt: list[Curve] = []
    crest_rank = 0
    for rank, (inner_y, points) in enumerate(hook_stoppers):
        p0 = points[-1]
        tail = points[-1] - points[-2]
        theta0 = float(math.atan2(tail[1], tail[0]))
        # Crest hooks only come from rising arrivals: they share one turn
        # schedule, so every crest is nearly a translate of the same gentle
        # arc. Crest-end |dx| DECREASES with arrival height, which provably
        # keeps the nested family free of crossings. Each hook ends right
        # after turning into vertical - the line "gradually turns down into
        # vertical and stops at the bridge".
        if rank in keep_indices and theta0 < -0.05 and inner_y <= 0.470:
            # After the crest turns into vertical, the line keeps descending:
            # the turn-down |dx| INCREASES with arrival height while the
            # descent depth DECREASES, so upper hooks dive deepest next to the
            # midline and lower hooks end earlier farther out - the nested
            # funnel of the standard, provably free of crossings. The sweep is
            # measured from the actual bend start (not the mask edge), and the
            # base is trimmed back whenever the window-safe minimum arc length
            # would otherwise overshoot the target. Descents stop above the
            # tip zone so no hook ever touches the tip core.
            end_dx = 0.030 + 0.009 * crest_rank
            floor_sweep = 0.084
            cut = int(np.searchsorted(points[:, 0], 0.385, side="right"))
            cut = min(max(cut, 2), len(points))
            base = points[:cut]
            if (0.5 - end_dx) - float(base[-1, 0]) < floor_sweep:
                start_x = (0.5 - end_dx) - floor_sweep
                cut = int(np.searchsorted(points[:, 0], start_x, side="right"))
                cut = min(max(cut, 2), len(points))
                base = points[:cut]
            p0 = base[-1]
            bend = _solve_crest_length(
                p0, -0.35, math.radians(90.0) + 0.35, (0.5 - end_dx) - float(p0[0])
            )
            # The crest and its descent must stay out of the nostril aperture:
            # truncate the arc at the ellipse rim (not just drop interior
            # points, which would let resampling interpolate across the gap),
            # and cap the descent just above it.
            rim = ((bend[:, 0] - 0.405) / 0.034) ** 2 + ((bend[:, 1] - 0.530) / 0.052) ** 2
            inside = np.nonzero(rim < 1.0)[0]
            if len(inside):
                bend = bend[: inside[0]]
            if len(bend) < 4:
                hook = base
            else:
                top = bend[-1]
                target_y = min(0.500 - 0.004 * crest_rank, 0.540)
                target_y = min(target_y, _nostril_top_y(float(top[0])) - 0.006)
                if target_y > float(top[1]) + 1e-6:
                    descent_y = np.linspace(top[1], target_y, 8)[1:]
                    descent = np.column_stack([np.full_like(descent_y, top[0]), descent_y])
                    hook = np.vstack([base[:-1], bend, descent])
                else:
                    # The crest already ends at or below the safe cap: no
                    # descent is appended, so nothing ever dips into the
                    # nostril aperture.
                    hook = np.vstack([base[:-1], bend])
                crest_rank += 1
        else:
            hook = points
        rebuilt.append(Curve("nose_side_downturn_v9", resample(hook)))
    print(f"[turndown] stoppers={total} crest_hooks={crest_rank}")

    # Upper block (user green/blue lines): complete cross-face lines that
    # never pass over the eyeball. The top line stays above the eye aperture;
    # the lower two use the real traced strands whose bases already run below
    # the aperture, bridged over the nasal root with a tangent-matched
    # connector, so each becomes one complete bridge-crossing line that is
    # safe on open eyes too (user's blue annotation on man.jpg).
    cross: list[Curve] = []
    levels = (
        (0.256, 0.268, 0.272),
    )
    for y_root, y_canthus, y_temple in levels:
        x = np.linspace(0.075, CENTER_X, 160)
        y = np.empty_like(x)
        left = x <= 0.19
        t_left = (x[left] - 0.075) / 0.115
        y[left] = y_temple + (y_canthus - y_temple) * (3.0 * t_left**2 - 2.0 * t_left**3)
        t_right = (x[~left] - 0.19) / 0.31
        y[~left] = y_canthus + (y_root - y_canthus) * (
            3.0 * t_right**2 - 2.0 * t_right**3
        )
        cross.append(Curve("nose_root_cross_v9", resample(np.column_stack([x, y]))))
    for (inner_y, points), cut_x, y_root in zip(cross_strands, (0.345, 0.355), (0.348, 0.365), strict=True):
        cut = int(np.searchsorted(points[:, 0], cut_x, side="right"))
        cut = min(max(cut, 2), len(points) - 1)
        base = points[:cut]
        tail = base[-1] - base[-2]
        heading = math.atan2(float(tail[1]), float(tail[0]))
        p0 = base[-1]
        p3 = np.array([CENTER_X, y_root])
        direction = np.array([math.cos(heading), math.sin(heading)])
        t = np.linspace(0.0, 1.0, 40)[:, None]
        p1 = p0 + direction * 0.045
        p2 = p3 - np.array([0.040, 0.0])
        connector = (
            (1 - t) ** 3 * p0
            + 3 * (1 - t) ** 2 * t * p1
            + 3 * (1 - t) * t**2 * p2
            + t**3 * p3
        )
        joined = np.vstack([base[:-1], connector[1:]])
        joined[-1] = p3
        joined = constrained_smooth(joined, iterations=8, max_displacement=0.002)
        cross.append(Curve("nose_root_cross_v9", resample(joined)))

    trimmed_temple = 0
    dropped_temple = 0
    if cross:
        survivors: list[Curve] = []
        for curve in kept:
            if curve.region in {"eyelid_temple", "cheek"}:
                points = curve.points
                hit = False
                for candidate in cross:
                    trimmed = _trim_at_crossing(points, candidate.points)
                    if trimmed is not points:
                        hit = True
                        points = trimmed
                        if points is None:
                            break
                if hit:
                    if points is None:
                        dropped_temple += 1
                        continue
                    trimmed_temple += 1
                    curve = Curve(curve.region, resample(points))
            survivors.append(curve)
        kept = survivors
    print(
        f"[turndown] cross_lines={len(cross)} "
        f"trimmed_temple={trimmed_temple} dropped_temple={dropped_temple}"
    )

    return kept + rebuilt + cross


def _philtrum_nasal_base_y(x: float | np.ndarray) -> float | np.ndarray:
    """Symmetric lower-nose boundary used to stop upper-lip strands.

    The columella is lower at the midline (larger normalized y), while the
    alar base rises gently toward either side.  Values are anchored to the
    canonical MediaPipe nose-base landmarks and the user's blue annotation.
    """
    distance = np.minimum(np.abs(np.asarray(x) - CENTER_X), 0.095)
    boundary = 0.585 - 0.24 * distance
    return float(boundary) if np.ndim(boundary) == 0 else boundary


def _boundary_intersection(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Intersect one segment with the philtrum nasal-base boundary."""
    fa = float(a[1] - _philtrum_nasal_base_y(float(a[0])))
    fb = float(b[1] - _philtrum_nasal_base_y(float(b[0])))
    denominator = fa - fb
    t = 0.5 if abs(denominator) < 1e-12 else fa / denominator
    return a + np.clip(t, 0.0, 1.0) * (b - a)


def _cubic_bezier(
    p0: np.ndarray,
    p1: np.ndarray,
    p2: np.ndarray,
    p3: np.ndarray,
    count: int,
    t_start: float = 0.0,
    t_end: float = 1.0,
) -> np.ndarray:
    """Sample one cubic segment including both endpoints."""
    t = np.linspace(t_start, t_end, count)[:, None]
    return (
        (1.0 - t) ** 3 * p0
        + 3.0 * (1.0 - t) ** 2 * t * p1
        + 3.0 * (1.0 - t) * t**2 * p2
        + t**3 * p3
    )


def _apply_orbital_brow_upturn(curves: list[Curve]) -> list[Curve]:
    """Replace the flat upper-eye bridge with independent brow upturns.

    The standard diagram and the user's blue overlay show a bilateral family:
    strands arrive from the temple, wrap the superior orbit, and rise beside
    the glabella.  They do not form a left-to-right bridge.  Five nested
    half-curves are built explicitly so the topology is stable across faces.
    """
    retained: list[Curve] = []
    removed_cross = 0
    removed_fragments = 0
    for curve in curves:
        points = curve.points
        upper_cross = (
            curve.region == "nose_root_cross_v9"
            and float(np.min(points[:, 1])) < 0.300
        )
        short_orbital_fragment = (
            curve.region == "eyelid_temple"
            and float(np.min(points[:, 1])) >= 0.230
            and float(np.max(points[:, 1])) <= 0.345
            and float(np.max(points[:, 0])) <= 0.335
        )
        if upper_cross:
            removed_cross += 1
            continue
        if short_orbital_fragment:
            removed_fragments += 1
            continue
        retained.append(curve)

    upturns: list[Curve] = []
    for rank in range(5):
        vertical_x = (
            0.418 + 0.0165 * rank
            if _ORBITAL_BROW_FOREHEAD_CLEARANCE_V12
            else 0.414 + 0.015 * rank
        )
        base_y = 0.245 + 0.0095 * rank
        outer_y = 0.235 + 0.012 * rank
        end_y = (
            0.210 - 0.010 * rank
            if _FOREHEAD_LOWER_LONG_ARCS_V13
            else 0.190 - 0.010 * rank
            if _ORBITAL_BROW_FOREHEAD_CLEARANCE_V12
            else 0.180 - 0.017 * rank
        )
        radius = 0.055
        turn = np.array([vertical_x - radius, base_y])
        orbital = _cubic_bezier(
            np.array([0.075, outer_y]),
            np.array([0.145, outer_y + 0.016]),
            turn - np.array([0.070, 0.0]),
            turn,
            54,
        )
        kappa = 0.5522847498
        bend_end = np.array([vertical_x, base_y - radius])
        bend = _cubic_bezier(
            turn,
            turn + np.array([kappa * radius, 0.0]),
            bend_end + np.array([0.0, kappa * radius]),
            bend_end,
            32,
        )
        if end_y < float(bend_end[1]) - 1e-9:
            vertical_y = np.linspace(float(bend_end[1]), end_y, 14)[1:]
            vertical = np.column_stack(
                [np.full_like(vertical_y, vertical_x), vertical_y]
            )
            points = np.vstack([orbital[:-1], bend, vertical])
        else:
            points = np.vstack([orbital[:-1], bend])
        upturns.append(
            Curve("orbital_brow_upturn_v11", resample(points, spacing=0.0035))
        )
    print(
        f"[orbital-upturn] half_lines={len(upturns)} "
        f"removed_upper_cross={removed_cross} "
        f"removed_short_fragments={removed_fragments}"
    )
    return retained + upturns


def _superior_orbital_guide_v14() -> Curve:
    """One half-line hugging the superior orbital rim without entering the eye.

    The two cubic pieces share a horizontal tangent above the pupil.  Their
    endpoints stay below the brow-upturn family and outside the eye ellipse,
    so this is a genuine additional eyelid-level guide rather than another
    glabellar upturn or a sharp corner at the temple.
    """
    outer = _cubic_bezier(
        np.array([0.055, 0.315]),
        np.array([0.140, 0.315]),
        np.array([0.185, 0.287]),
        np.array([0.300, 0.287]),
        56,
    )
    inner = _cubic_bezier(
        np.array([0.300, 0.287]),
        np.array([0.370, 0.287]),
        np.array([0.420, 0.300]),
        np.array([0.465, 0.318]),
        44,
    )
    points = np.vstack([outer, inner[1:]])
    return Curve("superior_orbital_guide_v14", resample(points, spacing=0.0035))


def _refine_orbital_nasal_turns_v14(curves: list[Curve]) -> tuple[list[Curve], int]:
    """Refine only the four existing under-eye strands that turn beside the nose.

    v8.1.16 already contains the correct dense lower-orbital field.  Replacing
    that field made the candidate visibly sparse.  Here the four strands that
    already have a descending nasal tail are retained up to their natural
    crest, then completed with a tangent-matched cubic.  The surrounding five
    arrivals remain untouched, preserving both density and nesting.
    """
    refined: list[Curve] = []
    refined_count = 0
    for curve in curves:
        points = curve.points
        if curve.region != "nose_side_downturn_v9":
            refined.append(curve)
            continue

        crest_index = int(np.argmin(points[:, 1]))
        descent = float(points[-1, 1] - points[crest_index, 1])
        is_yellow_turn = (
            crest_index >= 3
            and crest_index < len(points) - 3
            and descent >= 0.025
            and float(points[crest_index, 0]) >= 0.395
        )
        if not is_yellow_turn:
            refined.append(curve)
            continue

        base = points[: crest_index + 1]
        p0 = base[-1]
        heading = p0 - base[-2]
        heading /= max(float(np.linalg.norm(heading)), 1e-9)
        target = np.array(
            [
                min(
                    0.488 if _NASAL_TIP_MEDIAL_CONVERGENCE_V17 else 0.474,
                    float(points[-1, 0])
                    + (0.016 if _NASAL_TIP_MEDIAL_CONVERGENCE_V17 else 0.003),
                ),
                min(
                    0.524 if _NASAL_TIP_MEDIAL_CONVERGENCE_V17 else 0.512,
                    float(points[-1, 1])
                    + (0.020 if _NASAL_TIP_MEDIAL_CONVERGENCE_V17 else 0.010),
                ),
            ]
        )
        bend = _cubic_bezier(
            p0,
            p0
            + (0.036 if _NASAL_TIP_MEDIAL_CONVERGENCE_V17 else 0.028)
            * heading,
            target
            - np.array(
                [0.0, 0.040 if _NASAL_TIP_MEDIAL_CONVERGENCE_V17 else 0.030]
            ),
            target,
            48,
        )
        joined = np.vstack([base[:-1], bend])
        refined.append(
            Curve("nose_side_downturn_v9", resample(joined, spacing=0.0035))
        )
        refined_count += 1
    return refined, refined_count


def _nasolabial_mandibular_guide_v14(curves: list[Curve]) -> tuple[list[Curve], Curve]:
    """Join the existing alar-to-mouth and mouth-to-jaw strands into one guide."""
    upper_candidates: list[tuple[float, int, np.ndarray]] = []
    lower_candidates: list[tuple[float, int, np.ndarray]] = []
    for index, curve in enumerate(curves):
        points = curve.points
        if (
            curve.region == "cheek"
            and 0.300 <= float(np.min(points[:, 0])) <= 0.330
            and 0.365 <= float(np.max(points[:, 0])) <= 0.385
            and 0.550 <= float(np.min(points[:, 1])) <= 0.575
            and 0.700 <= float(np.max(points[:, 1])) <= 0.745
        ):
            score = abs(float(np.min(points[:, 1])) - 0.562) + abs(float(np.max(points[:, 1])) - 0.728)
            upper_candidates.append((score, index, points))
        if (
            curve.region in {"chin", "jaw"}
            and 0.240 <= float(np.min(points[:, 0])) <= 0.300
            and 0.345 <= float(np.max(points[:, 0])) <= 0.380
            and 0.720 <= float(np.min(points[:, 1])) <= 0.755
            and 0.900 <= float(np.max(points[:, 1])) <= 0.950
        ):
            score = abs(float(np.min(points[:, 1])) - 0.734) + abs(float(np.max(points[:, 1])) - 0.927)
            lower_candidates.append((score, index, points))
    if not upper_candidates or not lower_candidates:
        raise RuntimeError("expected alar-mouth and mouth-jaw source strands for yellow guide")

    _, upper_index, _ = min(upper_candidates)
    _, lower_index, _ = min(lower_candidates)
    if _PERIORAL_CHEEK_ALAR_ORIGIN_V23:
        alar_to_commissure = _cubic_bezier(
            np.array([0.404080, 0.540858]),
            np.array([0.344548, 0.599851]),
            np.array([0.308762, 0.655179]),
            np.array([0.300218, 0.716922]),
            80,
        )
        second = _cubic_bezier(
            np.array([0.300218, 0.716922]),
            np.array([0.291674, 0.778665]),
            np.array([0.274869, 0.842868]),
            np.array([0.260552, 0.925938]),
            64,
        )
    elif _PERIORAL_CHEEK_SEPARATRIX_V22:
        alar_to_commissure = _cubic_bezier(
            np.array([0.420, 0.590]),
            np.array([0.418, 0.660]),
            np.array([0.330, 0.660]),
            np.array([0.292, 0.711]),
            80,
        )
        second = _cubic_bezier(
            np.array([0.292, 0.711]),
            np.array([0.262126, 0.751094]),
            np.array([0.260, 0.860]),
            np.array([0.265, 0.925]),
            64,
        )
    else:
        alar_to_commissure = _cubic_bezier(
            np.array([0.420, 0.590]),
            np.array([0.420, 0.640]),
            np.array([0.360, 0.660]),
            np.array([0.360, 0.711]),
            80,
        )
        second = _cubic_bezier(
            np.array([0.360, 0.711]),
            np.array([0.360, 0.750]),
            np.array([0.285, 0.840]),
            np.array([0.265, 0.925]),
            64,
        )
    joined = np.vstack([alar_to_commissure, second[1:]])
    retained = [
        curve for index, curve in enumerate(curves) if index not in {upper_index, lower_index}
    ]
    return retained, Curve(
        "nasolabial_mandibular_guide_v14",
        resample(joined, spacing=0.0035),
    )


def _apply_yellow_guide_continuity_v14(curves: list[Curve]) -> list[Curve]:
    """Rebuild the four user-marked yellow continuity zones as explicit guides."""
    retained, refined_turns = _refine_orbital_nasal_turns_v14(curves)
    retained, mouth_guide = _nasolabial_mandibular_guide_v14(retained)
    guides = [_superior_orbital_guide_v14(), mouth_guide]
    trimmed_count = 0
    survivors: list[Curve] = []
    trimmable_regions = {"eyelid_temple", "cheek", "perioral", "chin", "jaw"}
    for curve in retained:
        if curve.region not in trimmable_regions:
            survivors.append(curve)
            continue
        points = curve.points
        for guide in guides:
            while True:
                if (
                    _PERIORAL_CHEEK_SEPARATRIX_V22
                    and guide.region == "nasolabial_mandibular_guide_v14"
                ):
                    trimmed = _trim_at_crossing_prefer_medial(points, guide.points)
                else:
                    trimmed = _trim_at_crossing(points, guide.points)
                if trimmed is points:
                    break
                trimmed_count += 1
                points = trimmed
                if points is None:
                    break
            if points is None:
                break
        if points is None:
            continue
        survivors.append(Curve(curve.region, resample(points)))
    print(
        f"[yellow-guide] refined_nasal_turns={refined_turns} "
        f"trimmed_conflicts={trimmed_count} guides={len(guides)}"
    )
    return survivors + guides


def _replace_orbital_nasal_fragments_v18(curves: list[Curve]) -> list[Curve]:
    """Replace five floating under-orbit fragments with one full fifth turn."""
    fragment_indices: list[int] = []
    fragment_crest_y: dict[int, float] = {}
    for index, curve in enumerate(curves):
        if curve.region != "nose_side_downturn_v9":
            continue
        points = curve.points
        crest_index = int(np.argmin(points[:, 1]))
        descent = float(points[-1, 1] - points[crest_index, 1])
        if descent < 0.025:
            fragment_indices.append(index)
            fragment_crest_y[index] = float(points[crest_index, 1])
    if len(fragment_indices) != 5:
        raise RuntimeError(
            f"expected five orbital-nasal fragments, found {len(fragment_indices)}"
        )

    representative = min(
        fragment_indices,
        key=lambda index: abs(fragment_crest_y[index] - 0.475),
    )
    revised: list[Curve] = []
    for index, curve in enumerate(curves):
        if index not in fragment_indices:
            revised.append(curve)
            continue
        if index != representative:
            revised.append(Curve(_REMOVED_ORBITAL_NASAL_FRAGMENT_V18, curve.points))
            continue

        base = curve.points
        p0 = base[-1]
        heading = p0 - base[-2]
        heading /= max(float(np.linalg.norm(heading)), 1e-9)
        target = np.array([0.450, 0.526])
        bend = _cubic_bezier(
            p0,
            p0 + 0.020 * heading,
            target - np.array([0.0, 0.020]),
            target,
            52,
        )
        revised.append(
            Curve(
                "nose_side_downturn_v9",
                resample(np.vstack([base[:-1], bend]), spacing=0.0035),
            )
        )
    print(
        "[orbital-nasal-replacement] fragments=5 removed=4 continuous_replacements=1"
    )
    return revised


def _rebuild_orbital_nasal_bundle_v19(curves: list[Curve]) -> list[Curve]:
    """Replace the actually visible under-orbit fragments with five full turns.

    v18 selected only short ``nose_side_downturn_v9`` curves, while the user's
    blue boxes primarily contain fragmented ``eyelid_temple`` and terminating
    upper-cheek strands.  Keep five clean lateral bases spanning that visible
    band, extend each base to a separate nasal-tip endpoint, and suppress the
    obsolete fragment/turn families without renumbering unrelated curves.
    """
    eyelid_indices = [
        index for index, curve in enumerate(curves) if curve.region == "eyelid_temple"
    ]
    cheek_indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == "cheek"
        and float(np.min(curve.points[:, 0])) < 0.080
        and 0.240 <= float(np.max(curve.points[:, 0])) <= 0.370
        and float(np.min(curve.points[:, 1])) < 0.410
        and float(np.max(curve.points[:, 1])) < 0.480
    ]
    nose_indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == "nose_side_downturn_v9"
    ]
    cheek_indices.sort(key=lambda index: float(curves[index].points[0, 1]))
    if len(eyelid_indices) != 9:
        raise RuntimeError(
            f"expected nine eyelid fragments, found {len(eyelid_indices)}"
        )
    if len(cheek_indices) != 5 or len(nose_indices) != 9:
        raise RuntimeError(
            "expected five upper-cheek endings and nine old nose-side lines, found "
            f"{len(cheek_indices)} and {len(nose_indices)}"
        )

    selected = eyelid_indices[:5]
    starts = [
        np.array([0.055, 0.375]),
        np.array([0.055, 0.397]),
        np.array([0.055, 0.419]),
        np.array([0.055, 0.441]),
        np.array([0.055, 0.463]),
    ]
    turns = [
        np.array([0.385, 0.390]),
        np.array([0.377, 0.405]),
        np.array([0.369, 0.420]),
        np.array([0.361, 0.435]),
        np.array([0.353, 0.450]),
    ]
    targets = [
        np.array([0.486, 0.512]),
        np.array([0.477, 0.518]),
        np.array([0.468, 0.524]),
        np.array([0.459, 0.530]),
        np.array([0.450, 0.536]),
    ]
    removable = set(eyelid_indices + cheek_indices + nose_indices)
    revised: list[Curve] = []
    for index, curve in enumerate(curves):
        if index not in removable:
            revised.append(curve)
            continue
        if index not in selected:
            revised.append(Curve(_REMOVED_ORBITAL_NASAL_BUNDLE_V19, curve.points))
            continue

        layer = selected.index(index)
        start = starts[layer]
        turn = turns[layer]
        target = targets[layer]
        orbital = _cubic_bezier(
            start,
            start + np.array([0.120, -0.003]),
            turn - np.array([0.050, 0.0]),
            turn,
            72,
        )
        bend = _cubic_bezier(
            turn,
            turn + np.array([0.040, 0.0]),
            target - np.array([0.0, 0.040]),
            target,
            72,
        )
        revised.append(
            Curve(
                "orbital_nasal_continuous_v19",
                resample(np.vstack([orbital[:-1], bend]), spacing=0.0035),
            )
        )
    print(
        "[orbital-nasal-bundle] removed_eyelid_fragments=9 "
        "removed_upper_cheek_endings=5 removed_old_nose_lines=9 "
        "continuous_half_lines=5"
    )
    return revised


def _preserve_v22_orbital_nasal_bundle_v20(curves: list[Curve]) -> list[Curve]:
    """Delete the visible fragments without changing any complete v8.1.22 turn."""
    eyelid_indices = [
        index for index, curve in enumerate(curves) if curve.region == "eyelid_temple"
    ]
    cheek_indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == "cheek"
        and float(np.min(curve.points[:, 0])) < 0.080
        and 0.240 <= float(np.max(curve.points[:, 0])) <= 0.370
        and float(np.min(curve.points[:, 1])) < 0.410
        and float(np.max(curve.points[:, 1])) < 0.480
    ]
    nose_indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == "nose_side_downturn_v9"
    ]
    if len(eyelid_indices) != 9 or len(cheek_indices) != 5:
        raise RuntimeError(
            "expected nine eyelid and five upper-cheek fragments, found "
            f"{len(eyelid_indices)} and {len(cheek_indices)}"
        )
    if len(nose_indices) != 5:
        raise RuntimeError(
            f"expected five complete v8.1.22 nose-side lines, found {len(nose_indices)}"
        )

    removable = set(eyelid_indices + cheek_indices)
    revised = [
        Curve(_REMOVED_ORBITAL_NASAL_FRAGMENT_V20, curve.points)
        if index in removable
        else curve
        for index, curve in enumerate(curves)
    ]
    print(
        "[orbital-nasal-preserve-v22] removed_eyelid_fragments=9 "
        "removed_upper_cheek_fragments=5 preserved_complete_half_lines=5"
    )
    return revised


def _shift_nasal_bundle_upward_v21(curves: list[Curve]) -> list[Curve]:
    """Translate the complete v8.1.24 bundle upward without changing its shape."""
    shifted: list[Curve] = []
    shifted_count = 0
    for curve in curves:
        if curve.region != "nose_side_downturn_v9":
            shifted.append(curve)
            continue
        points = curve.points.copy()
        points[:, 1] -= 0.008
        shifted.append(Curve(curve.region, points))
        shifted_count += 1
    if shifted_count != 5:
        raise RuntimeError(
            f"expected five complete half-face lines to shift, found {shifted_count}"
        )
    print("[nasal-bundle-upward] half_lines=5 canonical_y_shift=-0.008")
    return shifted


def _smooth_anchor_curve_v25(anchors: tuple[tuple[float, float], ...]) -> np.ndarray:
    """Interpolate a traced half-curve with a C1 cubic and a flat midline tangent."""
    anchor_points = np.asarray(anchors, dtype=np.float64)
    x = anchor_points[:, 0]
    y = anchor_points[:, 1]
    secants = np.diff(y) / np.diff(x)
    slopes = np.empty_like(y)
    slopes[0] = secants[0]
    slopes[-1] = 0.0
    for index in range(1, len(y) - 1):
        before, after = secants[index - 1], secants[index]
        slopes[index] = 0.0 if before * after <= 0.0 else 0.5 * (before + after)

    pieces: list[np.ndarray] = []
    for index in range(len(x) - 1):
        sample_x = np.linspace(x[index], x[index + 1], 25, endpoint=index == len(x) - 2)
        width = x[index + 1] - x[index]
        t = (sample_x - x[index]) / width
        h00 = 2.0 * t**3 - 3.0 * t**2 + 1.0
        h10 = t**3 - 2.0 * t**2 + t
        h01 = -2.0 * t**3 + 3.0 * t**2
        h11 = t**3 - t**2
        sample_y = (
            h00 * y[index]
            + h10 * width * slopes[index]
            + h01 * y[index + 1]
            + h11 * width * slopes[index + 1]
        )
        pieces.append(np.column_stack([sample_x, sample_y]))
    return np.vstack(pieces)


def _replace_infraorbital_waves_v25(curves: list[Curve]) -> list[Curve]:
    """Replace only the two cross-face lower-orbital lines with user traces."""
    indices = [
        index for index, curve in enumerate(curves) if curve.region == "nose_root_cross_v9"
    ]
    if len(indices) != 2:
        raise RuntimeError(f"expected two infraorbital cross-face lines, found {len(indices)}")
    ordered = sorted(indices, key=lambda index: float(np.mean(curves[index].points[:, 1])))
    revised = list(curves)
    fitted_anchors = [
        np.asarray(anchors, dtype=np.float64).copy()
        for anchors in _INFRAORBITAL_WAVE_LEFT_ANCHORS_V25
    ]
    # The hand-drawn upper trace meets the frozen superior guide at its medial
    # endpoint. A sub-trace-width downward offset keeps the families separate;
    # the lower layer receives the same local allowance to preserve spacing.
    fitted_anchors[0][-2, 1] += 0.0028
    fitted_anchors[1][-2, 1] += 0.0027
    for index, anchors in zip(ordered, fitted_anchors, strict=True):
        points = _smooth_anchor_curve_v25(tuple(map(tuple, anchors)))
        points[-1] = anchors[-1]
        revised[index] = Curve("nose_root_cross_v9", resample(points, spacing=0.0035))
    print("[infraorbital-wave] replaced_cross_face_lines=2 registered_half_trace_anchors=20")
    return revised


def _shift_nasal_bundle_additionally_upward_v26(curves: list[Curve]) -> list[Curve]:
    """Apply one additional rigid upward translation to the five nasal turns."""
    shifted: list[Curve] = []
    shifted_count = 0
    for curve in curves:
        if curve.region != "nose_side_downturn_v9":
            shifted.append(curve)
            continue
        points = curve.points.copy()
        points[:, 1] -= _NASAL_BUNDLE_ADDITIONAL_UPWARD_SHIFT
        shifted.append(Curve(curve.region, points))
        shifted_count += 1
    if shifted_count != 5:
        raise RuntimeError(
            f"expected five complete half-face lines to shift, found {shifted_count}"
        )
    print(
        "[nasal-bundle-additional-upward] half_lines=5 "
        f"canonical_y_shift={-_NASAL_BUNDLE_ADDITIONAL_UPWARD_SHIFT:.3f}"
    )
    return shifted


def _replace_nasal_bundle_midnose_trace_v29(curves: list[Curve]) -> list[Curve]:
    """Rebuild five layers inside the user's raised cheek-to-mid-nose envelope."""
    indices = [
        index for index, curve in enumerate(curves) if curve.region == "nose_side_downturn_v9"
    ]
    if len(indices) != 5:
        raise RuntimeError(f"expected five nose-side half-lines, found {len(indices)}")

    def outer_y(index: int) -> float:
        points = curves[index].points
        outer = points[int(np.argmin(points[:, 0]))]
        return float(outer[1])

    ordered = sorted(indices, key=outer_y)
    guides = np.asarray(_NASAL_BUNDLE_MID_NOSE_GUIDES_V29, dtype=np.float64)
    lower_wave_anchors = np.asarray(
        _INFRAORBITAL_WAVE_LEFT_ANCHORS_V25[1], dtype=np.float64
    ).copy()
    lower_wave_anchors[-2, 1] += 0.0027
    lower_wave = _smooth_anchor_curve_v25(tuple(map(tuple, lower_wave_anchors)))
    revised = list(curves)
    for rank, index in enumerate(ordered):
        fraction = rank / (len(ordered) - 1)
        controls = (1.0 - fraction) * guides[0] + fraction * guides[1]
        inner_to_outer = _cubic_bezier(*controls, 180)
        lower_wave_y = np.interp(
            inner_to_outer[:, 0], lower_wave[:, 0], lower_wave[:, 1]
        )
        clearance = 0.006 + 0.005 * rank
        boundary = lower_wave_y + clearance
        current_y = inner_to_outer[:, 1]
        inner_to_outer[:, 1] = 0.5 * (
            current_y
            + boundary
            + np.sqrt((current_y - boundary) ** 2 + 0.015**2)
        )
        revised[index] = Curve(
            "nose_side_downturn_v9",
            resample(inner_to_outer[::-1], spacing=0.0035),
        )
    print("[nasal-bundle-midnose-trace] half_lines=5 paired_blue_traces=4")
    return revised


def _expand_nasal_bundle_spacing_v30(curves: list[Curve]) -> list[Curve]:
    """Expand the five raised layers below the top registered blue trace."""
    indices = [
        index for index, curve in enumerate(curves) if curve.region == "nose_side_downturn_v9"
    ]
    if len(indices) != 5:
        raise RuntimeError(f"expected five nose-side half-lines, found {len(indices)}")

    def outer_y(index: int) -> float:
        points = curves[index].points
        outer = points[int(np.argmin(points[:, 0]))]
        return float(outer[1])

    ordered = sorted(indices, key=outer_y)
    top = curves[ordered[0]].points.copy()
    if float(top[0, 0]) > float(top[-1, 0]):
        top = top[::-1]
    segment = np.linalg.norm(np.diff(top, axis=0), axis=1)
    arc_fraction = np.r_[0.0, np.cumsum(segment)]
    arc_fraction /= arc_fraction[-1]
    easing = arc_fraction * arc_fraction * (3.0 - 2.0 * arc_fraction)

    revised = list(curves)
    for rank, index in enumerate(ordered):
        points = top.copy()
        points[:, 1] += rank * _NASAL_BUNDLE_LAYER_SPACING_V30
        x_step = (
            _NASAL_BUNDLE_OUTER_X_STEP_V30
            + (_NASAL_BUNDLE_INNER_X_STEP_V30 - _NASAL_BUNDLE_OUTER_X_STEP_V30)
            * easing
        )
        points[:, 0] -= rank * x_step
        revised[index] = Curve(
            "nose_side_downturn_v9",
            resample(points, spacing=0.0035),
        )
    print(
        "[nasal-bundle-expanded-spacing] half_lines=5 "
        f"layer_spacing={_NASAL_BUNDLE_LAYER_SPACING_V30:.3f}"
    )
    return revised


def _shift_nasal_bundle_rigidly_upward_v31(curves: list[Curve]) -> list[Curve]:
    """Translate the accepted v8.1.31 bundle upward without changing its shape."""
    shifted: list[Curve] = []
    shifted_count = 0
    for curve in curves:
        if curve.region != "nose_side_downturn_v9":
            shifted.append(curve)
            continue
        points = curve.points.copy()
        points[:, 1] -= _NASAL_BUNDLE_RIGID_UPWARD_SHIFT_AMOUNT_V31
        shifted.append(Curve(curve.region, points))
        shifted_count += 1
    if shifted_count != 5:
        raise RuntimeError(
            f"expected five complete half-face lines to shift, found {shifted_count}"
        )
    print(
        "[nasal-bundle-rigid-upward] half_lines=5 "
        f"canonical_y_shift={-_NASAL_BUNDLE_RIGID_UPWARD_SHIFT_AMOUNT_V31:.3f}"
    )
    return shifted


def _face_left_boundary(y: float) -> float:
    """Return the left convex-hull intersection at one normalized face height."""
    if _FACE_POLYGON is None:
        raise RuntimeError("face polygon is not initialized")
    polygon = np.asarray(_FACE_POLYGON, dtype=np.float64).reshape(-1, 2)
    intersections: list[float] = []
    for first, second in zip(polygon, np.roll(polygon, -1, axis=0), strict=True):
        low, high = sorted((float(first[1]), float(second[1])))
        if not (low <= y <= high) or abs(float(second[1] - first[1])) < 1e-12:
            continue
        fraction = (y - float(first[1])) / float(second[1] - first[1])
        intersections.append(float(first[0] + fraction * (second[0] - first[0])))
    if not intersections:
        raise RuntimeError(f"face outline has no intersection at y={y:.6f}")
    return min(intersections)


def _v23_separatrix_x(y: float) -> float:
    """Evaluate the v8.1.27 separatrix x coordinate at a requested y."""
    upper = _cubic_bezier(
        np.array([0.404080, 0.540858]),
        np.array([0.344548, 0.599851]),
        np.array([0.308762, 0.655179]),
        np.array([0.300218, 0.716922]),
        1001,
    )
    lower = _cubic_bezier(
        np.array([0.300218, 0.716922]),
        np.array([0.291674, 0.778665]),
        np.array([0.274869, 0.842868]),
        np.array([0.260552, 0.925938]),
        1001,
    )
    joined = np.vstack([upper, lower[1:]])
    return float(np.interp(y, joined[:, 1], joined[:, 0]))


def _cheek_fan_alar_start_v27(fraction: float) -> np.ndarray:
    """Place one fan origin just lateral to the alar rim and separatrix."""
    start_y = 0.546 + 0.021 * fraction
    separatrix_limit = _v23_separatrix_x(start_y) - 0.003
    nostril_term = 1.0 - ((start_y - 0.530) / 0.052) ** 2
    nostril_limit = (
        0.405 - 0.034 * math.sqrt(max(nostril_term, 0.0)) - 0.003
        if nostril_term > 0.0
        else separatrix_limit
    )
    return np.array([min(separatrix_limit, nostril_limit), start_y])


def _cheek_fan_layered_blue_guide_v28(fraction: float) -> tuple[np.ndarray, np.ndarray]:
    """Interpolate the paired left/right blue traces into one of nine layers."""
    guides = np.asarray(_CHEEK_LONG_ARC_LAYERED_GUIDES_V28, dtype=np.float64)
    levels = np.linspace(0.0, 1.0, len(guides))
    start = np.array(
        [np.interp(fraction, levels, guides[:, 0, axis]) for axis in range(2)]
    )
    first_control = np.array(
        [np.interp(fraction, levels, guides[:, 1, axis]) for axis in range(2)]
    )
    return start, first_control


def _rebuild_cheek_long_arc_fan_v24(curves: list[Curve]) -> list[Curve]:
    """Replace fragmented lateral cheek strands with the user-drawn long arc fan."""
    frozen_bundle = [curve for curve in curves if curve.region == "nose_side_downturn_v9"]
    if len(frozen_bundle) != 5:
        raise RuntimeError(
            f"expected five frozen orbital-nasal half-lines, found {len(frozen_bundle)}"
        )

    removed: list[Curve] = []
    revised: list[Curve] = []
    for curve in curves:
        if curve.region not in {"cheek", "jaw"}:
            revised.append(curve)
            continue
        boundary_x = np.array([_v23_separatrix_x(float(y)) for y in curve.points[:, 1]])
        medial_fraction = float(np.mean(curve.points[:, 0] >= boundary_x))
        if medial_fraction >= 0.5:
            revised.append(curve)
        else:
            removed.append(curve)
            revised.append(Curve(_REMOVED_CHEEK_LONG_ARC_FAN_V24, curve.points))
    fan: list[Curve] = []
    for fraction in np.linspace(0.0, 1.0, 9):
        end_y = 0.675 + 0.235 * fraction
        if _CHEEK_LONG_ARC_LAYERED_BLUE_TRACE_V28:
            start, first_control = _cheek_fan_layered_blue_guide_v28(float(fraction))
        elif _CHEEK_LONG_ARC_ALAR_ORIGIN_V27:
            start = _cheek_fan_alar_start_v27(float(fraction))
            first_control = np.array(
                [
                    0.290 - 0.020 * fraction,
                    0.565 + 0.100 * fraction,
                ]
            )
        else:
            start_y = 0.552 + 0.054 * fraction
            separatrix_limit = _v23_separatrix_x(start_y) - 0.009
            nostril_term = 1.0 - ((start_y - 0.530) / 0.052) ** 2
            nostril_limit = (
                0.405 - 0.034 * math.sqrt(max(nostril_term, 0.0)) - 0.004
                if nostril_term > 0.0
                else separatrix_limit
            )
            start = np.array([min(separatrix_limit, nostril_limit), start_y])
            first_control = np.array(
                [
                    0.290 - 0.020 * fraction,
                    0.565 + 0.100 * fraction,
                ]
            )
        end_inset = 0.050 - 0.038 * fraction
        end = np.array([_face_left_boundary(end_y) + end_inset, end_y])
        second_control = np.array(
            [
                0.178 + 0.093 * fraction,
                0.581 + 0.207 * fraction,
            ]
        )
        points = _cubic_bezier(start, first_control, second_control, end, 120)
        fan.append(Curve(_CHEEK_LONG_ARC_FAN_REGION_V24, resample(points, spacing=0.0035)))

    print(
        f"[cheek-long-arc-fan] removed_half_fragments={len(removed)} "
        f"new_half_lines={len(fan)} frozen_orbital_nasal_lines={len(frozen_bundle)}"
    )
    return revised + fan


def _expand_cheek_long_arc_spacing_v32(curves: list[Curve]) -> list[Curve]:
    """Spread the accepted nine-layer cheek fan using rigid per-line offsets."""
    indices = [
        index for index, curve in enumerate(curves)
        if curve.region == _CHEEK_LONG_ARC_FAN_REGION_V24
    ]
    if len(indices) != 9:
        raise RuntimeError(f"expected nine cheek-fan half-lines, found {len(indices)}")
    ordered = sorted(indices, key=lambda index: float(curves[index].points[0, 1]))
    revised = list(curves)
    center_rank = (len(ordered) - 1) / 2.0
    for rank, index in enumerate(ordered):
        points = curves[index].points.copy()
        points[:, 1] += (
            (rank - center_rank) * _CHEEK_LONG_ARC_LAYER_SPACING_INCREMENT_V32
        )
        revised[index] = Curve(curves[index].region, points)
    print(
        "[cheek-long-arc-expanded-spacing] half_lines=9 "
        f"layer_increment={_CHEEK_LONG_ARC_LAYER_SPACING_INCREMENT_V32:.3f}"
    )
    return revised


def _replace_cheek_long_arc_direction_v33(curves: list[Curve]) -> list[Curve]:
    """Follow the user's five blue direction traces while retaining nine alar starts."""
    indices = [
        index for index, curve in enumerate(curves)
        if curve.region == _CHEEK_LONG_ARC_FAN_REGION_V24
    ]
    if len(indices) != 9:
        raise RuntimeError(f"expected nine cheek-fan half-lines, found {len(indices)}")
    ordered = sorted(indices, key=lambda index: float(curves[index].points[0, 1]))
    guides = np.asarray(_CHEEK_LONG_ARC_BLUE_DIRECTION_GUIDES_V33, dtype=np.float64)
    guide_levels = np.linspace(0.0, 1.0, len(guides))
    revised = list(curves)
    for rank, index in enumerate(ordered):
        fraction = rank / (len(ordered) - 1)
        controls = np.asarray(
            [
                [
                    np.interp(fraction, guide_levels, guides[:, control, axis])
                    for axis in range(2)
                ]
                for control in range(4)
            ],
            dtype=np.float64,
        )
        controls[0] = curves[index].points[0]
        points = _cubic_bezier(*controls, 180)
        revised[index] = Curve(
            curves[index].region,
            resample(points, spacing=0.0035),
        )
    print("[cheek-long-arc-blue-direction] half_lines=9 registered_blue_traces=5")
    return revised


def _expand_cheek_long_arc_blue_spacing_v34(curves: list[Curve]) -> list[Curve]:
    """Spread the accepted blue-direction fan with rigid whole-curve offsets."""
    indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == _CHEEK_LONG_ARC_FAN_REGION_V24
    ]
    if len(indices) != 9:
        raise RuntimeError(f"expected nine cheek-fan half-lines, found {len(indices)}")
    ordered = sorted(indices, key=lambda index: float(curves[index].points[0, 1]))
    center_rank = (len(ordered) - 1) / 2.0
    revised = list(curves)
    for rank, index in enumerate(ordered):
        points = curves[index].points.copy()
        points[:, 1] += (
            (rank - center_rank) * _CHEEK_LONG_ARC_BLUE_SPACING_INCREMENT_V34
        )
        revised[index] = Curve(curves[index].region, points)
    print(
        "[cheek-long-arc-blue-spacing] half_lines=9 "
        f"layer_increment={_CHEEK_LONG_ARC_BLUE_SPACING_INCREMENT_V34:.3f}"
    )
    return revised


def _expand_cheek_long_arc_blue_spacing_v35(curves: list[Curve]) -> list[Curve]:
    """Add one smaller rigid spacing step without changing the accepted arcs."""
    indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == _CHEEK_LONG_ARC_FAN_REGION_V24
    ]
    if len(indices) != 9:
        raise RuntimeError(f"expected nine cheek-fan half-lines, found {len(indices)}")
    ordered = sorted(indices, key=lambda index: float(curves[index].points[0, 1]))
    center_rank = (len(ordered) - 1) / 2.0
    revised = list(curves)
    for rank, index in enumerate(ordered):
        points = curves[index].points.copy()
        points[:, 1] += (
            (rank - center_rank)
            * _CHEEK_LONG_ARC_BLUE_ADDITIONAL_SPACING_INCREMENT_V35
        )
        revised[index] = Curve(curves[index].region, points)
    print(
        "[cheek-long-arc-blue-additional-spacing] half_lines=9 "
        f"layer_increment={_CHEEK_LONG_ARC_BLUE_ADDITIONAL_SPACING_INCREMENT_V35:.4f}"
    )
    return revised


def _expand_cheek_long_arc_blue_boundary_coverage_v36(
    curves: list[Curve],
) -> list[Curve]:
    """Expand the upper and lower fan boundaries with rigid nonuniform offsets."""
    indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == _CHEEK_LONG_ARC_FAN_REGION_V24
    ]
    if len(indices) != len(_CHEEK_LONG_ARC_BLUE_BOUNDARY_OFFSETS_V36):
        raise RuntimeError(f"expected nine cheek-fan half-lines, found {len(indices)}")
    ordered = sorted(indices, key=lambda index: float(curves[index].points[0, 1]))
    revised = list(curves)
    for offset, index in zip(_CHEEK_LONG_ARC_BLUE_BOUNDARY_OFFSETS_V36, ordered):
        points = curves[index].points.copy()
        points[:, 1] += offset
        revised[index] = Curve(curves[index].region, points)
    print(
        "[cheek-long-arc-blue-boundary-coverage] half_lines=9 "
        f"offsets={_CHEEK_LONG_ARC_BLUE_BOUNDARY_OFFSETS_V36}"
    )
    return revised


def _rebuild_perioral_continuous_fan_v37(curves: list[Curve]) -> list[Curve]:
    """Replace only the stepped mouth-side fragments with an ordered local fan."""
    revised = list(curves)
    replaced_regions: list[str] = []
    for index in sorted(_PERIORAL_REPLACED_SOURCE_INDICES_V37):
        if index >= len(curves):
            raise RuntimeError(f"missing perioral source curve {index}")
        replaced_regions.append(curves[index].region)
        revised[index] = Curve(
            _REMOVED_PERIORAL_CONTINUOUS_FAN_V37,
            curves[index].points,
        )
    if replaced_regions.count("cheek") != 6 or replaced_regions.count("jaw") != 6:
        raise RuntimeError(
            "expected six cheek and six jaw mouth-side fragments, found "
            f"{replaced_regions}"
        )

    upper_starts = np.asarray(
        [
            (0.330, 0.708),
            (0.346, 0.695),
            (0.362, 0.685),
            (0.378, 0.680),
            (0.392, 0.678),
            (0.406, 0.680),
        ],
        dtype=np.float64,
    )
    upper_ends = np.asarray(
        [
            (0.340, 0.640),
            (0.350, 0.624),
            (0.363, 0.610),
            (0.380, 0.598),
            (0.400, 0.589),
            (0.421, 0.584),
        ],
        dtype=np.float64,
    )
    fan: list[Curve] = []
    for index, (start, end) in enumerate(
        zip(upper_starts, upper_ends, strict=True)
    ):
        fraction = index / (len(upper_starts) - 1)
        first = start + np.asarray([0.009 * (1.0 - fraction), -0.030])
        second = end + np.asarray([-0.004, 0.024])
        fan.append(
            Curve(
                "perioral_continuous_fan_v37",
                _cubic_bezier(start, first, second, end, 48),
            )
        )

    corner = np.asarray([0.360, 0.711], dtype=np.float64)
    lower_angles = (178.0, 165.0, 153.0, 144.0, 135.0, 128.0)
    lower_start_radii = (0.018, 0.020, 0.022, 0.024, 0.026, 0.028)
    lower_ends = np.asarray(
        [
            (0.3020, 0.7130),
            (0.3017, 0.7267),
            (0.2990, 0.7420),
            (0.2967, 0.7556),
            (0.2908, 0.7799),
            (0.2859, 0.8048),
        ],
        dtype=np.float64,
    )
    for angle, radius, end in zip(
        lower_angles, lower_start_radii, lower_ends, strict=True
    ):
        radians = math.radians(angle)
        direction = np.asarray([math.cos(radians), math.sin(radians)])
        start = corner + radius * direction
        fan.append(
            Curve(
                "perioral_continuous_fan_v37",
                _cubic_bezier(
                    start,
                    start + 0.35 * (end - start),
                    start + 0.72 * (end - start),
                    end,
                    48,
                ),
            )
        )

    print(
        "[perioral-continuous-fan] removed_half_fragments=12 "
        "new_upper_half_lines=6 new_lower_half_lines=6"
    )
    return revised + fan


def _smooth_perioral_vortex_fan_v38(curves: list[Curve]) -> list[Curve]:
    """Curve the accepted mouth fan into the user's smooth vortex-like flow."""
    indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == "perioral_continuous_fan_v37"
    ]
    if len(indices) != 12:
        raise RuntimeError(
            f"expected twelve half-face perioral fan lines, found {len(indices)}"
        )

    revised = list(curves)
    for rank, index in enumerate(indices):
        points = curves[index].points
        start = points[0]
        end = points[-1]
        if rank < 6:
            fraction = rank / 5.0
            first = start + np.asarray(
                [-0.018 + 0.011 * fraction, -0.020 - 0.012 * fraction]
            )
            second = end + np.asarray(
                [-0.015 + 0.008 * fraction, 0.024 + 0.004 * fraction]
            )
        else:
            fraction = (rank - 6) / 5.0
            first = start + np.asarray(
                [-0.016 - 0.006 * fraction, 0.001 + 0.004 * fraction]
            )
            second = end + np.asarray(
                [0.010 + 0.002 * fraction, -0.002 - 0.020 * fraction]
            )
        revised[index] = Curve(
            "perioral_vortex_fan_v38",
            _cubic_bezier(start, first, second, end, 48),
        )

    print(
        "[perioral-vortex-fan] half_lines=12 preserved_endpoints=24 "
        "upper_rotation_layers=6 lower_rotation_layers=6"
    )
    return revised


def _clear_cheek_separatrix_projection_v39(curves: list[Curve]) -> list[Curve]:
    """Open mapped clearance between the cheek fan and mouth-jaw separatrix."""
    indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == _CHEEK_LONG_ARC_FAN_REGION_V24
    ]
    if len(indices) != len(_CHEEK_SEPARATRIX_PROJECTION_OFFSETS_V39):
        raise RuntimeError(f"expected nine cheek-fan half-lines, found {len(indices)}")
    ordered = sorted(indices, key=lambda index: float(curves[index].points[0, 1]))
    revised = list(curves)
    changed = 0
    for offset, index in zip(
        _CHEEK_SEPARATRIX_PROJECTION_OFFSETS_V39,
        ordered,
        strict=True,
    ):
        if offset == 0.0:
            continue
        points = curves[index].points.copy()
        fraction = np.linspace(0.0, 1.0, len(points))
        local = np.clip(
            fraction / _CHEEK_SEPARATRIX_PROJECTION_TAPER_END_V39,
            0.0,
            1.0,
        )
        taper = np.where(
            fraction <= _CHEEK_SEPARATRIX_PROJECTION_TAPER_END_V39,
            np.cos(0.5 * np.pi * local) ** 2,
            0.0,
        )
        points[:, 0] -= offset * taper
        revised[index] = Curve(curves[index].region, points)
        changed += 1
    print(
        "[cheek-separatrix-projection-clearance] changed_half_lines="
        f"{changed} offsets={_CHEEK_SEPARATRIX_PROJECTION_OFFSETS_V39[-3:]}"
    )
    return revised


def _extend_glabella_upward_v40(curves: list[Curve]) -> list[Curve]:
    """Extend only glabellar vertical endpoints toward the lowest forehead arc."""
    forehead = [
        curve.points
        for curve in curves
        if curve.region == "forehead_bridge_arc_v15"
    ]
    if len(forehead) != 8:
        raise RuntimeError(f"expected eight forehead arcs, found {len(forehead)}")

    def lowest_forehead_y(x: float) -> float:
        values: list[float] = []
        for points in forehead:
            order = np.argsort(points[:, 0])
            values.append(
                float(np.interp(x, points[order, 0], points[order, 1]))
            )
        return max(values)

    revised = list(curves)
    extension_lengths: list[float] = []
    changed = 0
    for index, curve in enumerate(curves):
        if curve.region != "orbital_brow_upturn_v11":
            continue
        points = curve.points
        if int(np.argmin(points[:, 1])) != len(points) - 1:
            raise RuntimeError("orbital brow upturn does not end at its upper endpoint")
        top = points[-1]
        target_y = lowest_forehead_y(float(top[0])) + _GLABELLA_FOREHEAD_CLEARANCE_V40
        if target_y >= float(top[1]):
            raise RuntimeError("orbital brow upturn has no room for upward extension")
        count = max(2, int(math.ceil((float(top[1]) - target_y) / 0.0035)) + 1)
        extension_y = np.linspace(float(top[1]), target_y, count)[1:]
        extension = np.column_stack(
            [np.full_like(extension_y, top[0]), extension_y]
        )
        revised[index] = Curve(curve.region, np.vstack([points, extension]))
        extension_lengths.append(float(top[1] - target_y))
        changed += 1
    if changed != 5:
        raise RuntimeError(f"expected five half-face glabella lines, found {changed}")
    print(
        "[glabella-upward-extension] changed_half_lines=5 "
        f"extension_min={min(extension_lengths):.6f} "
        f"extension_max={max(extension_lengths):.6f} "
        f"forehead_clearance={_GLABELLA_FOREHEAD_CLEARANCE_V40:.3f}"
    )
    return revised


def _add_cheek_long_arc_lateral_density_v41(curves: list[Curve]) -> list[Curve]:
    """Insert trimmed interpolated layers into the widest lateral fan gaps.

    The accepted nine-layer fan keeps noticeably wider layer spacing over the
    lateral cheek than elsewhere.  For every adjacent pair whose lateral
    median gap exceeds the dense-region spacing, this adds one (or, for the
    two widest gaps, two) pointwise-interpolated layers, trimmed to the
    section where the bracketing gap stays wide enough that the new layer
    keeps at least half the dense-region spacing from both neighbours.  The
    nine accepted layers and every other curve stay untouched.
    """
    indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == _CHEEK_LONG_ARC_FAN_REGION_V24
    ]
    if len(indices) != 9:
        raise RuntimeError(f"expected nine cheek-fan half-lines, found {len(indices)}")
    ordered = sorted(indices, key=lambda index: float(curves[index].points[0, 1]))

    def parameterized(points: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        arclength = np.concatenate(
            [[0.0], np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))]
        )
        arclength /= arclength[-1]
        t = np.linspace(0.0, 1.0, _CHEEK_DENSITY_SAMPLES_V41)
        return t, np.column_stack(
            [
                np.interp(t, arclength, points[:, 0]),
                np.interp(t, arclength, points[:, 1]),
            ]
        )

    added: list[Curve] = []
    insert_counts: list[int] = []
    for upper_index, lower_index in zip(ordered, ordered[1:]):
        t, upper = parameterized(curves[upper_index].points)
        _, lower = parameterized(curves[lower_index].points)
        gap = np.linalg.norm(upper - lower, axis=1)
        median_lateral_gap = float(np.median(gap[t >= 0.6]))
        if median_lateral_gap < _CHEEK_DENSITY_MIN_LATERAL_GAP_V41:
            insert_counts.append(0)
            continue
        inserts = 2 if median_lateral_gap >= _CHEEK_DENSITY_DOUBLE_GAP_V41 else 1
        trim_gap = (
            _CHEEK_DENSITY_TRIM_GAP_DOUBLE_V41
            if inserts == 2
            else _CHEEK_DENSITY_TRIM_GAP_V41
        )
        kept = 0
        for layer in range(1, inserts + 1):
            fraction = layer / (inserts + 1)
            candidate = upper + fraction * (lower - upper)
            inside = gap >= trim_gap
            padded = np.pad(inside.astype(np.int8), (1, 1))
            changes = np.flatnonzero(np.diff(padded))
            runs = [
                (start, end)
                for start, end in zip(changes[::2], changes[1::2], strict=False)
                if end - start >= 3
            ]
            if not runs:
                continue
            start, end = max(runs, key=lambda run: run[1] - run[0])
            segment = candidate[start:end]
            length = float(
                np.sum(np.linalg.norm(np.diff(segment, axis=0), axis=1))
            )
            if length < _CHEEK_DENSITY_MIN_LENGTH_V41:
                continue
            added.append(
                Curve(
                    _CHEEK_LONG_ARC_DENSITY_REGION_V41,
                    resample(segment, spacing=0.0035),
                )
            )
            kept += 1
        insert_counts.append(kept)
    print(
        f"[cheek-long-arc-lateral-density] new_half_lines={len(added)} "
        f"per_gap_inserts={tuple(insert_counts)}"
    )
    return curves + added


def _add_cheek_long_arc_full_density_v42(
    curves: list[Curve],
    *,
    reduced_v43: bool = False,
) -> list[Curve]:
    """Insert full-span midpoint layers into the widest fan gaps.

    Uses the same gap selection as the trimmed v41 density pass, but every
    inserted layer now runs the complete nose-side-to-face-boundary span of
    its bracketing layers instead of only the wide lateral section: the user
    rejected the v41 segments as broken lines and requires complete lines
    from the lateral cheek to the alar side.  Exactly one midpoint layer is
    inserted per wide gap, and only in the four roomier mid-fan gaps: layers
    inserted into the two widest lowest gaps start too close to the
    bracketing layers near the alar-side origins and visibly merge there.
    When reduced_v43 is active, retain midpoint layers only in the two widest
    eligible mid-fan gaps.  This reduces the visible bundle from thirteen to
    eleven lines per side while preserving all nine accepted fan layers.
    Supersedes v41 when active.
    """
    indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == _CHEEK_LONG_ARC_FAN_REGION_V24
    ]
    if len(indices) != 9:
        raise RuntimeError(f"expected nine cheek-fan half-lines, found {len(indices)}")
    ordered = sorted(indices, key=lambda index: float(curves[index].points[0, 1]))

    def parameterized(points: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        arclength = np.concatenate(
            [[0.0], np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))]
        )
        arclength /= arclength[-1]
        t = np.linspace(0.0, 1.0, _CHEEK_DENSITY_SAMPLES_V41)
        return t, np.column_stack(
            [
                np.interp(t, arclength, points[:, 0]),
                np.interp(t, arclength, points[:, 1]),
            ]
        )

    added: list[Curve] = []
    insert_counts: list[int] = []
    for upper_index, lower_index in zip(ordered, ordered[1:]):
        t, upper = parameterized(curves[upper_index].points)
        _, lower = parameterized(curves[lower_index].points)
        gap = np.linalg.norm(upper - lower, axis=1)
        median_lateral_gap = float(np.median(gap[t >= 0.6]))
        if median_lateral_gap < _CHEEK_DENSITY_MIN_LATERAL_GAP_V41:
            insert_counts.append(0)
            continue
        if (
            reduced_v43
            and median_lateral_gap < _CHEEK_DENSITY_REDUCED_MIN_LATERAL_GAP_V43
        ):
            insert_counts.append(0)
            continue
        # One full midpoint layer per wide gap.  The first v8.1.45 draft used
        # two layers in the widest gaps, but their 1/3 and 2/3 positions
        # merged with the bracketing layers near the alar-side origins, and
        # even single midpoints in the two lowest gaps start too close to
        # the bracketing origins there, so only the four roomier mid-fan
        # gaps receive a layer.
        inserts = 1 if median_lateral_gap < _CHEEK_DENSITY_DOUBLE_GAP_V41 else 0
        if not inserts:
            insert_counts.append(0)
            continue
        fraction = 0.5
        candidate = upper + fraction * (lower - upper)
        added.append(
            Curve(
                _CHEEK_LONG_ARC_DENSITY_REGION_V41,
                resample(candidate, spacing=0.0035),
            )
        )
        insert_counts.append(1)
    print(
        f"[cheek-long-arc-{'reduced' if reduced_v43 else 'full'}-density] "
        f"new_half_lines={len(added)} "
        f"per_gap_inserts={tuple(insert_counts)}"
    )
    return curves + added


def _add_cheek_lower_divergent_arcs_v44(
    curves: list[Curve],
    *,
    origin_spacing_v45: bool = False,
) -> list[Curve]:
    """Open the lower cheek corridor and add two nested descending arcs.

    The new family is not a parallel continuation of the eleven upper cheek
    layers.  It blends the lowest fan boundary toward the nasolabial-mandibular
    separatrix with an increasing blend fraction, so both curves turn farther
    downward and end in the lower cheek.  The three lowest upper fan layers
    receive a small, tapered lateral clearance adjustment near the alar side;
    their lateral endpoints remain exactly fixed.
    """
    fan_indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == _CHEEK_LONG_ARC_FAN_REGION_V24
    ]
    if len(fan_indices) != 9:
        raise RuntimeError(f"expected nine cheek-fan half-lines, found {len(fan_indices)}")
    ordered = sorted(
        fan_indices,
        key=lambda index: float(curves[index].points[0, 1]),
    )
    separatrices = [
        curve
        for curve in curves
        if curve.region == "nasolabial_mandibular_guide_v14"
    ]
    if len(separatrices) != 1:
        raise RuntimeError(
            "expected one half-face nasolabial-mandibular separatrix, "
            f"found {len(separatrices)}"
        )

    revised = list(curves)
    for offset, index in zip(
        _CHEEK_LOWER_FAN_CLEARANCE_OFFSETS_V44,
        ordered[-3:],
        strict=True,
    ):
        points = curves[index].points.copy()
        fraction = np.linspace(0.0, 1.0, len(points))
        local = np.clip(
            fraction / _CHEEK_SEPARATRIX_PROJECTION_TAPER_END_V39,
            0.0,
            1.0,
        )
        taper = np.where(
            fraction <= _CHEEK_SEPARATRIX_PROJECTION_TAPER_END_V39,
            np.cos(0.5 * np.pi * local) ** 2,
            0.0,
        )
        points[:, 0] -= offset * taper
        if origin_spacing_v45:
            extra_offset = _CHEEK_ALAR_ORIGIN_ADDITIONAL_OFFSETS_V45[
                ordered[-3:].index(index)
            ]
            short_local = np.clip(
                (
                    fraction
                    - _CHEEK_ALAR_ORIGIN_HOLD_END_V45
                )
                / (
                    _CHEEK_ALAR_ORIGIN_TAPER_END_V45
                    - _CHEEK_ALAR_ORIGIN_HOLD_END_V45
                ),
                0.0,
                1.0,
            )
            short_taper = np.where(
                fraction <= _CHEEK_ALAR_ORIGIN_HOLD_END_V45,
                1.0,
                np.where(
                    fraction <= _CHEEK_ALAR_ORIGIN_TAPER_END_V45,
                    np.cos(0.5 * np.pi * short_local) ** 2,
                    0.0,
                ),
            )
            points[:, 0] -= extra_offset * short_taper
        revised[index] = Curve(curves[index].region, points)

    def parameterized(points: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        arclength = np.concatenate(
            [[0.0], np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))]
        )
        arclength /= arclength[-1]
        t = np.linspace(0.0, 1.0, _CHEEK_DENSITY_SAMPLES_V41)
        return t, np.column_stack(
            [
                np.interp(t, arclength, points[:, 0]),
                np.interp(t, arclength, points[:, 1]),
            ]
        )

    t, lower_fan = parameterized(revised[ordered[-1]].points)
    _, separatrix = parameterized(separatrices[0].points)
    easing = t * t * (3.0 - 2.0 * t)
    added: list[Curve] = []
    blend_fractions = (
        _CHEEK_LOWER_DIVERGENT_BLEND_SPACED_V45
        if origin_spacing_v45
        else _CHEEK_LOWER_DIVERGENT_BLEND_V44
    )
    for start_fraction, end_fraction in blend_fractions:
        blend = start_fraction + (end_fraction - start_fraction) * easing
        points = lower_fan + blend[:, None] * (separatrix - lower_fan)
        added.append(
            Curve(
                _CHEEK_LOWER_DIVERGENT_ARC_REGION_V44,
                resample(points, spacing=0.0035),
            )
        )
    print(
        "[cheek-lower-divergent-arcs] new_half_lines=2 "
        f"fan_clearance_offsets={_CHEEK_LOWER_FAN_CLEARANCE_OFFSETS_V44} "
        f"origin_spacing={origin_spacing_v45} "
        f"blend_fractions={blend_fractions}"
    )
    return revised + added


def _anchor_cheek_curves_to_alar_boundary_v46(
    curves: list[Curve],
) -> list[Curve]:
    """Add ordered tangent-continuous attachments before unchanged v47 paths.

    The accepted v47 cheek bodies remain byte-for-byte source geometry after
    a short nasal-side join.  Each crowded original prefix is replaced by one
    cubic attachment from a distinct nasal-wing point to the same v47 path.
    The replacement is tangent-aligned at the join, so the established cheek
    trajectory and all lateral endpoints remain unchanged.
    """
    upper_indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region
        in {
            _CHEEK_LONG_ARC_FAN_REGION_V24,
            _CHEEK_LONG_ARC_DENSITY_REGION_V41,
        }
    ]
    lower_indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == _CHEEK_LOWER_DIVERGENT_ARC_REGION_V44
    ]
    if len(upper_indices) != 11 or len(lower_indices) != 2:
        raise RuntimeError(
            "expected eleven upper cheek lines and two lower divergent arcs"
        )
    upper_indices.sort(key=lambda index: float(curves[index].points[-1, 1]))
    lower_indices.sort(key=lambda index: float(curves[index].points[-1, 1]))
    ordered = upper_indices + lower_indices

    oriented_points: dict[int, tuple[np.ndarray, bool]] = {}
    natural_anchors: list[np.ndarray] = []
    for index in ordered:
        points = curves[index].points
        reverse = float(points[0, 0]) < float(points[-1, 0])
        oriented = points[::-1].copy() if reverse else points.copy()
        tangent = oriented[min(4, len(oriented) - 1)] - oriented[0]
        tangent /= np.linalg.norm(tangent)
        extension = max(
            0.0,
            (_CHEEK_ALAR_ATTACHMENT_X_V46 - float(oriented[0, 0]))
            / max(-float(tangent[0]), 1e-9),
        )
        natural_anchors.append(oriented[0] - extension * tangent)
        oriented_points[index] = (oriented, reverse)

    attachment_y = [float(anchor[1]) for anchor in natural_anchors]
    attachment_y[-1] = min(
        attachment_y[-1],
        _CHEEK_ALAR_ATTACHMENT_MAX_Y_V46,
    )
    for rank in range(len(attachment_y) - 2, -1, -1):
        attachment_y[rank] = min(
            attachment_y[rank],
            attachment_y[rank + 1] - _CHEEK_ALAR_ATTACHMENT_GAP_V46,
        )

    revised = list(curves)
    for index, target_y in zip(ordered, attachment_y, strict=True):
        oriented, reverse = oriented_points[index]
        segment_length = np.linalg.norm(np.diff(oriented, axis=0), axis=1)
        arc_fraction = np.r_[0.0, np.cumsum(segment_length)]
        arc_fraction /= arc_fraction[-1]
        join_index = int(
            np.searchsorted(
                arc_fraction,
                _CHEEK_ALAR_ATTACHMENT_JOIN_FRACTION_V46,
            )
        )
        join_index = min(max(join_index, 3), len(oriented) - 2)
        join = oriented[join_index]
        tangent = oriented[join_index + 1] - oriented[join_index - 1]
        tangent /= np.linalg.norm(tangent)
        anchor = np.array([_CHEEK_ALAR_ATTACHMENT_X_V46, target_y])
        chord = join - anchor
        chord_length = float(np.linalg.norm(chord))
        handle = min(0.018, max(0.004, chord_length / 3.0))
        first_control = anchor + chord / 3.0
        second_control = join - handle * tangent
        prefix = _cubic_bezier(
            anchor,
            first_control,
            second_control,
            join,
            max(8, int(math.ceil(chord_length / 0.0015))),
        )
        anchored = np.vstack([prefix[:-1], oriented[join_index:]])
        if reverse:
            anchored = anchored[::-1]
        revised[index] = Curve(curves[index].region, anchored)

    print(
        "[cheek-alar-boundary-anchors] half_lines=13 "
        f"attachment_x={_CHEEK_ALAR_ATTACHMENT_X_V46:.3f} "
        f"minimum_origin_gap={_CHEEK_ALAR_ATTACHMENT_GAP_V46:.3f} "
        f"maximum_origin_y={_CHEEK_ALAR_ATTACHMENT_MAX_Y_V46:.3f} "
        f"join_fraction={_CHEEK_ALAR_ATTACHMENT_JOIN_FRACTION_V46:.2f} "
        "body_mode=unchanged_v47_suffix"
    )
    return revised


def _reduce_cheek_bundle_to_ten_lines_v47(
    curves: list[Curve],
) -> list[Curve]:
    """Remove only the lower of the two v43 supplemental density layers."""
    density_indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == _CHEEK_LONG_ARC_DENSITY_REGION_V41
    ]
    if len(density_indices) != 2:
        raise RuntimeError(
            f"expected two supplemental cheek density lines, found {len(density_indices)}"
        )
    ordered = sorted(
        density_indices,
        key=lambda index: float(curves[index].points[-1, 1]),
    )
    removed_index = ordered[1]
    revised = list(curves)
    revised[removed_index] = Curve(
        _REMOVED_CHEEK_LONG_ARC_DENSITY_V47,
        curves[removed_index].points,
    )
    print(
        "[cheek-long-arc-ten-line-density] removed_half_lines=1 "
        "retained_fan_lines=9 retained_density_lines=1"
    )
    return revised


def _connect_perioral_fan_to_chin_v48(
    curves: list[Curve],
) -> list[Curve]:
    """Replace mouth-corner fragments with four complete upper-to-jaw arcs."""
    upper_indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == "perioral_vortex_fan_v38"
        and float(np.min(curve.points[:, 1])) <= 0.700
    ]
    lower_indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == "perioral_vortex_fan_v38"
        and float(np.min(curve.points[:, 1])) > 0.700
    ]
    if len(lower_indices) != 6:
        raise RuntimeError(
            f"expected six lower perioral vortex lines, found {len(lower_indices)}"
        )
    if len(upper_indices) != 6:
        raise RuntimeError(
            f"expected six upper perioral vortex lines, found {len(upper_indices)}"
        )
    ordered_upper = sorted(
        upper_indices,
        key=lambda index: float(np.min(curves[index].points[:, 0])),
    )
    continued_upper = ordered_upper[:3]
    revised = list(curves)
    for rank, (index, target) in enumerate(zip(
        continued_upper,
        _PERIORAL_CHIN_TARGETS_V48,
        strict=True,
    )):
        upper = curves[index].points[::-1].copy()
        start = upper[-1]
        end = np.asarray(target, dtype=np.float64)
        fraction = rank / (len(continued_upper) - 1)
        join_tangent = start - upper[-2]
        join_tangent /= np.linalg.norm(join_tangent)
        waypoint = np.array(
            [0.295 + 0.010 * rank, 0.765 + 0.005 * rank],
            dtype=np.float64,
        )
        waypoint_tangent = waypoint - start
        waypoint_tangent /= np.linalg.norm(waypoint_tangent)
        first = _cubic_bezier(
            start,
            start + join_tangent * (0.008 + 0.002 * fraction),
            waypoint - waypoint_tangent * 0.018,
            waypoint,
            80,
        )
        second_control = end + np.array(
            [0.025 - 0.004 * fraction, -0.076 + 0.006 * fraction]
        )
        second = _cubic_bezier(
            waypoint,
            waypoint + waypoint_tangent * 0.018,
            second_control,
            end,
            81,
        )
        connected = np.vstack([first, second[1:]])
        revised[index] = Curve(
            curves[index].region,
            np.vstack([upper, connected[1:]]),
        )
    for index in lower_indices:
        revised[index] = Curve(
            _REMOVED_PERIORAL_CHIN_FRAGMENT_V48,
            revised[index].points,
        )
    for index in ordered_upper[3:]:
        revised[index] = Curve(
            _REMOVED_PERIORAL_CHIN_FRAGMENT_V48,
            revised[index].points,
        )

    for index in _PERIORAL_CHIN_FRAGMENT_INDICES_V48:
        if index >= len(revised) or revised[index].region not in {"chin", "jaw"}:
            raise RuntimeError(
                f"expected chin/jaw fragment at source index {index}"
            )
        revised[index] = Curve(
            _REMOVED_PERIORAL_CHIN_FRAGMENT_V48,
            revised[index].points,
        )
    print(
        "[perioral-chin-continuity] rebuilt_half_lines=3 "
        "removed_half_fragments=16 preserved_complete_chin_lines=true"
    )
    return revised


def _perioral_swirl_turning_v49(points: np.ndarray) -> np.ndarray:
    """Vertex turning angles in degrees for one dense polyline."""
    before = points[1:-1] - points[:-2]
    after = points[2:] - points[1:-1]
    norm_before = np.linalg.norm(before, axis=1)
    norm_after = np.linalg.norm(after, axis=1)
    valid = (norm_before > 1e-9) & (norm_after > 1e-9)
    cosine = np.sum(before[valid] * after[valid], axis=1) / (
        norm_before[valid] * norm_after[valid]
    )
    return np.degrees(np.arccos(np.clip(cosine, -1.0, 1.0)))


def _perioral_swirl_catmull_rom_v49(
    waypoints: list[np.ndarray],
    samples_per_span: int,
    pred: np.ndarray,
    succ: np.ndarray,
) -> np.ndarray:
    """Catmull-Rom spline through the swirl channel waypoints."""
    out = [waypoints[0]]
    ext = [pred, *waypoints, succ]
    for k in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[k - 1], ext[k], ext[k + 1], ext[k + 2]
        segment = _cubic_bezier(
            p1,
            p1 + (p2 - p0) / 6.0,
            p2 - (p3 - p1) / 6.0,
            p2,
            samples_per_span + 1,
        )
        out.extend(segment[1:])
    return np.asarray(out)


def _perioral_swirl_fair_v49(
    points: np.ndarray,
    frozen: int,
    iterations: int = 80,
    max_turn_deg: float = 6.0,
    max_displacement: float = 0.0006,
) -> np.ndarray:
    """Locally fair only the high-turn hook vertices past the frozen prefix."""
    faired = points.copy()
    for _ in range(iterations):
        turns = _perioral_swirl_turning_v49(faired)
        indices = np.where(turns > max_turn_deg)[0] + 1
        indices = indices[indices >= frozen]
        if len(indices) == 0:
            break
        moved = False
        for index in indices:
            target = 0.5 * (faired[index - 1] + faired[index + 1])
            delta = 0.6 * (target - faired[index])
            norm = float(np.linalg.norm(delta))
            if norm > max_displacement:
                delta *= max_displacement / norm
            if norm > 1e-9:
                faired[index] += delta
                moved = True
        if not moved:
            break
    return faired


def _perioral_swirl_line_v49(
    upper: np.ndarray,
    channel: tuple[tuple[float, float], ...],
    corridor: tuple[float, float],
    target: tuple[float, float],
) -> np.ndarray:
    """One complete upper-lip-to-jaw swirl line with a tangent-matched hook."""
    start = upper[-1]
    arrival = start - upper[-2]
    arrival /= np.linalg.norm(arrival)
    corridor_point = np.asarray(corridor, dtype=np.float64)
    target_point = np.asarray(target, dtype=np.float64)
    waypoints = [np.asarray(p, dtype=np.float64) for p in channel]
    waypoints += [corridor_point, target_point]
    chord = waypoints[0] - start
    guide = start + arrival * min(0.006, 0.3 * float(np.linalg.norm(chord)))
    t = np.linspace(0.0, 1.0, 40)[:, None]
    first = (1 - t) ** 2 * start + 2 * t * (1 - t) * guide + t**2 * waypoints[0]
    rest = _perioral_swirl_catmull_rom_v49(
        waypoints,
        28,
        pred=guide,
        succ=target_point + 0.6 * (target_point - corridor_point),
    )
    line = np.vstack([upper, first[1:], rest[1:]])
    return _perioral_swirl_fair_v49(line, len(upper) + 1)


def _rebuild_perioral_commissure_swirl_v49(
    curves: list[Curve],
) -> list[Curve]:
    """Replace the three v48 mouth-corner arcs with five nested swirl lines.

    Each new line restores one accepted v38 upper path (the second and third
    v48 arcs' preserved upper halves plus the three removed upper fragments),
    wraps the mouth corner through a nested channel between the lip aperture
    and the fixed separatrix, and descends to a staggered jaw endpoint inside
    the corridor between the separatrix and the outermost complete chin line.
    """
    v48_indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == "perioral_vortex_fan_v38"
    ]
    removed_upper_indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == _REMOVED_PERIORAL_CHIN_FRAGMENT_V48
        and float(np.min(curve.points[:, 1])) < 0.700
    ]
    if len(v48_indices) != 3:
        raise RuntimeError(
            f"expected three v48 perioral arcs, found {len(v48_indices)}"
        )
    if len(removed_upper_indices) != 3:
        raise RuntimeError(
            "expected three removed upper perioral fragments, found "
            f"{len(removed_upper_indices)}"
        )
    ordered_v48 = sorted(
        v48_indices, key=lambda index: float(np.min(curves[index].points[:, 0]))
    )
    ordered_removed = sorted(
        removed_upper_indices,
        key=lambda index: float(np.min(curves[index].points[:, 0])),
    )
    uppers = [
        curves[ordered_v48[1]].points[:48].copy(),
        curves[ordered_v48[2]].points[:48].copy(),
        curves[ordered_removed[0]].points[::-1].copy(),
        curves[ordered_removed[1]].points[::-1].copy(),
        curves[ordered_removed[2]].points[::-1].copy(),
    ]
    revised = list(curves)
    for index in v48_indices:
        revised[index] = Curve(
            _REMOVED_PERIORAL_CHIN_FRAGMENT_V48,
            curves[index].points,
        )
    swirl = [
        Curve(
            _PERIORAL_COMMISSURE_SWIRL_REGION_V49,
            _perioral_swirl_line_v49(upper, channel, corridor, target),
        )
        for upper, channel, corridor, target in zip(
            uppers,
            _PERIORAL_SWIRL_CHANNELS_V49,
            _PERIORAL_SWIRL_CORRIDOR_WAYPOINTS_V49,
            _PERIORAL_SWIRL_TARGETS_V49,
            strict=True,
        )
    ]
    print(
        "[perioral-commissure-swirl] removed_half_arcs=3 new_half_lines=5 "
        "nested_corner_channels=5 restored_upper_paths=5"
    )
    return revised + swirl


def _add_perioral_commissure_radial_fan_v50(
    curves: list[Curve],
) -> list[Curve]:
    """Add the standard diagram's lateral fan into the oral commissure."""
    if _PERIORAL_COMMISSURE_STROKE_CLEARANCE_V52:
        guides = _PERIORAL_COMMISSURE_RADIAL_GUIDES_V52
    elif _PERIORAL_COMMISSURE_PIXEL_CLEARANCE_V51:
        guides = _PERIORAL_COMMISSURE_RADIAL_GUIDES_V51
    else:
        guides = _PERIORAL_COMMISSURE_RADIAL_GUIDES_V50
    trim_ranges = (
        _PERIORAL_COMMISSURE_RADIAL_TRIM_RANGES_V52
        if _PERIORAL_COMMISSURE_STROKE_CLEARANCE_V52
        else ((0.0, 1.0),) * len(guides)
    )
    radial = [
        Curve(
            _PERIORAL_COMMISSURE_RADIAL_REGION_V50,
            _cubic_bezier(
                np.asarray(start, dtype=np.float64),
                np.asarray(first_control, dtype=np.float64),
                np.asarray(second_control, dtype=np.float64),
                np.asarray(end, dtype=np.float64),
                120,
                t_start,
                t_end,
            ),
        )
        for (start, first_control, second_control, end), (t_start, t_end) in zip(
            guides,
            trim_ranges,
            strict=True,
        )
    ]
    print(
        "[perioral-commissure-focus] new_half_radial_lines=5 "
        "preserved_v49_swirl=true "
        f"pixel_clearance_v51={_PERIORAL_COMMISSURE_PIXEL_CLEARANCE_V51} "
        f"stroke_clearance_v52={_PERIORAL_COMMISSURE_STROKE_CLEARANCE_V52}"
    )
    return curves + radial


def _open_cheek_gap_bridge_corridor_v54(curves: list[Curve]) -> list[Curve]:
    """Open the root-to-cheek bottleneck without moving either boundary endpoint."""
    nasal_indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == "nose_side_downturn_v9"
    ]
    root_indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == "nose_root_cross_v9"
    ]
    if len(nasal_indices) != 5 or len(root_indices) != 2:
        raise RuntimeError(
            "expected five nasal-side curves and two nose-root boundaries"
        )

    def lateral_y(index: int) -> float:
        points = curves[index].points
        endpoint = 0 if float(points[0, 0]) < float(points[-1, 0]) else -1
        return float(points[endpoint, 1])

    top_nasal_index = min(nasal_indices, key=lateral_y)
    lower_root_index = max(root_indices, key=lateral_y)
    start_x, end_x = _CHEEK_GAP_BRIDGE_WINDOW_V54
    revised = list(curves)
    for index, direction in (
        (lower_root_index, -1.0),
        (top_nasal_index, 1.0),
    ):
        points = curves[index].points.copy()
        phase = np.clip((points[:, 0] - start_x) / (end_x - start_x), 0.0, 1.0)
        window = np.sin(np.pi * phase) ** 2
        points[:, 1] += direction * _CHEEK_GAP_BRIDGE_SHIFT_V54 * window
        revised[index] = Curve(curves[index].region, points)

    print(
        "[cheek-gap-bridge-corridor] changed_half_lines=2 "
        f"maximum_shift={_CHEEK_GAP_BRIDGE_SHIFT_V54:.4f} "
        f"window={_CHEEK_GAP_BRIDGE_WINDOW_V54} endpoints_fixed=true"
    )
    return revised


def _add_cheek_gap_density_v53(curves: list[Curve]) -> list[Curve]:
    """Fill the three user-marked upper-cheek gaps without moving existing lines."""

    def lateral_to_medial(points: np.ndarray) -> np.ndarray:
        return points if float(points[0, 0]) < float(points[-1, 0]) else points[::-1]

    def parameterized(points: np.ndarray) -> np.ndarray:
        oriented = lateral_to_medial(points)
        arclength = np.r_[
            0.0,
            np.cumsum(np.linalg.norm(np.diff(oriented, axis=0), axis=1)),
        ]
        arclength /= arclength[-1]
        t = np.linspace(0.0, 1.0, _CHEEK_DENSITY_SAMPLES_V41)
        return np.column_stack(
            [np.interp(t, arclength, oriented[:, axis]) for axis in range(2)]
        )

    def midpoint_by_x(first: np.ndarray, second: np.ndarray) -> np.ndarray:
        first = lateral_to_medial(first)
        second = lateral_to_medial(second)
        start_x = max(float(first[0, 0]), float(second[0, 0]))
        end_x = min(float(first[-1, 0]), float(second[-1, 0]))
        x = np.linspace(start_x, end_x, _CHEEK_DENSITY_SAMPLES_V41)
        first_y = np.interp(x, first[:, 0], first[:, 1])
        second_y = np.interp(x, second[:, 0], second[:, 1])
        return np.column_stack([x, 0.5 * (first_y + second_y)])

    nasal = [curve for curve in curves if curve.region == "nose_side_downturn_v9"]
    roots = [curve for curve in curves if curve.region == "nose_root_cross_v9"]
    if len(nasal) != 5 or len(roots) != 2:
        raise RuntimeError(
            "expected five nasal-side curves and two nose-root boundaries"
        )
    nasal.sort(key=lambda curve: float(lateral_to_medial(curve.points)[0, 1]))
    lower_root = max(
        roots,
        key=lambda curve: float(lateral_to_medial(curve.points)[0, 1]),
    )

    upper_midpoint = midpoint_by_x(lower_root.points, nasal[0].points)
    if _CHEEK_GAP_BRIDGE_CONTINUITY_V54:
        outer = upper_midpoint[
            upper_midpoint[:, 0] <= _CHEEK_GAP_UPPER_MAX_X_V53
        ]
        root = lateral_to_medial(lower_root.points)
        extension_x = np.linspace(
            float(outer[-1, 0]),
            CENTER_X,
            _CHEEK_DENSITY_SAMPLES_V41 // 2,
        )
        root_y = np.interp(extension_x, root[:, 0], root[:, 1])
        start_offset = float(outer[-1, 1] - root_y[0])
        phase = (extension_x - extension_x[0]) / (extension_x[-1] - extension_x[0])
        easing = phase * phase * (3.0 - 2.0 * phase)
        offset = (
            (1.0 - easing) * start_offset
            + easing * _CHEEK_GAP_BRIDGE_ROOT_OFFSET_V54
        )
        extension = np.column_stack([extension_x, root_y + offset])
        upper_midpoint = np.vstack([outer[:-1], extension])
    else:
        upper_midpoint = upper_midpoint[
            upper_midpoint[:, 0] <= _CHEEK_GAP_UPPER_MAX_X_V53
        ]
    boundary_pairs = (
        (nasal[0], nasal[1]),
        (nasal[2], nasal[3]),
    )
    added = [
        Curve(
            _CHEEK_GAP_DENSITY_REGION_V53,
            resample(upper_midpoint, spacing=0.0035),
        )
    ]
    for pair_index, (upper_curve, lower_curve) in enumerate(boundary_pairs):
        upper = parameterized(upper_curve.points)
        lower = parameterized(lower_curve.points)
        midpoint = 0.5 * (upper + lower)
        if _CHEEK_GAP_NASAL_TIP_EXTENSION_V55:
            start_fraction, end_fraction = (
                _CHEEK_GAP_MIDDLE_RANGE_V55
                if pair_index == 0
                else _CHEEK_GAP_LOWER_RANGE_V55
            )
        else:
            start_fraction, end_fraction = (
                _CHEEK_GAP_MIDDLE_RANGE_V53
                if pair_index == 0
                else _CHEEK_GAP_LOWER_RANGE_V53
            )
        start = int(math.floor(len(midpoint) * start_fraction))
        end = int(math.ceil(len(midpoint) * end_fraction))
        midpoint = midpoint[start:end]
        added.append(
            Curve(
                _CHEEK_GAP_DENSITY_REGION_V53,
                resample(midpoint, spacing=0.0035),
            )
        )

    print(
        "[cheek-gap-density] new_half_lines=3 "
        "corridors=(root-0094,0094-0096,0097-0099) preserved_existing=true"
    )
    return curves + added


def _open_cheek_gap_nasal_tip_corridors_v55(curves: list[Curve]) -> list[Curve]:
    """Open only the two trimmed midpoint corridors near their nasal-tip ends."""
    nasal_indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == "nose_side_downturn_v9"
    ]
    if len(nasal_indices) != 5:
        raise RuntimeError(f"expected five nasal-side curves, found {len(nasal_indices)}")

    def lateral_y(index: int) -> float:
        points = curves[index].points
        endpoint = 0 if float(points[0, 0]) < float(points[-1, 0]) else -1
        return float(points[endpoint, 1])

    ordered = sorted(nasal_indices, key=lateral_y)
    revised = list(curves)
    adjustments = (
        (
            ordered[1],
            _CHEEK_GAP_UPPER_TAPER_V55,
            -_CHEEK_GAP_UPPER_BOUNDARY_LATERAL_SHIFT_V55,
        ),
        (
            ordered[2],
            _CHEEK_GAP_LOWER_TAPER_V55,
            -_CHEEK_GAP_UPPER_BOUNDARY_LATERAL_SHIFT_V55,
        ),
        (
            ordered[3],
            _CHEEK_GAP_LOWER_TAPER_V55,
            -_CHEEK_GAP_LOWER_BOUNDARY_LATERAL_SHIFT_V55,
        ),
    )
    for index, taper, endpoint_shift in adjustments:
        points = curves[index].points.copy()
        oriented = points if float(points[0, 0]) < float(points[-1, 0]) else points[::-1]
        segment = np.linalg.norm(np.diff(oriented, axis=0), axis=1)
        fraction = np.r_[0.0, np.cumsum(segment)]
        fraction /= fraction[-1]
        start_fraction, end_fraction = taper
        phase = np.clip(
            (fraction - start_fraction) / (end_fraction - start_fraction),
            0.0,
            1.0,
        )
        easing = phase * phase * (3.0 - 2.0 * phase)
        oriented[:, 0] += endpoint_shift * easing
        revised[index] = Curve(curves[index].region, oriented)

    print(
        "[cheek-gap-nasal-tip-corridors] changed_half_lines=3 "
        "upper_boundary_lateral_shift="
        f"{_CHEEK_GAP_UPPER_BOUNDARY_LATERAL_SHIFT_V55:.4f} "
        "lower_boundary_lateral_shift="
        f"{_CHEEK_GAP_LOWER_BOUNDARY_LATERAL_SHIFT_V55:.4f} "
        "visible_midpoint_prefixes_preserved=true central_gap_preserved=true"
    )
    return revised


def _add_cheek_nasal_transition_density_v56(curves: list[Curve]) -> list[Curve]:
    """Fill the corridor below the lowest nasal turn without entering its bottleneck."""

    def lateral_to_medial(points: np.ndarray) -> np.ndarray:
        return points if float(points[0, 0]) < float(points[-1, 0]) else points[::-1]

    nasal_indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == "nose_side_downturn_v9"
    ]
    fan_indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == _CHEEK_LONG_ARC_FAN_REGION_V24
    ]
    if len(nasal_indices) != 5 or len(fan_indices) != 9:
        raise RuntimeError(
            "expected five nasal-side curves and nine cheek-fan curves"
        )

    def outer_y(index: int) -> float:
        points = lateral_to_medial(curves[index].points)
        return float(points[0, 1])

    lower_nasal_index = max(nasal_indices, key=outer_y)
    upper_fan_index = min(fan_indices, key=outer_y)
    revised = list(curves)

    lower_nasal = lateral_to_medial(curves[lower_nasal_index].points).copy()
    x = lower_nasal[:, 0]
    rise_phase = np.clip((x - 0.24) / (0.37 - 0.24), 0.0, 1.0)
    fall_phase = np.clip((x - 0.41) / (0.45 - 0.41), 0.0, 1.0)
    rise = rise_phase * rise_phase * (3.0 - 2.0 * rise_phase)
    fall = fall_phase * fall_phase * (3.0 - 2.0 * fall_phase)
    window = rise * (1.0 - fall)
    lower_nasal[:, 1] -= _CHEEK_NASAL_TRANSITION_CORNER_SHIFT_V56 * window
    revised[lower_nasal_index] = Curve(
        curves[lower_nasal_index].region,
        lower_nasal,
    )

    upper_fan = lateral_to_medial(curves[upper_fan_index].points)
    start_x = max(float(lower_nasal[0, 0]), float(upper_fan[0, 0]))
    added: list[Curve] = []
    for fraction, end_x in zip(
        _CHEEK_NASAL_TRANSITION_DENSITY_FRACTIONS_V56,
        _CHEEK_NASAL_TRANSITION_END_X_V56,
        strict=True,
    ):
        sample_x = np.linspace(start_x, end_x, _CHEEK_DENSITY_SAMPLES_V41)
        nasal_y = np.interp(sample_x, lower_nasal[:, 0], lower_nasal[:, 1])
        fan_y = np.interp(sample_x, upper_fan[:, 0], upper_fan[:, 1])
        sample_y = (1.0 - fraction) * nasal_y + fraction * fan_y
        added.append(
            Curve(
                _CHEEK_NASAL_TRANSITION_DENSITY_REGION_V56,
                resample(np.column_stack([sample_x, sample_y]), spacing=0.0035),
            )
        )

    print(
        "[cheek-nasal-transition-density] changed_half_lines=1 "
        f"new_half_lines={len(added)} "
        f"corner_shift={_CHEEK_NASAL_TRANSITION_CORNER_SHIFT_V56:.4f} "
        f"end_x={_CHEEK_NASAL_TRANSITION_END_X_V56}"
    )
    return revised + added


def _trim_superior_orbital_lateral_tail_v57(curves: list[Curve]) -> list[Curve]:
    """Remove only the user-marked lateral tail of the superior orbital guide."""
    indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == "superior_orbital_guide_v14"
    ]
    if len(indices) != 1:
        raise RuntimeError(
            f"expected one superior orbital half-curve, found {len(indices)}"
        )
    index = indices[0]
    points = curves[index].points
    oriented = points if float(points[0, 0]) < float(points[-1, 0]) else points[::-1]
    keep = oriented[:, 0] > _SUPERIOR_ORBITAL_LATERAL_START_X_V57
    first_kept = int(np.argmax(keep))
    if first_kept == 0 or not np.any(keep):
        raise RuntimeError("superior orbital guide does not cross the trim boundary")
    before = oriented[first_kept - 1]
    after = oriented[first_kept]
    fraction = (
        (_SUPERIOR_ORBITAL_LATERAL_START_X_V57 - before[0])
        / (after[0] - before[0])
    )
    boundary = before + fraction * (after - before)
    trimmed = np.vstack([boundary, oriented[first_kept:]])
    revised = list(curves)
    revised[index] = Curve(
        curves[index].region,
        resample(trimmed, spacing=0.0035),
    )
    print(
        "[superior-orbital-lateral-tail-removal] changed_half_lines=1 "
        f"new_lateral_start_x={_SUPERIOR_ORBITAL_LATERAL_START_X_V57:.3f} "
        "medial_endpoint_preserved=true"
    )
    return revised


def _remove_superior_orbital_guide_v58(curves: list[Curve]) -> list[Curve]:
    """Remove the complete symmetric 0110 guide while preserving source indices."""
    indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == "superior_orbital_guide_v14"
    ]
    if len(indices) != 1:
        raise RuntimeError(
            f"expected one superior orbital half-curve, found {len(indices)}"
        )
    revised = list(curves)
    index = indices[0]
    revised[index] = Curve(
        _REMOVED_SUPERIOR_ORBITAL_GUIDE_V58,
        curves[index].points,
    )
    print(
        "[superior-orbital-guide-removal] removed_half_lines=1 "
        "preserved_source_index=true"
    )
    return revised


def _replace_curve_lateral_prefix_v65(
    points: np.ndarray,
    start_x: float,
    outer_y: float,
    blend_x: float,
) -> np.ndarray:
    """Replace an outer prefix with a flat-to-existing-tangent Hermite segment."""
    oriented = points if float(points[0, 0]) < float(points[-1, 0]) else points[::-1]
    keep = oriented[:, 0] >= blend_x
    first_kept = int(np.argmax(keep))
    if first_kept == 0 or not np.any(keep):
        raise RuntimeError(f"curve does not cross prefix blend x={blend_x:.3f}")
    before = oriented[first_kept - 1]
    after = oriented[first_kept]
    fraction = (blend_x - before[0]) / (after[0] - before[0])
    join = before + fraction * (after - before)
    join_slope = float((after[1] - before[1]) / (after[0] - before[0]))
    sample_x = np.linspace(start_x, blend_x, 60, endpoint=False)
    width = blend_x - start_x
    t = (sample_x - start_x) / width
    h00 = 2.0 * t**3 - 3.0 * t**2 + 1.0
    h01 = -2.0 * t**3 + 3.0 * t**2
    h11 = t**3 - t**2
    sample_y = h00 * outer_y + h01 * float(join[1]) + h11 * width * join_slope
    extension = np.column_stack([sample_x, sample_y])
    return np.vstack([extension, join, oriented[first_kept:]])


def _add_lateral_canthus_short_arcs_v65(curves: list[Curve]) -> list[Curve]:
    """Add four rising outer-canthus arcs and extend three under-eye lines."""
    revised = list(curves)

    infraorbital = [
        index for index, curve in enumerate(curves) if curve.region == "nose_root_cross_v9"
    ]
    upper_cheek_bridge = [
        index
        for index, curve in enumerate(curves)
        if curve.region == _CHEEK_GAP_DENSITY_REGION_V53
        and min(abs(curve.points[0, 0] - CENTER_X), abs(curve.points[-1, 0] - CENTER_X))
        < 0.008
    ]
    if len(infraorbital) != 2 or len(upper_cheek_bridge) != 1:
        raise RuntimeError(
            "expected two infraorbital waves and one cross-face upper-cheek bridge; "
            f"found {len(infraorbital)} and {len(upper_cheek_bridge)}"
        )
    def outer_y(index: int) -> float:
        points = curves[index].points
        endpoint = 0 if float(points[0, 0]) < float(points[-1, 0]) else -1
        return float(points[endpoint, 1])

    changed = sorted(infraorbital, key=outer_y) + upper_cheek_bridge
    for index, target_outer_y in zip(
        changed,
        _LATERAL_CANTHUS_UNDEREYE_OUTER_Y_V65,
        strict=True,
    ):
        revised[index] = Curve(
            curves[index].region,
            _replace_curve_lateral_prefix_v65(
                curves[index].points,
                _LATERAL_CANTHUS_UNDEREYE_START_X_V65,
                target_outer_y,
                _LATERAL_CANTHUS_UNDEREYE_BLEND_X_V65,
            ),
        )

    short_arcs: list[Curve] = []
    for rank in range(4):
        outer_layer = 0.013 * rank
        controls = np.asarray(
            (
                (_LATERAL_CANTHUS_NEW_START_X_V65, 0.330 + outer_layer),
                (0.085, 0.325 + 0.0110 * rank),
                (0.155, 0.311 + 0.0085 * rank),
                (_LATERAL_CANTHUS_NEW_END_X_V65, 0.299 + 0.0070 * rank),
            ),
            dtype=np.float64,
        )
        points = _cubic_bezier(*controls, 90)
        short_arcs.append(
            Curve(
                _LATERAL_CANTHUS_SHORT_ARC_REGION_V65,
                resample(points, spacing=0.0035),
            )
        )

    print(
        "[lateral-canthus-short-arcs] extended_half_lines=3 "
        f"new_half_lines={len(short_arcs)} undereye_start_x="
        f"{_LATERAL_CANTHUS_UNDEREYE_START_X_V65:.3f} "
        f"undereye_blend_x={_LATERAL_CANTHUS_UNDEREYE_BLEND_X_V65:.3f} "
        f"new_span_x=({_LATERAL_CANTHUS_NEW_START_X_V65:.3f}, "
        f"{_LATERAL_CANTHUS_NEW_END_X_V65:.3f})"
    )
    return revised + short_arcs


def _densify_and_extend_orbital_brow_v59(curves: list[Curve]) -> list[Curve]:
    """Rebuild seven evenly spaced brow layers and extend both endpoint families."""
    indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == "orbital_brow_upturn_v11"
    ]
    if len(indices) != 5:
        raise RuntimeError(f"expected five orbital-brow half-curves, found {len(indices)}")

    def outer_y(index: int) -> float:
        points = curves[index].points
        endpoint = 0 if float(points[0, 0]) < float(points[-1, 0]) else -1
        return float(points[endpoint, 1])

    def parameterized(points: np.ndarray) -> np.ndarray:
        oriented = points if float(points[0, 0]) < float(points[-1, 0]) else points[::-1]
        arc = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(oriented, axis=0), axis=1))]
        arc /= arc[-1]
        t = np.linspace(0.0, 1.0, 320)
        return np.column_stack(
            [np.interp(t, arc, oriented[:, axis]) for axis in range(2)]
        )

    def extend(points: np.ndarray) -> np.ndarray:
        outer_start_x = float(points[0, 0]) - _ORBITAL_BROW_OUTER_EXTENSION_V59
        outer_x = np.linspace(outer_start_x, float(points[0, 0]), 8, endpoint=False)
        outer = np.column_stack([outer_x, np.full_like(outer_x, points[0, 1])])
        inner_y = np.linspace(
            float(points[-1, 1]),
            float(points[-1, 1]) - _ORBITAL_BROW_INNER_EXTENSION_V59,
            5,
        )[1:]
        inner = np.column_stack([np.full_like(inner_y, points[-1, 0]), inner_y])
        return resample(np.vstack([outer, points, inner]), spacing=0.0035)

    ordered = sorted(indices, key=outer_y)
    top = parameterized(curves[ordered[0]].points)
    bottom = parameterized(curves[ordered[-1]].points)
    bottom[:, 1] += _ORBITAL_BROW_BOTTOM_EXPANSION_V59
    layers = [
        extend((1.0 - fraction) * top + fraction * bottom)
        for fraction in np.linspace(0.0, 1.0, 7)
    ]
    revised = list(curves)
    retained_ranks = (0, 1, 3, 5, 6)
    for index, rank in zip(ordered, retained_ranks, strict=True):
        revised[index] = Curve("orbital_brow_upturn_v11", layers[rank])
    revised.extend(
        Curve("orbital_brow_upturn_v11", layers[rank])
        for rank in (2, 4)
    )
    print(
        "[orbital-brow-density-extension] original_half_lines=5 new_half_lines=2 "
        f"outer_extension={_ORBITAL_BROW_OUTER_EXTENSION_V59:.3f} "
        f"inner_extension={_ORBITAL_BROW_INNER_EXTENSION_V59:.3f} "
        f"bottom_expansion={_ORBITAL_BROW_BOTTOM_EXPANSION_V59:.3f}"
    )
    return revised


def _extend_orbital_brow_medial_endpoints_v60(curves: list[Curve]) -> list[Curve]:
    """Extend only the seven medial vertical brow tails farther upward."""
    forehead = [
        curve.points
        for curve in curves
        if curve.region == "forehead_bridge_arc_v15"
    ]
    if not forehead:
        raise RuntimeError("expected forehead bridge arcs for brow-tail clearance")

    def forehead_ceiling_y(x: float) -> float:
        crossings: list[float] = []
        for points in forehead:
            order = np.argsort(points[:, 0])
            ordered = points[order]
            if float(ordered[0, 0]) <= x <= float(ordered[-1, 0]):
                crossings.append(float(np.interp(x, ordered[:, 0], ordered[:, 1])))
        if not crossings:
            raise RuntimeError(f"forehead bridge has no crossing at x={x:.6f}")
        return max(crossings)

    revised: list[Curve] = []
    changed = 0
    extension_amounts: list[float] = []
    brow_inner_x = [
        float(max(curve.points[0, 0], curve.points[-1, 0]))
        for curve in curves
        if curve.region == "orbital_brow_upturn_v11"
    ]
    if len(brow_inner_x) != 7:
        raise RuntimeError(f"expected seven orbital-brow half-curves, found {len(brow_inner_x)}")
    inner_x_min = min(brow_inner_x)
    inner_x_span = max(brow_inner_x) - inner_x_min
    if inner_x_span <= 1e-9:
        raise RuntimeError("orbital-brow medial endpoints have no horizontal span")
    for curve in curves:
        if curve.region != "orbital_brow_upturn_v11":
            revised.append(curve)
            continue
        points = curve.points.copy()
        if float(points[0, 0]) > float(points[-1, 0]):
            points = points[::-1]
        if _ORBITAL_BROW_MEDIAL_LONGER_EXTENSION_V61:
            fraction = (float(points[-1, 0]) - inner_x_min) / inner_x_span
            extension_amount = (
                _ORBITAL_BROW_MEDIAL_EXTENSION_RANGE_V61[0]
                + fraction
                * (
                    _ORBITAL_BROW_MEDIAL_EXTENSION_RANGE_V61[1]
                    - _ORBITAL_BROW_MEDIAL_EXTENSION_RANGE_V61[0]
                )
            )
        else:
            available = (
                float(points[-1, 1])
                - forehead_ceiling_y(float(points[-1, 0]))
                - _ORBITAL_BROW_FOREHEAD_CLEARANCE_V60
            )
            extension_amount = min(
                _ORBITAL_BROW_MEDIAL_ADDITIONAL_EXTENSION_V60,
                available,
            )
        if extension_amount <= 0.0:
            raise RuntimeError(
                f"no safe upward clearance for orbital-brow endpoint at x={points[-1, 0]:.6f}"
            )
        inner_y = np.linspace(
            float(points[-1, 1]),
            float(points[-1, 1]) - extension_amount,
            8,
        )[1:]
        extension = np.column_stack(
            [np.full_like(inner_y, points[-1, 0]), inner_y]
        )
        revised.append(
            Curve(curve.region, resample(np.vstack([points, extension]), spacing=0.0035))
        )
        changed += 1
        extension_amounts.append(extension_amount)
    if changed != 7:
        raise RuntimeError(f"expected seven orbital-brow half-curves, found {changed}")
    print(
        "[orbital-brow-medial-endpoint-extension] changed_half_lines=7 "
        f"extension_min={min(extension_amounts):.4f} "
        f"extension_max={max(extension_amounts):.4f} "
        f"mode={'fixed_range_v61' if _ORBITAL_BROW_MEDIAL_LONGER_EXTENSION_V61 else 'clearance_v60'}"
    )
    return revised


def _rebuild_forehead_fourteen_arches_v62(curves: list[Curve]) -> list[Curve]:
    """Rebuild the forehead as fourteen evenly spaced, smooth bridge arches."""
    indices = [
        index
        for index, curve in enumerate(curves)
        if curve.region == "forehead_bridge_arc_v15"
    ]
    if len(indices) != 8:
        raise RuntimeError(f"expected eight forehead bridge arcs, found {len(indices)}")

    def outer_y(index: int) -> float:
        return float(np.max(curves[index].points[:, 1]))

    def arch(level: float) -> Curve:
        vertical = (level - 0.515) / 0.505
        outer_x = (
            0.5
            - 0.465 * math.sqrt(max(0.0, 1.0 - vertical * vertical))
            + 0.010
        )
        x = np.linspace(outer_x, CENTER_X, 180)
        t = (x - outer_x) / (CENTER_X - outer_x)
        easing = 0.5 - 0.5 * np.cos(np.pi * t)
        y = level - _FOREHEAD_ARCHED_CROWN_RISE_V62 * easing
        return Curve(
            "forehead_bridge_arc_v15",
            resample(np.column_stack([x, y]), spacing=0.0035),
        )

    layers = [arch(level) for level in _FOREHEAD_ARCHED_LEVELS_V62]
    ordered = sorted(indices, key=outer_y)
    retained_ranks = (0, 2, 4, 6, 8, 10, 12, 13)
    revised = list(curves)
    for index, rank in zip(ordered, retained_ranks, strict=True):
        revised[index] = layers[rank]
    revised.extend(layers[rank] for rank in (1, 3, 5, 7, 9, 11))
    print(
        "[forehead-fourteen-arched-density] original_half_lines=8 new_half_lines=6 "
        f"level_range=({_FOREHEAD_ARCHED_LEVELS_V62[0]}, "
        f"{_FOREHEAD_ARCHED_LEVELS_V62[-1]}) "
        f"crown_rise={_FOREHEAD_ARCHED_CROWN_RISE_V62:.3f}"
    )
    return revised


def _shift_forehead_arches_rigidly_downward_v63(curves: list[Curve]) -> list[Curve]:
    """Translate all fourteen accepted forehead arches downward without reshaping."""
    shift_amount = (
        _FOREHEAD_TOTAL_DOWNWARD_AMOUNT_V64
        if _FOREHEAD_ADDITIONAL_DOWNWARD_SHIFT_V64
        else _FOREHEAD_RIGID_DOWNWARD_AMOUNT_V63
    )
    revised: list[Curve] = []
    changed = 0
    for curve in curves:
        if curve.region != "forehead_bridge_arc_v15":
            revised.append(curve)
            continue
        points = curve.points.copy()
        points[:, 1] += shift_amount
        revised.append(Curve(curve.region, points))
        changed += 1
    if changed != 14:
        raise RuntimeError(f"expected fourteen forehead arches, found {changed}")
    print(
        "[forehead-rigid-downward-shift] changed_half_lines=14 "
        f"canonical_y_shift={shift_amount:.3f}"
    )
    return revised


def _apply_philtrum_nasal_base_stop(curves: list[Curve]) -> list[Curve]:
    """Trim only central philtrum strands at the lower border of the nose.

    The v8.1.12 nostril ellipse keeps the apertures empty, but central vertical
    streamlines can bypass that lateral ellipse and remain continuous from the
    upper lip onto the nasal surface.  This post-process separates those line
    families without changing the surrounding nose, cheek, or commissure flow.
    """
    result: list[Curve] = []
    trimmed_count = 0
    for curve in curves:
        points = curve.points
        tangents = np.diff(points, axis=0)
        midpoints = (points[:-1] + points[1:]) * 0.5
        sample = (
            (midpoints[:, 1] >= 0.540)
            & (midpoints[:, 1] <= 0.675)
            & (midpoints[:, 0] >= 0.405)
        )
        angles = np.degrees(
            np.arctan2(np.abs(tangents[:, 1]), np.abs(tangents[:, 0]))
        )
        vertical_fraction = float(np.mean(angles[sample] >= 65.0)) if np.any(sample) else 0.0
        is_philtrum_strand = (
            float(np.min(points[:, 0])) >= 0.405
            and float(np.max(points[:, 0])) <= CENTER_X + 0.001
            and float(np.min(points[:, 1])) < 0.580
            and float(np.max(points[:, 1])) > 0.640
            and vertical_fraction >= 0.75
        )
        if not is_philtrum_strand:
            result.append(curve)
            continue

        keep = points[:, 1] >= _philtrum_nasal_base_y(points[:, 0])
        deepest = int(np.argmax(points[:, 1]))
        if not keep[deepest]:
            result.append(curve)
            continue
        first = deepest
        last = deepest + 1
        while first > 0 and keep[first - 1]:
            first -= 1
        while last < len(points) and keep[last]:
            last += 1
        retained = points[first:last].copy()
        if first > 0:
            retained = np.vstack([_boundary_intersection(points[first - 1], points[first]), retained])
        elif last < len(points):
            retained = np.vstack([retained, _boundary_intersection(points[last - 1], points[last])])
        if len(retained) < 9:
            result.append(curve)
            continue
        result.append(Curve("philtrum_nasal_base_v10", resample(retained)))
        trimmed_count += 1
    print(f"[philtrum-stop] trimmed_half_lines={trimmed_count}")
    return result


def _region_from_point(p: np.ndarray) -> str:
    x, y = float(p[0]), float(p[1])
    if y < 0.245:
        return "forehead"
    if x > 0.405 and y < 0.385:
        return "glabella_nose_root"
    if y < 0.405:
        return "eyelid_temple"
    if x > 0.405 and y < 0.585:
        return "nose"
    if y < 0.695:
        return "cheek"
    if x > 0.315 and y < 0.825:
        return "perioral"
    if x > 0.285:
        return "chin"
    return "jaw"


def trace_standard_streamlines(
    field: RasterDirectionField,
    separation: float = 0.0145,
    step: float = 0.0035,
) -> list[Curve]:
    """Fill one half-face with evenly spaced lines, then leave mirroring to ``build``."""
    spatial = SpatialHash(separation)
    curves: list[Curve] = []
    seeds: list[np.ndarray] = []
    # Anatomically important central seeds are consumed first.
    seed_top = max(_FOREHEAD_MIN_Y + 0.008, 0.018)
    for y in np.linspace(seed_top, 0.965, 64):
        seeds.append(np.array([0.495, y], dtype=np.float64))
    # A fine deterministic grid fills the remaining skin without random variation.
    for y in np.linspace(seed_top, 0.975, 87):
        for x in np.linspace(0.070, 0.490, 40):
            seeds.append(np.array([x, y], dtype=np.float64))

    for seed in seeds:
        if not _standard_mask(seed) or spatial.too_close(seed, 0.58 * separation):
            continue
        forward = _trace_half(seed, field, spatial, +1.0, step, separation)
        backward = _trace_half(seed, field, spatial, -1.0, step, separation)
        points = np.asarray(list(reversed(backward[1:])) + forward)
        if len(points) < 9:
            continue
        length = float(np.sum(np.linalg.norm(np.diff(points, axis=0), axis=1)))
        if length < 0.032:
            continue
        constrained_curve = bool(np.any([_in_curvature_limited_zone(p) for p in points]))
        points = constrained_smooth(
            points,
            iterations=12 if constrained_curve else 4,
            max_displacement=0.006 if constrained_curve else 0.002,
        )
        for q in points[::2]:
            spatial.add(q)
        curves.append(Curve(_region_from_point(points[len(points) // 2]), resample(points)))
    if _NOSE_ROOT_CONTINUOUS_LATERAL_BLEND_V8:
        # Recover four layers that the old rectangular mask split into a long
        # lateral strand and a short nasal-root strand. Pair the real curves by
        # vertical order and bridge only their missing interval with a cubic
        # connector whose endpoint tangents match both source curves.
        lateral: list[tuple[float, int, np.ndarray]] = []
        roots: list[tuple[float, int, np.ndarray]] = []
        for index, curve in enumerate(curves):
            points = curve.points
            if points[0, 0] > points[-1, 0]:
                points = points[::-1]
            outer, inner = points[0], points[-1]
            if (
                curve.region in {"eyelid_temple", "cheek"}
                and outer[0] < 0.120
                and 0.300 <= inner[0] <= 0.400
                and 0.390 <= inner[1] <= 0.460
            ):
                lateral.append((float(inner[1]), index, points))
            if (
                curve.region == "glabella_nose_root"
                and inner[0] >= 0.485
                and 0.300 <= outer[0] <= 0.400
                and 0.330 <= float(np.min(points[:, 1]))
                and float(np.max(points[:, 1])) <= 0.390
            ):
                roots.append((float(inner[1]), index, points))
        separated_lateral: list[tuple[float, int, np.ndarray]] = []
        for candidate in sorted(lateral):
            if not separated_lateral or candidate[0] - separated_lateral[-1][0] >= 0.006:
                separated_lateral.append(candidate)
            if len(separated_lateral) == 4:
                break
        lateral = separated_lateral
        roots = sorted(roots)[:4]
        if len(lateral) != 4 or len(roots) != 4:
            raise RuntimeError("expected four lateral and four nasal-root strands")

        merged: list[Curve] = []
        consumed: set[int] = set()
        connector_points: list[np.ndarray] = []
        for (_, lateral_index, lateral_points), (_, root_index, root_points) in zip(
            lateral, roots, strict=True
        ):
            lateral_end = int(np.searchsorted(lateral_points[:, 0], 0.370, side="right"))
            lateral_end = min(max(lateral_end, 2), len(lateral_points))
            lateral_points = lateral_points[:lateral_end]
            root_start = int(np.searchsorted(root_points[:, 0], 0.440))
            root_start = min(root_start, len(root_points) - 2)
            root_points = root_points[root_start:]
            p0, p3 = lateral_points[-1], root_points[0]
            t = np.linspace(0.0, 1.0, 28)[:, None]
            smooth = 3.0 * t**2 - 2.0 * t**3
            connector = p0 + (p3 - p0) * np.column_stack([t[:, 0], smooth[:, 0]])
            joined = np.vstack([lateral_points[:-1], connector, root_points[1:]])
            joined = constrained_smooth(joined, iterations=12, max_displacement=0.006)
            merged.append(
                Curve("glabella_nose_root_continuous_v8", resample(joined, spacing=0.0035))
            )
            connector_points.append(joined)
            consumed.update((lateral_index, root_index))

        connectors = np.vstack(connector_points)
        retained: list[Curve] = []
        for index, curve in enumerate(curves):
            if index in consumed:
                continue
            points = curve.points
            length = float(np.sum(np.linalg.norm(np.diff(points, axis=0), axis=1)))
            obsolete_root_fragment = (
                curve.region == "glabella_nose_root"
                and float(np.min(points[:, 0])) >= 0.395
                and float(np.max(points[:, 0])) <= 0.450
                and float(np.min(points[:, 1])) >= 0.315
                and float(np.max(points[:, 1])) <= 0.340
                and length < 0.060
            )
            if obsolete_root_fragment:
                continue
            delta = curve.points[:, None, :] - connectors[None, :, :]
            if float(np.min(np.linalg.norm(delta, axis=2))) < 0.0045:
                continue
            retained.append(curve)
        curves = retained + merged
    if _UPPER_FACE_INDEPENDENT_FAMILIES:
        # Rebuild the forehead deterministically as two horizontal subfamilies.
        # Upper strands cross the midline. Lower strands stop outside the
        # independent longitudinal glabellar fan, so the two families neither
        # connect nor intersect.
        curves = [curve for curve in curves if curve.region != "forehead"]

        def forehead_outer_x(y: float) -> float:
            vertical = (y - 0.515) / 0.505
            return 0.5 - 0.465 * math.sqrt(max(0.0, 1.0 - vertical * vertical)) + 0.010

        upper_levels = (
            (0.020, 0.039286, 0.058571, 0.077857, 0.097143, 0.116429)
            if _FOREHEAD_DENSE_BRIDGE_ARCS_V16
            else
            (0.020, 0.047, 0.074, 0.101, 0.128, 0.155)
            if _FOREHEAD_LOWER_LONG_ARCS_V13
            else (0.016, 0.033, 0.050, 0.067, 0.085, 0.103, 0.121, 0.139)
            if _FOREHEAD_EXPANDED_COVERAGE_V2
            else (0.024, 0.043, 0.063, 0.084, 0.106, 0.129)
        )
        forehead_region = (
            "forehead_bridge_arc_v15"
            if _FOREHEAD_BRIDGE_ARCS_V15 or _FOREHEAD_DENSE_BRIDGE_ARCS_V16
            else "forehead_lower_long_arc_v13"
            if _FOREHEAD_LOWER_LONG_ARCS_V13
            else "forehead_scalp_arc_v5"
            if _FOREHEAD_SCALP_ARCS_V5
            else "forehead_curved_v4"
            if _FOREHEAD_CURVED_ARCS_V4
            else "forehead_extended_v3"
            if _FOREHEAD_NEAR_EQUAL_LENGTH_V3
            else ("forehead_extended_v2" if _FOREHEAD_EXPANDED_COVERAGE_V2 else "forehead_extended")
        )
        for y0 in upper_levels:
            x0 = forehead_outer_x(y0)
            inner_x = (
                0.395
                if _ORBITAL_BROW_UPTURN_V11
                and not _ORBITAL_BROW_FOREHEAD_CLEARANCE_V12
                and y0 >= 0.121
                else CENTER_X
            )
            point_count = 56 if inner_x < CENTER_X else 64
            x = np.linspace(x0, inner_x, point_count)
            t = (x - x0) / (inner_x - x0)
            crown = (
                0.010
                if _FOREHEAD_BRIDGE_ARCS_V15 or _FOREHEAD_DENSE_BRIDGE_ARCS_V16
                else 0.0045
            )
            y = y0 - crown * t**2
            curves.append(Curve(forehead_region, resample(np.column_stack([x, y]))))

        lower_levels = (
            (0.150, 0.168, 0.187, 0.206, 0.225, 0.244)
            if _FOREHEAD_EXPANDED_COVERAGE_V2
            else (0.151, 0.172, 0.194, 0.216, 0.238)
        )
        if _ORBITAL_BROW_FOREHEAD_CLEARANCE_V12:
            # The user's yellow correction replaces every broken lower
            # fragment with the compact eight-level continuous family above.
            lower_levels = ()
        elif _ORBITAL_BROW_UPTURN_V11:
            # The lowest horizontal is replaced by the superior-orbital
            # arrival of the new upturn bundle; retaining both makes the two
            # families cross once on each side.
            lower_levels = lower_levels[:-1]
        for y0 in lower_levels:
            x0 = forehead_outer_x(y0)
            if _ORBITAL_BROW_UPTURN_V11:
                # The ascending brow bundle occupies the central lower
                # forehead. Stop these six lateral levels outside it instead
                # of crossing or visually weaving through the verticals.
                inner_x = 0.395
                point_count = 52
            else:
                inner_x = CENTER_X if _FOREHEAD_CONTINUOUS_CROSS_MIDLINE_V6 else 0.378
                point_count = 64 if _FOREHEAD_CONTINUOUS_CROSS_MIDLINE_V6 else 52
            x = np.linspace(x0, inner_x, point_count)
            t = (x - x0) / (inner_x - x0)
            crown = (
                0.0035
                if _ORBITAL_BROW_UPTURN_V11
                else 0.0045
                if _FOREHEAD_CONTINUOUS_CROSS_MIDLINE_V6
                else 0.0035
            )
            y = y0 - crown * t**2
            curves.append(Curve(forehead_region, resample(np.column_stack([x, y]))))
    if _GLABELLA_BLUE_LOCAL_REVISION:
        revised: list[Curve] = []
        brow_candidate_done = False
        for curve in curves:
            points = curve.points
            central_artifact = (
                np.min(points[:, 0]) >= 0.405
                and np.min(points[:, 1]) >= 0.180
                and np.max(points[:, 1]) <= 0.330
            )
            short_inner_brow = (
                np.min(points[:, 0]) >= 0.300
                and np.max(points[:, 0]) <= 0.405
                and np.min(points[:, 1]) >= 0.180
                and np.max(points[:, 1]) <= 0.300
                and float(np.ptp(points[:, 0])) <= 0.120
            )
            redundant_upper_brow = (
                not _UPPER_FACE_INDEPENDENT_FAMILIES
                and
                curve.region
                in {
                    "forehead",
                    "forehead_extended",
                    "forehead_extended_v2",
                    "forehead_extended_v3",
                    "forehead_curved_v4",
                    "forehead_scalp_arc_v5",
                }
                and np.min(points[:, 0]) <= 0.200
                and 0.370 <= np.max(points[:, 0]) < 0.398
                and np.max(points[:, 1]) <= 0.285
            )
            if central_artifact or short_inner_brow or redundant_upper_brow:
                continue

            inner_endpoint = int(np.argmax(points[:, 0]))
            brow_candidate = (
                not brow_candidate_done
                and curve.region
                in {
                    "forehead",
                    "forehead_extended",
                    "forehead_extended_v2",
                    "forehead_extended_v3",
                    "forehead_curved_v4",
                    "forehead_scalp_arc_v5",
                }
                and np.min(points[:, 0]) <= 0.200
                and np.max(points[:, 0]) >= 0.398
                and 0.260 <= points[inner_endpoint, 1] <= 0.295
            )
            if brow_candidate:
                oriented = points if inner_endpoint == len(points) - 1 else points[::-1]
                keep = oriented[:, 0] <= 0.335
                base = oriented[keep]
                if len(base) >= 4:
                    p0 = base[-1]
                    p1 = p0 + np.array([0.030, 0.0])
                    p2 = np.array([0.405, 0.252])
                    p3 = np.array([0.405, 0.222])
                    t = np.linspace(0.0, 1.0, 30)[:, None]
                    extension = (
                        (1.0 - t) ** 3 * p0
                        + 3.0 * (1.0 - t) ** 2 * t * p1
                        + 3.0 * (1.0 - t) * t**2 * p2
                        + t**3 * p3
                    )
                    curve = Curve(curve.region, resample(np.vstack([base[:-1], extension])))
                    brow_candidate_done = True
            revised.append(curve)
        curves = revised

        # Open glabellar fan matching the user's blue annotation: the center is
        # nearly vertical and the outer strands bend gradually outward. All end
        # above the preserved v8.1 horizontal root patch.
        # Suppressed under the V9 nasal-bridge topology: the user marked these
        # root vertical stripes for deletion.
        distances = (
            (0.008, 0.019, 0.030, 0.041, 0.052, 0.063)
            if _FOREHEAD_CONTINUOUS_CROSS_MIDLINE_V6
            else (0.008, 0.020, 0.033, 0.047, 0.061, 0.075, 0.088)
            if _UPPER_FACE_INDEPENDENT_FAMILIES
            else (0.010, 0.024, 0.038, 0.054, 0.070)
        )
        for index, distance in enumerate([] if _NASAL_BRIDGE_TURNDOWN_V9 else distances):
            if _FOREHEAD_CONTINUOUS_CROSS_MIDLINE_V6:
                start_y = 0.260 + 0.0025 * index
                end_y = 0.335 - 0.002 * index
            else:
                start_y = (
                    (0.142 + 0.004 * index)
                    if _UPPER_FACE_INDEPENDENT_FAMILIES
                    else (0.208 + 0.004 * index)
                )
                end_y = 0.318 - 0.004 * index
            y = np.linspace(start_y, end_y, 42)
            t = (y - start_y) / (end_y - start_y)
            max_distance = distances[-1]
            outward_scale = (
                0.015
                if _FOREHEAD_CONTINUOUS_CROSS_MIDLINE_V6
                else 0.026
                if _UPPER_FACE_INDEPENDENT_FAMILIES
                else 0.024
            )
            outward = (0.001 + outward_scale * distance / max_distance) * (3.0 * t**2 - 2.0 * t**3)
            x = CENTER_X - distance - outward
            curves.append(Curve("glabella_nose_root", resample(np.column_stack([x, y]))))

    if _NOSE_ROOT_HORIZONTAL_PATCH:
        # The standard diagram separates glabellar and nasal longitudinal
        # families with a small, independent horizontal root patch. Building
        # these as short cross-midline curves prevents any vertical/horizontal
        # intersection by construction.
        for y in (0.345, 0.367, 0.389):
            x = np.linspace(0.412, CENTER_X, 24)
            crown = 0.003 * (1.0 - ((x - CENTER_X) / 0.088) ** 2)
            points = np.column_stack([x, y - crown])
            curves.append(Curve("glabella_nose_root", resample(points)))
    if _NASAL_BRIDGE_TURNDOWN_V9:
        curves = _apply_nasal_bridge_turndown(curves)
    if _ORBITAL_BROW_UPTURN_V11:
        curves = _apply_orbital_brow_upturn(curves)
    if _PHILTRUM_NASAL_BASE_STOP_V10:
        curves = _apply_philtrum_nasal_base_stop(curves)
    if _YELLOW_GUIDE_CONTINUITY_V14:
        curves = _apply_yellow_guide_continuity_v14(curves)
    if _ORBITAL_NASAL_FRAGMENT_REPLACEMENT_V18:
        curves = _replace_orbital_nasal_fragments_v18(curves)
    if _ORBITAL_NASAL_CONTINUOUS_BUNDLE_V19:
        curves = _rebuild_orbital_nasal_bundle_v19(curves)
    if _ORBITAL_NASAL_PRESERVE_V22_BUNDLE_V20:
        curves = _preserve_v22_orbital_nasal_bundle_v20(curves)
    if _NASAL_BUNDLE_UPWARD_SHIFT_V21:
        curves = _shift_nasal_bundle_upward_v21(curves)
    if _INFRAORBITAL_WAVE_V25:
        curves = _replace_infraorbital_waves_v25(curves)
    if _NASAL_BUNDLE_ADDITIONAL_UPWARD_SHIFT_V26:
        curves = _shift_nasal_bundle_additionally_upward_v26(curves)
    if _NASAL_BUNDLE_MID_NOSE_BLUE_TRACE_V29 and not _NASAL_BUNDLE_RIGID_UPWARD_SHIFT_V31:
        curves = _replace_nasal_bundle_midnose_trace_v29(curves)
    if _NASAL_BUNDLE_EXPANDED_SPACING_V30 and not _NASAL_BUNDLE_RIGID_UPWARD_SHIFT_V31:
        curves = _expand_nasal_bundle_spacing_v30(curves)
    if _NASAL_BUNDLE_RIGID_UPWARD_SHIFT_V31:
        curves = _shift_nasal_bundle_rigidly_upward_v31(curves)
    if _FOREHEAD_DENSE_BRIDGE_ARCS_V16:
        # Append the final two of eight evenly spaced levels so every pre-existing
        # non-forehead curve retains its v8.1.18 name and exact atlas geometry.
        for y0 in (0.135714, 0.155):
            x0 = forehead_outer_x(y0)
            x = np.linspace(x0, CENTER_X, 64)
            t = (x - x0) / (CENTER_X - x0)
            y = y0 - 0.010 * t**2
            curves.append(
                Curve(
                    "forehead_bridge_arc_v15",
                    resample(np.column_stack([x, y])),
                )
            )
    if _CHEEK_LONG_ARC_FAN_V24:
        curves = _rebuild_cheek_long_arc_fan_v24(curves)
    if _CHEEK_LONG_ARC_EXPANDED_SPACING_V32:
        curves = _expand_cheek_long_arc_spacing_v32(curves)
    if _CHEEK_LONG_ARC_BLUE_DIRECTION_V33:
        curves = _replace_cheek_long_arc_direction_v33(curves)
    if _CHEEK_LONG_ARC_BLUE_SPACING_V34:
        curves = _expand_cheek_long_arc_blue_spacing_v34(curves)
    if _CHEEK_LONG_ARC_BLUE_ADDITIONAL_SPACING_V35:
        curves = _expand_cheek_long_arc_blue_spacing_v35(curves)
    if _CHEEK_LONG_ARC_BLUE_BOUNDARY_COVERAGE_V36:
        curves = _expand_cheek_long_arc_blue_boundary_coverage_v36(curves)
    if _PERIORAL_CONTINUOUS_FAN_V37:
        curves = _rebuild_perioral_continuous_fan_v37(curves)
    if _PERIORAL_VORTEX_FAN_V38:
        curves = _smooth_perioral_vortex_fan_v38(curves)
    if _CHEEK_SEPARATRIX_PROJECTION_CLEARANCE_V39:
        curves = _clear_cheek_separatrix_projection_v39(curves)
    if _GLABELLA_UPWARD_EXTENSION_V40:
        curves = _extend_glabella_upward_v40(curves)
    if _CHEEK_LONG_ARC_LATERAL_DENSITY_V41 and not (
        _CHEEK_LONG_ARC_FULL_DENSITY_V42 or _CHEEK_LONG_ARC_REDUCED_DENSITY_V43
    ):
        curves = _add_cheek_long_arc_lateral_density_v41(curves)
    if _CHEEK_LONG_ARC_REDUCED_DENSITY_V43:
        curves = _add_cheek_long_arc_full_density_v42(curves, reduced_v43=True)
    elif _CHEEK_LONG_ARC_FULL_DENSITY_V42:
        curves = _add_cheek_long_arc_full_density_v42(curves)
    if _CHEEK_LOWER_DIVERGENT_ARCS_V44:
        curves = _add_cheek_lower_divergent_arcs_v44(
            curves,
            origin_spacing_v45=_CHEEK_ALAR_ORIGIN_SPACING_V45,
        )
    if _CHEEK_ALAR_BOUNDARY_ANCHORS_V46:
        curves = _anchor_cheek_curves_to_alar_boundary_v46(curves)
    if _CHEEK_LONG_ARC_TEN_LINE_DENSITY_V47:
        curves = _reduce_cheek_bundle_to_ten_lines_v47(curves)
    if _PERIORAL_CHIN_CONTINUITY_V48:
        curves = _connect_perioral_fan_to_chin_v48(curves)
    if _PERIORAL_COMMISSURE_SWIRL_V49:
        curves = _rebuild_perioral_commissure_swirl_v49(curves)
    if _PERIORAL_COMMISSURE_FOCUS_V50:
        curves = _add_perioral_commissure_radial_fan_v50(curves)
    if _CHEEK_GAP_BRIDGE_CONTINUITY_V54:
        curves = _open_cheek_gap_bridge_corridor_v54(curves)
    if _CHEEK_GAP_NASAL_TIP_EXTENSION_V55:
        curves = _open_cheek_gap_nasal_tip_corridors_v55(curves)
    if _CHEEK_GAP_DENSITY_V53:
        curves = _add_cheek_gap_density_v53(curves)
    if _CHEEK_NASAL_TRANSITION_DENSITY_V56:
        curves = _add_cheek_nasal_transition_density_v56(curves)
    if _SUPERIOR_ORBITAL_LATERAL_TAIL_REMOVAL_V57:
        curves = _trim_superior_orbital_lateral_tail_v57(curves)
    if _SUPERIOR_ORBITAL_GUIDE_REMOVAL_V58:
        curves = _remove_superior_orbital_guide_v58(curves)
    if _ORBITAL_BROW_DENSITY_EXTENSION_V59:
        curves = _densify_and_extend_orbital_brow_v59(curves)
    if _ORBITAL_BROW_MEDIAL_ENDPOINT_EXTENSION_V60:
        curves = _extend_orbital_brow_medial_endpoints_v60(curves)
    if _FOREHEAD_FOURTEEN_ARCHED_DENSITY_V62:
        curves = _rebuild_forehead_fourteen_arches_v62(curves)
    if _FOREHEAD_RIGID_DOWNWARD_SHIFT_V63:
        curves = _shift_forehead_arches_rigidly_downward_v63(curves)
    if _LATERAL_CANTHUS_SHORT_ARCS_V65:
        curves = _add_lateral_canthus_short_arcs_v65(curves)
    return curves


def _atlas_line(canonical: CanonicalFaceModel, name: str, curve: Curve) -> AtlasLine:
    points = (
        curve.points
        if curve.region in {
            "perioral_continuous_fan_v37",
            "perioral_vortex_fan_v38",
            _PERIORAL_COMMISSURE_SWIRL_REGION_V49,
            _PERIORAL_COMMISSURE_RADIAL_REGION_V50,
        }
        else resample(curve.points)
    )
    return atlas_line_from_points2d(
        canonical,
        name,
        curve.region,
        canonical.norm_to_proj(points),
        proj=canonical.project_front(),
    )


def build(canonical: CanonicalFaceModel, reference: dict) -> Atlas:
    if reference.get("directionField"):
        global _FACE_POLYGON, _FOREHEAD_MIN_Y, _NOSE_ROOT_HORIZONTAL_PATCH
        global _GLABELLA_BLUE_LOCAL_REVISION, _UPPER_FACE_INDEPENDENT_FAMILIES
        global _FOREHEAD_EXPANDED_COVERAGE_V2
        global _FOREHEAD_NEAR_EQUAL_LENGTH_V3
        global _FOREHEAD_CURVED_ARCS_V4
        global _FOREHEAD_SCALP_ARCS_V5
        global _FOREHEAD_CONTINUOUS_CROSS_MIDLINE_V6
        global _NOSE_ROOT_CONTINUOUS_LATERAL_BLEND_V8
        global _NASAL_BRIDGE_TURNDOWN_V9
        global _NOSTRIL_APERTURE_MASK_V9
        global _PHILTRUM_NASAL_BASE_STOP_V10
        global _ORBITAL_BROW_UPTURN_V11
        global _ORBITAL_BROW_FOREHEAD_CLEARANCE_V12
        global _FOREHEAD_LOWER_LONG_ARCS_V13
        global _YELLOW_GUIDE_CONTINUITY_V14
        global _FOREHEAD_BRIDGE_ARCS_V15
        global _FOREHEAD_DENSE_BRIDGE_ARCS_V16
        global _NASAL_TIP_MEDIAL_CONVERGENCE_V17
        global _ORBITAL_NASAL_FRAGMENT_REPLACEMENT_V18
        global _ORBITAL_NASAL_CONTINUOUS_BUNDLE_V19
        global _ORBITAL_NASAL_PRESERVE_V22_BUNDLE_V20
        global _NASAL_BUNDLE_UPWARD_SHIFT_V21
        global _PERIORAL_CHEEK_SEPARATRIX_V22
        global _PERIORAL_CHEEK_ALAR_ORIGIN_V23
        global _CHEEK_LONG_ARC_FAN_V24
        global _INFRAORBITAL_WAVE_V25
        global _NASAL_BUNDLE_ADDITIONAL_UPWARD_SHIFT_V26
        global _CHEEK_LONG_ARC_ALAR_ORIGIN_V27
        global _CHEEK_LONG_ARC_LAYERED_BLUE_TRACE_V28
        global _NASAL_BUNDLE_MID_NOSE_BLUE_TRACE_V29
        global _NASAL_BUNDLE_EXPANDED_SPACING_V30
        global _NASAL_BUNDLE_RIGID_UPWARD_SHIFT_V31
        global _CHEEK_LONG_ARC_EXPANDED_SPACING_V32
        global _CHEEK_LONG_ARC_BLUE_DIRECTION_V33
        global _CHEEK_LONG_ARC_BLUE_SPACING_V34
        global _CHEEK_LONG_ARC_BLUE_ADDITIONAL_SPACING_V35
        global _CHEEK_LONG_ARC_BLUE_BOUNDARY_COVERAGE_V36
        global _PERIORAL_CONTINUOUS_FAN_V37
        global _PERIORAL_VORTEX_FAN_V38
        global _CHEEK_SEPARATRIX_PROJECTION_CLEARANCE_V39
        global _GLABELLA_UPWARD_EXTENSION_V40
        global _CHEEK_LONG_ARC_LATERAL_DENSITY_V41
        global _CHEEK_LONG_ARC_FULL_DENSITY_V42
        global _CHEEK_LONG_ARC_REDUCED_DENSITY_V43
        global _CHEEK_LOWER_DIVERGENT_ARCS_V44
        global _CHEEK_ALAR_ORIGIN_SPACING_V45
        global _CHEEK_ALAR_BOUNDARY_ANCHORS_V46
        global _CHEEK_LONG_ARC_TEN_LINE_DENSITY_V47
        global _PERIORAL_CHIN_CONTINUITY_V48
        global _PERIORAL_COMMISSURE_SWIRL_V49
        global _PERIORAL_COMMISSURE_FOCUS_V50
        global _PERIORAL_COMMISSURE_PIXEL_CLEARANCE_V51
        global _PERIORAL_COMMISSURE_STROKE_CLEARANCE_V52
        global _CHEEK_GAP_DENSITY_V53
        global _CHEEK_GAP_BRIDGE_CONTINUITY_V54
        global _CHEEK_GAP_NASAL_TIP_EXTENSION_V55
        global _CHEEK_NASAL_TRANSITION_DENSITY_V56
        global _SUPERIOR_ORBITAL_LATERAL_TAIL_REMOVAL_V57
        global _SUPERIOR_ORBITAL_GUIDE_REMOVAL_V58
        global _ORBITAL_BROW_DENSITY_EXTENSION_V59
        global _ORBITAL_BROW_MEDIAL_ENDPOINT_EXTENSION_V60
        global _ORBITAL_BROW_MEDIAL_LONGER_EXTENSION_V61
        global _FOREHEAD_FOURTEEN_ARCHED_DENSITY_V62
        global _FOREHEAD_RIGID_DOWNWARD_SHIFT_V63
        global _FOREHEAD_ADDITIONAL_DOWNWARD_SHIFT_V64
        global _LATERAL_CANTHUS_SHORT_ARCS_V65
        constraints = reference.get("extraction", {}).get("doctorConstraints", {})
        _FOREHEAD_MIN_Y = 0.012 if "foreheadUpperExtension" in constraints else 0.060
        _NOSE_ROOT_HORIZONTAL_PATCH = "noseRootHorizontalPatch" in constraints
        _GLABELLA_BLUE_LOCAL_REVISION = "glabellaBlueLocalRevision" in constraints
        _UPPER_FACE_INDEPENDENT_FAMILIES = "upperFaceIndependentFamilies" in constraints
        _FOREHEAD_EXPANDED_COVERAGE_V2 = "foreheadExpandedCoverageV2" in constraints
        _FOREHEAD_NEAR_EQUAL_LENGTH_V3 = "foreheadNearEqualLengthV3" in constraints
        _FOREHEAD_CURVED_ARCS_V4 = "foreheadCurvedArcsV4" in constraints
        _FOREHEAD_SCALP_ARCS_V5 = "foreheadScalpArcsV5" in constraints
        _FOREHEAD_CONTINUOUS_CROSS_MIDLINE_V6 = (
            "foreheadContinuousCrossMidlineV6" in constraints
        )
        _NOSE_ROOT_CONTINUOUS_LATERAL_BLEND_V8 = (
            "noseRootContinuousLateralBlendV8" in constraints
        )
        _NASAL_BRIDGE_TURNDOWN_V9 = "nasalBridgeTurnDownV9" in constraints
        _NOSTRIL_APERTURE_MASK_V9 = "nostrilApertureMaskV9" in constraints
        _PHILTRUM_NASAL_BASE_STOP_V10 = "philtrumNasalBaseStopV10" in constraints
        _ORBITAL_BROW_UPTURN_V11 = "orbitalBrowUpturnV11" in constraints
        _ORBITAL_BROW_FOREHEAD_CLEARANCE_V12 = (
            "orbitalBrowForeheadClearanceV12" in constraints
        )
        _FOREHEAD_LOWER_LONG_ARCS_V13 = "foreheadLowerLongArcsV13" in constraints
        _YELLOW_GUIDE_CONTINUITY_V14 = "yellowGuideContinuityV14" in constraints
        _FOREHEAD_BRIDGE_ARCS_V15 = "foreheadBridgeArcsV15" in constraints
        _FOREHEAD_DENSE_BRIDGE_ARCS_V16 = (
            "foreheadDenseBridgeArcsV16" in constraints
        )
        _NASAL_TIP_MEDIAL_CONVERGENCE_V17 = (
            "nasalTipMedialConvergenceV17" in constraints
        )
        _ORBITAL_NASAL_FRAGMENT_REPLACEMENT_V18 = (
            "orbitalNasalFragmentReplacementV18" in constraints
        )
        _ORBITAL_NASAL_CONTINUOUS_BUNDLE_V19 = (
            "orbitalNasalContinuousBundleV19" in constraints
        )
        _ORBITAL_NASAL_PRESERVE_V22_BUNDLE_V20 = (
            "orbitalNasalPreserveV22BundleV20" in constraints
        )
        _NASAL_BUNDLE_UPWARD_SHIFT_V21 = (
            "nasalBundleUpwardShiftV21" in constraints
        )
        _PERIORAL_CHEEK_SEPARATRIX_V22 = (
            "perioralCheekSeparatrixV22" in constraints
        )
        _PERIORAL_CHEEK_ALAR_ORIGIN_V23 = (
            "perioralCheekAlarOriginV23" in constraints
        )
        _CHEEK_LONG_ARC_FAN_V24 = "cheekLongArcFanV24" in constraints
        _INFRAORBITAL_WAVE_V25 = "infraorbitalWaveV25" in constraints
        _NASAL_BUNDLE_ADDITIONAL_UPWARD_SHIFT_V26 = (
            "nasalBundleAdditionalUpwardShiftV26" in constraints
        )
        _CHEEK_LONG_ARC_ALAR_ORIGIN_V27 = (
            "cheekLongArcAlarOriginV27" in constraints
        )
        _CHEEK_LONG_ARC_LAYERED_BLUE_TRACE_V28 = (
            "cheekLongArcLayeredBlueTraceV28" in constraints
        )
        _NASAL_BUNDLE_MID_NOSE_BLUE_TRACE_V29 = (
            "nasalBundleMidNoseBlueTraceV29" in constraints
        )
        _NASAL_BUNDLE_EXPANDED_SPACING_V30 = (
            "nasalBundleExpandedSpacingV30" in constraints
        )
        _NASAL_BUNDLE_RIGID_UPWARD_SHIFT_V31 = (
            "nasalBundleRigidUpwardShiftV31" in constraints
        )
        _CHEEK_LONG_ARC_EXPANDED_SPACING_V32 = (
            "cheekLongArcExpandedSpacingV32" in constraints
        )
        _CHEEK_LONG_ARC_BLUE_DIRECTION_V33 = (
            "cheekLongArcBlueDirectionV33" in constraints
        )
        _CHEEK_LONG_ARC_BLUE_SPACING_V34 = (
            "cheekLongArcBlueSpacingV34" in constraints
        )
        _CHEEK_LONG_ARC_BLUE_ADDITIONAL_SPACING_V35 = (
            "cheekLongArcBlueAdditionalSpacingV35" in constraints
        )
        _CHEEK_LONG_ARC_BLUE_BOUNDARY_COVERAGE_V36 = (
            "cheekLongArcBlueBoundaryCoverageV36" in constraints
        )
        _PERIORAL_CONTINUOUS_FAN_V37 = (
            "perioralContinuousFanV37" in constraints
        )
        _PERIORAL_VORTEX_FAN_V38 = "perioralVortexFanV38" in constraints
        _CHEEK_SEPARATRIX_PROJECTION_CLEARANCE_V39 = (
            "cheekSeparatrixProjectionClearanceV39" in constraints
        )
        _GLABELLA_UPWARD_EXTENSION_V40 = (
            "glabellaUpwardExtensionV40" in constraints
        )
        _CHEEK_LONG_ARC_LATERAL_DENSITY_V41 = (
            "cheekLongArcLateralDensityV41" in constraints
        )
        _CHEEK_LONG_ARC_FULL_DENSITY_V42 = (
            "cheekLongArcFullSpanDensityV42" in constraints
        )
        _CHEEK_LONG_ARC_REDUCED_DENSITY_V43 = (
            "cheekLongArcReducedDensityV43" in constraints
        )
        _CHEEK_LOWER_DIVERGENT_ARCS_V44 = (
            "cheekLowerDivergentArcsV44" in constraints
        )
        _CHEEK_ALAR_ORIGIN_SPACING_V45 = (
            "cheekAlarOriginSpacingV45" in constraints
        )
        _CHEEK_ALAR_BOUNDARY_ANCHORS_V46 = (
            "cheekAlarBoundaryAnchorsV46" in constraints
        )
        _CHEEK_LONG_ARC_TEN_LINE_DENSITY_V47 = (
            "cheekLongArcTenLineDensityV47" in constraints
        )
        _PERIORAL_CHIN_CONTINUITY_V48 = (
            "perioralChinContinuityV48" in constraints
        )
        _PERIORAL_COMMISSURE_SWIRL_V49 = (
            "perioralCommissureSwirlV49" in constraints
        )
        _PERIORAL_COMMISSURE_FOCUS_V50 = (
            "perioralCommissureFocusV50" in constraints
        )
        _PERIORAL_COMMISSURE_PIXEL_CLEARANCE_V51 = (
            "perioralCommissurePixelClearanceV51" in constraints
        )
        _PERIORAL_COMMISSURE_STROKE_CLEARANCE_V52 = (
            "perioralCommissureStrokeClearanceV52" in constraints
        )
        _CHEEK_GAP_DENSITY_V53 = "cheekGapDensityV53" in constraints
        _CHEEK_GAP_BRIDGE_CONTINUITY_V54 = (
            "cheekGapBridgeContinuityV54" in constraints
        )
        _CHEEK_GAP_NASAL_TIP_EXTENSION_V55 = (
            "cheekGapNasalTipExtensionV55" in constraints
        )
        _CHEEK_NASAL_TRANSITION_DENSITY_V56 = (
            "cheekNasalTransitionDensityV56" in constraints
        )
        _SUPERIOR_ORBITAL_LATERAL_TAIL_REMOVAL_V57 = (
            "superiorOrbitalLateralTailRemovalV57" in constraints
        )
        _SUPERIOR_ORBITAL_GUIDE_REMOVAL_V58 = (
            "superiorOrbitalGuideRemovalV58" in constraints
        )
        _ORBITAL_BROW_DENSITY_EXTENSION_V59 = (
            "orbitalBrowDensityExtensionV59" in constraints
        )
        _ORBITAL_BROW_MEDIAL_ENDPOINT_EXTENSION_V60 = (
            "orbitalBrowMedialEndpointExtensionV60" in constraints
        )
        _ORBITAL_BROW_MEDIAL_LONGER_EXTENSION_V61 = (
            "orbitalBrowMedialLongerExtensionV61" in constraints
        )
        _FOREHEAD_FOURTEEN_ARCHED_DENSITY_V62 = (
            "foreheadFourteenArchedDensityV62" in constraints
        )
        _FOREHEAD_RIGID_DOWNWARD_SHIFT_V63 = (
            "foreheadRigidDownwardShiftV63" in constraints
        )
        _FOREHEAD_ADDITIONAL_DOWNWARD_SHIFT_V64 = (
            "foreheadAdditionalDownwardShiftV64" in constraints
        )
        _LATERAL_CANTHUS_SHORT_ARCS_V65 = (
            "lateralCanthusShortArcsV65" in constraints
        )
        projected_norm = (canonical.project_front() - canonical.face_frame()[0]) / canonical.face_frame()[1]
        _FACE_POLYGON = cv2.convexHull(projected_norm.astype(np.float32))
        field = RasterDirectionField(reference["directionField"])
        source_curves = trace_standard_streamlines(field)
        lines: list[AtlasLine] = []
        for i, curve in enumerate(source_curves):
            if curve.region in {
                _REMOVED_ORBITAL_NASAL_FRAGMENT_V18,
                _REMOVED_ORBITAL_NASAL_BUNDLE_V19,
                _REMOVED_ORBITAL_NASAL_FRAGMENT_V20,
                _REMOVED_CHEEK_LONG_ARC_FAN_V24,
                _REMOVED_PERIORAL_CONTINUOUS_FAN_V37,
                _REMOVED_CHEEK_LONG_ARC_DENSITY_V47,
                _REMOVED_PERIORAL_CHIN_FRAGMENT_V48,
                _REMOVED_SUPERIOR_ORBITAL_GUIDE_V58,
            }:
                continue
            points = curve.points
            endpoint_distance = min(abs(points[0, 0] - CENTER_X), abs(points[-1, 0] - CENTER_X))
            horizontal_span = float(np.ptp(points[:, 0]))
            if (
                curve.region != "nose_side_downturn_v9"
                and endpoint_distance < 0.008
                and horizontal_span > 0.035
            ):
                # Join at the midline so forehead/nasal cross-face families have no seam.
                endpoint = 0 if abs(points[0, 0] - CENTER_X) < abs(points[-1, 0] - CENTER_X) else -1
                source = points[::-1] if endpoint == 0 else points.copy()
                if source[0, 0] > source[-1, 0]:
                    source = source[::-1]
                source[-1, 0] = CENTER_X
                full = np.vstack([source, mirror(source[-2::-1])])
                lines.append(
                    _atlas_line(canonical, f"standard_field_{i:04d}_cross", Curve(curve.region, full))
                )
            else:
                lines.append(_atlas_line(canonical, f"standard_field_{i:04d}_right", curve))
                lines.append(
                    _atlas_line(
                        canonical,
                        f"standard_field_{i:04d}_left",
                        Curve(curve.region, mirror(points)),
                    )
                )
        return Atlas(
            system=SYSTEM_RSTL,
            version=ATLAS_VERSION,
            atlas_version=STANDARD_ATLAS_VERSION,
            topology_id=TOPOLOGY_ID,
            topology_version=TOPOLOGY_VERSION,
            provenance=(
                "Doctor-standard RSTL v1 traced from a symmetric continuous tangent field extracted "
                "from the thin gray lines in standard_1.png and cross-checked against standard_2.png. "
                "Red incision/scar annotations are excluded. Source-half streamlines are mirrored exactly. "
                "validated=false."
            ),
            validated=False,
            lines=lines,
        )

    raise ValueError("reference JSON does not contain directionField")


def main() -> None:
    reference_path = Path(sys.argv[1]) if len(sys.argv) > 1 else REFERENCE
    output_path = Path(sys.argv[2]) if len(sys.argv) > 2 else OUTPUT
    with reference_path.open(encoding="utf-8") as handle:
        reference = json.load(handle)
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    atlas = build(canonical, reference)
    atlas.save(str(output_path))
    print(
        f"[ok] {output_path}: lines={len(atlas.lines)}, "
        f"points={sum(len(line.points) for line in atlas.lines)}"
    )


if __name__ == "__main__":
    main()
