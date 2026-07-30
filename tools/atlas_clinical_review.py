"""Build and finalize a line-by-line clinical review packet for an atlas.

The build step is safe for draft assets and never changes ``validated``. The
finalize step writes a separate atlas file only after every source line has an
accepted, attributed review and the source hash still matches.

Examples:

  python tools/atlas_clinical_review.py build \
    --atlas assets/atlas_rstl.json \
    --output local_outputs/atlas_rstl_review.json \
    --csv-output local_outputs/atlas_rstl_review.csv

  python tools/atlas_clinical_review.py finalize \
    --atlas assets/atlas_rstl.json \
    --packet local_outputs/atlas_rstl_review.json \
    --review-csv local_outputs/atlas_rstl_review.csv \
    --reviewer clinician-01 \
    --reviewer-role plastic-surgeon \
    --reviewed-at 2026-07-29T12:00:00-06:00 \
    --source-reference controlled-reference-set-v1 \
    --attest-clinical-review \
    --output local_outputs/atlas_rstl.validated.json
"""
from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PACKET_SCHEMA = "atlas-clinical-review-packet/v0.1"
VALIDATION_SCHEMA = "atlas-clinical-validation/v0.1"
ACCEPTED_DECISION = "accept"
CSV_FIELDS = [
    "review_id",
    "line_name",
    "region",
    "point_count",
    "priority",
    "priority_reason",
    "decision",
    "direction_score_1_to_5",
    "position_score_1_to_5",
    "reviewer",
    "reviewer_role",
    "reviewed_at",
    "source_reference",
    "notes",
]


def _load_json(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path}: expected a JSON object")
    return data


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _source_sha256(path: Path) -> str:
    return _sha256_bytes(path.read_bytes())


