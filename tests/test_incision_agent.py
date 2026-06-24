import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from langerface.agent import plan_incision_case
from langerface.anatomy import classify_region
from langerface.incision import (
    annotate_candidate_sensitive_distances,
    evaluate_guardrails,
    fusiform_cutaneous_incision,
    linear_subcutaneous_incision,
)
from langerface.lines import Atlas, AtlasLine, query_direction
from langerface.tumor import TumorInput

ROOT = Path(__file__).resolve().parents[1]


def _simple_mesh_and_atlas():
    vertices = np.array(
        [
            [0.0, 0.0, 0.0],
            [10.0, 0.0, 0.0],
            [0.0, 10.0, 0.0],
            [10.0, 10.0, 0.0],
        ],
        dtype=float,
    )
    triangles = np.array([[0, 1, 2], [1, 3, 2]], dtype=int)
    atlas = Atlas(
        system="rstl",
        lines=[
            AtlasLine(
                "horizontal_rstl",
                "cheek",
                np.array(
                    [
                        [0, 0.7, 0.1],
                        [0, 0.35, 0.45],
                        [0, 0.0, 0.8],
                    ],
                    dtype=float,
                ),
            )
        ],
    )
    return vertices, triangles, atlas


def _left_tip_angle_deg(candidate: dict) -> float:
    outline = [np.asarray(p, dtype=float) for p in candidate["outline"]]
    tip = outline[0]
    upper = outline[1] - tip
    lower = outline[-1] - tip
    cosang = float(np.dot(upper, lower) / (np.linalg.norm(upper) * np.linalg.norm(lower)))
    return float(np.degrees(np.arccos(np.clip(cosang, -1.0, 1.0))))


def test_query_direction_reads_nearest_rstl_tangent():
    vertices, triangles, atlas = _simple_mesh_and_atlas()
    result = query_direction([4.0, 2.0, 0.0], vertices, triangles, atlas)
    assert result.source == "rstl_atlas_weighted_nearest"
    assert result.confidence > 0.5
    assert result.support_count >= 1
    assert abs(result.vector[0]) > 0.95
    assert abs(result.vector[1]) < 0.2


def test_query_direction_is_stable_across_static_repeated_queries():
    vertices, triangles, atlas = _simple_mesh_and_atlas()
    angles = [
        query_direction([4.0, 2.0, 0.0], vertices, triangles, atlas).angle_deg
        for _ in range(100)
    ]
    assert max(angles) - min(angles) < 1e-9


def test_query_direction_returns_low_confidence_far_from_atlas():
    vertices, triangles, atlas = _simple_mesh_and_atlas()
    result = query_direction([10.0, 10.0, 0.0], vertices, triangles, atlas)
    assert result.confidence < 0.1
    assert result.source == "rstl_atlas_weighted_nearest"


def test_query_direction_js_python_parity_for_same_points():
    if shutil.which("node") is None:
        pytest.skip("node is required for JS/Python direction parity")

    vertices, triangles, atlas = _simple_mesh_and_atlas()
    py_result = query_direction([4.0, 2.0, 0.0], vertices, triangles, atlas)
    script = """
      import { __incisionToolsForTests as T } from './web/incision_tools.js';
      const verts = [[0,0,0],[10,0,0],[0,10,0],[10,10,0]];
      const tris = [[0,1,2],[1,3,2]];
      const atlas = { system: 'rstl', lines: [{
        name: 'horizontal_rstl',
        region: 'cheek',
        points: [[0,0.7,0.1],[0,0.35,0.45],[0,0.0,0.8]],
      }]};
      const result = T.queryDirection([4,2,0], verts, tris, atlas);
      console.log(JSON.stringify(result));
    """
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    js_result = json.loads(proc.stdout)
    assert abs(js_result["angle_deg"] - py_result.angle_deg) < 1e-6
    assert abs(js_result["confidence"] - py_result.confidence) < 1e-6
    assert js_result["source"] == py_result.source
    assert js_result["support_count"] == py_result.support_count


def test_linear_subcutaneous_candidate_uses_rstl_axis_and_length_rules():
    direction = {"vector": [1, 0, 0], "confidence": 0.9}
    tumor = TumorInput(kind="subcutaneous", center=(4, 2, 0), diameter_mm=10, depth_mm=5)
    candidate = linear_subcutaneous_incision(tumor, direction, units_per_mm=0.1)
    assert candidate["type"] == "linear"
    assert candidate["length_mm"] == 12.5
    assert np.allclose(candidate["endpoints"][0], [3.375, 2.0, 0.0])
    assert np.allclose(candidate["endpoints"][1], [4.625, 2.0, 0.0])


