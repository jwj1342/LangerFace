"""Focused checks for the live four-region response adapter."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np


def load_live_module():
    tools = Path(__file__).resolve().parent
    sys.path.insert(0, str(tools))
    path = tools / "run_live_four_region_wrinkle.py"
    spec = importlib.util.spec_from_file_location("live_four_region_wrinkle_test", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load live detector module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def vertical_line(identifier: str, x: float, y0: int = 370, y1: int = 450) -> dict:
    points = [[x, float(y)] for y in range(y0, y1 + 1)]
    return {
        "id": identifier,
        "class": "glabellar",
        "confidence": 0.80,
        "lengthPx": float(y1 - y0),
        "points": points,
    }


def test_trace_companion_uses_real_opposite_dark_ridge_and_reference_span() -> None:
    live = load_live_module()
    accepted = [vertical_line("right", 635.0, 383, 442)]
    traces = [
        vertical_line("left", 582.0, 370, 480),
        vertical_line("middle", 617.0, 370, 480),
        vertical_line("far-right", 652.0, 370, 480),
    ]

    selected = live.trace_companion(
        accepted,
        traces,
        center_x=610.0,
        face_width=680.0,
    )

    assert selected is not None
    points = np.asarray(selected["points"], dtype=np.float32)
    assert abs(float(points[:, 0].mean()) - 582.0) < 1e-6
    assert float(points[:, 1].min()) >= 379.0
    assert float(points[:, 1].max()) <= 446.0
    assert selected["source"] == "vertical_dark_ridge_companion_to_glabellar_candidate"


def test_trace_companion_rejects_a_center_crease_that_is_too_close() -> None:
    live = load_live_module()
    accepted = [vertical_line("right", 635.0, 383, 442)]
    selected = live.trace_companion(
        accepted,
        [vertical_line("middle", 617.0, 370, 480)],
        center_x=610.0,
        face_width=680.0,
    )
    assert selected is None


def forehead_line(
    identifier: str,
    x0: int,
    x1: int,
    y: float,
    confidence: float,
) -> dict:
    points = [[float(x), y] for x in range(x0, x1 + 1)]
    return {
        "id": identifier,
        "class": "forehead",
        "confidence": confidence,
        "lengthPx": float(x1 - x0),
        "points": points,
    }


def test_suppress_weak_forehead_fragments_keeps_the_supported_main_line() -> None:
    live = load_live_module()
    main = forehead_line("main", 430, 500, 370.0, 0.72)
    fragment = forehead_line("fragment", 404, 444, 376.0, 0.37)
    independent = forehead_line("independent", 700, 840, 375.0, 0.88)

    kept = live.suppress_weak_forehead_fragments(
        [fragment, independent, main],
        face_width=600.0,
    )

    assert {line["id"] for line in kept} == {"main", "independent"}


def test_recover_strong_crow_feet_traces_requires_local_multicue_support() -> None:
    live = load_live_module()
    common = {
        "class": "crow_feet",
        "decision": "rejected",
        "decisionReason": "crow_feet_without_semantic_support",
        "screeningReason": "accepted",
        "lengthPx": 24.0,
        "chordRatio": 0.90,
        "meanOrientationSupport": 0.82,
        "points": [[820.0, 530.0], [840.0, 540.0]],
    }
    payload = {
        "fusedLines": [],
        "candidateDecisions": [
            {**common, "id": "strong", "confidence": 0.61},
            {**common, "id": "weak", "confidence": 0.54},
            {**common, "id": "wrong-direction", "confidence": 0.70, "meanOrientationSupport": 0.60},
        ],
    }

    live.recover_strong_crow_feet_traces(payload, face_width=600.0)

    assert payload["isolatedCrowFeetRecoveryCount"] == 1
    assert len(payload["fusedLines"]) == 1
    assert payload["fusedLines"][0]["source"] == "isolated_strong_multicue_crow_feet_trace"
