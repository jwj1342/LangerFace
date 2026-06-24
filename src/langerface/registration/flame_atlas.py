"""Register project atlas lines onto the FLAME topology.

The registration path is intentionally explicit:

1. sample source atlas points on the MediaPipe canonical mesh;
2. fit a 3D polyharmonic spline from MediaPipe canonical control points to
   official MediaPipe-on-FLAME embedding points;
3. project the transformed points back to the nearest FLAME triangles and store
   them as the same ``[tri, u, v]`` atlas contract.

The result is a reviewable geometry draft. It does not make the clinical claim
that template RSTL lines are patient-specific ground truth.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np

from langerface.config.constants import TOPOLOGY_ID_FLAME, TOPOLOGY_VERSION_FLAME
from langerface.flame import sample_bary
from langerface.geometry.topology import build_topology_contract
from langerface.lines.atlas import Atlas, AtlasLine


@dataclass(frozen=True)
class FlameBasis:
    vertices: np.ndarray
    faces: np.ndarray
    lmk_face_idx: np.ndarray
    lmk_b_coords: np.ndarray
    landmark_indices: np.ndarray

    @property
    def topology(self) -> dict:
        return build_topology_contract(
            TOPOLOGY_ID_FLAME,
            TOPOLOGY_VERSION_FLAME,
            int(self.vertices.shape[0]),
            self.faces.astype(int).tolist(),
        )


@dataclass(frozen=True)
class PolyharmonicMap:
    control: np.ndarray
    weights: np.ndarray
    affine: np.ndarray

    def transform(self, points: np.ndarray) -> np.ndarray:
        pts = np.asarray(points, dtype=np.float64).reshape(-1, 3)
        k = _kernel(_pairwise_distances(pts, self.control))
        p = np.column_stack([np.ones(pts.shape[0]), pts])
        return k @ self.weights + p @ self.affine


@dataclass(frozen=True)
class SurfaceProjection:
    triangle_indices: np.ndarray
    barycentric: np.ndarray
    points: np.ndarray
    squared_distances: np.ndarray


def load_flame_basis(path: str | Path) -> FlameBasis:
    data = np.load(path, allow_pickle=True)
    return FlameBasis(
        vertices=np.asarray(data["v_template"], dtype=np.float64).reshape(-1, 3),
        faces=np.asarray(data["faces"], dtype=np.int64).reshape(-1, 3),
        lmk_face_idx=np.asarray(data["lmk_face_idx"], dtype=np.int64),
        lmk_b_coords=np.asarray(data["lmk_b_coords"], dtype=np.float64).reshape(-1, 3),
        landmark_indices=np.asarray(data["landmark_indices"], dtype=np.int64),
    )


def atlas_points_to_xyz(atlas: Atlas, vertices: np.ndarray, triangles: np.ndarray) -> tuple[np.ndarray, list[int]]:
    line_lengths = [int(line.points.shape[0]) for line in atlas.lines]
    if not line_lengths:
        return np.empty((0, 3), dtype=np.float64), []
    points = np.vstack([line.points for line in atlas.lines])
    xyz = sample_atlas_points(points, vertices, triangles)
    return xyz, line_lengths


def sample_atlas_points(atlas_points: np.ndarray, vertices: np.ndarray, triangles: np.ndarray) -> np.ndarray:
    pts = np.asarray(atlas_points, dtype=np.float64).reshape(-1, 3)
    tris = np.asarray(triangles, dtype=np.int64)[pts[:, 0].astype(np.int64)]
    u = pts[:, 1]
    v = pts[:, 2]
    w = 1.0 - u - v
    verts = np.asarray(vertices, dtype=np.float64)
    return u[:, None] * verts[tris[:, 0]] + v[:, None] * verts[tris[:, 1]] + w[:, None] * verts[tris[:, 2]]


def fit_flame_registration(canonical_vertices: np.ndarray, basis: FlameBasis, smoothing: float = 1e-6) -> PolyharmonicMap:
    src = np.asarray(canonical_vertices, dtype=np.float64)[basis.landmark_indices]
    dst = sample_bary(basis.vertices, basis.faces, basis.lmk_face_idx, basis.lmk_b_coords)
    return fit_polyharmonic_map(src, dst, smoothing=smoothing)


def fit_polyharmonic_map(source: np.ndarray, target: np.ndarray, smoothing: float = 1e-6) -> PolyharmonicMap:
    src = np.asarray(source, dtype=np.float64).reshape(-1, 3)
    dst = np.asarray(target, dtype=np.float64).reshape(-1, 3)
    if src.shape != dst.shape:
        raise ValueError(f"source/target shape mismatch: {src.shape} vs {dst.shape}")
    if src.shape[0] < 5:
        raise ValueError("at least five control points are required for a stable 3D registration")

    k = _kernel(_pairwise_distances(src, src))
    k.flat[:: k.shape[0] + 1] += smoothing
    p = np.column_stack([np.ones(src.shape[0]), src])
    lhs = np.block([[k, p], [p.T, np.zeros((4, 4), dtype=np.float64)]])
    rhs = np.vstack([dst, np.zeros((4, 3), dtype=np.float64)])
    coeff = np.linalg.solve(lhs, rhs)
    return PolyharmonicMap(control=src, weights=coeff[: src.shape[0]], affine=coeff[src.shape[0] :])


def project_to_surface(
    points: np.ndarray,
    vertices: np.ndarray,
    faces: np.ndarray,
    candidate_count: int = 96,
    centroid_chunk: int = 256,
) -> SurfaceProjection:
    pts = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    verts = np.asarray(vertices, dtype=np.float64)
    tris = np.asarray(faces, dtype=np.int64)
    if pts.size == 0:
        return SurfaceProjection(
            triangle_indices=np.empty(0, dtype=np.int64),
            barycentric=np.empty((0, 3), dtype=np.float64),
            points=np.empty((0, 3), dtype=np.float64),
            squared_distances=np.empty(0, dtype=np.float64),
        )

    centroids = verts[tris].mean(axis=1)
    candidates = _nearest_centroid_candidates(pts, centroids, min(candidate_count, len(tris)), centroid_chunk)

    tri_indices = np.empty(pts.shape[0], dtype=np.int64)
    bary = np.empty((pts.shape[0], 3), dtype=np.float64)
    closest = np.empty((pts.shape[0], 3), dtype=np.float64)
    dist2 = np.empty(pts.shape[0], dtype=np.float64)
    for i, p in enumerate(pts):
        best_dist = np.inf
        best_face = -1
        best_point = None
        best_bary = None
        for face_idx in candidates[i]:
            a, b, c = verts[tris[int(face_idx)]]
            q, bc = closest_point_on_triangle(p, a, b, c)
            d2 = float(np.sum((p - q) ** 2))
            if d2 < best_dist:
                best_dist = d2
                best_face = int(face_idx)
                best_point = q
                best_bary = bc
        dist2[i] = best_dist
        tri_indices[i] = best_face
        closest[i] = best_point
        bary[i] = best_bary

    return SurfaceProjection(triangle_indices=tri_indices, barycentric=bary, points=closest, squared_distances=dist2)


def build_registered_atlas(source: Atlas, projection: SurfaceProjection, line_lengths: Iterable[int]) -> Atlas:
    offset = 0
    lines: list[AtlasLine] = []
    for source_line, n in zip(source.lines, line_lengths, strict=True):
        tri = projection.triangle_indices[offset : offset + n]
        bary = projection.barycentric[offset : offset + n]
        points = np.column_stack([tri, bary[:, 0], bary[:, 1]])
        lines.append(AtlasLine(name=source_line.name, region=source_line.region, points=points))
        offset += n
    return Atlas(
        system=source.system,
        lines=lines,
        version=source.version,
        topology_id=TOPOLOGY_ID_FLAME,
        topology_version=TOPOLOGY_VERSION_FLAME,
        provenance=source.provenance,
        validated=False,
    )


def closest_point_on_triangle(
    point: np.ndarray, a: np.ndarray, b: np.ndarray, c: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Return closest point and barycentric weights for triangle ``abc``."""
    p = np.asarray(point, dtype=np.float64)
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    c = np.asarray(c, dtype=np.float64)
    ab = b - a
    ac = c - a
    ap = p - a
    d1 = float(np.dot(ab, ap))
    d2 = float(np.dot(ac, ap))
    if d1 <= 0.0 and d2 <= 0.0:
        return a, np.array([1.0, 0.0, 0.0])

    bp = p - b
    d3 = float(np.dot(ab, bp))
    d4 = float(np.dot(ac, bp))
    if d3 >= 0.0 and d4 <= d3:
        return b, np.array([0.0, 1.0, 0.0])

    vc = d1 * d4 - d3 * d2
    if vc <= 0.0 and d1 >= 0.0 and d3 <= 0.0:
        v = d1 / (d1 - d3)
        return a + v * ab, np.array([1.0 - v, v, 0.0])

    cp = p - c
    d5 = float(np.dot(ab, cp))
    d6 = float(np.dot(ac, cp))
    if d6 >= 0.0 and d5 <= d6:
        return c, np.array([0.0, 0.0, 1.0])

    vb = d5 * d2 - d1 * d6
    if vb <= 0.0 and d2 >= 0.0 and d6 <= 0.0:
        w = d2 / (d2 - d6)
        return a + w * ac, np.array([1.0 - w, 0.0, w])

    va = d3 * d6 - d5 * d4
    if va <= 0.0 and (d4 - d3) >= 0.0 and (d5 - d6) >= 0.0:
        w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
        return b + w * (c - b), np.array([0.0, 1.0 - w, w])

    denom = 1.0 / (va + vb + vc)
    v = vb * denom
    w = vc * denom
    return a + ab * v + ac * w, np.array([1.0 - v - w, v, w])


def _nearest_centroid_candidates(points: np.ndarray, centroids: np.ndarray, count: int, chunk_size: int) -> np.ndarray:
    try:
        from scipy.spatial import cKDTree  # type: ignore
    except Exception:
        out = np.empty((points.shape[0], count), dtype=np.int64)
        for start in range(0, points.shape[0], chunk_size):
            end = min(start + chunk_size, points.shape[0])
            d2 = np.sum((points[start:end, None, :] - centroids[None, :, :]) ** 2, axis=2)
            out[start:end] = np.argpartition(d2, kth=count - 1, axis=1)[:, :count]
        return out
    _, idx = cKDTree(centroids).query(points, k=count)
    return np.asarray(idx, dtype=np.int64).reshape(points.shape[0], count)


def _pairwise_distances(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return np.linalg.norm(a[:, None, :] - b[None, :, :], axis=2)


def _kernel(r: np.ndarray) -> np.ndarray:
    return np.asarray(r, dtype=np.float64)
