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
import math
from pathlib import Path
from typing import Any

from langerface.tumor import TUMOR_INPUT_SCHEMA, TumorInput, tumor_from_payload

AUDIT_SCHEMA = "tumor-input-audit/v0.1"
RAW_MEDIA_FLAGS = ("raw_image_sent", "raw_video_sent", "contains_face_image", "contains_raw_media")
BOUNDARY_FLOAT_FIELDS = (
    "axis_diameter_mm",
    "perp_diameter_mm",
    "area_mm2",
    "area_ratio_to_diameter_disk",
    "center_shift_mm",
    "aspect_ratio",
)
BOUNDARY_EXACT_FIELDS = ("self_intersection",)
FLOAT_TOLERANCE = 1e-6


def _issue(code: str, message: str, *, severity: str = "high", path: str = "$") -> dict[str, str]:
    return {
        "code": code,
        "severity": severity,
        "path": path,
        "message": message,
    }


def _finite_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _point(value: Any) -> tuple[float, float, float] | None:
    if not isinstance(value, list | tuple) or len(value) != 3:
        return None
    coords = tuple(_finite_number(x) for x in value)
    if any(x is None for x in coords):
        return None
    return coords  # type: ignore[return-value]


def _sub(a: tuple[float, float, float], b: tuple[float, float, float]) -> tuple[float, float, float]:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _dot(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a: tuple[float, float, float], b: tuple[float, float, float]) -> tuple[float, float, float]:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _norm(v: tuple[float, float, float]) -> tuple[float, float, float]:
    length = math.hypot(v[0], v[1], v[2])
    if length <= 1e-12:
        return (1.0, 0.0, 0.0)
    return (v[0] / length, v[1] / length, v[2] / length)


def _tangent_perp(
    axis: tuple[float, float, float],
    normal: tuple[float, float, float],
) -> tuple[float, float, float]:
    perp = _cross(_norm(normal), axis)
    if math.hypot(perp[0], perp[1], perp[2]) < 1e-9:
        perp = (-axis[1], axis[0], 0.0)
    return _norm(perp)


def _polygon_area(points: list[tuple[float, float]]) -> float:
    if len(points) < 3:
        return 0.0
    total = 0.0
    for i, a in enumerate(points):
        b = points[(i + 1) % len(points)]
        total += a[0] * b[1] - a[1] * b[0]
    return abs(total) * 0.5


def _orientation(
    a: tuple[float, float],
    b: tuple[float, float],
    c: tuple[float, float],
) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _on_segment(
    a: tuple[float, float],
    b: tuple[float, float],
    c: tuple[float, float],
) -> bool:
    eps = 1e-9
    return (
        min(a[0], c[0]) - eps <= b[0] <= max(a[0], c[0]) + eps
        and min(a[1], c[1]) - eps <= b[1] <= max(a[1], c[1]) + eps
        and abs(_orientation(a, b, c)) <= eps
    )


def _segments_intersect(
    a: tuple[float, float],
    b: tuple[float, float],
    c: tuple[float, float],
    d: tuple[float, float],
) -> bool:
    eps = 1e-9
    o1 = _orientation(a, b, c)
    o2 = _orientation(a, b, d)
    o3 = _orientation(c, d, a)
    o4 = _orientation(c, d, b)
    if o1 * o2 < -eps and o3 * o4 < -eps:
        return True
    return (
        _on_segment(a, c, b)
        or _on_segment(a, d, b)
        or _on_segment(c, a, d)
        or _on_segment(c, b, d)
    )


def _polygon_self_intersects(points: list[tuple[float, float]]) -> bool:
    if len(points) < 4:
        return False
    for i, a in enumerate(points):
        b = points[(i + 1) % len(points)]
        for j in range(i + 1, len(points)):
            if abs(i - j) <= 1 or {i, j} == {0, len(points) - 1}:
                continue
            c = points[j]
            d = points[(j + 1) % len(points)]
            if _segments_intersect(a, b, c, d):
                return True
    return False


