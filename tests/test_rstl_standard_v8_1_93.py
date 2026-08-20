from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from langerface.config import CANONICAL_OBJ
from langerface.geometry import CanonicalFaceModel
from langerface.lines import Atlas, map_atlas
from test_rstl_standard_v8_1_70 import _atlas_payload
from test_rstl_standard_v8_1_75 import _curves_intersect, _has_self_intersection
from test_rstl_standard_v8_1_76 import _new_crossings_relative_to_baseline

ROOT = Path(__file__).resolve().parents[1]
TARGET_REGION = "forehead_bridge_arc_v15"
BROW_UPPER_REGION = "supraorbital_medial_short_arc_v69"


def _minimum_polyline_distance(first: np.ndarray, second: np.ndarray) -> float:
    def point_to_segments(points: np.ndarray, starts: np.ndarray, ends: np.ndarray) -> float:
        segments = ends - starts
        denominator = np.sum(segments * segments, axis=1)
        relative = points[:, None, :] - starts[None, :, :]
        parameter = np.clip(
            np.sum(relative * segments[None, :, :], axis=2)
            / np.maximum(denominator, 1e-12)[None, :],
            0.0,
            1.0,
        )
        projected = starts[None, :, :] + parameter[:, :, None] * segments[None, :, :]
        return float(np.sqrt(np.sum((points[:, None, :] - projected) ** 2, axis=2)).min())

    return min(
        point_to_segments(first, second[:-1], second[1:]),
        point_to_segments(second, first[:-1], first[1:]),
    )


def test_v8_1_93_strengthens_only_forehead_arches(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v92_payload = _atlas_payload(
        canonical,
        ROOT / "assets/rstl_standard_reference_v8_1_92.json",
        tmp_path / "atlas_v92.json",
    )
    v93_payload = _atlas_payload(
        canonical,
        ROOT / "assets/rstl_standard_reference_v8_1_93.json",
        tmp_path / "atlas_v93.json",
    )
    assert v93_payload["atlasVersion"] == "8.1.93"
    assert v93_payload["validated"] is False
    assert len(v93_payload["lines"]) == 190
    assert sum(len(line["points"]) for line in v93_payload["lines"]) == 18_258

    old_lines = {line["name"]: line for line in v92_payload["lines"]}
    new_lines = {line["name"]: line for line in v93_payload["lines"]}
    target_names = {
        name for name, line in new_lines.items() if line["region"] == TARGET_REGION
    }
    assert len(target_names) == 18
    assert {name for name in new_lines if new_lines[name] != old_lines[name]} == target_names
    for name in set(new_lines) - target_names:
        assert new_lines[name] == old_lines[name]
    for name in target_names:
        assert len(new_lines[name]["points"]) == len(old_lines[name]["points"])
        assert new_lines[name]["points"][0] == old_lines[name]["points"][0]
        assert new_lines[name]["points"][-1] == old_lines[name]["points"][-1]

    old_atlas = Atlas.load(str(tmp_path / "atlas_v92.json"))
    new_atlas = Atlas.load(str(tmp_path / "atlas_v93.json"))
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
        for name in set(new_mapped) - target_names:
            np.testing.assert_array_equal(new_mapped[name], old_mapped[name])
        assert not _new_crossings_relative_to_baseline(
            old_mapped, new_mapped, target_names
        )

        face_height = float(np.ptp(landmarks[:, 1]))
        upward_axis = landmarks[10, :2] - landmarks[9, :2]
        upward_axis /= np.linalg.norm(upward_axis)
        for name in target_names:
            old_points = old_mapped[name]
            new_points = new_mapped[name]
            np.testing.assert_allclose(
                new_points[[0, -1], :2], old_points[[0, -1], :2], atol=1e-5
            )
            old_heights = old_points[:, :2] @ upward_axis
            new_heights = new_points[:, :2] @ upward_axis
            old_rise = float(old_heights.max() - 0.5 * (old_heights[0] + old_heights[-1]))
            new_rise = float(new_heights.max() - 0.5 * (new_heights[0] + new_heights[-1]))
            assert new_rise - old_rise > 0.015 * face_height
            assert not _has_self_intersection(new_points)

        ordered_names = sorted(target_names)
        for index, first_name in enumerate(ordered_names):
            for second_name in ordered_names[index + 1 :]:
                assert not _curves_intersect(
                    new_mapped[first_name], new_mapped[second_name]
                )


def test_v8_1_93_keeps_clearance_from_brow_upper_lines():
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    atlas = Atlas.load(str(ROOT / "assets/atlas_rstl.json"))
    frames = json.loads((ROOT / "web/test/expected.json").read_text(encoding="utf-8"))["frames"]
    for frame in frames:
        landmarks = np.asarray(frame["landmarks"], dtype=np.float64)
        mapped = map_atlas(atlas, landmarks, canonical.triangles)
        forehead = [line.pts[:, :2] for line in mapped if line.region == TARGET_REGION]
        brow_upper = [line.pts[:, :2] for line in mapped if line.region == BROW_UPPER_REGION]
        assert len(forehead) == 18
        assert brow_upper
        clearance = min(
            _minimum_polyline_distance(forehead_line, brow_line)
            for forehead_line in forehead
            for brow_line in brow_upper
        )
        assert clearance >= 15.0
