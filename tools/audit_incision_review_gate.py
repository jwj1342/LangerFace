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
import math
from pathlib import Path
from typing import Any

from langerface.tumor import TumorInput, tumor_from_payload

try:
    from tools.audit_tumor_input import (
        BOUNDARY_EXACT_FIELDS,
        BOUNDARY_FLOAT_FIELDS,
        _close_enough,
        _finite_number,
        _point,
        tumor_boundary_summary,
    )
except ModuleNotFoundError:  # pragma: no cover - supports direct CLI execution.
    from audit_tumor_input import (  # type: ignore
        BOUNDARY_EXACT_FIELDS,
        BOUNDARY_FLOAT_FIELDS,
        _close_enough,
        _finite_number,
        _point,
        tumor_boundary_summary,
    )

AUDIT_SCHEMA = "incision-review-gate-audit/v0.1"
SUMMARY_SCHEMA = "incision-review-gate-audit-summary/v0.1"
REVIEW_RECORD_SCHEMA = "incision-review-record/v0.3"
REVIEW_EXPORT_SCHEMA = "incision-review-export/v0.3"
STATUS_APPROVED = "approved_for_discussion"
STATUS_REJECTED = "rejected_by_clinician"
STATUS_PENDING = "pending_clinician_confirmation"
GEOMETRY_TOLERANCE = 1e-6


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


def _candidate_axis(record: dict[str, Any]) -> tuple[float, float, float] | None:
    candidate = record.get("candidate") if isinstance(record.get("candidate"), dict) else {}
    return _point(candidate.get("axis"))


def _point_list(value: Any) -> list[tuple[float, float, float]] | None:
    if not isinstance(value, list):
        return None
    points = [_point(item) for item in value]
    if any(point is None for point in points):
        return None
    return points  # type: ignore[return-value]


