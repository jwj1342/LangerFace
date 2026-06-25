import csv
import json
import math
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load_prior(path: Path) -> dict:
    return json.loads(path.read_text())


def test_rstl_direction_prior_manifest_uses_remote_or_generated_asset():
    manifest = _load_prior(ROOT / "assets" / "rstl_3dmm_prior_manifest.json")
    assets = {asset["id"]: asset for asset in manifest["assets"]}
    prior_asset = assets["mediapipe_rstl_direction_prior"]
    assert prior_asset["path"] is None
    assert prior_asset["remote_filename"] == "rstl_mediapipe_direction_prior.json"
    assert prior_asset["local_cache_path"] == "local_outputs/rstl_mediapipe_direction_prior.json"
    assert prior_asset["status"] == "remote_or_generated_draft_direction_field"
    assert prior_asset["validated"] is False
    assert "not committed" in " ".join(prior_asset["limitations"])


def _assert_mediapipe_direction_prior_contract(prior: dict) -> None:
    assert prior["schema_version"] == "rstl-direction-prior/v0.1"
    assert prior["system"] == "rstl"
    assert prior["topologyId"] == "mediapipe-468"
    assert prior["topologyVersion"] == "mediapipe-canonical-468-v1"
    assert prior["validated"] is False
    assert prior["review_status"] == "draft_not_clinically_validated"
    assert prior["source_atlas"] == "assets/atlas_rstl.json"
    assert prior["source_atlas_validated"] is False
    assert prior["generated_by"] == "tools/build_rstl_direction_prior.py"

    samples = prior["samples"]
    coverage = prior["coverage"]
    assert coverage["sample_count"] == prior["triangle_count"] == len(samples)
    assert coverage["sample_count"] >= 800
    assert coverage["min_confidence"] > 0.0
    assert 0.0 <= coverage["low_confidence_fraction"] <= 1.0
    assert "forehead" in coverage["regions_requiring_review"]
    assert prior["source_line_count"] >= 100
    assert prior["source_line_point_count"] >= 1000

    assert [sample["tri"] for sample in samples] == list(range(len(samples)))
    confidences = [sample["confidence"] for sample in samples]
    assert min(confidences) >= 0.0
    assert max(confidences) <= 1.0
    for sample in samples:
        assert sample["bary"] == [0.333333, 0.333333, 0.333334]
        assert sample["source"] == "rstl_atlas_weighted_nearest"
        assert sample["support_count"] == prior["parameters"]["k_nearest"]
        assert len(sample["point"]) == 3
        assert len(sample["vector"]) == 3
        norm = math.sqrt(sum(float(v) * float(v) for v in sample["vector"]))
        assert math.isclose(norm, 1.0, rel_tol=2e-4, abs_tol=2e-4)


