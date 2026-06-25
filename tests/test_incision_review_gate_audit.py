import copy
import json
import subprocess
import sys
from pathlib import Path

from tools.audit_incision_review_gate import audit_payloads, audit_review_record

ROOT = Path(__file__).resolve().parents[1]


def _record(
    *,
    status: str = "approved_for_discussion",
    reviewer: str = "coded-reviewer-1",
    notes: str = "reviewed for research discussion",
    high_codes: list[str] | None = None,
    trace_gate_passed: bool = True,
    approval_ready: bool = True,
    live_overlay_ready: bool = True,
) -> dict:
    high_codes = high_codes or []
    warnings = [{"code": code, "severity": "high", "message": code} for code in high_codes]
    return {
        "schema_version": "incision-review-record/v0.3",
        "id": "candidate-review-gate-fixture",
        "label": "审阅 gate fixture",
        "review_status": status,
        "review": {
            "status": status,
            "reviewer": reviewer,
            "notes": notes,
            "confirmation_scope": "research_candidate_only_not_surgical_order",
        },
        "candidate": {
            "type": "linear",
            "polyline": [[-1, 0, 0], [1, 0, 0]],
            "metrics": {"rstl_deviation_deg": 0},
            "provenance": {
                "generator": "linear_subcutaneous_incision",
                "candidate_version": 1,
                "edit_history": [],
            },
        },
        "candidate_edit_session": {
            "schema_version": "candidate-edit-session/v0.1",
            "candidate_version": 1,
            "edit_count": 0,
            "current_edit_id": None,
            "undo_available": False,
            "redo_available": False,
            "source": "web/incision_agent",
            "history": [],
        },
        "guardrails": {"passed": not high_codes, "warnings": warnings, "suggested_overrides": []},
        "guardrail_summary": {
            "passed": not high_codes,
            "high_count": len(high_codes),
            "high_codes": high_codes,
            "medium_count": 0,
            "medium_codes": [],
        },
        "agent_trace_gate": {
            "schema_version": "agent-trace-gate/v0.1",
            "passed": trace_gate_passed,
            "missing_actions": [] if trace_gate_passed else [{"key": "guardrails"}],
        },
        "review_gate": {
            "reviewer_required": status == "approved_for_discussion",
            "reviewer_present": bool(reviewer),
            "notes_required_for_high_guardrails": status == "approved_for_discussion" and bool(high_codes),
            "notes_present": bool(notes),
            "high_guardrail_codes": high_codes,
            "agent_trace_gate_passed": trace_gate_passed,
            "approval_ready": approval_ready,
            "live_overlay_ready": live_overlay_ready,
            "reason": "approved_candidate_ready_for_research_overlay",
        },
    }


