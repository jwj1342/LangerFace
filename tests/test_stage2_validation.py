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
    overlay_stability: dict | None = None,
    overlay_registration: dict | None = None,
    overlay_3d_view: dict | None = None,
) -> dict:
    record = {
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
    if overlay_stability is not None:
        record["incision_overlay_stability"] = overlay_stability
    if overlay_registration is not None:
        record["incision_overlay_registration"] = overlay_registration
    if overlay_3d_view is not None:
        record["incision_overlay_3d_view"] = overlay_3d_view
    return record


def _overlay_stability(*, passed: bool, rms: float, p95: float, max_px: float, reason: str) -> dict:
    return {
        "schema_version": "incision-overlay-stability/v0.1",
        "passed": passed,
        "reason": reason,
        "frame_count": 3,
        "tracked_point_count": 7,
        "sample_count": 14,
        "thresholds": {
            "max_rms_px": 2,
            "max_p95_px": 4,
            "max_max_px": 8,
            "context": "static_camera_or_paused_video",
        },
        "overall": {
            "count": 14,
            "mean_px": rms / 2,
            "rms_px": rms,
            "p95_px": p95,
            "max_px": max_px,
        },
        "by_group": {
            "candidate_polyline": {"count": 4, "rms_px": rms, "p95_px": p95, "max_px": max_px},
            "tumor_center": {"count": 2, "rms_px": rms / 2, "p95_px": p95 / 2, "max_px": max_px / 2},
        },
    }


def _overlay_registration(
    *,
    passed: bool,
    mapped: int,
    out_of_frame_count: int,
    degenerate_triangle_count: int,
    reason: str,
) -> dict:
    return {
        "schema_version": "incision-overlay-registration/v0.1",
        "passed": passed,
        "reason": reason,
        "reasons": [reason],
        "thresholds": {
            "min_mapped_point_count": 3,
            "min_candidate_point_count": 2,
            "min_triangle_area_px2": 1,
            "min_overlay_diagonal_px": 4,
            "max_overlay_frame_fraction": 0.95,
            "max_out_of_frame_fraction": 0,
            "context": "runtime_landmark_surface_ref_projection",
        },
        "total_ref_count": 7,
        "mapped_point_count": mapped,
        "candidate_point_count": 2 if mapped >= 2 else mapped,
        "tumor_center_mapped": mapped >= 1,
        "invalid_ref_count": 0,
        "missing_landmark_count": 0,
        "degenerate_triangle_count": degenerate_triangle_count,
        "out_of_frame_count": out_of_frame_count,
        "out_of_frame_fraction": out_of_frame_count / mapped if mapped else None,
        "bbox_px": {
            "min_x": 20,
            "min_y": 20,
            "max_x": 80,
            "max_y": 70,
            "width": 60,
            "height": 50,
            "diagonal_px": 78.102,
            "frame_fraction": 0.552,
        },
        "groups": {
            "tumor_center": {"ref_count": 1, "mapped_count": 1 if mapped >= 1 else 0},
            "candidate_polyline": {"ref_count": 2, "mapped_count": 2 if mapped >= 2 else mapped},
        },
    }


def _overlay_replay_qa(
    *,
    passed: bool,
    reason: str,
    frame_count: int,
    registration_failed_count: int,
    registration_pass_rate: float,
) -> dict:
    return {
        "schema_version": "incision-overlay-replay-qa/v0.1",
        "passed": passed,
        "reason": reason,
        "frame_count": frame_count,
        "registration_summary": {
            "frame_count": frame_count,
            "passed_count": frame_count - registration_failed_count,
            "failed_count": registration_failed_count,
            "pass_rate": registration_pass_rate,
            "reason_counts": {
                "runtime_projection_registration_ready": frame_count - registration_failed_count,
            },
            "first_failed_frame_index": 1 if registration_failed_count else None,
        },
        "stability": {
            "schema_version": "incision-overlay-stability/v0.1",
            "passed": passed,
            "reason": "within_static_overlay_jitter_thresholds" if passed else "jitter_threshold_exceeded",
        },
        "clinical_boundary": "Offline replay QA is not patient-specific clinical AR registration.",
    }


def _overlay_3d_view(
    *,
    rendered: bool,
    reason: str,
    mapping_mode: str,
    candidate_points: int,
    boundary_points: int,
) -> dict:
    return {
        "schema_version": "incision-overlay-3d-view-diagnostics/v0.1",
        "raw_image_sent": False,
        "exported_raw_pixels": False,
        "mapping_mode": mapping_mode,
        "recon_display_space": "screen" if mapping_mode == "mediapipe_468_surface_refs" else "model",
        "viewer": {
            "schema_version": "incision-overlay-3d-view/v0.1",
            "rendered": rendered,
            "reason": reason,
            "candidate_point_count": candidate_points,
            "boundary_point_count": boundary_points,
            "tumor_center_rendered": rendered,
        },
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
        overlay_stability=_overlay_stability(
            passed=True,
            rms=0.6,
            p95=1.0,
            max_px=1.4,
            reason="within_static_overlay_jitter_thresholds",
        ),
        overlay_registration=_overlay_registration(
            passed=True,
            mapped=7,
            out_of_frame_count=0,
            degenerate_triangle_count=0,
            reason="runtime_projection_registration_ready",
        ),
        overlay_3d_view=_overlay_3d_view(
            rendered=True,
            reason="incision_overlay_rendered_on_3d_head",
            mapping_mode="mediapipe_468_surface_refs",
            candidate_points=2,
            boundary_points=4,
        ),
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
    current["incision_overlay_replay_qa"] = _overlay_replay_qa(
        passed=True,
        reason="offline_overlay_replay_passed",
        frame_count=3,
        registration_failed_count=0,
        registration_pass_rate=1.0,
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
            overlay_stability=_overlay_stability(
                passed=False,
                rms=3.4,
                p95=5.1,
                max_px=9.0,
                reason="jitter_threshold_exceeded",
            ),
            overlay_registration=_overlay_registration(
                passed=False,
                mapped=7,
                out_of_frame_count=2,
                degenerate_triangle_count=1,
                reason="out_of_frame_projection",
            ),
            overlay_3d_view=_overlay_3d_view(
                rendered=False,
                reason="no_renderable_overlay_points",
                mapping_mode="mediapipe_468_refs_to_flame_demo_nearest_surface",
                candidate_points=0,
                boundary_points=0,
            ),
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
    saved[0]["incision_overlay_replay_qa"] = _overlay_replay_qa(
        passed=False,
        reason="registration_frame_failure",
        frame_count=3,
        registration_failed_count=1,
        registration_pass_rate=2 / 3,
    )
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
    assert summary["metrics"]["incision_overlay_jitter_rms_px"]["count"] == 2
    assert summary["metrics"]["incision_overlay_jitter_rms_px"]["p90"] == 3.4
    assert summary["metrics"]["incision_overlay_jitter_p95_px"]["max"] == 5.1
    assert summary["metrics"]["incision_overlay_jitter_max_px"]["max"] == 9.0
    assert summary["metrics"]["incision_overlay_tracked_point_count"]["mean"] == 7
    assert summary["incision_overlay_stability"]["present_count"] == 2
    assert summary["incision_overlay_stability"]["passed_count"] == 1
    assert summary["incision_overlay_stability"]["failed_count"] == 1
    assert summary["incision_overlay_stability"]["pass_rate"] == 0.5
    assert summary["incision_overlay_stability"]["reason_counts"] == {
        "jitter_threshold_exceeded": 1,
        "within_static_overlay_jitter_thresholds": 1,
    }
    assert summary["incision_overlay_stability"]["context_counts"] == {"static_camera_or_paused_video": 2}
    assert summary["metrics"]["incision_overlay_registration_mapped_point_count"]["count"] == 2
    assert summary["metrics"]["incision_overlay_registration_out_of_frame_count"]["max"] == 2
    assert summary["metrics"]["incision_overlay_registration_degenerate_triangle_count"]["max"] == 1
    assert summary["metrics"]["incision_overlay_registration_bbox_diagonal_px"]["mean"] == 78.102
    assert summary["incision_overlay_registration"]["present_count"] == 2
    assert summary["incision_overlay_registration"]["passed_count"] == 1
    assert summary["incision_overlay_registration"]["failed_count"] == 1
    assert summary["incision_overlay_registration"]["pass_rate"] == 0.5
    assert summary["incision_overlay_registration"]["reason_counts"] == {
        "out_of_frame_projection": 1,
        "runtime_projection_registration_ready": 1,
    }
    assert summary["incision_overlay_registration"]["context_counts"] == {
        "runtime_landmark_surface_ref_projection": 2
    }
    assert summary["incision_overlay_replay_qa"]["present_count"] == 2
    assert summary["incision_overlay_replay_qa"]["passed_count"] == 1
    assert summary["incision_overlay_replay_qa"]["failed_count"] == 1
    assert summary["incision_overlay_replay_qa"]["pass_rate"] == 0.5
    assert summary["incision_overlay_replay_qa"]["reason_counts"] == {
        "offline_overlay_replay_passed": 1,
        "registration_frame_failure": 1,
    }
    assert summary["metrics"]["incision_overlay_replay_frame_count"]["mean"] == 3
    assert summary["metrics"]["incision_overlay_replay_registration_failed_count"]["max"] == 1
    assert summary["metrics"]["incision_overlay_replay_registration_pass_rate"]["min"] == 2 / 3
    assert summary["incision_overlay_3d_view"]["present_count"] == 2
    assert summary["incision_overlay_3d_view"]["rendered_count"] == 1
    assert summary["incision_overlay_3d_view"]["failed_count"] == 1
    assert summary["incision_overlay_3d_view"]["rendered_rate"] == 0.5
    assert summary["incision_overlay_3d_view"]["reason_counts"] == {
        "incision_overlay_rendered_on_3d_head": 1,
        "no_renderable_overlay_points": 1,
    }
    assert summary["incision_overlay_3d_view"]["mapping_mode_counts"] == {
        "mediapipe_468_refs_to_flame_demo_nearest_surface": 1,
        "mediapipe_468_surface_refs": 1,
    }
    assert summary["metrics"]["incision_overlay_3d_candidate_point_count"]["count"] == 2
    assert summary["metrics"]["incision_overlay_3d_candidate_point_count"]["mean"] == 1
    assert summary["metrics"]["incision_overlay_3d_boundary_point_count"]["max"] == 4
    assert summary["failure_mode_counts"]["incision_rule_violation"] == 1
    assert summary["failure_mode_counts"]["overlay_3d_view_failure"] == 1
    assert summary["failure_mode_counts"]["overlay_instability"] == 1
    assert summary["failure_mode_counts"]["overlay_registration_failure"] == 1
    assert summary["failure_mode_counts"]["overlay_replay_failure"] == 1
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
