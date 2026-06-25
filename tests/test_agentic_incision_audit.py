import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from tools.audit_agentic_incision_trace import audit_agentic_record, audit_payloads

from langerface.agent import plan_incision_case, plan_incision_session
from langerface.lines import Atlas, AtlasLine

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


def _plan() -> dict:
    vertices, triangles, atlas = _simple_mesh_and_atlas()
    return plan_incision_case(
        {"kind": "subcutaneous", "center": [4, 2, 0], "diameter_mm": 10, "depth_mm": 5},
        vertices,
        triangles,
        atlas,
        use_llm=False,
    )


def _review_record(plan: dict) -> dict:
    return {
        "schema_version": "incision-review-record/v0.3",
        "id": "review-1",
        "label": "审计测试候选",
        "tumor": plan["tumor"],
        "candidate": plan["candidate"],
        "guardrails": plan["guardrails"],
        "trace": plan["trace"],
        "agent_trace_gate": plan["agent_trace_gate"],
        "agent_react_plan": plan["agent_react_plan"],
        "agent_execution_events": plan["agent_execution_events"],
        "candidate_alternatives": plan["candidate_alternatives"],
        "candidate_comparison": plan["candidate_comparison"],
        "agent_orchestration_audit": plan["agent_orchestration_audit"],
        "llm": plan["llm"],
        "provider": plan["provider"],
        "provider_config": {"api_key_present": True, "api_key": "[redacted]"},
        "review_status": "pending_clinician_confirmation",
    }


def test_agentic_trace_audit_replays_valid_plan():
    plan = _plan()
    audit = audit_agentic_record(plan, source="plan-fixture")

    assert audit["schema_version"] == "agentic-incision-trace-audit/v0.1"
    assert audit["passed"] is True
    assert audit["failures"] == []
    assert audit["checks"]["trace_gate_replayed_passed"] is True
    assert audit["checks"]["stored_trace_gate_matches_replay"] is True
    assert audit["checks"]["react_plan_present"] is True
    assert audit["checks"]["react_plan_replayed_passed"] is True
    assert audit["checks"]["stored_react_plan_matches_replay"] is True
    assert audit["checks"]["execution_events_present"] is True
    assert audit["checks"]["execution_events_replayed_passed"] is True
    assert audit["checks"]["stored_execution_events_matches_replay"] is True
    assert audit["execution_events_replay"]["schema_version"] == "agent-execution-events/v0.1"
    assert audit["execution_events_replay"]["tool_event_count"] == len(plan["trace"])
    assert audit["react_plan_replay"]["schema_version"] == "agent-react-plan/v0.1"
    assert audit["react_plan_replay"]["step_count"] == 7
    assert audit["llm_boundary_audit"]["schema_version"] == "agentic-llm-boundary-audit/v0.1"
    assert audit["llm_boundary_audit"]["passed"] is True
    assert audit["checks"]["llm_summary_present"] is True
    assert audit["checks"]["llm_review_boundary_present"] is True
    assert audit["checks"]["provider_config_secret_redacted"] is True
    assert "preview_incision_on_face" in audit["trace_gate_replay"]["observed_actions"]
    assert audit["checks"]["candidate_comparison_replay_passed"] is True
    assert (
        audit["candidate_comparison_replay"]["expected_ranked_ids"]
        == audit["candidate_comparison_replay"]["observed_ranked_ids"]
    )
    assert len(audit["candidate_comparison_replay"]["observed_ranked_ids"]) == 3
    assert audit["orchestration_audit"]["candidate_count"] == 3


def test_agentic_trace_audit_detects_missing_required_tool():
    plan = _plan()
    plan["trace"] = [step for step in plan["trace"] if step.get("action") != "query_rstl_direction"]
    audit = audit_agentic_record(plan, source="broken-plan")

    assert audit["passed"] is False
    assert "trace_gate_replayed_passed" in audit["failures"]
    assert "stored_trace_gate_matches_replay" in audit["failures"]
    assert "stored_react_plan_matches_replay" in audit["failures"]
    assert "stored_execution_events_matches_replay" in audit["failures"]
    assert audit["trace_gate_replay"]["missing_actions"][0]["key"] == "rstl_direction"


def test_agentic_trace_audit_detects_tampered_react_plan():
    plan = _plan()
    plan["agent_react_plan"]["steps"][-1]["status"] = "completed"
    plan["agent_react_plan"]["steps"][-1]["trace_indexes"] = []
    audit = audit_agentic_record(plan, source="tampered-react-plan")

    assert audit["passed"] is False
    assert "stored_react_plan_matches_replay" in audit["failures"]
    assert audit["checks"]["react_plan_replayed_passed"] is True