def _cutaneous_record() -> dict:
    boundary = [
        [3.0, 2.0, 0.0],
        [3.5, 2.8, 0.0],
        [4.2, 3.1, 0.0],
        [4.8, 2.7, 0.0],
        [5.0, 2.0, 0.0],
        [4.0, 1.4, 0.0],
    ]
    record = _record()
    record["tumor"] = {
        "kind": "cutaneous",
        "center": [4.0, 2.0, 0.0],
        "diameter_mm": 8.0,
        "depth_mm": None,
        "margin_mm": 2.0,
        "boundary": boundary,
        "boundary_mode": "freehand",
        "boundary_source": "manual_freehand",
        "source": "manual_web_agent",
        "author": "clinician",
        "units": "mm",
    }
    record["tumor_quality"] = {
        "passed": True,
        "warning_count": 0,
        "warnings": [],
        "source": "manual_web_agent",
        "boundary_source": "manual_freehand",
        "author_present": True,
        "units": "mm",
    }
    record["candidate"] = {
        "type": "fusiform",
        "axis": [1.0, 0.0, 0.0],
        "polyline": [[-1, 0, 0], [1, 0, 0], [1, 1, 0], [-1, 1, 0]],
        "metrics": {
            "rstl_deviation_deg": 0,
            "boundary_point_count": len(boundary),
            "boundary_axis_diameter_mm": 21.66666666666666,
            "boundary_perp_diameter_mm": 18.66666666666667,
            "boundary_area_mm2": 207.49999999999997,
            "boundary_area_ratio_to_diameter_disk": 4.1280813364460345,
            "boundary_self_intersection": False,
            "boundary_center_shift_mm": 3.4359213546813843,
        },
        "provenance": {
            "generator": "fusiform_cutaneous_incision",
            "candidate_version": 1,
            "edit_history": [],
        },
    }
    record["tumor_boundary_summary"] = {
        "mode": "freehand",
        "source": "manual_freehand",
        "point_count": len(boundary),
        "boundary_used": True,
        "units_per_mm": 0.1,
        "summary_axis": [1.0, 0.0, 0.0],
        "summary_normal": [0.0, 0.0, 1.0],
        "center": [4.083333333333333, 2.3333333333333335, 0.0],
        "axis_diameter_mm": 21.66666666666666,
        "perp_diameter_mm": 18.66666666666667,
        "area_mm2": 207.49999999999997,
        "area_ratio_to_diameter_disk": 4.1280813364460345,
        "self_intersection": False,
        "center_shift_mm": 3.4359213546813843,
        "aspect_ratio": 1.1607142857142851,
    }
    return record


def _edited_record() -> dict:
    record = _record()
    edit_1 = {
        "kind": "clinician_adjustment",
        "edit_id": "edit_v2_first",
        "resulting_candidate_version": 2,
        "angle_offset_deg": -5,
        "length_scale": 1,
        "width_scale": 1,
        "shift_along_mm": 0,
        "shift_perp_mm": 0,
        "reason": "manual scar camouflage",
        "interaction": "control_change",
    }
    edit_2 = {
        "kind": "clinician_adjustment",
        "edit_id": "edit_v3_second",
        "resulting_candidate_version": 3,
        "angle_offset_deg": 10,
        "length_scale": 1.1,
        "width_scale": 1,
        "shift_along_mm": 2,
        "shift_perp_mm": 0,
        "reason": "manual clinician preference",
        "interaction": "endpoint_drag",
    }
    record["candidate"]["provenance"] = {
        "generator": "linear_subcutaneous_incision",
        "source_candidate_id": "linear_subcutaneous_candidate",
        "parent_candidate_id": "linear_subcutaneous_candidate",
        "candidate_version": 3,
        "clinician_edit": edit_2,
        "edit_history": [edit_1, edit_2],
    }
    record["candidate_edit_session"] = {
        "schema_version": "candidate-edit-session/v0.1",
        "candidate_version": 3,
        "edit_count": 2,
        "current_edit_id": "edit_v3_second",
        "undo_available": True,
        "redo_available": False,
        "source": "web/incision_agent",
        "history": [
            {
                "edit_id": edit_1["edit_id"],
                "resulting_candidate_version": edit_1["resulting_candidate_version"],
                "angle_offset_deg": edit_1["angle_offset_deg"],
                "length_scale": edit_1["length_scale"],
                "width_scale": edit_1["width_scale"],
                "shift_along_mm": edit_1["shift_along_mm"],
                "shift_perp_mm": edit_1["shift_perp_mm"],
                "reason": edit_1["reason"],
                "interaction": edit_1["interaction"],
            },
            {
                "edit_id": edit_2["edit_id"],
                "resulting_candidate_version": edit_2["resulting_candidate_version"],
                "angle_offset_deg": edit_2["angle_offset_deg"],
                "length_scale": edit_2["length_scale"],
                "width_scale": edit_2["width_scale"],
                "shift_along_mm": edit_2["shift_along_mm"],
                "shift_perp_mm": edit_2["shift_perp_mm"],
                "reason": edit_2["reason"],
                "interaction": edit_2["interaction"],
            },
        ],
    }
    return record


