"""Tool-orchestrated incision planning.

The LLM never computes geometry. It can only summarize and inspect outputs from
deterministic tools whose calls are recorded in ``trace``.
"""
from __future__ import annotations

import json
from typing import Any

import numpy as np

from ..anatomy import classify_region
from ..clinical import default_clinical_rules
from ..incision import (
    annotate_candidate_sensitive_distances,
    evaluate_guardrails,
    fusiform_cutaneous_incision,
    linear_subcutaneous_incision,
)
from ..incision.geometry import units_per_mm_from_vertices
from ..lines.atlas import Atlas
from ..lines.direction import query_direction
from ..tumor import TumorInput, tumor_from_dict
from .provider import OpenAICompatibleProvider

TOOL_SCHEMAS = [
    {
        "name": "classify_region",
        "input": ["point"],
        "output": [
            "region",
            "subunit",
            "confidence",
            "confidence_reasons",
            "region_boundary_margin_norm",
            "free_margin_distance_mm",
        ],
    },
    {
        "name": "summarize_tumor_input_quality",
        "input": ["tumor"],
        "output": [
            "passed",
            "warning_count",
            "warnings",
            "source",
            "boundary_source",
            "author_present",
            "units",
        ],
    },
    {
        "name": "query_rstl_direction",
        "input": ["point", "source"],
        "output": [
            "vector",
            "angle_deg",
            "confidence",
            "support_count",
            "angular_spread_deg",
            "confidence_reasons",
        ],
    },
    {
        "name": "linear_subcutaneous_incision",
        "input": ["tumor", "direction", "units_per_mm"],
        "output": ["endpoints", "length_mm", "metrics"],
    },
    {
        "name": "fusiform_cutaneous_incision",
        "input": ["tumor", "direction", "units_per_mm"],
        "output": ["outline", "length_mm", "width_mm", "metrics"],
    },
    {
        "name": "evaluate_guardrails",
        "input": ["candidate", "anatomy"],
        "output": ["passed", "warnings", "suggested_overrides"],
    },
    {
        "name": "preview_incision_on_face",
        "input": ["candidate", "tumor", "anatomy", "guardrails"],
        "output": [
            "renderable",
            "preview_space",
            "candidate_point_count",
            "tumor_boundary_point_count",
            "guardrails_passed",
            "clinician_review_required",
        ],
    },
    {
        "name": "propose_direction_variants",
        "input": ["direction", "angle_offsets_deg"],
        "output": ["direction_variants"],
    },
    {
        "name": "recover_tool_failure",
        "input": ["tool", "variant", "error"],
        "output": ["recovery", "candidate_kept"],
    },
    {
        "name": "retry_tool_failure",
        "input": ["tool", "variant", "error", "attempt"],
        "output": ["retry", "max_attempts", "recovery"],
    },
    {
        "name": "clinician_edit_candidate",
        "input": [
            "candidate",
            "angle_offset_deg",
            "length_scale",
            "width_scale",
            "shift_along_mm",
            "shift_perp_mm",
            "reason",
        ],
        "output": ["edited_candidate", "guardrails", "provenance"],
    },
    {
        "name": "compare_candidates",
        "input": ["review_records"],
        "output": ["ranked_candidates", "score_breakdown", "clinical_boundary"],
    },
    {
        "name": "save_review_record",
        "input": [
            "candidate",
            "tumor",
            "trace",
            "privacy_audit",
            "reviewer",
            "review_status",
            "review_notes",
        ],
        "output": ["review_record_json", "report_markdown", "screenshot_png", "audit_events"],
    },
]

AGENT_TRACE_GATE_REQUIRED = [
    {
        "key": "tumor_input_quality",
        "label": "tumor input quality",
        "actions": ["summarize_tumor_input_quality"],
    },
    {
        "key": "face_region",
        "label": "face region",
        "actions": ["classify_region"],
    },
    {
        "key": "rstl_direction",
        "label": "RSTL direction",
        "actions": ["query_rstl_direction"],
    },
    {
        "key": "candidate_generation",
        "label": "deterministic incision generation",
        "actions": ["linear_subcutaneous_incision", "fusiform_cutaneous_incision"],
    },
    {
        "key": "guardrails",
        "label": "guardrails",
        "actions": ["evaluate_guardrails"],
    },
    {
        "key": "face_preview",
        "label": "face preview",
        "actions": ["preview_incision_on_face"],
    },
]

TRACE_GENERATION_ACTIONS = {"linear_subcutaneous_incision", "fusiform_cutaneous_incision"}

AGENT_REACT_PLAN_STEP_DEFINITIONS = [
    {
        "id": "inspect_tumor_input",
        "label": "Inspect tumor input",
        "intent": "Validate structured lesion inputs before any geometry is generated.",
        "required_action_groups": [["summarize_tumor_input_quality"]],
        "optional_actions": [],
    },
    {
        "id": "localize_anatomy",
        "label": "Localize anatomy",
        "intent": "Classify face region and nearby sensitive free margins.",
        "required_action_groups": [["classify_region"]],
        "optional_actions": [],
    },
    {
        "id": "query_direction",
        "label": "Query RSTL direction",
        "intent": "Read local RSTL direction from deterministic atlas service.",
        "required_action_groups": [["query_rstl_direction"]],
        "optional_actions": [],
    },
    {
        "id": "generate_primary_candidate",
        "label": "Generate primary candidate",
        "intent": "Generate baseline incision geometry with deterministic tools.",
        "required_action_groups": [["linear_subcutaneous_incision", "fusiform_cutaneous_incision"]],
        "optional_actions": [],
    },
    {
        "id": "check_guardrails",
        "label": "Check guardrails",
        "intent": "Evaluate deterministic clinical guardrails before review.",
        "required_action_groups": [["evaluate_guardrails"]],
        "optional_actions": [],
    },
    {
        "id": "preview_candidates",
        "label": "Preview candidates",
        "intent": "Confirm generated geometry is renderable on the face before clinician review.",
        "required_action_groups": [["preview_incision_on_face"]],
        "optional_actions": [],
    },
    {
        "id": "compare_direction_variants",
        "label": "Compare direction variants",
        "intent": "Explore nearby deterministic direction offsets and recover bounded failures.",
        "required_action_groups": [["propose_direction_variants"], ["compare_candidates"]],
        "optional_actions": [
            "linear_subcutaneous_incision",
            "fusiform_cutaneous_incision",
            "evaluate_guardrails",
            "preview_incision_on_face",
            "retry_tool_failure",
            "recover_tool_failure",
        ],
    },
]


