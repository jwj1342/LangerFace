from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / "tests"
if str(TESTS) not in sys.path:
    sys.path.insert(0, str(TESTS))

from langerface.config import CANONICAL_OBJ  # noqa: E402
from langerface.geometry import CanonicalFaceModel  # noqa: E402
from test_rstl_standard_v8_1_70 import _atlas_payload  # noqa: E402
from test_rstl_standard_v8_1_78 import ENDPOINT_ORDER  # noqa: E402

EXPECTED_LINE_COUNT = 198
EXPECTED_POINT_COUNT = 18_546
REMOVED_SOURCE_INDICES = {191, 192, 199, 200}
EXPECTED_REMOVED_NAMES = {
    f"standard_field_{source_index:04d}_{side}"
    for source_index in REMOVED_SOURCE_INDICES
    for side in ("right", "left")
}
AFFECTED_REGION_COUNTS = {
    "orbital_brow_upturn_v11": 14,
    "supraorbital_medial_short_arc_v69": 10,
}


def test_v8_1_80_restores_only_pre_density_brow_counts(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v74_path = ROOT / "assets" / "rstl_standard_reference_v8_1_74.json"
    v79_path = ROOT / "assets" / "rstl_standard_reference_v8_1_79.json"
    v80_path = ROOT / "assets" / "rstl_standard_reference_v8_1_80.json"
    v74_payload = _atlas_payload(canonical, v74_path, tmp_path / "atlas_v74.json")
    v79_payload = _atlas_payload(canonical, v79_path, tmp_path / "atlas_v79.json")
    v80_payload = _atlas_payload(canonical, v80_path, tmp_path / "atlas_v80.json")

    assert v80_payload["atlasVersion"] == "8.1.80"
    assert v80_payload["validated"] is False
    assert len(v80_payload["lines"]) == EXPECTED_LINE_COUNT
    assert sum(len(line["points"]) for line in v80_payload["lines"]) == EXPECTED_POINT_COUNT

    old_lines = {line["name"]: line for line in v79_payload["lines"]}
    new_lines = {line["name"]: line for line in v80_payload["lines"]}
    assert set(old_lines) - set(new_lines) == EXPECTED_REMOVED_NAMES
    assert set(new_lines) - set(old_lines) == set()
    assert list(new_lines) == [
        line["name"]
        for line in v79_payload["lines"]
        if line["name"] not in EXPECTED_REMOVED_NAMES
    ]
    for name, line in new_lines.items():
        assert line == old_lines[name]

    old_regions = Counter(line["region"] for line in v74_payload["lines"])
    new_regions = Counter(line["region"] for line in v80_payload["lines"])
    assert {region: new_regions[region] for region in AFFECTED_REGION_COUNTS} == (
        AFFECTED_REGION_COUNTS
    )
    assert {region: old_regions[region] for region in AFFECTED_REGION_COUNTS} == (
        AFFECTED_REGION_COUNTS
    )

    forehead_names = {
        line["name"] for line in v79_payload["lines"] if line["region"].startswith("forehead")
    }
    assert forehead_names
    for name in forehead_names:
        assert new_lines[name] == old_lines[name]

    alar_names = {
        f"standard_field_{source_index:04d}_{side}"
        for source_index in ENDPOINT_ORDER
        for side in ("right", "left")
    }
    for name in alar_names:
        assert new_lines[name] == old_lines[name]
