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

    def to_dict(self) -> dict[str, object]:
        return {
            "point": list(self.point),
            "vector": list(self.vector),
            "angle_deg": self.angle_deg,
            "confidence": self.confidence,
            "source": self.source,
            "nearest_distance": self.nearest_distance,
        }


def _norm(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    if n < 1e-12:
        return np.array([1.0, 0.0, 0.0])
    return v / n


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
    idx = int(np.argmin(dist2))
    nearest_distance = float(np.sqrt(dist2[idx]))
    diag = float(np.linalg.norm(V.max(axis=0) - V.min(axis=0))) if len(V) else 1.0
    max_d = max_distance if max_distance is not None else max(diag * 0.18, 1e-9)
    confidence = max(0.0, min(1.0, 1.0 - nearest_distance / max_d))
    vector = _norm(tans[idx])
    angle = float(np.degrees(np.arctan2(vector[1], vector[0])))
    return DirectionQueryResult(
        point=tuple(float(x) for x in p),
        vector=tuple(float(x) for x in vector),
        angle_deg=angle,
        confidence=confidence,
        source="rstl_atlas_nearest",
        nearest_distance=nearest_distance,
    )
