"""Bake a topology-bound RSTL direction prior from the draft atlas.

The output is a dense review asset: one weighted local RSTL direction sample per
canonical mesh triangle. It stays ``validated:false`` and does not redistribute
copyrighted Borges figures or FLAME/BFM assets.
"""
from __future__ import annotations

import argparse
import json
from datetime import UTC, date, datetime
from pathlib import Path

import numpy as np

from langerface.config import CANONICAL_OBJ, TOPOLOGY_ID, TOPOLOGY_VERSION
from langerface.geometry import CanonicalFaceModel
from langerface.lines import Atlas

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ATLAS = ROOT / "assets" / "atlas_rstl.json"
DEFAULT_OUTPUT = ROOT / "assets" / "rstl_mediapipe_direction_prior.json"
SCHEMA_VERSION = "rstl-direction-prior/v0.1"


def _norm(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    if n < 1e-12:
        return np.array([1.0, 0.0, 0.0], dtype=np.float64)
    return v / n


def _round_vec(values: np.ndarray | list[float], digits: int = 6) -> list[float]:
    return [round(float(v), digits) for v in values]


def _rel(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def _atlas_samples(
    vertices: np.ndarray,
    triangles: np.ndarray,
    atlas: Atlas,
) -> tuple[np.ndarray, np.ndarray]:
    points: list[np.ndarray] = []
    tangents: list[np.ndarray] = []
    for line in atlas.lines:
        if line.points.shape[0] < 2:
            continue
        line_points: list[np.ndarray] = []
        for tri_f, u, v in line.points:
            tri_idx = int(round(float(tri_f)))
            if tri_idx < 0 or tri_idx >= len(triangles):
                continue
            a, b, c = triangles[tri_idx]
            w = 1.0 - float(u) - float(v)
            line_points.append(float(u) * vertices[a] + float(v) * vertices[b] + w * vertices[c])
        if len(line_points) < 2:
            continue
        polyline = np.asarray(line_points, dtype=np.float64)
        for idx, point in enumerate(polyline):
            before = polyline[max(0, idx - 1)]
            after = polyline[min(len(polyline) - 1, idx + 1)]
            points.append(point)
            tangents.append(_norm(after - before))
    if not points:
        return np.zeros((0, 3), dtype=np.float64), np.zeros((0, 3), dtype=np.float64)
    return np.vstack(points), np.vstack(tangents)


def _weighted_direction(
    point: np.ndarray,
    sample_points: np.ndarray,
    sample_tangents: np.ndarray,
    vertices: np.ndarray,
    *,
    k_nearest: int,
    max_distance: float | None,
) -> dict[str, object]:
    if sample_points.shape[0] == 0:
        return {
            "vector": [1.0, 0.0, 0.0],
            "angle_deg": 0.0,
            "confidence": 0.0,
            "nearest_distance": float("inf"),
            "support_count": 0,
            "angular_spread_deg": 0.0,
        }

    delta = sample_points - point
    dist2 = np.einsum("ij,ij->i", delta, delta)
    support_n = max(1, min(int(k_nearest), len(dist2)))
    support_idx = np.argsort(dist2)[:support_n]
    nearest_idx = int(support_idx[0])
    nearest_distance = float(np.sqrt(dist2[nearest_idx]))
    diag = float(np.linalg.norm(vertices.max(axis=0) - vertices.min(axis=0))) if len(vertices) else 1.0
    max_d = max_distance if max_distance is not None else max(diag * 0.18, 1e-9)
    confidence = max(0.0, min(1.0, 1.0 - nearest_distance / max_d))

    signed_tangents = sample_tangents[support_idx].copy()
    ref = sample_tangents[nearest_idx]
    for idx in range(len(signed_tangents)):
        if float(np.dot(signed_tangents[idx], ref)) < 0:
            signed_tangents[idx] *= -1.0
    weights = 1.0 / (np.sqrt(dist2[support_idx]) + 1e-6)
    vector = _norm(np.average(signed_tangents, axis=0, weights=weights))
    alignment = np.clip(signed_tangents @ vector, -1.0, 1.0)
    angular_spread = float(np.max(np.degrees(np.arccos(alignment)))) if len(alignment) > 1 else 0.0
    if angular_spread > 45.0:
        confidence *= 0.75
    angle = float(np.degrees(np.arctan2(vector[1], vector[0])))
    return {
        "vector": _round_vec(vector),
        "angle_deg": round(angle, 3),
        "confidence": round(confidence, 4),
        "nearest_distance": round(nearest_distance, 6),
        "support_count": int(len(support_idx)),
        "angular_spread_deg": round(angular_spread, 3),
    }


def build_direction_prior(
    *,
    canonical_obj: Path,
    atlas_path: Path,
    generated_at: str,
    k_nearest: int = 7,
    low_confidence_threshold: float = 0.35,
) -> dict[str, object]:
    canonical = CanonicalFaceModel.from_obj(str(canonical_obj))
    atlas = Atlas.load(str(atlas_path))
    issues = atlas.validate(
        len(canonical.triangles),
        expected_topology_id=TOPOLOGY_ID,
        expected_topology_version=TOPOLOGY_VERSION,
    )
    if issues:
        raise ValueError(f"RSTL atlas contract failed: {issues[:5]}")

    vertices = np.asarray(canonical.vertices, dtype=np.float64)
    triangles = np.asarray(canonical.triangles, dtype=np.int64)
    sample_points, sample_tangents = _atlas_samples(vertices, triangles, atlas)
    centroids = vertices[triangles].mean(axis=1)

    samples: list[dict[str, object]] = []
    confidences: list[float] = []
    spreads: list[float] = []
    for tri_idx, point in enumerate(centroids):
        direction = _weighted_direction(
            point,
            sample_points,
            sample_tangents,
            vertices,
            k_nearest=k_nearest,
            max_distance=None,
        )
        confidence = float(direction["confidence"])
        angular_spread = float(direction["angular_spread_deg"])
        confidences.append(confidence)
        spreads.append(angular_spread)
        samples.append({
            "tri": int(tri_idx),
            "bary": [0.333333, 0.333333, 0.333334],
            "point": _round_vec(point),
            **direction,
            "source": "rstl_atlas_weighted_nearest",
        })

    confidence_arr = np.asarray(confidences, dtype=np.float64)
    spread_arr = np.asarray(spreads, dtype=np.float64)
    low_conf_count = int(np.sum(confidence_arr < low_confidence_threshold))
    return {
        "schema_version": SCHEMA_VERSION,
        "system": "rstl",
        "topologyId": atlas.topology_id,
        "topologyVersion": atlas.topology_version,
        "validated": False,
        "review_status": "draft_not_clinically_validated",
        "generated_at": generated_at,
        "generated_by": "tools/build_rstl_direction_prior.py",
        "source_atlas": _rel(atlas_path),
        "source_atlas_version": atlas.version,
        "source_atlas_validated": atlas.validated,
        "coordinate_space": "canonical_face_model.obj; x right, y up, z toward viewer",
        "sample_kind": "triangle_centroid_direction",
        "triangle_count": int(len(triangles)),
        "source_line_count": int(len(atlas.lines)),
        "source_line_point_count": int(sum(len(line.points) for line in atlas.lines)),
        "parameters": {
            "k_nearest": int(k_nearest),
            "low_confidence_threshold": float(low_confidence_threshold),
            "confidence_rule": (
                "1 - nearest_atlas_sample_distance / (canonical_bbox_diag * 0.18), "
                "clipped to [0,1]"
            ),
        },
        "coverage": {
            "sample_count": int(len(samples)),
            "low_confidence_count": low_conf_count,
            "low_confidence_fraction": round(low_conf_count / max(len(samples), 1), 4),
            "min_confidence": round(float(confidence_arr.min()) if len(confidence_arr) else 0.0, 4),
            "mean_confidence": round(float(confidence_arr.mean()) if len(confidence_arr) else 0.0, 4),
            "max_angular_spread_deg": round(float(spread_arr.max(initial=0.0)), 3),
            "regions_requiring_review": ["forehead", "ear_periauricular", "lateral_face"],
        },
        "limitations": [
            (
                "Derived from the current MediaPipe RSTL draft atlas, not from redistributed "
                "Borges source images."
            ),
            (
                "Triangle-centroid directions are review samples; clinician review under issue #2 "
                "is still required."
            ),
            (
                "FLAME/BFM registration remains pending because licensed 3DMM assets are not "
                "redistributed in this repo."
            ),
        ],
        "samples": samples,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--canonical-obj", default=CANONICAL_OBJ)
    parser.add_argument("--atlas", default=str(DEFAULT_ATLAS))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--generated-at", default=date.today().isoformat())
    parser.add_argument("--k-nearest", type=int, default=7)
    parser.add_argument("--low-confidence-threshold", type=float, default=0.35)
    args = parser.parse_args()

    # Accept full ISO datetimes while keeping the committed asset date-only.
    generated_at = args.generated_at
    if generated_at == "now":
        generated_at = datetime.now(UTC).date().isoformat()

    prior = build_direction_prior(
        canonical_obj=Path(args.canonical_obj),
        atlas_path=Path(args.atlas),
        generated_at=generated_at,
        k_nearest=args.k_nearest,
        low_confidence_threshold=args.low_confidence_threshold,
    )
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(prior, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"[ok] {output} {prior['coverage']['sample_count']} samples, "
        f"low_confidence={prior['coverage']['low_confidence_count']}"
    )


if __name__ == "__main__":
    main()
