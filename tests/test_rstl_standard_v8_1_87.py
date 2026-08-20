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
from test_rstl_standard_v8_1_70 import _atlas_payload  # noqa: E402
from test_rstl_standard_v8_1_75 import _curves_intersect, _has_self_intersection  # noqa: E402
from test_rstl_standard_v8_1_76 import _new_crossings_relative_to_baseline  # noqa: E402

EXPECTED_LINE_COUNT = 190
EXPECTED_POINT_COUNT = 18_258
TARGET_REGION = "orbital_brow_upturn_v11"
PRESERVED_ABOVE_BROW_REGION = "supraorbital_medial_short_arc_v69"
TARGET_SOURCE_ORDER = (105, 106, 154, 107, 155, 108, 109)
EXPECTED_CHANGED_NAMES = {
    f"standard_field_{source_index:04d}_{side}"
    for source_index in TARGET_SOURCE_ORDER
    for side in ("right", "left")
}
EXPECTED_JOIN_INDICES = {105: 38, 106: 38, 154: 38, 107: 38, 155: 38, 108: 39, 109: 39}
EYE_INDICES = {
    "right": (33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246),
    "left": (263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466),
}


def _turn_at(points: np.ndarray, point_index: int) -> float:
    incoming = points[point_index, :2] - points[point_index - 1, :2]
    outgoing = points[point_index + 1, :2] - points[point_index, :2]
    cosine = float(incoming @ outgoing / (np.linalg.norm(incoming) * np.linalg.norm(outgoing)))
    return float(np.arccos(np.clip(cosine, -1.0, 1.0)))


def test_v8_1_87_curves_orbital_brow_tails_toward_temples(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v86_path = ROOT / "assets/rstl_standard_reference_v8_1_86.json"
    v87_path = ROOT / "assets/rstl_standard_reference_v8_1_87.json"
    v86_payload = _atlas_payload(canonical, v86_path, tmp_path / "atlas_v86.json")
    v87_payload = _atlas_payload(canonical, v87_path, tmp_path / "atlas_v87.json")
    assert v87_payload["atlasVersion"] == "8.1.87"
    assert v87_payload["validated"] is False
    assert len(v87_payload["lines"]) == EXPECTED_LINE_COUNT
    assert sum(len(line["points"]) for line in v87_payload["lines"]) == EXPECTED_POINT_COUNT

    old_lines = {line["name"]: line for line in v86_payload["lines"]}
    new_lines = {line["name"]: line for line in v87_payload["lines"]}
    changed_names = {name for name in new_lines if new_lines[name] != old_lines[name]}
    assert changed_names == EXPECTED_CHANGED_NAMES
    for name in set(new_lines) - changed_names:
        assert new_lines[name] == old_lines[name]
    for source_index in TARGET_SOURCE_ORDER:
        right_name = f"standard_field_{source_index:04d}_right"
        left_name = f"standard_field_{source_index:04d}_left"
        right = new_lines[right_name]
        left = new_lines[left_name]
        assert right["region"] == left["region"] == TARGET_REGION
        assert right["points"] == old_lines[right_name]["points"]
        assert left["points"] == old_lines[left_name]["points"]
        right_spec = right["postMapTemporalCubicFaceRatio"]
        left_spec = left["postMapTemporalCubicFaceRatio"]
        assert right_spec[0] == left_spec[0] == EXPECTED_JOIN_INDICES[source_index]
        np.testing.assert_allclose(left_spec[1:], right_spec[1:], atol=1e-10, rtol=0.0)

    old_atlas = Atlas.load(str(tmp_path / "atlas_v86.json"))
    new_atlas = Atlas.load(str(tmp_path / "atlas_v87.json"))
    preserved_above_brow_names = {
        line.name
        for line in new_atlas.lines
        if line.region == PRESERVED_ABOVE_BROW_REGION
    }
    assert len(preserved_above_brow_names) == 10
    frames = json.loads((ROOT / "web/test/expected.json").read_text(encoding="utf-8"))["frames"]
    for frame in frames:
        frame_landmarks = np.asarray(frame["landmarks"], dtype=np.float64)
        old_frame = {
            line.name: line.pts
            for line in map_atlas(old_atlas, frame_landmarks, canonical.triangles)
        }
        new_frame = {
            line.name: line.pts
            for line in map_atlas(new_atlas, frame_landmarks, canonical.triangles)
        }
        for name in preserved_above_brow_names:
            np.testing.assert_array_equal(new_frame[name], old_frame[name])
        assert not _new_crossings_relative_to_baseline(
            old_frame, new_frame, changed_names
        )
        face_width = float(np.ptp(frame_landmarks[:, 0]))
        right_axis = frame_landmarks[263, :2] - frame_landmarks[33, :2]
        right_axis /= np.linalg.norm(right_axis)
        down_axis = frame_landmarks[152, :2] - frame_landmarks[10, :2]
        down_axis -= float(down_axis @ right_axis) * right_axis
        down_axis /= np.linalg.norm(down_axis)
        for side in ("right", "left"):
            outward_axis = -right_axis if side == "right" else right_axis
            names = [
                f"standard_field_{index:04d}_{side}"
                for index in TARGET_SOURCE_ORDER
            ]
            eye_polygon = np.vstack(
                (
                    frame_landmarks[list(EYE_INDICES[side]), :2],
                    frame_landmarks[EYE_INDICES[side][0], :2],
                )
            )
            endpoint_depths = []
            for source_index, name in zip(TARGET_SOURCE_ORDER, names, strict=True):
                old_points = old_frame[name]
                new_points = new_frame[name]
                extension = float(
                    (new_points[0, :2] - old_points[0, :2]) @ outward_axis
                )
                assert extension >= 0.029 * face_width
                assert _turn_at(new_points, EXPECTED_JOIN_INDICES[source_index]) < 0.04
                assert not _has_self_intersection(new_points)
                assert not _curves_intersect(new_points, eye_polygon)
                endpoint_depths.append(float(new_points[0, :2] @ down_axis))
            assert np.all(np.diff(endpoint_depths) > 0.004 * face_width)
            for first_index, first_name in enumerate(names):
                for second_name in names[first_index + 1 :]:
                    assert not _curves_intersect(
                        new_frame[first_name], new_frame[second_name]
                    )