def test_review_gate_audit_accepts_ready_approved_record():
    report = audit_review_record(_record())

    assert report["schema_version"] == "incision-review-gate-audit/v0.1"
    assert report["passed"] is True
    assert report["issue_count"] == 0
    assert report["expected_review_gate"]["live_overlay_ready"] is True


def test_review_gate_audit_accepts_multi_step_candidate_edit_session():
    report = audit_review_record(_edited_record())

    assert report["passed"] is True
    assert report["issue_count"] == 0


def test_review_gate_audit_flags_missing_candidate_edit_session():
    record = _record()
    del record["candidate_edit_session"]

    report = audit_review_record(record)
    codes = {issue["code"] for issue in report["issues"]}

    assert report["passed"] is False
    assert "candidate_edit_session_missing" in codes


def test_review_gate_audit_flags_candidate_edit_version_mismatch():
    record = _edited_record()
    record["candidate_edit_session"]["candidate_version"] = 2

    report = audit_review_record(record)
    codes = {issue["code"] for issue in report["issues"]}

    assert report["passed"] is False
    assert "candidate_edit_session_mismatch" in codes


def test_review_gate_audit_flags_candidate_edit_history_version_mismatch():
    record = _edited_record()
    record["candidate"]["provenance"]["edit_history"][1]["resulting_candidate_version"] = 2

    report = audit_review_record(record)
    codes = {issue["code"] for issue in report["issues"]}

    assert report["passed"] is False
    assert "candidate_edit_history_version_mismatch" in codes


def test_review_gate_audit_flags_candidate_current_edit_mismatch():
    record = _edited_record()
    record["candidate_edit_session"]["current_edit_id"] = "edit_v2_first"

    report = audit_review_record(record)
    codes = {issue["code"] for issue in report["issues"]}

    assert report["passed"] is False
    assert "candidate_edit_current_mismatch" in codes


def test_review_gate_audit_accepts_cutaneous_boundary_summary():
    report = audit_review_record(_cutaneous_record())

    assert report["passed"] is True
    assert report["issue_count"] == 0
    assert report["expected_tumor_quality"]["passed"] is True


def test_review_gate_audit_flags_missing_tumor_quality():
    record = _cutaneous_record()
    del record["tumor_quality"]

    report = audit_review_record(record)
    codes = {issue["code"] for issue in report["issues"]}

    assert report["passed"] is False
    assert "tumor_quality_missing" in codes


def test_review_gate_audit_flags_stale_tumor_quality_summary():
    record = _cutaneous_record()
    record["tumor"]["units"] = "cm"

    report = audit_review_record(record)
    codes = {issue["code"] for issue in report["issues"]}

    assert report["passed"] is False
    assert "tumor_quality_mismatch" in codes
    assert "tumor_quality_warnings_mismatch" in codes
    assert report["expected_tumor_quality"]["passed"] is False


def test_review_gate_audit_flags_invalid_tumor_quality_warnings():
    record = _cutaneous_record()
    record["tumor_quality"]["warnings"] = {"code": "not-a-list"}

    report = audit_review_record(record)
    codes = {issue["code"] for issue in report["issues"]}

    assert report["passed"] is False
    assert "tumor_quality_invalid" in codes


def test_review_gate_audit_flags_missing_cutaneous_boundary_summary():
    record = _cutaneous_record()
    del record["tumor_boundary_summary"]

    report = audit_review_record(record)
    codes = {issue["code"] for issue in report["issues"]}

    assert report["passed"] is False
    assert "tumor_boundary_summary_missing" in codes


