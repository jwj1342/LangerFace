from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from langerface.config.constants import TOPOLOGY_ID_FLAME, TOPOLOGY_VERSION_FLAME
from langerface.lines.atlas import Atlas
from langerface.registration.flame_atlas import (
    closest_point_on_triangle,
    fit_polyharmonic_map,
    load_flame_basis,
    project_to_surface,
)

ROOT = Path(__file__).resolve().parents[1]


def test_polyharmonic_map_recovers_affine_transform():
    source = np.array(
        [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [1.0, 1.0, 1.0],
        ]
    )
    target = source * np.array([2.0, 3.0, 4.0]) + np.array([0.5, -1.0, 2.0])
    model = fit_polyharmonic_map(source, target, smoothing=1e-10)
    got = model.transform(np.array([[0.25, 0.5, 0.75]]))
    expected = np.array([[1.0, 0.5, 5.0]])
    assert np.allclose(got, expected, atol=1e-8)


def test_closest_point_on_triangle_returns_projected_barycentric_coordinates():
    q, bary = closest_point_on_triangle(
        np.array([0.25, 0.25, 1.0]),
        np.array([0.0, 0.0, 0.0]),
        np.array([1.0, 0.0, 0.0]),
        np.array([0.0, 1.0, 0.0]),
    )
    assert np.allclose(q, [0.25, 0.25, 0.0])
    assert np.allclose(bary, [0.5, 0.25, 0.25])


def test_project_to_surface_encodes_atlas_barycentric_contract():
    verts = np.array(
        [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [3.0, 3.0, 0.0],
        ]
    )
    faces = np.array([[0, 1, 2], [1, 3, 2]])
    projection = project_to_surface(np.array([[0.2, 0.3, 0.4]]), verts, faces, candidate_count=2)
    assert projection.triangle_indices.tolist() == [0]
    assert np.allclose(projection.barycentric[0], [0.5, 0.2, 0.3])
    assert np.allclose(projection.points[0], [0.2, 0.3, 0.0])


def test_committed_flame_rstl_atlas_matches_flame_topology():
    atlas_path = ROOT / "assets" / "atlas_rstl_flame.json"
    assert atlas_path.exists()

    basis = load_flame_basis(ROOT / "web" / "api" / "flame_basis.npz")
    atlas = Atlas.load(str(atlas_path))
    assert atlas.topology_id == TOPOLOGY_ID_FLAME
    assert atlas.topology_version == TOPOLOGY_VERSION_FLAME
    assert atlas.validated is False
    assert not atlas.validate(
        int(basis.faces.shape[0]),
        expected_topology_id=TOPOLOGY_ID_FLAME,
        expected_topology_version=TOPOLOGY_VERSION_FLAME,
    )

    with atlas_path.open(encoding="utf-8") as f:
        data = json.load(f)
    reg = data["registration"]
    assert reg["diagramSource"] == "RSTL/RSTL PRSgo.png"
    assert "sourceAtlas" not in reg
    assert reg["diagramExtraction"]["lineCount"] == len(atlas.lines)
    assert 80 <= reg["diagramExtraction"]["lineCount"] <= 130
    assert reg["diagramExtraction"]["pointCount"] == sum(len(line.points) for line in atlas.lines)
    assert reg["diagramExtraction"]["pointCount"] >= 2400
    assert reg["diagramExtraction"]["bridgeMaxGap"] > 0
    assert data["registration"]["classicSourceBundle"]["path"] == "RSTL"
    assert data["registration"]["classicSourceBundle"]["files"]
