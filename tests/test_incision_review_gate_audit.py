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


def test_review_gate_audit_accepts_ready_approved_record():
    report = audit_review_record(_record())

    assert report["schema_version"] == "incision-review-gate-audit/v0.1"
    assert report["passed"] is True
    assert report["issue_count"] == 0
    assert report["expected_review_gate"]["live_overlay_ready"] is True


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
