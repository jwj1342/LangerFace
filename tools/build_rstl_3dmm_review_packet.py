#!/usr/bin/env python3
"""Build a clinician review packet for draft RSTL / 3DMM direction priors."""
from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PRIOR = ROOT / "assets" / "rstl_mediapipe_direction_prior.json"
DEFAULT_OUTPUT = ROOT / "assets" / "flame" / "rstl_3dmm_review_packet.json"
PACKET_SCHEMA = "rstl-3dmm-review-packet/v0.1"
DRAFT_REVIEW_STATUS = "draft_not_clinically_validated"


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _rel(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def _num(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number


def _sample_tri(sample: dict[str, Any], fallback: int) -> int:
    try:
        return int(sample.get("tri", fallback))
    except (TypeError, ValueError):
        return fallback


def _select_review_indices(
    samples: list[dict[str, Any]],
    *,
    max_items: int,
    low_confidence_threshold: float,
    high_spread_threshold_deg: float,
) -> tuple[list[int], dict[int, set[str]]]:
    reasons: dict[int, set[str]] = {}

    def add(index: int, reason: str) -> None:
        if 0 <= index < len(samples):
            reasons.setdefault(index, set()).add(reason)

    for index, sample in enumerate(samples):
        if _num(sample.get("confidence"), 1.0) < low_confidence_threshold:
            add(index, "low_confidence")
        if _num(sample.get("angular_spread_deg"), 0.0) > high_spread_threshold_deg:
            add(index, "high_angular_spread")

    point_samples = [
        (index, sample.get("point"))
        for index, sample in enumerate(samples)
        if isinstance(sample.get("point"), list) and len(sample["point"]) >= 3
    ]
    for axis, axis_name in enumerate(["x", "y", "z"]):
        finite = [
            (index, _num(point[axis]))
            for index, point in point_samples
        ]
        if not finite:
            continue
        add(min(finite, key=lambda item: item[1])[0], f"spatial_min_{axis_name}")
        add(max(finite, key=lambda item: item[1])[0], f"spatial_max_{axis_name}")

    if samples:
        stride = max(1, len(samples) // max(max_items, 1))
        for index in range(0, len(samples), stride):
            add(index, "uniform_coverage")
            if len(reasons) >= max_items:
                break

    ordered = sorted(
        reasons,
        key=lambda index: (
            _num(samples[index].get("confidence"), 1.0),
            -_num(samples[index].get("angular_spread_deg"), 0.0),
            _sample_tri(samples[index], index),
        ),
    )
    if max_items > 0:
        ordered = ordered[:max_items]
    return ordered, reasons


def build_review_packet(
    *,
    prior_path: Path,
    generated_at: str,
    max_items: int = 96,
    low_confidence_threshold: float = 0.35,
    high_spread_threshold_deg: float = 45.0,
) -> dict[str, Any]:
    prior = _load_json(prior_path)
    samples = prior.get("samples") or []
    if not isinstance(samples, list) or not samples:
        raise ValueError("direction prior must contain a non-empty samples list")
    if prior.get("validated") is not False:
        raise ValueError("review packets can only be built from validated:false priors")

    selected, reason_map = _select_review_indices(
        samples,
        max_items=max_items,
        low_confidence_threshold=low_confidence_threshold,
        high_spread_threshold_deg=high_spread_threshold_deg,
    )
    items: list[dict[str, Any]] = []
    reason_counts: Counter[str] = Counter()
    for ordinal, index in enumerate(selected, start=1):
        sample = samples[index]
        reasons = sorted(reason_map.get(index, {"manual_review"}))
        reason_counts.update(reasons)
        tri = _sample_tri(sample, index)
        items.append({
            "review_id": f"rstl3dmm-{ordinal:04d}",
            "source_sample_index": index,
            "tri": tri,
            "bary": sample.get("bary", [0.333333, 0.333333, 0.333334]),
            "point": sample.get("point"),
            "vector": sample.get("vector"),
            "angle_deg": sample.get("angle_deg"),
            "confidence": sample.get("confidence"),
            "angular_spread_deg": sample.get("angular_spread_deg"),
            "support_count": sample.get("support_count"),
            "nearest_source_tri": sample.get("nearest_source_tri"),
            "nearest_source_distance": sample.get("nearest_source_distance"),
            "priority_reasons": reasons,
            "clinician_review": {
                "decision": "pending",
                "reviewer": "",
                "reviewed_at": "",
                "region_label": "",
                "direction_accepted": None,
                "corrected_angle_deg": None,
                "corrected_vector": None,
                "notes": "",
            },
        })

    return {
        "schema_version": PACKET_SCHEMA,
        "generated_at": generated_at,
        "generated_by": "tools/build_rstl_3dmm_review_packet.py",
        "source_prior": _rel(prior_path),
        "source_schema_version": prior.get("schema_version"),
        "system": prior.get("system"),
        "topologyId": prior.get("topologyId"),
        "topologyVersion": prior.get("topologyVersion"),
        "source_validated": prior.get("validated"),
        "review_status": DRAFT_REVIEW_STATUS,
        "selection_policy": {
            "max_items": int(max_items),
            "low_confidence_threshold": float(low_confidence_threshold),
            "high_spread_threshold_deg": float(high_spread_threshold_deg),
            "includes_spatial_extremes": True,
            "includes_uniform_coverage": True,
        },
        "source_sample_count": len(samples),
        "review_item_count": len(items),
        "priority_reason_counts": dict(sorted(reason_counts.items())),
        "review_completion": {
            "reviewed_count": 0,
            "accepted_count": 0,
            "needs_correction_count": 0,
            "rejected_count": 0,
            "completion_rate": 0.0,
        },
        "required_clinician_fields": [
            "decision",
            "reviewer",
            "reviewed_at",
            "region_label",
            "direction_accepted",
            "notes",
        ],
        "clinical_boundary": (
            "This packet samples a draft direction prior for clinician review. "
            "It is not a validated FLAME/BFM RSTL atlas or surgical instruction."
        ),
        "items": items,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prior", default=str(DEFAULT_PRIOR), help="draft direction prior JSON")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="review packet JSON output")
    parser.add_argument("--generated-at", default=date.today().isoformat())
    parser.add_argument("--max-items", type=int, default=96)
    parser.add_argument("--low-confidence-threshold", type=float, default=0.35)
    parser.add_argument("--high-spread-threshold-deg", type=float, default=45.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    generated_at = args.generated_at
    if generated_at == "now":
        generated_at = datetime.now(timezone.utc).date().isoformat()
    packet = build_review_packet(
        prior_path=Path(args.prior),
        generated_at=generated_at,
        max_items=args.max_items,
        low_confidence_threshold=args.low_confidence_threshold,
        high_spread_threshold_deg=args.high_spread_threshold_deg,
    )
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(packet, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"[ok] {output} {packet['review_item_count']} review items "
        f"from {packet['source_sample_count']} samples"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
