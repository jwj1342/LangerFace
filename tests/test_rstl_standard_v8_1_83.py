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
from langerface.rendering.occlusion import BackfaceCuller  # noqa: E402
from test_rstl_standard_v8_1_70 import _atlas_payload, _normalized_lines  # noqa: E402
from test_rstl_standard_v8_1_76 import _new_crossings_relative_to_baseline  # noqa: E402
from test_rstl_standard_v8_1_79 import _visible_curves_intersect  # noqa: E402

EXPECTED_LINE_COUNT = 198
EXPECTED_POINT_COUNT = 18_546
TARGET_REGION = "lateral_canthus_short_arc_v65"
TARGET_SOURCE_INDICES = {162, 163, 164, 165, 189}
EXPECTED_CHANGED_NAMES = {
    f"standard_field_{source_index:04d}_{side}"
    for source_index in TARGET_SOURCE_INDICES
    for side in ("right", "left")
}
EXPECTED_RIGHT_ENDPOINTS = {
    162: ((0.02536133, 0.33959522), (0.18208276, 0.30616066)),
    163: ((0.02724463, 0.35130943), (0.18429380, 0.31326194)),
    189: ((0.02823385, 0.35754889), (0.18595273, 0.31715107)),
    164: ((0.02922307, 0.36378835), (0.18761166, 0.32104020)),
    165: ((0.03568015, 0.37606463), (0.19123276, 0.32771086)),
}
EXPECTED_HIDDEN_FRAME_2_CROSSINGS = {
    ("standard_field_0094_right", "standard_field_0163_right"),
    ("standard_field_0094_right", "standard_field_0189_right"),
    ("standard_field_0104_cross", "standard_field_0162_right"),
    ("standard_field_0149_cross", "standard_field_0163_right"),
    ("standard_field_0149_cross", "standard_field_0189_right"),
    ("standard_field_0150_right", "standard_field_0164_right"),
    ("standard_field_0162_right", "standard_field_0190_cross"),
}


def _oriented(points: np.ndarray) -> np.ndarray:
    return points if points[0, 0] <= points[-1, 0] else points[::-1]


def _turning_angles(points: np.ndarray) -> np.ndarray:
    segments = np.diff(_oriented(points)[:, :2], axis=0)
    return np.diff(np.unwrap(np.arctan2(segments[:, 1], segments[:, 0])))


def test_v8_1_83_reflows_endpoints_and_globally_fairs_lateral_canthus_only(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v82_path = ROOT / "assets" / "rstl_standard_reference_v8_1_82.json"
    v83_path = ROOT / "assets" / "rstl_standard_reference_v8_1_83.json"
    v82_payload = _atlas_payload(canonical, v82_path, tmp_path / "atlas_v82.json")
    v83_payload = _atlas_payload(canonical, v83_path, tmp_path / "atlas_v83.json")
    assert v83_payload["atlasVersion"] == "8.1.83"
    assert v83_payload["validated"] is False
    assert len(v83_payload["lines"]) == EXPECTED_LINE_COUNT
    assert sum(len(line["points"]) for line in v83_payload["lines"]) == EXPECTED_POINT_COUNT

    old_lines = {line["name"]: line for line in v82_payload["lines"]}
    new_lines = {line["name"]: line for line in v83_payload["lines"]}
    changed_names = {name for name in new_lines if new_lines[name] != old_lines[name]}
    assert changed_names == EXPECTED_CHANGED_NAMES
    for name in set(new_lines) - changed_names:
        assert new_lines[name] == old_lines[name]
    for name in changed_names:
        assert new_lines[name]["region"] == TARGET_REGION
        assert len(new_lines[name]["points"]) == len(old_lines[name]["points"])
        assert old_lines[name]["postMapSmoothingPasses"] == 24
        assert old_lines[name].get("postMapCubicFairing") is None
        assert new_lines[name]["postMapSmoothingPasses"] == 32
        assert new_lines[name]["postMapCubicFairing"] is True

    old_atlas = Atlas.load(str(tmp_path / "atlas_v82.json"))
    new_atlas = Atlas.load(str(tmp_path / "atlas_v83.json"))
    old_normalized = _normalized_lines(canonical, old_atlas)
    new_normalized = _normalized_lines(canonical, new_atlas)
    assert not _new_crossings_relative_to_baseline(
        old_normalized,
        new_normalized,
        changed_names,
    )

    for source_index in TARGET_SOURCE_INDICES:
        right_name = f"standard_field_{source_index:04d}_right"
        left_name = f"standard_field_{source_index:04d}_left"
        right = _oriented(new_normalized[right_name])
        mirrored = right.copy()
        mirrored[:, 0] = 1.0 - mirrored[:, 0]
        np.testing.assert_allclose(mirrored, new_normalized[left_name], atol=1e-6, rtol=0.0)
        np.testing.assert_allclose(
            right[[0, -1]],
            np.asarray(EXPECTED_RIGHT_ENDPOINTS[source_index]),
            atol=2e-5,
            rtol=0.0,
        )
        old_right = _oriented(old_normalized[right_name])
        assert right[0, 1] > old_right[0, 1]
        assert right[-1, 0] < old_right[-1, 0]
        assert right[-1, 1] > old_right[-1, 1]

    frames = json.loads((ROOT / "web/test/expected.json").read_text(encoding="utf-8"))["frames"]
    for frame_index, frame in enumerate(frames):
        landmarks = np.asarray(frame["landmarks"], dtype=np.float64)
        old_mapped = {
            line.name: line
            for line in map_atlas(old_atlas, landmarks, canonical.triangles)
        }
        new_mapped = {
            line.name: line
            for line in map_atlas(new_atlas, landmarks, canonical.triangles)
        }
        crossings = _new_crossings_relative_to_baseline(
            {name: line.pts for name, line in old_mapped.items()},
            {name: line.pts for name, line in new_mapped.items()},
            changed_names,
        )
        if frame_index < 2:
            assert not crossings
        else:
            assert crossings == EXPECTED_HIDDEN_FRAME_2_CROSSINGS
            visible = BackfaceCuller(canonical.triangles).visible_triangles(landmarks)
            for first_name, second_name in crossings:
                assert not _visible_curves_intersect(
                    new_mapped[first_name],
                    new_mapped[second_name],
                    visible,
                )
        for name in changed_names:
            turns = _turning_angles(new_mapped[name].pts)
            significant = turns[np.abs(turns) > 1e-5]
            assert len(significant) >= 3
            assert np.all(significant <= 0.0) or np.all(significant >= 0.0)
            assert np.max(np.abs(np.diff(turns))) < np.deg2rad(2.0)
