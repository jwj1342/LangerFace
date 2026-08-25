"""Fuse multi-scale paired edges with semantic and anatomical wrinkle evidence.

Unlike a direct Canny overlay, this experiment requires opposite-polarity
gradients on both sides of a darker center. It extracts the midpoint directly,
then uses a general wrinkle U-Net, anatomical topology, and an optional v6
baseline to distinguish independent additions from endpoint extensions.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np
from scipy.ndimage import binary_propagation, gaussian_filter, map_coordinates

import run_wrinkle_fine_line_experiment as fine
import run_wrinkle_four_class_experiment as v1
import wrinkle_frangi
import wrinkle_illumination
import wrinkle_nasal_dorsum

REPO = Path(__file__).resolve().parents[1]
PROJECT = REPO.parent
DEFAULT_INPUT = PROJECT / "langer线-cc" / "wrinkle.png"
DEFAULT_LANDMARKS = PROJECT / "langer线-cc" / "wrinkle_landmarks_browser_cpu.json"
DEFAULT_FACE_MODEL = REPO / "assets" / "face_landmarker.task"
DEFAULT_CHECKPOINT = REPO / "assets" / "models" / "wrinkle_unet_patient_finetuned.pth"
DEFAULT_BASELINE = (
    PROJECT / "langer线-cc" / "wrinkle_fine_line_experiment_v6" / "wrinkle_fine_lines_v6.json"
)
DEFAULT_OUTPUT = PROJECT / "langer线-cc" / "wrinkle_paired_edge_experiment_v10_forehead_recall"
HALF_WIDTHS = (1.5, 2.5, 3.5, 5.0)
MAXIMUM_ADDITIONS = {"forehead": 8, "glabellar": 2, "nasal_dorsum": 3, "crow_feet": 6}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--landmark-input", type=Path)
    parser.add_argument("--face-model", type=Path, default=DEFAULT_FACE_MODEL)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument(
        "--without-baseline",
        action="store_true",
        help="Run semantic paired-edge screening without a precomputed centerline baseline.",
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def paired_edge_center_field(
    gray: np.ndarray,
    tangent: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    smoothed = gaussian_filter(gray, sigma=0.8, mode="reflect")
    gradient_y, gradient_x = np.gradient(smoothed)
    yy, xx = np.mgrid[: gray.shape[0], : gray.shape[1]].astype(np.float32)
    normal_x = -np.sin(tangent)
    normal_y = np.cos(tangent)
    best = np.zeros_like(gray, dtype=np.float32)
    best_width = np.zeros_like(gray, dtype=np.float32)
    best_balance = np.zeros_like(gray, dtype=np.float32)
    responses = []

    for half_width in HALF_WIDTHS:
        left_coordinates = [yy - half_width * normal_y, xx - half_width * normal_x]
        right_coordinates = [yy + half_width * normal_y, xx + half_width * normal_x]
        left_intensity = map_coordinates(smoothed, left_coordinates, order=1, mode="reflect")
        right_intensity = map_coordinates(smoothed, right_coordinates, order=1, mode="reflect")
        left_gradient_x = map_coordinates(gradient_x, left_coordinates, order=1, mode="reflect")
        left_gradient_y = map_coordinates(gradient_y, left_coordinates, order=1, mode="reflect")
        right_gradient_x = map_coordinates(gradient_x, right_coordinates, order=1, mode="reflect")
        right_gradient_y = map_coordinates(gradient_y, right_coordinates, order=1, mode="reflect")

        left_normal_gradient = left_gradient_x * normal_x + left_gradient_y * normal_y
        right_normal_gradient = right_gradient_x * normal_x + right_gradient_y * normal_y
        left_edge = np.maximum(-left_normal_gradient, 0.0)
        right_edge = np.maximum(right_normal_gradient, 0.0)
        left_contrast = np.maximum(left_intensity - smoothed, 0.0)
        right_contrast = np.maximum(right_intensity - smoothed, 0.0)
        edge_strength = np.minimum(left_edge, right_edge)
        dark_center_contrast = np.minimum(left_contrast, right_contrast)
        edge_balance = np.minimum(left_edge, right_edge) / np.maximum(
            np.maximum(left_edge, right_edge),
            1e-8,
        )
        contrast_balance = np.minimum(left_contrast, right_contrast) / np.maximum(
            np.maximum(left_contrast, right_contrast),
            1e-8,
        )
        balance = np.sqrt(edge_balance * contrast_balance)
        response = np.sqrt(edge_strength * dark_center_contrast) * balance
        responses.append(response)
        update = response > best
        best[update] = response[update]
        best_width[update] = 2.0 * half_width
        best_balance[update] = balance[update]
    response_stack = np.stack(responses, axis=0)
    scale_agreement = np.mean(
        response_stack >= 0.55 * np.maximum(best[None, ...], 1e-8),
        axis=0,
    ).astype(np.float32)
    scale_agreement[best <= 1e-8] = 0.0
    return best, best_width, best_balance, scale_agreement


def experiment_regions(
    landmarks: np.ndarray,
    width: int,
    height: int,
) -> tuple[dict[str, np.ndarray], np.ndarray, dict]:
    regions, face, anatomy = v1.anatomy_regions(landmarks, width, height)
    excluded = fine.exclusion_mask(landmarks, width, height).astype(bool)
    for name in fine.CLASS_ORDER:
        regions[name] = (regions[name].astype(bool) & ~excluded).astype(np.uint8)
    face_width = float(anatomy["faceWidthPx"])
    center_x = float(anatomy["centerX"])
    brow_y = float(anatomy["browY"])
    nose_root_y = float(anatomy["noseRootY"])
    yy, xx = np.mgrid[:height, :width]

    regions["forehead"] &= (yy <= brow_y - 0.04 * face_width).astype(np.uint8)
    glabellar_gate = (
        (yy >= brow_y - 0.10 * face_width)
        & (yy <= nose_root_y - 0.02 * face_width)
        & (np.abs(xx - center_x) <= 0.10 * face_width)
    )
    regions["glabellar"] = (
        glabellar_gate.astype(np.uint8) & face & ~excluded
    ).astype(np.uint8)
    nasal_gate = (
        (yy >= nose_root_y - 0.025 * face_width)
        & (yy <= nose_root_y + 0.085 * face_width)
        & (np.abs(xx - center_x) <= 0.09 * face_width)
    )
    regions["nasal_dorsum"] &= nasal_gate.astype(np.uint8)
    crow_gate = np.zeros((height, width), dtype=np.uint8)
    for outer_x, outer_y in anatomy["outerCanthi"]:
        radial = np.hypot(xx - float(outer_x), yy - float(outer_y))
        side = xx < outer_x if outer_x < center_x else xx > outer_x
        current = (
            side
            & (radial >= 0.018 * face_width)
            & (radial <= 0.17 * face_width)
            & (np.abs(yy - float(outer_y)) <= 0.13 * face_width)
        )
        crow_gate |= current.astype(np.uint8)
    regions["crow_feet"] &= crow_gate
    return regions, face, anatomy


def paired_hysteresis(
    class_name: str,
    score: np.ndarray,
    nms: np.ndarray,
    region: np.ndarray,
) -> np.ndarray:
    values = score[(nms > 0) & (region > 0) & np.isfinite(score)]
    values = values[values > 0]
    if values.size < 20:
        return np.zeros_like(nms)
    weak_percentile, strong_percentile = {
        "forehead": (64.0, 86.0),
        "glabellar": (66.0, 88.0),
        "nasal_dorsum": (68.0, 90.0),
        "crow_feet": (66.0, 88.0),
    }[class_name]
    weak = (nms > 0) & (score >= np.percentile(values, weak_percentile))
    strong = (nms > 0) & (score >= np.percentile(values, strong_percentile))
    connected = binary_propagation(strong, mask=weak, structure=np.ones((3, 3), dtype=bool))
    return connected.astype(np.uint8)


def paired_component_metrics(
    path: np.ndarray,
    length: float,
    pair_score: np.ndarray,
    pair_balance: np.ndarray,
    scale_agreement: np.ndarray,
    width_map: np.ndarray,
    ridge: np.ndarray,
    frangi: np.ndarray,
    orientation: np.ndarray,
    model_probability: np.ndarray,
    semantic_distance: np.ndarray,
) -> dict:
    xy = np.round(path).astype(np.int32)
    xy[:, 0] = np.clip(xy[:, 0], 0, pair_score.shape[1] - 1)
    xy[:, 1] = np.clip(xy[:, 1], 0, pair_score.shape[0] - 1)
    centered = path - path.mean(axis=0, keepdims=True)
    covariance = centered.T @ centered / max(len(path) - 1, 1)
    eigenvalues = np.linalg.eigvalsh(covariance)
    chord = float(np.linalg.norm(path[-1] - path[0]))
    return {
        "lengthPx": float(length),
        "chordRatio": chord / max(length, 1e-6),
        "elongation": float((eigenvalues[-1] + 1e-6) / (eigenvalues[0] + 1e-6)),
        "meanPairedEdge": float(pair_score[xy[:, 1], xy[:, 0]].mean()),
        "meanPairBalance": float(pair_balance[xy[:, 1], xy[:, 0]].mean()),
        "meanScaleAgreement": float(scale_agreement[xy[:, 1], xy[:, 0]].mean()),
        "meanWidthPx": float(width_map[xy[:, 1], xy[:, 0]].mean()),
        "meanRidge": float(ridge[xy[:, 1], xy[:, 0]].mean()),
        "meanFrangi": float(frangi[xy[:, 1], xy[:, 0]].mean()),
        "meanOrientation": float(orientation[xy[:, 1], xy[:, 0]].mean()),
        "meanModelSupport": float(model_probability[xy[:, 1], xy[:, 0]].mean()),
        "medianSemanticDistancePx": float(
            np.median(semantic_distance[xy[:, 1], xy[:, 0]]),
        ),
        "semanticNear6Fraction": float(
            (semantic_distance[xy[:, 1], xy[:, 0]] <= 6.0).mean(),
        ),
        "semanticNear10Fraction": float(
            (semantic_distance[xy[:, 1], xy[:, 0]] <= 10.0).mean(),
        ),
        "medianY": float(np.median(path[:, 1])),
    }


def accept_paired_component(
    class_name: str,
    metrics: dict,
    face_width: float,
) -> tuple[bool, str]:
    minimum_length = {
        "forehead": 0.035,
        "glabellar": 0.028,
        "nasal_dorsum": 0.020,
        "crow_feet": 0.023,
    }[class_name] * face_width
    minimum_orientation = {
        "forehead": 0.48,
        "glabellar": 0.46,
        "nasal_dorsum": 0.58,
        "crow_feet": 0.36,
    }[class_name]
    minimum_chord_ratio = {
        "forehead": 0.72,
        "glabellar": 0.66,
        "nasal_dorsum": 0.72,
        "crow_feet": 0.58,
    }[class_name]
    if metrics["lengthPx"] < minimum_length:
        return False, "short"
    frangi_glabellar = (
        class_name == "glabellar"
        and metrics["lengthPx"] >= 0.045 * face_width
        and metrics.get("meanFrangi", 0.0) >= 0.42
        and metrics["meanOrientation"] >= 0.75
        and metrics["chordRatio"] >= 0.80
        and metrics["elongation"] >= 8.0
        and metrics["meanRidge"] >= 0.28
    )
    if frangi_glabellar:
        return True, "accepted_frangi_glabellar_dark_ridge"
    if metrics["meanPairedEdge"] < 0.34:
        return False, "weak_paired_edge"
    if metrics["meanPairBalance"] < 0.30:
        return False, "unbalanced_edge_pair"
    relaxed_glabellar_scale = (
        class_name == "glabellar"
        and metrics["meanScaleAgreement"] >= 0.30
        and metrics["meanPairedEdge"] >= 0.40
        and metrics["meanPairBalance"] >= 0.48
        and metrics["meanOrientation"] >= 0.80
        and metrics["chordRatio"] >= 0.82
        and metrics["elongation"] >= 8.0
        and metrics["meanRidge"] >= 0.35
    )
    if metrics["meanScaleAgreement"] < 0.34 and not relaxed_glabellar_scale:
        return False, "single_scale_only"
    if metrics["meanOrientation"] < minimum_orientation:
        return False, "direction"
    if metrics["chordRatio"] < minimum_chord_ratio:
        return False, "loop_or_reversal"
    if metrics["elongation"] < 2.5:
        return False, "not_elongated"
    if metrics["meanRidge"] < 0.16:
        return False, "weak_dark_ridge"
    if relaxed_glabellar_scale and metrics["meanScaleAgreement"] < 0.34:
        return True, "accepted_strong_glabellar_relaxed_scale"
    return True, "accepted"


def component_line_record(
    class_name: str,
    path: np.ndarray,
    length: float,
    metrics: dict,
    near_baseline_fraction: float,
    screening_reason: str,
    source: str = "multi_scale_opposite_polarity_paired_edges",
) -> dict:
    paired_confidence = float(np.clip(
        0.34 * metrics["meanPairedEdge"]
        + 0.22 * metrics["meanPairBalance"]
        + 0.22 * metrics["meanOrientation"]
        + 0.22 * metrics["meanRidge"],
        0.0,
        1.0,
    ))
    frangi_confidence = float(np.clip(
        0.36 * metrics["meanFrangi"]
        + 0.24 * metrics["meanOrientation"]
        + 0.20 * metrics["meanRidge"]
        + 0.10 * metrics["meanPairedEdge"]
        + 0.10 * metrics["meanPairBalance"],
        0.0,
        1.0,
    ))
    confidence = max(paired_confidence, frangi_confidence)
    return {
        "id": "",
        "class": class_name,
        "confidence": confidence,
        "lengthPx": round(float(length), 3),
        "chordRatio": round(metrics["chordRatio"], 6),
        "elongation": round(metrics["elongation"], 6),
        "meanPairedEdge": round(metrics["meanPairedEdge"], 6),
        "meanPairBalance": round(metrics["meanPairBalance"], 6),
        "meanScaleAgreement": round(metrics["meanScaleAgreement"], 6),
        "meanWidthPx": round(metrics["meanWidthPx"], 6),
        "meanRidgeSupport": round(metrics["meanRidge"], 6),
        "meanFrangiSupport": round(metrics["meanFrangi"], 6),
        "meanOrientationSupport": round(metrics["meanOrientation"], 6),
        "meanModelSupport": round(metrics["meanModelSupport"], 6),
        "medianSemanticDistancePx": round(metrics["medianSemanticDistancePx"], 6),
        "semanticNear6Fraction": round(metrics["semanticNear6Fraction"], 6),
        "semanticNear10Fraction": round(metrics["semanticNear10Fraction"], 6),
        "medianY": round(metrics["medianY"], 6),
        "nearBaselineFraction": round(near_baseline_fraction, 6),
        "screeningReason": screening_reason,
        "source": source,
        "points": [[round(float(x), 3), round(float(y), 3)] for x, y in path],
    }


def nasal_trace_line_record(
    trace: wrinkle_nasal_dorsum.NasalTrace,
    face_width: float,
    baseline_distance_map: np.ndarray,
) -> dict:
    """Convert a continuous horizontal trace into a normal candidate record."""
    path = np.asarray(trace.points, dtype=np.float32)
    length = fine.path_length(path)
    chord = float(np.linalg.norm(path[-1] - path[0]))
    chord_ratio = chord / max(length, 1e-6)
    elongation = length / max(float(np.sqrt(max(len(path), 1))), 1.0)
    xy = np.round(path).astype(np.int32)
    xy[:, 0] = np.clip(xy[:, 0], 0, baseline_distance_map.shape[1] - 1)
    xy[:, 1] = np.clip(xy[:, 1], 0, baseline_distance_map.shape[0] - 1)
    near_baseline_fraction = float(
        (baseline_distance_map[xy[:, 1], xy[:, 0]] <= 5.0).mean()
    )
    # The trace channel is deliberately independent of the paired-edge score:
    # it is admitted only by its continuous dark-ridge evidence and geometry.
    confidence = float(
        np.clip(
            0.55 * trace.mean_response
            + 0.35 * trace.coverage
            + 0.10 * min(length / max(0.10 * face_width, 1e-6), 1.0),
            0.0,
            1.0,
        )
    )
    return {
        "id": "",
        "class": "nasal_dorsum",
        "confidence": confidence,
        "lengthPx": round(float(length), 3),
        "chordRatio": round(chord_ratio, 6),
        "elongation": round(elongation, 6),
        "meanPairedEdge": 0.0,
        "meanPairBalance": 0.0,
        "meanScaleAgreement": 1.0,
        "meanWidthPx": round(float(trace.scale), 6),
        "meanRidgeSupport": round(float(trace.mean_response), 6),
        "meanFrangiSupport": 0.0,
        "meanOrientationSupport": 1.0,
        "meanModelSupport": 0.0,
        "medianSemanticDistancePx": 999.0,
        "semanticNear6Fraction": 0.0,
        "semanticNear10Fraction": 0.0,
        "medianY": round(float(np.median(path[:, 1])), 6),
        "nearBaselineFraction": round(near_baseline_fraction, 6),
        "meanNasalTraceSupport": round(float(trace.mean_response), 6),
        "nasalTraceCoverage": round(float(trace.coverage), 6),
        "nasalTraceScale": round(float(trace.scale), 6),
        "screeningReason": "continuous_horizontal_dark_ridge_trace",
        "source": "nasal_dorsum_horizontal_dark_ridge_trace",
        "points": [[round(float(x), 3), round(float(y), 3)] for x, y in path],
        "replacesBaselineId": None,
        "nasalTraceReplacementEvidence": None,
    }


def assign_nasal_trace_replacements(
    traces: list[dict],
    baseline_lines: list[dict],
    face_width: float,
) -> list[dict]:
    """Pair horizontal traces with weak nasal baselines without touching other classes."""
    output = [dict(trace) for trace in traces]
    nasal_baselines = sorted(
        (line for line in baseline_lines if line["class"] == "nasal_dorsum"),
        key=lambda line: float(line_geometry(line)["centroid"][1]),
    )
    ordered_traces = sorted(output, key=lambda line: float(line["medianY"]))
    if len(ordered_traces) < 2 or not nasal_baselines:
        return output
    pair_count = min(len(ordered_traces), len(nasal_baselines), 3)
    for trace, baseline in zip(ordered_traces[:pair_count], nasal_baselines[:pair_count]):
        trace_geometry = line_geometry(trace)
        baseline_geometry = line_geometry(baseline)
        overlap = interval_overlap_fraction(
            trace_geometry["xMin"],
            trace_geometry["xMax"],
            baseline_geometry["xMin"],
            baseline_geometry["xMax"],
        )
        y_gap = abs(
            float(trace_geometry["centroid"][1])
            - float(baseline_geometry["centroid"][1])
        )
        x_gap = abs(
            float(trace_geometry["centroid"][0])
            - float(baseline_geometry["centroid"][0])
        )
        if (
            overlap >= 0.35
            and y_gap <= 0.045 * face_width
            and x_gap <= 0.060 * face_width
        ):
            trace["replacesBaselineId"] = str(baseline["id"])
            trace["nasalTraceReplacementEvidence"] = {
                "replacedBaselineId": str(baseline["id"]),
                "horizontalOverlapFraction": round(overlap, 6),
                "verticalCentroidGapPx": round(y_gap, 6),
                "centroidXGapPx": round(x_gap, 6),
            }
    return output


def accept_glabellar_extension_fragment(metrics: dict, face_width: float) -> bool:
    return (
        metrics["lengthPx"] >= 0.007 * face_width
        and metrics["meanPairedEdge"] >= 0.18
        and metrics["meanPairBalance"] >= 0.35
        and metrics["meanScaleAgreement"] >= 0.20
        and metrics["meanOrientation"] >= 0.50
        and metrics["chordRatio"] >= 0.75
        and metrics["elongation"] >= 8.0
        and metrics["meanRidge"] >= 0.15
    )


def baseline_distance(lines: list[dict], class_name: str, shape: tuple[int, int]) -> np.ndarray:
    mask = np.zeros(shape, dtype=np.uint8)
    for line in lines:
        if line["class"] != class_name:
            continue
        points = np.round(np.asarray(line["points"], dtype=np.float32)).astype(np.int32)
        cv2.polylines(mask, [points.reshape(-1, 1, 2)], False, 1, 1, cv2.LINE_8)
    return cv2.distanceTransform((mask == 0).astype(np.uint8), cv2.DIST_L2, 5)


def baseline_relationship(candidate: dict, baseline_lines: list[dict]) -> dict:
    path = np.asarray(candidate["points"], dtype=np.float32)
    best = {
        "nearestBaselineId": None,
        "minimumBaselineDistancePx": float("inf"),
        "medianBaselineDistancePx": float("inf"),
        "endpointDistancePx": float("inf"),
    }
    for line in baseline_lines:
        if line["class"] != candidate["class"]:
            continue
        baseline_path = np.asarray(line["points"], dtype=np.float32)
        distances = np.linalg.norm(path[:, None, :] - baseline_path[None, :, :], axis=2)
        endpoint_distance = min(
            float(np.linalg.norm(path[0] - baseline_path[0])),
            float(np.linalg.norm(path[0] - baseline_path[-1])),
            float(np.linalg.norm(path[-1] - baseline_path[0])),
            float(np.linalg.norm(path[-1] - baseline_path[-1])),
        )
        current = float(distances.min())
        if current < best["minimumBaselineDistancePx"]:
            best = {
                "nearestBaselineId": line["id"],
                "minimumBaselineDistancePx": current,
                "medianBaselineDistancePx": float(np.median(distances.min(axis=1))),
                "endpointDistancePx": endpoint_distance,
            }
    if best["nearestBaselineId"] is None:
        return {
            "nearestBaselineId": None,
            "minimumBaselineDistancePx": None,
            "medianBaselineDistancePx": None,
            "endpointDistancePx": None,
        }
    return best


def principal_axis(points: np.ndarray) -> np.ndarray:
    centered = points - points.mean(axis=0, keepdims=True)
    covariance = centered.T @ centered / max(len(points) - 1, 1)
    _, eigenvectors = np.linalg.eigh(covariance)
    axis = eigenvectors[:, -1].astype(np.float32)
    dominant = 0 if abs(float(axis[0])) >= abs(float(axis[1])) else 1
    if axis[dominant] < 0:
        axis *= -1.0
    return axis


def line_geometry(line: dict) -> dict:
    points = np.asarray(line["points"], dtype=np.float32)
    axis = principal_axis(points)
    projection = points @ axis
    return {
        "points": points,
        "axis": axis,
        "centroid": points.mean(axis=0),
        "xMin": float(points[:, 0].min()),
        "xMax": float(points[:, 0].max()),
        "yMin": float(points[:, 1].min()),
        "yMax": float(points[:, 1].max()),
        "projectionMin": float(projection.min()),
        "projectionMax": float(projection.max()),
    }


def interval_overlap_fraction(
    left_minimum: float,
    left_maximum: float,
    right_minimum: float,
    right_maximum: float,
) -> float:
    overlap = max(0.0, min(left_maximum, right_maximum) - max(left_minimum, right_minimum))
    shorter = max(1e-6, min(left_maximum - left_minimum, right_maximum - right_minimum))
    return overlap / shorter


def axis_angle_degrees(left_axis: np.ndarray, right_axis: np.ndarray) -> float:
    cosine = float(np.clip(abs(np.dot(left_axis, right_axis)), 0.0, 1.0))
    return math.degrees(math.acos(cosine))


def fragment_relationship(left: dict, right: dict, face_width: float) -> tuple[bool, float]:
    if left["class"] != right["class"]:
        return False, float("inf")
    left_geometry = line_geometry(left)
    right_geometry = line_geometry(right)
    if axis_angle_degrees(left_geometry["axis"], right_geometry["axis"]) > 20.0:
        return False, float("inf")

    axis = left_geometry["axis"]
    if np.dot(axis, right_geometry["axis"]) < 0:
        axis = -axis
    normal = np.asarray([-axis[1], axis[0]], dtype=np.float32)
    perpendicular_offset = abs(
        float(np.dot(right_geometry["centroid"] - left_geometry["centroid"], normal)),
    )
    if perpendicular_offset > 0.014 * face_width:
        return False, float("inf")

    left_projection = left_geometry["points"] @ axis
    right_projection = right_geometry["points"] @ axis
    overlap = interval_overlap_fraction(
        float(left_projection.min()),
        float(left_projection.max()),
        float(right_projection.min()),
        float(right_projection.max()),
    )
    if overlap > 0.18:
        return False, float("inf")

    endpoint_distances = np.linalg.norm(
        left_geometry["points"][[0, -1], None, :] - right_geometry["points"][None, [0, -1], :],
        axis=2,
    )
    gap = float(endpoint_distances.min())
    maximum_gap = {
        "forehead": 0.050,
        "glabellar": 0.032,
        "nasal_dorsum": 0.040,
        "crow_feet": 0.080,
    }[left["class"]] * face_width
    return gap <= maximum_gap, gap


def joined_paths(left: np.ndarray, right: np.ndarray) -> np.ndarray:
    endpoint_pairs = [
        (float(np.linalg.norm(left[-1] - right[0])), False, False),
        (float(np.linalg.norm(left[-1] - right[-1])), False, True),
        (float(np.linalg.norm(left[0] - right[0])), True, False),
        (float(np.linalg.norm(left[0] - right[-1])), True, True),
    ]
    gap, reverse_left, reverse_right = min(endpoint_pairs, key=lambda item: item[0])
    if reverse_left:
        left = left[::-1]
    if reverse_right:
        right = right[::-1]
    bridge_count = max(0, int(round(gap)) - 1)
    bridge = np.empty((0, 2), dtype=np.float32)
    if bridge_count:
        bridge = np.linspace(left[-1], right[0], bridge_count + 2, dtype=np.float32)[1:-1]
    joined = np.vstack([left, bridge, right])
    smoothed = fine.smooth_path(joined)
    smoothed[0] = joined[0]
    smoothed[-1] = joined[-1]
    return smoothed


def merge_candidate_pair(left: dict, right: dict) -> dict:
    left_points = np.asarray(left["points"], dtype=np.float32)
    right_points = np.asarray(right["points"], dtype=np.float32)
    combined = joined_paths(left_points, right_points)
    left_weight = max(float(left["lengthPx"]), 1.0)
    right_weight = max(float(right["lengthPx"]), 1.0)
    total_weight = left_weight + right_weight
    merged = dict(left if left_weight >= right_weight else right)
    weighted_fields = (
        "confidence",
        "meanPairedEdge",
        "meanPairBalance",
        "meanScaleAgreement",
        "meanWidthPx",
        "meanRidgeSupport",
        "meanFrangiSupport",
        "meanOrientationSupport",
        "meanModelSupport",
        "medianSemanticDistancePx",
        "semanticNear6Fraction",
        "semanticNear10Fraction",
        "nearBaselineFraction",
    )
    for field in weighted_fields:
        merged[field] = round(
            (
                left_weight * float(left.get(field, 0.0))
                + right_weight * float(right.get(field, 0.0))
            )
            / total_weight,
            6,
        )
    fragment_ids = []
    for candidate in (left, right):
        fragment_ids.extend(candidate.get("mergedFragmentIds", [candidate["id"]]))
    merged["id"] = ""
    merged["lengthPx"] = round(fine.path_length(combined), 3)
    centered = combined - combined.mean(axis=0, keepdims=True)
    covariance = centered.T @ centered / max(len(combined) - 1, 1)
    eigenvalues = np.linalg.eigvalsh(covariance)
    chord = float(np.linalg.norm(combined[-1] - combined[0]))
    merged["chordRatio"] = round(chord / max(float(merged["lengthPx"]), 1e-6), 6)
    merged["elongation"] = round(
        float((eigenvalues[-1] + 1e-6) / (eigenvalues[0] + 1e-6)),
        6,
    )
    merged["medianY"] = round(float(np.median(combined[:, 1])), 6)
    merged["source"] = "multi_scale_opposite_polarity_paired_edges_merged_fragments"
    merged["mergedFragmentIds"] = sorted(set(fragment_ids))
    merged["points"] = [[round(float(x), 3), round(float(y), 3)] for x, y in combined]
    return merged


def merge_candidate_fragments(candidates: list[dict], face_width: float) -> list[dict]:
    merged = [dict(candidate) for candidate in candidates]
    while True:
        best_pair: tuple[int, int] | None = None
        best_gap = float("inf")
        for left_index, left in enumerate(merged):
            for right_index in range(left_index + 1, len(merged)):
                related, gap = fragment_relationship(left, merged[right_index], face_width)
                if related and gap < best_gap:
                    best_pair = (left_index, right_index)
                    best_gap = gap
        if best_pair is None:
            break
        left_index, right_index = best_pair
        combined = merge_candidate_pair(merged[left_index], merged[right_index])
        merged = [
            candidate
            for index, candidate in enumerate(merged)
            if index not in {left_index, right_index}
        ]
        merged.append(combined)
    merged.sort(key=lambda line: (fine.CLASS_ORDER.index(line["class"]), -line["confidence"]))
    for index, line in enumerate(merged, start=1):
        line["id"] = f"paired-edge-merged-{index:03d}"
    return merged


def scaled_odd_kernel(size: tuple[int, int], face_width: float) -> tuple[int, int]:
    scale = face_width / 680.0

    def scaled(value: int) -> int:
        output = max(3, int(round(value * scale)))
        return output if output % 2 else output + 1

    return scaled(size[0]), scaled(size[1])


def bundle_pair_relationship(left: dict, right: dict, anatomy: dict) -> tuple[bool, str]:
    class_name = left["class"]
    if class_name != right["class"]:
        return False, "different_class"
    face_width = float(anatomy["faceWidthPx"])
    center_x = float(anatomy["centerX"])
    left_geometry = line_geometry(left)
    right_geometry = line_geometry(right)
    angle = axis_angle_degrees(left_geometry["axis"], right_geometry["axis"])

    if class_name == "forehead":
        left_span = left_geometry["xMax"] - left_geometry["xMin"]
        right_span = right_geometry["xMax"] - right_geometry["xMin"]
        spacing = abs(float(left_geometry["centroid"][1] - right_geometry["centroid"][1]))
        overlap = interval_overlap_fraction(
            left_geometry["xMin"],
            left_geometry["xMax"],
            right_geometry["xMin"],
            right_geometry["xMax"],
        )
        valid = (
            angle <= 12.0
            and min(left_span, right_span) >= 0.10 * face_width
            and 0.020 * face_width <= spacing <= 0.085 * face_width
            and overlap >= 0.45
        )
        return valid, "parallel_forehead_bundle"

    if class_name == "glabellar":
        left_span = left_geometry["yMax"] - left_geometry["yMin"]
        right_span = right_geometry["yMax"] - right_geometry["yMin"]
        spacing = abs(float(left_geometry["centroid"][0] - right_geometry["centroid"][0]))
        overlap = interval_overlap_fraction(
            left_geometry["yMin"],
            left_geometry["yMax"],
            right_geometry["yMin"],
            right_geometry["yMax"],
        )
        midpoint_x = 0.5 * float(left_geometry["centroid"][0] + right_geometry["centroid"][0])
        valid = (
            angle <= 18.0
            and min(left_span, right_span) >= 0.070 * face_width
            and 0.025 * face_width <= spacing <= 0.090 * face_width
            and overlap >= 0.50
            and abs(midpoint_x - center_x) <= 0.028 * face_width
        )
        return valid, "paired_vertical_glabellar_bundle"

    if class_name == "nasal_dorsum":
        left_span = left_geometry["xMax"] - left_geometry["xMin"]
        right_span = right_geometry["xMax"] - right_geometry["xMin"]
        spacing = abs(float(left_geometry["centroid"][1] - right_geometry["centroid"][1]))
        overlap = interval_overlap_fraction(
            left_geometry["xMin"],
            left_geometry["xMax"],
            right_geometry["xMin"],
            right_geometry["xMax"],
        )
        centered = max(
            abs(float(left_geometry["centroid"][0]) - center_x),
            abs(float(right_geometry["centroid"][0]) - center_x),
        )
        valid = (
            angle <= 18.0
            and min(left_span, right_span) >= 0.060 * face_width
            and 0.008 * face_width <= spacing <= 0.042 * face_width
            and overlap >= 0.50
            and centered <= 0.045 * face_width
        )
        return valid, "stacked_nasal_root_bundle"

    left_side = -1 if float(left_geometry["centroid"][0]) < center_x else 1
    right_side = -1 if float(right_geometry["centroid"][0]) < center_x else 1
    if left_side != right_side:
        return False, "opposite_canthus_sides"
    canthus = np.asarray(
        min(
            anatomy["outerCanthi"],
            key=lambda point: abs(float(point[0]) - float(left_geometry["centroid"][0])),
        ),
        dtype=np.float32,
    )

    def radial_geometry(geometry: dict) -> tuple[np.ndarray, np.ndarray, float, float]:
        endpoints = geometry["points"][[0, -1]]
        distances = np.linalg.norm(endpoints - canthus[None, :], axis=1)
        inner_index = int(np.argmin(distances))
        inner = endpoints[inner_index]
        outer = endpoints[1 - inner_index]
        vector = outer - inner
        length = float(np.linalg.norm(vector))
        outward = float(
            np.dot(vector, outer - canthus)
            / max(length * float(np.linalg.norm(outer - canthus)), 1e-6),
        )
        return inner, vector / max(length, 1e-6), float(distances[inner_index]), outward

    left_inner, left_vector, left_inner_distance, left_outward = radial_geometry(left_geometry)
    right_inner, right_vector, right_inner_distance, right_outward = radial_geometry(right_geometry)
    ray_angle = axis_angle_degrees(left_vector, right_vector)
    inner_separation = float(np.linalg.norm(left_inner - right_inner))
    minimum_length = 0.042 * face_width
    valid = (
        min(float(left["lengthPx"]), float(right["lengthPx"])) >= minimum_length
        and max(left_inner_distance, right_inner_distance) <= 0.065 * face_width
        and inner_separation <= 0.065 * face_width
        and min(left_outward, right_outward) >= 0.70
        and 4.0 <= ray_angle <= 40.0
    )
    return valid, "same_canthus_radial_fan"


def sampled_line_evidence(
    line: dict,
    pair_score: np.ndarray,
    pair_balance: np.ndarray,
    scale_agreement: np.ndarray,
    ridge: np.ndarray,
    frangi: np.ndarray,
    orientation: np.ndarray,
) -> dict:
    xy = np.round(np.asarray(line["points"], dtype=np.float32)).astype(np.int32)
    xy[:, 0] = np.clip(xy[:, 0], 0, pair_score.shape[1] - 1)
    xy[:, 1] = np.clip(xy[:, 1], 0, pair_score.shape[0] - 1)
    y, x = xy[:, 1], xy[:, 0]
    return {
        "meanPairedEdge": round(float(pair_score[y, x].mean()), 6),
        "meanPairBalance": round(float(pair_balance[y, x].mean()), 6),
        "meanScaleAgreement": round(float(scale_agreement[y, x].mean()), 6),
        "meanRidgeSupport": round(float(ridge[y, x].mean()), 6),
        "meanFrangiSupport": round(float(frangi[y, x].mean()), 6),
        "meanOrientationSupport": round(float(orientation[y, x].mean()), 6),
    }


def assign_glabellar_replacement_support(
    candidates: list[dict],
    baseline_lines: list[dict],
    anatomy: dict,
    baseline_evidence: dict[str, dict],
) -> list[dict]:
    output = [dict(candidate) for candidate in candidates]
    face_width = float(anatomy["faceWidthPx"])
    center_x = float(anatomy["centerX"])
    primaries = [
        line
        for line in baseline_lines
        if line["class"] == "glabellar" and "official_unet" in str(line.get("source", ""))
    ]
    companions = [
        line
        for line in baseline_lines
        if line["class"] == "glabellar"
        and "parallel_dark_ridge_companion" in str(line.get("source", ""))
    ]
    for candidate in output:
        if candidate["class"] != "glabellar":
            continue
        candidate["glabellarReplacementSupported"] = False
        candidate["replacesBaselineId"] = None
        candidate["glabellarReplacementEvidence"] = None
        strong_paired_evidence = (
            float(candidate.get("meanPairedEdge", 0.0)) >= 0.40
            and float(candidate.get("meanPairBalance", 0.0)) >= 0.48
            and float(candidate.get("meanScaleAgreement", 0.0)) >= 0.30
            and float(candidate.get("meanRidgeSupport", 0.0)) >= 0.35
            and float(candidate.get("meanOrientationSupport", 0.0)) >= 0.80
            and float(candidate.get("chordRatio", 0.0)) >= 0.82
            and float(candidate.get("elongation", 0.0)) >= 8.0
        )
        strong_frangi_evidence = (
            float(candidate.get("meanFrangiSupport", 0.0)) >= 0.42
            and float(candidate.get("meanRidgeSupport", 0.0)) >= 0.28
            and float(candidate.get("meanOrientationSupport", 0.0)) >= 0.75
            and float(candidate.get("chordRatio", 0.0)) >= 0.80
            and float(candidate.get("elongation", 0.0)) >= 8.0
        )
        candidate_geometry = line_geometry(candidate)
        if (
            not (strong_paired_evidence or strong_frangi_evidence)
            or candidate_geometry["yMax"] - candidate_geometry["yMin"] < 0.050 * face_width
        ):
            continue

        for primary in primaries:
            primary_geometry = line_geometry(primary)
            spacing = abs(
                float(candidate_geometry["centroid"][0] - primary_geometry["centroid"][0]),
            )
            overlap = interval_overlap_fraction(
                candidate_geometry["yMin"],
                candidate_geometry["yMax"],
                primary_geometry["yMin"],
                primary_geometry["yMax"],
            )
            angle = axis_angle_degrees(candidate_geometry["axis"], primary_geometry["axis"])
            midpoint_x = 0.5 * float(
                candidate_geometry["centroid"][0] + primary_geometry["centroid"][0],
            )
            opposite_sides = (
                float(candidate_geometry["centroid"][0] - center_x)
                * float(primary_geometry["centroid"][0] - center_x)
                <= 0.0
            )
            if not (
                0.065 * face_width <= spacing <= 0.115 * face_width
                and overlap >= 0.55
                and angle <= 24.0
                and abs(midpoint_x - center_x) <= 0.030 * face_width
                and opposite_sides
            ):
                continue

            for companion in companions:
                companion_metrics = baseline_evidence.get(str(companion["id"]))
                if companion_metrics is None:
                    continue
                companion_x = float(line_geometry(companion)["centroid"][0])
                x_min = min(
                    float(candidate_geometry["centroid"][0]),
                    float(primary_geometry["centroid"][0]),
                )
                x_max = max(
                    float(candidate_geometry["centroid"][0]),
                    float(primary_geometry["centroid"][0]),
                )
                candidate_companion_spacing = abs(
                    float(candidate_geometry["centroid"][0]) - companion_x,
                )
                paired_advantage = (
                    candidate["meanPairedEdge"] >= companion_metrics["meanPairedEdge"] + 0.15
                    and candidate["meanPairBalance"]
                    >= companion_metrics["meanPairBalance"] + 0.18
                    and candidate["meanRidgeSupport"]
                    >= companion_metrics["meanRidgeSupport"] + 0.10
                    and candidate["meanOrientationSupport"]
                    >= companion_metrics["meanOrientationSupport"] + 0.20
                )
                frangi_advantage = (
                    candidate.get("meanFrangiSupport", 0.0) >= 0.42
                    and candidate.get("meanFrangiSupport", 0.0)
                    >= companion_metrics.get("meanFrangiSupport", 0.0) + 0.12
                    and candidate["meanRidgeSupport"] >= 0.28
                    and candidate["meanOrientationSupport"] >= 0.75
                )
                if not (
                    x_min < companion_x < x_max
                    and candidate_companion_spacing >= 0.025 * face_width
                    and (paired_advantage or frangi_advantage)
                ):
                    continue
                candidate["glabellarReplacementSupported"] = True
                candidate["replacesBaselineId"] = str(companion["id"])
                candidate["glabellarReplacementEvidence"] = {
                    "reason": (
                        "strong_frangi_replaces_weak_dark_ridge_companion"
                        if frangi_advantage and not paired_advantage
                        else "strong_pair_replaces_weak_dark_ridge_companion"
                    ),
                    "semanticPrimaryId": str(primary["id"]),
                    "replacedCompanionId": str(companion["id"]),
                    "pairSpacingPx": round(spacing, 6),
                    "verticalOverlapFraction": round(overlap, 6),
                    "axisAngleDegrees": round(angle, 6),
                    "pairMidpointOffsetPx": round(abs(midpoint_x - center_x), 6),
                    "replacedCompanionEvidence": companion_metrics,
                }
                break
            if candidate["glabellarReplacementSupported"]:
                break
    return output


def extend_replacement_additions(
    additions: list[dict],
    fragments: list[dict],
    face_width: float,
) -> list[dict]:
    output = []
    for addition in additions:
        current = dict(addition)
        attached_ids: list[str] = []
        if current.get("glabellarReplacementSupported", False):
            remaining = [dict(fragment) for fragment in fragments]
            while remaining and len(attached_ids) < 3:
                relationships = []
                for index, fragment in enumerate(remaining):
                    related, gap = fragment_relationship(current, fragment, face_width)
                    if related:
                        relationships.append((gap, index))
                if not relationships:
                    break
                _, fragment_index = min(relationships)
                fragment = remaining.pop(fragment_index)
                attached_ids.append(str(fragment["id"]))
                preserved = {
                    key: current.get(key)
                    for key in (
                        "decision",
                        "decisionReason",
                        "glabellarReplacementSupported",
                        "replacesBaselineId",
                        "glabellarReplacementEvidence",
                    )
                }
                current = merge_candidate_pair(current, fragment)
                current.update(preserved)
            if attached_ids:
                current["source"] = (
                    "strong_glabellar_replacement_with_weak_collinear_endpoint_fragments"
                )
                current["extensionFragmentIds"] = attached_ids
        output.append(current)
    return output


def assign_bundle_support(
    candidates: list[dict],
    baseline_lines: list[dict],
    anatomy: dict,
) -> list[dict]:
    output = [dict(candidate) for candidate in candidates]
    for line in output:
        line["bundleSupported"] = False
        line["bundleId"] = None
        line["bundleSize"] = 0
        line["bundleCompanionIds"] = []
        line["bundleReason"] = None

    class_baselines = {
        class_name: [line for line in baseline_lines if line["class"] == class_name]
        for class_name in fine.CLASS_ORDER
    }
    bundle_index = 0
    for class_name in fine.CLASS_ORDER:
        candidate_indices = [
            index for index, line in enumerate(output) if line["class"] == class_name
        ]
        nodes: list[tuple[str, int | dict]] = [("candidate", index) for index in candidate_indices]
        if class_name == "glabellar":
            nodes.extend(("baseline", line) for line in class_baselines[class_name])
        adjacency = [set() for _ in nodes]
        edge_reasons: dict[tuple[int, int], str] = {}
        for left_index, left_node in enumerate(nodes):
            left_line = output[left_node[1]] if left_node[0] == "candidate" else left_node[1]
            for right_index in range(left_index + 1, len(nodes)):
                right_node = nodes[right_index]
                right_line = output[right_node[1]] if right_node[0] == "candidate" else right_node[1]
                related, reason = bundle_pair_relationship(left_line, right_line, anatomy)
                if related:
                    adjacency[left_index].add(right_index)
                    adjacency[right_index].add(left_index)
                    edge_reasons[(left_index, right_index)] = reason

        visited: set[int] = set()
        for start in range(len(nodes)):
            if start in visited or not adjacency[start]:
                continue
            stack = [start]
            component: set[int] = set()
            while stack:
                current = stack.pop()
                if current in component:
                    continue
                component.add(current)
                stack.extend(adjacency[current] - component)
            visited |= component
            candidate_nodes = [node for node in component if nodes[node][0] == "candidate"]
            if not candidate_nodes:
                continue
            bundle_index += 1
            bundle_id = f"{class_name}-bundle-{bundle_index:02d}"
            reasons = {
                reason
                for (left_node, right_node), reason in edge_reasons.items()
                if left_node in component and right_node in component
            }
            for node in candidate_nodes:
                output_index = int(nodes[node][1])
                companions = []
                for companion in sorted(adjacency[node]):
                    companion_type, companion_value = nodes[companion]
                    if companion_type == "candidate":
                        companions.append(output[int(companion_value)]["id"])
                    else:
                        companions.append(str(companion_value["id"]))
                output[output_index]["bundleSupported"] = True
                output[output_index]["bundleId"] = bundle_id
                output[output_index]["bundleSize"] = len(component)
                output[output_index]["bundleCompanionIds"] = companions
                output[output_index]["bundleReason"] = "+".join(sorted(reasons))
    return output


def candidate_decision(
    line: dict,
    baseline_lines: list[dict],
    face_width: float,
    nose_root_y: float,
) -> tuple[str, str]:
    class_name = line["class"]
    baseline_class_count = sum(item["class"] == class_name for item in baseline_lines)
    if class_name == "nasal_dorsum" and line.get(
        "source"
    ) == "nasal_dorsum_horizontal_dark_ridge_trace":
        in_root_band = (
            nose_root_y - 0.05 * face_width
            <= line["medianY"]
            <= nose_root_y + 0.04 * face_width
        )
        if (
            in_root_band
            and line.get("meanNasalTraceSupport", 0.0) >= 0.30
            and line.get("nasalTraceCoverage", 0.0) >= 0.68
            and line.get("chordRatio", 0.0) >= 0.90
            and line.get("lengthPx", 0.0) >= 0.075 * face_width
        ):
            return "addition", "nasal_horizontal_dark_ridge_trace_replacement"
        return "rejected", "weak_or_misaligned_nasal_horizontal_trace"
    if line["nearBaselineFraction"] >= 0.35:
        return "rejected", "mostly_already_represented_by_baseline"
    endpoint_limit = {
        "forehead": 0.025,
        "glabellar": 0.018,
        "nasal_dorsum": 0.018,
        "crow_feet": 0.025,
    }[class_name] * face_width
    if (
        baseline_class_count
        and line["endpointDistancePx"] <= endpoint_limit
        and line["minimumBaselineDistancePx"] <= 6.0
        and line["meanOrientationSupport"] >= 0.48
    ):
        return "extension", "continuous_baseline_endpoint"

    median_semantic_distance = line["medianSemanticDistancePx"]
    near_10 = line["semanticNear10Fraction"]
    if class_name == "glabellar":
        if baseline_class_count >= 2:
            if line.get("glabellarReplacementSupported", False):
                return "addition", "strong_glabellar_replacement_candidate"
            if median_semantic_distance <= 6.0 and line["semanticNear6Fraction"] >= 0.50:
                return "addition", "strong_semantic_third_glabellar_line"
            return "rejected", "third_glabellar_line_without_semantic_support"
        if median_semantic_distance <= 10.0 and near_10 >= 0.50:
            return "addition", "semantic_glabellar_line"
        if line.get("bundleSupported", False):
            return "addition", "topology_supported_glabellar_pair"
        return "rejected", "glabellar_without_semantic_or_companion_support"
    if class_name == "nasal_dorsum":
        in_root_band = (
            nose_root_y - 0.03 * face_width
            <= line["medianY"]
            <= nose_root_y + 0.04 * face_width
        )
        if not in_root_band:
            return "rejected", "outside_nose_root_band"
        if median_semantic_distance <= 8.0 and near_10 >= 0.50:
            return "addition", "semantic_nasal_root_line"
        if line.get("bundleSupported", False):
            return "addition", "topology_supported_nasal_bundle"
        return "rejected", "nasal_line_without_semantic_support"
    if class_name == "forehead":
        if median_semantic_distance <= 8.0 and near_10 >= 0.55:
            return "addition", "semantic_forehead_line"
        if line.get("bundleSupported", False):
            return "addition", "topology_supported_forehead_bundle"
        return "rejected", "forehead_without_semantic_support"
    if median_semantic_distance <= 10.0 and near_10 >= 0.50:
        return "addition", "semantic_radial_crow_feet_line"
    if line.get("bundleSupported", False):
        return "addition", "topology_supported_crow_feet_fan"
    return "rejected", "crow_feet_without_semantic_support"


def merge_extension(baseline_line: dict, extension: dict) -> dict:
    baseline_path = np.asarray(baseline_line["points"], dtype=np.float32)
    extension_path = np.asarray(extension["points"], dtype=np.float32)
    endpoint_pairs = [
        (float(np.linalg.norm(baseline_path[-1] - extension_path[0])), False, False),
        (float(np.linalg.norm(baseline_path[-1] - extension_path[-1])), False, True),
        (float(np.linalg.norm(baseline_path[0] - extension_path[0])), True, False),
        (float(np.linalg.norm(baseline_path[0] - extension_path[-1])), True, True),
    ]
    gap, reverse_baseline, reverse_extension = min(endpoint_pairs, key=lambda item: item[0])
    if reverse_baseline:
        baseline_path = baseline_path[::-1]
    if reverse_extension:
        extension_path = extension_path[::-1]
    bridge_count = max(0, int(round(gap)) - 1)
    bridge = np.empty((0, 2), dtype=np.float32)
    if bridge_count:
        bridge = np.linspace(
            baseline_path[-1],
            extension_path[0],
            bridge_count + 2,
            dtype=np.float32,
        )[1:-1]
    combined = fine.smooth_path(np.vstack([baseline_path, bridge, extension_path]))
    original_length = fine.path_length(np.asarray(baseline_line["points"], dtype=np.float32))
    merged = dict(baseline_line)
    merged["lengthPx"] = round(fine.path_length(combined), 3)
    merged["source"] = f'{baseline_line.get("source", "baseline")}_paired_edge_extended'
    merged["pairedEdgeExtensionId"] = extension["id"]
    merged["pairedEdgeAddedLengthPx"] = round(max(0.0, merged["lengthPx"] - original_length), 3)
    merged["points"] = [[round(float(x), 3), round(float(y), 3)] for x, y in combined]
    return merged


def draw_additions(image: np.ndarray, lines: list[dict], thickness: int) -> np.ndarray:
    output = image.copy()
    for line in lines:
        points = np.round(np.asarray(line["points"], dtype=np.float32)).astype(np.int32)
        line_type = cv2.LINE_8 if thickness == 1 else cv2.LINE_AA
        cv2.polylines(
            output,
            [points.reshape(-1, 1, 2)],
            False,
            (255, 255, 255),
            thickness,
            line_type,
        )
    return output


def run(args: argparse.Namespace) -> None:
    if args.output.exists():
        raise FileExistsError(f"Refusing to overwrite existing output directory: {args.output}")
    args.output.mkdir(parents=True)
    debug = args.output / "debug"
    debug.mkdir()
    image = cv2.imread(str(args.input), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(args.input)
    height, width = image.shape[:2]
    source_sha256 = v1.sha256(args.input)
    if args.without_baseline:
        baseline_payload = None
        baseline_lines: list[dict] = []
    else:
        baseline_payload = json.loads(args.baseline.read_text(encoding="utf-8"))
        if baseline_payload["source"]["sha256"].upper() != source_sha256.upper():
            raise RuntimeError("Baseline and input image SHA-256 do not match")
        baseline_lines = baseline_payload["lines"]
    landmark_input = args.landmark_input
    if landmark_input is None and args.input.resolve() == DEFAULT_INPUT.resolve():
        landmark_input = DEFAULT_LANDMARKS
    landmarks = v1.load_landmarks(
        args.input,
        args.face_model,
        args.output,
        landmark_input,
    )
    regions, face_mask, anatomy = experiment_regions(landmarks, width, height)

    original_gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    correction = wrinkle_illumination.correct_illumination(
        image,
        face_mask,
        float(anatomy["faceWidthPx"]),
    )
    ridge_raw, tangent, _ = fine.dark_ridge_field(correction.corrected_gray)
    pair_raw, width_map, pair_balance, scale_agreement = paired_edge_center_field(
        correction.corrected_gray,
        tangent,
    )
    nasal_excluded = fine.exclusion_mask(landmarks, width, height).astype(bool)
    yy, xx = np.mgrid[:height, :width]
    nasal_trace_roi = (
        (yy >= float(anatomy["noseRootY"]) - 0.05 * float(anatomy["faceWidthPx"]))
        & (yy <= float(anatomy["noseRootY"]) + 0.05 * float(anatomy["faceWidthPx"]))
        & (
            np.abs(xx - float(anatomy["centerX"]))
            <= 0.09 * float(anatomy["faceWidthPx"])
        )
        & (face_mask > 0)
        & ~nasal_excluded
    ).astype(np.uint8)
    nasal_traces, nasal_trace_response, _ = (
        wrinkle_nasal_dorsum.trace_horizontal_lines(
            correction.corrected_gray,
            nasal_trace_roi,
            float(anatomy["faceWidthPx"]),
            maximum_lines=4,
        )
    )
    frangi_raw = wrinkle_frangi.dark_ridge_response(
        correction.corrected_gray,
        regions["glabellar"],
    )
    pair_before, _, _, _ = paired_edge_center_field(original_gray, tangent)
    texture = v1.hessian_texture(image)
    model_probability, checkpoint_metadata = v1.run_unet(image, texture, args.checkpoint)
    semantic_seed = model_probability >= 0.35
    if semantic_seed.any():
        semantic_distance = cv2.distanceTransform(
            (~semantic_seed).astype(np.uint8),
            cv2.DIST_L2,
            5,
        )
    else:
        semantic_distance = np.full((height, width), float(max(height, width)), dtype=np.float32)

    all_candidates = np.zeros((height, width), dtype=np.uint8)
    accepted_candidates: list[dict] = []
    weak_glabellar_fragments: list[dict] = []
    baseline_evidence: dict[str, dict] = {}
    response_union = np.zeros((height, width), dtype=np.float32)
    class_diagnostics = {}
    baseline_distance_by_class = {
        class_name: baseline_distance(baseline_lines, class_name, (height, width))
        for class_name in fine.CLASS_ORDER
    }
    for class_name in fine.CLASS_ORDER:
        region = regions[class_name]
        pair_score = fine.robust_unit(pair_raw, region)
        ridge = fine.robust_unit(ridge_raw, region)
        frangi = fine.robust_unit(frangi_raw, region)
        orientation = fine.orientation_support(class_name, tangent, anatomy, width, height)
        if class_name == "glabellar":
            for baseline_line in baseline_lines:
                if baseline_line["class"] != "glabellar":
                    continue
                baseline_evidence[str(baseline_line["id"])] = sampled_line_evidence(
                    baseline_line,
                    pair_score,
                    pair_balance,
                    scale_agreement,
                    ridge,
                    frangi,
                    orientation,
                )
        paired_score = (
            pair_score
            * (0.48 + 0.52 * orientation)
            * (0.72 + 0.28 * np.sqrt(ridge))
        )
        if class_name == "glabellar":
            frangi_score = (
                frangi
                * (0.30 + 0.70 * orientation)
                * (0.65 + 0.35 * np.sqrt(ridge))
            )
            score = np.maximum(paired_score, frangi_score)
        else:
            score = paired_score
        score *= region
        response_union = np.maximum(response_union, score)
        nms = fine.directional_nms(score, tangent, region)
        candidates = paired_hysteresis(class_name, score, nms, region)
        close_size = scaled_odd_kernel({
            "forehead": (23, 3),
            "glabellar": (3, 9),
            "nasal_dorsum": (11, 3),
            "crow_feet": (5, 5),
        }[class_name], float(anatomy["faceWidthPx"]))
        candidates = cv2.morphologyEx(
            candidates,
            cv2.MORPH_CLOSE,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, close_size),
        )
        candidates = v1.morphological_skeleton(candidates)
        all_candidates |= candidates
        count, labels, stats, _ = cv2.connectedComponentsWithStats(candidates, 8)
        rejection_counts: dict[str, int] = {}
        accepted_before = len(accepted_candidates)
        for component_id in range(1, count):
            minimum_component_area = max(
                3,
                int(round(5.0 * float(anatomy["faceWidthPx"]) / 680.0)),
            )
            if int(stats[component_id, cv2.CC_STAT_AREA]) < minimum_component_area:
                rejection_counts["tiny"] = rejection_counts.get("tiny", 0) + 1
                continue
            component = (labels == component_id).astype(np.uint8)
            path, length = fine.longest_path(component)
            path = fine.smooth_path(path)
            if len(path) < 2:
                rejection_counts["no_path"] = rejection_counts.get("no_path", 0) + 1
                continue
            metrics = paired_component_metrics(
                path,
                length,
                pair_score,
                pair_balance,
                scale_agreement,
                width_map,
                ridge,
                frangi,
                orientation,
                model_probability,
                semantic_distance,
            )
            accepted, reason = accept_paired_component(
                class_name,
                metrics,
                float(anatomy["faceWidthPx"]),
            )
            xy = np.round(path).astype(np.int32)
            distance = baseline_distance_by_class[class_name]
            near_baseline_fraction = float((distance[xy[:, 1], xy[:, 0]] <= 5.0).mean())
            if not accepted:
                rejection_counts[reason] = rejection_counts.get(reason, 0) + 1
                if class_name == "glabellar" and accept_glabellar_extension_fragment(
                    metrics,
                    float(anatomy["faceWidthPx"]),
                ):
                    weak_glabellar_fragments.append(component_line_record(
                        class_name,
                        path,
                        length,
                        metrics,
                        near_baseline_fraction,
                        reason,
                        source="weak_glabellar_endpoint_fragment",
                    ))
                continue
            source = (
                "frangi_hessian_glabellar_dark_ridge"
                if reason == "accepted_frangi_glabellar_dark_ridge"
                else "multi_scale_opposite_polarity_paired_edges"
            )
            accepted_candidates.append(component_line_record(
                class_name,
                path,
                length,
                metrics,
                near_baseline_fraction,
                reason,
                source=source,
            ))
        class_diagnostics[class_name] = {
            "candidatePixels": int(candidates.sum()),
            "acceptedBeforeBaselineDedup": len(accepted_candidates) - accepted_before,
            "rejectionCounts": rejection_counts,
        }

    raw_candidate_count = len(accepted_candidates)
    for index, line in enumerate(accepted_candidates, start=1):
        line["id"] = f"paired-edge-raw-{index:03d}"
    for index, line in enumerate(weak_glabellar_fragments, start=1):
        line["id"] = f"paired-edge-weak-glabellar-{index:03d}"

    accepted_candidates = merge_candidate_fragments(
        accepted_candidates,
        float(anatomy["faceWidthPx"]),
    )
    nasal_trace_candidates = [
        nasal_trace_line_record(
            trace,
            float(anatomy["faceWidthPx"]),
            baseline_distance_by_class["nasal_dorsum"],
        )
        for trace in nasal_traces[:3]
    ]
    nasal_trace_candidates = assign_nasal_trace_replacements(
        nasal_trace_candidates,
        baseline_lines,
        float(anatomy["faceWidthPx"]),
    )
    for index, line in enumerate(nasal_trace_candidates, start=1):
        line["id"] = f"nasal-trace-raw-{index:03d}"
    accepted_candidates.extend(nasal_trace_candidates)
    class_diagnostics["nasal_dorsum"]["nasalTraceCount"] = len(nasal_trace_candidates)
    class_diagnostics["nasal_dorsum"]["nasalTraceCoverage"] = [
        round(float(trace.coverage), 6) for trace in nasal_traces[:3]
    ]
    class_diagnostics["nasal_dorsum"]["nasalTraceMeanResponse"] = [
        round(float(trace.mean_response), 6) for trace in nasal_traces[:3]
    ]
    accepted_candidates = assign_bundle_support(
        accepted_candidates,
        baseline_lines,
        anatomy,
    )
    accepted_candidates = assign_glabellar_replacement_support(
        accepted_candidates,
        baseline_lines,
        anatomy,
        baseline_evidence,
    )
    for line in accepted_candidates:
        line.update(baseline_relationship(line, baseline_lines))
        decision, reason = candidate_decision(
            line,
            baseline_lines,
            float(anatomy["faceWidthPx"]),
            float(anatomy["noseRootY"]),
        )
        line["decision"] = decision
        line["decisionReason"] = reason

    additions: list[dict] = []
    for class_name in fine.CLASS_ORDER:
        current = [
            line
            for line in accepted_candidates
            if line["class"] == class_name and line["decision"] == "addition"
        ]
        current.sort(
            key=lambda line: (
                line.get("source") == "nasal_dorsum_horizontal_dark_ridge_trace",
                line["confidence"],
                line["lengthPx"],
            ),
            reverse=True,
        )
        additions.extend(current[: MAXIMUM_ADDITIONS[class_name]])
        decisions = [
            line["decisionReason"]
            for line in accepted_candidates
            if line["class"] == class_name
        ]
        class_diagnostics[class_name]["decisionCounts"] = {
            reason: decisions.count(reason) for reason in sorted(set(decisions))
        }
        class_diagnostics[class_name]["selectedIndependentAdditions"] = min(
            len(current),
            MAXIMUM_ADDITIONS[class_name],
        )
        class_diagnostics[class_name]["mergedCandidateCount"] = sum(
            line["class"] == class_name for line in accepted_candidates
        )
        class_diagnostics[class_name]["topologySupportedCount"] = sum(
            line["class"] == class_name and line.get("bundleSupported", False)
            for line in accepted_candidates
        )
    additions = extend_replacement_additions(
        additions,
        weak_glabellar_fragments,
        float(anatomy["faceWidthPx"]),
    )
    for index, line in enumerate(additions, start=1):
        line["id"] = f"paired-edge-addition-{index:03d}"

    extension_candidates = [
        line for line in accepted_candidates if line["decision"] == "extension"
    ]
    selected_extensions: list[dict] = []
    for baseline_id in sorted({line["nearestBaselineId"] for line in extension_candidates}):
        matching = [
            line for line in extension_candidates if line["nearestBaselineId"] == baseline_id
        ]
        selected_extensions.append(
            max(matching, key=lambda line: (line["confidence"], line["lengthPx"])),
        )
    replaced_baseline_ids = {
        str(line["replacesBaselineId"])
        for line in additions
        if line.get("replacesBaselineId") is not None
    }
    fused_baseline_lines = [
        dict(line) for line in baseline_lines if str(line["id"]) not in replaced_baseline_ids
    ]
    for extension in selected_extensions:
        for line_index, baseline_line in enumerate(fused_baseline_lines):
            if baseline_line["id"] == extension["nearestBaselineId"]:
                fused_baseline_lines[line_index] = merge_extension(baseline_line, extension)
                break
    fused_lines = fused_baseline_lines + additions

    baseline_image = fine.draw_paths(image, baseline_lines, 1)
    review_image = draw_additions(image, accepted_candidates, 1)
    addition_image = draw_additions(image, additions, 2)
    extension_image = draw_additions(image, selected_extensions, 2)
    fused_image = fine.draw_paths(image, fused_lines, 2)
    cv2.imwrite(str(args.output / "FINAL_paired_edge_fused_detection.png"), fused_image)
    cv2.imwrite(
        str(args.output / "FINAL_four_region_wrinkles.png"),
        fine.class_closeups(fused_image, regions),
    )
    cv2.imwrite(str(debug / "00_input.png"), image)
    cv2.imwrite(
        str(debug / "01_estimated_illumination.png"),
        wrinkle_illumination.grayscale_debug_image(correction.illumination),
    )
    cv2.imwrite(str(debug / "02_corrected_input.png"), correction.corrected_bgr)
    cv2.imwrite(
        str(debug / "03_applied_gain.png"),
        wrinkle_illumination.gain_debug_image(correction.gain),
    )
    cv2.imwrite(
        str(debug / "04_paired_edge_response_before.png"),
        fine.response_heatmap(image, pair_before),
    )
    cv2.imwrite(
        str(debug / "05_paired_edge_response_after.png"),
        fine.response_heatmap(correction.corrected_bgr, pair_raw),
    )
    cv2.imwrite(str(debug / "06_fused_response.png"), fine.response_heatmap(image, response_union))
    cv2.imwrite(
        str(debug / "06a_frangi_glabellar_response.png"),
        fine.response_heatmap(image, fine.robust_unit(frangi_raw, regions["glabellar"])),
    )
    cv2.imwrite(
        str(debug / "06b_nasal_dorsum_horizontal_trace_response.png"),
        fine.response_heatmap(image, nasal_trace_response * nasal_trace_roi),
    )
    cv2.imwrite(
        str(debug / "06c_nasal_dorsum_horizontal_trace_candidates.png"),
        draw_additions(image, nasal_trace_candidates, 2),
    )
    cv2.imwrite(
        str(debug / "07_raw_paired_edge_centerlines.png"),
        v1.draw_skeleton(image, all_candidates, (255, 180, 0), 1),
    )
    cv2.imwrite(str(debug / "08_v6_baseline.png"), baseline_image)
    cv2.imwrite(str(debug / "09_all_screened_candidates_white.png"), review_image)
    cv2.imwrite(str(debug / "10_accepted_additions_white.png"), addition_image)
    cv2.imwrite(str(debug / "11_endpoint_extensions_white.png"), extension_image)
    comparison = fine.montage([
        ("Input", image),
        ("Paired-edge response", fine.response_heatmap(image, response_union)),
        ("Baseline", baseline_image),
        ("Semantic or topology additions", addition_image),
        ("Endpoint extensions", extension_image),
        ("Fused result", fused_image),
    ])
    cv2.imwrite(str(debug / "12_baseline_vs_paired_edge_fusion.png"), comparison)

    addition_counts = {
        name: sum(line["class"] == name for line in additions) for name in fine.CLASS_ORDER
    }
    extension_counts = {
        name: sum(line["class"] == name for line in selected_extensions)
        for name in fine.CLASS_ORDER
    }
    source = (
        baseline_payload["source"]
        if baseline_payload is not None
        else {
            "path": str(args.input),
            "sha256": source_sha256,
            "width": width,
            "height": height,
            "embedded": False,
        }
    )
    edge_added_length = sum(
        float(line.get("pairedEdgeAddedLengthPx", 0.0)) for line in fused_baseline_lines
    )
    payload = {
        "schemaVersion": "langerface.wrinkle-paired-edge.v10-forehead-recall-experiment",
        "validated": False,
        "trainingPerformed": False,
        "rstlUsed": False,
        "source": source,
        "baseline": None if args.without_baseline else str(args.baseline),
        "method": {
            "finalRendering": {
                "lineThicknessPx": 2,
                "lineType": "OpenCV LINE_AA",
            },
            "frangiFusion": {
                "trainingFree": True,
                "region": "glabellar",
                "scalesPx": list(wrinkle_frangi.DEFAULT_SCALES),
                "candidateFusion": "maximum_of_paired_edge_and_frangi_dark_ridge_branches",
                "replacementGate": (
                    "frangi_support_at_least_0.42_and_at_least_0.12_above_weak_companion"
                ),
            },
            "nasalDorsumTrace": {
                "trainingFree": True,
                "response": "multi_scale_positive_Iyy_dark_ridge_with_Ixx_Ixy_orientation_suppression",
                "scalesPx": list(wrinkle_nasal_dorsum.SCALES),
                "pathModel": (
                    "columnwise_dynamic_programming_with_three_pixel_row_step_and_"
                    "smoothness_penalty"
                ),
                "roiVerticalBand": "noseRootY_plus_or_minus_0.05_times_face_width",
                "minimumCoverage": 0.68,
                "minimumMeanResponse": 0.30,
                "replacementPolicy": "vertical_order_pairing_to_up_to_three_existing_nasal_baselines",
            },
            "illuminationCorrection": {
                "trainingFree": True,
                "colorSpace": "Lab luminance only",
                "fieldEstimator": "face-masked normalized Gaussian smoothing",
                "fieldScale": "0.065 times measured face width, clipped to 4-96 px",
                "gainBounds": [0.67, 1.50],
                "diagnostics": correction.diagnostics,
            },
            "halfWidthsPx": list(HALF_WIDTHS),
            "edgeCondition": "opposite_normal_gradient_polarity_with_darker_center",
            "centerline": "paired_edge_midpoint_directional_nms_and_geodesic_path",
            "scaleConsistency": "fraction_of_half_width_responses_within_55_percent_of_best",
            "resolutionNormalization": (
                "component_length_area_and_morphology_kernel_scaled_by_mediapipe_face_width"
            ),
            "semanticGate": "general_ffhq_unet_probability_0.35_distance_transform",
            "fragmentMerging": "collinear_disjoint_fragments_with_class_specific_endpoint_gaps",
            "bundleTopology": {
                "forehead": "parallel_horizontal_bundle",
                "glabellar": "paired_vertical_lines_centered_between_brows",
                "nasal_dorsum": "stacked_horizontal_bundle_near_nose_root",
                "crow_feet": "same_canthus_radial_fan",
            },
            "glabellarReplacementPolicy": (
                "strong_paired_edge_candidate_replaces_weaker_dark_ridge_companion_when_"
                "the_candidate_and_semantic_primary_form_a_centered_vertical_pair"
            ),
            "glabellarEndpointExtension": (
                "weak_fragments_attach_only_to_an_accepted_replacement_core_when_collinear_"
                "disjoint_and_within_the_face_scaled_endpoint_gap"
            ),
            "baselineRole": (
                "preserved_except_evidence_based_glabellar_companion_replacement_with_"
                "endpoint_extension_and_class_specific_additions"
            ),
        },
        "model": {
            "checkpoint": str(args.checkpoint),
            "metadata": checkpoint_metadata,
        },
        "summary": {
            "baselineLineCount": len(baseline_lines),
            "rawScreenedPairedEdgeLineCount": raw_candidate_count,
            "screenedPairedEdgeLineCount": len(accepted_candidates),
            "independentAdditionCount": len(additions),
            "independentAdditionCountByClass": addition_counts,
            "endpointExtensionCount": len(selected_extensions),
            "endpointExtensionCountByClass": extension_counts,
            "weakGlabellarEndpointFragmentCount": len(weak_glabellar_fragments),
            "replacedBaselineCount": len(replaced_baseline_ids),
            "replacedBaselineIds": sorted(replaced_baseline_ids),
            "edgeAddedLengthPx": round(edge_added_length, 3),
            "fusedLineCount": len(fused_lines),
        },
        "baselinePairedEdgeEvidence": baseline_evidence,
        "classDiagnostics": class_diagnostics,
        "candidateDecisions": accepted_candidates,
        "independentAdditions": additions,
        "appliedExtensions": selected_extensions,
        "fusedLines": fused_lines,
        "limitations": [
            "The natural positive mask is low-resolution; fused additions still require human review.",
            "Paired edges suppress one-sided shadows but can still respond to organized skin texture.",
            (
                "Bundle topology recovers organized wrinkles missed by the semantic model, but its "
                "thresholds still require broader natural-image validation."
            ),
            "This experiment does not alter RSTL geometry or production detection behavior.",
        ],
    }
    (args.output / "paired_edge_fusion.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    diagnostics = {
        key: value
        for key, value in payload.items()
        if key not in {"candidateDecisions", "independentAdditions", "appliedExtensions", "fusedLines"}
    }
    (args.output / "diagnostics.json").write_text(
        json.dumps(diagnostics, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"output": str(args.output), **payload["summary"]}, indent=2))


def main() -> int:
    run(parse_args())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
