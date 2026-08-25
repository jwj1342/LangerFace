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
TARGET_REGION = "brow_temporal_fan_v94"


def test_v8_1_94_adds_only_bilateral_brow_temporal_fans(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v93_payload = _atlas_payload(
        canonical,
        ROOT / "assets/rstl_standard_reference_v8_1_93.json",
        tmp_path / "atlas_v93.json",
    )
    v94_payload = _atlas_payload(
        canonical,
        ROOT / "assets/rstl_standard_reference_v8_1_94.json",
        tmp_path / "atlas_v94.json",
    )
    assert v94_payload["atlasVersion"] == "8.1.94"
    assert v94_payload["validated"] is False
    assert len(v94_payload["lines"]) == 200
    assert sum(len(line["points"]) for line in v94_payload["lines"]) == 18_662
    assert v94_payload["lines"][:190] == v93_payload["lines"]
    additions = v94_payload["lines"][190:]
    assert len(additions) == 10
    assert {line["region"] for line in additions} == {TARGET_REGION}
    assert sum(line["name"].endswith("_left") for line in additions) == 5
    assert sum(line["name"].endswith("_right") for line in additions) == 5


def test_v8_1_94_brow_fans_are_mirrored_ordered_and_crossing_free(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    _atlas_payload(
        canonical,
        ROOT / "assets/rstl_standard_reference_v8_1_94.json",
        tmp_path / "atlas_v94.json",
    )
    atlas = Atlas.load(str(tmp_path / "atlas_v94.json"))
    mapped = map_atlas(atlas, canonical.project_front(), canonical.triangles)
    baseline = [line for line in mapped if line.region != TARGET_REGION]
    additions = [line for line in mapped if line.region == TARGET_REGION]

    assert len(additions) == 10
    right = additions[::2]
    left = additions[1::2]
    spans = [float(np.ptp(line.pts[:, 0])) for line in right]
    assert all(first > second for first, second in zip(spans, spans[1:]))
    for right_line, left_line in zip(right, left, strict=True):
        np.testing.assert_allclose(
            left_line.pts[:, 0],
            2.0 * canonical.face_frame()[0][0] + canonical.face_frame()[1][0] - right_line.pts[:, 0],
            atol=3e-6,
        )
        np.testing.assert_allclose(left_line.pts[:, 1:], right_line.pts[:, 1:], atol=3e-6)
    assert all(not _has_self_intersection(line.pts) for line in additions)
    for index, first in enumerate(additions):
        assert all(not _curves_intersect(first.pts, old.pts) for old in baseline)
        for second in additions[index + 1 :]:
            assert not _curves_intersect(first.pts, second.pts)


def test_v8_1_94_preserves_all_v93_lines_after_runtime_mapping(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    _atlas_payload(
        canonical,
        ROOT / "assets/rstl_standard_reference_v8_1_93.json",
        tmp_path / "atlas_v93.json",
    )
    _atlas_payload(
        canonical,
        ROOT / "assets/rstl_standard_reference_v8_1_94.json",
        tmp_path / "atlas_v94.json",
    )
    v93 = Atlas.load(str(tmp_path / "atlas_v93.json"))
    v94 = Atlas.load(str(tmp_path / "atlas_v94.json"))
    frames = json.loads(
        (ROOT / "web/test/expected.json").read_text(encoding="utf-8")
    )["frames"]

    for frame in frames:
        landmarks = np.asarray(frame["landmarks"], dtype=np.float64)
        old_mapped = map_atlas(v93, landmarks, canonical.triangles)
        new_mapped = map_atlas(v94, landmarks, canonical.triangles)[:190]
        assert [line.name for line in new_mapped] == [line.name for line in old_mapped]
        for old_line, new_line in zip(old_mapped, new_mapped, strict=True):
            np.testing.assert_array_equal(new_line.pts, old_line.pts)
            np.testing.assert_array_equal(new_line.tris, old_line.tris)
