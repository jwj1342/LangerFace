from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / "tests"
if str(TESTS) not in sys.path:
    sys.path.insert(0, str(TESTS))

from langerface.config import CANONICAL_OBJ  # noqa: E402
from langerface.geometry import CanonicalFaceModel  # noqa: E402
from test_rstl_standard_v8_1_70 import _atlas_payload  # noqa: E402

EXPECTED_LINE_COUNT = 190
EXPECTED_POINT_COUNT = 18_258
REMOVED_REGION = "supraorbital_lateral_short_arc_v66"
REMOVED_SOURCE_INDICES = {166, 167, 168, 169}
EXPECTED_REMOVED_NAMES = {
    f"standard_field_{source_index:04d}_{side}"
    for source_index in REMOVED_SOURCE_INDICES
    for side in ("right", "left")
}


def test_v8_1_84_removes_only_blue_boxed_supraorbital_lateral_arcs(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v83_path = ROOT / "assets" / "rstl_standard_reference_v8_1_83.json"
    v84_path = ROOT / "assets" / "rstl_standard_reference_v8_1_84.json"
    v83_payload = _atlas_payload(canonical, v83_path, tmp_path / "atlas_v83.json")
    v84_payload = _atlas_payload(canonical, v84_path, tmp_path / "atlas_v84.json")
    assert v84_payload["atlasVersion"] == "8.1.84"
    assert v84_payload["validated"] is False
    assert len(v84_payload["lines"]) == EXPECTED_LINE_COUNT
    assert sum(len(line["points"]) for line in v84_payload["lines"]) == EXPECTED_POINT_COUNT

    old_lines = {line["name"]: line for line in v83_payload["lines"]}
    new_lines = {line["name"]: line for line in v84_payload["lines"]}
    assert set(old_lines) - set(new_lines) == EXPECTED_REMOVED_NAMES
    assert not set(new_lines) - set(old_lines)
    for name, line in new_lines.items():
        assert line == old_lines[name]
    for name in EXPECTED_REMOVED_NAMES:
        assert old_lines[name]["region"] == REMOVED_REGION
    assert all(line["region"] != REMOVED_REGION for line in v84_payload["lines"])