def test_agentic_trace_audit_detects_tampered_execution_events():
    plan = _plan()
    plan["agent_execution_events"]["events"][1]["action"] = "classify_region"
    audit = audit_agentic_record(plan, source="tampered-execution-events")

    assert audit["passed"] is False
    assert "stored_execution_events_matches_replay" in audit["failures"]
    assert audit["checks"]["execution_events_replayed_passed"] is True


def test_agentic_trace_audit_detects_unsafe_llm_summary():
    plan = _plan()
    plan["llm"]["summary"] = "Safe to proceed with surgery; perform this incision."
    plan["llm"]["next_step"] = "No clinician review is needed."
    audit = audit_agentic_record(plan, source="unsafe-llm-summary")

    assert audit["passed"] is False
    assert "llm_no_forbidden_directive" in audit["failures"]
    assert audit["llm_boundary_audit"]["forbidden_directive_patterns"]


def test_agentic_trace_audit_detects_provider_secret_leak():
    plan = _plan()
    plan["provider_config"] = {
        "provider": "openai-compatible",
        "base_url": "https://example.invalid/v1",
        "api_key": "sk-test-not-redacted",
    }
    audit = audit_agentic_record(plan, source="provider-secret-leak")

    assert audit["passed"] is False
    assert "provider_config_secret_redacted" in audit["failures"]
    assert "provider_config.api_key" in audit["llm_boundary_audit"]["secret_leak_paths"]


def test_agentic_trace_audit_detects_raw_llm_payload():
    plan = _plan()
    plan["llm"]["raw"] = {"choices": [{"message": {"content": "raw provider payload"}}]}
    audit = audit_agentic_record(plan, source="raw-llm-payload")

    assert audit["passed"] is False
    assert "llm_no_raw_provider_payload" in audit["failures"]
    assert "raw" in audit["llm_boundary_audit"]["raw_payload_paths"]


def test_agentic_trace_audit_reads_review_export_and_cli(tmp_path: Path):
    plan = _plan()
    payload = {
        "schema_version": "incision-review-export/v0.3",
        "current": _review_record(plan),
        "saved": [],
    }
    summary = audit_payloads([payload], sources=["export-fixture.json"])
    assert summary["passed"] is True
    assert summary["record_count"] == 1
    assert summary["records"][0]["input_schema_version"] == "incision-review-record/v0.3"

    input_path = tmp_path / "review_export.json"
    output_path = tmp_path / "agent_audit.json"
    input_path.write_text(json.dumps(payload), encoding="utf-8")
    subprocess.run(
        [
            sys.executable,
            "tools/audit_agentic_incision_trace.py",
            str(input_path),
            "--output",
            str(output_path),
        ],
        cwd=ROOT,
        check=True,
    )
    cli_summary = json.loads(output_path.read_text(encoding="utf-8"))
    assert cli_summary["schema_version"] == "agentic-incision-trace-audit-summary/v0.1"
    assert cli_summary["passed_count"] == 1


def test_agentic_trace_audit_expands_multi_round_session(tmp_path: Path):
    vertices, triangles, atlas = _simple_mesh_and_atlas()
    session = plan_incision_session(
        {"kind": "subcutaneous", "center": [4, 2, 0], "diameter_mm": 10, "depth_mm": 5},
        vertices,
        triangles,
        atlas,
        rounds=[
            {"round_id": "initial", "trigger": "initial_plan"},
            {
                "round_id": "revised",
                "trigger": "clinician_feedback_revision",
                "clinician_feedback": {"requested_change": "increase diameter from ultrasound"},
                "tumor_overrides": {"diameter_mm": 12},
            },
        ],
        use_llm=False,
    )

    summary = audit_payloads([session], sources=["session-fixture.json"])
    assert summary["passed"] is True
    assert summary["record_count"] == 2
    assert summary["records"][0]["source"] == "session-fixture.json#rounds[0].plan"
    assert summary["records"][1]["source"] == "session-fixture.json#rounds[1].plan"
    assert all(
        record["input_schema_version"] == "agentic-incision-plan/v0.1"
        for record in summary["records"]
    )

    input_path = tmp_path / "agent_session.json"
    output_path = tmp_path / "agent_session_audit.json"
    input_path.write_text(json.dumps(session), encoding="utf-8")
    subprocess.run(
        [
            sys.executable,
            "tools/audit_agentic_incision_trace.py",
            str(input_path),
            "--output",
            str(output_path),
        ],
        cwd=ROOT,
        check=True,
    )
    cli_summary = json.loads(output_path.read_text(encoding="utf-8"))
    assert cli_summary["schema_version"] == "agentic-incision-trace-audit-summary/v0.1"
    assert cli_summary["record_count"] == 2
    assert cli_summary["passed_count"] == 2
