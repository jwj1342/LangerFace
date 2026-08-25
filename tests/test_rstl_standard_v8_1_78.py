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

EXPECTED_LINE_COUNT = 206
EXPECTED_POINT_COUNT = 18_930
TARGET_REGIONS = {
    "cheek_long_arc_fan_v24",
    "cheek_long_arc_density_v41",
    "cheek_lower_divergent_arc_v44",
}
ENDPOINT_ORDER = (114, 115, 116, 178, 135, 117, 118, 119, 120, 176, 121, 177, 122, 137, 179, 138)
CHANGED_SOURCE_INDICES = {114, 116, 120, 121, 122, 137, 138, 176, 177, 179}


def _endpoint_metrics(
    curves: dict[str, np.ndarray],
    endpoint_indices: dict[str, int] | None = None,
) -> tuple[float, float]:
    points = []
    for source_index in ENDPOINT_ORDER:
        name = f"standard_field_{source_index:04d}_right"
        curve = curves[name]
        endpoint = (
            endpoint_indices[name]
            if endpoint_indices is not None
            else int(np.argmax(curve[:, 0]))
        )
        points.append(curve[endpoint])
    gaps = np.linalg.norm(np.diff(np.asarray(points), axis=0), axis=1)
    return float(np.std(gaps) / np.mean(gaps)), float(np.max(gaps) / np.min(gaps))


def test_v8_1_78_equalizes_cheek_alar_endpoints_without_new_crossings(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v77_path = ROOT / "assets" / "rstl_standard_reference_v8_1_77.json"
    v78_path = ROOT / "assets" / "rstl_standard_reference_v8_1_78.json"
    v77_payload = _atlas_payload(canonical, v77_path, tmp_path / "atlas_v77.json")
    v78_payload = _atlas_payload(canonical, v78_path, tmp_path / "atlas_v78.json")
    assert json.loads(v78_path.read_text(encoding="utf-8"))["atlasVersion"] == "8.1.78"
    assert v78_payload["atlasVersion"] == "8.1.78"
    assert v78_payload["validated"] is False
    assert len(v78_payload["lines"]) == EXPECTED_LINE_COUNT
    assert sum(len(line["points"]) for line in v78_payload["lines"]) == EXPECTED_POINT_COUNT

    assert [line["name"] for line in v78_payload["lines"]] == [
        line["name"] for line in v77_payload["lines"]
    ]
    assert [line["region"] for line in v78_payload["lines"]] == [
        line["region"] for line in v77_payload["lines"]
    ]
    assert [line.get("postMapSmoothingPasses", 0) for line in v78_payload["lines"]] == [
        line.get("postMapSmoothingPasses", 0) for line in v77_payload["lines"]
    ]

    changed_names = {
        old["name"]
        for old, new in zip(v77_payload["lines"], v78_payload["lines"])
        if old != new
    }
    expected_changed_names = {
        f"standard_field_{source_index:04d}_{side}"
        for source_index in CHANGED_SOURCE_INDICES
        for side in ("right", "left")
    }
    assert changed_names == expected_changed_names
    assert {
        line["region"] for line in v78_payload["lines"] if line["name"] in changed_names
    } <= TARGET_REGIONS
    for old, new in zip(v77_payload["lines"], v78_payload["lines"]):
        if old["name"] not in changed_names:
            assert new == old

    old_atlas = Atlas.load(str(tmp_path / "atlas_v77.json"))
    new_atlas = Atlas.load(str(tmp_path / "atlas_v78.json"))
    old_normalized = _normalized_lines(canonical, old_atlas)
    new_normalized = _normalized_lines(canonical, new_atlas)
    old_cv, old_ratio = _endpoint_metrics(old_normalized)
    new_cv, new_ratio = _endpoint_metrics(new_normalized)
    assert new_cv <= 0.55 * old_cv
    assert new_ratio <= 0.40 * old_ratio

    for name in old_normalized:
        if name.endswith("_right"):
            left_name = f"{name[:-6]}_left"
            mirrored = new_normalized[name].copy()
            mirrored[:, 0] = 1.0 - mirrored[:, 0]
            np.testing.assert_allclose(mirrored, new_normalized[left_name], atol=1e-6, rtol=0.0)
    assert not _new_crossings_relative_to_baseline(
        old_normalized,
        new_normalized,
        changed_names,
    )

    endpoint_indices = {
        f"standard_field_{source_index:04d}_right": int(
            np.argmax(old_normalized[f"standard_field_{source_index:04d}_right"][:, 0])
        )
        for source_index in ENDPOINT_ORDER
    }
    old_mapped_metrics = []
    new_mapped_metrics = []
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
        old_metrics = _endpoint_metrics(old_mapped, endpoint_indices)
        new_metrics = _endpoint_metrics(new_mapped, endpoint_indices)
        assert new_metrics[0] < old_metrics[0]
        assert new_metrics[1] < old_metrics[1]
        old_mapped_metrics.append(old_metrics)
        new_mapped_metrics.append(new_metrics)
    assert np.mean([metrics[0] for metrics in new_mapped_metrics]) <= 0.75 * np.mean(
        [metrics[0] for metrics in old_mapped_metrics]
    )
