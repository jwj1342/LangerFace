#!/usr/bin/env python3
"""Replay and audit Agentic incision traces from sanitized JSON exports."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from langerface.agent import (
    agent_execution_events,
    agent_react_plan,
    agent_trace_gate,
    compare_candidate_records,
)

AUDIT_SCHEMA = "agentic-incision-trace-audit/v0.1"
PLAN_SCHEMA = "agentic-incision-plan/v0.1"
REVIEW_RECORD_SCHEMA = "incision-review-record/v0.3"
REVIEW_EXPORT_SCHEMA = "incision-review-export/v0.3"
SESSION_SCHEMA = "agentic-incision-session/v0.1"

TRACE_GENERATION_ACTIONS = {"linear_subcutaneous_incision", "fusiform_cutaneous_incision"}
SECRET_KEY_HINTS = ("api_key", "secret", "token", "authorization", "password", "private_key")
REDACTED_VALUES = {"", "[redacted]", "redacted", "***", "null", "none"}
LLM_TEXT_FIELDS = ("summary", "rationale", "next_step")
LLM_REVIEW_BOUNDARY_TERMS = (
    "clinician",
    "doctor",
    "physician",
    "review",
    "confirm",
    "confirmation",
    "not a surgical",
    "医生",
    "审阅",
    "复核",
    "确认",
    "不是手术",
    "不能作为手术",
)
LLM_RAW_PAYLOAD_KEYS = {
    "raw",
    "messages",
    "prompt",
    "request",
    "response",
    "choices",
    "headers",
    "authorization",
}
LLM_FORBIDDEN_DIRECTIVE_PATTERNS = (
    re.compile(r"(?i)\bperform\s+this\s+incision\b"),
    re.compile(r"(?i)\bproceed\s+(?:to|with)\s+(?:surgery|the\s+incision)\b"),
    re.compile(r"(?i)\bsafe\s+to\s+(?:operate|proceed)\b"),
    re.compile(r"(?i)\bno\s+(?:clinician|doctor|physician)\s+review\s+(?:is\s+)?(?:needed|required)\b"),
    re.compile(r"可以直接(?:手术|切开|执行)"),
    re.compile(r"无需(?:医生|临床|人工)(?:审阅|复核|确认)"),
    re.compile(r"立即(?:切开|手术|执行)"),
)
SECRET_VALUE_PATTERNS = (
    re.compile(r"(?i)\bsk-[A-Za-z0-9_-]{8,}\b"),
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._-]{8,}\b"),
)


def load_payload(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _entries_from_payload(payload: Any, source: str = "<memory>") -> list[dict[str, Any]]:
    if isinstance(payload, list):
        entries: list[dict[str, Any]] = []
        for index, item in enumerate(payload):
            entries.extend(_entries_from_payload(item, f"{source}[{index}]"))
        return entries

    if not isinstance(payload, dict):
        return []

    schema = payload.get("schema_version")
    if schema in {PLAN_SCHEMA, REVIEW_RECORD_SCHEMA} or ("trace" in payload and "candidate" in payload):
        return [{
            "source": source,
            "schema_version": schema or "unknown",
            "label": payload.get("label") or payload.get("id") or source,
            "payload": payload,
        }]

    if schema == SESSION_SCHEMA:
        entries = []
        for index, round_result in enumerate(payload.get("rounds", [])):
            if not isinstance(round_result, dict):
                continue
            plan = round_result.get("plan")
            if isinstance(plan, dict):
                entries.extend(_entries_from_payload(plan, f"{source}#rounds[{index}].plan"))
        return entries

    if schema == REVIEW_EXPORT_SCHEMA:
        entries = []
        current = payload.get("current")
        if isinstance(current, dict):
            entries.extend(_entries_from_payload(current, f"{source}#current"))
        for index, record in enumerate(payload.get("saved", [])):
            if isinstance(record, dict):
                entries.extend(_entries_from_payload(record, f"{source}#saved[{index}]"))
        return entries

    return []


def entries_from_payloads(payloads: list[Any], sources: list[str] | None = None) -> list[dict[str, Any]]:
    sources = sources or ["<memory>"] * len(payloads)
    entries: list[dict[str, Any]] = []
    for payload, source in zip(payloads, sources, strict=False):
        entries.extend(_entries_from_payload(payload, source))
    return entries


def _action_names(trace: list[dict[str, Any]]) -> list[str]:
    return [str(step.get("action") or "") for step in trace if isinstance(step, dict) and step.get("action")]


def _path(parts: tuple[str, ...]) -> str:
    return ".".join(parts) if parts else "$"


def _nonempty_text(value: Any) -> str | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int | float):
        return None
    text = str(value).strip()
    return text or None


def _is_redacted(value: Any) -> bool:
    text = _nonempty_text(value)
    return text is None or text.lower() in REDACTED_VALUES


def _secret_leak_paths(value: Any, *, path: tuple[str, ...] = ()) -> list[str]:
    leaks: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = (*path, str(key))
            leaf = str(key).lower()
            secret_key = any(hint in leaf for hint in SECRET_KEY_HINTS)
            if secret_key and not leaf.endswith("_present") and not _is_redacted(child):
                leaks.append(_path(child_path))
            leaks.extend(_secret_leak_paths(child, path=child_path))
        return leaks
    if isinstance(value, list):
        for index, child in enumerate(value):
            leaks.extend(_secret_leak_paths(child, path=(*path, str(index))))
        return leaks
    text = _nonempty_text(value)
    if text and any(pattern.search(text) for pattern in SECRET_VALUE_PATTERNS):
        leaks.append(_path(path))
    return leaks


def _raw_payload_key_paths(value: Any, *, path: tuple[str, ...] = ()) -> list[str]:
    paths: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = (*path, str(key))
            if str(key).lower() in LLM_RAW_PAYLOAD_KEYS:
                paths.append(_path(child_path))
            paths.extend(_raw_payload_key_paths(child, path=child_path))
        return paths
    if isinstance(value, list):
        for index, child in enumerate(value):
            paths.extend(_raw_payload_key_paths(child, path=(*path, str(index))))
    return paths


def _combined_llm_text(llm: dict[str, Any]) -> str:
    return "\n".join(
        str(llm.get(field) or "").strip()
        for field in LLM_TEXT_FIELDS
        if str(llm.get(field) or "").strip()
    )


def _llm_boundary_audit(record: dict[str, Any], replayed_gate: dict[str, Any]) -> dict[str, Any]:
    llm = record.get("llm") if isinstance(record.get("llm"), dict) else {}
    provider = record.get("provider") if isinstance(record.get("provider"), dict) else {}
    provider_config = (
        record.get("provider_config")
        if isinstance(record.get("provider_config"), dict)
        else {}
    )
    privacy = record.get("privacy_audit") if isinstance(record.get("privacy_audit"), dict) else {}
    privacy_provider = (
        privacy.get("provider")
        if isinstance(privacy.get("provider"), dict)
        else {}
    )
    text = _combined_llm_text(llm)
    text_lower = text.lower()
    directive_matches = [
        pattern.pattern for pattern in LLM_FORBIDDEN_DIRECTIVE_PATTERNS if pattern.search(text)
    ]
    review_boundary_present = any(term in text_lower for term in LLM_REVIEW_BOUNDARY_TERMS)
    reasoning = str(llm.get("reasoning") or "")
    secret_leaks: list[str] = []
    for label, payload in (
        ("llm", llm),
        ("provider", provider),
        ("provider_config", provider_config),
        ("privacy_audit.provider", privacy_provider),
    ):
        secret_leaks.extend(
            f"{label}.{path}" for path in _secret_leak_paths(payload) if path != "$"
        )
    provider_mode = str(provider.get("mode") or "")
    provider_model = provider.get("model")
    llm_model = llm.get("model")
    provider_model_consistent = True
    if provider_mode == "llm_summary":
        provider_model_consistent = (
            bool(llm_model)
            and llm_model == provider_model
            and not provider.get("error")
        )
    elif provider_model and llm_model:
        provider_model_consistent = llm_model == provider_model

    checks = {
        "llm_summary_present": bool(llm.get("summary")),
        "llm_next_step_present": bool(llm.get("next_step")),
        "llm_review_boundary_present": review_boundary_present,
        "llm_no_forbidden_directive": not directive_matches,
        "llm_reasoning_sanitized": len(reasoning) <= 600 and "<think" not in reasoning.lower(),
        "llm_no_raw_provider_payload": not _raw_payload_key_paths(llm),
        "provider_config_secret_redacted": not secret_leaks,
        "llm_provider_model_consistent": provider_model_consistent,
        "llm_after_deterministic_gate": bool(replayed_gate.get("passed")),
    }
    return {
        "schema_version": "agentic-llm-boundary-audit/v0.1",
        "passed": all(checks.values()),
        "checks": checks,
        "llm_present": bool(llm),
        "provider_mode": provider_mode or "unknown",
        "provider_model": provider_model,
        "llm_model": llm_model,
        "review_boundary_terms": [
            term for term in LLM_REVIEW_BOUNDARY_TERMS if term in text_lower
        ],
        "forbidden_directive_patterns": directive_matches,
        "raw_payload_paths": _raw_payload_key_paths(llm),
        "secret_leak_paths": secret_leaks,
        "reasoning_char_count": len(reasoning),
        "clinical_boundary": (
            "LLM output is audited as a summary over deterministic tool results only; "
            "it must preserve clinician review, redact provider secrets, and avoid "
            "surgical instructions."
        ),
    }


def _missing_keys(gate: dict[str, Any]) -> list[str]:
    return [str(item.get("key") or item.get("label") or "") for item in gate.get("missing_actions", [])]


def _stored_gate_matches(stored: dict[str, Any], replayed: dict[str, Any]) -> bool:
    if not stored:
        return True
    return (
        stored.get("schema_version") == replayed.get("schema_version")
        and stored.get("passed") == replayed.get("passed")
        and stored.get("order_ok") == replayed.get("order_ok")
        and stored.get("deterministic_geometry_present") == replayed.get("deterministic_geometry_present")
        and _missing_keys(stored) == _missing_keys(replayed)
    )


def _rank_ids(comparison: list[dict[str, Any]]) -> list[str]:
    return [
        str(item.get("id") or "")
        for item in sorted(comparison, key=lambda item: int(item.get("rank") or 0))
        if item.get("id")
    ]


def _comparison_replay(
    alternatives: list[dict[str, Any]],
    comparison: list[dict[str, Any]],
) -> dict[str, Any]:
    if not alternatives and not comparison:
        return {
            "available": False,
            "passed": True,
            "reason": "no_candidate_comparison_present",
            "expected_ranked_ids": [],
            "observed_ranked_ids": [],
        }
    if not alternatives or not comparison:
        return {
            "available": False,
            "passed": False,
            "reason": "candidate_alternatives_or_comparison_missing",
            "expected_ranked_ids": [],
            "observed_ranked_ids": _rank_ids(comparison),
        }
    replayed = compare_candidate_records(alternatives)
    expected = _rank_ids(replayed)
    observed = _rank_ids(comparison)
    return {
        "available": True,
        "passed": expected == observed,
        "reason": (
            "candidate_comparison_replayed"
            if expected == observed
            else "candidate_comparison_rank_mismatch"
        ),
        "expected_ranked_ids": expected,
        "observed_ranked_ids": observed,
    }


def _react_plan_matches(stored: dict[str, Any], replayed: dict[str, Any]) -> bool:
    if not stored:
        return False
    stored_steps = {str(step.get("id")): step for step in stored.get("steps", []) if isinstance(step, dict)}
    replayed_steps = {
        str(step.get("id")): step
        for step in replayed.get("steps", [])
        if isinstance(step, dict)
    }
    if stored_steps.keys() != replayed_steps.keys():
        return False
    for step_id, replayed_step in replayed_steps.items():
        stored_step = stored_steps[step_id]
        if stored_step.get("status") != replayed_step.get("status"):
            return False
        if stored_step.get("trace_indexes") != replayed_step.get("trace_indexes"):
            return False
    return (
        stored.get("schema_version") == replayed.get("schema_version")
        and stored.get("passed") == replayed.get("passed")
        and stored.get("candidate_count") == replayed.get("candidate_count")
        and stored.get("comparison_ready") == replayed.get("comparison_ready")
        and stored.get("failed_step_count") == replayed.get("failed_step_count")
    )


def _execution_events_matches(stored: dict[str, Any], replayed: dict[str, Any]) -> bool:
    if not stored:
        return False
    if (
        stored.get("schema_version") != replayed.get("schema_version")
        or stored.get("passed") != replayed.get("passed")
        or stored.get("event_count") != replayed.get("event_count")
        or stored.get("tool_event_count") != replayed.get("tool_event_count")
        or stored.get("retry_event_count") != replayed.get("retry_event_count")
        or stored.get("recovery_event_count") != replayed.get("recovery_event_count")
    ):
        return False
    stored_events = [event for event in stored.get("events", []) if isinstance(event, dict)]
    replayed_events = [event for event in replayed.get("events", []) if isinstance(event, dict)]
    if len(stored_events) != len(replayed_events):
        return False
    comparable_keys = ["event", "status", "trace_index", "action", "plan_step_ids"]
    for stored_event, replayed_event in zip(stored_events, replayed_events, strict=False):
        for key in comparable_keys:
            if stored_event.get(key) != replayed_event.get(key):
                return False
    return True


def audit_agentic_record(record: dict[str, Any], *, source: str = "<memory>") -> dict[str, Any]:
    trace = [step for step in record.get("trace", []) if isinstance(step, dict)]
    actions = _action_names(trace)
    candidate = record.get("candidate") if isinstance(record.get("candidate"), dict) else None
    replayed_gate = agent_trace_gate(trace, candidate)
    stored_gate = record.get("agent_trace_gate") if isinstance(record.get("agent_trace_gate"), dict) else {}
    orchestration = (
        record.get("agent_orchestration_audit")
        if isinstance(record.get("agent_orchestration_audit"), dict)
        else {}
    )
    alternatives = [
        item for item in record.get("candidate_alternatives", [])
        if isinstance(item, dict) and isinstance(item.get("candidate"), dict)
    ]
    comparison = [item for item in record.get("candidate_comparison", []) if isinstance(item, dict)]
    comparison_replay = _comparison_replay(alternatives, comparison)

    retry_trace_count = actions.count("retry_tool_failure")
    recovery_trace_count = actions.count("recover_tool_failure")
    retried_failures = (
        orchestration.get("retried_failures", [])
        if isinstance(orchestration.get("retried_failures"), list)
        else []
    )
    recovered_failures = (
        orchestration.get("recovered_failures", [])
        if isinstance(orchestration.get("recovered_failures"), list)
        else []
    )
    generation_indexes = [idx for idx, action in enumerate(actions) if action in TRACE_GENERATION_ACTIONS]
    compare_indexes = [idx for idx, action in enumerate(actions) if action == "compare_candidates"]
    guardrail_indexes = [idx for idx, action in enumerate(actions) if action == "evaluate_guardrails"]
    stored_react_plan = (
        record.get("agent_react_plan")
        if isinstance(record.get("agent_react_plan"), dict)
        else {}
    )
    replayed_react_plan = agent_react_plan(
        trace,
        candidate_count=int(orchestration.get("candidate_count") or len(alternatives)),
        comparison_ready=bool(orchestration.get("comparison_ready") if orchestration else comparison),
        trace_gate=replayed_gate,
        retried_failures=retried_failures,
        recovered_failures=recovered_failures,
        mode=str(orchestration.get("mode") or "single_turn_react_multi_candidate_with_deterministic_tools"),
    )
    stored_execution_events = (
        record.get("agent_execution_events")
        if isinstance(record.get("agent_execution_events"), dict)
        else {}
    )
    replayed_execution_events = agent_execution_events(
        trace,
        trace_gate=replayed_gate,
        react_plan=replayed_react_plan,
        mode=str(orchestration.get("mode") or "single_turn_react_multi_candidate_with_deterministic_tools"),
    )
    llm_boundary = _llm_boundary_audit(record, replayed_gate)

    checks = {
        "trace_gate_replayed_passed": replayed_gate["passed"],
        "stored_trace_gate_matches_replay": _stored_gate_matches(stored_gate, replayed_gate),
        "react_plan_present": bool(stored_react_plan),
        "react_plan_replayed_passed": replayed_react_plan["passed"],
        "stored_react_plan_matches_replay": _react_plan_matches(stored_react_plan, replayed_react_plan),
        "execution_events_present": bool(stored_execution_events),
        "execution_events_replayed_passed": replayed_execution_events["passed"],
        "stored_execution_events_matches_replay": _execution_events_matches(
            stored_execution_events,
            replayed_execution_events,
        ),
        "deterministic_generation_observed": bool(generation_indexes),
        "guardrails_observed_after_generation": bool(
            generation_indexes and guardrail_indexes and max(guardrail_indexes) > min(generation_indexes)
        ),
        "compare_candidates_observed": bool(compare_indexes),
        "compare_after_candidate_generation": bool(
            compare_indexes and generation_indexes and min(compare_indexes) > min(generation_indexes)
        ),
        "candidate_comparison_replay_passed": comparison_replay["passed"],
        "orchestration_candidate_count_matches": (
            not orchestration
            or orchestration.get("candidate_count") in {None, len(alternatives)}
        ),
        "orchestration_comparison_ready_matches": (
            not orchestration
            or orchestration.get("comparison_ready") in {None, bool(comparison)}
        ),
        "retried_failure_count_matches_trace": (
            int(orchestration.get("retry_count") or 0)
            == retry_trace_count
            == len(retried_failures)
        ),
        "recovered_failure_count_matches_trace": (
            int(orchestration.get("tool_failure_count") or 0)
            == recovery_trace_count
            == len(recovered_failures)
        ),
        "clinical_boundary_present": bool(
            orchestration.get("clinical_boundary") or comparison_replay["available"] is False
        ),
        **llm_boundary["checks"],
    }
    failures = [key for key, passed in checks.items() if not passed]
    return {
        "schema_version": AUDIT_SCHEMA,
        "source": source,
        "label": record.get("label") or record.get("id") or source,
        "input_schema_version": record.get("schema_version") or "unknown",
        "passed": not failures,
        "failures": failures,
        "checks": checks,
        "trace": {
            "action_count": len(actions),
            "observed_actions": actions,
            "retry_trace_count": retry_trace_count,
            "recovery_trace_count": recovery_trace_count,
        },
        "trace_gate_replay": replayed_gate,
        "stored_trace_gate_present": bool(stored_gate),
        "react_plan_replay": replayed_react_plan,
        "stored_react_plan_present": bool(stored_react_plan),
        "execution_events_replay": replayed_execution_events,
        "stored_execution_events_present": bool(stored_execution_events),
        "llm_boundary_audit": llm_boundary,
        "candidate_comparison_replay": comparison_replay,
        "orchestration_audit": {
            "present": bool(orchestration),
            "candidate_count": orchestration.get("candidate_count"),
            "comparison_ready": orchestration.get("comparison_ready"),
            "retry_count": orchestration.get("retry_count", 0),
            "retried_failure_count": len(retried_failures),
            "tool_failure_count": orchestration.get("tool_failure_count", 0),
            "recovered_failure_count": len(recovered_failures),
        },
        "clinical_boundary": (
            "This audit replays deterministic trace and comparison contracts only; "
            "it is not clinical validation or a surgical instruction."
        ),
    }


def audit_payloads(payloads: list[Any], sources: list[str] | None = None) -> dict[str, Any]:
    entries = entries_from_payloads(payloads, sources)
    audits = [
        audit_agentic_record(entry["payload"], source=entry["source"])
        for entry in entries
    ]
    passed_count = sum(1 for audit in audits if audit["passed"])
    return {
        "schema_version": "agentic-incision-trace-audit-summary/v0.1",
        "record_count": len(audits),
        "passed_count": passed_count,
        "failed_count": len(audits) - passed_count,
        "passed": bool(audits) and passed_count == len(audits),
        "records": audits,
        "clinical_boundary": (
            "Offline audit verifies deterministic Agentic trace contracts only; "
            "clinician review remains required."
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="+", help="Agent plan, review record, or review export JSON")
    parser.add_argument("--output", "-o", help="Write audit JSON to this path")
    args = parser.parse_args()

    payloads = [load_payload(path) for path in args.input]
    summary = audit_payloads(payloads, sources=args.input)
    text = json.dumps(summary, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    return 0 if summary["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
