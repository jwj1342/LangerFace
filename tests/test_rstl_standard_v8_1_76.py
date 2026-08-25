from __future__ import annotations

import json
import sys
from collections import defaultdict
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

EXPECTED_LINE_COUNT = 206
EXPECTED_POINT_COUNT = 18_648
TARGET_REGIONS = {
    "cheek_long_arc_fan_v24",
    "chin",
    "forehead_bridge_arc_v15",
    "lateral_canthus_short_arc_v65",
    "nose_side_downturn_v9",
    "orbital_brow_upturn_v11",
    "perioral_commissure_radial_v50",
    "perioral_commissure_swirl_v49",
    "philtrum_nasal_base_v10",
    "supraorbital_medial_short_arc_v69",
}


def _sample(points: np.ndarray, count: int = 96) -> np.ndarray:
    segment = np.linalg.norm(np.diff(points[:, :2], axis=0), axis=1)
    cumulative = np.r_[0.0, np.cumsum(segment)]
    target = np.linspace(0.0, cumulative[-1], count)
    return np.column_stack(
        [np.interp(target, cumulative, points[:, axis]) for axis in range(2)]
    )


def _align(reference: np.ndarray, candidate: np.ndarray) -> np.ndarray:
    direct = np.linalg.norm(reference[0] - candidate[0]) + np.linalg.norm(
        reference[-1] - candidate[-1]
    )
    reverse = np.linalg.norm(reference[0] - candidate[-1]) + np.linalg.norm(
        reference[-1] - candidate[0]
    )
    return candidate if direct <= reverse else candidate[::-1]


def _spacing_metrics(
    atlas: Atlas,
    curves: dict[str, np.ndarray],
) -> dict[str, tuple[float, float]]:
    grouped: dict[tuple[str, str], list[np.ndarray]] = defaultdict(list)
    for line in atlas.lines:
        if line.name.endswith("_left"):
            continue
        topology = "cross" if line.name.endswith("_cross") else "mirrored"
        grouped[(line.region, topology)].append(curves[line.name])

    result: dict[str, tuple[float, float]] = {}
    for (region, _topology), family in grouped.items():
        if len(family) < 3:
            continue
        sampled = [_sample(points) for points in family]
        reference = sampled[int(np.argmax([np.linalg.norm(p[-1] - p[0]) for p in sampled]))]
        aligned = [_align(reference, points) for points in sampled]
        tangents = np.asarray([points[-1] - points[0] for points in aligned])
        lengths = np.linalg.norm(tangents, axis=1)
        valid = lengths > 1e-10
        tangents[valid] /= lengths[valid, None]
        tangent = np.sum(tangents[valid], axis=0)
        tangent /= np.linalg.norm(tangent)
        normal = np.array([-tangent[1], tangent[0]])
        order = np.argsort([float(np.mean(points, axis=0) @ normal) for points in aligned])
        ordered = [aligned[int(index)] for index in order]
        gaps = np.asarray(
            [
                float(np.median(np.linalg.norm(first - second, axis=1)))
                for first, second in zip(ordered[:-1], ordered[1:])
            ]
        )
        result[region] = (
            float(np.std(gaps) / np.mean(gaps)),
            float(np.max(gaps) / np.min(gaps)),
        )
    return result


def _new_crossings_relative_to_baseline(
    baseline: dict[str, np.ndarray],
    candidate: dict[str, np.ndarray],
    changed_names: set[str],
) -> set[tuple[str, str]]:
    crossings: set[tuple[str, str]] = set()
    for name in sorted(changed_names):
        if _has_self_intersection(candidate[name]) and not _has_self_intersection(baseline[name]):
            crossings.add((name, name))
        for other_name in candidate:
            if other_name == name:
                continue
            pair = tuple(sorted((name, other_name)))
            if pair in crossings:
                continue
            if _curves_intersect(candidate[name], candidate[other_name]) and not _curves_intersect(
                baseline[name], baseline[other_name]
            ):
                crossings.add(pair)
    return crossings


def test_v8_1_76_equalizes_bundle_spacing_without_changing_topology(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v75_path = ROOT / "assets" / "rstl_standard_reference_v8_1_75.json"
    v76_path = ROOT / "assets" / "rstl_standard_reference_v8_1_76.json"
    v75_payload = _atlas_payload(canonical, v75_path, tmp_path / "atlas_v75.json")
    v76_payload = _atlas_payload(canonical, v76_path, tmp_path / "atlas_v76.json")
    assert json.loads(v76_path.read_text(encoding="utf-8"))["atlasVersion"] == "8.1.76"
    assert v76_payload["atlasVersion"] == "8.1.76"
    assert v76_payload["validated"] is False
    assert len(v76_payload["lines"]) == EXPECTED_LINE_COUNT
    assert sum(len(line["points"]) for line in v76_payload["lines"]) == EXPECTED_POINT_COUNT

    assert [line["name"] for line in v76_payload["lines"]] == [
        line["name"] for line in v75_payload["lines"]
    ]
    assert [line["region"] for line in v76_payload["lines"]] == [
        line["region"] for line in v75_payload["lines"]
    ]
    assert [line.get("postMapSmoothingPasses", 0) for line in v76_payload["lines"]] == [
        line.get("postMapSmoothingPasses", 0) for line in v75_payload["lines"]
    ]

    old_atlas = Atlas.load(str(tmp_path / "atlas_v75.json"))
    new_atlas = Atlas.load(str(tmp_path / "atlas_v76.json"))
    old_normalized = _normalized_lines(canonical, old_atlas)
    new_normalized = _normalized_lines(canonical, new_atlas)
    changed_names = {
        old["name"]
        for old, new in zip(v75_payload["lines"], v76_payload["lines"])
        if old != new
    }
    assert changed_names
    assert {line.region for line in new_atlas.lines if line.name in changed_names} == TARGET_REGIONS

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
    assert np.mean([new_metrics[region][0] for region in TARGET_REGIONS]) <= 0.70 * np.mean(
        [old_metrics[region][0] for region in TARGET_REGIONS]
    )
    assert sum(
        new_metrics[region][0] <= 0.80 * old_metrics[region][0] for region in TARGET_REGIONS
    ) >= 8
    assert new_metrics["cheek_long_arc_fan_v24"][1] <= 0.80 * old_metrics[
        "cheek_long_arc_fan_v24"
    ][1]

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
