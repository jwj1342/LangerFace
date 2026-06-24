"""Register the project RSTL atlas onto FLAME 2023 topology.

The local ``RSTL/`` directory is treated as a provenance bundle for the classic
RSTL diagrams. The machine-readable source is ``assets/atlas_rstl.json``, which
is already encoded as MediaPipe ``[tri, u, v]`` lines.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import numpy as np

from langerface.config.constants import TOPOLOGY_ID, TOPOLOGY_VERSION
from langerface.lines.atlas import Atlas
from langerface.registration.flame_atlas import (
    atlas_points_to_xyz,
    build_registered_atlas,
    fit_flame_registration,
    load_flame_basis,
    project_to_surface,
)

REPO = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_ATLAS = REPO / "assets" / "atlas_rstl.json"
DEFAULT_CANONICAL_VERTICES = REPO / "web" / "assets" / "canonical_vertices.json"
DEFAULT_TRIANGLES = REPO / "web" / "assets" / "triangles.json"
DEFAULT_FLAME_BASIS = REPO / "web" / "api" / "flame_basis.npz"
DEFAULT_RSTL_SOURCES = REPO / "RSTL"
DEFAULT_OUT = REPO / "assets" / "atlas_rstl_flame.json"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source-atlas", type=Path, default=DEFAULT_SOURCE_ATLAS)
    ap.add_argument("--canonical-vertices", type=Path, default=DEFAULT_CANONICAL_VERTICES)
    ap.add_argument("--triangles", type=Path, default=DEFAULT_TRIANGLES)
    ap.add_argument("--flame-basis", type=Path, default=DEFAULT_FLAME_BASIS)
    ap.add_argument("--rstl-sources", type=Path, default=DEFAULT_RSTL_SOURCES)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--candidate-count", type=int, default=96)
    args = ap.parse_args()

    source = Atlas.load(str(args.source_atlas))
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
    out_data["version"] = f"{source.version}-flame-draft.1"
    out_data["provenance"] = (
        "Draft FLAME registration of the project RSTL atlas. Source atlas: "
        f"{_rel(args.source_atlas)} ({source.topology_id}/{source.topology_version}); "
        "classic RSTL reference bundle: RSTL/; registration: 3D polyharmonic spline from "
        "MediaPipe canonical landmarks to the FLAME 2023 Open MediaPipe embedding, then nearest "
        "FLAME-surface projection. validated=false; requires clinical line-by-line review."
    )
    out_data["registration"] = {
        "method": "mediapipe-canonical-to-flame-2023 polyharmonic_r3 + nearest_surface_projection",
        "sourceAtlas": _rel(args.source_atlas),
        "sourceTopologyId": source.topology_id,
        "sourceTopologyVersion": source.topology_version,
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


def _rel(path: Path) -> str:
    try:
        return os.path.relpath(path.resolve(), REPO).replace(os.sep, "/")
    except OSError:
        return str(path)


if __name__ == "__main__":
    raise SystemExit(main())
