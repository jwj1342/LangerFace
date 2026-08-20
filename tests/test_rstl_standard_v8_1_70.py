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
from langerface.lines import Atlas, map_atlas  # noqa: E402

LATERAL_REGION = "supraorbital_lateral_short_arc_v67"
MEDIAL_REGION = "supraorbital_medial_short_arc_v67"
CORRECTED_V70_LINES = {
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


def _crossing_pairs(
    curves: dict[str, np.ndarray], *, cell_size: float = 0.025
) -> set[tuple[str, str]]:
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


def test_v8_1_70_moves_short_arcs_above_brows_and_reverses_transition(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v69_payload = _atlas_payload(
        canonical,
        ROOT / "assets" / "rstl_standard_reference_v8_1_69.json",
        tmp_path / "atlas_v69.json",
    )
    v70_reference = ROOT / "assets" / "rstl_standard_reference_v8_1_70.json"
    assert json.loads(v70_reference.read_text(encoding="utf-8"))["atlasVersion"] == "8.1.70"
    v70_payload = _atlas_payload(canonical, v70_reference, tmp_path / "atlas_v70.json")

    assert v70_payload["validated"] is False
    assert v70_payload["atlasVersion"] == "8.1.70"
    assert len(v70_payload["lines"]) == 159
    assert sum(len(line["points"]) for line in v70_payload["lines"]) == 15282
    assert v70_payload["lines"][-1]["name"] == "standard_field_0174_left"

    v69_by_name = {line["name"]: line for line in v69_payload["lines"]}
    v70_by_name = {line["name"]: line for line in v70_payload["lines"]}
    assert set(v70_by_name) == set(v69_by_name)
    assert all(
        v70_by_name[name] == line
        for name, line in v69_by_name.items()
        if name not in CORRECTED_V70_LINES
    )
    assert all(v70_by_name[name] != v69_by_name[name] for name in CORRECTED_V70_LINES)
    assert sum(line["region"] == LATERAL_REGION for line in v70_payload["lines"]) == 8
    assert sum(line["region"] == MEDIAL_REGION for line in v70_payload["lines"]) == 10

    v69_norm = _normalized_lines(canonical, Atlas.load(str(tmp_path / "atlas_v69.json")))
    v70_norm = _normalized_lines(canonical, Atlas.load(str(tmp_path / "atlas_v70.json")))
    assert not any(CORRECTED_V70_LINES.intersection(pair) for pair in _crossing_pairs(v70_norm))
    assert _crossing_pairs(v70_norm) == _crossing_pairs(v69_norm)

    for index in range(166, 175):
        right = v70_norm[f"standard_field_{index:04d}_right"]
        left = v70_norm[f"standard_field_{index:04d}_left"]
        mirrored_right = right.copy()
        mirrored_right[:, 0] = 1.0 - mirrored_right[:, 0]
        np.testing.assert_allclose(mirrored_right, left, atol=1e-6, rtol=0.0)

    for index in range(170, 175):
        medial = v70_norm[f"standard_field_{index:04d}_right"]
        lower_tangent = medial[3] - medial[0]
        upper_tangent = medial[-1] - medial[-4]
        assert abs(lower_tangent[0]) > 2.0 * abs(lower_tangent[1])
        assert abs(upper_tangent[0]) < 0.35 * abs(upper_tangent[1])
        assert medial[-1, 1] < medial[0, 1]

    expected = json.loads((ROOT / "web" / "test" / "expected.json").read_text())
    landmarks = np.asarray(expected["frames"][0]["landmarks"], dtype=np.float64)
    mapped = map_atlas(
        Atlas.load(str(tmp_path / "atlas_v70.json")),
        landmarks,
        canonical.triangles,
    )
    axis = landmarks[10, :2] - landmarks[9, :2]
    axis /= np.linalg.norm(axis)
    for side, brow_indices in (
        ("right", (63, 66, 70, 105, 107)),
        ("left", (293, 296, 300, 334, 336)),
    ):
        brow_height = np.max((landmarks[list(brow_indices), :2] - landmarks[9, :2]) @ axis)
        corrected = [
            line
            for line in mapped
            if line.region in {LATERAL_REGION, MEDIAL_REGION} and line.name.endswith(side)
        ]
        assert len(corrected) == 9
        for line in corrected:
            line_height = (line.pts[:, :2] - landmarks[9, :2]) @ axis
            assert np.min(line_height) > brow_height
