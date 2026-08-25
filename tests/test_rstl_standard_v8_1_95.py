from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from langerface.config import CANONICAL_OBJ
from langerface.geometry import CanonicalFaceModel
from langerface.lines import Atlas, map_atlas
from test_rstl_standard_v8_1_70 import _atlas_payload
from test_rstl_standard_v8_1_75 import _curves_intersect, _has_self_intersection

ROOT = Path(__file__).resolve().parents[1]
TARGET_REGION = "cheek_alar_gap_fill_v95"


def test_v8_1_95_adds_only_bilateral_full_alar_origin_lines(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v94_payload = _atlas_payload(
        canonical,
        ROOT / "assets/rstl_standard_reference_v8_1_94.json",
        tmp_path / "atlas_v94.json",
    )
    v95_payload = _atlas_payload(
        canonical,
        ROOT / "assets/rstl_standard_reference_v8_1_95.json",
        tmp_path / "atlas_v95.json",
    )
    assert v95_payload["atlasVersion"] == "8.1.95"
    assert v95_payload["validated"] is False
    assert len(v95_payload["lines"]) == 204
    assert sum(len(line["points"]) for line in v95_payload["lines"]) == 19_022
    assert v95_payload["lines"][:200] == v94_payload["lines"]
    additions = v95_payload["lines"][200:]
    assert len(additions) == 4
    assert {line["region"] for line in additions} == {TARGET_REGION}
    assert sum(line["name"].endswith("_left") for line in additions) == 2
    assert sum(line["name"].endswith("_right") for line in additions) == 2


def test_v8_1_95_additions_are_full_length_mirrored_and_crossing_free(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    _atlas_payload(
        canonical,
        ROOT / "assets/rstl_standard_reference_v8_1_95.json",
        tmp_path / "atlas_v95.json",
    )
    atlas = Atlas.load(str(tmp_path / "atlas_v95.json"))
    mapped = map_atlas(atlas, canonical.project_front(), canonical.triangles)
    baseline = [line for line in mapped if line.region != TARGET_REGION]
    additions = [line for line in mapped if line.region == TARGET_REGION]

    assert len(additions) == 4
    right = additions[::2]
    left = additions[1::2]
    origin, scale = canonical.face_frame()
    normalized_right = [(line.pts[:, :2] - origin) / scale for line in right]
    assert all(points[0, 0] >= 0.38 for points in normalized_right)
    assert all(np.ptp(points[:, 0]) >= 0.23 for points in normalized_right)
    assert normalized_right[0][0, 1] < normalized_right[1][0, 1]
    assert normalized_right[0][-1, 1] < normalized_right[1][-1, 1]

    for right_line, left_line in zip(right, left, strict=True):
        np.testing.assert_allclose(
            left_line.pts[:, 0],
            2.0 * origin[0] + scale[0] - right_line.pts[:, 0],
            atol=3e-6,
        )
        np.testing.assert_allclose(left_line.pts[:, 1:], right_line.pts[:, 1:], atol=3e-6)
    assert all(not _has_self_intersection(line.pts) for line in additions)
    for index, first in enumerate(additions):
        assert all(not _curves_intersect(first.pts, old.pts) for old in baseline)
        for second in additions[index + 1 :]:
            assert not _curves_intersect(first.pts, second.pts)


def test_v8_1_95_preserves_all_v94_lines_after_runtime_mapping(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    _atlas_payload(
        canonical,
        ROOT / "assets/rstl_standard_reference_v8_1_94.json",
        tmp_path / "atlas_v94.json",
    )
    _atlas_payload(
        canonical,
        ROOT / "assets/rstl_standard_reference_v8_1_95.json",
        tmp_path / "atlas_v95.json",
    )
    v94 = Atlas.load(str(tmp_path / "atlas_v94.json"))
    v95 = Atlas.load(str(tmp_path / "atlas_v95.json"))
    frames = json.loads(
        (ROOT / "web/test/expected.json").read_text(encoding="utf-8")
    )["frames"]

    for frame in frames:
        landmarks = np.asarray(frame["landmarks"], dtype=np.float64)
        old_mapped = map_atlas(v94, landmarks, canonical.triangles)
        new_mapped = map_atlas(v95, landmarks, canonical.triangles)[:200]
        assert [line.name for line in new_mapped] == [line.name for line in old_mapped]
        for old_line, new_line in zip(old_mapped, new_mapped, strict=True):
            np.testing.assert_array_equal(new_line.pts, old_line.pts)
            np.testing.assert_array_equal(new_line.tris, old_line.tris)
