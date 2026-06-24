#!/usr/bin/env python3
"""Aggregate Stage 2 incision-review exports into validation metrics.

The input is intentionally limited to sanitized review JSON exported by
`web/incision_agent.html`: no images, video frames, textures, or raw clinical
files are needed. This gives issue #20 an executable metric contract while the
real clinical dataset remains in controlled storage.
"""
from __future__ import annotations

import argparse
import json
import math
from collections import Counter
from pathlib import Path
from statistics import mean, median
from typing import Any

RECORD_SCHEMA = "incision-review-record/v0.3"
EXPORT_SCHEMA = "incision-review-export/v0.3"
SUMMARY_SCHEMA = "stage2-validation-summary/v0.1"

STATUS_APPROVED = "approved_for_discussion"
STATUS_REJECTED = "rejected_by_clinician"

WARNING_FAILURE_MODE_MAP = {
    "low_rstl_confidence": "direction_error",
    "low_region_confidence": "region_misclassification",
    "candidate_near_sensitive_free_margin": "sensitive_structure_warning",
    "center_near_sensitive_free_margin": "sensitive_structure_warning",
    "sensitive_region": "sensitive_structure_warning",
    "diameter_coverage_deficit": "incision_rule_violation",
    "axis_coverage_deficit": "incision_rule_violation",
    "few_boundary_points": "tumor_boundary_input_quality",
    "boundary_self_intersection": "tumor_boundary_input_quality",
    "boundary_area_degenerate": "tumor_boundary_input_quality",
    "boundary_center_shift": "tumor_boundary_input_quality",
}

SECRET_KEY_HINTS = ("api_key", "secret", "token", "authorization", "password")
REDACTED_VALUES = {"", "[redacted]", "redacted", "***", "null", "none"}


