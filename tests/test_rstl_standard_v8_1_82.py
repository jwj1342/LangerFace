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

EXPECTED_LINE_COUNT = 198
EXPECTED_POINT_COUNT = 18_546
TARGET_REGION = "lateral_canthus_short_arc_v65"
TARGET_SOURCE_INDICES = {162, 163, 164, 165, 189}
EXPECTED_CHANGED_NAMES = {
    f"standard_field_{source_index:04d}_{side}"
    for source_index in TARGET_SOURCE_INDICES
    for side in ("right", "left")
}


def _oriented(points: np.ndarray) -> np.ndarray:
    return points if points[0, 0] <= points[-1, 0] else points[::-1]


def _late_to_early_rise_ratio(points: np.ndarray) -> float:
    points = _oriented(points)
    sample_x = float(points[0, 0] + 0.55 * (points[-1, 0] - points[0, 0]))
    middle_y = float(np.interp(sample_x, points[:, 0], points[:, 1]))
    early_rise = float(points[0, 1] - middle_y)
    late_rise = float(middle_y - points[-1, 1])
    return late_rise / max(early_rise, 1e-12)


def _terminal_slope(points: np.ndarray) -> float:
    points = _oriented(points)
    delta = points[-1, :2] - points[-2, :2]
    return abs(float(delta[1])) / max(abs(float(delta[0])), 1e-12)


def _chord_sag_fraction(points: np.ndarray) -> float:
    points = _oriented(points)
    span_x = float(points[-1, 0] - points[0, 0])
    rise = float(points[0, 1] - points[-1, 1])
    sample_x = float(points[0, 0] + 0.55 * span_x)
    curve_y = float(np.interp(sample_x, points[:, 0], points[:, 1]))
    chord_y = float(points[0, 1] - 0.55 * rise)
    return (curve_y - chord_y) / max(rise, 1e-12)


def test_v8_1_82_strengthens_lateral_canthus_upward_arc_only(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v81_path = ROOT / "assets" / "rstl_standard_reference_v8_1_81.json"
    v82_path = ROOT / "assets" / "rstl_standard_reference_v8_1_82.json"
    v81_payload = _atlas_payload(canonical, v81_path, tmp_path / "atlas_v81.json")
    v82_payload = _atlas_payload(canonical, v82_path, tmp_path / "atlas_v82.json")
    assert v82_payload["atlasVersion"] == "8.1.82"
    assert v82_payload["validated"] is False
    assert len(v82_payload["lines"]) == EXPECTED_LINE_COUNT
    assert sum(len(line["points"]) for line in v82_payload["lines"]) == EXPECTED_POINT_COUNT

    old_lines = {line["name"]: line for line in v81_payload["lines"]}
    new_lines = {line["name"]: line for line in v82_payload["lines"]}
    changed_names = {name for name in new_lines if new_lines[name] != old_lines[name]}
    assert changed_names == EXPECTED_CHANGED_NAMES
    for name in set(new_lines) - changed_names:
        assert new_lines[name] == old_lines[name]
    for name in changed_names:
        assert new_lines[name]["region"] == TARGET_REGION
        assert new_lines[name]["points"][0] == old_lines[name]["points"][0]
        assert new_lines[name]["points"][-1] == old_lines[name]["points"][-1]
        assert old_lines[name]["postMapSmoothingPasses"] == 24
        assert new_lines[name]["postMapSmoothingPasses"] == 24

    old_atlas = Atlas.load(str(tmp_path / "atlas_v81.json"))
    new_atlas = Atlas.load(str(tmp_path / "atlas_v82.json"))
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
        assert np.all(np.diff(right[:, 1]) <= 1e-6)
        old_ratio = _late_to_early_rise_ratio(old_normalized[right_name])
        new_ratio = _late_to_early_rise_ratio(right)
        assert old_ratio > 1.20
        assert new_ratio > old_ratio + 1.00
        assert _chord_sag_fraction(right) >= 1.75 * _chord_sag_fraction(
            old_normalized[right_name]
        )
        assert _terminal_slope(right) >= 1.75 * _terminal_slope(
            old_normalized[right_name]
        )

    frames = json.loads((ROOT / "web/test/expected.json").read_text(encoding="utf-8"))["frames"]
    for frame in frames:
        landmarks = np.asarray(frame["landmarks"], dtype=np.float64)
        old_mapped = {
            line.name: line.pts
            for line in map_atlas(old_atlas, landmarks, canonical.triangles)
        }
        new_mapped = {
            line.name: line.pts
            for line in map_atlas(new_atlas, landmarks, canonical.triangles)
        }
        assert not _new_crossings_relative_to_baseline(
            old_mapped,
            new_mapped,
            changed_names,
        )
        for name in changed_names:
            np.testing.assert_array_equal(
                new_mapped[name][[0, -1]],
                old_mapped[name][[0, -1]],
            )
