from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / "tests"
if str(TESTS) not in sys.path:
    sys.path.insert(0, str(TESTS))

from langerface.config import CANONICAL_OBJ  # noqa: E402
from langerface.geometry import CanonicalFaceModel  # noqa: E402
from langerface.lines import Atlas, map_atlas  # noqa: E402
from test_rstl_standard_v8_1_70 import (  # noqa: E402
    _atlas_payload,
    _crossing_pairs,
    _segments_intersect,
)

REGION = "lateral_canthus_short_arc_v65"
FAIRED_LINES = {
    f"standard_field_{index:04d}_{side}"
    for index in range(162, 166)
    for side in ("right", "left")
}


def _maximum_turn_degrees(points: np.ndarray) -> float:
    segments = np.diff(points[:, :2], axis=0)
    angles = np.unwrap(np.arctan2(segments[:, 1], segments[:, 0]))
    return float(np.max(np.abs(np.diff(angles))) * 180.0 / np.pi)


def _has_self_intersection(points: np.ndarray) -> bool:
    for first in range(len(points) - 1):
        for second in range(first + 2, len(points) - 1):
            if _segments_intersect(
                points[first], points[first + 1], points[second], points[second + 1]
            ):
                return True
    return False


def test_v8_1_74_fairs_only_mapped_lateral_canthus_arcs(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v73_path = ROOT / "assets" / "rstl_standard_reference_v8_1_73.json"
    v74_path = ROOT / "assets" / "rstl_standard_reference_v8_1_74.json"
    v73_payload = _atlas_payload(canonical, v73_path, tmp_path / "atlas_v73.json")
    v74_payload = _atlas_payload(canonical, v74_path, tmp_path / "atlas_v74.json")

    assert v74_payload["atlasVersion"] == "8.1.74"
    assert len(v74_payload["lines"]) == 159
    assert sum(len(line["points"]) for line in v74_payload["lines"]) == 15_222

    v73_by_name = {line["name"]: line for line in v73_payload["lines"]}
    v74_by_name = {line["name"]: line for line in v74_payload["lines"]}
    assert set(v73_by_name) == set(v74_by_name)
    assert all(
        v74_by_name[name]["points"] == v73_by_name[name]["points"]
        for name in v73_by_name
    )
    assert {
        line["name"] for line in v74_payload["lines"] if line.get("postMapSmoothingPasses")
    } == FAIRED_LINES
    for name in FAIRED_LINES:
        assert v74_by_name[name]["region"] == REGION
        assert v74_by_name[name]["postMapSmoothingPasses"] == 12

    landmarks = np.asarray(
        json.loads((ROOT / "web" / "test" / "expected.json").read_text())["frames"][0][
            "landmarks"
        ],
        dtype=np.float64,
    )
    mapped_v73 = {
        line.name: line
        for line in map_atlas(
            Atlas.load(str(tmp_path / "atlas_v73.json")), landmarks, canonical.triangles
        )
    }
    mapped_v74 = {
        line.name: line
        for line in map_atlas(
            Atlas.load(str(tmp_path / "atlas_v74.json")), landmarks, canonical.triangles
        )
    }
    for name in FAIRED_LINES:
        old_points = mapped_v73[name].pts
        new_points = mapped_v74[name].pts
        np.testing.assert_array_equal(new_points[[0, -1]], old_points[[0, -1]])
        assert _maximum_turn_degrees(new_points) < 13.0
        assert _maximum_turn_degrees(new_points) < 0.35 * _maximum_turn_degrees(old_points)
        assert not _has_self_intersection(new_points)

    mapped_v73_points = {name: line.pts[:, :2] for name, line in mapped_v73.items()}
    mapped_v74_points = {name: line.pts[:, :2] for name, line in mapped_v74.items()}
    face_span = float(np.ptp(np.vstack(list(mapped_v74_points.values())), axis=0).max())
    crossing_cell_size = max(face_span * 0.025, 1e-6)
    assert _crossing_pairs(
        mapped_v74_points, cell_size=crossing_cell_size
    ) == _crossing_pairs(mapped_v73_points, cell_size=crossing_cell_size)
