import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_product_boundary_docs_keep_stage2_scope_clear():
    text = (ROOT / "docs" / "PRODUCT_BOUNDARIES.md").read_text()
    assert "肌肉骨骼实时孪生" in text
    assert "不属于当前阶段目标" in text
    assert "#64 Stage 2 agentic 切口规划" in text
    readme = (ROOT / "README.md").read_text()
    assert "PRODUCT_BOUNDARIES.md" in readme


def test_annotation_qa_documents_surface_path_and_export_consistency():
    text = (ROOT / "docs" / "ANNOTATION_QA.md").read_text()
    assert "贴面" in text
    assert "导出点数与屏幕预览路径点一致" in text
    assert "validated:false" in text
    assert "tools/test_annotate_model.mjs" in text


def test_rstl_3dmm_prior_manifest_preserves_draft_status():
    manifest = json.loads((ROOT / "assets" / "rstl_3dmm_prior_manifest.json").read_text())
    assert manifest["validated"] is False
    assert manifest["review_status"] == "draft_not_clinically_validated"
    ids = {asset["id"]: asset for asset in manifest["assets"]}
    assert ids["mediapipe_rstl_draft"]["topologyId"] == "mediapipe-468"
    assert ids["mediapipe_rstl_draft"]["validated"] is False
    assert ids["mediapipe_rstl_direction_prior"]["topologyId"] == "mediapipe-468"
    assert ids["mediapipe_rstl_direction_prior"]["path"] is None
    assert ids["mediapipe_rstl_direction_prior"]["remote_filename"] == "rstl_mediapipe_direction_prior.json"
    assert ids["mediapipe_rstl_direction_prior"]["local_cache_path"] == "local_outputs/rstl_mediapipe_direction_prior.json"
    assert ids["mediapipe_rstl_direction_prior"]["status"] == "remote_or_generated_draft_direction_field"
    assert ids["mediapipe_rstl_direction_prior"]["validated"] is False
    assert ids["flame_rstl_prior"]["topologyId"] == "flame-2023"
    assert ids["flame_rstl_prior"]["status"] == "pending_doctor_annotation"
    assert ids["flame_rstl_prior"]["validated"] is False
    assert ids["flame_rstl_direction_prior"]["topologyId"] == "flame-2023"
    assert ids["flame_rstl_direction_prior"]["generated_by"] == "tools/build_flame_rstl_direction_prior.py"
    assert ids["flame_rstl_direction_prior"]["status"] == "pending_dev_local_generation"
    assert ids["flame_rstl_direction_prior"]["path"] is None
    assert ids["flame_rstl_direction_prior"]["validated"] is False
    assert ids["bfm_rstl_direction_prior"]["topologyId"] == "bfm-local"
    assert ids["bfm_rstl_direction_prior"]["generated_by"] == "tools/build_3dmm_rstl_direction_prior.py"
    assert ids["bfm_rstl_direction_prior"]["status"] == "pending_dev_local_generation"
    assert ids["bfm_rstl_direction_prior"]["path"] is None
    assert ids["bfm_rstl_direction_prior"]["validated"] is False

    doc = (ROOT / "docs" / "RSTL_3DMM_PRIOR.md").read_text()
    assert "Borges" in doc
    assert "rstl_mediapipe_direction_prior.json" in doc
    assert "build_flame_rstl_direction_prior.py" in doc
    assert "build_3dmm_rstl_direction_prior.py" in doc
    assert "triangle_centroid_direction" in doc
    assert "#2" in doc
    assert "#13" in doc
    assert "#61" in doc
    assert "validated:true" in doc
