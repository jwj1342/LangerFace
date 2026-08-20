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
from test_rstl_standard_v8_1_87 import _turn_at

ROOT = Path(__file__).resolve().parents[1]
TARGET_REGION = "orbital_brow_upturn_v11"
TARGET_SOURCE_ORDER = (105, 106, 154, 107, 155, 108, 109)
TARGET_NAMES = {
    f"standard_field_{source_index:04d}_{side}"
    for source_index in TARGET_SOURCE_ORDER
    for side in ("right", "left")
}
JOIN_INDICES = {105: 38, 106: 38, 154: 38, 107: 38, 155: 38, 108: 39, 109: 39}
EYE_INDICES = {
    "right": (33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246),
    "left": (263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466),
}


def test_v8_1_88_spreads_orbital_brow_temporal_endpoints(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v87_payload = _atlas_payload(
        canonical,
        ROOT / "assets/rstl_standard_reference_v8_1_87.json",
        tmp_path / "atlas_v87.json",
    )
    v88_payload = _atlas_payload(
        canonical,
        ROOT / "assets/rstl_standard_reference_v8_1_88.json",
        tmp_path / "atlas_v88.json",
    )
    assert v88_payload["atlasVersion"] == "8.1.88"
    assert v88_payload["validated"] is False
    assert len(v88_payload["lines"]) == 190
    assert sum(len(line["points"]) for line in v88_payload["lines"]) == 18_258

    old_lines = {line["name"]: line for line in v87_payload["lines"]}
    new_lines = {line["name"]: line for line in v88_payload["lines"]}
    changed_names = {name for name in new_lines if new_lines[name] != old_lines[name]}
    assert changed_names == TARGET_NAMES
    for name in set(new_lines) - TARGET_NAMES:
        assert new_lines[name] == old_lines[name]
    for name in TARGET_NAMES:
        assert new_lines[name]["region"] == TARGET_REGION
        old_without_spec = dict(old_lines[name])
        new_without_spec = dict(new_lines[name])
        old_without_spec.pop("postMapTemporalCubicFaceRatio")
        new_without_spec.pop("postMapTemporalCubicFaceRatio")
        assert new_without_spec == old_without_spec
    outward_controls = [
        new_lines[f"standard_field_{source_index:04d}_right"][
            "postMapTemporalCubicFaceRatio"
        ][1][0]
        for source_index in TARGET_SOURCE_ORDER
    ]
    assert np.all(np.diff(outward_controls) > 0.0008)

    old_atlas = Atlas.load(str(tmp_path / "atlas_v87.json"))
    new_atlas = Atlas.load(str(tmp_path / "atlas_v88.json"))
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
        for name in set(new_mapped) - TARGET_NAMES:
            np.testing.assert_array_equal(new_mapped[name], old_mapped[name])
        assert not _new_crossings_relative_to_baseline(
            old_mapped, new_mapped, TARGET_NAMES
        )

        face_width = float(np.ptp(landmarks[:, 0]))
        right_axis = landmarks[263, :2] - landmarks[33, :2]
        right_axis /= np.linalg.norm(right_axis)
        down_axis = landmarks[152, :2] - landmarks[10, :2]
        down_axis -= float(down_axis @ right_axis) * right_axis
        down_axis /= np.linalg.norm(down_axis)

        for side in ("right", "left"):
            names = [
                f"standard_field_{source_index:04d}_{side}"
                for source_index in TARGET_SOURCE_ORDER
            ]
            eye_indices = EYE_INDICES[side]
            eye_polygon = np.vstack(
                (landmarks[list(eye_indices), :2], landmarks[eye_indices[0], :2])
            )
            endpoint_depths = []
            for source_index, name in zip(TARGET_SOURCE_ORDER, names, strict=True):
                join_index = JOIN_INDICES[source_index]
                points = new_mapped[name]
                np.testing.assert_array_equal(
                    points[join_index:], old_mapped[name][join_index:]
                )
                assert _turn_at(points, join_index) < 0.04
                assert not _has_self_intersection(points)
                assert not _curves_intersect(points, eye_polygon)
                endpoint_depths.append(float(points[0, :2] @ down_axis))
            assert np.all(np.diff(endpoint_depths) > 0.006 * face_width)
            assert endpoint_depths[-1] - endpoint_depths[0] > 0.05 * face_width
            for first_index, first_name in enumerate(names):
                for second_name in names[first_index + 1 :]:
                    assert not _curves_intersect(
                        new_mapped[first_name], new_mapped[second_name]
                    )
