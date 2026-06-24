"""Guardrail evaluation for incision candidates."""
from __future__ import annotations

from typing import Any

from ..anatomy import AnatomyContext
from ..clinical import default_clinical_rules


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

    rule_key = "fusiform_cutaneous" if candidate.get("type") == "fusiform" else "linear_subcutaneous"
    type_cfg = (rules or default_clinical_rules()).get(rule_key, {})
    max_deviation = float(type_cfg.get("max_rstl_deviation_deg", 15.0))  # type: ignore[union-attr]
    metrics = candidate.get("metrics") or {}
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
