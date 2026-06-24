"""Register classic RSTL diagram lines onto FLAME 2023 topology.

The default source is the frontal classic RSTL plate in ``RSTL/RSTL PRSgo.png``.
The script extracts diagram line segments from that image, locates them on the
MediaPipe canonical face as an intermediate surface, and then registers them to
FLAME 2023 via the official MediaPipe-on-FLAME embedding.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import numpy as np

from langerface.config import CANONICAL_OBJ
from langerface.config.constants import TOPOLOGY_ID, TOPOLOGY_VERSION
from langerface.geometry import CanonicalFaceModel
from langerface.lines.atlas import Atlas
from langerface.registration.flame_atlas import (
    DiagramExtractionConfig,
    atlas_points_to_xyz,
    build_registered_atlas,
    diagram_lines_to_canonical_atlas,
    extract_rstl_lines_from_diagram,
    fit_flame_registration,
    load_flame_basis,
    project_to_surface,
)

REPO = Path(__file__).resolve().parents[1]
DEFAULT_DIAGRAM = REPO / "RSTL" / "RSTL PRSgo.png"
DEFAULT_CANONICAL_VERTICES = REPO / "web" / "assets" / "canonical_vertices.json"
DEFAULT_TRIANGLES = REPO / "web" / "assets" / "triangles.json"
DEFAULT_FLAME_BASIS = REPO / "web" / "api" / "flame_basis.npz"
DEFAULT_RSTL_SOURCES = REPO / "RSTL"
DEFAULT_OUT = REPO / "assets" / "atlas_rstl_flame.json"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--diagram", type=Path, default=DEFAULT_DIAGRAM)
    ap.add_argument("--canonical-vertices", type=Path, default=DEFAULT_CANONICAL_VERTICES)
    ap.add_argument("--triangles", type=Path, default=DEFAULT_TRIANGLES)
    ap.add_argument("--flame-basis", type=Path, default=DEFAULT_FLAME_BASIS)
    ap.add_argument("--rstl-sources", type=Path, default=DEFAULT_RSTL_SOURCES)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--candidate-count", type=int, default=96)
    ap.add_argument("--debug-dir", type=Path, default=None)
    args = ap.parse_args()

    extraction_config = DiagramExtractionConfig()
    extraction = extract_rstl_lines_from_diagram(args.diagram, extraction_config)
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    source = diagram_lines_to_canonical_atlas(
        extraction,
        canonical,
        provenance=(
            f"Digitized from classic RSTL diagram {_rel(args.diagram)}; extracted automatically "
            "from local RSTL/ reference material. validated=false; requires clinical review."
        ),
    )
    if args.debug_dir:
        _write_debug_images(args.debug_dir, extraction)

    canonical_vertices = _load_json_array(args.canonical_vertices)
    triangles = _load_json_array(args.triangles).astype(np.int64)
    basis = load_flame_basis(args.flame_basis)

    source_issues = source.validate(
        len(triangles),
        expected_topology_id=TOPOLOGY_ID,
        expected_topology_version=TOPOLOGY_VERSION,
    )
    if source_issues:
        raise SystemExit("source atlas failed validation:\n- " + "\n- ".join(source_issues))

    source_xyz, line_lengths = atlas_points_to_xyz(source, canonical_vertices, triangles)
    registration = fit_flame_registration(canonical_vertices, basis)
    mapped_xyz = registration.transform(source_xyz)
    projection = project_to_surface(
        mapped_xyz,
        basis.vertices,
        basis.faces,
        candidate_count=args.candidate_count,
    )
    out_atlas = build_registered_atlas(source, projection, line_lengths)

    out_data = _atlas_to_json(out_atlas)
    out_data["version"] = "classic-diagram-flame-draft.1"
    out_data["provenance"] = (
        "Draft FLAME registration from the classic frontal RSTL diagram "
        f"{_rel(args.diagram)}. Lines were extracted from the image in RSTL/ and registered by "
        "3D polyharmonic spline from "
        "MediaPipe canonical landmarks to the FLAME 2023 Open MediaPipe embedding, then nearest "
        "FLAME-surface projection. validated=false; requires clinical line-by-line review."
    )
    out_data["registration"] = {
        "method": "classic_rstl_diagram_to_mediapipe_canonical_to_flame-2023",
        "diagramSource": _rel(args.diagram),
        "diagramExtraction": {
            **_config_to_json(extraction.config),
            "lineCount": len(extraction.lines),
            "pointCount": int(sum(line_lengths)),
        },
        "intermediateTopologyId": source.topology_id,
        "intermediateTopologyVersion": source.topology_version,
        "targetTopologyId": out_atlas.topology_id,
        "targetTopologyVersion": out_atlas.topology_version,
        "flameBasis": _rel(args.flame_basis),
        "controlPointCount": int(basis.landmark_indices.shape[0]),
        "lineCount": len(out_atlas.lines),
        "pointCount": int(sum(line_lengths)),
        "surfaceDistance": _distance_summary(projection.squared_distances),
        "classicSourceBundle": _source_manifest(args.rstl_sources),
    }

    tmp = Atlas(
        system=out_atlas.system,
        lines=out_atlas.lines,
        version=out_data["version"],
        topology_id=out_atlas.topology_id,
        topology_version=out_atlas.topology_version,
        provenance=out_data["provenance"],
        validated=False,
    )
    issues = tmp.validate(
        int(basis.faces.shape[0]),
        expected_topology_id=out_atlas.topology_id,
        expected_topology_version=out_atlas.topology_version,
    )
    if issues:
        raise SystemExit("registered atlas failed validation:\n- " + "\n- ".join(issues))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as f:
        json.dump(out_data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(
        f"[ok] {args.out} lines={len(out_atlas.lines)} points={sum(line_lengths)} "
        f"diagram={_rel(args.diagram)} "
        f"mean_surface_dist={out_data['registration']['surfaceDistance']['mean']:.6f}"
    )
    return 0


def _load_json_array(path: Path) -> np.ndarray:
    with path.open(encoding="utf-8") as f:
        return np.asarray(json.load(f), dtype=np.float64)


def _atlas_to_json(atlas: Atlas) -> dict:
    return {
        "system": atlas.system,
        "version": atlas.version,
        "topologyId": atlas.topology_id,
        "topologyVersion": atlas.topology_version,
        "provenance": atlas.provenance,
        "validated": False,
        "lines": [
            {
                "name": line.name,
                "region": line.region,
                "points": [
                    [int(round(p[0])), round(float(p[1]), 6), round(float(p[2]), 6)]
                    for p in line.points
                ],
            }
            for line in atlas.lines
        ],
    }


def _distance_summary(squared: np.ndarray) -> dict:
    dist = np.sqrt(np.asarray(squared, dtype=np.float64))
    return {
        "mean": float(np.mean(dist)),
        "p95": float(np.percentile(dist, 95)),
        "max": float(np.max(dist)),
        "unit": "FLAME model coordinate",
    }


def _source_manifest(path: Path) -> dict:
    if not path.exists():
        return {"path": _rel(path), "exists": False, "files": []}
    files = []
    for item in sorted(path.iterdir(), key=lambda p: p.name.lower()):
        if item.is_file():
            files.append(
                {
                    "name": item.name,
                    "sizeBytes": int(item.stat().st_size),
                    "extension": item.suffix.lower(),
                }
            )
    return {"path": _rel(path), "exists": True, "files": files}


def _config_to_json(cfg: DiagramExtractionConfig) -> dict:
    return {
        "crop": list(cfg.crop),
        "faceBox": [round(float(v), 3) for v in cfg.face_box],
        "darkThreshold": cfg.dark_threshold,
        "grayMin": cfg.gray_min,
        "grayMax": cfg.gray_max,
        "ellipseCenter": list(cfg.ellipse_center),
        "ellipseAxes": list(cfg.ellipse_axes),
        "excludedBoxes": [list(b) for b in cfg.excluded_boxes],
        "minComponentPixels": cfg.min_component_pixels,
        "minComponentExtent": cfg.min_component_extent,
        "binSize": cfg.bin_size,
        "maxPointsPerLine": cfg.max_points_per_line,
        "bridgeMaxGap": cfg.bridge_max_gap,
        "bridgeMaxAngleDeg": cfg.bridge_max_angle_deg,
        "bridgeMaxOppositeAngleDeg": cfg.bridge_max_opposite_angle_deg,
        "bridgeStep": cfg.bridge_step,
    }


def _write_debug_images(path: Path, extraction) -> None:
    import cv2

    path.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path / "classic_rstl_mask.png"), extraction.mask)
    preview = extraction.crop_image.copy()
    for i, line in enumerate(extraction.lines):
        q = line.astype(int)
        color = ((37 * i) % 255, (101 * i) % 255, (193 * i) % 255)
        for a, b in zip(q[:-1], q[1:], strict=False):
            cv2.line(preview, tuple(a), tuple(b), color, 1, cv2.LINE_AA)
    cv2.imwrite(str(path / "classic_rstl_centerlines.png"), preview)


def _rel(path: Path) -> str:
    try:
        return os.path.relpath(path.resolve(), REPO).replace(os.sep, "/")
    except OSError:
        return str(path)


if __name__ == "__main__":
    raise SystemExit(main())
