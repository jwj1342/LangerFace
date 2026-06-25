import json
import math
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRIOR = ROOT / "assets" / "rstl_mediapipe_direction_prior.json"


def _load_prior(path: Path = PRIOR) -> dict:
    return json.loads(path.read_text())


def test_rstl_direction_prior_asset_contract():
    prior = _load_prior()
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
    committed = _load_prior()
    assert built["schema_version"] == committed["schema_version"]
    assert built["topologyId"] == committed["topologyId"]
    assert built["coverage"] == committed["coverage"]
    assert built["samples"][0] == committed["samples"][0]
    assert built["samples"][-1] == committed["samples"][-1]


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
