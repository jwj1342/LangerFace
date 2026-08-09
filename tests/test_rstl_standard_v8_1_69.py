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

LATERAL_REGION = "supraorbital_lateral_short_arc_v66"
MEDIAL_REGION = "supraorbital_medial_short_arc_v66"
NEW_V69_LINES = {
    f"standard_field_{index:04d}_{side}"
    for index in range(166, 175)
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


def test_v8_1_69_adds_symmetric_supraorbital_short_arc_bundles(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v68_payload = _atlas_payload(
        canonical,
        ROOT / "assets" / "rstl_standard_reference_v8_1_68.json",
        tmp_path / "atlas_v68.json",
    )
    v69_reference = ROOT / "assets" / "rstl_standard_reference_v8_1_69.json"
    assert json.loads(v69_reference.read_text(encoding="utf-8"))["atlasVersion"] == "8.1.69"
    v69_payload = _atlas_payload(canonical, v69_reference, tmp_path / "atlas_v69.json")
    official = json.loads((ROOT / "assets" / "atlas_rstl.json").read_text(encoding="utf-8"))

    assert official["validated"] is False
    assert official["atlasVersion"] == "8.1.69"
    assert v69_payload["atlasVersion"] == "8.1.69"
    assert len(official["lines"]) == 159
    assert sum(len(line["points"]) for line in official["lines"]) == 15272
    assert official["lines"][-1]["name"] == "standard_field_0174_left"
    assert official == v69_payload
    assert (ROOT / "web" / "assets" / "atlas_rstl.json").read_bytes() == (
        ROOT / "assets" / "atlas_rstl.json"
    ).read_bytes()

    v68_by_name = {line["name"]: line for line in v68_payload["lines"]}
    v69_by_name = {line["name"]: line for line in v69_payload["lines"]}
    assert set(v69_by_name) - set(v68_by_name) == NEW_V69_LINES
    assert all(v69_by_name[name] == line for name, line in v68_by_name.items())
    assert sum(line["region"] == LATERAL_REGION for line in official["lines"]) == 8
    assert sum(line["region"] == MEDIAL_REGION for line in official["lines"]) == 10

    v68_norm = _normalized_lines(canonical, Atlas.load(str(tmp_path / "atlas_v68.json")))
    v69_norm = _normalized_lines(canonical, Atlas.load(str(tmp_path / "atlas_v69.json")))
    assert _crossing_pairs(v69_norm) == _crossing_pairs(v68_norm)
    assert not any(NEW_V69_LINES.intersection(pair) for pair in _crossing_pairs(v69_norm))

    for index in range(166, 175):
        right = v69_norm[f"standard_field_{index:04d}_right"]
        left = v69_norm[f"standard_field_{index:04d}_left"]
        mirrored_right = right.copy()
        mirrored_right[:, 0] = 1.0 - mirrored_right[:, 0]
        np.testing.assert_allclose(mirrored_right, left, atol=1e-6, rtol=0.0)
        assert right[0, 1] - right[-1, 1] > 0.020

    for index in range(166, 170):
        lateral = v69_norm[f"standard_field_{index:04d}_right"]
        assert np.min(lateral[:, 0]) < 0.036
        assert np.max(lateral[:, 0]) > 0.169
        assert np.ptp(lateral[:, 0]) > 4.0 * np.ptp(lateral[:, 1])

    for index in range(170, 175):
        medial = v69_norm[f"standard_field_{index:04d}_right"]
        rank = index - 170
        assert 0.260 + 0.024 * rank < np.min(medial[:, 0]) < 0.270 + 0.024 * rank
        assert 0.304 + 0.024 * rank < np.max(medial[:, 0]) < 0.306 + 0.024 * rank
        assert np.ptp(medial[:, 1]) > np.ptp(medial[:, 0])