def test_fusiform_cutaneous_candidate_has_three_to_one_default_ratio():
    direction = {"vector": [1, 0, 0], "confidence": 0.9}
    tumor = TumorInput(kind="cutaneous", center=(4, 2, 0), diameter_mm=8, margin_mm=2)
    candidate = fusiform_cutaneous_incision(tumor, direction, units_per_mm=0.1)
    assert candidate["type"] == "fusiform"
    assert candidate["width_mm"] == 12
    assert candidate["length_mm"] == 36
    assert 2.99 < candidate["metrics"]["length_to_width_ratio"] < 3.01
    assert 29.9 < candidate["tip_angle_deg"] < 30.1
    assert candidate["metrics"]["profile"] == "cubic_hermite_tip_angle_constrained"
    assert candidate["metrics"]["tip_angle_target_deg"] == 30.0
    assert candidate["metrics"]["tip_angle_error_deg"] < 1e-6
    assert 29.0 < _left_tip_angle_deg(candidate) < 32.0
    assert len(candidate["outline"]) > 20


def test_fusiform_cutaneous_candidate_uses_freehand_boundary_extent():
    direction = {"vector": [1, 0, 0], "confidence": 0.9}
    tumor = TumorInput(
        kind="cutaneous",
        center=(4, 2, 0),
        diameter_mm=8,
        margin_mm=1,
        boundary=((3, 2, 0), (4, 3, 0), (7, 2, 0), (4, 1, 0)),
        boundary_mode="freehand",
        boundary_source="manual_freehand",
    )
    candidate = fusiform_cutaneous_incision(tumor, direction, units_per_mm=0.1)
    assert candidate["metrics"]["boundary_used"] is True
    assert candidate["metrics"]["boundary_axis_diameter_mm"] > 35
    assert candidate["center"][0] > 4
    assert candidate["length_mm"] >= candidate["metrics"]["boundary_axis_diameter_mm"] + 2
    assert candidate["provenance"]["boundary_source"] == "manual_freehand"


@pytest.mark.parametrize(
    ("point", "region"),
    [
        ([3.0, 6.0, 0.0], "lower_eyelid"),
        ([5.0, 3.0, 0.0], "lip_vermilion"),
        ([4.2, 4.6, 0.0], "nasal_ala"),
    ],
)
def test_guardrails_flag_sensitive_regions(point, region):
    vertices, _, _ = _simple_mesh_and_atlas()
    anatomy = classify_region(point, vertices)
    candidate = {"direction_confidence": 0.8}
    guardrails = evaluate_guardrails(candidate, anatomy)
    assert anatomy.region == region
    assert guardrails["passed"] is False
    assert guardrails["warnings"][0]["severity"] == "high"


def test_guardrails_track_rstl_deviation_override_reason():
    anatomy = {"region": "cheek", "confidence": 0.8}
    candidate = {
        "type": "linear",
        "direction_confidence": 0.9,
        "metrics": {"rstl_deviation_deg": 22},
        "provenance": {"clinician_edit": {"reason": "manual free-margin protection"}},
    }
    guardrails = evaluate_guardrails(candidate, anatomy)
    assert guardrails["passed"] is True
    warning = next(w for w in guardrails["warnings"] if w["code"] == "rstl_deviation_override")
    assert warning["severity"] == "medium"


def test_guardrails_flag_near_sensitive_free_margin_distance():
    vertices, _, _ = _simple_mesh_and_atlas()
    anatomy = classify_region([3.0, 6.0, 0.0], vertices)
    assert anatomy.free_margin_distance_mm is not None
    guardrails = evaluate_guardrails({"type": "linear", "direction_confidence": 0.9}, anatomy)
    assert any(w["code"] == "near_sensitive_free_margin" for w in guardrails["warnings"])


def test_guardrails_flag_candidate_geometry_near_sensitive_free_margin():
    vertices, _, _ = _simple_mesh_and_atlas()
    candidate = {
        "type": "linear",
        "direction_confidence": 0.9,
        "polyline": [[2.9, 5.9, 0.0], [4.5, 5.9, 0.0]],
        "metrics": {"rstl_deviation_deg": 0},
    }
    annotate_candidate_sensitive_distances(candidate, vertices)
    assert candidate["metrics"]["sensitive_free_margin_min_distance_mm"] < 5
    assert candidate["metrics"]["sensitive_free_margin_nearest"] == "left_lower_eyelid"
    guardrails = evaluate_guardrails(candidate, {"region": "cheek", "confidence": 0.8})
    assert any(w["code"] == "candidate_near_sensitive_free_margin" for w in guardrails["warnings"])
    assert guardrails["passed"] is False