def _line_sha256(line: dict[str, Any]) -> str:
    payload = json.dumps(line, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return _sha256_bytes(payload.encode("utf-8"))


def _review_priority(region: str) -> tuple[str, str]:
    normalized = region.lower()
    if "forehead" in normalized:
        return (
            "critical",
            "Forehead coverage is an explicit #2 gate because MediaPipe landmarks are sparse there.",
        )
    if any(token in normalized for token in ("eye", "orbital", "nose", "nasal", "lip", "mouth")):
        return (
            "high",
            "Periocular, nasal, and perioral directions require close anatomic review.",
        )
    return "standard", "Routine line-by-line direction, position, and continuity review."


def _validate_draft_atlas(atlas: dict[str, Any], path: Path) -> list[dict[str, Any]]:
    if atlas.get("validated") is not False:
        raise ValueError(f"{path}: review packets can only be built from validated:false atlases")
    for field in ("system", "version", "topologyId", "topologyVersion", "provenance"):
        if not str(atlas.get(field) or "").strip():
            raise ValueError(f"{path}: missing required atlas field {field}")
    lines = atlas.get("lines")
    if not isinstance(lines, list) or not lines:
        raise ValueError(f"{path}: atlas lines must be a non-empty list")
    names: set[str] = set()
    for index, line in enumerate(lines):
        if not isinstance(line, dict):
            raise ValueError(f"{path}: line {index} must be an object")
        name = str(line.get("name") or "").strip()
        region = str(line.get("region") or "").strip()
        points = line.get("points")
        if not name or name in names:
            raise ValueError(f"{path}: line names must be non-empty and unique ({name!r})")
        if not region:
            raise ValueError(f"{path}: line {name} is missing region")
        if not isinstance(points, list) or len(points) < 2:
            raise ValueError(f"{path}: line {name} must contain at least two points")
        names.add(name)
    return lines


def build_review_packet(
    atlas_path: Path,
    *,
    generated_at: str | None = None,
) -> dict[str, Any]:
    atlas_path = atlas_path.resolve()
    atlas = _load_json(atlas_path)
    lines = _validate_draft_atlas(atlas, atlas_path)
    timestamp = generated_at or datetime.now(timezone.utc).isoformat()
    region_counts = Counter(str(line["region"]) for line in lines)
    items = []
    for line in lines:
        priority, priority_reason = _review_priority(str(line["region"]))
        items.append(
            {
                "review_id": f"{atlas['system']}:{line['name']}",
                "line_name": line["name"],
                "region": line["region"],
                "point_count": len(line["points"]),
                "line_sha256": _line_sha256(line),
                "priority": priority,
                "priority_reason": priority_reason,
                "decision": "pending",
                "direction_score_1_to_5": None,
                "position_score_1_to_5": None,
                "reviewer": "",
                "reviewer_role": "",
                "reviewed_at": "",
                "source_reference": "",
                "notes": "",
            }
        )
    return {
        "schema_version": PACKET_SCHEMA,
        "generated_at": timestamp,
        "review_status": "pending_clinical_line_review",
        "source_asset": {
            "path": str(atlas_path),
            "sha256": _source_sha256(atlas_path),
            "system": atlas["system"],
            "version": atlas["version"],
            "atlasVersion": atlas.get("atlasVersion"),
            "topologyId": atlas["topologyId"],
            "topologyVersion": atlas["topologyVersion"],
            "validated": atlas["validated"],
            "line_count": len(lines),
            "point_count": sum(len(line["points"]) for line in lines),
        },
        "summary": {
            "region_counts": dict(sorted(region_counts.items())),
            "critical_line_count": sum(item["priority"] == "critical" for item in items),
            "high_line_count": sum(item["priority"] == "high" for item in items),
            "forehead_line_count": sum("forehead" in str(item["region"]).lower() for item in items),
        },
        "required_checks": [
            "direction_matches_the_cited_medical_reference",
            "position_matches_the_anatomic_region",
            "line_is_continuous_and_has_no_obvious_artifact",
            "left_right_symmetry_or_documented_asymmetry_is_acceptable",
            "forehead_coverage_is_explicitly_reviewed",
        ],
        "clinical_boundary": (
            "This packet is an audit scaffold. Building or editing it does not validate an atlas. "
            "Only a clinician may attest the completed review and produce a validated candidate."
        ),
        "items": items,
    }


def write_review_csv(path: Path, packet: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for item in packet["items"]:
            writer.writerow({field: item.get(field, "") for field in CSV_FIELDS})


def overlay_review_csv(packet: dict[str, Any], csv_path: Path) -> dict[str, Any]:
    result = copy.deepcopy(packet)
    items_by_id = {str(item["review_id"]): item for item in result.get("items", [])}
    seen: set[str] = set()
    with csv_path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing_fields = set(CSV_FIELDS) - set(reader.fieldnames or [])
        if missing_fields:
            raise ValueError(f"{csv_path}: missing CSV fields: {sorted(missing_fields)}")
        for row in reader:
            review_id = str(row.get("review_id") or "").strip()
            if review_id not in items_by_id:
                raise ValueError(f"{csv_path}: unknown review_id {review_id!r}")
            if review_id in seen:
                raise ValueError(f"{csv_path}: duplicate review_id {review_id!r}")
            seen.add(review_id)
            item = items_by_id[review_id]
            for field in (
                "decision",
                "direction_score_1_to_5",
                "position_score_1_to_5",
                "reviewer",
                "reviewer_role",
                "reviewed_at",
                "source_reference",
                "notes",
            ):
                item[field] = str(row.get(field) or "").strip()
    if seen != set(items_by_id):
        missing = sorted(set(items_by_id) - seen)
        raise ValueError(f"{csv_path}: missing review rows: {missing[:5]}")
    return result


def _require_iso_datetime(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{field} is required")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field} must be an ISO-8601 datetime") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{field} must include a timezone")
    return text


def _require_score(value: Any, field: str) -> int:
    try:
        score = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be an integer from 1 to 5") from exc
    if not 1 <= score <= 5:
        raise ValueError(f"{field} must be an integer from 1 to 5")
    return score


def finalize_reviewed_atlas(
    atlas_path: Path,
    packet: dict[str, Any],
    *,
    reviewer: str,
    reviewer_role: str,
    reviewed_at: str,
    source_reference: str,
) -> dict[str, Any]:
    atlas_path = atlas_path.resolve()
    atlas = _load_json(atlas_path)
    lines = _validate_draft_atlas(atlas, atlas_path)
    if packet.get("schema_version") != PACKET_SCHEMA:
        raise ValueError(f"packet schema_version must be {PACKET_SCHEMA}")
    source = packet.get("source_asset")
    if not isinstance(source, dict):
        raise ValueError("packet source_asset is required")
    if source.get("sha256") != _source_sha256(atlas_path):
        raise ValueError("atlas bytes changed after packet generation; rebuild the review packet")
    expected_source = {
        "system": atlas["system"],
        "version": atlas["version"],
        "atlasVersion": atlas.get("atlasVersion"),
        "topologyId": atlas["topologyId"],
        "topologyVersion": atlas["topologyVersion"],
        "validated": False,
        "line_count": len(lines),
        "point_count": sum(len(line["points"]) for line in lines),
    }
    for field, expected in expected_source.items():
        if source.get(field) != expected:
            raise ValueError(f"packet source_asset.{field} does not match the atlas")

    items = packet.get("items")
    if not isinstance(items, list) or len(items) != len(lines):
        raise ValueError("packet must contain exactly one review item per atlas line")
    items_by_id = {str(item.get("review_id")): item for item in items if isinstance(item, dict)}
    if len(items_by_id) != len(lines):
        raise ValueError("packet review_id values must be unique")

    global_reviewer = str(reviewer or "").strip()
    global_role = str(reviewer_role or "").strip()
    global_source = str(source_reference or "").strip()
    global_reviewed_at = _require_iso_datetime(reviewed_at, "reviewed_at")
    if not global_reviewer:
        raise ValueError("reviewer is required")
    if not global_role:
        raise ValueError("reviewer_role is required")
    if not global_source:
        raise ValueError("source_reference is required")

    reviewed_items = []
    for line in lines:
        review_id = f"{atlas['system']}:{line['name']}"
        item = items_by_id.get(review_id)
        if item is None:
            raise ValueError(f"missing review for {review_id}")
        if item.get("line_sha256") != _line_sha256(line):
            raise ValueError(f"{review_id}: line geometry changed after packet generation")
        if str(item.get("decision") or "").strip().lower() != ACCEPTED_DECISION:
            raise ValueError(f"{review_id}: decision must be {ACCEPTED_DECISION!r}")
        item_reviewer = str(item.get("reviewer") or global_reviewer).strip()
        item_role = str(item.get("reviewer_role") or global_role).strip()
        item_time = _require_iso_datetime(
            item.get("reviewed_at") or global_reviewed_at,
            f"{review_id}.reviewed_at",
        )
        item_source = str(item.get("source_reference") or global_source).strip()
        if not item_reviewer or not item_role or not item_source:
            raise ValueError(f"{review_id}: reviewer, reviewer_role, and source_reference are required")
        reviewed_items.append(
            {
                "review_id": review_id,
                "reviewer": item_reviewer,
                "reviewer_role": item_role,
                "reviewed_at": item_time,
                "source_reference": item_source,
                "direction_score_1_to_5": _require_score(
                    item.get("direction_score_1_to_5"),
                    f"{review_id}.direction_score_1_to_5",
                ),
                "position_score_1_to_5": _require_score(
                    item.get("position_score_1_to_5"),
                    f"{review_id}.position_score_1_to_5",
                ),
            }
        )

    finalized = copy.deepcopy(atlas)
    finalized["validated"] = True
    finalized["clinicalValidation"] = {
        "schemaVersion": VALIDATION_SCHEMA,
        "status": "clinically_validated",
        "reviewer": global_reviewer,
        "reviewerRole": global_role,
        "reviewedAt": global_reviewed_at,
        "sourceReference": global_source,
        "sourceAtlasSha256": source["sha256"],
        "packetGeneratedAt": packet.get("generated_at"),
        "lineCount": len(lines),
        "pointCount": expected_source["point_count"],
        "reviewedLineCount": len(reviewed_items),
        "foreheadLineCount": packet.get("summary", {}).get("forehead_line_count", 0),
    }
    finalized["provenance"] = (
        f"{atlas['provenance']} Clinically reviewed by {global_reviewer} "
        f"({global_role}) at {global_reviewed_at}; source={global_source}; "
        f"packet_sha256={source['sha256']}."
    ).strip()
    return finalized


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    build = subparsers.add_parser("build", help="build JSON/CSV review packets")
    build.add_argument("--atlas", required=True, type=Path)
    build.add_argument("--output", required=True, type=Path)
    build.add_argument("--csv-output", required=True, type=Path)

    finalize = subparsers.add_parser("finalize", help="write a separately reviewed atlas")
    finalize.add_argument("--atlas", required=True, type=Path)
    finalize.add_argument("--packet", required=True, type=Path)
    finalize.add_argument("--review-csv", type=Path)
    finalize.add_argument("--reviewer", required=True)
    finalize.add_argument("--reviewer-role", required=True)
    finalize.add_argument("--reviewed-at", required=True)
    finalize.add_argument("--source-reference", required=True)
    finalize.add_argument("--attest-clinical-review", action="store_true")
    finalize.add_argument("--output", required=True, type=Path)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(list(argv or sys.argv[1:]))
    if args.command == "build":
        packet = build_review_packet(args.atlas)
        _write_json(args.output, packet)
        write_review_csv(args.csv_output, packet)
        print(
            f"[ok] review packet: {len(packet['items'])} lines, "
            f"{packet['summary']['forehead_line_count']} forehead -> {args.output}"
        )
        return 0

    if not args.attest_clinical_review:
        raise ValueError(
            "finalize requires --attest-clinical-review; only a clinician may make this attestation"
        )
    if args.output.resolve() == args.atlas.resolve():
        raise ValueError("finalize refuses to overwrite the source atlas; review the separate output first")
    packet = _load_json(args.packet)
    if args.review_csv:
        packet = overlay_review_csv(packet, args.review_csv)
    finalized = finalize_reviewed_atlas(
        args.atlas,
        packet,
        reviewer=args.reviewer,
        reviewer_role=args.reviewer_role,
        reviewed_at=args.reviewed_at,
        source_reference=args.source_reference,
    )
    _write_json(args.output, finalized)
    print(f"[ok] clinically reviewed candidate -> {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