def load_payload(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def records_from_payload(payload: Any) -> list[dict[str, Any]]:
    """Extract review records from one record, export payload, or list."""

    if isinstance(payload, list):
        records: list[dict[str, Any]] = []
        for item in payload:
            records.extend(records_from_payload(item))
        return records

    if not isinstance(payload, dict):
        return []

    schema = payload.get("schema_version")
    if schema == RECORD_SCHEMA:
        return [payload]
    if schema == EXPORT_SCHEMA:
        records = []
        current = payload.get("current")
        if isinstance(current, dict):
            records.append(current)
        records.extend(r for r in payload.get("saved", []) if isinstance(r, dict))
        return records

    if "candidate" in payload and "tumor" in payload:
        return [payload]
    return []


def _ratio(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 0.0


def _numeric(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _p90(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, math.ceil(0.9 * len(ordered)) - 1))
    return ordered[idx]


def summarize_numbers(values: list[float]) -> dict[str, float | int]:
    clean = [v for v in values if math.isfinite(v)]
    if not clean:
        return {"count": 0}
    return {
        "count": len(clean),
        "mean": mean(clean),
        "median": median(clean),
        "p90": _p90(clean),
        "min": min(clean),
        "max": max(clean),
    }


def _warnings(record: dict[str, Any]) -> list[dict[str, Any]]:
    guardrails = record.get("guardrails") or {}
    return [w for w in guardrails.get("warnings", []) if isinstance(w, dict)]


def _failure_modes(record: dict[str, Any]) -> list[str]:
    review = record.get("review") or {}
    explicit = review.get("failure_modes") or review.get("failureModes") or record.get("failureModes") or []
    modes = [str(mode) for mode in explicit if mode]
    if record.get("review_status") == STATUS_REJECTED:
        modes.append("review_rejected")
    for warning in _warnings(record):
        code = str(warning.get("code") or "")
        mapped = WARNING_FAILURE_MODE_MAP.get(code)
        if mapped:
            modes.append(mapped)
    return sorted(set(modes))


def _has_secret_leak(value: Any, key_path: tuple[str, ...] = ()) -> bool:
    if isinstance(value, dict):
        for key, child in value.items():
            if _has_secret_leak(child, (*key_path, str(key).lower())):
                return True
        return False
    if isinstance(value, list):
        return any(_has_secret_leak(item, key_path) for item in value)
    if isinstance(value, bool):
        return False
    if key_path and key_path[-1].endswith("_present"):
        return False
    if not any(hint in ".".join(key_path) for hint in SECRET_KEY_HINTS):
        return False
    text = str(value).strip()
    return text.lower() not in REDACTED_VALUES and len(text) > 0


def evaluate_records(records: list[dict[str, Any]], input_files: list[str] | None = None) -> dict[str, Any]:
    status_counts: Counter[str] = Counter()
    candidate_type_counts: Counter[str] = Counter()
    tumor_kind_counts: Counter[str] = Counter()
    warning_code_counts: Counter[str] = Counter()
    warning_severity_counts: Counter[str] = Counter()
    failure_mode_counts: Counter[str] = Counter()

    direction_confidence: list[float] = []
    rstl_deviation: list[float] = []
    linear_deficit: list[float] = []
    fusiform_ratio: list[float] = []
    fusiform_tip_error: list[float] = []
    fusiform_axis_deficit: list[float] = []
    sensitive_margin_distance: list[float] = []
    boundary_area_ratio: list[float] = []

    passed_guardrails = 0
    raw_image_sent_count = 0
    secret_leak_count = 0

    for record in records:
        candidate = record.get("candidate") or {}
        tumor = record.get("tumor") or {}
        guardrails = record.get("guardrails") or {}
        metrics = candidate.get("metrics") or {}

        review_status = record.get("review_status") or record.get("review", {}).get("status") or "unknown"
        status_counts[str(review_status)] += 1
        candidate_type = str(candidate.get("type") or "unknown")
        tumor_kind = str(tumor.get("kind") or candidate.get("tumor_kind") or "unknown")
        candidate_type_counts[candidate_type] += 1
        tumor_kind_counts[tumor_kind] += 1

        if guardrails.get("passed") is True:
            passed_guardrails += 1
        for warning in _warnings(record):
            warning_code_counts[str(warning.get("code") or "unknown")] += 1
            warning_severity_counts[str(warning.get("severity") or "unknown")] += 1

        for mode in _failure_modes(record):
            failure_mode_counts[mode] += 1

        for target, key in [
            (direction_confidence, "direction_confidence"),
            (rstl_deviation, "rstl_deviation_deg"),
            (sensitive_margin_distance, "sensitive_free_margin_min_distance_mm"),
            (boundary_area_ratio, "boundary_area_ratio_to_diameter_disk"),
        ]:
            value = _numeric(candidate.get(key) if key == "direction_confidence" else metrics.get(key))
            if value is not None:
                target.append(value)

        if candidate_type == "linear":
            value = _numeric(metrics.get("diameter_coverage_deficit_mm"))
            if value is not None:
                linear_deficit.append(value)
        if candidate_type == "fusiform":
            for target, key in [
                (fusiform_ratio, "length_to_width_ratio"),
                (fusiform_tip_error, "tip_angle_error_deg"),
                (fusiform_axis_deficit, "axis_coverage_deficit_mm"),
            ]:
                value = _numeric(metrics.get(key))
                if value is not None:
                    target.append(value)

        privacy = record.get("privacy_audit") or {}
        if privacy.get("raw_image_sent") is True or privacy.get("raw_video_sent") is True:
            raw_image_sent_count += 1
        if _has_secret_leak(record.get("provider_config") or {}):
            secret_leak_count += 1

    record_count = len(records)
    approved = status_counts[STATUS_APPROVED]
    rejected = status_counts[STATUS_REJECTED]
    return {
        "schema_version": SUMMARY_SCHEMA,
        "input_files": input_files or [],
        "record_count": record_count,
        "candidate_type_counts": dict(sorted(candidate_type_counts.items())),
        "tumor_kind_counts": dict(sorted(tumor_kind_counts.items())),
        "review_status_counts": dict(sorted(status_counts.items())),
        "clinician_review": {
            "approved_for_discussion_count": approved,
            "rejected_by_clinician_count": rejected,
            "approval_rate": _ratio(approved, record_count),
            "rejection_rate": _ratio(rejected, record_count),
        },
        "guardrails": {
            "passed_count": passed_guardrails,
            "needs_review_count": record_count - passed_guardrails,
            "pass_rate": _ratio(passed_guardrails, record_count),
            "warning_code_counts": dict(sorted(warning_code_counts.items())),
            "warning_severity_counts": dict(sorted(warning_severity_counts.items())),
        },
        "metrics": {
            "direction_confidence": summarize_numbers(direction_confidence),
            "rstl_deviation_deg": summarize_numbers(rstl_deviation),
            "linear_diameter_coverage_deficit_mm": summarize_numbers(linear_deficit),
            "fusiform_length_to_width_ratio": summarize_numbers(fusiform_ratio),
            "fusiform_tip_angle_error_deg": summarize_numbers(fusiform_tip_error),
            "fusiform_axis_coverage_deficit_mm": summarize_numbers(fusiform_axis_deficit),
            "sensitive_free_margin_min_distance_mm": summarize_numbers(sensitive_margin_distance),
            "boundary_area_ratio_to_diameter_disk": summarize_numbers(boundary_area_ratio),
        },
        "failure_mode_counts": dict(sorted(failure_mode_counts.items())),
        "privacy_audit": {
            "raw_media_sent_count": raw_image_sent_count,
            "provider_secret_leak_count": secret_leak_count,
        },
        "clinical_boundary": (
            "Aggregated from sanitized review JSON only; this is a research validation summary, "
            "not proof of clinical safety or a surgical instruction."
        ),
    }


def evaluate_payloads(payloads: list[Any], input_files: list[str] | None = None) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    for payload in payloads:
        records.extend(records_from_payload(payload))
    return evaluate_records(records, input_files=input_files)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+", help="Sanitized incision review JSON files")
    parser.add_argument("--output", "-o", help="Write summary JSON to this path")
    args = parser.parse_args(argv)

    paths = [Path(p) for p in args.inputs]
    payloads = [load_payload(path) for path in paths]
    summary = evaluate_payloads(payloads, input_files=[str(path) for path in paths])
    text = json.dumps(summary, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
