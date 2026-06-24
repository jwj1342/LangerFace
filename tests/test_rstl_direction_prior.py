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
        check=True,
        capture_output=True,
    )
    assert "[ok]" in result.stdout
    built = _load_prior(output)
    committed = _load_prior()
    assert built["schema_version"] == committed["schema_version"]
    assert built["topologyId"] == committed["topologyId"]
    assert built["coverage"] == committed["coverage"]
    assert built["samples"][0] == committed["samples"][0]
    assert built["samples"][-1] == committed["samples"][-1]
