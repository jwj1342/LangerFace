#!/usr/bin/env python3
"""Audit Stage 2 tumor-input JSON exports before review or sharing.

The audit is deliberately narrow: it verifies the structured tumor contract,
checks the same tumor quality warnings used by the incision tools, and catches
privacy or integrity mistakes in ``tumor-input/v0.2`` exports. It does not infer
diagnosis, margin adequacy, or clinical readiness.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from langerface.tumor import TUMOR_INPUT_SCHEMA, TumorInput, tumor_from_payload

AUDIT_SCHEMA = "tumor-input-audit/v0.1"
RAW_MEDIA_FLAGS = ("raw_image_sent", "raw_video_sent", "contains_face_image", "contains_raw_media")


def _issue(code: str, message: str, *, severity: str = "high", path: str = "$") -> dict[str, str]:
    return {
        "code": code,
        "severity": severity,
        "path": path,
        "message": message,
    }


def load_payload(path: str | Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("tumor input audit expects a JSON object")
    return payload


def tumor_boundary_summary(tumor: TumorInput) -> dict[str, Any]:
    point_count = len(tumor.boundary)
    boundary_used = tumor.kind == "cutaneous" and point_count >= 3
    return {
        "mode": tumor.boundary_mode,
        "source": tumor.boundary_source,
        "point_count": point_count,
        "boundary_used": boundary_used,
    }


def _privacy_issues(payload: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, str]]]:
    privacy = payload.get("privacy_audit") if isinstance(payload.get("privacy_audit"), dict) else {}
    issues: list[dict[str, str]] = []
    for key in RAW_MEDIA_FLAGS:
        if privacy.get(key) is True:
            issues.append(
                _issue(
                    "raw_media_flag_true",
                    "Tumor input export marks raw media or face image content as present.",
                    path=f"privacy_audit.{key}",
                )
            )
    if privacy and privacy.get("contains_abstract_face_coordinates") is not True:
        issues.append(
            _issue(
                "abstract_coordinate_flag_missing",
                "Tumor input exports should identify center/boundary points as abstract face coordinates.",
                severity="medium",
                path="privacy_audit.contains_abstract_face_coordinates",
            )
        )
    return dict(privacy), issues


def _schema_issues(payload: dict[str, Any]) -> list[dict[str, str]]:
    schema = payload.get("schema_version")
    if schema is None:
        return []
    if schema != TUMOR_INPUT_SCHEMA:
        return [
            _issue(
                "unexpected_tumor_input_schema",
                f"Expected {TUMOR_INPUT_SCHEMA}, got {schema!r}.",
                path="schema_version",
            )
        ]
    return []


def _boundary_integrity_issues(
    payload: dict[str, Any],
    observed: dict[str, Any],
) -> list[dict[str, str]]:
    exported = payload.get("boundary_summary")
    if exported is None:
        return []
    if not isinstance(exported, dict):
        return [
            _issue(
                "boundary_summary_invalid",
                "boundary_summary must be an object when present.",
                path="boundary_summary",
            )
        ]

    issues: list[dict[str, str]] = []
    expected_fields = ("point_count", "boundary_used", "mode", "source")
    for key in expected_fields:
        if key in exported and exported[key] != observed[key]:
            issues.append(
                _issue(
                    "boundary_summary_mismatch",
                    (
                        f"boundary_summary.{key}={exported[key]!r} does not match tumor boundary "
                        f"{observed[key]!r}."
                    ),
                    path=f"boundary_summary.{key}",
                )
            )
    return issues


def _quality_issues(quality: dict[str, Any]) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    for warning in quality.get("warnings", []):
        if not isinstance(warning, dict):
            continue
        severity = str(warning.get("severity") or "medium")
        issues.append(
            _issue(
                str(warning.get("code") or "tumor_quality_warning"),
                str(warning.get("message") or "Tumor input quality warning."),
                severity=severity,
                path="tumor",
            )
        )
    return issues


def audit_payload(payload: dict[str, Any], *, file: str = "<memory>") -> dict[str, Any]:
    tumor = tumor_from_payload(payload)
    tumor_dict = tumor.to_dict()
    quality = tumor.input_quality()
    boundary = tumor_boundary_summary(tumor)
    privacy, privacy_issues = _privacy_issues(payload)
    issues = [
        *_schema_issues(payload),
        *_quality_issues(quality),
        *_boundary_integrity_issues(payload, boundary),
        *privacy_issues,
    ]
    high_issues = [issue for issue in issues if issue["severity"] == "high"]
    return {
        "schema_version": AUDIT_SCHEMA,
        "file": file,
        "passed": not high_issues,
        "issue_count": len(issues),
        "high_issue_count": len(high_issues),
        "issues": issues,
        "tumor_input_schema_version": payload.get("schema_version") or "raw-tumor-dict",
        "tumor_kind": tumor.kind,
        "tumor": tumor_dict,
        "tumor_quality": quality,
        "boundary_summary": boundary,
        "privacy_audit": privacy,
        "clinical_boundary": (
            "Tumor input audit checks structured geometry and privacy only; it is not diagnosis, "
            "segmentation validation, margin approval, or surgical clearance."
        ),
    }


def audit_files(paths: list[str | Path]) -> dict[str, Any]:
    reports = [audit_payload(load_payload(path), file=str(path)) for path in paths]
    high_issue_count = sum(int(report["high_issue_count"]) for report in reports)
    return {
        "schema_version": AUDIT_SCHEMA,
        "input_files": [str(path) for path in paths],
        "checked_files": len(paths),
        "passed": high_issue_count == 0,
        "high_issue_count": high_issue_count,
        "issue_count": sum(int(report["issue_count"]) for report in reports),
        "reports": reports,
        "clinical_boundary": (
            "Batch tumor input audit is an engineering pre-share gate, not a clinical validation set."
        ),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+", help="tumor-input/v0.2 JSON exports or raw tumor JSON")
    parser.add_argument("--output", "-o", help="Write audit JSON report")
    parser.add_argument("--no-fail", action="store_true", help="Always exit 0 after writing the report")
    args = parser.parse_args(argv)

    report = audit_files([Path(path) for path in args.inputs])
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    return 0 if report["passed"] or args.no_fail else 1


if __name__ == "__main__":
    raise SystemExit(main())