def test_anatomy_classifier_covers_representative_stage2_regions():
    vertices, _, _ = _simple_mesh_and_atlas()
    cases = {
        "forehead": [5.0, 8.6, 0.0],
        "ear_region": [0.8, 5.5, 0.0],
        "temple_cheek": [1.8, 6.8, 0.0],
        "upper_eyelid": [3.0, 7.2, 0.0],
        "lower_eyelid": [3.0, 6.0, 0.0],
        "inner_canthus": [5.0, 6.0, 0.0],
        "nasal_dorsum": [5.0, 5.2, 0.0],
        "nasal_ala": [4.2, 4.6, 0.0],
        "nasal_tip": [5.0, 4.2, 0.0],
        "nasolabial_fold": [3.0, 4.1, 0.0],
        "cheek": [7.0, 5.0, 0.0],
        "lip_vermilion": [5.0, 3.0, 0.0],
        "upper_lip": [5.0, 3.7, 0.0],
        "oral_commissure": [3.4, 3.1, 0.0],
        "chin": [5.0, 1.6, 0.0],
        "jawline": [2.0, 2.4, 0.0],
    }
    observed = {name: classify_region(point, vertices).region for name, point in cases.items()}
    assert observed == {name: name for name in cases}


def test_tumor_input_preserves_boundary_metadata():
    tumor = TumorInput(
        kind="cutaneous",
        center=(4, 2, 0),
        diameter_mm=8,
        margin_mm=2,
        boundary=((3, 2, 0), (4, 3, 0), (5, 2, 0)),
        boundary_mode="freehand",
        boundary_source="manual_freehand",
        author="clinician",
        units="mm",
    )
    data = tumor.to_dict()
    assert data["boundary_mode"] == "freehand"
    assert data["boundary_source"] == "manual_freehand"
    assert data["author"] == "clinician"
    assert data["units"] == "mm"


def test_plan_incision_case_returns_trace_without_llm_provider():
    vertices, triangles, atlas = _simple_mesh_and_atlas()
    result = plan_incision_case(
        {"kind": "subcutaneous", "center": [4, 2, 0], "diameter_mm": 10, "depth_mm": 5},
        vertices,
        triangles,
        atlas,
        use_llm=False,
    )
    assert result["candidate"]["type"] == "linear"
    assert [step["action"] for step in result["trace"]] == [
        "classify_region",
        "query_rstl_direction",
        "linear_subcutaneous_incision",
        "evaluate_guardrails",
    ]
    assert result["provider"]["mode"] == "deterministic_fallback"
    assert result["agent_trace_mode"] == "single_turn_react_with_deterministic_tools"
    assert any(tool["name"] == "evaluate_guardrails" for tool in result["tool_schemas"])
    assert any(tool["name"] == "save_review_record" for tool in result["tool_schemas"])


def test_clinical_rules_asset_has_region_provenance_and_required_fields():
    rules = json.loads((ROOT / "assets" / "clinical_rules_face_incision.json").read_text())
    assert rules["version"] == "0.2-agentic-incision"
    assert rules["review_status"] == "draft_not_clinically_validated"
    assert rules["clinician_review_required"] is True
    for key in ["source", "last_reviewed_at", "medical_boundary"]:
        assert rules[key]

    expected_regions = {
        "forehead",
        "ear_region",
        "periorbital",
        "upper_eyelid",
        "lower_eyelid",
        "inner_canthus",
        "nasal_dorsum",
        "nasal_ala",
        "nasal_tip",
        "cheek",
        "nasolabial_fold",
        "temple_cheek",
        "lip_vermilion",
        "upper_lip",
        "oral_commissure",
        "chin",
        "jawline",
    }
    assert set(rules["region_rules"]) == expected_regions

    for region, rule in rules["region_rules"].items():
        assert rule["recommended_direction"], region
        assert rule["priority_order"], region
        assert rule["clinician_note"], region
        assert isinstance(rule["warnings"], list), region
        assert rule["source"], region
        assert rule["review_status"] == "draft_not_clinically_validated", region
        assert rule["last_reviewed_at"], region


def test_agent_tool_schema_and_privacy_doc_cover_review_export():
    schema = json.loads((ROOT / "assets" / "agentic_incision_tool_schema.json").read_text())
    names = {tool["name"] for tool in schema["tools"]}
    assert {
        "classify_region",
        "query_rstl_direction",
        "linear_subcutaneous_incision",
        "fusiform_cutaneous_incision",
        "evaluate_guardrails",
        "clinician_edit_candidate",
        "save_review_record",
    } <= names
    privacy = (ROOT / "docs" / "INCISION_PRIVACY_AUDIT.md").read_text()
    assert "原始照片、视频帧和摄像头画面不发送" in privacy
    assert "raw_image_sent=false" in privacy