def _trace(
    action: str,
    tool_input: dict[str, Any],
    observation: dict[str, Any],
    summary: str,
) -> dict[str, Any]:
    return {
        "summary": summary,
        "action": action,
        "input": tool_input,
        "observation": observation,
    }


def _trace_actions(trace: list[dict[str, Any]]) -> list[str]:
    return [str(step.get("action", "")) for step in trace if step.get("action")]


def _indexes_for_actions(actions: list[str], accepted: set[str]) -> list[int]:
    return [index for index, action in enumerate(actions) if action in accepted]


def agent_react_plan(
    trace: list[dict[str, Any]],
    *,
    candidate_count: int,
    comparison_ready: bool,
    trace_gate: dict[str, Any],
    retried_failures: list[dict[str, Any]] | None = None,
    recovered_failures: list[dict[str, Any]] | None = None,
    mode: str = "single_turn_react_multi_candidate_with_deterministic_tools",
) -> dict[str, Any]:
    """Build a structured ReAct execution plan from deterministic trace facts."""

    actions = _trace_actions(trace)
    retried_failures = retried_failures or []
    recovered_failures = recovered_failures or []
    steps: list[dict[str, Any]] = []
    for definition in AGENT_REACT_PLAN_STEP_DEFINITIONS:
        required_groups = [list(group) for group in definition["required_action_groups"]]
        optional_actions = list(definition.get("optional_actions", []))
        required_actions = {action for group in required_groups for action in group}
        accepted = required_actions | set(optional_actions)
        trace_indexes = _indexes_for_actions(actions, accepted)
        missing_groups = [
            group for group in required_groups
            if not _indexes_for_actions(actions, set(group))
        ]
        status = "completed" if not missing_groups else "failed"
        issues: list[str] = []
        if missing_groups:
            issues.extend(
                "missing any of: " + ", ".join(group)
                for group in missing_groups
            )
        if definition["id"] == "compare_direction_variants":
            if recovered_failures:
                status = "completed_with_recovery" if not missing_groups else "failed_with_recovery"
                issues.append("one or more deterministic variants were skipped after bounded retry")
            elif retried_failures:
                status = "completed_after_retry" if not missing_groups else "failed_after_retry"
                issues.append("one or more deterministic variants required bounded retry")
            if not comparison_ready:
                status = "failed"
                issues.append("candidate comparison missing")
            if candidate_count <= 0:
                status = "failed"
                issues.append("no candidate alternatives available for review")
        steps.append({
            "id": definition["id"],
            "label": definition["label"],
            "intent": definition["intent"],
            "required_action_groups": required_groups,
            "optional_actions": optional_actions,
            "observed_actions": [actions[index] for index in trace_indexes],
            "trace_indexes": trace_indexes,
            "status": status,
            "issues": issues,
        })

    failed_steps = [step for step in steps if str(step["status"]).startswith("failed")]
    passed = bool(trace_gate.get("passed")) and comparison_ready and candidate_count > 0 and not failed_steps
    return {
        "schema_version": "agent-react-plan/v0.1",
        "mode": mode,
        "passed": passed,
        "trace_gate_passed": bool(trace_gate.get("passed")),
        "candidate_count": int(candidate_count),
        "comparison_ready": bool(comparison_ready),
        "step_count": len(steps),
        "completed_step_count": sum(1 for step in steps if str(step["status"]).startswith("completed")),
        "failed_step_count": len(failed_steps),
        "retry_count": len(retried_failures),
        "recovery_count": len(recovered_failures),
        "steps": steps,
        "clinical_boundary": (
            "This ReAct plan is an audit scaffold over deterministic tool calls. "
            "It is not autonomous clinical reasoning or a surgical instruction."
        ),
    }


def _react_plan_step_ids_by_trace_index(react_plan: dict[str, Any]) -> dict[int, list[str]]:
    by_index: dict[int, list[str]] = {}
    for step in react_plan.get("steps", []):
        if not isinstance(step, dict):
            continue
        step_id = str(step.get("id") or "")
        if not step_id:
            continue
        for trace_index in step.get("trace_indexes", []):
            try:
                index = int(trace_index)
            except (TypeError, ValueError):
                continue
            by_index.setdefault(index, []).append(step_id)
    return by_index


def agent_execution_events(
    trace: list[dict[str, Any]],
    *,
    trace_gate: dict[str, Any],
    react_plan: dict[str, Any],
    mode: str = "single_turn_react_multi_candidate_with_deterministic_tools",
) -> dict[str, Any]:
    """Build a replayable execution timeline from trace and plan facts.

    The events are derived from deterministic tool observations that already
    exist in ``trace``. They provide a UI/SSE execution contract without
    claiming that the LLM autonomously executed clinical reasoning.
    """

    step_ids_by_trace_index = _react_plan_step_ids_by_trace_index(react_plan)
    events: list[dict[str, Any]] = [{
        "index": 0,
        "event": "execution_started",
        "status": "started",
        "message": "Agent execution started; deterministic tools own geometry and guardrails.",
        "trace_index": None,
        "action": None,
        "plan_step_ids": [],
    }]
    for trace_index, step in enumerate(trace):
        action = str(step.get("action") or "")
        status = "observed"
        if action == "retry_tool_failure":
            status = "retrying"
        elif action == "recover_tool_failure":
            status = "recovered"
        events.append({
            "index": len(events),
            "event": "tool_observed",
            "status": status,
            "trace_index": trace_index,
            "action": action,
            "plan_step_ids": step_ids_by_trace_index.get(trace_index, []),
            "message": str(step.get("summary") or action),
        })
    events.append({
        "index": len(events),
        "event": "trace_gate_evaluated",
        "status": "passed" if trace_gate.get("passed") else "failed",
        "trace_index": None,
        "action": "agent_trace_gate",
        "plan_step_ids": [],
        "message": (
            "Agent trace gate passed."
            if trace_gate.get("passed")
            else "Agent trace gate failed; candidate confirmation must remain blocked."
        ),
        "missing_actions": trace_gate.get("missing_actions", []),
    })
    events.append({
        "index": len(events),
        "event": "react_plan_evaluated",
        "status": "passed" if react_plan.get("passed") else "failed",
        "trace_index": None,
        "action": "agent_react_plan",
        "plan_step_ids": [
            str(step.get("id"))
            for step in react_plan.get("steps", [])
            if isinstance(step, dict) and step.get("id")
        ],
        "message": (
            f"ReAct plan evaluated: {react_plan.get('completed_step_count', 0)}/"
            f"{react_plan.get('step_count', 0)} steps completed."
        ),
        "failed_step_count": int(react_plan.get("failed_step_count") or 0),
    })
    return {
        "schema_version": "agent-execution-events/v0.1",
        "mode": mode,
        "passed": bool(trace_gate.get("passed")) and bool(react_plan.get("passed")),
        "event_count": len(events),
        "tool_event_count": len(trace),
        "retry_event_count": sum(1 for event in events if event.get("status") == "retrying"),
        "recovery_event_count": sum(1 for event in events if event.get("status") == "recovered"),
        "events": events,
        "clinical_boundary": (
            "Execution events replay deterministic tool observations for audit and UI feedback; "
            "they are not autonomous clinical reasoning or surgical instructions."
        ),
    }


