#!/usr/bin/env python3
"""Audit clinician review gates in sanitized incision review exports.

This audit checks that exported review records cannot claim live-overlay
readiness unless clinician approval, reviewer identity, required high-risk
notes, and Agent trace gate status are internally consistent. It does not
judge clinical correctness of an incision candidate.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

AUDIT_SCHEMA = "incision-review-gate-audit/v0.1"
SUMMARY_SCHEMA = "incision-review-gate-audit-summary/v0.1"
REVIEW_RECORD_SCHEMA = "incision-review-record/v0.3"
REVIEW_EXPORT_SCHEMA = "incision-review-export/v0.3"
STATUS_APPROVED = "approved_for_discussion"
STATUS_REJECTED = "rejected_by_clinician"
STATUS_PENDING = "pending_clinician_confirmation"


def _issue(code: str, message: str, *, severity: str = "high", path: str = "$") -> dict[str, str]:
    return {"code": code, "severity": severity, "path": path, "message": message}


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
    if schema == REVIEW_RECORD_SCHEMA or ("review_gate" in payload and "candidate" in payload):
        return [{"source": source, "payload": payload}]
    if schema == REVIEW_EXPORT_SCHEMA:
        entries: list[dict[str, Any]] = []
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


def _review(record: dict[str, Any]) -> dict[str, Any]:
    value = record.get("review")
    return value if isinstance(value, dict) else {}


def _review_status(record: dict[str, Any]) -> str:
    review = _review(record)
    return str(record.get("review_status") or review.get("status") or STATUS_PENDING)


def _high_guardrail_codes(record: dict[str, Any]) -> list[str]:
    summary = record.get("guardrail_summary") if isinstance(record.get("guardrail_summary"), dict) else {}
    high_codes = summary.get("high_codes")
    if isinstance(high_codes, list):
        return [str(code) for code in high_codes if str(code)]
    guardrails = record.get("guardrails") if isinstance(record.get("guardrails"), dict) else {}
    warnings = guardrails.get("warnings") if isinstance(guardrails.get("warnings"), list) else []
    return [
        str(warning.get("code"))
        for warning in warnings
        if isinstance(warning, dict)
        and warning.get("severity") == "high"
        and warning.get("code")
    ]


def _stored_gate(record: dict[str, Any]) -> dict[str, Any]:
    gate = record.get("review_gate")
    return gate if isinstance(gate, dict) else {}


def expected_review_gate(record: dict[str, Any]) -> dict[str, Any]:
    review = _review(record)
    status = _review_status(record)
    high_codes = _high_guardrail_codes(record)
    trace_gate = record.get("agent_trace_gate") if isinstance(record.get("agent_trace_gate"), dict) else {}
    reviewer_required = status == STATUS_APPROVED
    reviewer_present = bool(str(review.get("reviewer") or "").strip())
    notes_required = reviewer_required and bool(high_codes)
    notes_present = bool(str(review.get("notes") or "").strip())
    trace_gate_passed = trace_gate.get("passed") is True
    approval_ready = (
        status == STATUS_APPROVED
        and trace_gate_passed
        and reviewer_present
        and (not notes_required or notes_present)
    )
    return {
        "reviewer_required": reviewer_required,
        "reviewer_present": reviewer_present,
        "notes_required_for_high_guardrails": notes_required,
        "notes_present": notes_present,
        "high_guardrail_codes": high_codes,
        "agent_trace_gate_passed": trace_gate_passed,
        "approval_ready": approval_ready,
        "live_overlay_ready": approval_ready,
        "reason": (
            "approved_candidate_ready_for_research_overlay"
            if approval_ready
            else (
                "pending_clinician_confirmation_or_missing_required_review_context"
                if trace_gate_passed
                else "agent_trace_gate_failed"
            )
        ),
    }


def _compare_gate_field(
    stored: dict[str, Any],
    expected: dict[str, Any],
    field: str,
    issues: list[dict[str, str]],
) -> None:
    if stored.get(field) != expected[field]:
        issues.append(
            _issue(
                "review_gate_field_mismatch",
                f"review_gate.{field}={stored.get(field)!r} does not match expected {expected[field]!r}.",
                path=f"review_gate.{field}",
            )
        )


def audit_review_record(record: dict[str, Any], *, source: str = "<memory>") -> dict[str, Any]:
    review = _review(record)
    status = _review_status(record)
    gate = _stored_gate(record)
    expected = expected_review_gate(record)
    issues: list[dict[str, str]] = []

    if not gate:
        issues.append(
            _issue("review_gate_missing", "Review record is missing review_gate.", path="review_gate")
        )
    else:
        for field in (
            "reviewer_required",
            "reviewer_present",
            "notes_required_for_high_guardrails",
            "notes_present",
            "agent_trace_gate_passed",
            "approval_ready",
            "live_overlay_ready",
        ):
            _compare_gate_field(gate, expected, field, issues)
        if gate.get("high_guardrail_codes") != expected["high_guardrail_codes"]:
            issues.append(
                _issue(
                    "review_gate_high_codes_mismatch",
                    (
                        f"review_gate.high_guardrail_codes={gate.get('high_guardrail_codes')!r} "
                        f"does not match guardrail_summary {expected['high_guardrail_codes']!r}."
                    ),
                    path="review_gate.high_guardrail_codes",
                )
            )

    review_status_in_review = review.get("status")
    if review_status_in_review and str(review_status_in_review) != status:
        issues.append(
            _issue(
                "review_status_mismatch",
                f"review.status={review_status_in_review!r} does not match review_status={status!r}.",
                path="review.status",
            )
        )

    if gate.get("live_overlay_ready") is True and status != STATUS_APPROVED:
        issues.append(
            _issue(
                "live_overlay_without_clinician_approval",
                "live_overlay_ready must be false unless review_status is approved_for_discussion.",
                path="review_gate.live_overlay_ready",
            )
        )

    if status == STATUS_REJECTED and gate.get("live_overlay_ready") is True:
        issues.append(
            _issue(
                "rejected_candidate_live_overlay_ready",
                "Rejected candidates must never be marked live_overlay_ready.",
                path="review_gate.live_overlay_ready",
            )
        )

    if status == STATUS_APPROVED and not expected["reviewer_present"]:
        issues.append(
            _issue(
                "approved_candidate_missing_reviewer",
                "Approved review records must include a reviewer identity.",
                path="review.reviewer",
            )
        )

    if (
        status == STATUS_APPROVED
        and expected["notes_required_for_high_guardrails"]
        and not expected["notes_present"]
    ):
        issues.append(
            _issue(
                "approved_high_guardrail_missing_notes",
                "Approved high-risk candidates must include review notes or override rationale.",
                path="review.notes",
            )
        )

    if gate.get("live_overlay_ready") is True and not expected["agent_trace_gate_passed"]:
        issues.append(
            _issue(
                "live_overlay_without_agent_trace_gate",
                "live_overlay_ready requires a passed agent_trace_gate.",
                path="agent_trace_gate.passed",
            )
        )

    high_issues = [issue for issue in issues if issue["severity"] == "high"]
    return {
        "schema_version": AUDIT_SCHEMA,
        "source": source,
        "label": record.get("label") or record.get("id") or source,
        "input_schema_version": record.get("schema_version") or "unknown",
        "passed": not high_issues,
        "issue_count": len(issues),
        "high_issue_count": len(high_issues),
        "issues": issues,
        "review_status": status,
        "stored_review_gate": gate,
        "expected_review_gate": expected,
        "clinical_boundary": (
            "Review gate audit verifies export consistency for research overlay readiness only; "
            "it is not clinical validation or surgical clearance."
        ),
    }


def audit_payloads(payloads: list[Any], sources: list[str] | None = None) -> dict[str, Any]:
    entries = entries_from_payloads(payloads, sources)
    audits = [audit_review_record(entry["payload"], source=entry["source"]) for entry in entries]
    high_issue_count = sum(int(audit["high_issue_count"]) for audit in audits)
    return {
        "schema_version": SUMMARY_SCHEMA,
        "record_count": len(audits),
        "passed_count": sum(1 for audit in audits if audit["passed"]),
        "failed_count": sum(1 for audit in audits if not audit["passed"]),
        "high_issue_count": high_issue_count,
        "passed": bool(audits) and high_issue_count == 0,
        "records": audits,
        "clinical_boundary": (
            "Offline review gate audit checks exported workflow state only; "
            "clinician review remains required."
        ),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="+", help="Incision review record/export JSON")
    parser.add_argument("--output", "-o", help="Write audit JSON report")
    parser.add_argument("--no-fail", action="store_true", help="Always exit 0 after writing the report")
    args = parser.parse_args(argv)

    payloads = [load_payload(path) for path in args.input]
    summary = audit_payloads(payloads, sources=args.input)
    text = json.dumps(summary, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    return 0 if summary["passed"] or args.no_fail else 1


if __name__ == "__main__":
    raise SystemExit(main())
