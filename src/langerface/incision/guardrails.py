"""Guardrail evaluation for incision candidates."""
from __future__ import annotations

from typing import Any

import numpy as np

from ..anatomy import AnatomyContext
from ..anatomy.regions import SENSITIVE_ANCHORS
from ..clinical import default_clinical_rules


def _candidate_points(candidate: dict[str, Any]) -> np.ndarray:
    raw = candidate.get("polyline") or candidate.get("outline") or candidate.get("endpoints") or []
    points: list[list[float]] = []
    for point in raw:
        if isinstance(point, list | tuple) and len(point) == 3:
            try:
                p = [float(point[0]), float(point[1]), float(point[2])]
            except (TypeError, ValueError):
                continue
            if all(np.isfinite(p)):
                points.append(p)
    return np.asarray(points, dtype=np.float64)


def annotate_candidate_sensitive_distances(
    candidate: dict[str, Any],
    vertices: np.ndarray,
    *,
    face_height_mm: float = 180.0,
) -> dict[str, Any]:
    """Add candidate-geometry distance-to-sensitive-free-margin metrics.

    Distances are normalized by the current face bounding box and scaled to an
    adult face-height approximation. This is a conservative screening metric,
    not a clinical measurement.
    """

    points = _candidate_points(candidate)
    V = np.asarray(vertices, dtype=np.float64)
    if points.size == 0 or V.size == 0:
        return candidate
    lo = V.min(axis=0)
    hi = V.max(axis=0)
    span = np.maximum(hi - lo, 1e-9)
    normalized = np.column_stack([
        np.clip((points[:, 0] - lo[0]) / span[0], 0.0, 1.0),
        np.clip((points[:, 1] - lo[1]) / span[1], 0.0, 1.0),
    ])
    best_name = ""
    best_distance = float("inf")
    best_point = None
    for point, norm_xy in zip(points, normalized, strict=False):
        for name, anchor in SENSITIVE_ANCHORS.items():
            distance = float(np.hypot(norm_xy[0] - anchor[0], norm_xy[1] - anchor[1]) * face_height_mm)
            if distance < best_distance:
                best_distance = distance
                best_name = name
                best_point = point
    if not np.isfinite(best_distance):
        return candidate
    metrics = dict(candidate.get("metrics") or {})
    metrics.update({
        "sensitive_free_margin_min_distance_mm": best_distance,
        "sensitive_free_margin_nearest": best_name,
        "sensitive_free_margin_point": [float(x) for x in best_point] if best_point is not None else None,
    })
    candidate["metrics"] = metrics
    return candidate