def _short_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    keys = [
        "id",
        "type",
        "tumor_kind",
        "center",
        "axis",
        "endpoints",
        "length_mm",
        "width_mm",
        "tip_angle_deg",
        "direction_confidence",
        "metrics",
    ]
    return {k: candidate[k] for k in keys if k in candidate}


def _preview_incision_on_face(
    tumor: TumorInput,
    candidate: dict[str, Any],
    anatomy: dict[str, Any],
    guardrails: dict[str, Any],
    *,
    variant: str = "baseline",
) -> dict[str, Any]:
    candidate_points = (
        candidate.get("polyline")
        or candidate.get("outline")
        or candidate.get("endpoints")
        or []
    )
    point_count = len(candidate_points) if isinstance(candidate_points, list) else 0
    boundary_count = len(tumor.boundary) if getattr(tumor, "boundary", None) else 0
    renderable = point_count >= 2 and len(tumor.center) == 3
    return {
        "schema_version": "incision-preview-observation/v0.1",
        "renderable": renderable,
        "reason": "candidate_geometry_renderable" if renderable else "candidate_geometry_not_renderable",
        "preview_space": "standard_face_geometry",
        "variant": variant,
        "candidate_id": candidate.get("id", "unknown"),
        "candidate_type": candidate.get("type", "unknown"),
        "face_region": anatomy.get("region") if isinstance(anatomy, dict) else None,
        "subunit": anatomy.get("subunit") if isinstance(anatomy, dict) else None,
        "candidate_point_count": point_count,
        "tumor_center_present": True,
        "tumor_boundary_point_count": boundary_count,
        "guardrails_passed": guardrails.get("passed") is True,
        "clinician_review_required": True,
        "raw_image_sent": False,
        "raw_video_sent": False,
        "exported_raw_pixels": False,
        "clinical_boundary": (
            "Preview observation records deterministic render readiness only; "
            "clinician review remains required before discussion or live overlay."
        ),
    }


def _unit_vector(vector: Any) -> np.ndarray:
    raw = np.asarray(vector, dtype=np.float64)
    norm = float(np.linalg.norm(raw))
    if norm <= 1e-12:
        return np.array([1.0, 0.0, 0.0], dtype=np.float64)
    return raw / norm


def _rotate_axis_xy(vector: Any, angle_offset_deg: float) -> list[float]:
    axis = _unit_vector(vector)
    theta = float(np.deg2rad(angle_offset_deg))
    c = float(np.cos(theta))
    s = float(np.sin(theta))
    rotated = np.array([
        c * axis[0] - s * axis[1],
        s * axis[0] + c * axis[1],
        axis[2],
    ], dtype=np.float64)
    return [float(x) for x in _unit_vector(rotated)]


def _direction_variant(direction: dict[str, Any], angle_offset_deg: float) -> dict[str, Any]:
    vector = _rotate_axis_xy(direction.get("vector", [1.0, 0.0, 0.0]), angle_offset_deg)
    angle = float(np.degrees(np.arctan2(vector[1], vector[0])))
    reasons = list(direction.get("confidence_reasons") or [])
    if abs(float(angle_offset_deg)) > 1e-9:
        reasons.append("agent_direction_variant_requires_clinician_review")
    confidence = max(0.0, float(direction.get("confidence", 0.0)) - abs(float(angle_offset_deg)) / 180.0)
    return {
        **direction,
        "vector": vector,
        "angle_deg": angle,
        "confidence": confidence,
        "source": direction.get("source", "rstl_atlas_weighted_nearest"),
        "variant_source": "agent_direction_variant",
        "angle_offset_deg": float(angle_offset_deg),
        "confidence_reasons": list(dict.fromkeys(reasons)),
    }


def _make_candidate_for_direction(
    tumor: TumorInput,
    direction: dict[str, Any],
    rules: dict[str, Any],
    units_per_mm: float,
    vertices: np.ndarray,
) -> tuple[str, dict[str, Any]]:
    if tumor.kind == "subcutaneous":
        candidate = linear_subcutaneous_incision(tumor, direction, rules=rules, units_per_mm=units_per_mm)
        tool_name = "linear_subcutaneous_incision"
    else:
        candidate = fusiform_cutaneous_incision(tumor, direction, rules=rules, units_per_mm=units_per_mm)
        tool_name = "fusiform_cutaneous_incision"
    candidate = annotate_candidate_sensitive_distances(candidate, vertices)
    provenance = dict(candidate.get("provenance") or {})
    provenance["direction_variant_angle_offset_deg"] = direction.get("angle_offset_deg", 0.0)
    provenance["direction_variant_source"] = direction.get("variant_source", "rstl_primary")
    candidate["provenance"] = provenance
    return tool_name, candidate


def _severity_counts(guardrails: dict[str, Any] | None) -> dict[str, int]:
    counts = {"high": 0, "medium": 0, "low": 0}
    for warning in (guardrails or {}).get("warnings", []):
        severity = str(warning.get("severity", "low")).lower()
        if severity not in counts:
            severity = "low"
        counts[severity] += 1
    return counts


