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
from test_rstl_standard_v8_1_76 import _new_crossings_relative_to_baseline  # noqa: E402

EXPECTED_LINE_COUNT = 190
EXPECTED_POINT_COUNT = 18_258
TARGET_REGION = "supraorbital_medial_short_arc_v69"
TARGET_SOURCE_INDICES = {170, 171, 172, 173}
EXPECTED_CHANGED_NAMES = {
    f"standard_field_{source_index:04d}_{side}"
    for source_index in TARGET_SOURCE_INDICES
    for side in ("right", "left")
}
EXPECTED_RIGHT_ENDPOINTS = {
    170: ((0.27802357, 0.17537155), (0.28886528, 0.13833661)),
    171: ((0.32395078, 0.16780453), (0.32761016, 0.12977303)),
    172: ((0.35407048, 0.17200927), (0.36420109, 0.12738149)),
    173: ((0.38103080, 0.17213136), (0.38997888, 0.13549884)),
}


def test_v8_1_85_moves_only_four_blue_guided_arcs_above_brows(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v84_path = ROOT / "assets" / "rstl_standard_reference_v8_1_84.json"
    v85_path = ROOT / "assets" / "rstl_standard_reference_v8_1_85.json"
    v84_payload = _atlas_payload(canonical, v84_path, tmp_path / "atlas_v84.json")
    v85_payload = _atlas_payload(canonical, v85_path, tmp_path / "atlas_v85.json")
    assert v85_payload["atlasVersion"] == "8.1.85"
    assert v85_payload["validated"] is False
    assert len(v85_payload["lines"]) == EXPECTED_LINE_COUNT
    assert sum(len(line["points"]) for line in v85_payload["lines"]) == EXPECTED_POINT_COUNT

    old_lines = {line["name"]: line for line in v84_payload["lines"]}
    new_lines = {line["name"]: line for line in v85_payload["lines"]}
    changed_names = {name for name in new_lines if new_lines[name] != old_lines[name]}
    assert changed_names == EXPECTED_CHANGED_NAMES
    for name in set(new_lines) - changed_names:
        assert new_lines[name] == old_lines[name]
    for name in changed_names:
        assert new_lines[name]["region"] == TARGET_REGION
        assert len(new_lines[name]["points"]) == len(old_lines[name]["points"])

    old_atlas = Atlas.load(str(tmp_path / "atlas_v84.json"))
    new_atlas = Atlas.load(str(tmp_path / "atlas_v85.json"))
    old_normalized = _normalized_lines(canonical, old_atlas)
    new_normalized = _normalized_lines(canonical, new_atlas)
    canonical_crossings = _new_crossings_relative_to_baseline(
        old_normalized,
        new_normalized,
        changed_names,
    )
    assert len(canonical_crossings) == 40
    for first_name, second_name in canonical_crossings:
        target_names = {first_name, second_name} & changed_names
        assert len(target_names) == 1
        static_name = next(iter({first_name, second_name} - changed_names))
        assert old_lines[static_name]["region"] == "forehead_bridge_arc_v15"

    for source_index in TARGET_SOURCE_INDICES:
        right_name = f"standard_field_{source_index:04d}_right"
        left_name = f"standard_field_{source_index:04d}_left"
        right = new_normalized[right_name]
        mirrored = right.copy()
        mirrored[:, 0] = 1.0 - mirrored[:, 0]
        np.testing.assert_allclose(mirrored, new_normalized[left_name], atol=1e-6, rtol=0.0)
        np.testing.assert_allclose(
            right[[0, -1]],
            np.asarray(EXPECTED_RIGHT_ENDPOINTS[source_index]),
            atol=2e-5,
            rtol=0.0,
        )
        assert np.max(right[:, 1]) < np.min(old_normalized[right_name][:, 1])

    frames = json.loads((ROOT / "web/test/expected.json").read_text(encoding="utf-8"))["frames"]
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
        assert len(mapped_crossings) == 0
        for first_name, second_name in mapped_crossings:
            target_names = {first_name, second_name} & changed_names
            assert len(target_names) == 1
            static_name = next(iter({first_name, second_name} - changed_names))
            assert old_lines[static_name]["region"] == "forehead_bridge_arc_v15"
