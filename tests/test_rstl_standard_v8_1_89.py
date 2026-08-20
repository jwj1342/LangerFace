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
JOIN_INDEX = 45
EYE_INDICES = {
    "right": (33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246),
    "left": (263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466),
}
TEMPORAL_BOUNDARY_INDICES = {
    "right": (127, 162, 21, 54, 103, 67, 109, 10),
    "left": (356, 389, 251, 284, 332, 297, 338, 10),
}


def _temporal_boundary_outward(
    landmarks: np.ndarray,
    side: str,
    endpoint: np.ndarray,
    outward_axis: np.ndarray,
    down_axis: np.ndarray,
) -> float:
    boundary = landmarks[list(TEMPORAL_BOUNDARY_INDICES[side]), :2]
    boundary_down = boundary @ down_axis
    boundary_outward = boundary @ outward_axis
    endpoint_down = float(endpoint @ down_axis)
    candidates = []
    for index in range(len(boundary) - 1):
        down0 = float(boundary_down[index])
        down1 = float(boundary_down[index + 1])
        if endpoint_down < min(down0, down1) or endpoint_down > max(down0, down1):
            continue
        ratio = (
            (endpoint_down - down0) / (down1 - down0)
            if abs(down1 - down0) > 1e-9
            else 0.5
        )
        candidates.append(
            float(boundary_outward[index])
            + ratio * float(boundary_outward[index + 1] - boundary_outward[index])
        )
    if candidates:
        return max(candidates)
    nearest_index = int(np.argmin(np.abs(boundary_down - endpoint_down)))
    return float(boundary_outward[nearest_index])


def test_v8_1_89_returns_orbital_brow_tails_inside_temples(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v88_payload = _atlas_payload(
        canonical,
        ROOT / "assets/rstl_standard_reference_v8_1_88.json",
        tmp_path / "atlas_v88.json",
    )
    v89_payload = _atlas_payload(
        canonical,
        ROOT / "assets/rstl_standard_reference_v8_1_89.json",
        tmp_path / "atlas_v89.json",
    )
    assert v89_payload["atlasVersion"] == "8.1.89"
    assert v89_payload["validated"] is False
    assert len(v89_payload["lines"]) == 190
    assert sum(len(line["points"]) for line in v89_payload["lines"]) == 18_258

    old_lines = {line["name"]: line for line in v88_payload["lines"]}
    new_lines = {line["name"]: line for line in v89_payload["lines"]}
    changed_names = {name for name in new_lines if new_lines[name] != old_lines[name]}
    assert changed_names == TARGET_NAMES
    for name in set(new_lines) - TARGET_NAMES:
        assert new_lines[name] == old_lines[name]
    for name in TARGET_NAMES:
        assert new_lines[name]["region"] == TARGET_REGION
        assert new_lines[name]["postMapTemporalAbsoluteEndpoint"] is True
        assert new_lines[name]["postMapTemporalCubicFaceRatio"][0] == JOIN_INDEX
        old_body = dict(old_lines[name])
        new_body = dict(new_lines[name])
        old_body.pop("postMapTemporalCubicFaceRatio")
        new_body.pop("postMapTemporalCubicFaceRatio")
        new_body.pop("postMapTemporalAbsoluteEndpoint")
        assert new_body == old_body

    outward_controls = [
        new_lines[f"standard_field_{source_index:04d}_right"][
            "postMapTemporalCubicFaceRatio"
        ][1][0]
        for source_index in TARGET_SOURCE_ORDER
    ]
    assert np.all(np.diff(outward_controls) < -0.0019)
    assert outward_controls[0] - outward_controls[-1] >= 0.018

    old_atlas = Atlas.load(str(tmp_path / "atlas_v88.json"))
    new_atlas = Atlas.load(str(tmp_path / "atlas_v89.json"))
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
                inward_return = float(
                    (old_points[0, :2] - new_points[0, :2]) @ outward_axis
                )
                boundary_outward = _temporal_boundary_outward(
                    landmarks,
                    side,
                    new_points[0, :2],
                    outward_axis,
                    down_axis,
                )
                endpoint_outward = float(new_points[0, :2] @ outward_axis)
                join_outward = float(new_points[JOIN_INDEX, :2] @ outward_axis)
                available_boundary_space = boundary_outward - join_outward
                prefix_depths = new_points[: JOIN_INDEX + 1, :2] @ down_axis
                deepest_index = int(np.argmax(prefix_depths))
                assert inward_return > 0.06 * face_width
                if available_boundary_space >= 0.02 * face_width:
                    assert boundary_outward - endpoint_outward >= 0.0199 * face_width
                else:
                    assert abs(endpoint_outward - join_outward) < 1e-6
                assert 1 < deepest_index < JOIN_INDEX - 1
                assert prefix_depths[deepest_index] - prefix_depths[0] > 0.003 * face_width
                assert prefix_depths[deepest_index] - prefix_depths[-1] > 0.005 * face_width
                assert _turn_at(new_points, JOIN_INDEX) < 0.04
                assert not _has_self_intersection(new_points)
                assert not _curves_intersect(new_points, eye_polygon)
            for first_index, first_name in enumerate(names):
                for second_name in names[first_index + 1 :]:
                    assert not _curves_intersect(
                        new_mapped[first_name], new_mapped[second_name]
                    )