def _finite_or(value: Any, fallback: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if np.isfinite(number) else fallback


def compare_candidate_records(
    records: list[dict[str, Any]],
    rules: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Rank candidate records by deterministic engineering penalties.

    The ranking is for review triage only. It is not a clinical recommendation.
    """

    cfg = (rules or default_clinical_rules()).get("guardrails", {})
    sensitive_threshold = float(cfg.get("free_margin_distance_warn_mm", 18.0))
    ranked: list[dict[str, Any]] = []
    for index, record in enumerate(records):
        candidate = record.get("candidate") or {}
        metrics = candidate.get("metrics") or {}
        severity = _severity_counts(record.get("guardrails"))
        review_status = str(record.get("review_status", "pending_clinician_confirmation"))
        sensitive_distance = _finite_or(metrics.get("sensitive_free_margin_min_distance_mm"), float("inf"))
        sensitive_penalty = (
            max(0.0, sensitive_threshold - sensitive_distance) * 5.0
            if np.isfinite(sensitive_distance)
            else 0.0
        )
        score = (
            severity["high"] * 100.0
            + severity["medium"] * 25.0
            + severity["low"] * 5.0
            + _finite_or(metrics.get("rstl_deviation_deg"), 0.0)
            + _finite_or(metrics.get("diameter_coverage_deficit_mm"), 0.0) * 10.0
            + _finite_or(metrics.get("axis_coverage_deficit_mm"), 0.0) * 10.0
            + _finite_or(metrics.get("tip_angle_error_deg"), 0.0) * 2.0
            + sensitive_penalty
            + (1000.0 if review_status == "rejected_by_clinician" else 0.0)
        )
        reasons: list[str] = []
        if severity["high"]:
            reasons.append(f"{severity['high']} high guardrail warning(s)")
        if severity["medium"]:
            reasons.append(f"{severity['medium']} medium guardrail warning(s)")
        if _finite_or(metrics.get("diameter_coverage_deficit_mm"), 0.0) > 0:
            reasons.append("linear diameter coverage deficit")
        if _finite_or(metrics.get("axis_coverage_deficit_mm"), 0.0) > 0:
            reasons.append("fusiform axis coverage deficit")
        if sensitive_penalty > 0:
            reasons.append("near sensitive free margin")
        if not reasons:
            reasons.append("lowest deterministic review penalty")
        ranked.append({
            "id": record.get("id", f"candidate_{index}"),
            "label": record.get("label", f"Candidate {index + 1}"),
            "original_index": index,
            "candidate_type": candidate.get("type", "unknown"),
            "angle_offset_deg": record.get("angle_offset_deg", 0.0),
            "review_status": review_status,
            "score": score,
            "score_breakdown": {
                "high_guardrails": severity["high"],
                "medium_guardrails": severity["medium"],
                "low_guardrails": severity["low"],
                "rstl_deviation_deg": _finite_or(metrics.get("rstl_deviation_deg"), 0.0),
                "diameter_coverage_deficit_mm": _finite_or(metrics.get("diameter_coverage_deficit_mm"), 0.0),
                "axis_coverage_deficit_mm": _finite_or(metrics.get("axis_coverage_deficit_mm"), 0.0),
                "tip_angle_error_deg": _finite_or(metrics.get("tip_angle_error_deg"), 0.0),
                "sensitive_free_margin_threshold_mm": sensitive_threshold,
                "sensitive_margin_penalty": sensitive_penalty,
                "rejected_penalty": 1000.0 if review_status == "rejected_by_clinician" else 0.0,
            },
            "reasons": reasons,
        })
    ranked.sort(key=lambda item: (float(item["score"]), int(item["original_index"])))
    for rank, item in enumerate(ranked, start=1):
        item["rank"] = rank
        item["score"] = round(float(item["score"]), 3)
        item["clinical_boundary"] = (
            "Engineering ranking is for candidate comparison only; it is not a "
            "clinical recommendation or surgical instruction."
        )
    return ranked


def _merge_tumor_round_data(base: dict[str, Any], round_request: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    tumor = round_request.get("tumor")
    if isinstance(tumor, dict):
        merged.update(tumor)
    overrides = round_request.get("tumor_overrides")
    if isinstance(overrides, dict):
        merged.update(overrides)
    return merged


def _tumor_delta_summary(previous: dict[str, Any] | None, current: dict[str, Any]) -> dict[str, Any]:
    if previous is None:
        return {
            "changed": False,
            "changed_fields": [],
            "previous_values": {},
            "current_values": {},
        }
    keys = sorted(set(previous) | set(current))
    changed_fields = [key for key in keys if previous.get(key) != current.get(key)]
    return {
        "changed": bool(changed_fields),
        "changed_fields": changed_fields,
        "previous_values": {key: previous.get(key) for key in changed_fields},
        "current_values": {key: current.get(key) for key in changed_fields},
    }


def _best_candidate_id(plan: dict[str, Any]) -> str | None:
    comparison = plan.get("candidate_comparison")
    if not isinstance(comparison, list) or not comparison:
        return None
    first = comparison[0]
    if not isinstance(first, dict):
        return None
    candidate_id = first.get("id")
    return str(candidate_id) if candidate_id else None


def _first_comparison_score(plan: dict[str, Any]) -> float | None:
    comparison = plan.get("candidate_comparison")
    if not isinstance(comparison, list) or not comparison:
        return None
    score = comparison[0].get("score") if isinstance(comparison[0], dict) else None
    try:
        number = float(score)
    except (TypeError, ValueError):
        return None
    return number if np.isfinite(number) else None


def _session_candidate_row(round_result: dict[str, Any]) -> dict[str, Any]:
    plan = round_result.get("plan") if isinstance(round_result.get("plan"), dict) else {}
    candidate = plan.get("candidate") if isinstance(plan.get("candidate"), dict) else {}
    metrics = candidate.get("metrics") if isinstance(candidate.get("metrics"), dict) else {}
    severity = _severity_counts(plan.get("guardrails") if isinstance(plan.get("guardrails"), dict) else {})
    feedback = (
        round_result.get("clinician_feedback")
        if isinstance(round_result.get("clinician_feedback"), dict)
        else {}
    )
    return {
        "round_index": int(round_result.get("round_index", 0)),
        "round_id": str(round_result.get("round_id", "")),
        "trigger": str(round_result.get("trigger", "")),
        "selected_candidate_id": round_result.get("selected_candidate_id"),
        "candidate_type": candidate.get("type", "unknown"),
        "length_mm": _finite_or(candidate.get("length_mm"), 0.0),
        "width_mm": (
            _finite_or(candidate.get("width_mm"), 0.0)
            if candidate.get("width_mm") is not None
            else None
        ),
        "rstl_deviation_deg": _finite_or(metrics.get("rstl_deviation_deg"), 0.0),
        "diameter_coverage_deficit_mm": _finite_or(
            metrics.get("diameter_coverage_deficit_mm"), 0.0
        ),
        "axis_coverage_deficit_mm": _finite_or(metrics.get("axis_coverage_deficit_mm"), 0.0),
        "tip_angle_error_deg": _finite_or(metrics.get("tip_angle_error_deg"), 0.0),
        "high_guardrails": severity["high"],
        "medium_guardrails": severity["medium"],
        "low_guardrails": severity["low"],
        "comparison_score": _first_comparison_score(plan),
        "trace_gate_passed": bool(round_result.get("trace_gate_passed")),
        "react_plan_passed": bool(round_result.get("react_plan_passed")),
        "execution_events_passed": bool(round_result.get("execution_events_passed")),
        "changed_tumor_fields": list(
            (round_result.get("tumor_delta") or {}).get("changed_fields") or []
        ),
        "reviewer": str(feedback.get("reviewer") or ""),
        "requested_change": str(feedback.get("requested_change") or feedback.get("note") or ""),
    }


def _nullable_delta(current: float | None, previous: float | None) -> float | None:
    if current is None or previous is None:
        return None
    return round(float(current) - float(previous), 6)


def _session_candidate_evolution(session_rounds: list[dict[str, Any]]) -> dict[str, Any]:
    rows = [_session_candidate_row(item) for item in session_rounds]
    transitions: list[dict[str, Any]] = []
    for previous, current in zip(rows, rows[1:], strict=False):
        transitions.append({
            "from_round_index": previous["round_index"],
            "to_round_index": current["round_index"],
            "from_round_id": previous["round_id"],
            "to_round_id": current["round_id"],
            "selected_candidate_changed": (
                previous["selected_candidate_id"] != current["selected_candidate_id"]
            ),
            "candidate_type_changed": previous["candidate_type"] != current["candidate_type"],
            "changed_tumor_fields": current["changed_tumor_fields"],
            "length_delta_mm": _nullable_delta(current["length_mm"], previous["length_mm"]),
            "width_delta_mm": _nullable_delta(current["width_mm"], previous["width_mm"]),
            "comparison_score_delta": _nullable_delta(
                current["comparison_score"], previous["comparison_score"]
            ),
            "high_guardrail_delta": current["high_guardrails"] - previous["high_guardrails"],
            "clinical_boundary": (
                "Round-to-round deltas are deterministic engineering provenance for clinician "
                "review; they are not an autonomous recommendation."
            ),
        })
    return {
        "schema_version": "agent-session-candidate-evolution/v0.1",
        "round_count": len(rows),
        "transition_count": len(transitions),
        "rounds": rows,
        "transitions": transitions,
        "final_round_index": rows[-1]["round_index"] if rows else None,
        "final_candidate_id": rows[-1]["selected_candidate_id"] if rows else None,
        "clinical_boundary": (
            "This summary records how structured clinician feedback changes deterministic "
            "candidate geometry across rounds. It is provenance, not a surgical instruction."
        ),
    }


def plan_incision_session(
    tumor_data: dict[str, Any],
    vertices: np.ndarray,
    triangles: np.ndarray,
    atlas: Atlas,
    *,
    rounds: list[dict[str, Any]] | None = None,
    session_id: str = "agentic-incision-session",
    provider: OpenAICompatibleProvider | None = None,
    use_llm: bool = True,
    rules: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run a multi-round Agentic planning session.

    Each round still delegates geometry and safety checks to
    :func:`plan_incision_case`. The session layer only records clinician
    feedback, changed structured inputs, and per-round audit state.
    """

    round_requests = rounds or [{"trigger": "initial_plan"}]
    current_tumor = dict(tumor_data)
    previous_tumor: dict[str, Any] | None = None
    session_rounds: list[dict[str, Any]] = []
    for index, raw_request in enumerate(round_requests):
        round_request = raw_request if isinstance(raw_request, dict) else {}
        current_tumor = _merge_tumor_round_data(current_tumor, round_request)
        feedback = round_request.get("clinician_feedback", round_request.get("feedback", {}))
        if not isinstance(feedback, dict):
            feedback = {"note": str(feedback)}
        delta = _tumor_delta_summary(previous_tumor, current_tumor)
        plan = plan_incision_case(
            current_tumor,
            vertices,
            triangles,
            atlas,
            provider=provider,
            use_llm=use_llm,
            rules=rules,
        )
        selected_candidate_id = _best_candidate_id(plan)
        round_id = str(round_request.get("round_id") or f"round_{index + 1}")
        trigger = str(
            round_request.get(
                "trigger",
                "initial_plan" if index == 0 else "clinician_feedback_revision",
            )
        )
        session_rounds.append({
            "schema_version": "agentic-incision-session-round/v0.1",
            "round_index": index,
            "round_id": round_id,
            "trigger": trigger,
            "clinician_feedback": feedback,
            "tumor_delta": delta,
            "tumor": dict(current_tumor),
            "selected_candidate_id": selected_candidate_id,
            "trace_gate_passed": bool(plan.get("agent_trace_gate", {}).get("passed")),
            "react_plan_passed": bool(plan.get("agent_react_plan", {}).get("passed")),
            "execution_events_passed": bool(plan.get("agent_execution_events", {}).get("passed")),
            "candidate_count": len(plan.get("candidate_alternatives", []) or []),
            "trace_event_count": len(plan.get("trace", []) or []),
            "plan": plan,
        })
        previous_tumor = dict(current_tumor)

    final_round = session_rounds[-1]
    candidate_evolution = _session_candidate_evolution(session_rounds)
    audit = {
        "schema_version": "agent-session-audit/v0.1",
        "mode": "multi_round_react_session_with_deterministic_tools",
        "round_count": len(session_rounds),
        "revision_round_count": sum(
            1 for item in session_rounds
            if item["round_index"] > 0
            or item.get("tumor_delta", {}).get("changed")
            or bool(item.get("clinician_feedback"))
        ),
        "all_round_trace_gates_passed": all(item["trace_gate_passed"] for item in session_rounds),
        "all_round_react_plans_passed": all(item["react_plan_passed"] for item in session_rounds),
        "all_round_execution_events_passed": all(
            item["execution_events_passed"] for item in session_rounds
        ),
        "final_candidate_present": bool(final_round.get("selected_candidate_id")),
        "candidate_evolution_present": bool(candidate_evolution.get("rounds")),
        "candidate_evolution_transition_count": int(candidate_evolution.get("transition_count") or 0),
        "selected_candidate_ids": [
            item["selected_candidate_id"] for item in session_rounds if item.get("selected_candidate_id")
        ],
        "raw_image_sent": False,
        "raw_video_sent": False,
        "clinical_boundary": (
            "Multi-round session audit records deterministic planning rounds and clinician "
            "feedback context only; it is not autonomous clinical reasoning or a surgical "
            "instruction."
        ),
    }
    passed = (
        audit["all_round_trace_gates_passed"]
        and audit["all_round_react_plans_passed"]
        and audit["all_round_execution_events_passed"]
        and audit["final_candidate_present"]
    )
    return {
        "schema_version": "agentic-incision-session/v0.1",
        "session_id": session_id,
        "mode": "multi_round_react_session_with_deterministic_tools",
        "passed": bool(passed),
        "round_count": len(session_rounds),
        "rounds": session_rounds,
        "final_round_index": int(final_round["round_index"]),
        "final_candidate_id": final_round.get("selected_candidate_id"),
        "candidate_evolution": candidate_evolution,
        "tumor": final_round.get("tumor"),
        "provider": final_round.get("plan", {}).get("provider", {}),
        "agent_session_audit": audit,
        "tool_schemas": TOOL_SCHEMAS,
        "clinical_boundary": (
            "This session can iterate structured lesion inputs and deterministic candidate "
            "plans across rounds, but clinician review remains required for every candidate."
        ),
    }


def _fallback_summary(tumor: TumorInput, candidate: dict[str, Any], guardrails: dict[str, Any]) -> str:
    warnings = guardrails.get("warnings", [])
    kind = "linear subcutaneous" if candidate["type"] == "linear" else "fusiform cutaneous"
    status = "guardrails passed" if guardrails.get("passed") else "guardrails require clinician review"
    return (
        f"Generated a {kind} candidate for a {tumor.diameter_mm:.1f} mm lesion. "
        f"The long axis follows the local RSTL direction from the atlas. {status}; "
        f"{len(warnings)} warning(s) recorded."
    )


def agent_trace_gate(
    trace: list[dict[str, Any]],
    candidate: dict[str, Any] | None = None,
    *,
    mode: str = "single_turn_react_with_deterministic_tools",
) -> dict[str, Any]:
    """Validate that the agent trace contains the required deterministic gates."""

    actions = [str(step.get("action", "")) for step in trace if step.get("action")]
    observed = set(actions)
    required: list[dict[str, Any]] = []
    for req in AGENT_TRACE_GATE_REQUIRED:
        indexes = [actions.index(action) for action in req["actions"] if action in observed]
        required.append({
            "key": req["key"],
            "label": req["label"],
            "actions": req["actions"],
            "observed": bool(indexes),
            "first_index": min(indexes) if indexes else None,
        })
    missing = [req for req in required if not req["observed"]]
    present_indexes = [int(req["first_index"]) for req in required if req["first_index"] is not None]
    order_ok = all(idx >= present_indexes[i - 1] for i, idx in enumerate(present_indexes) if i > 0)
    geometry_present = bool(
        candidate
        and isinstance(candidate.get("polyline"), list)
        and len(candidate["polyline"]) >= 2
    )
    return {
        "schema_version": "agent-trace-gate/v0.1",
        "passed": not missing and order_ok and geometry_present,
        "mode": mode,
        "observed_actions": actions,
        "required_actions": [
            {"key": req["key"], "label": req["label"], "actions": req["actions"]} for req in required
        ],
        "missing_actions": [
            {"key": req["key"], "label": req["label"], "actions": req["actions"]} for req in missing
        ],
        "order_ok": order_ok,
        "deterministic_geometry_present": geometry_present,
        "boundary": (
            "LLM may summarize and explain only after deterministic tools provide "
            "geometry and guardrail observations."
        ),
    }


def _ask_llm_for_summary(
    provider: OpenAICompatibleProvider,
    *,
    tumor: TumorInput,
    anatomy: dict[str, Any],
    direction: dict[str, Any],
    candidate: dict[str, Any],
    guardrails: dict[str, Any],
) -> dict[str, str]:
    prompt_payload = {
        "tumor": tumor.to_dict(),
        "anatomy": anatomy,
        "direction": direction,
        "candidate": _short_candidate(candidate),
        "guardrails": guardrails,
    }
    messages = [
        {
            "role": "system",
            "content": (
                "/no_think\n"
                "You are an incision-planning assistant for a research prototype. "
                "Do not compute geometry or override deterministic guardrails. "
                "Return a concise clinician-facing JSON object with keys "
                "summary, rationale, and next_step. Never call it a surgical order."
            ),
        },
        {"role": "user", "content": json.dumps(prompt_payload, ensure_ascii=False)},
    ]
    resp = provider.chat(messages, temperature=0.1, max_tokens=220)
    text = resp.content.strip()
    parsed: dict[str, Any]
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = {"summary": text, "rationale": "", "next_step": "Clinician review required."}
    return {
        "summary": str(parsed.get("summary", text)),
        "rationale": str(parsed.get("rationale", "")),
        "next_step": str(parsed.get("next_step", "Clinician review required.")),
        "model": resp.model,
        "reasoning": resp.reasoning[:600],
    }


def plan_incision_case(
    tumor_data: dict[str, Any],
    vertices: np.ndarray,
    triangles: np.ndarray,
    atlas: Atlas,
    *,
    provider: OpenAICompatibleProvider | None = None,
    use_llm: bool = True,
    rules: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Plan one candidate incision and return geometry, trace, and summary."""

    rules = rules or default_clinical_rules()
    tumor = tumor_from_dict(tumor_data)
    V = np.asarray(vertices, dtype=np.float64)
    T = np.asarray(triangles, dtype=np.int64)
    trace: list[dict[str, Any]] = []
    tumor_quality = tumor.input_quality()
    trace.append(_trace(
        "summarize_tumor_input_quality",
        {"tumor": tumor.to_dict()},
        tumor_quality,
        "Check whether manual tumor inputs include source, author, units, depth, "
        "margin, and boundary metadata.",
    ))

    anatomy = classify_region(tumor.center, V)
    trace.append(_trace(
        "classify_region",
        {"point": list(tumor.center)},
        anatomy.to_dict(),
        "Locate the tumor in a broad clinical face region before applying rules.",
    ))

    direction = query_direction(tumor.center, V, T, atlas)
    direction_data = direction.to_dict()
    trace.append(_trace(
        "query_rstl_direction",
        {"point": list(tumor.center), "source": "rstl_atlas"},
        direction_data,
        "Read local RSTL direction from the validated-or-draft atlas; do not infer it with the LLM.",
    ))

    units_per_mm = units_per_mm_from_vertices(V)
    tool_name, candidate = _make_candidate_for_direction(
        tumor,
        {**direction_data, "variant_source": "rstl_primary", "angle_offset_deg": 0.0},
        rules,
        units_per_mm,
        V,
    )
    trace.append(_trace(
        tool_name,
        {"tumor": tumor.to_dict(), "direction": direction_data, "units_per_mm": units_per_mm},
        _short_candidate(candidate),
        "Generate candidate geometry with deterministic rules and RSTL-parallel long axis.",
    ))

    guardrails = evaluate_guardrails(candidate, anatomy, rules=rules)
    trace.append(_trace(
        "evaluate_guardrails",
        {"candidate": _short_candidate(candidate), "anatomy": anatomy.to_dict()},
        guardrails,
        "Check sensitive regions and confidence before the candidate reaches clinician review.",
    ))
    preview = _preview_incision_on_face(tumor, candidate, anatomy.to_dict(), guardrails)
    trace.append(_trace(
        "preview_incision_on_face",
        {"candidate": _short_candidate(candidate), "tumor": tumor.to_dict(), "anatomy": anatomy.to_dict()},
        preview,
        "Preview deterministic candidate geometry on the face before it can enter clinician review.",
    ))

    angle_offsets = [-10.0, 0.0, 10.0]
    direction_variants = [_direction_variant(direction_data, offset) for offset in angle_offsets]
    trace.append(_trace(
        "propose_direction_variants",
        {"direction": direction_data, "angle_offsets_deg": angle_offsets},
        {
            "variants": [
                {
                    "angle_offset_deg": variant["angle_offset_deg"],
                    "angle_deg": variant["angle_deg"],
                    "confidence": variant["confidence"],
                    "source": variant["source"],
                    "variant_source": variant["variant_source"],
                }
                for variant in direction_variants
            ],
            "boundary": "Variants are deterministic parameter exploration, not LLM-computed geometry.",
        },
        "Explore small direction offsets so the review panel can compare nearby deterministic candidates.",
    ))

    candidate_alternatives: list[dict[str, Any]] = []
    candidate_records: list[dict[str, Any]] = []
    recovered_failures: list[dict[str, Any]] = []
    retried_failures: list[dict[str, Any]] = []
    for variant in direction_variants:
        offset = float(variant["angle_offset_deg"])
        variant_id = "baseline" if abs(offset) < 1e-9 else f"offset_{offset:+.0f}deg"
        label = "RSTL baseline" if abs(offset) < 1e-9 else f"RSTL offset {offset:+.0f} deg"
        if abs(offset) < 1e-9:
            variant_candidate = candidate
            variant_guardrails = guardrails
            variant_preview = preview
            variant_tool = tool_name
        else:
            try:
                variant_tool, variant_candidate = _make_candidate_for_direction(
                    tumor,
                    variant,
                    rules,
                    units_per_mm,
                    V,
                )
                trace.append(_trace(
                    variant_tool,
                    {
                        "tumor": tumor.to_dict(),
                        "direction": variant,
                        "units_per_mm": units_per_mm,
                        "variant": variant_id,
                    },
                    _short_candidate(variant_candidate),
                    "Generate a deterministic nearby direction candidate for comparison.",
                ))
                variant_guardrails = evaluate_guardrails(variant_candidate, anatomy, rules=rules)
                trace.append(_trace(
                    "evaluate_guardrails",
                    {
                        "candidate": _short_candidate(variant_candidate),
                        "anatomy": anatomy.to_dict(),
                        "variant": variant_id,
                    },
                    variant_guardrails,
                    "Re-run guardrails for the deterministic candidate variant.",
                ))
                variant_preview = _preview_incision_on_face(
                    tumor,
                    variant_candidate,
                    anatomy.to_dict(),
                    variant_guardrails,
                    variant=variant_id,
                )
                trace.append(_trace(
                    "preview_incision_on_face",
                    {
                        "candidate": _short_candidate(variant_candidate),
                        "tumor": tumor.to_dict(),
                        "anatomy": anatomy.to_dict(),
                        "variant": variant_id,
                    },
                    variant_preview,
                    "Preview deterministic candidate variant before comparison.",
                ))
            except Exception as exc:  # noqa: BLE001
                retry = {
                    "tool": tool_name,
                    "variant": variant_id,
                    "angle_offset_deg": offset,
                    "attempt": 1,
                    "error": str(exc),
                    "retry": "retry_same_deterministic_tool_once",
                    "max_attempts": 1,
                }
                retried_failures.append(retry)
                trace.append(_trace(
                    "retry_tool_failure",
                    {"tool": tool_name, "variant": variant_id, "error": str(exc), "attempt": 1},
                    retry,
                    "Retry deterministic tool once before skipping the failed candidate variant.",
                ))
                try:
                    variant_tool, variant_candidate = _make_candidate_for_direction(
                        tumor,
                        variant,
                        rules,
                        units_per_mm,
                        V,
                    )
                    trace.append(_trace(
                        variant_tool,
                        {
                            "tumor": tumor.to_dict(),
                            "direction": variant,
                            "units_per_mm": units_per_mm,
                            "variant": variant_id,
                            "retry_attempt": 1,
                        },
                        _short_candidate(variant_candidate),
                        "Generate a deterministic nearby direction candidate after bounded retry.",
                    ))
                    variant_guardrails = evaluate_guardrails(variant_candidate, anatomy, rules=rules)
                    trace.append(_trace(
                        "evaluate_guardrails",
                        {
                            "candidate": _short_candidate(variant_candidate),
                            "anatomy": anatomy.to_dict(),
                            "variant": variant_id,
                            "retry_attempt": 1,
                        },
                        variant_guardrails,
                        "Re-run guardrails for the retried deterministic candidate variant.",
                    ))
                    variant_preview = _preview_incision_on_face(
                        tumor,
                        variant_candidate,
                        anatomy.to_dict(),
                        variant_guardrails,
                        variant=variant_id,
                    )
                    trace.append(_trace(
                        "preview_incision_on_face",
                        {
                            "candidate": _short_candidate(variant_candidate),
                            "tumor": tumor.to_dict(),
                            "anatomy": anatomy.to_dict(),
                            "variant": variant_id,
                            "retry_attempt": 1,
                        },
                        variant_preview,
                        "Preview retried deterministic candidate variant before comparison.",
                    ))
                except Exception as retry_exc:  # noqa: BLE001
                    failure = {
                        "tool": tool_name,
                        "variant": variant_id,
                        "angle_offset_deg": offset,
                        "error": str(retry_exc),
                        "previous_errors": [str(exc)],
                        "recovery": "skipped_failed_variant_and_kept_other_candidates",
                    }
                    recovered_failures.append(failure)
                    trace.append(_trace(
                        "recover_tool_failure",
                        {"tool": tool_name, "variant": variant_id, "error": str(retry_exc)},
                        failure,
                        "Record deterministic tool failure and continue with remaining candidate variants.",
                    ))
                    continue
        record = {
            "id": f"agent_{variant_id}",
            "label": label,
            "angle_offset_deg": offset,
            "candidate": variant_candidate,
            "guardrails": variant_guardrails,
            "preview": variant_preview,
            "anatomy": anatomy.to_dict(),
            "review_status": "pending_clinician_confirmation",
        }
        candidate_alternatives.append(record)
        candidate_records.append(record)

    candidate_comparison = compare_candidate_records(candidate_records, rules=rules)
    trace.append(_trace(
        "compare_candidates",
        {"candidate_ids": [record["id"] for record in candidate_records]},
        {
            "ranked_candidates": candidate_comparison,
            "candidate_count": len(candidate_records),
            "recovered_failure_count": len(recovered_failures),
            "clinical_boundary": "Engineering comparison only; clinician review remains required.",
        },
        "Rank deterministic candidate variants for review triage without making a clinical recommendation.",
    ))

    provider_status = {"mode": "deterministic_fallback", "model": None, "error": None}
    llm = {
        "summary": _fallback_summary(tumor, candidate, guardrails),
        "rationale": "Deterministic tool outputs were used because no LLM summary was available.",
        "next_step": "Clinician reviews, edits, or rejects the candidate.",
        "model": None,
        "reasoning": "",
    }
    if use_llm and provider is not None:
        try:
            llm = _ask_llm_for_summary(
                provider,
                tumor=tumor,
                anatomy=anatomy.to_dict(),
                direction=direction.to_dict(),
                candidate=candidate,
                guardrails=guardrails,
            )
            provider_status = {"mode": "llm_summary", "model": llm.get("model"), "error": None}
        except Exception as exc:  # noqa: BLE001
            provider_status = {
                "mode": "deterministic_fallback",
                "model": getattr(provider, "model", None),
                "error": str(exc),
            }

    trace_gate = agent_trace_gate(trace, candidate)
    react_plan = agent_react_plan(
        trace,
        candidate_count=len(candidate_records),
        comparison_ready=bool(candidate_comparison),
        trace_gate=trace_gate,
        retried_failures=retried_failures,
        recovered_failures=recovered_failures,
    )
    execution_events = agent_execution_events(
        trace,
        trace_gate=trace_gate,
        react_plan=react_plan,
    )
    orchestration_audit = {
        "schema_version": "agent-orchestration-audit/v0.1",
        "mode": "single_turn_react_multi_candidate_with_deterministic_tools",
        "candidate_count": len(candidate_records),
        "preview_count": sum(1 for record in candidate_records if isinstance(record.get("preview"), dict)),
        "preview_ready_count": sum(
            1 for record in candidate_records
            if isinstance(record.get("preview"), dict) and record["preview"].get("renderable") is True
        ),
        "comparison_ready": bool(candidate_comparison),
        "react_plan_passed": react_plan["passed"],
        "react_plan_step_count": react_plan["step_count"],
        "retry_count": len(retried_failures),
        "retried_failures": retried_failures,
        "tool_failure_count": len(recovered_failures),
        "recovered_failures": recovered_failures,
        "trace_gate_passed": trace_gate["passed"],
        "clinical_boundary": (
            "Agent orchestration may compare deterministic candidates for review; "
            "it must not issue surgical instructions or bypass clinician confirmation."
        ),
    }
    return {
        "schema_version": "agentic-incision-plan/v0.1",
        "agent_trace_mode": "single_turn_react_multi_candidate_with_deterministic_tools",
        "tool_schemas": TOOL_SCHEMAS,
        "tumor": tumor.to_dict(),
        "tumor_quality": tumor_quality,
        "anatomy": anatomy.to_dict(),
        "direction": direction.to_dict(),
        "candidate": candidate,
        "preview": preview,
        "candidate_alternatives": candidate_alternatives,
        "candidate_comparison": candidate_comparison,
        "guardrails": guardrails,
        "trace": trace,
        "agent_trace_gate": trace_gate,
        "agent_react_plan": react_plan,
        "agent_execution_events": execution_events,
        "agent_orchestration_audit": orchestration_audit,
        "llm": llm,
        "provider": provider_status,
    }
