"""图谱数据完整性。"""
import os

import numpy as np
import pytest
from tools.annotate_atlas import DraftLines, next_annotated_name
from tools.annotate_atlas import _save as save_annotation_draft

from langerface.config import ATLAS_PATHS, TOPOLOGY_ID, TOPOLOGY_VERSION
from langerface.lines import Atlas, AtlasLine, atlas_line_from_points2d


def test_validate_catches_bad_index():
    bad = Atlas(system="rstl", lines=[
        AtlasLine("x", "r", np.array([[999, 0.3, 0.3], [999, 0.2, 0.2]], dtype=float)),
    ])
    issues = bad.validate(num_triangles=100)
    assert any("越界" in s for s in issues)


def test_validate_catches_short_line():
    short = Atlas(system="rstl", lines=[
        AtlasLine("x", "r", np.array([[0, 0.3, 0.3]], dtype=float)),
    ])
    issues = short.validate(num_triangles=100)
    assert any("点数" in s for s in issues)


def test_roundtrip(tmp_path):
    a = Atlas(system="rstl", lines=[
        AtlasLine(
            "l0",
            "forehead",
            np.array([[0, 0.5, 0.3], [1, 0.2, 0.2]], dtype=float),
            disable_runtime_expansion=True,
            post_map_smoothing_passes=32,
            post_map_cubic_fairing=True,
            post_map_temporal_cubic_face_ratio=(
                1,
                (-0.17, -0.04),
                (-0.14, 0.04),
                (-0.06, 0.01),
            ),
            post_map_temporal_absolute_endpoint=True,
            post_map_temporal_boundary_margin_face_ratio=-0.012,
        ),
    ],
        atlas_version="8.1.67",
        provenance="test",
        validated=True,
        clinical_validation={
            "schemaVersion": "atlas-clinical-validation/v0.1",
            "reviewer": "clinician-01",
        },
    )
    p = tmp_path / "atlas.json"
    a.save(str(p))
    b = Atlas.load(str(p))
    assert b.system == "rstl" and b.atlas_version == "8.1.67" and b.validated is True
    assert b.topology_id == TOPOLOGY_ID and b.topology_version == TOPOLOGY_VERSION
    assert b.clinical_validation == {
        "schemaVersion": "atlas-clinical-validation/v0.1",
        "reviewer": "clinician-01",
    }
    assert len(b.lines) == 1 and b.lines[0].points.shape == (2, 3)
    assert b.lines[0].disable_runtime_expansion is True
    assert b.lines[0].post_map_smoothing_passes == 32
    assert b.lines[0].post_map_cubic_fairing is True
    assert b.lines[0].post_map_temporal_cubic_face_ratio == (
        1,
        (-0.17, -0.04),
        (-0.14, 0.04),
        (-0.06, 0.01),
    )
    assert b.lines[0].post_map_temporal_absolute_endpoint is True
    assert b.lines[0].post_map_temporal_boundary_margin_face_ratio == -0.012


def test_save_normalizes_negative_zero(tmp_path):
    atlas = Atlas(system="rstl", lines=[
        AtlasLine("l0", "forehead", np.array([[0, -1e-12, 0.25], [1, 0.5, -1e-12]])),
    ])
    output = tmp_path / "atlas.json"
    atlas.save(str(output))

    assert "-0.0" not in output.read_text(encoding="utf-8")


def test_validate_catches_topology_mismatch():
    a = Atlas(system="rstl", topology_id="flame-2023", lines=[
        AtlasLine("l0", "forehead", np.array([[0, 0.5, 0.3], [1, 0.2, 0.2]], dtype=float)),
    ])
    issues = a.validate(num_triangles=100, expected_topology_id=TOPOLOGY_ID)
    assert any("拓扑" in s for s in issues)


def test_validate_catches_topology_version_mismatch():
    a = Atlas(system="rstl", topology_version="other", lines=[
        AtlasLine("l0", "forehead", np.array([[0, 0.5, 0.3], [1, 0.2, 0.2]], dtype=float)),
    ])
    issues = a.validate(num_triangles=100, expected_topology_version=TOPOLOGY_VERSION)
    assert any("拓扑版本" in s for s in issues)


