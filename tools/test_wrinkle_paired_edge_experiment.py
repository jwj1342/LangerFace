"""Focused synthetic checks for the paired-edge wrinkle experiment."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np


def load_illumination_module():
    tools = Path(__file__).resolve().parent
    sys.path.insert(0, str(tools))
    path = tools / "wrinkle_illumination.py"
    spec = importlib.util.spec_from_file_location("wrinkle_illumination_test", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load illumination module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_frangi_module():
    tools = Path(__file__).resolve().parent
    sys.path.insert(0, str(tools))
    path = tools / "wrinkle_frangi.py"
    spec = importlib.util.spec_from_file_location("wrinkle_frangi_test", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load Frangi module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def synthetic_groove(size: int = 161) -> np.ndarray:
    yy, _ = np.mgrid[:size, :size].astype(np.float32)
    return 0.70 - 0.24 * np.exp(-0.5 * ((yy - size // 2) / 2.2) ** 2)


def paired_profile(experiment, gray: np.ndarray) -> np.ndarray:
    tangent = np.zeros_like(gray, dtype=np.float32)
    response, _, _, _ = experiment.paired_edge_center_field(gray, tangent)
    return response[:, 24:-24].mean(axis=1)


def profile_error(reference: np.ndarray, candidate: np.ndarray) -> float:
    reference = reference / max(float(reference.max()), 1e-8)
    candidate = candidate / max(float(candidate.max()), 1e-8)
    return float(np.mean(np.abs(reference - candidate)))


def to_bgr(gray: np.ndarray) -> np.ndarray:
    image = np.round(np.clip(gray, 0.0, 1.0) * 255.0).astype(np.uint8)
    return np.repeat(image[:, :, None], 3, axis=2)


def load_experiment_module():
    tools = Path(__file__).resolve().parent
    sys.path.insert(0, str(tools))
    path = tools / "run_wrinkle_paired_edge_experiment.py"
    spec = importlib.util.spec_from_file_location("paired_edge_experiment", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load experiment module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_dark_groove_returns_one_center_peak() -> None:
    experiment = load_experiment_module()
    size = 101
    yy, _ = np.mgrid[:size, :size].astype(np.float32)
    gray = 0.72 - 0.28 * np.exp(-0.5 * ((yy - 50.0) / 2.0) ** 2)
    tangent = np.zeros_like(gray, dtype=np.float32)

    response, _, _, agreement = experiment.paired_edge_center_field(gray, tangent)
    row_response = response[:, 15:-15].mean(axis=1)
    peak_row = int(np.argmax(row_response))

    assert abs(peak_row - 50) <= 1
    assert row_response[peak_row] > 4.0 * row_response[peak_row - 4]
    assert float(agreement[peak_row, 50]) >= 0.50


def test_one_sided_step_is_weaker_than_dark_groove() -> None:
    experiment = load_experiment_module()
    size = 101
    yy, _ = np.mgrid[:size, :size].astype(np.float32)
    groove = 0.72 - 0.28 * np.exp(-0.5 * ((yy - 50.0) / 2.0) ** 2)
    step = np.full((size, size), 0.72, dtype=np.float32)
    step[50:] = 0.44
    tangent = np.zeros_like(step, dtype=np.float32)

    groove_response, _, _, _ = experiment.paired_edge_center_field(groove, tangent)
    step_response, _, _, _ = experiment.paired_edge_center_field(step, tangent)

    assert float(step_response.max()) < 0.10 * float(groove_response.max())


def test_frangi_response_peaks_on_dark_wrinkle_center() -> None:
    frangi = load_frangi_module()
    gray = synthetic_groove()
    response = frangi.dark_ridge_response(gray, np.ones_like(gray, dtype=np.uint8))
    row_response = response[:, 24:-24].mean(axis=1)

    assert abs(int(np.argmax(row_response)) - gray.shape[0] // 2) <= 1
    assert float(row_response.max()) > 8.0 * float(row_response[gray.shape[0] // 2 - 8])


def test_training_free_correction_recovers_wrinkle_response_under_gradient() -> None:
    experiment = load_experiment_module()
    illumination = load_illumination_module()
    gray = synthetic_groove()
    size = gray.shape[0]
    yy, xx = np.mgrid[:size, :size].astype(np.float32)
    shading = 0.58 + 0.64 * (yy / (size - 1)) + 0.08 * (xx / (size - 1))
    shaded = np.clip(gray * shading, 0.0, 1.0)
    mask = np.ones_like(gray, dtype=np.uint8)

    corrected = illumination.correct_illumination(to_bgr(shaded), mask, face_width=140.0)
    reference_profile = paired_profile(experiment, gray)
    shaded_profile = paired_profile(experiment, shaded)
    corrected_profile = paired_profile(experiment, corrected.corrected_gray)

    assert profile_error(reference_profile, corrected_profile) < profile_error(
        reference_profile,
        shaded_profile,
    )
    assert abs(int(np.argmax(corrected_profile)) - size // 2) <= 1
    assert np.isfinite(corrected.corrected_gray).all()
    assert 0.0 <= float(corrected.corrected_gray.min())
    assert float(corrected.corrected_gray.max()) <= 1.0
    assert float(corrected.gain.min()) >= 0.67 - 1e-6
    assert float(corrected.gain.max()) <= 1.50 + 1e-6


def test_training_free_correction_handles_vignette_without_moving_peak() -> None:
    experiment = load_experiment_module()
    illumination = load_illumination_module()
    gray = synthetic_groove()
    size = gray.shape[0]
    yy, xx = np.mgrid[:size, :size].astype(np.float32)
    radius = np.hypot(xx - size / 2.0, yy - size / 2.0) / (0.72 * size)
    shaded = np.clip(gray * (1.05 - 0.48 * np.minimum(radius, 1.0) ** 2), 0.0, 1.0)
    corrected = illumination.correct_illumination(
        to_bgr(shaded),
        np.ones_like(gray, dtype=np.uint8),
        face_width=140.0,
    )

    tangent = np.zeros_like(gray, dtype=np.float32)
    shaded_response, _, _, _ = experiment.paired_edge_center_field(shaded, tangent)
    corrected_response, _, _, _ = experiment.paired_edge_center_field(
        corrected.corrected_gray,
        tangent,
    )
    center_row = size // 2
    shaded_line = shaded_response[center_row, 16:-16]
    corrected_line = corrected_response[center_row, 16:-16]
    shaded_variation = float(shaded_line.std() / max(shaded_line.mean(), 1e-8))
    corrected_variation = float(corrected_line.std() / max(corrected_line.mean(), 1e-8))
    corrected_profile = paired_profile(experiment, corrected.corrected_gray)
    assert corrected_variation < 0.35 * shaded_variation
    assert abs(int(np.argmax(corrected_profile)) - size // 2) <= 1


def test_exposure_scale_and_offset_do_not_move_wrinkle_center() -> None:
    experiment = load_experiment_module()
    illumination = load_illumination_module()
    gray = synthetic_groove()
    size = gray.shape[0]
    mask = np.ones_like(gray, dtype=np.uint8)
    reference_profile = paired_profile(experiment, gray)

    for scale, offset in ((0.62, 0.04), (1.18, -0.08)):
        exposed = np.clip(scale * gray + offset, 0.0, 1.0)
        corrected = illumination.correct_illumination(to_bgr(exposed), mask, face_width=140.0)
        profile = paired_profile(experiment, corrected.corrected_gray)
        assert abs(int(np.argmax(profile)) - size // 2) <= 1
        assert profile_error(reference_profile, profile) < 0.01


def test_broad_lighting_transition_does_not_become_a_wrinkle() -> None:
    experiment = load_experiment_module()
    illumination = load_illumination_module()
    size = 161
    yy, _ = np.mgrid[:size, :size].astype(np.float32)
    broad_transition = 0.48 + 0.32 / (1.0 + np.exp(-(yy - size / 2.0) / 16.0))
    corrected = illumination.correct_illumination(
        to_bgr(broad_transition),
        np.ones_like(broad_transition, dtype=np.uint8),
        face_width=140.0,
    )
    tangent = np.zeros_like(broad_transition, dtype=np.float32)

    response, _, _, _ = experiment.paired_edge_center_field(corrected.corrected_gray, tangent)
    groove_response, _, _, _ = experiment.paired_edge_center_field(
        synthetic_groove(size),
        tangent,
    )

    assert float(response.max()) < 0.05 * float(groove_response.max())


def test_face_mask_blocks_dark_background_bleed_and_preserves_outside_pixels() -> None:
    illumination = load_illumination_module()
    size = 181
    yy, xx = np.mgrid[:size, :size].astype(np.float32)
    face = (xx - size / 2.0) ** 2 + (yy - size / 2.0) ** 2 <= 62.0**2
    gray = np.full((size, size), 0.04, dtype=np.float32)
    gray[face] = 0.66
    image = to_bgr(gray)

    corrected = illumination.correct_illumination(
        image,
        face.astype(np.uint8),
        face_width=124.0,
    )

    interior = (xx - size / 2.0) ** 2 + (yy - size / 2.0) ** 2 <= 52.0**2
    assert float(np.ptp(corrected.illumination[interior])) < 0.01
    far_outside = (xx - size / 2.0) ** 2 + (yy - size / 2.0) ** 2 >= 78.0**2
    assert np.array_equal(corrected.corrected_bgr[far_outside], image[far_outside])


def candidate(class_name: str, **updates) -> dict:
    output = {
        "class": class_name,
        "nearBaselineFraction": 0.0,
        "endpointDistancePx": 30.0,
        "minimumBaselineDistancePx": 20.0,
        "meanOrientationSupport": 0.90,
        "medianSemanticDistancePx": 30.0,
        "semanticNear6Fraction": 0.0,
        "semanticNear10Fraction": 0.0,
        "medianY": 100.0,
    }
    output.update(updates)
    return output


def topology_line(
    identifier: str,
    class_name: str,
    points: list[list[float]],
    **updates,
) -> dict:
    path = np.asarray(points, dtype=np.float32)
    output = {
        "id": identifier,
        "class": class_name,
        "confidence": 0.8,
        "lengthPx": float(np.linalg.norm(np.diff(path, axis=0), axis=1).sum()),
        "meanPairedEdge": 0.7,
        "meanPairBalance": 0.7,
        "meanScaleAgreement": 0.6,
        "chordRatio": 0.95,
        "elongation": 40.0,
        "meanWidthPx": 5.0,
        "meanRidgeSupport": 0.7,
        "meanOrientationSupport": 0.9,
        "meanModelSupport": 0.0,
        "medianSemanticDistancePx": 100.0,
        "semanticNear6Fraction": 0.0,
        "semanticNear10Fraction": 0.0,
        "medianY": float(np.median(path[:, 1])),
        "nearBaselineFraction": 0.0,
        "endpointDistancePx": 100.0,
        "minimumBaselineDistancePx": 100.0,
        "points": points,
    }
    output.update(updates)
    return output


def anatomy() -> dict:
    return {
        "faceWidthPx": 500.0,
        "centerX": 250.0,
        "outerCanthi": [(150.0, 250.0), (350.0, 250.0)],
    }


def test_class_specific_semantic_and_topology_gates() -> None:
    experiment = load_experiment_module()
    glabellar_baseline = [
        {"id": "g1", "class": "glabellar"},
        {"id": "g2", "class": "glabellar"},
    ]
    decision = experiment.candidate_decision(
        candidate("glabellar"),
        glabellar_baseline,
        face_width=500.0,
        nose_root_y=100.0,
    )
    assert decision == ("rejected", "third_glabellar_line_without_semantic_support")

    decision = experiment.candidate_decision(
        candidate(
            "nasal_dorsum",
            medianY=140.0,
            medianSemanticDistancePx=0.0,
            semanticNear10Fraction=1.0,
        ),
        [],
        face_width=500.0,
        nose_root_y=100.0,
    )
    assert decision == ("rejected", "outside_nose_root_band")

    decision = experiment.candidate_decision(
        candidate(
            "crow_feet",
            medianSemanticDistancePx=7.0,
            semanticNear10Fraction=0.80,
        ),
        [],
        face_width=500.0,
        nose_root_y=100.0,
    )
    assert decision == ("addition", "semantic_radial_crow_feet_line")

    decision = experiment.candidate_decision(
        candidate(
            "crow_feet",
            endpointDistancePx=3.0,
            minimumBaselineDistancePx=2.0,
        ),
        [{"id": "c1", "class": "crow_feet"}],
        face_width=500.0,
        nose_root_y=100.0,
    )
    assert decision == ("extension", "continuous_baseline_endpoint")


def test_fragment_merging_joins_collinear_gaps_without_collapsing_parallel_lines() -> None:
    experiment = load_experiment_module()
    candidates = [
        topology_line("left", "forehead", [[60.0, 100.0], [145.0, 100.0]]),
        topology_line("right", "forehead", [[150.0, 101.0], [240.0, 101.0]]),
        topology_line("parallel", "forehead", [[60.0, 130.0], [240.0, 130.0]]),
    ]
    merged = experiment.merge_candidate_fragments(candidates, face_width=500.0)

    assert len(merged) == 2
    joined = next(line for line in merged if "mergedFragmentIds" in line)
    assert joined["mergedFragmentIds"] == ["left", "right"]
    assert joined["lengthPx"] > 130.0


def test_all_four_anatomical_bundles_support_unsemantic_candidates() -> None:
    experiment = load_experiment_module()
    candidates = [
        topology_line("f1", "forehead", [[80.0, 80.0], [420.0, 81.0]]),
        topology_line("f2", "forehead", [[90.0, 105.0], [410.0, 106.0]]),
        topology_line("g1", "glabellar", [[232.0, 145.0], [232.0, 220.0]]),
        topology_line("g2", "glabellar", [[268.0, 145.0], [268.0, 220.0]]),
        topology_line("n1", "nasal_dorsum", [[215.0, 260.0], [285.0, 260.0]]),
        topology_line("n2", "nasal_dorsum", [[215.0, 271.0], [285.0, 271.0]]),
        topology_line("c1", "crow_feet", [[136.0, 247.0], [78.0, 228.0]]),
        topology_line("c2", "crow_feet", [[136.0, 253.0], [78.0, 272.0]]),
    ]
    supported = experiment.assign_bundle_support(candidates, [], anatomy())

    assert all(line["bundleSupported"] for line in supported)
    assert {line["bundleReason"] for line in supported} == {
        "parallel_forehead_bundle",
        "paired_vertical_glabellar_bundle",
        "stacked_nasal_root_bundle",
        "same_canthus_radial_fan",
    }


def test_isolated_edges_and_unsemantic_third_glabellar_line_remain_rejected() -> None:
    experiment = load_experiment_module()
    isolated = topology_line("isolated", "glabellar", [[232.0, 145.0], [232.0, 220.0]])
    supported = experiment.assign_bundle_support([isolated], [], anatomy())

    assert not supported[0]["bundleSupported"]
    decision = experiment.candidate_decision(
        supported[0],
        [],
        face_width=500.0,
        nose_root_y=250.0,
    )
    assert decision == ("rejected", "glabellar_without_semantic_or_companion_support")

    third = dict(supported[0], bundleSupported=True)
    decision = experiment.candidate_decision(
        third,
        [{"id": "g1", "class": "glabellar"}, {"id": "g2", "class": "glabellar"}],
        face_width=500.0,
        nose_root_y=250.0,
    )
    assert decision == ("rejected", "third_glabellar_line_without_semantic_support")


def test_strong_glabellar_candidate_replaces_weak_dark_ridge_companion() -> None:
    experiment = load_experiment_module()
    baselines = [
        topology_line(
            "g-left",
            "glabellar",
            [[218.0, 145.0], [218.0, 220.0]],
            source="official_unet_1024_semantic_seed_snapped_to_dark_ridge",
        ),
        topology_line(
            "g-middle",
            "glabellar",
            [[244.0, 145.0], [244.0, 220.0]],
            source="parallel_dark_ridge_companion_to_semantic_glabellar_primary",
        ),
    ]
    replacement = topology_line(
        "g-right",
        "glabellar",
        [[269.0, 152.0], [269.0, 215.0]],
        meanPairedEdge=0.45,
        meanPairBalance=0.54,
        meanScaleAgreement=0.322,
        meanRidgeSupport=0.43,
        meanOrientationSupport=0.92,
        chordRatio=0.93,
        elongation=600.0,
    )
    baseline_evidence = {
        "g-middle": {
            "meanPairedEdge": 0.10,
            "meanPairBalance": 0.17,
            "meanScaleAgreement": 0.11,
            "meanRidgeSupport": 0.22,
            "meanOrientationSupport": 0.46,
        },
    }
    supported = experiment.assign_glabellar_replacement_support(
        [replacement],
        baselines,
        anatomy(),
        baseline_evidence,
    )[0]

    assert supported["glabellarReplacementSupported"]
    assert supported["replacesBaselineId"] == "g-middle"
    decision = experiment.candidate_decision(
        supported,
        baselines,
        face_width=500.0,
        nose_root_y=250.0,
    )
    assert decision == ("addition", "strong_glabellar_replacement_candidate")

    displaced = dict(
        replacement,
        id="g-displaced",
        points=[[310.0, 152.0], [310.0, 215.0]],
    )
    unsupported = experiment.assign_glabellar_replacement_support(
        [displaced],
        baselines,
        anatomy(),
        baseline_evidence,
    )[0]
    assert not unsupported["glabellarReplacementSupported"]


def test_strong_frangi_glabellar_candidate_replaces_only_weaker_companion() -> None:
    experiment = load_experiment_module()
    baselines = [
        topology_line(
            "g-left",
            "glabellar",
            [[218.0, 145.0], [218.0, 220.0]],
            source="official_unet_1024_semantic_seed_snapped_to_dark_ridge",
        ),
        topology_line(
            "g-middle",
            "glabellar",
            [[244.0, 145.0], [244.0, 220.0]],
            source="parallel_dark_ridge_companion_to_semantic_glabellar_primary",
        ),
    ]
    replacement = topology_line(
        "g-right-frangi",
        "glabellar",
        [[269.0, 152.0], [269.0, 215.0]],
        meanPairedEdge=0.10,
        meanPairBalance=0.15,
        meanScaleAgreement=0.10,
        meanFrangiSupport=0.52,
        meanRidgeSupport=0.38,
        meanOrientationSupport=0.88,
        chordRatio=0.93,
        elongation=600.0,
    )
    baseline_evidence = {
        "g-middle": {
            "meanPairedEdge": 0.10,
            "meanPairBalance": 0.17,
            "meanScaleAgreement": 0.11,
            "meanRidgeSupport": 0.22,
            "meanFrangiSupport": 0.20,
            "meanOrientationSupport": 0.46,
        },
    }

    supported = experiment.assign_glabellar_replacement_support(
        [replacement],
        baselines,
        anatomy(),
        baseline_evidence,
    )[0]
    assert supported["glabellarReplacementSupported"]
    assert supported["replacesBaselineId"] == "g-middle"
    assert supported["glabellarReplacementEvidence"]["reason"] == (
        "strong_frangi_replaces_weak_dark_ridge_companion"
    )

    not_stronger = dict(replacement, meanFrangiSupport=0.30)
    unsupported = experiment.assign_glabellar_replacement_support(
        [not_stronger],
        baselines,
        anatomy(),
        baseline_evidence,
    )[0]
    assert not unsupported["glabellarReplacementSupported"]


def test_weak_fragments_extend_only_an_accepted_glabellar_replacement() -> None:
    experiment = load_experiment_module()
    core = topology_line(
        "core",
        "glabellar",
        [[269.0, 152.0], [269.0, 190.0]],
        glabellarReplacementSupported=True,
        replacesBaselineId="g-middle",
        decision="addition",
        decisionReason="strong_glabellar_replacement_candidate",
    )
    fragments = [
        topology_line("upper", "glabellar", [[267.0, 130.0], [268.0, 149.0]]),
        topology_line("lower", "glabellar", [[270.0, 194.0], [270.0, 205.0]]),
    ]

    extended = experiment.extend_replacement_additions([core], fragments, 500.0)[0]
    geometry = experiment.line_geometry(extended)
    assert geometry["yMin"] <= 131.0
    assert geometry["yMax"] >= 204.0
    assert set(extended["extensionFragmentIds"]) == {"upper", "lower"}

    isolated = dict(core, glabellarReplacementSupported=False)
    unchanged = experiment.extend_replacement_additions([isolated], fragments, 500.0)[0]
    assert "extensionFragmentIds" not in unchanged


def test_relaxed_scale_screen_is_glabellar_only_and_requires_strong_evidence() -> None:
    experiment = load_experiment_module()
    metrics = {
        "lengthPx": 40.0,
        "meanPairedEdge": 0.45,
        "meanPairBalance": 0.54,
        "meanScaleAgreement": 0.322,
        "meanOrientation": 0.92,
        "chordRatio": 0.93,
        "elongation": 600.0,
        "meanRidge": 0.43,
    }

    assert experiment.accept_paired_component("glabellar", metrics, 500.0) == (
        True,
        "accepted_strong_glabellar_relaxed_scale",
    )
    assert not experiment.accept_paired_component("forehead", metrics, 500.0)[0]
    assert not experiment.accept_paired_component(
        "glabellar",
        {**metrics, "meanRidge": 0.20},
        500.0,
    )[0]


def test_crow_feet_bundle_requires_both_rays_to_start_near_canthus() -> None:
    experiment = load_experiment_module()
    distant_rays = [
        topology_line("c1", "crow_feet", [[380.0, 250.0], [430.0, 245.0]]),
        topology_line("c2", "crow_feet", [[385.0, 270.0], [430.0, 292.0]]),
    ]
    supported = experiment.assign_bundle_support(distant_rays, [], anatomy())

    assert not any(line["bundleSupported"] for line in supported)


def test_component_length_gate_scales_with_face_width() -> None:
    experiment = load_experiment_module()
    metrics = {
        "lengthPx": 10.0,
        "meanPairedEdge": 0.7,
        "meanPairBalance": 0.7,
        "meanScaleAgreement": 0.6,
        "meanOrientation": 0.9,
        "chordRatio": 0.9,
        "elongation": 20.0,
        "meanRidge": 0.7,
    }

    assert experiment.accept_paired_component("forehead", metrics, face_width=250.0)[0]
    assert not experiment.accept_paired_component("forehead", metrics, face_width=700.0)[0]
    assert experiment.scaled_odd_kernel((23, 3), face_width=250.0) == (9, 3)


def test_nasal_trace_follows_separated_horizontal_dark_grooves() -> None:
    experiment = load_experiment_module()
    size = 161
    yy, _ = np.mgrid[:size, :size].astype(np.float32)
    gray = np.full((size, size), 0.72, dtype=np.float32)
    for center in (45.0, 70.0, 95.0):
        gray -= 0.20 * np.exp(-0.5 * ((yy - center) / 2.4) ** 2)

    traces, _, _ = experiment.wrinkle_nasal_dorsum.trace_horizontal_lines(
        gray,
        np.ones_like(gray, dtype=np.uint8),
        face_width=100.0,
        maximum_lines=4,
    )
    centers = [float(np.mean(trace.points[:, 1])) for trace in traces]
    assert len(traces) == 3
    assert np.allclose(centers, [45.0, 70.0, 95.0], atol=1.0)
    assert all(trace.coverage >= 0.58 for trace in traces)


def test_nasal_trace_candidate_has_a_separate_strict_gate() -> None:
    experiment = load_experiment_module()
    strong = candidate(
        "nasal_dorsum",
        source="nasal_dorsum_horizontal_dark_ridge_trace",
        medianY=105.0,
        lengthPx=60.0,
        chordRatio=0.98,
        meanNasalTraceSupport=0.32,
        nasalTraceCoverage=0.80,
    )
    assert experiment.candidate_decision(strong, [], 500.0, 100.0) == (
        "addition",
        "nasal_horizontal_dark_ridge_trace_replacement",
    )
    weak = dict(strong, nasalTraceCoverage=0.40)
    assert experiment.candidate_decision(weak, [], 500.0, 100.0) == (
        "rejected",
        "weak_or_misaligned_nasal_horizontal_trace",
    )
    weak_response = dict(strong, meanNasalTraceSupport=0.24)
    assert experiment.candidate_decision(weak_response, [], 500.0, 100.0) == (
        "rejected",
        "weak_or_misaligned_nasal_horizontal_trace",
    )
    upper_root_wrinkle = dict(strong, medianY=78.0)
    assert experiment.candidate_decision(upper_root_wrinkle, [], 500.0, 100.0) == (
        "addition",
        "nasal_horizontal_dark_ridge_trace_replacement",
    )


def test_nasal_trace_replacement_pairs_lines_by_vertical_order() -> None:
    experiment = load_experiment_module()
    traces = [
        topology_line(
            "t1",
            "nasal_dorsum",
            [[180.0, 100.0], [320.0, 100.0]],
            source="nasal_dorsum_horizontal_dark_ridge_trace",
        ),
        topology_line(
            "t2",
            "nasal_dorsum",
            [[180.0, 112.0], [320.0, 112.0]],
            source="nasal_dorsum_horizontal_dark_ridge_trace",
        ),
    ]
    baselines = [
        topology_line("b2", "nasal_dorsum", [[210.0, 112.0], [290.0, 112.0]]),
        topology_line("b1", "nasal_dorsum", [[210.0, 100.0], [290.0, 100.0]]),
    ]
    paired = experiment.assign_nasal_trace_replacements(traces, baselines, 500.0)
    assert {line["replacesBaselineId"] for line in paired} == {"b1", "b2"}
