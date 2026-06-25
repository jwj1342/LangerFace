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
    for variant in direction_variants:
        offset = float(variant["angle_offset_deg"])
        variant_id = "baseline" if abs(offset) < 1e-9 else f"offset_{offset:+.0f}deg"
        label = "RSTL baseline" if abs(offset) < 1e-9 else f"RSTL offset {offset:+.0f} deg"
        if abs(offset) < 1e-9:
            variant_candidate = candidate
            variant_guardrails = guardrails
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
            except Exception as exc:  # noqa: BLE001
                failure = {
                    "tool": tool_name,
                    "variant": variant_id,
                    "angle_offset_deg": offset,
                    "error": str(exc),
                    "recovery": "skipped_failed_variant_and_kept_other_candidates",
                }
                recovered_failures.append(failure)
                trace.append(_trace(
                    "recover_tool_failure",
                    {"tool": tool_name, "variant": variant_id, "error": str(exc)},
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
    orchestration_audit = {
        "schema_version": "agent-orchestration-audit/v0.1",
        "mode": "single_turn_react_multi_candidate_with_deterministic_tools",
        "candidate_count": len(candidate_records),
        "comparison_ready": bool(candidate_comparison),
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
        "candidate_alternatives": candidate_alternatives,
        "candidate_comparison": candidate_comparison,
        "guardrails": guardrails,
        "trace": trace,
        "agent_trace_gate": trace_gate,
        "agent_orchestration_audit": orchestration_audit,
        "llm": llm,
        "provider": provider_status,
    }
