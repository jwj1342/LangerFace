import csv
import json

import pytest
from tools.atlas_clinical_review import (
    PACKET_SCHEMA,
    VALIDATION_SCHEMA,
    build_review_packet,
    finalize_reviewed_atlas,
    overlay_review_csv,
    write_review_csv,
)


def _atlas():
    return {
        "system": "rstl",
        "version": "0.2",
        "atlasVersion": "test-1",
        "topologyId": "mediapipe-468",
        "topologyVersion": "mediapipe-canonical-468-v1",
        "provenance": "draft fixture.",
        "validated": False,
        "lines": [
            {
                "name": "forehead-1",
                "region": "forehead_bridge",
                "points": [[0, 0.2, 0.3], [1, 0.3, 0.2]],
            },
            {
                "name": "cheek-1",
                "region": "cheek",
                "points": [[2, 0.2, 0.3], [3, 0.3, 0.2]],
            },
        ],
    }


def _write_atlas(tmp_path):
    path = tmp_path / "atlas.json"
    path.write_text(json.dumps(_atlas()), encoding="utf-8")
    return path


def _accept_all(packet):
    for item in packet["items"]:
        item.update(
            {
                "decision": "accept",
                "direction_score_1_to_5": "5",
                "position_score_1_to_5": "4",
                "reviewer": "clinician-01",
                "reviewer_role": "plastic-surgeon",
                "reviewed_at": "2026-07-29T12:00:00-06:00",
                "source_reference": "controlled-reference-set-v1",
            }
        )


def test_build_packet_prioritizes_forehead_and_pins_source(tmp_path):
    atlas_path = _write_atlas(tmp_path)
    packet = build_review_packet(atlas_path, generated_at="2026-07-29T18:00:00+00:00")

    assert packet["schema_version"] == PACKET_SCHEMA
    assert packet["source_asset"]["validated"] is False
    assert packet["source_asset"]["line_count"] == 2
    assert packet["source_asset"]["point_count"] == 4
    assert packet["summary"]["forehead_line_count"] == 1
    assert packet["items"][0]["priority"] == "critical"
    assert packet["items"][1]["decision"] == "pending"


def test_csv_roundtrip_and_finalize_requires_every_line(tmp_path):
    atlas_path = _write_atlas(tmp_path)
    packet = build_review_packet(atlas_path)
    csv_path = tmp_path / "review.csv"
    write_review_csv(csv_path, packet)

    rows = list(csv.DictReader(csv_path.open(encoding="utf-8")))
    for row in rows:
        row["decision"] = "accept"
        row["direction_score_1_to_5"] = "5"
        row["position_score_1_to_5"] = "4"
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)

    reviewed = overlay_review_csv(packet, csv_path)
    finalized = finalize_reviewed_atlas(
        atlas_path,
        reviewed,
        reviewer="clinician-01",
        reviewer_role="plastic-surgeon",
        reviewed_at="2026-07-29T12:00:00-06:00",
        source_reference="controlled-reference-set-v1",
    )
    assert finalized["validated"] is True
    assert finalized["clinicalValidation"]["schemaVersion"] == VALIDATION_SCHEMA
    assert finalized["clinicalValidation"]["reviewedLineCount"] == 2
    assert finalized["clinicalValidation"]["foreheadLineCount"] == 1
    assert "clinician-01" in finalized["provenance"]


def test_finalize_rejects_pending_or_changed_source(tmp_path):
    atlas_path = _write_atlas(tmp_path)
    packet = build_review_packet(atlas_path)
    with pytest.raises(ValueError, match="decision must be"):
        finalize_reviewed_atlas(
            atlas_path,
            packet,
            reviewer="clinician-01",
            reviewer_role="plastic-surgeon",
            reviewed_at="2026-07-29T12:00:00-06:00",
            source_reference="controlled-reference-set-v1",
        )

    _accept_all(packet)
    atlas = json.loads(atlas_path.read_text(encoding="utf-8"))
    atlas["lines"][0]["points"][0][1] = 0.25
    atlas_path.write_text(json.dumps(atlas), encoding="utf-8")
    with pytest.raises(ValueError, match="changed after packet generation"):
        finalize_reviewed_atlas(
            atlas_path,
            packet,
            reviewer="clinician-01",
            reviewer_role="plastic-surgeon",
            reviewed_at="2026-07-29T12:00:00-06:00",
            source_reference="controlled-reference-set-v1",
        )
