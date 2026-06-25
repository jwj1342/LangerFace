#!/usr/bin/env python3
"""Audit Stage 2 clinical rule drift across asset and Python defaults.

The JSON asset is the reviewable source of truth for the draft clinical rules.
This audit catches accidental drift in the deterministic Python defaults that
drive incision geometry and guardrails. It does not validate the clinical
correctness of thresholds or direction hints.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from langerface.clinical import default_clinical_rules

AUDIT_SCHEMA = "clinical-rules-drift-audit/v0.1"
DEFAULT_ASSET = Path("assets/clinical_rules_face_incision.json")

CRITICAL_TOP_LEVEL_FIELDS = (
    "version",
    "review_status",
    "last_reviewed_at",
    "medical_boundary",
    "clinician_review_required",
)
TYPE_RULE_FIELDS = {
    "linear_subcutaneous": (
        "length_multiplier",
        "min_length_mm",
        "max_length_mm",
        "max_rstl_deviation_deg",
    ),
    "fusiform_cutaneous": (
        "length_to_width_ratio",
        "tip_angle_deg",
        "min_length_mm",
        "max_length_mm",
        "max_rstl_deviation_deg",
        "samples",
    ),
}
GUARDRAIL_FIELDS = (
    "low_direction_confidence",
    "low_region_confidence",
    "free_margin_distance_warn_mm",
    "min_freehand_boundary_points",
    "min_boundary_area_diameter_disk_fraction",
    "boundary_center_shift_diameter_multiplier",
)


def _issue(code: str, path: str, message: str, *, severity: str = "high") -> dict[str, str]:
    return {"code": code, "severity": severity, "path": path, "message": message}


def _same_value(left: Any, right: Any) -> bool:
    if isinstance(left, int | float) and isinstance(right, int | float):
        return abs(float(left) - float(right)) <= 1e-9
    if isinstance(left, list) and isinstance(right, list) and len(left) == len(right):
        return all(_same_value(a, b) for a, b in zip(left, right, strict=True))
    return left == right


def _compare_value(
    source: dict[str, Any],
    target: dict[str, Any],
    path: str,
    issues: list[dict[str, str]],
) -> None:
    parts = path.split(".")
    left: Any = source
    right: Any = target
    for part in parts:
        if not isinstance(left, dict) or part not in left:
            issues.append(
                _issue("clinical_rule_source_missing", path, "Source clinical rule field is missing.")
            )
            return
        if not isinstance(right, dict) or part not in right:
            issues.append(
                _issue("clinical_rule_default_missing", path, "Python default rule field is missing.")
            )
            return
        left = left[part]
        right = right[part]
    if not _same_value(left, right):
        issues.append(
            _issue(
                "clinical_rule_default_drift",
                path,
                f"Python default {right!r} does not match source asset {left!r}.",
            )
        )


def load_asset(path: str | Path = DEFAULT_ASSET) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("clinical rules asset must be a JSON object")
    return payload


def audit_rules(
    source_rules: dict[str, Any] | None = None,
    python_rules: dict[str, Any] | None = None,
    *,
    asset_path: str | Path = DEFAULT_ASSET,
) -> dict[str, Any]:
    source = source_rules or load_asset(asset_path)
    target = python_rules or default_clinical_rules()
    issues: list[dict[str, str]] = []

    for field in CRITICAL_TOP_LEVEL_FIELDS:
        _compare_value(source, target, field, issues)

    for section, fields in TYPE_RULE_FIELDS.items():
        for field in fields:
            _compare_value(source, target, f"{section}.{field}", issues)

    for field in GUARDRAIL_FIELDS:
        _compare_value(source, target, f"guardrails.{field}", issues)
    _compare_value(source, target, "guardrails.free_margin_distance_thresholds_mm", issues)
    _compare_value(source, target, "guardrails.protective_direction_hints", issues)

    source_regions = set((source.get("region_rules") or {}).keys())
    target_regions = set((target.get("region_rules") or {}).keys())
    if source_regions != target_regions:
        issues.append(
            _issue(
                "clinical_region_rule_set_drift",
                "region_rules",
                (
                    "Python region rule keys do not match source asset: "
                    f"missing={sorted(source_regions - target_regions)}, "
                    f"extra={sorted(target_regions - source_regions)}."
                ),
            )
        )
    for region in sorted(source_regions & target_regions):
        for field in ("recommended_direction", "priority_order", "review_status", "last_reviewed_at"):
            _compare_value(source, target, f"region_rules.{region}.{field}", issues)

    return {
        "schema_version": AUDIT_SCHEMA,
        "asset_path": str(asset_path),
        "passed": not issues,
        "issue_count": len(issues),
        "issues": issues,
        "source_version": source.get("version"),
        "python_version": target.get("version"),
        "checked_region_count": len(source_regions & target_regions),
        "checked_guardrail_thresholds": sorted((source.get("guardrails") or {}).get(
            "free_margin_distance_thresholds_mm", {}
        )),
        "checked_protective_direction_hints": sorted((source.get("guardrails") or {}).get(
            "protective_direction_hints", {}
        )),
        "clinical_boundary": (
            "Rule drift audit checks implementation consistency only; thresholds and direction hints remain "
            "draft_not_clinically_validated until clinician review."
        ),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asset", default=str(DEFAULT_ASSET), help="Clinical rules JSON asset")
    parser.add_argument("--output", "-o", help="Write audit JSON report")
    parser.add_argument("--no-fail", action="store_true", help="Always exit 0 after writing the report")
    args = parser.parse_args(argv)

    report = audit_rules(asset_path=Path(args.asset))
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    return 0 if report["passed"] or args.no_fail else 1


if __name__ == "__main__":
    raise SystemExit(main())