def test_generated_atlases_valid(canonical):
    n_tri = len(canonical.triangles)
    for system, path in ATLAS_PATHS.items():
        if not os.path.exists(path):
            pytest.skip(f"{system} 图谱未生成（先跑 build_field_atlas.py）")
        atlas = Atlas.load(path)
        assert atlas.validate(
            n_tri,
            expected_topology_id=TOPOLOGY_ID,
            expected_topology_version=TOPOLOGY_VERSION,
        ) == [], f"{system} 图谱校验未通过"


def test_atlas_line_from_points2d_matches_locate(canonical):
    """辅助函数逐点结果应与 canonical.locate 完全一致，dtype/shape 固定。"""
    proj = canonical.project_front()
    # 直接取投影空间的若干顶点作为线点（已是 proj 坐标）。
    pts2d = proj[[0, 10, 50, 120, 200]]
    ln = atlas_line_from_points2d(canonical, "probe", "test", pts2d, proj=proj)
    assert isinstance(ln, AtlasLine)
    assert ln.name == "probe" and ln.region == "test"
    assert ln.points.shape == (len(pts2d), 3)
    assert ln.points.dtype == np.float64
    for i, p in enumerate(pts2d):
        tri, bary = canonical.locate(p, proj=proj)
        assert ln.points[i, 0] == tri
        assert ln.points[i, 1] == bary[0]
        assert ln.points[i, 2] == bary[1]


def test_atlas_line_from_points2d_equals_manual_loop(canonical):
    """合成归一化线经 norm_to_proj + 辅助函数，应与重构前的手写循环逐字节相等。"""
    proj = canonical.project_front()
    t = np.linspace(0, 1, 12)
    norm_pts = np.column_stack([0.3 + 0.4 * t, 0.2 + 0.6 * t])
    world = canonical.norm_to_proj(norm_pts)

    # 重构前的手写循环（build_initial_atlas / annotate_atlas 旧逻辑）。
    expected = np.zeros((len(world), 3), dtype=np.float64)
    for i, p in enumerate(world):
        tri, bary = canonical.locate(p, proj=proj)
        expected[i] = [tri, bary[0], bary[1]]

    ln = atlas_line_from_points2d(canonical, "x", "r", world, proj=proj)
    assert ln.points.dtype == expected.dtype
    assert np.array_equal(ln.points, expected)
    assert ln.points.tobytes() == expected.tobytes()


def test_annotation_save_preserves_loaded_lines_and_metadata_and_never_validates(canonical, tmp_path):
    proj = canonical.project_front()
    existing = Atlas(
        system="rstl",
        version="0.2",
        atlas_version="8.1.67",
        topology_id="custom-topology",
        topology_version="custom-topology-v2",
        provenance="existing draft.",
        validated=True,
    )
    original_surface_points = np.array(
        [[0, 0.2, 0.3], [1, 0.3, 0.2], [2, 0.4, 0.1]],
        dtype=np.float64,
    )
    completed = [
        {
            "name": "forehead-existing",
            "region": "forehead",
            "points": proj[[0, 10, 50]],
            "surface_points": original_surface_points,
        }
    ]
    output = tmp_path / "atlas.json"

    save_annotation_draft(
        canonical,
        proj,
        completed,
        "rstl",
        str(output),
        existing,
    )

    saved = Atlas.load(str(output))
    assert saved.validated is False
    assert saved.version == "0.2"
    assert saved.atlas_version == "8.1.67"
    assert saved.topology_id == "custom-topology"
    assert saved.topology_version == "custom-topology-v2"
    assert saved.lines[0].name == "forehead-existing"
    assert saved.lines[0].region == "forehead"
    assert np.array_equal(saved.lines[0].points, original_surface_points)
    assert "requires line-by-line clinical review" in saved.provenance


def test_annotation_save_assigns_name_and_region_to_new_line(canonical, tmp_path):
    proj = canonical.project_front()
    output = tmp_path / "atlas.json"
    points = proj[[0, 10, 50]]

    save_annotation_draft(
        canonical,
        proj,
        [{"name": "annotated_0000", "region": "cheek", "points": points}],
        "rstl",
        str(output),
    )

    saved = Atlas.load(str(output))
    assert saved.validated is False
    assert saved.lines[0].name == "annotated_0000"
    assert saved.lines[0].region == "cheek"


