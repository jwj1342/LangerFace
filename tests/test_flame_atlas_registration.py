from __future__ import annotations

from pathlib import Path

import numpy as np

from langerface.registration.flame_atlas import (
    closest_point_on_triangle,
    fit_polyharmonic_map,
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


def test_flame_rstl_atlas_is_generated_outside_committed_assets():
    register_script = (ROOT / "tools" / "register_rstl_atlas_to_flame.py").read_text()
    gitignore = (ROOT / ".gitignore").read_text()
    assert 'DEFAULT_OUT = REPO / "local_outputs" / "atlas_rstl_flame.json"' in register_script
    assert "assets/atlas_rstl_flame.json" in gitignore
    assert not (ROOT / "assets" / "atlas_rstl_flame.json").exists()
