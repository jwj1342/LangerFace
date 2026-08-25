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
from langerface.lines import Atlas, MappedLine, map_atlas  # noqa: E402
from langerface.rendering.occlusion import BackfaceCuller  # noqa: E402
from test_rstl_standard_v8_1_70 import _atlas_payload, _normalized_lines  # noqa: E402
from test_rstl_standard_v8_1_75 import _cross  # noqa: E402
from test_rstl_standard_v8_1_76 import _new_crossings_relative_to_baseline  # noqa: E402
from test_rstl_standard_v8_1_78 import ENDPOINT_ORDER  # noqa: E402

EXPECTED_LINE_COUNT = 206
EXPECTED_POINT_COUNT = 19_058
EXPECTED_CHANGED_NAMES = {
    f"standard_field_{source_index:04d}_{side}"
    for source_index in ENDPOINT_ORDER
    for side in ("right", "left")
}
EXPECTED_HIDDEN_PROJECTION_CROSSING = {
    ("standard_field_0119_right", "standard_field_0180_right")
}


def _endpoint_metrics(curves: dict[str, np.ndarray]) -> tuple[float, float]:
    endpoints = np.asarray(
        [curves[f"standard_field_{source_index:04d}_right"][0, :2] for source_index in ENDPOINT_ORDER]
    )
    gaps = np.linalg.norm(np.diff(endpoints, axis=0), axis=1)
    return float(np.std(gaps) / np.mean(gaps)), float(np.max(gaps) / np.min(gaps))


def _visible_curves_intersect(
    first: MappedLine,
    second: MappedLine,
    visible_triangles: np.ndarray,
) -> bool:
    first_start = first.pts[:-1, None, :2]
    first_end = first.pts[1:, None, :2]
    second_start = second.pts[None, :-1, :2]
    second_end = second.pts[None, 1:, :2]
    intersects = (
        (_cross(first_end - first_start, second_start - first_start)
         * _cross(first_end - first_start, second_end - first_start) < -1e-12)
        & (_cross(second_end - second_start, first_start - second_start)
           * _cross(second_end - second_start, first_end - second_start) < -1e-12)
    )
    first_visible = visible_triangles[first.tris[:-1]] & visible_triangles[first.tris[1:]]
    second_visible = visible_triangles[second.tris[:-1]] & visible_triangles[second.tris[1:]]
    return bool(np.any(intersects & first_visible[:, None] & second_visible[None, :]))


def test_v8_1_79_moves_every_cheek_alar_endpoint_and_preserves_visible_topology(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v78_path = ROOT / "assets" / "rstl_standard_reference_v8_1_78.json"
    v79_path = ROOT / "assets" / "rstl_standard_reference_v8_1_79.json"
    v78_payload = _atlas_payload(canonical, v78_path, tmp_path / "atlas_v78.json")
    v79_payload = _atlas_payload(canonical, v79_path, tmp_path / "atlas_v79.json")

    assert v79_payload["atlasVersion"] == "8.1.79"
    assert v79_payload["validated"] is False
    assert len(v79_payload["lines"]) == EXPECTED_LINE_COUNT
    assert sum(len(line["points"]) for line in v79_payload["lines"]) == EXPECTED_POINT_COUNT

    changed_names = {
        old["name"]
        for old, new in zip(v78_payload["lines"], v79_payload["lines"], strict=True)
        if old != new
    }
    assert changed_names == EXPECTED_CHANGED_NAMES
    for old, new in zip(v78_payload["lines"], v79_payload["lines"], strict=True):
        if old["name"] not in changed_names:
            assert new == old

    old_atlas = Atlas.load(str(tmp_path / "atlas_v78.json"))
    new_atlas = Atlas.load(str(tmp_path / "atlas_v79.json"))
    old_normalized = _normalized_lines(canonical, old_atlas)
    new_normalized = _normalized_lines(canonical, new_atlas)
    for name in EXPECTED_CHANGED_NAMES:
        displacement = np.linalg.norm(new_normalized[name][0, :2] - old_normalized[name][0, :2])
        assert displacement >= 0.0008, f"{name} endpoint did not visibly move: {displacement}"

    old_cv, old_ratio = _endpoint_metrics(old_normalized)
    new_cv, new_ratio = _endpoint_metrics(new_normalized)
    assert new_cv <= 0.70 * old_cv
    assert new_ratio <= 0.45 * old_ratio
    assert not _new_crossings_relative_to_baseline(
        old_normalized,
        new_normalized,
        changed_names,
    )

    frames = json.loads((ROOT / "web/test/expected.json").read_text())["frames"]
    for frame_index, frame in enumerate(frames):
        landmarks = np.asarray(frame["landmarks"], dtype=np.float64)
        old_lines = map_atlas(old_atlas, landmarks, canonical.triangles)
        new_lines = map_atlas(new_atlas, landmarks, canonical.triangles)
        old_mapped = {line.name: line for line in old_lines}
        new_mapped = {line.name: line for line in new_lines}
        for name in EXPECTED_CHANGED_NAMES:
            displacement_px = np.linalg.norm(
                new_mapped[name].pts[0, :2] - old_mapped[name].pts[0, :2]
            )
            assert displacement_px >= 0.05, (
                f"frame {frame_index} {name} endpoint did not move in image space: {displacement_px}"
            )

        old_xy = {name: line.pts[:, :2] for name, line in old_mapped.items()}
        new_xy = {name: line.pts[:, :2] for name, line in new_mapped.items()}
        crossings = _new_crossings_relative_to_baseline(old_xy, new_xy, changed_names)
        if frame_index < 2:
            assert not crossings
        else:
            assert crossings == EXPECTED_HIDDEN_PROJECTION_CROSSING
            visible = BackfaceCuller(canonical.triangles).visible_triangles(landmarks)
            for first_name, second_name in crossings:
                assert not _visible_curves_intersect(
                    new_mapped[first_name],
                    new_mapped[second_name],
                    visible,
                )

        old_metrics = _endpoint_metrics(old_xy)
        new_metrics = _endpoint_metrics(new_xy)
        assert new_metrics[0] < old_metrics[0]
        assert new_metrics[1] < old_metrics[1]
