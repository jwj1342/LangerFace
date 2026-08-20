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
from test_rstl_standard_v8_1_89 import (
    EYE_INDICES,
    JOIN_INDEX,
    TARGET_NAMES,
    TARGET_REGION,
    TARGET_SOURCE_ORDER,
    _temporal_boundary_outward,
)

ROOT = Path(__file__).resolve().parents[1]


def test_v8_1_92_extends_orbital_brow_tails_inside_visible_temple(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v91_payload = _atlas_payload(
        canonical,
        ROOT / "assets/rstl_standard_reference_v8_1_91.json",
        tmp_path / "atlas_v91.json",
    )
    v92_payload = _atlas_payload(
        canonical,
        ROOT / "assets/rstl_standard_reference_v8_1_92.json",
        tmp_path / "atlas_v92.json",
    )
    assert v92_payload["atlasVersion"] == "8.1.92"
    assert v92_payload["validated"] is False
    assert len(v92_payload["lines"]) == 190
    assert sum(len(line["points"]) for line in v92_payload["lines"]) == 18_258

    old_lines = {line["name"]: line for line in v91_payload["lines"]}
    new_lines = {line["name"]: line for line in v92_payload["lines"]}
    changed_names = {name for name in new_lines if new_lines[name] != old_lines[name]}
    assert changed_names == TARGET_NAMES
    for name in set(new_lines) - TARGET_NAMES:
        assert new_lines[name] == old_lines[name]
    for name in TARGET_NAMES:
        assert new_lines[name]["region"] == TARGET_REGION
        assert new_lines[name]["postMapTemporalAbsoluteEndpoint"] is True
        assert new_lines[name]["postMapTemporalBoundaryMarginFaceRatio"] == -0.012
        old_spec = old_lines[name]["postMapTemporalCubicFaceRatio"]
        new_spec = new_lines[name]["postMapTemporalCubicFaceRatio"]
        assert old_spec[0] == new_spec[0] == JOIN_INDEX
        assert np.isclose(new_spec[1][0] - old_spec[1][0], 0.024, atol=1e-12)
        assert np.isclose(new_spec[2][1] - old_spec[2][1], 0.0, atol=1e-12)
        old_body = dict(old_lines[name])
        new_body = dict(new_lines[name])
        old_body.pop("postMapTemporalCubicFaceRatio")
        new_body.pop("postMapTemporalCubicFaceRatio")
        old_body.pop("postMapTemporalBoundaryMarginFaceRatio")
        new_body.pop("postMapTemporalBoundaryMarginFaceRatio")
        assert new_body == old_body

    old_atlas = Atlas.load(str(tmp_path / "atlas_v91.json"))
    new_atlas = Atlas.load(str(tmp_path / "atlas_v92.json"))
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

        frame_extensions = []
        for side in ("right", "left"):
            outward_axis = -right_axis if side == "right" else right_axis
            names = [
                f"standard_field_{source_index:04d}_{side}"
                for source_index in TARGET_SOURCE_ORDER
            ]
            eye_indices = EYE_INDICES[side]
            eye_polygon = np.vstack(
                (landmarks[list(eye_indices), :2], landmarks[eye_indices[0], :2])
            )
            for name in names:
                old_points = old_mapped[name]
                new_points = new_mapped[name]
                np.testing.assert_array_equal(
                    new_points[JOIN_INDEX:], old_points[JOIN_INDEX:]
                )
                extension = float(
                    (new_points[0, :2] - old_points[0, :2]) @ outward_axis
                )
                frame_extensions.append(extension)
                assert -1e-6 <= extension <= 0.0241 * face_width

                old_depths = old_points[: JOIN_INDEX + 1, :2] @ down_axis
                new_prefix = new_points[: JOIN_INDEX + 1, :2]
                new_depths = new_prefix @ down_axis
                old_depth = float(np.max(old_depths) - old_depths[0])
                new_depth = float(np.max(new_depths) - new_depths[0])
                assert abs(new_depth - old_depth) < 0.002 * face_width
                depth_delta = np.diff(new_depths)
                maxima = sum(
                    depth_delta[index - 1] > 1e-8 and depth_delta[index] < -1e-8
                    for index in range(1, len(depth_delta))
                )
                assert maxima == 1

                boundary_outward = _temporal_boundary_outward(
                    landmarks,
                    side,
                    new_prefix[0],
                    outward_axis,
                    down_axis,
                )
                endpoint_outward = float(new_prefix[0] @ outward_axis)
                join_outward = float(new_prefix[-1] @ outward_axis)
                assert endpoint_outward >= join_outward - 1e-6

                assert _turn_at(new_points, JOIN_INDEX) < 0.04
                assert not _has_self_intersection(new_points)
                assert not _curves_intersect(new_points, eye_polygon)
            for first_index, first_name in enumerate(names):
                for second_name in names[first_index + 1 :]:
                    assert not _curves_intersect(
                        new_mapped[first_name], new_mapped[second_name]
                    )
        assert max(frame_extensions) > 0.020 * face_width