def _vec_sub(
    a: tuple[float, float, float],
    b: tuple[float, float, float],
) -> tuple[float, float, float]:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _vec_mid(
    a: tuple[float, float, float],
    b: tuple[float, float, float],
) -> tuple[float, float, float]:
    return ((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5)


def _vec_dot(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _vec_len(v: tuple[float, float, float]) -> float:
    return math.hypot(v[0], v[1], v[2])


def _vec_unit(v: tuple[float, float, float]) -> tuple[float, float, float] | None:
    length = _vec_len(v)
    if length <= GEOMETRY_TOLERANCE:
        return None
    return (v[0] / length, v[1] / length, v[2] / length)


def _points_close(
    a: tuple[float, float, float],
    b: tuple[float, float, float],
    *,
    tolerance: float = GEOMETRY_TOLERANCE,
) -> bool:
    return _vec_len(_vec_sub(a, b)) <= tolerance


def _whole_number(value: Any) -> int | None:
    number = _finite_number(value)
    if number is None:
        return None
    rounded = round(number)
    if abs(number - rounded) > 1e-9:
        return None
    return int(rounded)


def _candidate_geometry_issues(record: dict[str, Any]) -> list[dict[str, str]]:
    candidate = record.get("candidate")
    if not isinstance(candidate, dict):
        return [
            _issue(
                "candidate_geometry_missing",
                "Review records must export a candidate object.",
                path="candidate",
            )
        ]

    candidate_type = str(candidate.get("type") or "")
    if candidate_type not in {"linear", "fusiform"}:
        return []

    issues: list[dict[str, str]] = []
    center = _point(candidate.get("center"))
    axis = _point(candidate.get("axis"))
    axis_unit = _vec_unit(axis) if axis is not None else None
    endpoints = _point_list(candidate.get("endpoints"))
    polyline = _point_list(candidate.get("polyline"))
    length_units = _finite_number(candidate.get("length_units"))
    length_mm = _finite_number(candidate.get("length_mm"))

    if center is None:
        issues.append(
            _issue(
                "candidate_geometry_center_missing",
                "Candidate center must be a finite 3D point.",
                path="candidate.center",
            )
        )
    if axis_unit is None:
        issues.append(
            _issue(
                "candidate_geometry_axis_invalid",
                "Candidate axis must be a non-zero finite 3D vector.",
                path="candidate.axis",
            )
        )
    if endpoints is None or len(endpoints) != 2:
        issues.append(
            _issue(
                "candidate_geometry_endpoints_invalid",
                "Candidate endpoints must contain exactly two finite 3D points.",
                path="candidate.endpoints",
            )
        )
    if length_mm is None or length_mm <= 0:
        issues.append(
            _issue(
                "candidate_geometry_length_invalid",
                "Candidate length_mm must be positive.",
                path="candidate.length_mm",
            )
        )
    if length_units is None or length_units <= 0:
        issues.append(
            _issue(
                "candidate_geometry_length_invalid",
                "Candidate length_units must be positive.",
                path="candidate.length_units",
            )
        )

    if endpoints is not None and len(endpoints) == 2:
        p0, p1 = endpoints
        segment = _vec_sub(p1, p0)
        segment_len = _vec_len(segment)
        segment_unit = _vec_unit(segment)
        if center is not None and not _points_close(_vec_mid(p0, p1), center):
            issues.append(
                _issue(
                    "candidate_geometry_center_mismatch",
                    "Candidate endpoints must be symmetric around candidate.center.",
                    path="candidate.center",
                )
            )
        if length_units is not None and length_units > 0:
            tolerance = max(GEOMETRY_TOLERANCE, length_units * 1e-6)
            if abs(segment_len - length_units) > tolerance:
                issues.append(
                    _issue(
                        "candidate_geometry_length_mismatch",
                        (
                            f"Endpoint distance {segment_len!r} does not match "
                            f"candidate.length_units={length_units!r}."
                        ),
                        path="candidate.length_units",
                    )
                )
        if axis_unit is not None and segment_unit is not None:
            if abs(_vec_dot(axis_unit, segment_unit)) < 1.0 - 1e-6:
                issues.append(
                    _issue(
                        "candidate_geometry_axis_mismatch",
                        "Candidate endpoint segment must align with candidate.axis.",
                        path="candidate.axis",
                    )
                )

    if candidate_type == "linear":
        if polyline is None or len(polyline) != 2:
            issues.append(
                _issue(
                    "candidate_geometry_polyline_invalid",
                    "Linear candidates must export a two-point polyline.",
                    path="candidate.polyline",
                )
            )
        elif endpoints is not None and len(endpoints) == 2:
            if not _points_close(polyline[0], endpoints[0]) or not _points_close(polyline[1], endpoints[1]):
                issues.append(
                    _issue(
                        "candidate_geometry_polyline_mismatch",
                        "Linear candidate polyline must match candidate.endpoints.",
                        path="candidate.polyline",
                    )
                )
        return issues

    width_axis = _point(candidate.get("width_axis"))
    width_axis_unit = _vec_unit(width_axis) if width_axis is not None else None
    width_units = _finite_number(candidate.get("width_units"))
    width_mm = _finite_number(candidate.get("width_mm"))
    outline = _point_list(candidate.get("outline"))
    if width_axis_unit is None:
        issues.append(
            _issue(
                "candidate_geometry_axis_invalid",
                "Fusiform candidates must export a non-zero finite width_axis.",
                path="candidate.width_axis",
            )
        )
    elif axis_unit is not None and abs(_vec_dot(axis_unit, width_axis_unit)) > 1e-6:
        issues.append(
            _issue(
                "candidate_geometry_axis_mismatch",
                "Fusiform candidate.width_axis must be perpendicular to candidate.axis.",
                path="candidate.width_axis",
            )
        )
    if width_mm is None or width_mm <= 0:
        issues.append(
            _issue(
                "candidate_geometry_width_invalid",
                "Fusiform candidate width_mm must be positive.",
                path="candidate.width_mm",
            )
        )
    if width_units is None or width_units <= 0:
        issues.append(
            _issue(
                "candidate_geometry_width_invalid",
                "Fusiform candidate width_units must be positive.",
                path="candidate.width_units",
            )
        )
    if outline is None or len(outline) < 4:
        issues.append(
            _issue(
                "candidate_geometry_outline_invalid",
                "Fusiform candidates must export an outline with at least four finite points.",
                path="candidate.outline",
            )
        )
    if polyline is None or len(polyline) < 5:
        issues.append(
            _issue(
                "candidate_geometry_polyline_invalid",
                "Fusiform candidates must export a closed renderable polyline.",
                path="candidate.polyline",
            )
        )
    elif not _points_close(polyline[0], polyline[-1]):
        issues.append(
            _issue(
                "candidate_geometry_polyline_mismatch",
                "Fusiform candidate polyline must be closed.",
                path="candidate.polyline",
            )
        )
    elif outline is not None and len(outline) >= 4:
        if len(polyline) != len(outline) + 1:
            issues.append(
                _issue(
                    "candidate_geometry_polyline_mismatch",
                    "Fusiform candidate polyline must contain outline points plus a closing point.",
                    path="candidate.polyline",
                )
            )
        elif any(not _points_close(polyline[index], point) for index, point in enumerate(outline)):
            issues.append(
                _issue(
                    "candidate_geometry_polyline_mismatch",
                    "Fusiform candidate polyline must preserve outline point order.",
                    path="candidate.polyline",
                )
            )
    return issues


def _candidate_edit_session_issues(record: dict[str, Any]) -> list[dict[str, str]]:
    candidate = record.get("candidate") if isinstance(record.get("candidate"), dict) else {}
    if not candidate:
        return []

    provenance = candidate.get("provenance")
    session = record.get("candidate_edit_session")
    issues: list[dict[str, str]] = []
    if not isinstance(provenance, dict):
        issues.append(
            _issue(
                "candidate_provenance_missing",
                "Review candidate must include provenance for versioned clinician review.",
                path="candidate.provenance",
            )
        )
        return issues
    if session is None:
        issues.append(
            _issue(
                "candidate_edit_session_missing",
                "Review records must export candidate_edit_session derived from candidate provenance.",
                path="candidate_edit_session",
            )
        )
        return issues
    if not isinstance(session, dict):
        issues.append(
            _issue(
                "candidate_edit_session_invalid",
                "candidate_edit_session must be an object.",
                path="candidate_edit_session",
            )
        )
        return issues
    if session.get("schema_version") != "candidate-edit-session/v0.1":
        issues.append(
            _issue(
                "candidate_edit_session_schema_mismatch",
                (
                    "candidate_edit_session.schema_version must be "
                    "'candidate-edit-session/v0.1'."
                ),
                path="candidate_edit_session.schema_version",
            )
        )

    candidate_version = _whole_number(provenance.get("candidate_version"))
    session_version = _whole_number(session.get("candidate_version"))
    if candidate_version is None or candidate_version < 1:
        issues.append(
            _issue(
                "candidate_edit_history_version_mismatch",
                "candidate.provenance.candidate_version must be an integer >= 1.",
                path="candidate.provenance.candidate_version",
            )
        )
    elif session_version != candidate_version:
        issues.append(
            _issue(
                "candidate_edit_session_mismatch",
                (
                    f"candidate_edit_session.candidate_version={session.get('candidate_version')!r} "
                    f"does not match candidate.provenance.candidate_version={candidate_version!r}."
                ),
                path="candidate_edit_session.candidate_version",
            )
        )

    history = provenance.get("edit_history")
    session_history = session.get("history")
    if not isinstance(history, list):
        issues.append(
            _issue(
                "candidate_edit_history_invalid",
                "candidate.provenance.edit_history must be a list.",
                path="candidate.provenance.edit_history",
            )
        )
        return issues
    if not isinstance(session_history, list):
        issues.append(
            _issue(
                "candidate_edit_session_invalid",
                "candidate_edit_session.history must be a list.",
                path="candidate_edit_session.history",
            )
        )
        return issues

    edit_count = _whole_number(session.get("edit_count"))
    if edit_count != len(history):
        issues.append(
            _issue(
                "candidate_edit_session_mismatch",
                (
                    f"candidate_edit_session.edit_count={session.get('edit_count')!r} "
                    f"does not match provenance edit_history length {len(history)}."
                ),
                path="candidate_edit_session.edit_count",
            )
        )
    if len(session_history) != len(history):
        issues.append(
            _issue(
                "candidate_edit_session_mismatch",
                (
                    f"candidate_edit_session.history length {len(session_history)} "
                    f"does not match provenance edit_history length {len(history)}."
                ),
                path="candidate_edit_session.history",
            )
        )

    last_version: int | None = None
    edit_ids: set[str] = set()
    for index, entry in enumerate(history):
        if not isinstance(entry, dict):
            issues.append(
                _issue(
                    "candidate_edit_history_invalid",
                    "candidate.provenance.edit_history entries must be objects.",
                    path=f"candidate.provenance.edit_history[{index}]",
                )
            )
            continue
        edit_id = str(entry.get("edit_id") or "")
        version = _whole_number(entry.get("resulting_candidate_version"))
        if not edit_id:
            issues.append(
                _issue(
                    "candidate_edit_history_invalid",
                    "candidate.provenance.edit_history entries must include edit_id.",
                    path=f"candidate.provenance.edit_history[{index}].edit_id",
                )
            )
        elif edit_id in edit_ids:
            issues.append(
                _issue(
                    "candidate_edit_history_invalid",
                    f"candidate.provenance.edit_history contains duplicate edit_id {edit_id!r}.",
                    path=f"candidate.provenance.edit_history[{index}].edit_id",
                )
            )
        edit_ids.add(edit_id)
        if version is None or version < 2:
            issues.append(
                _issue(
                    "candidate_edit_history_version_mismatch",
                    "Each clinician edit must record resulting_candidate_version >= 2.",
                    path=f"candidate.provenance.edit_history[{index}].resulting_candidate_version",
                )
            )
            continue
        if last_version is not None and version <= last_version:
            issues.append(
                _issue(
                    "candidate_edit_history_version_mismatch",
                    "candidate.provenance.edit_history versions must increase monotonically.",
                    path=f"candidate.provenance.edit_history[{index}].resulting_candidate_version",
                )
            )
        last_version = version

        if index < len(session_history) and isinstance(session_history[index], dict):
            session_entry = session_history[index]
            if session_entry.get("edit_id") != entry.get("edit_id"):
                issues.append(
                    _issue(
                        "candidate_edit_session_mismatch",
                        "candidate_edit_session.history edit_id does not match provenance edit_history.",
                        path=f"candidate_edit_session.history[{index}].edit_id",
                    )
                )
            if session_entry.get("resulting_candidate_version") != entry.get("resulting_candidate_version"):
                issues.append(
                    _issue(
                        "candidate_edit_session_mismatch",
                        (
                            "candidate_edit_session.history resulting_candidate_version does not "
                            "match provenance edit_history."
                        ),
                        path=f"candidate_edit_session.history[{index}].resulting_candidate_version",
                    )
                )
        elif index < len(session_history):
            issues.append(
                _issue(
                    "candidate_edit_session_invalid",
                    "candidate_edit_session.history entries must be objects.",
                    path=f"candidate_edit_session.history[{index}]",
                )
            )

    if history:
        latest = history[-1] if isinstance(history[-1], dict) else {}
        latest_edit_id = latest.get("edit_id")
        latest_version = _whole_number(latest.get("resulting_candidate_version"))
        clinician_edit = provenance.get("clinician_edit")
        if candidate_version is not None and latest_version != candidate_version:
            issues.append(
                _issue(
                    "candidate_edit_history_version_mismatch",
                    (
                        "candidate.provenance.candidate_version must match the latest "
                        "edit_history resulting_candidate_version."
                    ),
                    path="candidate.provenance.candidate_version",
                )
            )
        if not isinstance(clinician_edit, dict) or clinician_edit.get("edit_id") != latest_edit_id:
            issues.append(
                _issue(
                    "candidate_edit_current_mismatch",
                    "candidate.provenance.clinician_edit must point to the latest edit_history entry.",
                    path="candidate.provenance.clinician_edit",
                )
            )
        if session.get("current_edit_id") != latest_edit_id:
            issues.append(
                _issue(
                    "candidate_edit_current_mismatch",
                    "candidate_edit_session.current_edit_id must match the latest edit_history edit_id.",
                    path="candidate_edit_session.current_edit_id",
                )
            )
    else:
        if candidate_version is not None and candidate_version != 1:
            issues.append(
                _issue(
                    "candidate_edit_history_version_mismatch",
                    "Unedited candidates must keep candidate_version=1.",
                    path="candidate.provenance.candidate_version",
                )
            )
        if session.get("current_edit_id") not in (None, ""):
            issues.append(
                _issue(
                    "candidate_edit_current_mismatch",
                    "Unedited candidates must not export a current_edit_id.",
                    path="candidate_edit_session.current_edit_id",
                )
            )

    for key in ("undo_available", "redo_available"):
        if key in session and not isinstance(session[key], bool):
            issues.append(
                _issue(
                    "candidate_edit_session_invalid",
                    f"candidate_edit_session.{key} must be boolean when present.",
                    path=f"candidate_edit_session.{key}",
                )
            )
    return issues


def _record_tumor(record: dict[str, Any]) -> tuple[TumorInput | None, list[dict[str, str]]]:
    tumor_payload = record.get("tumor")
    if not isinstance(tumor_payload, dict):
        return None, []

    try:
        return tumor_from_payload(tumor_payload), []
    except Exception as exc:  # noqa: BLE001 - audit should report malformed exports instead of crashing.
        return None, [
            _issue(
                "tumor_input_invalid",
                f"Review record tumor payload cannot be parsed: {exc}",
                path="tumor",
            )
        ]


def _warning_signature(warnings: Any) -> list[tuple[str, str]]:
    if not isinstance(warnings, list):
        return []
    return [
        (
            str(warning.get("code") or ""),
            str(warning.get("severity") or "medium"),
        )
        for warning in warnings
        if isinstance(warning, dict)
    ]


def _tumor_quality_issues(record: dict[str, Any], tumor: TumorInput | None) -> list[dict[str, str]]:
    if tumor is None:
        return []

    exported = record.get("tumor_quality")
    if exported is None:
        return [
            _issue(
                "tumor_quality_missing",
                "Review records with tumor input must export tumor_quality for pre-share audit.",
                path="tumor_quality",
            )
        ]
    if not isinstance(exported, dict):
        return [
            _issue(
                "tumor_quality_invalid",
                "tumor_quality must be an object.",
                path="tumor_quality",
            )
        ]

    issues: list[dict[str, str]] = []
    observed = tumor.input_quality()
    for key in ("passed", "warning_count", "source", "boundary_source", "author_present", "units"):
        if exported.get(key) != observed.get(key):
            issues.append(
                _issue(
                    "tumor_quality_mismatch",
                    (
                        f"tumor_quality.{key}={exported.get(key)!r} does not match "
                        f"recomputed {observed.get(key)!r}."
                    ),
                    path=f"tumor_quality.{key}",
                )
            )

    warnings = exported.get("warnings")
    if not isinstance(warnings, list):
        issues.append(
            _issue(
                "tumor_quality_invalid",
                "tumor_quality.warnings must be a list.",
                path="tumor_quality.warnings",
            )
        )
    elif any(not isinstance(warning, dict) for warning in warnings):
        issues.append(
            _issue(
                "tumor_quality_invalid",
                "tumor_quality.warnings entries must be objects.",
                path="tumor_quality.warnings",
            )
        )
    elif _warning_signature(warnings) != _warning_signature(observed.get("warnings")):
        issues.append(
            _issue(
                "tumor_quality_warnings_mismatch",
                "tumor_quality.warnings code/severity list does not match recomputed tumor input quality.",
                path="tumor_quality.warnings",
            )
        )
    return issues


def _tumor_boundary_summary_issues(record: dict[str, Any], tumor: TumorInput | None) -> list[dict[str, str]]:
    if tumor is None:
        return []

    boundary_expected = tumor.kind == "cutaneous" and len(tumor.boundary) >= 3
    exported = record.get("tumor_boundary_summary")
    if not boundary_expected:
        if exported is not None and not isinstance(exported, dict):
            return [
                _issue(
                    "tumor_boundary_summary_invalid",
                    "tumor_boundary_summary must be an object when present.",
                    path="tumor_boundary_summary",
                )
            ]
        return []
    if exported is None:
        return [
            _issue(
                "tumor_boundary_summary_missing",
                "Cutaneous review records with a boundary must export tumor_boundary_summary.",
                path="tumor_boundary_summary",
            )
        ]
    if not isinstance(exported, dict):
        return [
            _issue(
                "tumor_boundary_summary_invalid",
                "tumor_boundary_summary must be an object.",
                path="tumor_boundary_summary",
            )
        ]

    issues: list[dict[str, str]] = []
    units_per_mm = _finite_number(exported.get("units_per_mm"))
    axis = _candidate_axis(record)
    normal = _point(exported.get("summary_normal"))
    if units_per_mm is None or units_per_mm <= 0:
        issues.append(
            _issue(
                "tumor_boundary_summary_missing_scale",
                "tumor_boundary_summary.units_per_mm must be present and positive for audit replay.",
                path="tumor_boundary_summary.units_per_mm",
            )
        )
    if axis is None:
        issues.append(
            _issue(
                "tumor_boundary_summary_missing_candidate_axis",
                "candidate.axis is required to replay tumor_boundary_summary against the saved candidate.",
                path="candidate.axis",
            )
        )
    if normal is None:
        issues.append(
            _issue(
                "tumor_boundary_summary_missing_normal",
                "tumor_boundary_summary.summary_normal must be present for audit replay.",
                path="tumor_boundary_summary.summary_normal",
            )
        )
    if issues:
        return issues

    observed = tumor_boundary_summary(
        tumor,
        units_per_mm=units_per_mm,
        axis=axis,
        normal=normal,
    )
    for key in ("point_count", "boundary_used", "mode", "source"):
        if key in exported and exported[key] != observed.get(key):
            issues.append(
                _issue(
                    "tumor_boundary_summary_mismatch",
                    (
                        f"tumor_boundary_summary.{key}={exported[key]!r} does not match "
                        f"recomputed {observed.get(key)!r}."
                    ),
                    path=f"tumor_boundary_summary.{key}",
                )
            )
    for key in (*BOUNDARY_FLOAT_FIELDS, "center", "summary_axis", "summary_normal"):
        if key in exported and key in observed and not _close_enough(exported[key], observed[key]):
            issues.append(
                _issue(
                    "tumor_boundary_summary_mismatch",
                    (
                        f"tumor_boundary_summary.{key}={exported[key]!r} does not match "
                        f"recomputed {observed[key]!r}."
                    ),
                    path=f"tumor_boundary_summary.{key}",
                )
            )
    for key in BOUNDARY_EXACT_FIELDS:
        if key in exported and key in observed and exported[key] != observed[key]:
            issues.append(
                _issue(
                    "tumor_boundary_summary_mismatch",
                    (
                        f"tumor_boundary_summary.{key}={exported[key]!r} does not match "
                        f"recomputed {observed[key]!r}."
                    ),
                    path=f"tumor_boundary_summary.{key}",
                )
            )

    candidate = record.get("candidate") if isinstance(record.get("candidate"), dict) else {}
    metrics = candidate.get("metrics") if isinstance(candidate.get("metrics"), dict) else {}
    if candidate.get("type") == "fusiform":
        metric_pairs = {
            "boundary_point_count": "point_count",
            "boundary_axis_diameter_mm": "axis_diameter_mm",
            "boundary_perp_diameter_mm": "perp_diameter_mm",
            "boundary_area_mm2": "area_mm2",
            "boundary_area_ratio_to_diameter_disk": "area_ratio_to_diameter_disk",
            "boundary_center_shift_mm": "center_shift_mm",
        }
        for metric_key, summary_key in metric_pairs.items():
            if (
                metric_key in metrics
                and summary_key in observed
                and not _close_enough(metrics[metric_key], observed[summary_key])
            ):
                issues.append(
                    _issue(
                        "tumor_boundary_candidate_metric_mismatch",
                        (
                            f"candidate.metrics.{metric_key}={metrics[metric_key]!r} does not match "
                            f"tumor_boundary_summary {observed[summary_key]!r}."
                        ),
                        path=f"candidate.metrics.{metric_key}",
                    )
                )
        if (
            "boundary_self_intersection" in metrics
            and metrics["boundary_self_intersection"] != observed.get("self_intersection")
        ):
            issues.append(
                _issue(
                    "tumor_boundary_candidate_metric_mismatch",
                    (
                        "candidate.metrics.boundary_self_intersection does not match "
                        "recomputed tumor_boundary_summary.self_intersection."
                    ),
                    path="candidate.metrics.boundary_self_intersection",
                )
            )
    return issues


def audit_review_record(record: dict[str, Any], *, source: str = "<memory>") -> dict[str, Any]:
    review = _review(record)
    status = _review_status(record)
    gate = _stored_gate(record)
    expected = expected_review_gate(record)
    issues: list[dict[str, str]] = []
    tumor, tumor_parse_issues = _record_tumor(record)
    expected_tumor_quality = tumor.input_quality() if tumor is not None else None
    issues.extend(tumor_parse_issues)

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

    issues.extend(_tumor_quality_issues(record, tumor))
    issues.extend(_tumor_boundary_summary_issues(record, tumor))
    issues.extend(_candidate_edit_session_issues(record))
    issues.extend(_candidate_geometry_issues(record))

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
        "expected_tumor_quality": expected_tumor_quality,
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
