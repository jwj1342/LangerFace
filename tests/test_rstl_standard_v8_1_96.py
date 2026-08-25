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
TARGET_REGIONS = {
    "cheek_long_arc_fan_v24",
    "cheek_long_arc_density_v41",
    "cheek_lower_divergent_arc_v44",
    "cheek_alar_gap_fill_v95",
}


def test_v8_1_96_reflows_only_intermediate_alar_roots(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    v95_payload = _atlas_payload(
        canonical,
        ROOT / "assets/rstl_standard_reference_v8_1_95.json",
        tmp_path / "atlas_v95.json",
    )
    v96_payload = _atlas_payload(
        canonical,
        ROOT / "assets/rstl_standard_reference_v8_1_96.json",
        tmp_path / "atlas_v96.json",
    )
    official = json.loads((ROOT / "assets/atlas_rstl.json").read_text(encoding="utf-8"))

    assert official == v96_payload
    assert official["atlasVersion"] == "8.1.96"
    assert official["validated"] is False
    assert len(official["lines"]) == 204
    assert sum(len(line["points"]) for line in official["lines"]) == 19_030
    old = {line["name"]: line for line in v95_payload["lines"]}
    new = {line["name"]: line for line in v96_payload["lines"]}
    changed = {name for name in new if new[name] != old[name]}
    assert len(changed) == 32
    assert {new[name]["region"] for name in changed} <= TARGET_REGIONS
    for name in set(new) - changed:
        assert new[name] == old[name]
    assert (ROOT / "web/assets/atlas_rstl.json").read_bytes() == (
        ROOT / "assets/atlas_rstl.json"
    ).read_bytes()


def test_v8_1_96_roots_are_uniform_mirrored_and_crossing_free(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    _atlas_payload(
        canonical,
        ROOT / "assets/rstl_standard_reference_v8_1_95.json",
        tmp_path / "atlas_v95.json",
    )
    old_mapped = map_atlas(
        Atlas.load(str(tmp_path / "atlas_v95.json")),
        canonical.project_front(),
        canonical.triangles,
    )
    new_mapped = map_atlas(
        Atlas.load(str(ROOT / "assets/atlas_rstl.json")),
        canonical.project_front(),
        canonical.triangles,
    )
    old_by_name = {line.name: line for line in old_mapped}
    targets = [line for line in new_mapped if line.region in TARGET_REGIONS]
    baseline = [line for line in new_mapped if line.region not in TARGET_REGIONS]
    assert len(targets) == 36

    right = sorted(
        [line for line in targets if line.name.endswith("_right")],
        key=lambda line: float(line.pts[0, 1]),
    )
    left = sorted(
        [line for line in targets if line.name.endswith("_left")],
        key=lambda line: float(line.pts[0, 1]),
    )
    origin, scale = canonical.face_frame()
    roots = np.asarray([(line.pts[0, :2] - origin) / scale for line in right])
    gaps = np.linalg.norm(np.diff(roots, axis=0), axis=1)
    assert float(gaps.max() / gaps.min()) < 1.03
    for right_line, left_line in zip(right, left, strict=True):
        np.testing.assert_allclose(
            left_line.pts[:, 0],
            2.0 * origin[0] + scale[0] - right_line.pts[:, 0],
            atol=3e-6,
        )
        np.testing.assert_allclose(left_line.pts[:, 1:], right_line.pts[:, 1:], atol=3e-6)
    for line in targets:
        np.testing.assert_array_equal(line.pts[-1], old_by_name[line.name].pts[-1])
        assert not _has_self_intersection(line.pts)
    for index, first in enumerate(targets):
        assert all(not _curves_intersect(first.pts, old.pts) for old in baseline)
        for second in targets[index + 1 :]:
            assert not _curves_intersect(first.pts, second.pts)


def test_v8_1_96_preserves_non_target_runtime_geometry(tmp_path):
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    _atlas_payload(
        canonical,
        ROOT / "assets/rstl_standard_reference_v8_1_95.json",
        tmp_path / "atlas_v95.json",
    )
    old_atlas = Atlas.load(str(tmp_path / "atlas_v95.json"))
    new_atlas = Atlas.load(str(ROOT / "assets/atlas_rstl.json"))
    frames = json.loads(
        (ROOT / "web/test/expected.json").read_text(encoding="utf-8")
    )["frames"]

    for frame in frames:
        landmarks = np.asarray(frame["landmarks"], dtype=np.float64)
        old = {
            line.name: line
            for line in map_atlas(old_atlas, landmarks, canonical.triangles)
        }
        new = {
            line.name: line
            for line in map_atlas(new_atlas, landmarks, canonical.triangles)
        }
        for name, new_line in new.items():
            if new_line.region in TARGET_REGIONS:
                continue
            np.testing.assert_array_equal(new_line.pts, old[name].pts)
            np.testing.assert_array_equal(new_line.tris, old[name].tris)