def evaluate_guardrails(
    candidate: dict[str, Any],
    anatomy: AnatomyContext | dict[str, Any],
    *,
    rules: dict[str, Any] | None = None,
) -> dict[str, Any]:
    cfg = (rules or default_clinical_rules())["guardrails"]  # type: ignore[index]
    region = (
        anatomy.region
        if isinstance(anatomy, AnatomyContext)
        else str(anatomy.get("region", "unknown"))
    )
    region_conf = (
        anatomy.confidence
        if isinstance(anatomy, AnatomyContext)
        else float(anatomy.get("confidence", 0.0))
    )
    free_margin_distance = (
        anatomy.free_margin_distance_mm
        if isinstance(anatomy, AnatomyContext)
        else anatomy.get("free_margin_distance_mm")
    )
    nearby_landmarks = (
        anatomy.nearby_landmarks
        if isinstance(anatomy, AnatomyContext)
        else tuple(anatomy.get("nearby_landmarks", []))
    )
    sensitive_rules = cfg["sensitive_regions"]  # type: ignore[index]
    warnings: list[dict[str, Any]] = []
    suggested_overrides: list[dict[str, Any]] = []

    direction_conf = float(candidate.get("direction_confidence", 0.0))
    if direction_conf < float(cfg["low_direction_confidence"]):  # type: ignore[index]
        warnings.append({
            "code": "low_rstl_confidence",
            "severity": "medium",
            "message": "Local RSTL direction is low confidence; require manual confirmation.",
        })

    if region_conf < float(cfg["low_region_confidence"]):  # type: ignore[index]
        warnings.append({
            "code": "low_region_confidence",
            "severity": "medium",
            "message": "Face region classification is low confidence; require clinician review.",
        })

    if region in sensitive_rules:
        warnings.append({
            "code": f"sensitive_region_{region}",
            "severity": "high",
            "message": sensitive_rules[region],
        })
        suggested_overrides.append({
            "kind": "manual_direction_confirmation",
            "reason": f"{region} is a sensitive free-margin region.",
        })

    if free_margin_distance is not None and float(free_margin_distance) <= float(
        cfg.get("free_margin_distance_warn_mm", 18.0)  # type: ignore[union-attr]
    ):
        landmarks = ", ".join(str(x) for x in nearby_landmarks) or region
        warnings.append({
            "code": "near_sensitive_free_margin",
            "severity": "high",
            "message": (
                f"Candidate center is approximately {float(free_margin_distance):.1f} mm "
                f"from sensitive free-margin landmark(s): {landmarks}."
            ),
        })
        suggested_overrides.append({
            "kind": "free_margin_distance_review",
            "reason": "Confirm functional and contour risk before accepting this direction.",
        })

    metrics = candidate.get("metrics") or {}
    diameter_coverage_deficit = float(metrics.get("diameter_coverage_deficit_mm") or 0.0)
    if candidate.get("type") == "linear" and diameter_coverage_deficit > 1e-6:
        required = metrics.get("diameter_coverage_required_mm")
        warnings.append({
            "code": "linear_diameter_coverage_deficit",
            "severity": "high",
            "message": (
                "Linear candidate is shorter than the recorded subcutaneous lesion diameter "
                f"by {diameter_coverage_deficit:.1f} mm"
                + (f" (required {float(required):.1f} mm)." if required is not None else ".")
            ),
        })
        suggested_overrides.append({
            "kind": "linear_length_or_access_review",
            "reason": (
                "Increase incision length, confirm a smaller imaging diameter, or record an explicit "
                "clinician access decision."
            ),
        })

    if candidate.get("type") == "fusiform" and metrics.get("boundary_used"):
        boundary_points = int(metrics.get("boundary_point_count") or 0)
        min_points = int(cfg.get("min_freehand_boundary_points", 6))  # type: ignore[union-attr]
        if 0 < boundary_points < min_points:
            warnings.append({
                "code": "cutaneous_boundary_too_few_points",
                "severity": "medium",
                "message": (
                    f"Cutaneous lesion boundary has {boundary_points} point(s); "
                    f"{min_points} or more are recommended before review."
                ),
            })
            suggested_overrides.append({
                "kind": "redraw_cutaneous_boundary",
                "reason": (
                    "Add more lesion boundary points or use ellipse mode before accepting this candidate."
                ),
            })

        center_shift = metrics.get("boundary_center_shift_mm")
        lesion_diameter = float(metrics.get("diameter_mm") or 0.0)
        multiplier = float(cfg.get("boundary_center_shift_diameter_multiplier", 1.0))  # type: ignore[union-attr]
        if center_shift is not None and lesion_diameter > 0.0:
            threshold = max(lesion_diameter * multiplier, 1e-6)
            if float(center_shift) > threshold:
                warnings.append({
                    "code": "cutaneous_boundary_center_shift",
                    "severity": "high",
                    "message": (
                        "Cutaneous lesion boundary centroid is "
                        f"{float(center_shift):.1f} mm from the selected tumor center "
                        f"(threshold {threshold:.1f} mm)."
                    ),
                })
                suggested_overrides.append({
                    "kind": "tumor_center_or_boundary_review",
                    "reason": (
                        "Re-pick tumor center, redraw boundary, or record why the boundary is "
                        "intentionally eccentric."
                    ),
                })

    axis_coverage_deficit = float(metrics.get("axis_coverage_deficit_mm") or 0.0)
    if candidate.get("type") == "fusiform" and axis_coverage_deficit > 1e-6:
        required = metrics.get("axis_coverage_required_mm")
        warnings.append({
            "code": "fusiform_axis_coverage_deficit",
            "severity": "high",
            "message": (
                "Fusiform candidate is shorter than the lesion boundary plus margin coverage "
                f"requirement by {axis_coverage_deficit:.1f} mm"
                + (f" (required {float(required):.1f} mm)." if required is not None else ".")
            ),
        })
        suggested_overrides.append({
            "kind": "fusiform_length_or_margin_review",
            "reason": (
                "Increase candidate length, reduce margin only with explicit clinician decision, "
                "or redraw boundary."
            ),
        })

    candidate_margin_distance = metrics.get("sensitive_free_margin_min_distance_mm")
    if candidate_margin_distance is not None and float(candidate_margin_distance) <= float(
        cfg.get("free_margin_distance_warn_mm", 18.0)  # type: ignore[union-attr]
    ):
        nearest = str(metrics.get("sensitive_free_margin_nearest") or region)
        warnings.append({
            "code": "candidate_near_sensitive_free_margin",
            "severity": "high",
            "message": (
                f"Candidate geometry is approximately {float(candidate_margin_distance):.1f} mm "
                f"from sensitive free-margin landmark: {nearest}."
            ),
        })
        suggested_overrides.append({
            "kind": "candidate_free_margin_distance_review",
            "reason": "Review the full candidate path/outline near sensitive free margins.",
        })

    rule_key = "fusiform_cutaneous" if candidate.get("type") == "fusiform" else "linear_subcutaneous"
    type_cfg = (rules or default_clinical_rules()).get(rule_key, {})
    max_deviation = float(type_cfg.get("max_rstl_deviation_deg", 15.0))  # type: ignore[union-attr]
    deviation = abs(float(metrics.get("rstl_deviation_deg", 0.0)))
    if deviation > max_deviation:
        edit = (candidate.get("provenance") or {}).get("clinician_edit") or {}
        reason = str(edit.get("reason", ""))
        warnings.append({
            "code": "rstl_deviation_override",
            "severity": "medium" if reason else "high",
            "message": (
                f"Long-axis direction deviates {deviation:.1f} deg from local RSTL "
                + (
                    "with clinician override reason recorded."
                    if reason
                    else "without an override reason."
                )
            ),
        })
        if not reason:
            suggested_overrides.append({
                "kind": "override_reason_required",
                "reason": "Candidate long axis deviates from local RSTL.",
            })

    return {
        "passed": not any(w["severity"] == "high" for w in warnings),
        "warnings": warnings,
        "suggested_overrides": suggested_overrides,
    }
