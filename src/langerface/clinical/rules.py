"""Versioned deterministic rule defaults for Stage 2 incision planning."""
from __future__ import annotations

from copy import deepcopy

DEFAULT_RULES: dict[str, object] = {
    "version": "0.2-agentic-incision",
    "review_status": "draft_not_clinically_validated",
    "last_reviewed_at": "2026-06-24",
    "source": "Stage 2 clinical planning notes; requires formal clinical review.",
    "medical_boundary": "Decision-support visualization only; not a surgical instruction.",
    "clinician_review_required": True,
    "linear_subcutaneous": {
        "length_multiplier": 1.25,
        "min_length_mm": 8.0,
        "max_length_mm": 35.0,
        "max_rstl_deviation_deg": 15.0,
        "source": "clinician_rule",
        "review_status": "draft_not_clinically_validated",
        "last_reviewed_at": "2026-06-24",
    },
    "fusiform_cutaneous": {
        "length_to_width_ratio": 3.0,
        "tip_angle_deg": 30.0,
        "min_length_mm": 12.0,
        "max_length_mm": 80.0,
        "max_rstl_deviation_deg": 15.0,
        "samples": 56,
        "source": "clinician_rule",
        "review_status": "draft_not_clinically_validated",
        "last_reviewed_at": "2026-06-24",
    },
    "region_rules": {
        "forehead": {
            "recommended_direction": "horizontal_or_forehead_crease",
            "priority_order": ["rstl_primary", "natural_crease_secondary", "aesthetic_subunit_secondary"],
            "warnings": ["Forehead landmarks are sparse; require manual confirmation."],
            "clinician_note": "Prefer forehead RSTL/crease direction.",
            "source": "clinician_rule",
            "review_status": "draft_not_clinically_validated",
            "last_reviewed_at": "2026-06-24",
        },
        "periorbital": {
            "recommended_direction": "periorbital_rstl_or_crease",
            "priority_order": ["sensitive_margin_exception", "rstl_primary", "natural_crease_secondary"],
            "warnings": ["Check eyelid position and canthal support before accepting any candidate."],
            "clinician_note": "RSTL is only acceptable after free-margin risk is reviewed.",
            "source": "clinician_rule",
            "review_status": "draft_not_clinically_validated",
            "last_reviewed_at": "2026-06-24",
        },
        "lower_eyelid": {
            "recommended_direction": "protect_lower_eyelid_margin",
            "priority_order": ["sensitive_margin_exception", "natural_crease_secondary", "rstl_primary"],
            "warnings": ["Risk of lower-lid retraction, ectropion, or lid-globe separation."],
            "clinician_note": "Protect the free margin and lid support before following RSTL.",
            "source": "clinician_rule",
            "review_status": "draft_not_clinically_validated",
            "last_reviewed_at": "2026-06-24",
        },
        "nasal_ala": {
            "recommended_direction": "protect_alar_contour",
            "priority_order": ["sensitive_margin_exception", "aesthetic_subunit_secondary", "rstl_primary"],
            "warnings": ["Risk of alar displacement or contour distortion."],
            "clinician_note": "Subunit boundaries and alar support may override local RSTL.",
            "source": "clinician_rule",
            "review_status": "draft_not_clinically_validated",
            "last_reviewed_at": "2026-06-24",
        },
        "cheek": {
            "recommended_direction": "local_rstl",
            "priority_order": ["rstl_primary", "natural_crease_secondary", "aesthetic_subunit_secondary"],
            "warnings": ["Check proximity to nasolabial fold, lower eyelid, and oral commissure manually."],
            "clinician_note": "Cheek candidates can usually follow local RSTL.",
            "source": "clinician_rule",
            "review_status": "draft_not_clinically_validated",
            "last_reviewed_at": "2026-06-24",
        },
        "temple_cheek": {
            "recommended_direction": "lateral_face_rstl_or_crows_feet",
            "priority_order": ["rstl_primary", "natural_crease_secondary", "aesthetic_subunit_secondary"],
            "warnings": ["Lateral face and temple boundaries are approximate in the current classifier."],
            "clinician_note": "Crow's-feet and lateral subunit boundaries can help scar camouflage.",
            "source": "clinician_rule",
            "review_status": "draft_not_clinically_validated",
            "last_reviewed_at": "2026-06-24",
        },
        "lip_vermilion": {
            "recommended_direction": "protect_vermilion_alignment",
            "priority_order": ["sensitive_margin_exception", "aesthetic_subunit_secondary", "rstl_primary"],
            "warnings": ["Risk of vermilion mismatch, notching, or oral commissure traction."],
            "clinician_note": "Border alignment and functional contour can override RSTL.",
            "source": "clinician_rule",
            "review_status": "draft_not_clinically_validated",
            "last_reviewed_at": "2026-06-24",
        },
        "chin": {
            "recommended_direction": "chin_rstl_or_mental_crease",
            "priority_order": ["rstl_primary", "natural_crease_secondary", "aesthetic_subunit_secondary"],
            "warnings": [
                "Check mental crease, lower lip traction, and mandibular border proximity manually."
            ],
            "clinician_note": "Mental crease can be a secondary direction cue.",
            "source": "clinician_rule",
            "review_status": "draft_not_clinically_validated",
            "last_reviewed_at": "2026-06-24",
        },
    },
    "guardrails": {
        "low_direction_confidence": 0.35,
        "low_region_confidence": 0.45,
        "sensitive_regions": {
            "lower_eyelid": (
                "Protect the lower eyelid free margin; consider manual override away from vertical traction."
            ),
            "lip_vermilion": (
                "Protect vermilion border alignment; require clinician confirmation before committing."
            ),
            "nasal_ala": "Protect nasal alar contour; evaluate distortion risk before accepting.",
        },
        "source": "clinician_rule",
        "review_status": "draft_not_clinically_validated",
        "last_reviewed_at": "2026-06-24",
    },
}


def default_clinical_rules() -> dict[str, object]:
    return deepcopy(DEFAULT_RULES)
