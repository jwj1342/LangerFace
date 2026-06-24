"""Local RSTL direction query service for incision planning."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .atlas import Atlas


@dataclass(frozen=True)
class DirectionQueryResult:
    point: tuple[float, float, float]
    vector: tuple[float, float, float]
    angle_deg: float
    confidence: float
    source: str
    nearest_distance: float
    support_count: int = 0
    angular_spread_deg: float = 0.0

    def to_dict(self) -> dict[str, object]:
        return {
            "point": list(self.point),
            "vector": list(self.vector),
            "angle_deg": self.angle_deg,
            "confidence": self.confidence,
            "source": self.source,
            "nearest_distance": self.nearest_distance,
            "support_count": self.support_count,
            "angular_spread_deg": self.angular_spread_deg,
        }


def _norm(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    if n < 1e-12:
        return np.array([1.0, 0.0, 0.0])
    return v / n


def _axis_angle_diff_deg(a: float, b: float) -> float:
    """Smallest angle between two undirected axes, in degrees."""

    return abs((a - b + 90.0) % 180.0 - 90.0)


def _axial_angular_spread_deg(vectors: np.ndarray, reference: np.ndarray) -> float:
    if len(vectors) <= 1:
        return 0.0
    ref_angle = float(np.degrees(np.arctan2(reference[1], reference[0])))
    max_dev = 0.0
    for v in vectors:
        angle = float(np.degrees(np.arctan2(v[1], v[0])))
        max_dev = max(max_dev, _axis_angle_diff_deg(angle, ref_angle))
    return min(180.0, 2.0 * max_dev)


def _atlas_samples(
    vertices: np.ndarray,
    triangles: np.ndarray,
    atlas: Atlas,
) -> tuple[np.ndarray, np.ndarray]:
    pts: list[np.ndarray] = []
    tans: list[np.ndarray] = []
    for line in atlas.lines:
        if line.points.shape[0] < 2:
            continue
        line_pts: list[np.ndarray] = []
        for tri_f, u, v in line.points:
            tri_i = int(round(float(tri_f)))
            if tri_i < 0 or tri_i >= len(triangles):
                continue
            a, b, c = triangles[tri_i]
            w = 1.0 - float(u) - float(v)
            line_pts.append(float(u) * vertices[a] + float(v) * vertices[b] + w * vertices[c])
        if len(line_pts) < 2:
            continue
        P = np.asarray(line_pts, dtype=np.float64)
        for i, p in enumerate(P):
            before = P[max(0, i - 1)]
            after = P[min(len(P) - 1, i + 1)]
            tangent = _norm(after - before)
            pts.append(p)
            tans.append(tangent)
    if not pts:
        return np.zeros((0, 3), dtype=np.float64), np.zeros((0, 3), dtype=np.float64)
    return np.vstack(pts), np.vstack(tans)


def query_direction(
    point: tuple[float, float, float] | list[float] | np.ndarray,
    vertices: np.ndarray,
    triangles: np.ndarray,
    atlas: Atlas,
    *,
    max_distance: float | None = None,
    k_nearest: int = 7,
) -> DirectionQueryResult:
    """Return nearest local RSTL tangent around ``point``.

    Confidence decays with distance to the nearest atlas sample. The returned
    direction is a tool output, not an LLM-generated decision.
    """

    V = np.asarray(vertices, dtype=np.float64)
    T = np.asarray(triangles, dtype=np.int64)
    p = np.asarray(point, dtype=np.float64)
    pts, tans = _atlas_samples(V, T, atlas)
    if pts.shape[0] == 0:
        return DirectionQueryResult(tuple(p), (1.0, 0.0, 0.0), 0.0, 0.0, "rstl_atlas_empty", float("inf"))

    delta = pts - p
    dist2 = np.einsum("ij,ij->i", delta, delta)
    order = np.argsort(dist2)
    support_idx = order[: max(1, min(int(k_nearest), len(order)))]
    idx = int(support_idx[0])
    nearest_distance = float(np.sqrt(dist2[idx]))
    diag = float(np.linalg.norm(V.max(axis=0) - V.min(axis=0))) if len(V) else 1.0
    max_d = max_distance if max_distance is not None else max(diag * 0.18, 1e-9)
    confidence = max(0.0, min(1.0, 1.0 - nearest_distance / max_d))
    weights = 1.0 / (np.sqrt(dist2[support_idx]) + 1e-6)
    signed_tans = tans[support_idx].copy()
    ref = tans[idx]
    for i in range(len(signed_tans)):
        if float(np.dot(signed_tans[i], ref)) < 0:
            signed_tans[i] *= -1.0
    vector = _norm(np.average(signed_tans, axis=0, weights=weights))
    angular_spread = _axial_angular_spread_deg(signed_tans, vector)
    if angular_spread > 90.0:
        confidence *= 0.75
    angle = float(np.degrees(np.arctan2(vector[1], vector[0])))
    return DirectionQueryResult(
        point=tuple(float(x) for x in p),
        vector=tuple(float(x) for x in vector),
        angle_deg=angle,
        confidence=confidence,
        source="rstl_atlas_weighted_nearest",
        nearest_distance=nearest_distance,
        support_count=int(len(support_idx)),
        angular_spread_deg=angular_spread,
    )
