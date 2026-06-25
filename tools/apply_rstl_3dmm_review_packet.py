#!/usr/bin/env python3
"""Apply clinician review packet decisions to a draft RSTL / 3DMM direction prior."""
from __future__ import annotations

import argparse
import json
import math
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PRIOR = ROOT / "assets" / "rstl_mediapipe_direction_prior.json"
DEFAULT_PACKET = ROOT / "assets" / "flame" / "rstl_3dmm_review_packet.json"
DEFAULT_OUTPUT = ROOT / "assets" / "flame" / "rstl_3dmm_reviewed_direction_prior.json"
DIRECTION_PRIOR_SCHEMAS = {
    "rstl-direction-prior/v0.1",
    "rstl-3dmm-direction-prior/v0.1",
}
PACKET_SCHEMA = "rstl-3dmm-review-packet/v0.1"
REVIEWED_PRIOR_SCHEMA = "rstl-3dmm-reviewed-direction-prior/v0.1"
DRAFT_REVIEW_STATUS = "draft_not_clinically_validated"


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _rel(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def _unit_vector(values: Any) -> list[float]:
    if not isinstance(values, list | tuple) or len(values) != 3:
        raise ValueError("corrected_vector must contain three numeric values")
    vector = [float(value) for value in values]
    norm = math.sqrt(sum(value * value for value in vector))
    if not math.isfinite(norm) or norm <= 1e-12:
        raise ValueError("corrected_vector must be non-zero and finite")
    return [round(value / norm, 6) for value in vector]


def _angle_deg(vector: list[float]) -> float:
    return round(math.degrees(math.atan2(float(vector[1]), float(vector[0]))), 3)


def _vector_from_angle(angle_deg: float, fallback: Any) -> list[float]:
    z = 0.0
    if isinstance(fallback, list | tuple) and len(fallback) == 3:
        try:
            z = float(fallback[2])
        except (TypeError, ValueError):
            z = 0.0
    theta = math.radians(float(angle_deg))
    return _unit_vector([math.cos(theta), math.sin(theta), z])


def _normalize_decision(review: dict[str, Any]) -> str:
    raw = str(review.get("decision") or "").strip().lower().replace("-", "_")
    accepted = review.get("direction_accepted")
    corrected = review.get("corrected_vector") is not None or review.get("corrected_angle_deg") is not None
    aliases = {
        "": "pending",
        "pending": "pending",
        "accept": "accepted",
        "accepted": "accepted",
        "approve": "accepted",
        "approved": "accepted",
        "needs_correction": "corrected",
        "correction": "corrected",
        "corrected": "corrected",
        "revised": "corrected",
        "reject": "rejected",
        "rejected": "rejected",
        "not_usable": "rejected",
    }
    decision = aliases.get(raw)
    if decision is None:
        raise ValueError(f"unknown clinician_review decision: {raw}")
    if decision == "pending" and accepted is True:
        decision = "accepted"
    elif decision == "pending" and accepted is False and corrected:
        decision = "corrected"
    elif decision == "pending" and accepted is False:
        decision = "rejected"
    if decision == "accepted" and accepted is False and corrected:
        decision = "corrected"
    return decision


def _review_metadata(item: dict[str, Any], review: dict[str, Any], decision: str) -> dict[str, Any]:
    if decision != "pending":
        if not str(review.get("reviewer") or "").strip():
            raise ValueError(f"{item.get('review_id')}: reviewer is required for reviewed decisions")
        if not str(review.get("reviewed_at") or "").strip():
            raise ValueError(f"{item.get('review_id')}: reviewed_at is required for reviewed decisions")
    return {
        "review_id": item.get("review_id"),
        "decision": decision,
        "reviewer": str(review.get("reviewer") or ""),
        "reviewed_at": str(review.get("reviewed_at") or ""),
        "region_label": str(review.get("region_label") or ""),
        "direction_accepted": review.get("direction_accepted"),
        "notes": str(review.get("notes") or ""),
    }


def _corrected_vector(sample: dict[str, Any], review: dict[str, Any]) -> tuple[list[float], str]:
    if review.get("corrected_vector") is not None:
        return _unit_vector(review["corrected_vector"]), "corrected_vector"
    if review.get("corrected_angle_deg") is not None:
        return (
            _vector_from_angle(float(review["corrected_angle_deg"]), sample.get("vector")),
            "corrected_angle_deg",
        )
    raise ValueError("corrected decision requires corrected_vector or corrected_angle_deg")


def apply_review_packet(
    *,
    prior_path: Path,
    packet_path: Path,
    generated_at: str,
) -> dict[str, Any]:
    prior = _load_json(prior_path)
    packet = _load_json(packet_path)
    samples = prior.get("samples")
    items = packet.get("items")
    if prior.get("schema_version") not in DIRECTION_PRIOR_SCHEMAS:
        raise ValueError("prior must be an RSTL direction prior")
    if prior.get("validated") is not False:
        raise ValueError("review application can only consume validated:false priors")
    if packet.get("schema_version") != PACKET_SCHEMA:
        raise ValueError("review packet schema_version mismatch")
    if packet.get("source_validated") is not False:
        raise ValueError("review packet source_validated must remain false")
    if packet.get("topologyId") != prior.get("topologyId"):
        raise ValueError("review packet topologyId does not match prior")
    if packet.get("topologyVersion") != prior.get("topologyVersion"):
        raise ValueError("review packet topologyVersion does not match prior")
    if packet.get("review_status") != DRAFT_REVIEW_STATUS:
        raise ValueError(f"review packet review_status must be {DRAFT_REVIEW_STATUS}")
    if not isinstance(samples, list) or not samples:
        raise ValueError("prior must contain a non-empty samples list")
    if packet.get("source_sample_count") not in {None, len(samples)}:
        raise ValueError("review packet source_sample_count does not match prior samples")
    if not isinstance(items, list) or not items:
        raise ValueError("review packet must contain review items")

    updated_samples = [dict(sample) for sample in samples]
    applied_reviews: list[dict[str, Any]] = []
    decisions: Counter[str] = Counter()
    reviewers: Counter[str] = Counter()
    seen_indices: set[int] = set()

    for item in items:
        if not isinstance(item, dict):
            raise ValueError("review packet items must be objects")
        try:
            sample_index = int(item.get("source_sample_index"))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{item.get('review_id')}: invalid source_sample_index") from exc
        if sample_index in seen_indices:
            raise ValueError(f"{item.get('review_id')}: duplicate source_sample_index {sample_index}")
        seen_indices.add(sample_index)
        if not 0 <= sample_index < len(updated_samples):
            raise ValueError(f"{item.get('review_id')}: source_sample_index out of range")
        sample = updated_samples[sample_index]
        if item.get("tri") is not None and int(item["tri"]) != int(sample.get("tri", sample_index)):
            raise ValueError(f"{item.get('review_id')}: tri does not match source sample")
        review = item.get("clinician_review") if isinstance(item.get("clinician_review"), dict) else {}
        decision = _normalize_decision(review)
        decisions[decision] += 1
        metadata = _review_metadata(item, review, decision)

        if decision == "pending":
            continue
        reviewers.update([metadata["reviewer"]])
        original_vector = sample.get("vector")
        original_angle = sample.get("angle_deg")
        review_record = {
            **metadata,
            "source_packet": _rel(packet_path),
            "source_sample_index": sample_index,
            "tri": sample.get("tri", sample_index),
        }
        applied = {
            "review_id": item.get("review_id"),
            "source_sample_index": sample_index,
            "tri": sample.get("tri", sample_index),
            "decision": decision,
            "reviewer": metadata["reviewer"],
            "reviewed_at": metadata["reviewed_at"],
            "vector_changed": False,
            "excluded": decision == "rejected",
        }
        if decision == "corrected":
            vector, correction_source = _corrected_vector(sample, review)
            sample["pre_review_vector"] = original_vector
            sample["pre_review_angle_deg"] = original_angle
            sample["vector"] = vector
            sample["angle_deg"] = _angle_deg(vector)
            sample["review_correction_source"] = correction_source
            review_record["corrected_vector"] = vector
            review_record["corrected_angle_deg"] = sample["angle_deg"]
            applied["vector_changed"] = True
            applied["corrected_angle_deg"] = sample["angle_deg"]
        elif decision == "rejected":
            sample["excluded_from_reviewed_prior"] = True
        sample["clinician_review"] = review_record
        sample["review_applied"] = decision in {"accepted", "corrected"}
        applied_reviews.append(applied)

    reviewed_count = sum(decisions[key] for key in ("accepted", "corrected", "rejected"))
    return {
        "schema_version": REVIEWED_PRIOR_SCHEMA,
        "system": prior.get("system"),
        "topologyId": prior.get("topologyId"),
        "topologyVersion": prior.get("topologyVersion"),
        "validated": False,
        "review_status": DRAFT_REVIEW_STATUS,
        "generated_at": generated_at,
        "generated_by": "tools/apply_rstl_3dmm_review_packet.py",
        "source_prior": _rel(prior_path),
        "source_prior_schema_version": prior.get("schema_version"),
        "source_review_packet": _rel(packet_path),
        "source_review_packet_schema_version": packet.get("schema_version"),
        "source_sample_count": len(samples),
        "review_item_count": len(items),
        "review_application": {
            "reviewed_count": reviewed_count,
            "accepted_count": decisions["accepted"],
            "corrected_count": decisions["corrected"],
            "rejected_count": decisions["rejected"],
            "pending_count": decisions["pending"],
            "applied_sample_count": decisions["accepted"] + decisions["corrected"],
            "completion_rate": round(reviewed_count / len(items), 6),
            "reviewer_counts": dict(sorted(reviewers.items())),
            "corrected_sample_indices": [
                review["source_sample_index"]
                for review in applied_reviews
                if review["decision"] == "corrected"
            ],
            "rejected_sample_indices": [
                review["source_sample_index"]
                for review in applied_reviews
                if review["decision"] == "rejected"
            ],
        },
        "applied_reviews": applied_reviews,
        "clinical_boundary": (
            "This artifact applies clinician review decisions to a draft direction prior for audit. "
            "It remains validated:false and is not a clinical FLAME/BFM atlas or surgical instruction."
        ),
        "samples": updated_samples,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prior", default=str(DEFAULT_PRIOR), help="draft direction prior JSON")
    parser.add_argument(
        "--packet",
        default=str(DEFAULT_PACKET),
        help="review packet JSON with clinician decisions",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help="review-applied draft prior JSON output",
    )
    parser.add_argument("--generated-at", default=date.today().isoformat())
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    generated_at = args.generated_at
    if generated_at == "now":
        generated_at = datetime.now(timezone.utc).date().isoformat()
    reviewed = apply_review_packet(
        prior_path=Path(args.prior),
        packet_path=Path(args.packet),
        generated_at=generated_at,
    )
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(reviewed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    review = reviewed["review_application"]
    print(
        f"[ok] {output} reviewed={review['reviewed_count']} "
        f"accepted={review['accepted_count']} corrected={review['corrected_count']} "
        f"rejected={review['rejected_count']} pending={review['pending_count']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
