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
from test_rstl_standard_v8_1_70 import _atlas_payload, _normalized_lines  # noqa: E402
from test_rstl_standard_v8_1_75 import _curves_intersect, _has_self_intersection  # noqa: E402
from test_rstl_standard_v8_1_76 import _new_crossings_relative_to_baseline  # noqa: E402

EXPECTED_LINE_COUNT = 190
EXPECTED_POINT_COUNT = 18_258
TARGET_REGION = "supraorbital_medial_short_arc_v69"
TARGET_SOURCE_INDICES = set(range(170, 175))
EXPECTED_CHANGED_NAMES = {
    f"standard_field_{source_index:04d}_{side}"
    for source_index in TARGET_SOURCE_INDICES
    for side in ("right", "left")
}
EXPECTED_POINT_COUNTS = {170: 13, 171: 15, 172: 13, 173: 15, 174: 13}
EXPECTED_RIGHT_ENDPOINTS = {
    170: ((0.33022687, 0.16992551), (0.34029564, 0.11889115)),
    171: ((0.34695715, 0.16807539), (0.36044397, 0.11654325)),
    172: ((0.36494020, 0.17149350), (0.37758166, 0.11494451)),
    173: ((0.38185873, 0.17647242), (0.39223393, 0.11288267)),
    174: ((0.39384753, 0.17575120), (0.40654285, 0.11741626)),
}
EXPECTED_CANONICAL_CROSSINGS = 38
EXPECTED_MAPPED_CROSSINGS = (0, 0, 0)


def test_v8_1_86_keeps_all_five_transition_arcs_above_brows(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v85_path = ROOT / "assets/rstl_standard_reference_v8_1_85.json"
    v86_path = ROOT / "assets/rstl_standard_reference_v8_1_86.json"
    v85_payload = _atlas_payload(canonical, v85_path, tmp_path / "atlas_v85.json")
    v86_payload = _atlas_payload(canonical, v86_path, tmp_path / "atlas_v86.json")
    assert v86_payload["atlasVersion"] == "8.1.86"
    assert v86_payload["validated"] is False
    assert len(v86_payload["lines"]) == EXPECTED_LINE_COUNT
    assert sum(len(line["points"]) for line in v86_payload["lines"]) == EXPECTED_POINT_COUNT

    old_lines = {line["name"]: line for line in v85_payload["lines"]}
    new_lines = {line["name"]: line for line in v86_payload["lines"]}
    changed_names = {name for name in new_lines if new_lines[name] != old_lines[name]}
    assert changed_names == EXPECTED_CHANGED_NAMES
    for name in set(new_lines) - changed_names:
        assert new_lines[name] == old_lines[name]

    old_atlas = Atlas.load(str(tmp_path / "atlas_v85.json"))
    new_atlas = Atlas.load(str(tmp_path / "atlas_v86.json"))
    old_normalized = _normalized_lines(canonical, old_atlas)
    new_normalized = _normalized_lines(canonical, new_atlas)

    for source_index in sorted(TARGET_SOURCE_INDICES):
        right_name = f"standard_field_{source_index:04d}_right"
        left_name = f"standard_field_{source_index:04d}_left"
        right = new_normalized[right_name]
        left = new_normalized[left_name]
        assert new_lines[right_name]["region"] == TARGET_REGION
        assert len(right) == EXPECTED_POINT_COUNTS[source_index]
        assert len(left) == EXPECTED_POINT_COUNTS[source_index]
        np.testing.assert_allclose(
            right[[0, -1]],
            np.asarray(EXPECTED_RIGHT_ENDPOINTS[source_index]),
            atol=2e-5,
            rtol=0.0,
        )
        mirrored = right.copy()
        mirrored[:, 0] = 1.0 - mirrored[:, 0]
        np.testing.assert_allclose(mirrored, left, atol=1e-6, rtol=0.0)

        # Each strand bends laterally at the brow end, then becomes nearly vertical.
        start_delta = right[1] - right[0]
        end_delta = right[-1] - right[-2]
        start_horizontal_ratio = abs(start_delta[0] / start_delta[1])
        end_horizontal_ratio = abs(end_delta[0] / end_delta[1])
        assert start_horizontal_ratio > 0.45
        assert end_horizontal_ratio < 0.07
        assert int(np.argmax(right[:, 1])) == 0

        assert not _has_self_intersection(right)

    target_names = sorted(EXPECTED_CHANGED_NAMES)
    for first_index, first_name in enumerate(target_names):
        for second_name in target_names[first_index + 1 :]:
            assert not _curves_intersect(
                new_normalized[first_name], new_normalized[second_name]
            )

    canonical_crossings = _new_crossings_relative_to_baseline(
        old_normalized,
        new_normalized,
        changed_names,
    )
    assert len(canonical_crossings) == EXPECTED_CANONICAL_CROSSINGS
    for first_name, second_name in canonical_crossings:
        target_names_in_pair = {first_name, second_name} & changed_names
        assert len(target_names_in_pair) == 1
        static_name = next(iter({first_name, second_name} - changed_names))
        assert old_lines[static_name]["region"] == "forehead_bridge_arc_v15"

    frames = json.loads((ROOT / "web/test/expected.json").read_text(encoding="utf-8"))["frames"]
    forehead_names = {
        line.name
        for line in new_atlas.lines
        if line.region == "forehead_bridge_arc_v15"
    }
    for frame_index, frame in enumerate(frames):
        landmarks = np.asarray(frame["landmarks"], dtype=np.float64)
        old_mapped = {
            line.name: line.pts
            for line in map_atlas(old_atlas, landmarks, canonical.triangles)
        }
        new_mapped = {
            line.name: line.pts
            for line in map_atlas(new_atlas, landmarks, canonical.triangles)
        }
        mapped_crossings = _new_crossings_relative_to_baseline(
            old_mapped,
            new_mapped,
            changed_names,
        )
        assert len(mapped_crossings) == EXPECTED_MAPPED_CROSSINGS[frame_index]
        for target_name in changed_names:
            for forehead_name in forehead_names:
                assert not _curves_intersect(
                    new_mapped[target_name], new_mapped[forehead_name]
                )
