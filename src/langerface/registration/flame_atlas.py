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

from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from langerface.config.constants import TOPOLOGY_ID_FLAME, TOPOLOGY_VERSION_FLAME
from langerface.flame import sample_bary
from langerface.geometry.topology import build_topology_contract
from langerface.lines.atlas import Atlas, AtlasLine
from langerface.lines.build import atlas_line_from_points2d


@dataclass(frozen=True)
class DiagramExtractionConfig:
    crop: tuple[int, int, int, int] = (0, 0, 620, 805)
    face_box: tuple[float, float, float, float] = (50.0, 0.0, 570.0, 720.0)
    dark_threshold: int = 10
    gray_min: int = 55
    gray_max: int = 235
    ellipse_center: tuple[int, int] = (310, 345)
    ellipse_axes: tuple[int, int] = (270, 350)
    excluded_boxes: tuple[tuple[int, int, int, int], ...] = (
        (90, 270, 250, 360),
        (365, 270, 530, 360),
        (210, 380, 410, 500),
        (190, 555, 430, 640),
    )
    min_component_pixels: int = 20
    min_component_extent: int = 8
    bin_size: int = 2
    max_points_per_line: int = 80
    bridge_max_gap: float = 42.0
    bridge_max_angle_deg: float = 38.0
    bridge_max_opposite_angle_deg: float = 45.0
    bridge_step: float = 4.0


@dataclass(frozen=True)
class DiagramExtractionResult:
    lines: list[np.ndarray]
    mask: np.ndarray
    crop_image: np.ndarray
    config: DiagramExtractionConfig


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


def extract_rstl_lines_from_diagram(
    path: str | Path,
    config: DiagramExtractionConfig | None = None,
) -> DiagramExtractionResult:
    """Extract centerline polylines from the classic frontal RSTL diagram."""
    import cv2

    cfg = config or DiagramExtractionConfig()
    img = cv2.imread(str(path))
    if img is None:
        raise FileNotFoundError(f"diagram image not found or unreadable: {path}")

    x0, y0, x1, y1 = cfg.crop
    crop = img[y0:y1, x0:x1].copy()
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (0, 0), 5)
    dark = cv2.subtract(blur, gray)
    _, mask = cv2.threshold(dark, cfg.dark_threshold, 255, cv2.THRESH_BINARY)
    gray_range = ((gray > cfg.gray_min) & (gray < cfg.gray_max)).astype("uint8") * 255
    mask = cv2.bitwise_and(mask, gray_range)

    ellipse = np.zeros_like(mask)
    cv2.ellipse(ellipse, cfg.ellipse_center, cfg.ellipse_axes, 0, 0, 360, 255, -1)
    mask = cv2.bitwise_and(mask, ellipse)

    excluded = np.zeros_like(mask)
    for box in cfg.excluded_boxes:
        cv2.rectangle(excluded, box[:2], box[2:], 255, -1)
    mask = cv2.bitwise_and(mask, cv2.bitwise_not(excluded))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))

    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    lines: list[np.ndarray] = []
    for label in range(1, n_labels):
        area = int(stats[label, cv2.CC_STAT_AREA])
        width = int(stats[label, cv2.CC_STAT_WIDTH])
        height = int(stats[label, cv2.CC_STAT_HEIGHT])
        if area < cfg.min_component_pixels or max(width, height) < cfg.min_component_extent:
            continue
        ys, xs = np.where(labels == label)
        line = _component_centerline(xs, ys, cfg)
        if line.shape[0] >= 2:
            lines.append(line)
    lines = bridge_centerline_gaps(lines, cfg)
    return DiagramExtractionResult(lines=lines, mask=mask, crop_image=crop, config=cfg)


def bridge_centerline_gaps(lines: list[np.ndarray], cfg: DiagramExtractionConfig) -> list[np.ndarray]:
    """Join fragmented diagram centerlines when endpoints continue the same stroke."""
    out = [np.asarray(line, dtype=np.float64) for line in lines if len(line) >= 2]
    while True:
        best = None
        for i in range(len(out)):
            for j in range(i + 1, len(out)):
                for side_i in (0, 1):
                    for side_j in (0, 1):
                        score = _bridge_score(out[i], side_i, out[j], side_j, cfg)
                        if score is not None and (best is None or score < best[0]):
                            best = (score, i, side_i, j, side_j)
        if best is None:
            return out
        _, i, side_i, j, side_j = best
        merged = _merge_lines_at_endpoints(out[i], side_i, out[j], side_j, cfg.bridge_step)
        out = [line for k, line in enumerate(out) if k not in (i, j)]
        out.append(merged)


def diagram_lines_to_canonical_atlas(
    extraction: DiagramExtractionResult,
    canonical,
    *,
    system: str = "rstl",
    name_prefix: str = "rstl_prsgo",
    provenance: str = "",
) -> Atlas:
    proj = canonical.project_front()
    lines: list[AtlasLine] = []
    for i, pixel_line in enumerate(extraction.lines):
        norm = _diagram_pixels_to_norm(pixel_line, extraction.config.face_box)
        pts2d = canonical.norm_to_proj(norm)
        region = _region_for_norm_line(norm)
        lines.append(atlas_line_from_points2d(canonical, f"{name_prefix}_{i:03d}", region, pts2d, proj=proj))
    return Atlas(
        system=system,
        lines=lines,
        version="diagram-draft.1",
        provenance=provenance,
        validated=False,
    )


