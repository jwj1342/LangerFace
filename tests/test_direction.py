"""Python ↔ Web TypeScript local RSTL direction parity contract."""
import json
from pathlib import Path

import numpy as np

from langerface.lines import Atlas, AtlasLine, query_direction

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "web" / "test" / "rstl_direction_contract.json"


def _axis_angle_diff_deg(left: float, right: float) -> float:
    return abs(((left - right + 90.0) % 180.0) - 90.0)


def _assert_result_matches_contract(result, expected, fixture, case_name):
    angle_tolerance = float(fixture["angle_tolerance_deg"])
    scalar_tolerance = float(fixture["scalar_tolerance"])
    assert result.source == expected["source"], case_name
    assert np.allclose(result.point, expected["point"], atol=scalar_tolerance), case_name
    assert np.allclose(result.vector, expected["vector"], atol=scalar_tolerance), case_name
    assert _axis_angle_diff_deg(result.angle_deg, expected["angle_deg"]) <= angle_tolerance, case_name
    assert abs(result.confidence - expected["confidence"]) <= scalar_tolerance, case_name
    if expected["nearest_distance"] is None:
        assert result.nearest_distance is None, case_name
    else:
        assert result.nearest_distance is not None, case_name
        assert abs(result.nearest_distance - expected["nearest_distance"]) <= scalar_tolerance, case_name
    assert result.support_count == expected["support_count"], case_name
    assert abs(result.angular_spread_deg - expected["angular_spread_deg"]) <= angle_tolerance, case_name
    assert list(result.confidence_reasons) == expected["confidence_reasons"], case_name

    payload = result.to_dict()
    assert set(payload) == set(expected), case_name
    assert json.loads(json.dumps(payload, allow_nan=False)) == payload, case_name


def test_python_direction_service_matches_shared_browser_contract():
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for case in fixture["cases"]:
        result = query_direction(
            case["point"],
            case["vertices"],
            case["triangles"],
            case["atlas"],
        )
        _assert_result_matches_contract(result, case["expected"], fixture, case["name"])


def test_python_direction_service_is_static_query_stable():
    case = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"][0]
    # Guard against future global caches or mutable module state affecting
    # identical offline queries; this loop does not simulate elapsed frames.
    angles = [
        query_direction(
            case["point"],
            case["vertices"],
            case["triangles"],
            case["atlas"],
        ).angle_deg
        for _ in range(100)
    ]
    assert max(angles) - min(angles) < 1e-12


def test_python_direction_service_meets_real_100_frame_stability_gate():
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    sequence = fixture["static_face_sequence"]
    thresholds = sequence["thresholds"]
    assert len(sequence["frames"]) == thresholds["frame_count"] == 100
    assert sequence["source"]["kind"] == "privacy_minimized_real_landmark_sequence"
    assert sequence["source"]["detected_landmark_count"] == 478

    results = []
    for frame in sequence["frames"]:
        result = query_direction(
            frame["point"],
            frame["vertices"],
            frame["triangles"],
            frame["atlas"],
        )
        _assert_result_matches_contract(
            result,
            frame["expected"],
            fixture,
            f"static frame {frame['frame_index']}",
        )
        results.append(result)

    angles = np.asarray([result.angle_deg for result in results])
    confidences = np.asarray([result.confidence for result in results])
    assert np.ptp(angles) <= thresholds["max_axial_angle_range_deg"]
    assert np.max(np.abs(np.diff(angles))) <= thresholds["max_interframe_angle_delta_deg"]
    assert np.std(angles) <= thresholds["max_angle_std_dev_deg"]
    assert np.min(confidences) >= thresholds["min_confidence"]


def test_python_direction_service_accepts_atlas_model_and_empty_atlas():
    vertices = np.array(
        [[0, 0, 0], [10, 0, 0], [0, 10, 0]],
        dtype=np.float64,
    )
    triangles = np.array([[0, 1, 2]], dtype=np.int64)
    atlas = Atlas(
        system="rstl",
        lines=[
            AtlasLine(
                "horizontal",
                "cheek",
                np.array([[0, 0.7, 0.1], [0, 0.35, 0.45], [0, 0.0, 0.8]]),
            )
        ],
    )
    result = query_direction([4, 2, 0], vertices, triangles, atlas)
    assert result.confidence > 0.5
    assert abs(result.vector[0]) > 0.95

    empty = query_direction([4, 2, 0], vertices, triangles, Atlas(system="rstl"))
    assert empty.confidence == 0
    assert empty.source == "rstl_atlas_empty"
    assert empty.nearest_distance is None
    assert empty.support_count == 0
    assert empty.angular_spread_deg == 0
    assert empty.confidence_reasons == ("empty_atlas",)
    json.dumps(empty.to_dict(), allow_nan=False)


def test_python_direction_service_excludes_crossing_bundle_support():
    vertices = np.array([[0, 0, 0], [10, 0, 0], [0, 10, 0]], dtype=np.float64)
    result = query_direction(
        [5, 5, 0],
        vertices,
        np.array([[0, 1, 2]], dtype=np.int64),
        {
            "system": "rstl",
            "lines": [
                {"name": "local_vertical", "points3d": [[5, 4.9, 0], [5, 5, 0], [5, 5.1, 0]]},
                {
                    "name": "nearby_horizontal",
                    "points3d": [
                        [4.96, 5.002, 0],
                        [4.98, 5.002, 0],
                        [5.02, 5.002, 0],
                        [5.04, 5.002, 0],
                    ],
                },
            ],
        },
    )
    assert abs(result.vector[1]) > 0.99
    assert result.support_count <= 3
