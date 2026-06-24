import json
from pathlib import Path

import numpy as np

from langerface.agent import plan_incision_case
from langerface.anatomy import classify_region
from langerface.incision import (
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


def test_query_direction_reads_nearest_rstl_tangent():
    vertices, triangles, atlas = _simple_mesh_and_atlas()
    result = query_direction([4.0, 2.0, 0.0], vertices, triangles, atlas)
    assert result.source == "rstl_atlas_nearest"
    assert result.confidence > 0.5
    assert abs(result.vector[0]) > 0.95
    assert abs(result.vector[1]) < 0.2


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
    assert len(candidate["outline"]) > 20


def test_guardrails_flag_sensitive_regions():
    vertices, _, _ = _simple_mesh_and_atlas()
    anatomy = classify_region([3.0, 6.0, 0.0], vertices)
    candidate = {"direction_confidence": 0.8}
    guardrails = evaluate_guardrails(candidate, anatomy)
    assert anatomy.region == "lower_eyelid"
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


def test_clinical_rules_asset_has_region_provenance_and_required_fields():
    rules = json.loads((ROOT / "assets" / "clinical_rules_face_incision.json").read_text())
    assert rules["version"] == "0.2-agentic-incision"
    assert rules["review_status"] == "draft_not_clinically_validated"
    assert rules["clinician_review_required"] is True
    for key in ["source", "last_reviewed_at", "medical_boundary"]:
        assert rules[key]

    expected_regions = {
        "forehead",
        "periorbital",
        "lower_eyelid",
        "nasal_ala",
        "cheek",
        "temple_cheek",
        "lip_vermilion",
        "chin",
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
