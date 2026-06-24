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
        "output": ["region", "subunit", "confidence", "free_margin_distance_mm"],
    },
    {
        "name": "query_rstl_direction",
        "input": ["point", "source"],
        "output": ["vector", "angle_deg", "confidence", "support_count"],
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


def _fallback_summary(tumor: TumorInput, candidate: dict[str, Any], guardrails: dict[str, Any]) -> str:
    warnings = guardrails.get("warnings", [])
    kind = "linear subcutaneous" if candidate["type"] == "linear" else "fusiform cutaneous"
    status = "guardrails passed" if guardrails.get("passed") else "guardrails require clinician review"
    return (
        f"Generated a {kind} candidate for a {tumor.diameter_mm:.1f} mm lesion. "
        f"The long axis follows the local RSTL direction from the atlas. {status}; "
        f"{len(warnings)} warning(s) recorded."
    )


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

    anatomy = classify_region(tumor.center, V)
    trace.append(_trace(
        "classify_region",
        {"point": list(tumor.center)},
        anatomy.to_dict(),
        "Locate the tumor in a broad clinical face region before applying rules.",
    ))

    direction = query_direction(tumor.center, V, T, atlas)
    trace.append(_trace(
        "query_rstl_direction",
        {"point": list(tumor.center), "source": "rstl_atlas"},
        direction.to_dict(),
        "Read local RSTL direction from the validated-or-draft atlas; do not infer it with the LLM.",
    ))

    units_per_mm = units_per_mm_from_vertices(V)
    if tumor.kind == "subcutaneous":
        candidate = linear_subcutaneous_incision(tumor, direction, rules=rules, units_per_mm=units_per_mm)
        tool_name = "linear_subcutaneous_incision"
    else:
        candidate = fusiform_cutaneous_incision(tumor, direction, rules=rules, units_per_mm=units_per_mm)
        tool_name = "fusiform_cutaneous_incision"
    candidate = annotate_candidate_sensitive_distances(candidate, V)
    trace.append(_trace(
        tool_name,
        {"tumor": tumor.to_dict(), "direction": direction.to_dict(), "units_per_mm": units_per_mm},
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

    return {
        "schema_version": "agentic-incision-plan/v0.1",
        "agent_trace_mode": "single_turn_react_with_deterministic_tools",
        "tool_schemas": TOOL_SCHEMAS,
        "tumor": tumor.to_dict(),
        "anatomy": anatomy.to_dict(),
        "direction": direction.to_dict(),
        "candidate": candidate,
        "guardrails": guardrails,
        "trace": trace,
        "llm": llm,
        "provider": provider_status,
    }