def atlas_points_to_xyz(
    atlas: Atlas,
    vertices: np.ndarray,
    triangles: np.ndarray,
) -> tuple[np.ndarray, list[int]]:
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


def fit_flame_registration(
    canonical_vertices: np.ndarray,
    basis: FlameBasis,
    smoothing: float = 1e-6,
) -> PolyharmonicMap:
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

    return SurfaceProjection(
        triangle_indices=tri_indices,
        barycentric=bary,
        points=closest,
        squared_distances=dist2,
    )


def build_registered_atlas(
    source: Atlas,
    projection: SurfaceProjection,
    line_lengths: Iterable[int],
) -> Atlas:
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


def _nearest_centroid_candidates(
    points: np.ndarray,
    centroids: np.ndarray,
    count: int,
    chunk_size: int,
) -> np.ndarray:
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


def _component_centerline(xs: np.ndarray, ys: np.ndarray, cfg: DiagramExtractionConfig) -> np.ndarray:
    if (xs.max() - xs.min()) >= (ys.max() - ys.min()):
        points = []
        for x0 in range(int(xs.min()), int(xs.max()) + 1, cfg.bin_size):
            keep = (xs >= x0) & (xs < x0 + cfg.bin_size)
            if np.any(keep):
                points.append([float(np.median(xs[keep])), float(np.median(ys[keep]))])
        out = np.asarray(points, dtype=np.float64)
        order = np.argsort(out[:, 0])
    else:
        points = []
        for y0 in range(int(ys.min()), int(ys.max()) + 1, cfg.bin_size):
            keep = (ys >= y0) & (ys < y0 + cfg.bin_size)
            if np.any(keep):
                points.append([float(np.median(xs[keep])), float(np.median(ys[keep]))])
        out = np.asarray(points, dtype=np.float64)
        order = np.argsort(out[:, 1])
    out = out[order]
    if out.shape[0] > cfg.max_points_per_line:
        idx = np.linspace(0, out.shape[0] - 1, cfg.max_points_per_line).round().astype(int)
        out = out[idx]
    return out


def _bridge_score(
    a: np.ndarray,
    side_a: int,
    b: np.ndarray,
    side_b: int,
    cfg: DiagramExtractionConfig,
) -> float | None:
    pa = a[0] if side_a == 0 else a[-1]
    pb = b[0] if side_b == 0 else b[-1]
    connector = pb - pa
    gap = float(np.linalg.norm(connector))
    if gap <= 1e-6 or gap > cfg.bridge_max_gap:
        return None

    ta = _endpoint_outward_tangent(a, side_a)
    tb = _endpoint_outward_tangent(b, side_b)
    c = connector / gap
    angle_a = _angle_deg(ta, c)
    angle_b = _angle_deg(tb, -c)
    opposite = _angle_deg(ta, -tb)

    # Very short gaps tolerate more local pixel noise; larger gaps need clear continuation.
    relax = 18.0 if gap <= 12.0 else 8.0 if gap <= 24.0 else 0.0
    if angle_a > cfg.bridge_max_angle_deg + relax:
        return None
    if angle_b > cfg.bridge_max_angle_deg + relax:
        return None
    if opposite > cfg.bridge_max_opposite_angle_deg + relax:
        return None
    return gap + 0.35 * (angle_a + angle_b + opposite)


def _endpoint_outward_tangent(line: np.ndarray, side: int, lookahead: int = 5) -> np.ndarray:
    n = min(max(1, lookahead), line.shape[0] - 1)
    if side == 0:
        vec = line[0] - line[n]
    else:
        vec = line[-1] - line[-1 - n]
    norm = float(np.linalg.norm(vec))
    if norm < 1e-9:
        return np.array([1.0, 0.0], dtype=np.float64)
    return vec / norm


def _angle_deg(a: np.ndarray, b: np.ndarray) -> float:
    dot = float(np.clip(np.dot(a, b), -1.0, 1.0))
    return float(np.degrees(np.arccos(dot)))


def _merge_lines_at_endpoints(
    a: np.ndarray,
    side_a: int,
    b: np.ndarray,
    side_b: int,
    step: float,
) -> np.ndarray:
    aa = a if side_a == 1 else a[::-1]
    bb = b if side_b == 0 else b[::-1]
    gap = float(np.linalg.norm(bb[0] - aa[-1]))
    if gap <= step:
        return np.vstack([aa, bb])
    n = max(1, int(np.floor(gap / step)))
    bridge = np.linspace(aa[-1], bb[0], n + 2, dtype=np.float64)[1:-1]
    return np.vstack([aa, bridge, bb])


def _diagram_pixels_to_norm(points: np.ndarray, face_box: tuple[float, float, float, float]) -> np.ndarray:
    x0, y0, x1, y1 = face_box
    pts = np.asarray(points, dtype=np.float64)
    norm = np.column_stack([(pts[:, 0] - x0) / (x1 - x0), (pts[:, 1] - y0) / (y1 - y0)])
    return norm


def _region_for_norm_line(norm: np.ndarray) -> str:
    y = float(np.mean(norm[:, 1]))
    if y < 0.33:
        return "forehead"
    if y < 0.52:
        return "periorbital"
    if y < 0.78:
        return "midface"
    return "chin"
