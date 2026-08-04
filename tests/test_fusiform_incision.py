from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from langerface.incision import FusiformRules, fusiform_profile, generate_fusiform_incision

FIXTURE = Path(__file__).parent / "fixtures" / "fusiform_candidates.json"


@pytest.fixture(scope="module")
def parity_cases() -> list[dict]:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert payload["schema"] == "fusiform-incision-parity/v0.1"
    return payload["cases"]


@pytest.mark.parametrize("case_index", [0, 1, 2])
def test_python_generator_matches_shared_golden(parity_cases: list[dict], case_index: int) -> None:
    case = parity_cases[case_index]
    expected = case["expected"]
    candidate = generate_fusiform_incision(
        case["tumor"],
        case["direction"],
        case["units_per_mm"],
        case["normal"],
        case["rules"],
    )

    np.testing.assert_allclose(candidate["center"], expected["center"], atol=1e-12)
    np.testing.assert_allclose(candidate["axis"], expected["axis"], atol=1e-12)
    np.testing.assert_allclose(candidate["width_axis"], expected["width_axis"], atol=1e-12)
    np.testing.assert_allclose(candidate["endpoints"], expected["endpoints"], atol=1e-12)
    assert candidate["length_mm"] == pytest.approx(expected["length_mm"])
    assert candidate["width_mm"] == pytest.approx(expected["width_mm"])
    assert len(candidate["outline"]) == expected["outline_points"]

    samples = case["rules"]["samples"]
    np.testing.assert_allclose(candidate["outline"][samples // 2], expected["upper_midpoint"], atol=1e-12)
    np.testing.assert_allclose(
        candidate["outline"][samples + samples // 2],
        expected["lower_midpoint"],
        atol=1e-12,
    )
    metrics = candidate["metrics"]
    assert metrics["tip_angle_target_deg"] == pytest.approx(expected["tip_angle_target_deg"])
    assert metrics["tip_angle_limited_by_ratio"] is expected["tip_angle_limited_by_ratio"]
    assert metrics["boundary_used"] is expected["boundary_used"]
    assert metrics["outline_half_width_monotone"] is True
    assert metrics["outline_self_intersection"] is False
    assert metrics["outline_symmetry_max_error_mm"] == pytest.approx(0.0, abs=1e-12)
    assert metrics["outline_area_mm2"] > 0

    for key in ("boundary_point_count", "boundary_area_mm2", "boundary_envelope_outside_count"):
        if key in expected:
            assert metrics[key] == pytest.approx(expected[key])


def test_profile_is_c1_at_widest_point_and_tapers_without_turning() -> None:
    profile = fusiform_profile(
        center=(0.0, 0.0, 0.0),
        axis=(1.0, 0.0, 0.0),
        perpendicular=(0.0, 1.0, 0.0),
        half_length=9.0,
        half_width=3.0,
        samples=200,
        tip_angle_deg=30.0,
    )
    upper = np.asarray(profile["upper"])
    midpoint = len(upper) // 2
    left_tangent = upper[midpoint] - upper[midpoint - 1]
    right_tangent = upper[midpoint + 1] - upper[midpoint]

    # The cubic Hermite profile has a horizontal tangent at the widest point;
    # finite differences from either side converge without a visible kink.
    assert abs(left_tangent[1]) < 0.001
    assert abs(right_tangent[1]) < 0.001
    assert abs(left_tangent[1] + right_tangent[1]) < 1e-12
    assert np.all(np.diff(upper[: midpoint + 1, 1]) >= -1e-12)
    assert np.all(np.diff(upper[midpoint:, 1]) <= 1e-12)


def test_default_tip_angle_is_expressed_by_endpoint_tangents() -> None:
    profile = fusiform_profile(
        center=(0.0, 0.0, 0.0),
        axis=(1.0, 0.0, 0.0),
        perpendicular=(0.0, 1.0, 0.0),
        half_length=9.0,
        half_width=3.0,
        samples=4000,
        tip_angle_deg=30.0,
    )
    upper = np.asarray(profile["upper"])
    lower = np.asarray(profile["lower"])
    upper_tangent = upper[1] - upper[0]
    lower_tangent = lower[1] - lower[0]
    cosine = np.dot(upper_tangent, lower_tangent) / (
        np.linalg.norm(upper_tangent) * np.linalg.norm(lower_tangent)
    )
    measured = np.degrees(np.arccos(np.clip(cosine, -1.0, 1.0)))

    assert measured == pytest.approx(30.0, abs=0.03)
    assert profile["metrics"]["tip_angle_estimated_deg"] == pytest.approx(30.0)


def test_rejects_invalid_geometry_and_non_cutaneous_input() -> None:
    with pytest.raises(ValueError, match="cutaneous"):
        generate_fusiform_incision(
            {"kind": "subcutaneous", "center": [0, 0, 0], "diameter_mm": 4},
            {"vector": [1, 0, 0]},
            1.0,
        )
    with pytest.raises(ValueError, match="samples"):
        generate_fusiform_incision(
            {"kind": "cutaneous", "center": [0, 0, 0], "diameter_mm": 4},
            {"vector": [1, 0, 0]},
            1.0,
            rules=FusiformRules(samples=8),
        )