def test_review_gate_audit_flags_boundary_summary_mismatch():
    record = _cutaneous_record()
    record["tumor_boundary_summary"]["area_mm2"] = 99.0

    report = audit_review_record(record)
    mismatches = [issue for issue in report["issues"] if issue["code"] == "tumor_boundary_summary_mismatch"]

    assert report["passed"] is False
    assert {issue["path"] for issue in mismatches} >= {"tumor_boundary_summary.area_mm2"}


def test_review_gate_audit_flags_boundary_candidate_metric_mismatch():
    record = _cutaneous_record()
    record["candidate"]["metrics"]["boundary_axis_diameter_mm"] = 10.0

    report = audit_review_record(record)
    codes = {issue["code"] for issue in report["issues"]}

    assert report["passed"] is False
    assert "tumor_boundary_candidate_metric_mismatch" in codes


def test_review_gate_audit_flags_approved_record_without_reviewer():
    record = _record(reviewer="", approval_ready=False, live_overlay_ready=False)

    report = audit_review_record(record)
    codes = {issue["code"] for issue in report["issues"]}

    assert report["passed"] is False
    assert "approved_candidate_missing_reviewer" in codes


def test_review_gate_audit_flags_high_guardrail_without_notes():
    record = _record(
        notes="",
        high_codes=["near_sensitive_free_margin"],
        approval_ready=False,
        live_overlay_ready=False,
    )

    report = audit_review_record(record)
    codes = {issue["code"] for issue in report["issues"]}

    assert report["passed"] is False
    assert "approved_high_guardrail_missing_notes" in codes
    assert report["expected_review_gate"]["notes_required_for_high_guardrails"] is True


def test_review_gate_audit_flags_pending_candidate_marked_live_ready():
    record = _record(
        status="pending_clinician_confirmation",
        reviewer="",
        notes="",
        approval_ready=False,
        live_overlay_ready=False,
    )
    record["review_gate"]["live_overlay_ready"] = True

    report = audit_review_record(record)
    codes = {issue["code"] for issue in report["issues"]}

    assert report["passed"] is False
    assert "review_gate_field_mismatch" in codes
    assert "live_overlay_without_clinician_approval" in codes


def test_review_gate_audit_flags_live_ready_when_agent_trace_gate_failed():
    record = _record(trace_gate_passed=False, approval_ready=False, live_overlay_ready=False)
    record["review_gate"]["agent_trace_gate_passed"] = True
    record["review_gate"]["approval_ready"] = True
    record["review_gate"]["live_overlay_ready"] = True

    report = audit_review_record(record)
    codes = {issue["code"] for issue in report["issues"]}

    assert report["passed"] is False
    assert "live_overlay_without_agent_trace_gate" in codes
    assert "review_gate_field_mismatch" in codes


def test_review_gate_audit_reads_review_export_and_cli(tmp_path: Path):
    safe = _record()
    unsafe = copy.deepcopy(safe)
    unsafe["id"] = "candidate-unsafe"
    unsafe["review_status"] = "rejected_by_clinician"
    unsafe["review"]["status"] = "rejected_by_clinician"
    unsafe["review_gate"]["live_overlay_ready"] = True
    export = {
        "schema_version": "incision-review-export/v0.3",
        "current": safe,
        "saved": [unsafe],
    }

    summary = audit_payloads([export], sources=["review-export.json"])
    assert summary["record_count"] == 2
    assert summary["passed"] is False
    assert summary["failed_count"] == 1

    input_path = tmp_path / "review_export.json"
    output_path = tmp_path / "review_gate_audit.json"
    input_path.write_text(json.dumps(export), encoding="utf-8")
    proc = subprocess.run(
        [
            sys.executable,
            "tools/audit_incision_review_gate.py",
            str(input_path),
            "--output",
            str(output_path),
        ],
        cwd=ROOT,
        text=True,
    )
    assert proc.returncode == 1
    cli_report = json.loads(output_path.read_text(encoding="utf-8"))
    assert cli_report["schema_version"] == "incision-review-gate-audit-summary/v0.1"
    assert cli_report["failed_count"] == 1
