#!/usr/bin/env python3
"""Build a dev-local 3DMM RSTL direction prior from the MediaPipe draft prior.

This is a topology bridge generator for issue #86. It does not commit or
redistribute FLAME/BFM/3DMM-derived outputs; the FLAME default output path
lives under ``local_outputs/`` and is gitignored. The generated asset remains
``validated:false`` and requires #2 clinical review.
"""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_PRIOR = ROOT / "local_outputs" / "rstl_mediapipe_direction_prior.json"
DEFAULT_TARGET_TOPOLOGY = ROOT / "web" / "assets" / "topology_flame_2023.json"
DEFAULT_TARGET_VERTICES = ROOT / "web" / "assets" / "flame_neutral_vertices.json"
DEFAULT_OUTPUT = ROOT / "local_outputs" / "rstl_flame_direction_prior.json"
SCHEMA_VERSION = "rstl-3dmm-direction-prior/v0.1"
DRAFT_REVIEW_STATUS = "draft_not_clinically_validated"


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text())


def _norm(vector: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(vector))
    if n < 1e-12:
        return np.array([1.0, 0.0, 0.0], dtype=np.float64)
    return vector / n


def _round_vec(values: np.ndarray | list[float], digits: int = 6) -> list[float]:
    return [round(float(value), digits) for value in values]


