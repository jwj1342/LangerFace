from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / "tests"
if str(TESTS) not in sys.path:
    sys.path.insert(0, str(TESTS))

from langerface.config import CANONICAL_OBJ  # noqa: E402
from langerface.geometry import CanonicalFaceModel  # noqa: E402
from langerface.lines import Atlas, map_atlas  # noqa: E402
from test_rstl_standard_v8_1_70 import _atlas_payload, _normalized_lines  # noqa: E402

PREVIOUS_LINE_COUNT = 159
EXPECTED_LINE_COUNT = 206
EXPECTED_POINT_COUNT = 18_639
EXPECTED_REGION_ADDITIONS = {
    "cheek_gap_density_v53": 2,
    "cheek_long_arc_fan_v24": 6,
    "cheek_lower_divergent_arc_v44": 2,
    "cheek_nasal_transition_density_v56": 2,
    "chin": 8,
    "forehead_bridge_arc_v15": 4,
    "lateral_canthus_short_arc_v65": 2,
    "nose_root_cross_v9": 1,
    "orbital_brow_upturn_v11": 4,
    "perioral_commissure_radial_v50": 4,
    "perioral_commissure_swirl_v49": 4,
    "philtrum_nasal_base_v10": 4,
    "supraorbital_medial_short_arc_v69": 4,
}


def _cross(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return a[..., 0] * b[..., 1] - a[..., 1] * b[..., 0]


def _curves_intersect(first: np.ndarray, second: np.ndarray) -> bool:
    first_start = first[:-1, None, :2]
    first_end = first[1:, None, :2]
    second_start = second[None, :-1, :2]
    second_end = second[None, 1:, :2]
    first_side_a = _cross(first_end - first_start, second_start - first_start)
    first_side_b = _cross(first_end - first_start, second_end - first_start)
    second_side_a = _cross(second_end - second_start, first_start - second_start)
    second_side_b = _cross(second_end - second_start, first_end - second_start)
    return bool(
        np.any(
            (first_side_a * first_side_b < -1e-12)
            & (second_side_a * second_side_b < -1e-12)
        )
    )


def _has_self_intersection(points: np.ndarray) -> bool:
    start = points[:-1, None, :2]
    end = points[1:, None, :2]
    other_start = points[None, :-1, :2]
    other_end = points[None, 1:, :2]
    first_side_a = _cross(end - start, other_start - start)
    first_side_b = _cross(end - start, other_end - start)
    second_side_a = _cross(other_end - other_start, start - other_start)
    second_side_b = _cross(other_end - other_start, end - other_start)
    nonadjacent = np.triu(np.ones((len(points) - 1, len(points) - 1), dtype=bool), 2)
    return bool(
        np.any(
            nonadjacent
            & (first_side_a * first_side_b < -1e-12)
            & (second_side_a * second_side_b < -1e-12)
        )
    )


def _new_crossings(
    curves: dict[str, np.ndarray],
    added_names: set[str],
) -> set[tuple[str, str]]:
    crossings: set[tuple[str, str]] = set()
    for name in sorted(added_names):
        if _has_self_intersection(curves[name]):
            crossings.add((name, name))
        for other_name, other_points in curves.items():
            if other_name == name or (other_name in added_names and other_name < name):
                continue
            if _curves_intersect(curves[name], other_points):
                crossings.add(tuple(sorted((name, other_name))))
    return crossings


def test_v8_1_75_increases_whole_face_density_without_new_crossings(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v74_path = ROOT / "assets" / "rstl_standard_reference_v8_1_74.json"
    v75_path = ROOT / "assets" / "rstl_standard_reference_v8_1_75.json"
    v74_payload = _atlas_payload(canonical, v74_path, tmp_path / "atlas_v74.json")
    v75_payload = _atlas_payload(canonical, v75_path, tmp_path / "atlas_v75.json")
    assert json.loads(v75_path.read_text(encoding="utf-8"))["atlasVersion"] == "8.1.75"
    assert v75_payload["atlasVersion"] == "8.1.75"
    assert v75_payload["validated"] is False
    assert len(v75_payload["lines"]) == EXPECTED_LINE_COUNT
    assert sum(len(line["points"]) for line in v75_payload["lines"]) == EXPECTED_POINT_COUNT
    assert v75_payload["lines"][:PREVIOUS_LINE_COUNT] == v74_payload["lines"]

    old_regions = Counter(line["region"] for line in v74_payload["lines"])
    new_regions = Counter(line["region"] for line in v75_payload["lines"])
    additions = {
        region: new_regions[region] - old_regions[region]
        for region in new_regions
        if new_regions[region] != old_regions[region]
    }
    assert additions == EXPECTED_REGION_ADDITIONS

    atlas = Atlas.load(str(tmp_path / "atlas_v75.json"))
    assert not atlas.validate(len(canonical.triangles))
    added_names = {line.name for line in atlas.lines[PREVIOUS_LINE_COUNT:]}
    assert len(added_names) == EXPECTED_LINE_COUNT - PREVIOUS_LINE_COUNT
    assert len({line.name for line in atlas.lines}) == EXPECTED_LINE_COUNT

    normalized = _normalized_lines(canonical, atlas)
    for name in sorted(added_names):
        if name.endswith("_right"):
            left_name = f"{name[:-6]}_left"
            mirrored = normalized[name].copy()
            mirrored[:, 0] = 1.0 - mirrored[:, 0]
            np.testing.assert_allclose(mirrored, normalized[left_name], atol=1e-6, rtol=0.0)
        elif name.endswith("_cross"):
            mirrored = normalized[name][::-1].copy()
            mirrored[:, 0] = 1.0 - mirrored[:, 0]
            np.testing.assert_allclose(mirrored, normalized[name], atol=1e-6, rtol=0.0)
    assert not _new_crossings(normalized, added_names)

    landmarks = np.asarray(
        json.loads((ROOT / "web" / "test" / "expected.json").read_text())["frames"][0][
            "landmarks"
        ],
        dtype=np.float64,
    )
    mapped = {
        line.name: line.pts[:, :2]
        for line in map_atlas(atlas, landmarks, canonical.triangles)
    }
    assert not _new_crossings(mapped, added_names)

    faired_additions = {
        line.name: line.post_map_smoothing_passes
        for line in atlas.lines[PREVIOUS_LINE_COUNT:]
        if line.post_map_smoothing_passes
    }
    assert faired_additions == {
        "standard_field_0189_right": 12,
        "standard_field_0189_left": 12,
    }
