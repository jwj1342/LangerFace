#!/usr/bin/env python3
"""Replay and audit Agentic incision traces from sanitized JSON exports."""
from __future__ import annotations

import argparse
import json
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

TRACE_GENERATION_ACTIONS = {"linear_subcutaneous_incision", "fusiform_cutaneous_incision"}


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
