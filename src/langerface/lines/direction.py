"""Deterministic local RSTL direction queries shared with the Web workbench."""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np

from .atlas import Atlas, AtlasLine

ArrayLike = Sequence[float] | np.ndarray
AtlasLike = Atlas | Mapping[str, Any]


@dataclass(frozen=True)
class DirectionResult:
    point: np.ndarray
    vector: np.ndarray
    angle_deg: float
    confidence: float
    source: str
    nearest_distance: float
    support_count: int
    angular_spread_deg: float
    confidence_reasons: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        """Return the browser-compatible serializable result shape."""
        return {
            "point": self.point.tolist(),
            "vector": self.vector.tolist(),
            "angle_deg": self.angle_deg,
            "confidence": self.confidence,
            "source": self.source,
            "nearest_distance": self.nearest_distance,
            "support_count": self.support_count,
            "angular_spread_deg": self.angular_spread_deg,
            "confidence_reasons": list(self.confidence_reasons),
        }


def _norm(vector: np.ndarray) -> np.ndarray:
    length = float(np.linalg.norm(vector))
    if length <= 1e-12:
        return np.array([1.0, 0.0, 0.0], dtype=np.float64)
    return vector / length


def _line_value(line: AtlasLine | Mapping[str, Any], key: str, default: Any) -> Any:
    if isinstance(line, Mapping):
        return line.get(key, default)
    return getattr(line, key, default)


def _atlas_lines(atlas: AtlasLike) -> list[AtlasLine | Mapping[str, Any]]:
    if isinstance(atlas, Atlas):
        return list(atlas.lines)
    lines = atlas.get("lines", [])
    return list(lines) if isinstance(lines, list) else []


def _atlas_samples(
    vertices: np.ndarray,
    triangles: np.ndarray,
    atlas: AtlasLike,
) -> tuple[np.ndarray, np.ndarray]:
    points: list[np.ndarray] = []
    tangents: list[np.ndarray] = []
    for line in _atlas_lines(atlas):
        polyline: list[np.ndarray] = []
        points3d = _line_value(line, "points3d", [])
        if isinstance(points3d, list) and points3d:
            for raw in points3d:
                point = np.asarray(raw, dtype=np.float64)
                if point.shape == (3,) and np.all(np.isfinite(point)):
                    polyline.append(point)
        else:
            raw_points = _line_value(line, "points", [])
            for raw in raw_points:
                if len(raw) < 3:
                    continue
                tri_index = int(round(float(raw[0])))
                if tri_index < 0 or tri_index >= len(triangles):
                    continue
                triangle = triangles[tri_index]
                if np.any(triangle < 0) or np.any(triangle >= len(vertices)):
                    continue
                u = float(raw[1])
                v = float(raw[2])
                if not np.isfinite(u) or not np.isfinite(v):
                    continue
                w = 1.0 - u - v
                a, b, c = vertices[triangle]
                polyline.append(u * a + v * b + w * c)
        if len(polyline) < 2:
            continue
        for index, point in enumerate(polyline):
            before = polyline[max(0, index - 1)]
            after = polyline[min(len(polyline) - 1, index + 1)]
            points.append(point)
            tangents.append(_norm(after - before))
    if not points:
        empty = np.empty((0, 3), dtype=np.float64)
        return empty, empty
    return np.vstack(points), np.vstack(tangents)


def _axis_angle_diff_deg(left: float, right: float) -> float:
    return abs(((left - right + 90.0) % 180.0) - 90.0)


def _axial_angular_spread_deg(vectors: np.ndarray, reference: np.ndarray) -> float:
    if len(vectors) <= 1:
        return 0.0
    reference_angle = float(np.degrees(np.arctan2(reference[1], reference[0])))
    max_deviation = 0.0
    for vector in vectors:
        angle = float(np.degrees(np.arctan2(vector[1], vector[0])))
        max_deviation = max(max_deviation, _axis_angle_diff_deg(angle, reference_angle))
    return min(180.0, 2.0 * max_deviation)


def query_direction(
    point: ArrayLike,
    vertices: Sequence[ArrayLike] | np.ndarray,
    triangles: Sequence[Sequence[int]] | np.ndarray,
    atlas: AtlasLike,
) -> DirectionResult:
    """Query the weighted-nearest local RSTL axis and its confidence evidence."""
    query = np.asarray(point, dtype=np.float64)
    verts = np.asarray(vertices, dtype=np.float64)
    tris = np.asarray(triangles, dtype=np.int64)
    sample_points, sample_tangents = _atlas_samples(verts, tris, atlas)
    if len(sample_points) == 0:
        return DirectionResult(
            point=query,
            vector=np.array([1.0, 0.0, 0.0], dtype=np.float64),
            angle_deg=0.0,
            confidence=0.0,
            source="rstl_atlas_empty",
            nearest_distance=float("inf"),
            support_count=0,
            angular_spread_deg=0.0,
            confidence_reasons=("empty_atlas",),
        )

    delta = sample_points - query
    distances_squared = np.einsum("ij,ij->i", delta, delta)
    best = int(np.argmin(distances_squared))
    diagonal = float(np.linalg.norm(verts.max(axis=0) - verts.min(axis=0)))
    nearest = float(np.sqrt(distances_squared[best]))
    max_distance = max(diagonal * 0.18, 1e-9)
    order = np.argsort(distances_squared, kind="stable")[: min(7, len(distances_squared))]
    reference = sample_tangents[best]

    signed: list[np.ndarray] = []
    weighted = np.zeros(3, dtype=np.float64)
    weight_sum = 0.0
    for index in order:
        tangent = sample_tangents[index].copy()
        if float(np.dot(tangent, reference)) < 0:
            tangent *= -1.0
        weight = 1.0 / (float(np.sqrt(distances_squared[index])) + 1e-6)
        weighted += weight * tangent
        weight_sum += weight
        signed.append(tangent)

    vector = _norm(weighted / max(weight_sum, 1e-9))
    spread = _axial_angular_spread_deg(np.vstack(signed), vector)
    reasons: list[str] = []
    if len(order) < 3:
        reasons.append("low_support_count")
    if nearest >= max_distance:
        reasons.append("nearest_atlas_support_far")
    elif nearest >= max_distance * 0.6:
        reasons.append("nearest_atlas_support_sparse")
    if spread > 90:
        reasons.append("high_angular_spread")
    confidence = float(np.clip((1.0 - nearest / max_distance) * (0.75 if spread > 90 else 1.0), 0, 1))
    if confidence < 0.35 and not reasons:
        reasons.append("low_direction_confidence")

    return DirectionResult(
        point=query,
        vector=vector,
        angle_deg=float(np.degrees(np.arctan2(vector[1], vector[0]))),
        confidence=confidence,
        source="rstl_atlas_weighted_nearest",
        nearest_distance=nearest,
        support_count=len(order),
        angular_spread_deg=spread,
        confidence_reasons=tuple(reasons),
    )