def test_rstl_direction_prior_builder_reproduces_contract(tmp_path):
    output = tmp_path / "prior.json"
    result = subprocess.run(
        [
            sys.executable,
            "tools/build_rstl_direction_prior.py",
            "--generated-at",
            "2026-06-24",
            "--output",
            str(output),
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr
    assert "[ok]" in result.stdout
    built = _load_prior(output)
    _assert_mediapipe_direction_prior_contract(built)


def test_rstl_3dmm_prior_audit_passes_committed_assets():
    result = subprocess.run(
        [
            sys.executable,
            "tools/audit_rstl_3dmm_prior.py",
            "--json",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr
    summary = json.loads(result.stdout)
    assert summary["ok"] is True
    assert summary["review_status"] == "draft_not_clinically_validated"
    assert summary["validated"] is False
    assert summary["asset_count"] >= 5
    assert {asset["id"] for asset in summary["assets"]} >= {
        "mediapipe_rstl_direction_prior",
        "flame_rstl_prior",
        "flame_rstl_direction_prior",
        "bfm_rstl_direction_prior",
    }


def test_rstl_3dmm_prior_audit_rejects_accidental_validated_asset(tmp_path):
    manifest = json.loads((ROOT / "assets" / "rstl_3dmm_prior_manifest.json").read_text())
    manifest["assets"][0]["validated"] = True
    bad_manifest = tmp_path / "rstl_3dmm_prior_manifest.json"
    bad_manifest.write_text(json.dumps(manifest))

    result = subprocess.run(
        [
            sys.executable,
            "tools/audit_rstl_3dmm_prior.py",
            "--manifest",
            str(bad_manifest),
            "--root",
            str(ROOT),
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 1
    assert "validated:false" in result.stderr


def test_flame_rstl_direction_prior_builder_with_synthetic_topology(tmp_path):
    source_prior = {
        "schema_version": "rstl-direction-prior/v0.1",
        "system": "rstl",
        "topologyId": "mediapipe-468",
        "topologyVersion": "mediapipe-canonical-468-v1",
        "validated": False,
        "review_status": "draft_not_clinically_validated",
        "samples": [
            {"tri": 0, "point": [0, 0, 0], "vector": [1, 0, 0], "confidence": 0.9},
            {"tri": 1, "point": [1, 0, 0], "vector": [1, 0, 0], "confidence": 0.8},
            {"tri": 2, "point": [0, 1, 0], "vector": [0, 1, 0], "confidence": 0.7},
            {"tri": 3, "point": [1, 1, 0], "vector": [0, 1, 0], "confidence": 0.6},
        ],
    }
    topology = {
        "topologyId": "flame-2023",
        "topologyVersion": "flame-2023-v1",
        "vertexCount": 4,
        "triangleCount": 2,
        "triangles": [[0, 1, 2], [1, 3, 2]],
    }
    vertices = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]]
    source_path = tmp_path / "source_prior.json"
    topology_path = tmp_path / "topology_flame_2023.json"
    vertices_path = tmp_path / "flame_neutral_vertices.json"
    output_path = tmp_path / "rstl_flame_direction_prior.json"
    source_path.write_text(json.dumps(source_prior))
    topology_path.write_text(json.dumps(topology))
    vertices_path.write_text(json.dumps(vertices))

    result = subprocess.run(
        [
            sys.executable,
            "tools/build_flame_rstl_direction_prior.py",
            "--source-prior",
            str(source_path),
            "--target-topology",
            str(topology_path),
            "--target-vertices",
            str(vertices_path),
            "--output",
            str(output_path),
            "--generated-at",
            "2026-06-24",
            "--k-nearest",
            "2",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr
    assert "[ok]" in result.stdout
    prior = json.loads(output_path.read_text())
    assert prior["schema_version"] == "rstl-3dmm-direction-prior/v0.1"
    assert prior["topologyId"] == "flame-2023"
    assert prior["topologyVersion"] == "flame-2023-v1"
    assert prior["validated"] is False
    assert prior["review_status"] == "draft_not_clinically_validated"
    assert prior["generated_by"] == "tools/build_flame_rstl_direction_prior.py"
    assert prior["target_model_name"] == "flame"
    assert prior["target_topology_path"].endswith("topology_flame_2023.json")
    assert prior["target_vertices_path"].endswith("flame_neutral_vertices.json")
    assert prior["source_topologyId"] == "mediapipe-468"
    assert prior["registration_method"] == "bbox_aligned_nearest_source_triangle_centroid_direction_transfer"
    assert prior["bridge_alignment"]["method"] == "bbox_center_uniform_scale"
    assert prior["triangle_count"] == 2
    assert prior["coverage"]["sample_count"] == 2
    assert [sample["tri"] for sample in prior["samples"]] == [0, 1]
    for sample in prior["samples"]:
        assert sample["bary"] == [0.333333, 0.333333, 0.333334]
        assert sample["source"] == "mediapipe_direction_prior_nearest_bridge"
        assert len(sample["point"]) == 3
        assert len(sample["vector"]) == 3
        norm = math.sqrt(sum(float(v) * float(v) for v in sample["vector"]))
        assert math.isclose(norm, 1.0, rel_tol=2e-4, abs_tol=2e-4)


def test_generic_3dmm_rstl_direction_prior_builder_labels_bfm_topology(tmp_path):
    source_prior = {
        "schema_version": "rstl-direction-prior/v0.1",
        "system": "rstl",
        "topologyId": "mediapipe-468",
        "topologyVersion": "mediapipe-canonical-468-v1",
        "validated": False,
        "review_status": "draft_not_clinically_validated",
        "samples": [
            {"tri": 0, "point": [0, 0, 0], "vector": [1, 0, 0], "confidence": 0.9},
            {"tri": 1, "point": [2, 0, 0], "vector": [1, 0, 0], "confidence": 0.8},
            {"tri": 2, "point": [0, 2, 0], "vector": [0, 1, 0], "confidence": 0.7},
            {"tri": 3, "point": [2, 2, 0], "vector": [0, 1, 0], "confidence": 0.6},
        ],
    }
    topology = {
        "topologyId": "bfm-local",
        "topologyVersion": "bfm-neutral-local-v1",
        "vertexCount": 5,
        "triangleCount": 3,
        "triangles": [[0, 1, 2], [1, 3, 2], [1, 4, 3]],
    }
    vertices = [[0, 0, 0], [2, 0, 0], [0, 2, 0], [2, 2, 0], [2, 1, 1]]
    source_path = tmp_path / "source_prior.json"
    topology_path = tmp_path / "topology_bfm_local.json"
    vertices_path = tmp_path / "bfm_neutral_vertices.json"
    output_path = tmp_path / "rstl_bfm_direction_prior.json"
    source_path.write_text(json.dumps(source_prior))
    topology_path.write_text(json.dumps(topology))
    vertices_path.write_text(json.dumps(vertices))

    result = subprocess.run(
        [
            sys.executable,
            "tools/build_3dmm_rstl_direction_prior.py",
            "--source-prior",
            str(source_path),
            "--target-topology",
            str(topology_path),
            "--target-vertices",
            str(vertices_path),
            "--target-name",
            "bfm",
            "--output",
            str(output_path),
            "--generated-at",
            "2026-06-25",
            "--k-nearest",
            "2",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr
    assert "[ok]" in result.stdout
    prior = json.loads(output_path.read_text())
    assert prior["schema_version"] == "rstl-3dmm-direction-prior/v0.1"
    assert prior["topologyId"] == "bfm-local"
    assert prior["topologyVersion"] == "bfm-neutral-local-v1"
    assert prior["validated"] is False
    assert prior["review_status"] == "draft_not_clinically_validated"
    assert prior["generated_by"] == "tools/build_3dmm_rstl_direction_prior.py"
    assert prior["target_model_name"] == "bfm"
    assert prior["target_topology_path"].endswith("topology_bfm_local.json")
    assert prior["target_vertices_path"].endswith("bfm_neutral_vertices.json")
    assert prior["source_topologyId"] == "mediapipe-468"
    assert "bfm neutral 3DMM mesh coordinate space" in prior["coordinate_space"]
    assert "not clinical FLAME/BFM registration" in " ".join(prior["limitations"])
    assert prior["triangle_count"] == 3
    assert prior["coverage"]["sample_count"] == 3
    assert prior["coverage"]["regions_requiring_review"][-1] == "all_3dmm_bridge_samples"
    for sample in prior["samples"]:
        assert sample["source"] == "mediapipe_direction_prior_nearest_bridge"
        assert 0.0 <= sample["confidence"] <= 1.0
        norm = math.sqrt(sum(float(v) * float(v) for v in sample["vector"]))
        assert math.isclose(norm, 1.0, rel_tol=2e-4, abs_tol=2e-4)


def test_rstl_3dmm_review_packet_builder_with_synthetic_prior(tmp_path):
    prior = {
        "schema_version": "rstl-3dmm-direction-prior/v0.1",
        "system": "rstl",
        "topologyId": "flame-2023",
        "topologyVersion": "flame-2023-v1",
        "validated": False,
        "review_status": "draft_not_clinically_validated",
        "samples": [
            {
                "tri": 0,
                "bary": [0.333333, 0.333333, 0.333334],
                "point": [0, 0, 0],
                "vector": [1, 0, 0],
                "angle_deg": 0,
                "confidence": 0.9,
                "angular_spread_deg": 2,
                "support_count": 3,
            },
            {
                "tri": 1,
                "bary": [0.333333, 0.333333, 0.333334],
                "point": [1, 0, 0],
                "vector": [0, 1, 0],
                "angle_deg": 90,
                "confidence": 0.2,
                "angular_spread_deg": 12,
                "support_count": 3,
            },
            {
                "tri": 2,
                "bary": [0.333333, 0.333333, 0.333334],
                "point": [0, 1, 0],
                "vector": [0, 1, 0],
                "angle_deg": 90,
                "confidence": 0.7,
                "angular_spread_deg": 60,
                "support_count": 3,
            },
            {
                "tri": 3,
                "bary": [0.333333, 0.333333, 0.333334],
                "point": [1, 1, 1],
                "vector": [1, 0, 0],
                "angle_deg": 0,
                "confidence": 0.8,
                "angular_spread_deg": 3,
                "support_count": 3,
            },
        ],
    }
    prior_path = tmp_path / "rstl_flame_direction_prior.json"
    output_path = tmp_path / "rstl_3dmm_review_packet.json"
    csv_path = tmp_path / "rstl_3dmm_review_packet.csv"
    prior_path.write_text(json.dumps(prior))

    result = subprocess.run(
        [
            sys.executable,
            "tools/build_rstl_3dmm_review_packet.py",
            "--prior",
            str(prior_path),
            "--output",
            str(output_path),
            "--csv-output",
            str(csv_path),
            "--generated-at",
            "2026-06-24",
            "--max-items",
            "4",
            "--low-confidence-threshold",
            "0.35",
            "--high-spread-threshold-deg",
            "45",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr
    assert "[ok]" in result.stdout
    assert "clinician CSV" in result.stdout
    packet = json.loads(output_path.read_text())
    assert packet["schema_version"] == "rstl-3dmm-review-packet/v0.1"
    assert packet["topologyId"] == "flame-2023"
    assert packet["source_validated"] is False
    assert packet["review_status"] == "draft_not_clinically_validated"
    assert packet["source_sample_count"] == 4
    assert packet["review_item_count"] == 4
    assert packet["priority_reason_counts"]["low_confidence"] == 1
    assert packet["priority_reason_counts"]["high_angular_spread"] == 1
    assert "spatial_min_x" in packet["priority_reason_counts"]
    assert "spatial_max_z" in packet["priority_reason_counts"]
    assert packet["review_completion"]["completion_rate"] == 0.0
    assert "direction_accepted" in packet["required_clinician_fields"]
    assert {item["clinician_review"]["decision"] for item in packet["items"]} == {"pending"}
    low_conf = next(item for item in packet["items"] if item["tri"] == 1)
    assert "low_confidence" in low_conf["priority_reasons"]
    high_spread = next(item for item in packet["items"] if item["tri"] == 2)
    assert "high_angular_spread" in high_spread["priority_reasons"]
    with csv_path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == 4
    assert {
        "review_id",
        "source_sample_index",
        "tri",
        "topologyId",
        "priority_reasons",
        "decision",
        "reviewer",
        "reviewed_at",
        "region_label",
        "direction_accepted",
        "corrected_angle_deg",
        "corrected_vector",
        "notes",
    } <= set(rows[0])
    assert {row["decision"] for row in rows} == {"pending"}
    low_conf_row = next(row for row in rows if row["tri"] == "1")
    assert "low_confidence" in low_conf_row["priority_reasons"]
    high_spread_row = next(row for row in rows if row["tri"] == "2")
    assert "high_angular_spread" in high_spread_row["priority_reasons"]


def test_rstl_3dmm_review_packet_application_with_synthetic_decisions(tmp_path):
    prior = {
        "schema_version": "rstl-3dmm-direction-prior/v0.1",
        "system": "rstl",
        "topologyId": "flame-2023",
        "topologyVersion": "flame-2023-v1",
        "validated": False,
        "review_status": "draft_not_clinically_validated",
        "samples": [
            {
                "tri": 0,
                "bary": [0.333333, 0.333333, 0.333334],
                "point": [0, 0, 0],
                "vector": [1, 0, 0],
                "angle_deg": 0,
                "confidence": 0.9,
            },
            {
                "tri": 1,
                "bary": [0.333333, 0.333333, 0.333334],
                "point": [1, 0, 0],
                "vector": [0, 1, 0],
                "angle_deg": 90,
                "confidence": 0.2,
            },
            {
                "tri": 2,
                "bary": [0.333333, 0.333333, 0.333334],
                "point": [0, 1, 0],
                "vector": [0, 1, 0],
                "angle_deg": 90,
                "confidence": 0.7,
            },
            {
                "tri": 3,
                "bary": [0.333333, 0.333333, 0.333334],
                "point": [1, 1, 0],
                "vector": [1, 0, 0],
                "angle_deg": 0,
                "confidence": 0.8,
            },
        ],
    }
    packet = {
        "schema_version": "rstl-3dmm-review-packet/v0.1",
        "source_validated": False,
        "review_status": "draft_not_clinically_validated",
        "system": "rstl",
        "topologyId": "flame-2023",
        "topologyVersion": "flame-2023-v1",
        "source_sample_count": 4,
        "items": [
            {
                "review_id": "rstl3dmm-0001",
                "source_sample_index": 0,
                "tri": 0,
                "clinician_review": {
                    "decision": "accepted",
                    "reviewer": "Dr A",
                    "reviewed_at": "2026-06-24",
                    "region_label": "cheek",
                    "direction_accepted": True,
                    "notes": "ok",
                },
            },
            {
                "review_id": "rstl3dmm-0002",
                "source_sample_index": 1,
                "tri": 1,
                "clinician_review": {
                    "decision": "corrected",
                    "reviewer": "Dr A",
                    "reviewed_at": "2026-06-24",
                    "region_label": "lower_eyelid",
                    "direction_accepted": False,
                    "corrected_angle_deg": 45,
                    "notes": "follow lower eyelid margin",
                },
            },
            {
                "review_id": "rstl3dmm-0003",
                "source_sample_index": 2,
                "tri": 2,
                "clinician_review": {
                    "decision": "rejected",
                    "reviewer": "Dr B",
                    "reviewed_at": "2026-06-25",
                    "region_label": "nasal_ala",
                    "direction_accepted": False,
                    "notes": "wrong region",
                },
            },
            {
                "review_id": "rstl3dmm-0004",
                "source_sample_index": 3,
                "tri": 3,
                "clinician_review": {
                    "decision": "pending",
                    "reviewer": "",
                    "reviewed_at": "",
                    "direction_accepted": None,
                    "notes": "",
                },
            },
        ],
    }
    prior_path = tmp_path / "rstl_flame_direction_prior.json"
    packet_path = tmp_path / "rstl_3dmm_review_packet.json"
    output_path = tmp_path / "rstl_3dmm_reviewed_direction_prior.json"
    prior_path.write_text(json.dumps(prior))
    packet_path.write_text(json.dumps(packet))

    result = subprocess.run(
        [
            sys.executable,
            "tools/apply_rstl_3dmm_review_packet.py",
            "--prior",
            str(prior_path),
            "--packet",
            str(packet_path),
            "--output",
            str(output_path),
            "--generated-at",
            "2026-06-25",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr
    assert "[ok]" in result.stdout
    reviewed = json.loads(output_path.read_text())
    assert reviewed["schema_version"] == "rstl-3dmm-reviewed-direction-prior/v0.1"
    assert reviewed["validated"] is False
    assert reviewed["review_status"] == "draft_not_clinically_validated"
    assert reviewed["generated_by"] == "tools/apply_rstl_3dmm_review_packet.py"
    assert reviewed["review_application"] == {
        "reviewed_count": 3,
        "accepted_count": 1,
        "corrected_count": 1,
        "rejected_count": 1,
        "pending_count": 1,
        "applied_sample_count": 2,
        "completion_rate": 0.75,
        "decision_source": "json_review_packet",
        "csv_overlay": None,
        "reviewer_counts": {"Dr A": 2, "Dr B": 1},
        "corrected_sample_indices": [1],
        "rejected_sample_indices": [2],
    }
    assert reviewed["samples"][0]["review_applied"] is True
    assert reviewed["samples"][0]["clinician_review"]["decision"] == "accepted"
    assert reviewed["samples"][1]["review_applied"] is True
    assert reviewed["samples"][1]["pre_review_vector"] == [0, 1, 0]
    assert math.isclose(reviewed["samples"][1]["angle_deg"], 45.0, abs_tol=0.01)
    assert math.isclose(
        math.sqrt(sum(float(v) * float(v) for v in reviewed["samples"][1]["vector"])),
        1.0,
        rel_tol=2e-4,
        abs_tol=2e-4,
    )
    assert reviewed["samples"][1]["review_correction_source"] == "corrected_angle_deg"
    assert reviewed["samples"][2]["excluded_from_reviewed_prior"] is True
    assert reviewed["samples"][2]["review_applied"] is False
    assert "clinician_review" not in reviewed["samples"][3]
    assert reviewed["applied_reviews"][1]["vector_changed"] is True
    assert reviewed["applied_reviews"][2]["excluded"] is True
    assert "validated:false" in reviewed["clinical_boundary"]


def test_rstl_3dmm_review_packet_application_accepts_clinician_csv(tmp_path):
    prior = {
        "schema_version": "rstl-3dmm-direction-prior/v0.1",
        "system": "rstl",
        "topologyId": "flame-2023",
        "topologyVersion": "flame-2023-v1",
        "validated": False,
        "review_status": "draft_not_clinically_validated",
        "samples": [
            {"tri": 0, "point": [0, 0, 0], "vector": [1, 0, 0], "angle_deg": 0, "confidence": 0.9},
            {"tri": 1, "point": [1, 0, 0], "vector": [0, 1, 0], "angle_deg": 90, "confidence": 0.2},
            {"tri": 2, "point": [0, 1, 0], "vector": [0, 1, 0], "angle_deg": 90, "confidence": 0.7},
        ],
    }
    packet = {
        "schema_version": "rstl-3dmm-review-packet/v0.1",
        "source_validated": False,
        "review_status": "draft_not_clinically_validated",
        "system": "rstl",
        "topologyId": "flame-2023",
        "topologyVersion": "flame-2023-v1",
        "source_sample_count": 3,
        "items": [
            {
                "review_id": "rstl3dmm-0001",
                "source_sample_index": 0,
                "tri": 0,
                "clinician_review": {"decision": "pending"},
            },
            {
                "review_id": "rstl3dmm-0002",
                "source_sample_index": 1,
                "tri": 1,
                "clinician_review": {"decision": "pending"},
            },
            {
                "review_id": "rstl3dmm-0003",
                "source_sample_index": 2,
                "tri": 2,
                "clinician_review": {"decision": "pending"},
            },
        ],
    }
    prior_path = tmp_path / "rstl_flame_direction_prior.json"
    packet_path = tmp_path / "rstl_3dmm_review_packet.json"
    csv_path = tmp_path / "rstl_3dmm_review_packet.csv"
    output_path = tmp_path / "rstl_3dmm_reviewed_direction_prior.json"
    prior_path.write_text(json.dumps(prior))
    packet_path.write_text(json.dumps(packet))
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "review_id",
                "source_sample_index",
                "tri",
                "topologyId",
                "topologyVersion",
                "decision",
                "reviewer",
                "reviewed_at",
                "region_label",
                "direction_accepted",
                "corrected_angle_deg",
                "corrected_vector",
                "notes",
            ],
        )
        writer.writeheader()
        writer.writerow({
            "review_id": "rstl3dmm-0001",
            "source_sample_index": 0,
            "tri": 0,
            "topologyId": "flame-2023",
            "topologyVersion": "flame-2023-v1",
            "decision": "accepted",
            "reviewer": "Dr CSV",
            "reviewed_at": "2026-06-25",
            "region_label": "cheek",
            "direction_accepted": "true",
            "notes": "ok",
        })
        writer.writerow({
            "review_id": "rstl3dmm-0002",
            "source_sample_index": 1,
            "tri": 1,
            "topologyId": "flame-2023",
            "topologyVersion": "flame-2023-v1",
            "decision": "corrected",
            "reviewer": "Dr CSV",
            "reviewed_at": "2026-06-25",
            "region_label": "lower_eyelid",
            "direction_accepted": "false",
            "corrected_vector": "[1, 1, 0]",
            "notes": "rotate toward eyelid fold",
        })
        writer.writerow({
            "review_id": "rstl3dmm-0003",
            "source_sample_index": 2,
            "tri": 2,
            "topologyId": "flame-2023",
            "topologyVersion": "flame-2023-v1",
            "decision": "pending",
            "direction_accepted": "",
        })

    result = subprocess.run(
        [
            sys.executable,
            "tools/apply_rstl_3dmm_review_packet.py",
            "--prior",
            str(prior_path),
            "--packet",
            str(packet_path),
            "--review-csv",
            str(csv_path),
            "--output",
            str(output_path),
            "--generated-at",
            "2026-06-25",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr
    reviewed = json.loads(output_path.read_text())
    assert reviewed["source_review_csv"].endswith("rstl_3dmm_review_packet.csv")
    assert reviewed["review_application"]["decision_source"] == "clinician_csv_over_json_packet"
    assert reviewed["review_application"]["csv_overlay"]["applied_row_count"] == 3
    assert reviewed["review_application"]["csv_overlay"]["unmatched_packet_item_count"] == 0
    assert reviewed["review_application"]["reviewed_count"] == 2
    assert reviewed["review_application"]["accepted_count"] == 1
    assert reviewed["review_application"]["corrected_count"] == 1
    assert reviewed["review_application"]["pending_count"] == 1
    assert reviewed["samples"][0]["clinician_review"]["reviewer"] == "Dr CSV"
    assert reviewed["samples"][1]["review_correction_source"] == "corrected_vector"
    assert reviewed["samples"][1]["review_applied"] is True
    assert math.isclose(reviewed["samples"][1]["angle_deg"], 45.0, abs_tol=0.01)
    assert "clinician_review" not in reviewed["samples"][2]