def _close_enough(observed: Any, expected: Any) -> bool:
    observed_number = _finite_number(observed)
    expected_number = _finite_number(expected)
    if observed_number is not None and expected_number is not None:
        return abs(observed_number - expected_number) <= FLOAT_TOLERANCE
    if isinstance(observed, list | tuple) and isinstance(expected, list | tuple):
        return len(observed) == len(expected) and all(
            _close_enough(a, b)
            for a, b in zip(observed, expected, strict=False)
        )
    return observed == expected


def load_payload(path: str | Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("tumor input audit expects a JSON object")
    return payload


def tumor_boundary_summary(
    tumor: TumorInput,
    *,
    units_per_mm: float | None = None,
    axis: tuple[float, float, float] | None = None,
    normal: tuple[float, float, float] | None = None,
) -> dict[str, Any]:
    point_count = len(tumor.boundary)
    boundary_used = tumor.kind == "cutaneous" and point_count >= 3
    summary: dict[str, Any] = {
        "mode": tumor.boundary_mode,
        "source": tumor.boundary_source,
        "point_count": point_count,
        "boundary_used": boundary_used,
    }
    if not boundary_used or units_per_mm is None or units_per_mm <= 0:
        return summary

    a = _norm(axis or (1.0, 0.0, 0.0))
    n = _norm(normal or (0.0, 0.0, 1.0))
    perp = _tangent_perp(a, n)
    boundary = list(tumor.boundary)
    center = tuple(sum(p[k] for p in boundary) / point_count for k in range(3))
    projected = [(_dot(_sub(p, center), a), _dot(_sub(p, center), perp)) for p in boundary]
    max_axis = max(abs(p[0]) for p in projected)
    max_perp = max(abs(p[1]) for p in projected)
    area_mm2 = _polygon_area(projected) / (units_per_mm * units_per_mm)
    nominal_disk_area_mm2 = math.pi * (tumor.diameter_mm * 0.5) ** 2
    center_shift_units = math.hypot(*_sub(center, tumor.center))
    summary.update({
        "units_per_mm": units_per_mm,
        "summary_axis": list(a),
        "summary_normal": list(n),
        "center": list(center),
        "axis_diameter_mm": 2.0 * max_axis / units_per_mm,
        "perp_diameter_mm": 2.0 * max_perp / units_per_mm,
        "area_mm2": area_mm2,
        "area_ratio_to_diameter_disk": area_mm2 / max(nominal_disk_area_mm2, 1e-9),
        "self_intersection": _polygon_self_intersects(projected),
        "center_shift_mm": center_shift_units / units_per_mm,
        "aspect_ratio": (2.0 * max_axis / max(2.0 * max_perp, 1e-9)),
    })
    return summary


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
    for key in (*BOUNDARY_FLOAT_FIELDS, "center", "summary_axis", "summary_normal"):
        if key in exported and key in observed and not _close_enough(exported[key], observed[key]):
            issues.append(
                _issue(
                    "boundary_summary_mismatch",
                    (
                        f"boundary_summary.{key}={exported[key]!r} does not match recomputed "
                        f"{observed[key]!r}."
                    ),
                    path=f"boundary_summary.{key}",
                )
            )
    for key in BOUNDARY_EXACT_FIELDS:
        if key in exported and key in observed and exported[key] != observed[key]:
            issues.append(
                _issue(
                    "boundary_summary_mismatch",
                    (
                        f"boundary_summary.{key}={exported[key]!r} does not match recomputed "
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
    exported_boundary = payload.get("boundary_summary")
    exported_boundary = exported_boundary if isinstance(exported_boundary, dict) else {}
    boundary = tumor_boundary_summary(
        tumor,
        units_per_mm=_finite_number(exported_boundary.get("units_per_mm")),
        axis=_point(exported_boundary.get("summary_axis")),
        normal=_point(exported_boundary.get("summary_normal")),
    )
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
