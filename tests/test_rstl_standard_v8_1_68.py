from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

from build_field_atlas_standard_v1 import build  # noqa: E402
from langerface.config import CANONICAL_OBJ  # noqa: E402
from langerface.geometry import CanonicalFaceModel  # noqa: E402
from langerface.lines import Atlas  # noqa: E402

NEW_REGION = "lateral_canthus_short_arc_v65"
CHANGED_V67_LINES = {
    "standard_field_0103_cross",
    "standard_field_0104_cross",
    "standard_field_0149_cross",
}
NEW_V68_LINES = {
    f"standard_field_{index:04d}_{side}"
    for index in range(162, 166)
    for side in ("right", "left")
}


def _atlas_payload(canonical: CanonicalFaceModel, reference_path: Path, output: Path) -> dict:
    reference = json.loads(reference_path.read_text(encoding="utf-8"))
    atlas = build(canonical, reference)
    atlas.save(str(output))
    return json.loads(output.read_text(encoding="utf-8"))


def _normalized_lines(canonical: CanonicalFaceModel, atlas: Atlas) -> dict[str, np.ndarray]:
    projection = canonical.project_front()
    origin, size = canonical.face_frame()
    restored: dict[str, np.ndarray] = {}
    for line in atlas.lines:
        triangles = canonical.triangles[line.tris()]
        barycentric = line.bary()
        points = (
            barycentric[:, 0, None] * projection[triangles[:, 0]]
            + barycentric[:, 1, None] * projection[triangles[:, 1]]
            + barycentric[:, 2, None] * projection[triangles[:, 2]]
        )
        restored[line.name] = (points - origin) / size
    return restored


def _orientation(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    ab, ac = b - a, c - a
    return float(ab[0] * ac[1] - ab[1] * ac[0])


def _segments_intersect(a: np.ndarray, b: np.ndarray, c: np.ndarray, d: np.ndarray) -> bool:
    o1, o2 = _orientation(a, b, c), _orientation(a, b, d)
    o3, o4 = _orientation(c, d, a), _orientation(c, d, b)
    return o1 * o2 < -1e-12 and o3 * o4 < -1e-12


def _crossing_pairs(curves: dict[str, np.ndarray]) -> set[tuple[str, str]]:
    cell_size = 0.025
    grid: dict[tuple[int, int], list[tuple[str, int, np.ndarray, np.ndarray]]] = {}
    checked: set[tuple[str, int, str, int]] = set()
    crossings: set[tuple[str, str]] = set()
    for name, points in curves.items():
        for segment_index, (start, end) in enumerate(zip(points[:-1], points[1:])):
            low = np.floor(np.minimum(start, end) / cell_size).astype(int)
            high = np.floor(np.maximum(start, end) / cell_size).astype(int)
            cells = [
                (x, y)
                for x in range(int(low[0]), int(high[0]) + 1)
                for y in range(int(low[1]), int(high[1]) + 1)
            ]
            for cell in cells:
                for other_name, other_segment, other_start, other_end in grid.get(cell, []):
                    if other_name == name:
                        continue
                    key = (other_name, other_segment, name, segment_index)
                    if key in checked:
                        continue
                    checked.add(key)
                    if _segments_intersect(other_start, other_end, start, end):
                        crossings.add(tuple(sorted((other_name, name))))
            record = (name, segment_index, start, end)
            for cell in cells:
                grid.setdefault(cell, []).append(record)
    return crossings


def test_v8_1_68_adds_lateral_canthus_arcs_and_extends_under_eye_lines(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v67_payload = _atlas_payload(
        canonical,
        ROOT / "assets" / "rstl_standard_reference_v8_1_67.json",
        tmp_path / "atlas_v67.json",
    )
    v68_reference_path = ROOT / "assets" / "rstl_standard_reference_v8_1_68.json"
    assert json.loads(v68_reference_path.read_text(encoding="utf-8"))["atlasVersion"] == "8.1.68"
    v68_payload = _atlas_payload(
        canonical,
        v68_reference_path,
        tmp_path / "atlas_v68.json",
    )
    official = json.loads((ROOT / "assets" / "atlas_rstl.json").read_text(encoding="utf-8"))

    assert official["validated"] is False
    assert official["atlasVersion"] == "8.1.68"
    assert v68_payload["atlasVersion"] == "8.1.68"
    assert len(official["lines"]) == 141
    assert sum(len(line["points"]) for line in official["lines"]) == 14804
    assert official["lines"][-1]["name"] == "standard_field_0165_left"
    assert (ROOT / "web" / "assets" / "atlas_rstl.json").read_bytes() == (
        ROOT / "assets" / "atlas_rstl.json"
    ).read_bytes()

    for actual, expected in zip(v68_payload["lines"], official["lines"], strict=True):
        assert actual["name"] == expected["name"]
        assert actual["region"] == expected["region"]
        actual_points = np.asarray(actual["points"], dtype=np.float64)
        expected_points = np.asarray(expected["points"], dtype=np.float64)
        np.testing.assert_array_equal(actual_points[:, 0], expected_points[:, 0])
        np.testing.assert_allclose(actual_points[:, 1:], expected_points[:, 1:], atol=1e-6, rtol=0.0)

    v67_by_name = {line["name"]: line for line in v67_payload["lines"]}
    v68_by_name = {line["name"]: line for line in v68_payload["lines"]}
    assert set(v68_by_name) - set(v67_by_name) == NEW_V68_LINES
    changed = {
        name
        for name in set(v67_by_name) & set(v68_by_name)
        if v67_by_name[name] != v68_by_name[name]
    }
    assert changed == CHANGED_V67_LINES
    assert {v68_by_name[name]["region"] for name in NEW_V68_LINES} == {NEW_REGION}

    v67_norm = _normalized_lines(canonical, Atlas.load(str(tmp_path / "atlas_v67.json")))
    v68_norm = _normalized_lines(canonical, Atlas.load(str(tmp_path / "atlas_v68.json")))
    assert _crossing_pairs(v68_norm) == _crossing_pairs(v67_norm)
    assert not any(NEW_V68_LINES.intersection(pair) for pair in _crossing_pairs(v68_norm))

    for index in range(162, 166):
        right = v68_norm[f"standard_field_{index:04d}_right"]
        left = v68_norm[f"standard_field_{index:04d}_left"]
        assert right[0, 0] < 0.031
        assert right[-1, 0] > 0.204
        assert right[0, 1] - right[-1, 1] > 0.030
        midpoint = len(right) // 2
        outer_rise = right[0, 1] - right[midpoint, 1]
        inner_rise = right[midpoint, 1] - right[-1, 1]
        assert inner_rise > outer_rise
        mirrored_right = right.copy()
        mirrored_right[:, 0] = 1.0 - mirrored_right[:, 0]
        np.testing.assert_allclose(mirrored_right, left, atol=1e-6, rtol=0.0)

    for name in CHANGED_V67_LINES:
        extended = v68_norm[name]
        assert np.min(extended[:, 0]) < 0.031
        assert np.max(extended[:, 0]) > 0.969