def _rel(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def _axis_spread_deg(vectors: np.ndarray, reference: np.ndarray) -> float:
    if len(vectors) <= 1:
        return 0.0
    dots = np.clip(vectors @ reference, -1.0, 1.0)
    return float(np.max(np.degrees(np.arccos(dots))))


def _bbox_similarity_align_points(
    source_points: np.ndarray,
    target_vertices: np.ndarray,
) -> tuple[np.ndarray, dict[str, Any]]:
    source_lo = source_points.min(axis=0)
    source_hi = source_points.max(axis=0)
    target_lo = target_vertices.min(axis=0)
    target_hi = target_vertices.max(axis=0)
    source_center = (source_lo + source_hi) * 0.5
    target_center = (target_lo + target_hi) * 0.5
    source_diag = float(np.linalg.norm(source_hi - source_lo))
    target_diag = float(np.linalg.norm(target_hi - target_lo))
    scale = target_diag / max(source_diag, 1e-9)
    aligned = (source_points - source_center) * scale + target_center
    return aligned, {
        "method": "bbox_center_uniform_scale",
        "source_center": _round_vec(source_center),
        "target_center": _round_vec(target_center),
        "uniform_scale": round(float(scale), 8),
        "source_bbox_diag": round(source_diag, 6),
        "target_bbox_diag": round(target_diag, 6),
        "clinical_boundary": (
            "Coordinate alignment is a topology bridge heuristic, not clinical registration."
        ),
    }


def _weighted_source_direction(
    point: np.ndarray,
    source_points: np.ndarray,
    source_vectors: np.ndarray,
    source_confidences: np.ndarray,
    source_tris: np.ndarray,
    target_vertices: np.ndarray,
    *,
    k_nearest: int,
) -> dict[str, Any]:
    delta = source_points - point
    dist2 = np.einsum("ij,ij->i", delta, delta)
    support_n = max(1, min(int(k_nearest), len(dist2)))
    support_idx = np.argsort(dist2)[:support_n]
    nearest_idx = int(support_idx[0])
    nearest_distance = float(np.sqrt(dist2[nearest_idx]))

    signed = source_vectors[support_idx].copy()
    ref = source_vectors[nearest_idx]
    for idx in range(len(signed)):
        if float(np.dot(signed[idx], ref)) < 0:
            signed[idx] *= -1.0
    weights = source_confidences[support_idx] / (np.sqrt(dist2[support_idx]) + 1e-6)
    if float(np.sum(weights)) <= 1e-12:
        weights = 1.0 / (np.sqrt(dist2[support_idx]) + 1e-6)
    vector = _norm(np.average(signed, axis=0, weights=weights))
    spread = _axis_spread_deg(signed, vector)

    diag = float(np.linalg.norm(target_vertices.max(axis=0) - target_vertices.min(axis=0)))
    distance_confidence = max(0.0, min(1.0, 1.0 - nearest_distance / max(diag * 0.18, 1e-9)))
    source_confidence = float(np.average(source_confidences[support_idx], weights=weights))
    confidence = min(source_confidence, distance_confidence)
    if spread > 45.0:
        confidence *= 0.75
    angle = float(np.degrees(np.arctan2(vector[1], vector[0])))
    return {
        "vector": _round_vec(vector),
        "angle_deg": round(angle, 3),
        "confidence": round(float(confidence), 4),
        "nearest_source_tri": int(source_tris[nearest_idx]),
        "nearest_source_distance": round(nearest_distance, 6),
        "support_count": int(len(support_idx)),
        "angular_spread_deg": round(spread, 3),
        "source": "mediapipe_direction_prior_nearest_bridge",
    }


def _load_source_prior(path: Path) -> tuple[dict[str, Any], np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    prior = _load_json(path)
    if prior.get("validated") is not False:
        raise ValueError("source direction prior must remain validated:false")
    samples = prior.get("samples") or []
    if not samples:
        raise ValueError("source direction prior has no samples")
    points = np.asarray([sample["point"] for sample in samples], dtype=np.float64)
    vectors = np.asarray([sample["vector"] for sample in samples], dtype=np.float64)
    vectors = np.vstack([_norm(vector) for vector in vectors])
    confidences = np.asarray([sample.get("confidence", 0.0) for sample in samples], dtype=np.float64)
    tris = np.asarray([sample.get("tri", idx) for idx, sample in enumerate(samples)], dtype=np.int64)
    return prior, points, vectors, np.clip(confidences, 0.0, 1.0), tris


def build_3dmm_direction_prior(
    *,
    source_prior_path: Path,
    target_topology_path: Path,
    target_vertices_path: Path,
    generated_at: str,
    target_model_name: str,
    generated_by: str,
    k_nearest: int = 7,
    low_confidence_threshold: float = 0.35,
    align_source_bbox: bool = True,
) -> dict[str, Any]:
    source_prior, source_points, source_vectors, source_confidences, source_tris = _load_source_prior(
        source_prior_path
    )
    topology = _load_json(target_topology_path)
    vertices = np.asarray(_load_json(target_vertices_path), dtype=np.float64)
    triangles = np.asarray(topology.get("triangles") or [], dtype=np.int64)
    if vertices.ndim != 2 or vertices.shape[1] != 3:
        raise ValueError("target vertices must be an Nx3 JSON array")
    if triangles.ndim != 2 or triangles.shape[1] != 3:
        raise ValueError("target topology must contain triangle index triples")
    if int(triangles.max(initial=-1)) >= len(vertices) or int(triangles.min(initial=0)) < 0:
        raise ValueError("target topology triangle indices are out of bounds")
    if align_source_bbox:
        bridge_points, bridge_alignment = _bbox_similarity_align_points(source_points, vertices)
    else:
        bridge_points = source_points
        bridge_alignment = {
            "method": "none",
            "clinical_boundary": "Unaligned coordinate bridge is not clinical registration.",
        }

    centroids = vertices[triangles].mean(axis=1)
    samples: list[dict[str, Any]] = []
    confidences: list[float] = []
    spreads: list[float] = []
    for tri_idx, point in enumerate(centroids):
        direction = _weighted_source_direction(
            point,
            bridge_points,
            source_vectors,
            source_confidences,
            source_tris,
            vertices,
            k_nearest=k_nearest,
        )
        confidences.append(float(direction["confidence"]))
        spreads.append(float(direction["angular_spread_deg"]))
        samples.append({
            "tri": int(tri_idx),
            "bary": [0.333333, 0.333333, 0.333334],
            "point": _round_vec(point),
            **direction,
        })

    confidence_arr = np.asarray(confidences, dtype=np.float64)
    spread_arr = np.asarray(spreads, dtype=np.float64)
    low_conf_count = int(np.sum(confidence_arr < low_confidence_threshold))
    return {
        "schema_version": SCHEMA_VERSION,
        "system": "rstl",
        "topologyId": topology.get("topologyId"),
        "topologyVersion": topology.get("topologyVersion"),
        "validated": False,
        "review_status": DRAFT_REVIEW_STATUS,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "target_model_name": target_model_name,
        "target_topology_path": _rel(target_topology_path),
        "target_vertices_path": _rel(target_vertices_path),
        "source_direction_prior": _rel(source_prior_path),
        "source_schema_version": source_prior.get("schema_version"),
        "source_topologyId": source_prior.get("topologyId"),
        "source_topologyVersion": source_prior.get("topologyVersion"),
        "source_validated": source_prior.get("validated"),
        "coordinate_space": (
            f"{target_model_name} neutral 3DMM mesh coordinate space; bbox-aligned "
            "nearest-neighbor bridge from MediaPipe canonical direction prior"
        ),
        "sample_kind": "triangle_centroid_direction",
        "registration_method": "bbox_aligned_nearest_source_triangle_centroid_direction_transfer",
        "triangle_count": int(len(triangles)),
        "source_sample_count": int(len(source_points)),
        "bridge_alignment": bridge_alignment,
        "parameters": {
            "k_nearest": int(k_nearest),
            "low_confidence_threshold": float(low_confidence_threshold),
            "align_source_bbox": bool(align_source_bbox),
            "confidence_rule": (
                "min(source_confidence_weighted_average, "
                "1 - nearest_source_distance / (target_bbox_diag * 0.18)); "
                "angular_spread > 45deg applies 0.75 multiplier"
            ),
        },
        "coverage": {
            "sample_count": int(len(samples)),
            "low_confidence_count": low_conf_count,
            "low_confidence_fraction": round(low_conf_count / max(len(samples), 1), 4),
            "min_confidence": round(float(confidence_arr.min()) if len(confidence_arr) else 0.0, 4),
            "mean_confidence": round(float(confidence_arr.mean()) if len(confidence_arr) else 0.0, 4),
            "max_angular_spread_deg": round(float(spread_arr.max(initial=0.0)), 3),
            "regions_requiring_review": [
                "forehead",
                "ear_periauricular",
                "lateral_face",
                "all_3dmm_bridge_samples",
            ],
        },
        "limitations": [
            (
                "Derived from the current MediaPipe RSTL draft direction prior, "
                "not from redistributed Borges source images."
            ),
            (
                "BBox-aligned nearest-neighbor cross-topology bridge is only a dev-local "
                "review scaffold, not clinical FLAME/BFM registration."
            ),
            (
                "Generated FLAME/BFM/3DMM outputs must stay outside git unless license "
                "and clinical review gates explicitly allow otherwise."
            ),
            "Issue #2 clinical review is required before any generated asset can be marked validated:true.",
        ],
        "samples": samples,
    }


def build_flame_direction_prior(
    *,
    source_prior_path: Path,
    target_topology_path: Path,
    target_vertices_path: Path,
    generated_at: str,
    target_model_name: str = "flame",
    k_nearest: int = 7,
    low_confidence_threshold: float = 0.35,
    align_source_bbox: bool = True,
) -> dict[str, Any]:
    return build_3dmm_direction_prior(
        source_prior_path=source_prior_path,
        target_topology_path=target_topology_path,
        target_vertices_path=target_vertices_path,
        generated_at=generated_at,
        target_model_name=target_model_name,
        generated_by="tools/build_flame_rstl_direction_prior.py",
        k_nearest=k_nearest,
        low_confidence_threshold=low_confidence_threshold,
        align_source_bbox=align_source_bbox,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-prior", default=str(DEFAULT_SOURCE_PRIOR))
    parser.add_argument("--target-topology", default=str(DEFAULT_TARGET_TOPOLOGY))
    parser.add_argument("--target-vertices", default=str(DEFAULT_TARGET_VERTICES))
    parser.add_argument(
        "--target-name",
        default="flame",
        help="human-readable target 3DMM name written to provenance",
    )
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--generated-at", default=date.today().isoformat())
    parser.add_argument("--k-nearest", type=int, default=7)
    parser.add_argument("--low-confidence-threshold", type=float, default=0.35)
    parser.add_argument(
        "--no-align-source-bbox",
        action="store_true",
        help="disable source-prior bbox center/scale alignment before nearest-neighbor transfer",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    generated_at = args.generated_at
    if generated_at == "now":
        generated_at = datetime.now(timezone.utc).date().isoformat()
    try:
        prior = build_flame_direction_prior(
            source_prior_path=Path(args.source_prior),
            target_topology_path=Path(args.target_topology),
            target_vertices_path=Path(args.target_vertices),
            generated_at=generated_at,
            target_model_name=args.target_name,
            k_nearest=args.k_nearest,
            low_confidence_threshold=args.low_confidence_threshold,
            align_source_bbox=not args.no_align_source_bbox,
        )
    except FileNotFoundError as exc:
        print(f"[skip] missing dev-local RSTL/FLAME asset: {exc.filename}")
        print(
            "       Run tools/build_rstl_direction_prior.py first; for FLAME topology, run "
            "tools/export_flame_topology.py after placing licensed FLAME assets locally."
        )
        return 0
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(prior, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"[ok] {output} {prior['coverage']['sample_count']} samples, "
        f"low_confidence={prior['coverage']['low_confidence_count']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
