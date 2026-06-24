from pathlib import Path

import pytest

cv2 = pytest.importorskip("cv2")

from tools.prototype_wrinkle_lesion_cues import (  # noqa: E402
    binary_metrics,
    detect_cues,
    make_synthetic_case,
    run_synthetic,
)


def test_synthetic_wrinkle_lesion_cue_metrics_are_reported():
    case = make_synthetic_case()
    cues = detect_cues(case["image_bgr"])
    lesion = binary_metrics(cues["lesion_mask"], case["truth"]["lesion_mask"])
    wrinkle = binary_metrics(cues["wrinkle_mask"], case["truth"]["wrinkle_mask"])

    assert cues["confidence_label"] == "low_confidence_cv_cue_requires_manual_confirmation"
    assert cues["lesion_polylines"]
    assert cues["wrinkle_polylines"]
    assert lesion["iou"] > 0.82
    assert lesion["precision"] > 0.90
    assert wrinkle["recall"] > 0.72
    assert wrinkle["precision"] > 0.72


def test_synthetic_wrinkle_lesion_cue_export(tmp_path: Path):
    metrics = run_synthetic(tmp_path)
    assert metrics["lesion"]["iou"] > 0.82
    assert metrics["wrinkle"]["recall"] > 0.72
    expected = [
        "synthetic_input.png",
        "cue_overlay.png",
        "lesion_mask.png",
        "wrinkle_mask.png",
        "metrics.json",
    ]
    for name in expected:
        assert (tmp_path / name).exists(), name
