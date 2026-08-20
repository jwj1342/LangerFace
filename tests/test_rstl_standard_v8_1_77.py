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
from test_rstl_standard_v8_1_76 import (  # noqa: E402
    _new_crossings_relative_to_baseline,
    _spacing_metrics,
)

EXPECTED_LINE_COUNT = 206
EXPECTED_POINT_COUNT = 18_648
TARGET_REGIONS = {
    "cheek_long_arc_fan_v24",
    "forehead_bridge_arc_v15",
    "nose_side_downturn_v9",
    "orbital_brow_upturn_v11",
    "perioral_commissure_swirl_v49",
    "supraorbital_medial_short_arc_v69",
}


def test_v8_1_77_reduces_remaining_extreme_gaps_without_new_crossings(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v76_path = ROOT / "assets" / "rstl_standard_reference_v8_1_76.json"
    v77_path = ROOT / "assets" / "rstl_standard_reference_v8_1_77.json"
    v76_payload = _atlas_payload(canonical, v76_path, tmp_path / "atlas_v76.json")
    v77_payload = _atlas_payload(canonical, v77_path, tmp_path / "atlas_v77.json")
    assert json.loads(v77_path.read_text(encoding="utf-8"))["atlasVersion"] == "8.1.77"
    assert v77_payload["atlasVersion"] == "8.1.77"
    assert v77_payload["validated"] is False
    assert len(v77_payload["lines"]) == EXPECTED_LINE_COUNT
    assert sum(len(line["points"]) for line in v77_payload["lines"]) == EXPECTED_POINT_COUNT

    assert [line["name"] for line in v77_payload["lines"]] == [
        line["name"] for line in v76_payload["lines"]
    ]
    assert [line["region"] for line in v77_payload["lines"]] == [
        line["region"] for line in v76_payload["lines"]
    ]
    assert [line.get("postMapSmoothingPasses", 0) for line in v77_payload["lines"]] == [
        line.get("postMapSmoothingPasses", 0) for line in v76_payload["lines"]
    ]

    changed_names = {
        old["name"]
        for old, new in zip(v76_payload["lines"], v77_payload["lines"])
        if old != new
    }
    changed_regions = {
        line["region"] for line in v77_payload["lines"] if line["name"] in changed_names
    }
    assert changed_names
    assert changed_regions == TARGET_REGIONS
    for old, new in zip(v76_payload["lines"], v77_payload["lines"]):
        if old["region"] not in TARGET_REGIONS:
            assert new == old

    old_atlas = Atlas.load(str(tmp_path / "atlas_v76.json"))
    new_atlas = Atlas.load(str(tmp_path / "atlas_v77.json"))
    old_normalized = _normalized_lines(canonical, old_atlas)
    new_normalized = _normalized_lines(canonical, new_atlas)
    for name in old_normalized:
        np.testing.assert_allclose(
            new_normalized[name][[0, -1]],
            old_normalized[name][[0, -1]],
            atol=1e-6,
            rtol=0.0,
        )
        if name.endswith("_right"):
            left_name = f"{name[:-6]}_left"
            mirrored = new_normalized[name].copy()
            mirrored[:, 0] = 1.0 - mirrored[:, 0]
            np.testing.assert_allclose(mirrored, new_normalized[left_name], atol=1e-6, rtol=0.0)
        elif name.endswith("_cross"):
            mirrored = new_normalized[name][::-1].copy()
            mirrored[:, 0] = 1.0 - mirrored[:, 0]
            np.testing.assert_allclose(mirrored, new_normalized[name], atol=1e-6, rtol=0.0)

    old_metrics = _spacing_metrics(old_atlas, old_normalized)
    new_metrics = _spacing_metrics(new_atlas, new_normalized)
    assert all(new_metrics[region][0] < old_metrics[region][0] for region in TARGET_REGIONS)
    assert all(new_metrics[region][1] < old_metrics[region][1] for region in TARGET_REGIONS)
    assert np.mean([new_metrics[region][0] for region in TARGET_REGIONS]) <= 0.85 * np.mean(
        [old_metrics[region][0] for region in TARGET_REGIONS]
    )
    assert new_metrics["cheek_long_arc_fan_v24"][1] <= 0.87 * old_metrics[
        "cheek_long_arc_fan_v24"
    ][1]
    assert new_metrics["nose_side_downturn_v9"][1] <= 0.90 * old_metrics[
        "nose_side_downturn_v9"
    ][1]
    assert new_metrics["orbital_brow_upturn_v11"][0] <= 0.90 * old_metrics[
        "orbital_brow_upturn_v11"
    ][0]

    assert not _new_crossings_relative_to_baseline(
        old_normalized,
        new_normalized,
        changed_names,
    )
    frames = json.loads((ROOT / "web" / "test" / "expected.json").read_text())["frames"]
    for frame in frames:
        landmarks = np.asarray(frame["landmarks"], dtype=np.float64)
        old_mapped = {
            line.name: line.pts[:, :2]
            for line in map_atlas(old_atlas, landmarks, canonical.triangles)
        }
        new_mapped = {
            line.name: line.pts[:, :2]
            for line in map_atlas(new_atlas, landmarks, canonical.triangles)
        }
        assert not _new_crossings_relative_to_baseline(old_mapped, new_mapped, changed_names)
