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
from langerface.lines import Atlas  # noqa: E402
from test_rstl_standard_v8_1_70 import (  # noqa: E402
    _atlas_payload,
    _crossing_pairs,
    _normalized_lines,
    _segments_intersect,
)

REGION = "lateral_canthus_short_arc_v65"
SMOOTHED_LINES = {
    f"standard_field_{index:04d}_{side}"
    for index in range(162, 166)
    for side in ("right", "left")
}


def _has_self_intersection(points: np.ndarray) -> bool:
    for first in range(len(points) - 1):
        for second in range(first + 2, len(points) - 1):
            if _segments_intersect(
                points[first], points[first + 1], points[second], points[second + 1]
            ):
                return True
    return False


def test_v8_1_73_smooths_only_lateral_canthus_terminals(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v72_path = ROOT / "assets" / "rstl_standard_reference_v8_1_72.json"
    v73_path = ROOT / "assets" / "rstl_standard_reference_v8_1_73.json"
    assert json.loads(v72_path.read_text(encoding="utf-8"))["atlasVersion"] == "8.1.72"
    assert json.loads(v73_path.read_text(encoding="utf-8"))["atlasVersion"] == "8.1.73"

    v72_payload = _atlas_payload(canonical, v72_path, tmp_path / "atlas_v72.json")
    v73_payload = _atlas_payload(canonical, v73_path, tmp_path / "atlas_v73.json")

    assert v73_payload["atlasVersion"] == "8.1.73"
    assert v73_payload["validated"] is False
    assert len(v73_payload["lines"]) == 159
    assert sum(len(line["points"]) for line in v73_payload["lines"]) == 15_222

    v72_by_name = {line["name"]: line for line in v72_payload["lines"]}
    v73_by_name = {line["name"]: line for line in v73_payload["lines"]}
    changed = {
        name for name, line in v73_by_name.items() if line != v72_by_name[name]
    }
    assert changed == SMOOTHED_LINES
    assert {v73_by_name[name]["region"] for name in changed} == {REGION}
    for name in changed:
        assert v73_by_name[name]["points"][0] == v72_by_name[name]["points"][0]
        assert v73_by_name[name]["points"][-1] == v72_by_name[name]["points"][-1]

    v72_norm = _normalized_lines(canonical, Atlas.load(str(tmp_path / "atlas_v72.json")))
    v73_norm = _normalized_lines(canonical, Atlas.load(str(tmp_path / "atlas_v73.json")))
    assert _crossing_pairs(v73_norm) == _crossing_pairs(v72_norm)

    for index in range(162, 166):
        right_name = f"standard_field_{index:04d}_right"
        left_name = f"standard_field_{index:04d}_left"
        right = v73_norm[right_name]
        left = v73_norm[left_name]
        mirrored_right = right.copy()
        mirrored_right[:, 0] = 1.0 - mirrored_right[:, 0]
        np.testing.assert_allclose(mirrored_right, left, atol=1e-6, rtol=0.0)

        for name in (right_name, left_name):
            old_terminal = v72_norm[name][-1] - v72_norm[name][-2]
            new_terminal = v73_norm[name][-1] - v73_norm[name][-2]
            old_slope = abs(old_terminal[1]) / max(abs(old_terminal[0]), 1e-12)
            new_slope = abs(new_terminal[1]) / max(abs(new_terminal[0]), 1e-12)
            assert new_slope < 0.04
            assert new_slope < 0.15 * old_slope
            assert not _has_self_intersection(v73_norm[name])