def _loaded_entry(name, region, surface_points, proj):
    return {
        "name": name,
        "region": region,
        "points": proj[[0, 10, 50]],
        "surface_points": np.asarray(surface_points, dtype=np.float64),
    }


# RongNianXin 在 #140 复核时要求的四个场景：d 键绝不能删掉已载入的官方曲线。
def test_pressing_delete_without_new_lines_leaves_loaded_lines_untouched(canonical):
    proj = canonical.project_front()
    loaded = [_loaded_entry("official-0", "forehead", [[0, 0.2, 0.3]], proj)]
    draft = DraftLines(loaded)

    assert draft.undo_last_drawn() is None
    assert draft.undo_last_drawn() is None
    assert [line["name"] for line in draft.all_lines()] == ["official-0"]


def test_delete_removes_only_the_line_drawn_in_this_session(canonical):
    proj = canonical.project_front()
    draft = DraftLines([_loaded_entry("official-0", "forehead", [[0, 0.2, 0.3]], proj)])
    drawn = draft.add("cheek", proj[[0, 10, 50]])

    assert draft.undo_last_drawn() is drawn
    assert draft.drawn == []
    assert [line["name"] for line in draft.all_lines()] == ["official-0"]


def test_delete_stops_at_loaded_lines_once_drawn_lines_are_gone(canonical):
    proj = canonical.project_front()
    loaded = [
        _loaded_entry("official-0", "forehead", [[0, 0.2, 0.3]], proj),
        _loaded_entry("official-1", "cheek", [[1, 0.3, 0.2]], proj),
    ]
    draft = DraftLines(loaded)
    draft.add("cheek", proj[[0, 10, 50]])
    draft.add("cheek", proj[[0, 10, 50]])

    assert draft.undo_last_drawn() is not None
    assert draft.undo_last_drawn() is not None
    for _ in range(3):
        assert draft.undo_last_drawn() is None
    assert [line["name"] for line in draft.all_lines()] == ["official-0", "official-1"]


def test_saving_after_deleting_new_lines_preserves_loaded_geometry(canonical, tmp_path):
    proj = canonical.project_front()
    surface = np.array([[0, 0.2, 0.3], [1, 0.3, 0.2], [2, 0.4, 0.1]], dtype=np.float64)
    draft = DraftLines([_loaded_entry("official-0", "forehead", surface, proj)])
    draft.add("cheek", proj[[0, 10, 50]])
    draft.undo_last_drawn()

    output = tmp_path / "atlas.json"
    save_annotation_draft(canonical, proj, draft.all_lines(), "rstl", str(output))

    saved = Atlas.load(str(output))
    assert saved.validated is False
    assert len(saved.lines) == 1
    assert saved.lines[0].name == "official-0"
    assert saved.lines[0].region == "forehead"
    assert np.array_equal(saved.lines[0].points, surface)


# 命名不能用 len(lines) 当序号：当既有编号恰好等于行数时会直接撞名，而
# atlas_clinical_review.py 要求线名唯一，到那一步才报错排查成本很高。
def test_new_line_name_does_not_collide_when_index_equals_line_count():
    # 1 条载入线、编号也是 1 —— len() 方案会再生成一次 annotated_0001
    draft = DraftLines([{"name": "annotated_0001"}])
    assert draft.add("cheek", None)["name"] == "annotated_0002"
    assert len({line["name"] for line in draft.all_lines()}) == 2


def test_new_line_name_continues_past_the_highest_existing_index():
    draft = DraftLines([{"name": "annotated_0007"}, {"name": "forehead-official"}])
    assert draft.add("cheek", None)["name"] == "annotated_0008"
    assert draft.add("cheek", None)["name"] == "annotated_0009"


def test_names_stay_unique_across_draw_delete_draw_sequences():
    draft = DraftLines([{"name": "annotated_0002"}, {"name": "cheek_long_arc_v24"}])
    seen = {line["name"] for line in draft.loaded}
    for _ in range(4):
        seen.add(draft.add("cheek", None)["name"])
        draft.undo_last_drawn()
        seen.add(draft.add("cheek", None)["name"])
    names = [line["name"] for line in draft.all_lines()]
    assert len(set(names)) == len(names), names


def test_next_annotated_name_ignores_unrelated_names():
    assert next_annotated_name([{"name": "cheek_long_arc_v24"}, {"name": ""}]) == "annotated_0000"
