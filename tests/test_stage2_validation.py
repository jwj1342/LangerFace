import json
import subprocess
import sys
from pathlib import Path

from tools.evaluate_stage2_validation import evaluate_payloads, records_from_payload

ROOT = Path(__file__).resolve().parents[1]


def _record(
    *,
    record_id: str,
    status: str,
    candidate_type: str,
    tumor_kind: str,
    guardrails_passed: bool,
    warnings: list[dict],
    metrics: dict,
    secondary_cues: dict | None = None,
) -> dict:
    return {
        "schema_version": "incision-review-record/v0.3",
        "id": record_id,
        "review_status": status,
        "review": {
            "status": status,
            "reviewer": "coded-reviewer-1",
            "notes": "synthetic validation fixture",
            "failure_modes": [],
        },
        "tumor": {"kind": tumor_kind, "diameter_mm": 12.0, "margin_mm": 2.0},
        "candidate": {
            "type": candidate_type,
            "tumor_kind": tumor_kind,
            "length_mm": 24.0,
            "width_mm": 8.0 if candidate_type == "fusiform" else None,
            "direction_confidence": 0.88,
            "metrics": metrics,
        },
        "guardrails": {"passed": guardrails_passed, "warnings": warnings, "suggested_overrides": []},
        "guardrail_summary": {
            "passed": guardrails_passed,
            "high_codes": [w["code"] for w in warnings if w.get("severity") == "high"],
            "medium_codes": [w["code"] for w in warnings if w.get("severity") == "medium"],
        },
        "secondary_cues": secondary_cues or {"present": False},
        "review_gate": {"approval_ready": status == "approved_for_discussion", "live_overlay_ready": False},
        "provider_config": {"api_key_present": True, "api_key": "[redacted]"},
        "privacy_audit": {"raw_image_sent": False, "raw_video_sent": False},
    }


def _export_payload() -> dict:
    current = _record(
        record_id="linear-ok",
        status="approved_for_discussion",
        candidate_type="linear",
        tumor_kind="subcutaneous",
        guardrails_passed=True,
        warnings=[],
        metrics={"rstl_deviation_deg": 3.0, "diameter_coverage_deficit_mm": 0.0},
        secondary_cues={
            "present": True,
            "source": "synthetic",
            "source_tool": "tools/prototype_wrinkle_lesion_cues.py",
            "confidence_label": "low_confidence_cv_cue_requires_manual_confirmation",
            "manual_confirmed": True,
            "used_for_geometry": False,
            "used_for_agent_prompt": False,
            "lesion": {"iou": 0.91, "precision": 0.94, "recall": 0.90},
            "wrinkle": {"precision": 0.78, "recall": 0.76},
        },
    )
    saved = [
        _record(
            record_id="fusiform-high",
            status="approved_for_discussion",
            candidate_type="fusiform",
            tumor_kind="cutaneous",
            guardrails_passed=False,
            warnings=[{"code": "axis_coverage_deficit", "severity": "high"}],
            metrics={
                "rstl_deviation_deg": 8.0,
                "length_to_width_ratio": 3.0,
                "tip_angle_error_deg": 1.5,
                "axis_coverage_deficit_mm": 2.0,
                "sensitive_free_margin_min_distance_mm": 6.0,
                "boundary_area_ratio_to_diameter_disk": 0.85,
            },
        ),
        _record(
            record_id="fusiform-rejected",
            status="rejected_by_clinician",
            candidate_type="fusiform",
            tumor_kind="cutaneous",
            guardrails_passed=False,
            warnings=[{"code": "boundary_self_intersection", "severity": "medium"}],
            metrics={
                "rstl_deviation_deg": 18.0,
                "length_to_width_ratio": 2.5,
                "tip_angle_error_deg": 4.0,
                "axis_coverage_deficit_mm": 0.0,
                "boundary_area_ratio_to_diameter_disk": 0.2,
            },
        ),
    ]
    return {
        "schema_version": "incision-review-export/v0.3",
        "exported_at": "2026-06-24T00:00:00Z",
        "current": current,
        "saved": saved,
    }


def test_stage2_validation_summary_aggregates_review_export():
    payload = _export_payload()
    summary = evaluate_payloads([payload], input_files=["fixture.json"])

    assert len(records_from_payload(payload)) == 3
    assert summary["schema_version"] == "stage2-validation-summary/v0.1"
    assert summary["record_count"] == 3
    assert summary["candidate_type_counts"] == {"fusiform": 2, "linear": 1}
    assert summary["tumor_kind_counts"] == {"cutaneous": 2, "subcutaneous": 1}
    assert summary["clinician_review"]["approval_rate"] == 2 / 3
    assert summary["guardrails"]["passed_count"] == 1
    assert summary["guardrails"]["warning_code_counts"]["axis_coverage_deficit"] == 1
    assert summary["metrics"]["rstl_deviation_deg"]["p90"] == 18.0
    assert summary["metrics"]["fusiform_tip_angle_error_deg"]["count"] == 2
    assert summary["failure_mode_counts"]["incision_rule_violation"] == 1
    assert summary["failure_mode_counts"]["tumor_boundary_input_quality"] == 1
    assert summary["failure_mode_counts"]["review_rejected"] == 1
    assert summary["privacy_audit"]["raw_media_sent_count"] == 0
    assert summary["privacy_audit"]["provider_secret_leak_count"] == 0
    assert summary["secondary_cues"]["present_count"] == 1
    assert summary["secondary_cues"]["manual_confirmation_rate"] == 1.0
    assert summary["secondary_cues"]["used_for_geometry_count"] == 0
    assert summary["secondary_cues"]["used_for_agent_prompt_count"] == 0
    assert summary["secondary_cues"]["source_counts"] == {"synthetic": 1}
    assert summary["secondary_cues"]["metrics"]["lesion_iou"]["mean"] == 0.91
    assert summary["secondary_cues"]["metrics"]["wrinkle_recall"]["mean"] == 0.76


def test_stage2_validation_cli_writes_summary(tmp_path: Path):
    input_path = tmp_path / "incision_review.json"
    output_path = tmp_path / "summary.json"
    input_path.write_text(json.dumps(_export_payload()), encoding="utf-8")

    subprocess.run(
        [
            sys.executable,
            "tools/evaluate_stage2_validation.py",
            str(input_path),
            "--output",
            str(output_path),
        ],
        cwd=ROOT,
        check=True,
    )

    summary = json.loads(output_path.read_text(encoding="utf-8"))
    assert summary["schema_version"] == "stage2-validation-summary/v0.1"
    assert summary["record_count"] == 3
