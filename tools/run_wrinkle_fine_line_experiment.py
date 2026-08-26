"""Extract one-pixel wrinkle centerlines at source resolution without training.

Forehead and crow-feet geometry retain the verified v3 strategy. Glabellar and
nasal-dorsum lines use official 1024 U-Net probability maps as semantic seeds,
then localize one-pixel geometry on source-resolution dark ridges. This
experiment never reads or changes RSTL geometry.
"""

from __future__ import annotations

import argparse
import heapq
import json
import math
from pathlib import Path

import cv2
import numpy as np
from scipy.ndimage import binary_propagation, gaussian_filter, gaussian_filter1d, map_coordinates

import run_wrinkle_four_class_experiment as v1

REPO = Path(__file__).resolve().parents[1]
PROJECT = REPO.parent
DEFAULT_INPUT = PROJECT / "langer线-cc" / "wrinkle.png"
DEFAULT_LANDMARKS = PROJECT / "langer线-cc" / "wrinkle_landmarks_browser_cpu.json"
DEFAULT_YOLO = PROJECT / "langer线-cc" / "wrinkle_rstl_experiment_v9" / "wrinkle_yolo_evidence.json"
DEFAULT_CHECKPOINT = REPO / "assets" / "models" / "wrinkle_unet_patient_finetuned.pth"
DEFAULT_FACE_MODEL = REPO / "assets" / "face_landmarker.task"
DEFAULT_V1 = PROJECT / "langer线-cc" / "wrinkle_four_class_experiment_v1"
DEFAULT_OFFICIAL_UNET = (
    PROJECT
    / "langer线-cc"
    / "wrinkle_open_model_comparison_v1"
    / "debug"
    / "official_unet_1024_texture_v2_probability.npy"
)
DEFAULT_LOCAL_UNET = (
    PROJECT
    / "langer线-cc"
    / "wrinkle_open_model_local_crop_v2"
    / "debug"
    / "local_probability.npy"
)
DEFAULT_OUTPUT = PROJECT / "langer线-cc" / "wrinkle_fine_line_experiment_v6"

CLASS_COLORS = v1.CLASS_COLORS
CLASS_ORDER = v1.CLASS_ORDER
SCALES = (0.65, 0.9, 1.2, 1.6, 2.1)
LEFT_EYE = (33, 160, 158, 133, 153, 144)
RIGHT_EYE = (362, 385, 387, 263, 373, 380)
LEFT_BROW = (70, 63, 105, 66, 107)
RIGHT_BROW = (336, 296, 334, 293, 300)
MIN_LENGTH = {
    "forehead": 24.0,
    "glabellar": 12.0,
    "nasal_dorsum": 12.0,
    "crow_feet": 14.0,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--landmark-input", type=Path, default=DEFAULT_LANDMARKS)
    parser.add_argument("--yolo-evidence", type=Path, default=DEFAULT_YOLO)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--face-model", type=Path, default=DEFAULT_FACE_MODEL)
    parser.add_argument("--v1-directory", type=Path, default=DEFAULT_V1)
    parser.add_argument("--official-unet-probability", type=Path, default=DEFAULT_OFFICIAL_UNET)
    parser.add_argument("--local-unet-probability", type=Path, default=DEFAULT_LOCAL_UNET)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--unet-threshold", type=float, default=0.35)
    return parser.parse_args()


def dark_ridge_field(gray: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    best = np.zeros_like(gray, dtype=np.float32)
    tangent = np.zeros_like(gray, dtype=np.float32)
    scale_map = np.zeros_like(gray, dtype=np.float32)
    for sigma in SCALES:
        ixx = gaussian_filter(gray, sigma=sigma, order=(0, 2), mode="reflect") * sigma**2
        ixy = gaussian_filter(gray, sigma=sigma, order=(1, 1), mode="reflect") * sigma**2
        iyy = gaussian_filter(gray, sigma=sigma, order=(2, 0), mode="reflect") * sigma**2
        delta = np.sqrt(np.maximum((ixx - iyy) ** 2 + 4.0 * ixy**2, 0.0))
        large = 0.5 * (ixx + iyy + delta)
        small = 0.5 * (ixx + iyy - delta)
        positive = np.maximum(large, 0.0)
        ratio = np.abs(small) / np.maximum(positive, 1e-8)
        ridge = positive * np.exp(-(ratio**2) / (2.0 * 0.45**2))
        normal_angle = 0.5 * np.arctan2(2.0 * ixy, ixx - iyy)
        current_tangent = normal_angle + np.pi * 0.5
        update = ridge > best
        best[update] = ridge[update]
        tangent[update] = current_tangent[update]
        scale_map[update] = sigma
    return best, tangent, scale_map


def exclusion_mask(landmarks: np.ndarray, width: int, height: int) -> np.ndarray:
    points = v1.pixel_landmarks(landmarks, width, height)
    output = np.zeros((height, width), dtype=np.uint8)
    for indices in (LEFT_EYE, RIGHT_EYE):
        cv2.fillPoly(output, [np.round(points[list(indices), :2]).astype(np.int32)], 1)
    output = cv2.dilate(output, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
    brow = np.zeros_like(output)
    for indices in (LEFT_BROW, RIGHT_BROW):
        polyline = np.round(points[list(indices), :2]).astype(np.int32).reshape(-1, 1, 2)
        cv2.polylines(brow, [polyline], False, 1, 9, cv2.LINE_AA)
    return (output | brow).astype(np.uint8)


def robust_unit(values: np.ndarray, mask: np.ndarray) -> np.ndarray:
    selected = values[mask > 0]
    selected = selected[np.isfinite(selected)]
    if not selected.size:
        return np.zeros_like(values, dtype=np.float32)
    low, high = np.percentile(selected, [45.0, 99.65])
    return np.clip((values - low) / max(float(high - low), 1e-8), 0.0, 1.0).astype(np.float32)


def orientation_support(
    class_name: str,
    tangent: np.ndarray,
    anatomy: dict,
    width: int,
    height: int,
) -> np.ndarray:
    tx = np.cos(tangent)
    ty = np.sin(tangent)
    if class_name == "forehead":
        return np.clip((np.abs(tx) - 0.45) / 0.55, 0.0, 1.0).astype(np.float32)
    if class_name == "glabellar":
        return np.clip((np.abs(ty) - 0.35) / 0.65, 0.0, 1.0).astype(np.float32)
    if class_name == "nasal_dorsum":
        return np.clip((np.abs(tx) - 0.20) / 0.80, 0.0, 1.0).astype(np.float32)

    yy, xx = np.mgrid[:height, :width].astype(np.float32)
    support = np.zeros((height, width), dtype=np.float32)
    center_x = float(anatomy["centerX"])
    for outer_x, outer_y in anatomy["outerCanthi"]:
        side = xx < center_x if outer_x < center_x else xx >= center_x
        radial_x = xx - float(outer_x)
        radial_y = yy - float(outer_y)
        norm = np.sqrt(radial_x**2 + radial_y**2) + 1e-6
        alignment = np.abs(tx * radial_x / norm + ty * radial_y / norm)
        support[side] = alignment[side]
    return np.clip((support - 0.30) / 0.70, 0.0, 1.0).astype(np.float32)


def directional_nms(score: np.ndarray, tangent: np.ndarray, region: np.ndarray) -> np.ndarray:
    yy, xx = np.mgrid[: score.shape[0], : score.shape[1]].astype(np.float32)
    normal_x = -np.sin(tangent)
    normal_y = np.cos(tangent)
    distance = 1.15
    plus = map_coordinates(
        score,
        [yy + normal_y * distance, xx + normal_x * distance],
        order=1,
        mode="constant",
        cval=0.0,
    )
    minus = map_coordinates(
        score,
        [yy - normal_y * distance, xx - normal_x * distance],
        order=1,
        mode="constant",
        cval=0.0,
    )
    return ((score >= plus) & (score >= minus) & (region > 0)).astype(np.uint8)


def hysteresis_candidates(
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
        "forehead": (52.0, 75.0),
        "glabellar": (58.0, 80.0),
        "nasal_dorsum": (64.0, 86.0),
        "crow_feet": (60.0, 82.0),
    }[class_name]
    weak_threshold = float(np.percentile(values, weak_percentile))
    strong_threshold = float(np.percentile(values, strong_percentile))
    weak = (nms > 0) & (score >= weak_threshold)
    strong = (nms > 0) & (score >= strong_threshold)
    connected = binary_propagation(strong, mask=weak, structure=np.ones((3, 3), dtype=bool))
    return connected.astype(np.uint8)


def graph_for_pixels(pixels: np.ndarray) -> tuple[list[tuple[int, int]], list[list[tuple[int, float]]]]:
    nodes = [(int(y), int(x)) for y, x in pixels]
    index = {point: node_index for node_index, point in enumerate(nodes)}
    adjacency: list[list[tuple[int, float]]] = [[] for _ in nodes]
    for node_index, (y, x) in enumerate(nodes):
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                neighbor = index.get((y + dy, x + dx))
                if neighbor is not None:
                    adjacency[node_index].append((neighbor, math.hypot(dx, dy)))
    return nodes, adjacency


def farthest(adjacency: list[list[tuple[int, float]]], start: int) -> tuple[int, list[int], float]:
    distance = [math.inf] * len(adjacency)
    parent = [-1] * len(adjacency)
    distance[start] = 0.0
    queue = [(0.0, start)]
    while queue:
        current_distance, node = heapq.heappop(queue)
        if current_distance != distance[node]:
            continue
        for neighbor, weight in adjacency[node]:
            proposal = current_distance + weight
            if proposal < distance[neighbor]:
                distance[neighbor] = proposal
                parent[neighbor] = node
                heapq.heappush(queue, (proposal, neighbor))
    reachable = [index for index, value in enumerate(distance) if math.isfinite(value)]
    target = max(reachable, key=lambda index: distance[index])
    return target, parent, float(distance[target])


def longest_path(component: np.ndarray) -> tuple[np.ndarray, float]:
    pixels = np.argwhere(component > 0)
    nodes, adjacency = graph_for_pixels(pixels)
    if len(nodes) < 2:
        return np.empty((0, 2), dtype=np.float32), 0.0
    endpoints = [index for index, neighbors in enumerate(adjacency) if len(neighbors) == 1]
    start = endpoints[0] if endpoints else 0
    first, _, _ = farthest(adjacency, start)
    second, parents, length = farthest(adjacency, first)
    path = []
    current = second
    while current >= 0:
        y, x = nodes[current]
        path.append((float(x), float(y)))
        if current == first:
            break
        current = parents[current]
    path.reverse()
    return np.asarray(path, dtype=np.float32), length


def smooth_path(path: np.ndarray) -> np.ndarray:
    if len(path) < 5:
        return path
    sigma = min(2.0, max(0.8, len(path) / 60.0))
    smoothed = np.column_stack(
        [gaussian_filter1d(path[:, axis], sigma=sigma, mode="nearest") for axis in range(2)],
    )
    keep = np.ones(len(smoothed), dtype=bool)
    keep[1:] = np.linalg.norm(np.diff(smoothed, axis=0), axis=1) > 0.20
    return smoothed[keep]


def path_length(path: np.ndarray) -> float:
    if len(path) < 2:
        return 0.0
    return float(np.linalg.norm(np.diff(path, axis=0), axis=1).sum())


def load_probability_cache(path: Path, shape: tuple[int, int]) -> np.ndarray:
    if not path.exists():
        raise FileNotFoundError(f"Required semantic probability cache is missing: {path}")
    probability = np.load(path, allow_pickle=False).astype(np.float32)
    if probability.shape != shape:
        raise RuntimeError(f"Probability cache {path} has shape {probability.shape}, expected {shape}")
    if not np.isfinite(probability).all():
        raise RuntimeError(f"Probability cache {path} contains non-finite values")
    return np.clip(probability, 0.0, 1.0)


def trace_vertical_semantic_component(
    component: np.ndarray,
    semantic_probability: np.ndarray,
    ridge: np.ndarray,
) -> np.ndarray:
    ys, xs = np.nonzero(component)
    if not len(xs):
        return np.empty((0, 2), dtype=np.float32)
    x0 = max(0, int(xs.min()) - 5)
    x1 = min(component.shape[1], int(xs.max()) + 6)
    y0 = int(ys.min())
    y1 = int(ys.max()) + 1
    support = cv2.dilate(
        component.astype(np.uint8),
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 5)),
    ).astype(bool)
    joint = 0.64 * semantic_probability + 0.36 * ridge
    local_width = x1 - x0
    row_count = y1 - y0
    costs = np.full((row_count, local_width), np.inf, dtype=np.float32)
    parents = np.full((row_count, local_width), -1, dtype=np.int16)

    valid = support[y0, x0:x1]
    costs[0, valid] = -joint[y0, x0:x1][valid]
    x_indices = np.arange(local_width)
    for row_index in range(1, row_count):
        y = y0 + row_index
        valid = support[y, x0:x1]
        for x_index in x_indices[valid]:
            left = max(0, int(x_index) - 4)
            right = min(local_width, int(x_index) + 5)
            previous = costs[row_index - 1, left:right]
            if not np.isfinite(previous).any():
                continue
            offsets = np.arange(left, right) - int(x_index)
            transition = previous + 0.045 * offsets.astype(np.float32) ** 2
            best_local = int(np.argmin(transition))
            parent = left + best_local
            costs[row_index, x_index] = transition[best_local] - joint[y, x0 + x_index]
            parents[row_index, x_index] = parent

    last = int(np.argmin(costs[-1]))
    if not np.isfinite(costs[-1, last]):
        return np.empty((0, 2), dtype=np.float32)
    traced_x = np.empty(row_count, dtype=np.float32)
    traced_x[-1] = x0 + last
    for row_index in range(row_count - 1, 0, -1):
        last = int(parents[row_index, last])
        if last < 0:
            return np.empty((0, 2), dtype=np.float32)
        traced_x[row_index - 1] = x0 + last
    traced_x = gaussian_filter1d(traced_x, sigma=1.6, mode="nearest")
    traced_y = np.arange(y0, y1, dtype=np.float32)
    return np.column_stack([traced_x, traced_y])


def semantic_glabellar_lines(
    semantic_probability: np.ndarray,
    ridge: np.ndarray,
    region: np.ndarray,
    center_x: float,
    face_width: float,
) -> tuple[list[dict], dict]:
    mask = ((semantic_probability >= 0.5) & (region > 0)).astype(np.uint8)
    component_count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    selected: list[tuple[float, int]] = []
    rejected = {"small": 0, "not_vertical": 0, "off_center": 0}
    for component_id in range(1, component_count):
        x, _y, width, height, area = [int(value) for value in stats[component_id]]
        if area < 0.0012 * face_width**2 or height < 0.075 * face_width:
            rejected["small"] += 1
            continue
        if height / max(width, 1) < 1.65:
            rejected["not_vertical"] += 1
            continue
        component_center_x = x + 0.5 * width
        if abs(component_center_x - center_x) > 0.10 * face_width:
            rejected["off_center"] += 1
            continue
        selected.append((float(area * height / max(width, 1)), component_id))

    lines = []
    for _, component_id in sorted(selected, reverse=True)[:2]:
        component = labels == component_id
        path = trace_vertical_semantic_component(component, semantic_probability, ridge)
        length = path_length(path)
        if len(path) < 2 or length < 0.075 * face_width:
            continue
        xy = np.round(path).astype(np.int32)
        probability_values = semantic_probability[xy[:, 1], xy[:, 0]]
        ridge_values = ridge[xy[:, 1], xy[:, 0]]
        confidence = float(np.clip(0.62 * probability_values.mean() + 0.38 * ridge_values.mean(), 0, 1))
        lines.append({
            "id": "",
            "class": "glabellar",
            "confidence": confidence,
            "lengthPx": round(length, 3),
            "meanModelSupport": round(float(probability_values.mean()), 6),
            "meanRidgeSupport": round(float(ridge_values.mean()), 6),
            "semanticSupportFraction": round(float((probability_values >= 0.5).mean()), 6),
            "source": "official_unet_1024_semantic_seed_snapped_to_dark_ridge",
            "points": [[round(float(x), 3), round(float(y), 3)] for x, y in path],
        })
    return lines, {
        "semanticComponentCount": component_count - 1,
        "selectedSemanticComponents": len(lines),
        "semanticRejectionCounts": rejected,
    }


def path_x_at_y(path: np.ndarray, y_values: np.ndarray) -> np.ndarray:
    order = np.argsort(path[:, 1])
    sorted_path = path[order]
    unique_y, inverse = np.unique(np.round(sorted_path[:, 1], 3), return_inverse=True)
    x_sum = np.zeros(len(unique_y), dtype=np.float32)
    x_count = np.zeros(len(unique_y), dtype=np.float32)
    np.add.at(x_sum, inverse, sorted_path[:, 0])
    np.add.at(x_count, inverse, 1.0)
    return np.interp(y_values, unique_y, x_sum / np.maximum(x_count, 1.0))


def parallel_candidate_metrics(
    line: dict,
    primary_path: np.ndarray,
    face_width: float,
) -> dict | None:
    path = np.asarray(line["points"], dtype=np.float32)
    y0 = max(float(path[:, 1].min()), float(primary_path[:, 1].min()))
    y1 = min(float(path[:, 1].max()), float(primary_path[:, 1].max()))
    overlap = y1 - y0
    if overlap < 0.05 * face_width:
        return None
    selected = (path[:, 1] >= y0) & (path[:, 1] <= y1)
    primary_x = path_x_at_y(primary_path, path[selected, 1])
    signed_separation = path[selected, 0] - primary_x
    median_separation = float(np.median(signed_separation))
    absolute_separation = abs(median_separation)
    if not (0.025 * face_width <= absolute_separation <= 0.09 * face_width):
        return None
    side = 1.0 if median_separation > 0 else -1.0
    same_side_fraction = float((signed_separation * side > 0).mean())
    vertical_span = float(path[:, 1].max() - path[:, 1].min())
    chord_ratio = float(np.linalg.norm(path[-1] - path[0]) / max(path_length(path), 1e-6))
    if vertical_span < 0.055 * face_width or float(line["lengthPx"]) < 0.075 * face_width:
        return None
    if chord_ratio < 0.70 or same_side_fraction < 0.90:
        return None
    if float(line["meanRidgeSupport"]) < 0.24:
        return None
    expected_separation = 0.05 * face_width
    spacing_score = max(
        0.0,
        1.0 - abs(absolute_separation - expected_separation) / (0.04 * face_width),
    )
    score = (
        0.32 * min(vertical_span / (0.10 * face_width), 1.0)
        + 0.28 * float(line["meanRidgeSupport"])
        + 0.20 * chord_ratio
        + 0.12 * same_side_fraction
        + 0.08 * spacing_score
    )
    return {
        "path": path,
        "score": score,
        "side": side,
        "medianSeparationPx": median_separation,
        "overlapPx": overlap,
        "chordRatio": chord_ratio,
    }


def parallel_glabellar_companion(
    generic_lines: list[dict],
    primary_line: dict,
    face_width: float,
) -> tuple[list[dict], dict]:
    primary_path = np.asarray(primary_line["points"], dtype=np.float32)
    candidates = []
    for line in generic_lines:
        metrics = parallel_candidate_metrics(line, primary_path, face_width)
        if metrics is not None:
            candidates.append((metrics["score"], line, metrics))
    if not candidates:
        return [], {"parallelCandidateCount": 0, "attachedFragmentCount": 0}

    _, base, base_metrics = max(candidates, key=lambda item: item[0])
    selected_lines = [base]
    selected_path = np.asarray(base["points"], dtype=np.float32)
    base_min_y = float(selected_path[:, 1].min())
    base_max_y = float(selected_path[:, 1].max())
    base_top = selected_path[int(np.argmin(selected_path[:, 1]))]
    base_bottom = selected_path[int(np.argmax(selected_path[:, 1]))]
    maximum_endpoint_gap = 0.018 * face_width

    attachments = []
    for line in generic_lines:
        if line is base or float(line["lengthPx"]) < 0.018 * face_width:
            continue
        path = np.asarray(line["points"], dtype=np.float32)
        primary_x = path_x_at_y(primary_path, path[:, 1])
        signed_separation = path[:, 0] - primary_x
        if float((signed_separation * base_metrics["side"] > 0).mean()) < 0.85:
            continue
        median_separation = abs(float(np.median(signed_separation)))
        if not (0.02 * face_width <= median_separation <= 0.10 * face_width):
            continue
        top = path[int(np.argmin(path[:, 1]))]
        bottom = path[int(np.argmax(path[:, 1]))]
        if float(path[:, 1].min()) < base_min_y - 2.0:
            gap = float(np.linalg.norm(bottom - base_top))
            extension = base_min_y - float(path[:, 1].min())
            if gap <= maximum_endpoint_gap:
                attachments.append((extension, line))
        elif float(path[:, 1].max()) > base_max_y + 2.0:
            gap = float(np.linalg.norm(top - base_bottom))
            extension = float(path[:, 1].max()) - base_max_y
            if gap <= maximum_endpoint_gap:
                attachments.append((extension, line))

    if attachments:
        selected_lines.append(max(attachments, key=lambda item: item[0])[1])
    all_points = np.concatenate(
        [np.asarray(line["points"], dtype=np.float32) for line in selected_lines],
        axis=0,
    )
    rounded_y = np.round(all_points[:, 1]).astype(np.int32)
    y_values = np.arange(int(rounded_y.min()), int(rounded_y.max()) + 1, dtype=np.int32)
    measured_y = []
    measured_x = []
    for y_value in y_values:
        selected = np.abs(all_points[:, 1] - y_value) <= 0.75
        if selected.any():
            measured_y.append(float(y_value))
            measured_x.append(float(np.median(all_points[selected, 0])))
    continuous_y = np.arange(int(min(measured_y)), int(max(measured_y)) + 1, dtype=np.float32)
    continuous_x = np.interp(continuous_y, measured_y, measured_x)
    continuous_x = gaussian_filter1d(continuous_x, sigma=1.3, mode="nearest")
    path = np.column_stack([continuous_x, continuous_y])
    weights = np.asarray([max(float(line["lengthPx"]), 1.0) for line in selected_lines])
    companion = {
        "id": "",
        "class": "glabellar",
        "confidence": float(
            np.clip(
                0.55 * np.average([line["confidence"] for line in selected_lines], weights=weights)
                + 0.45 * base_metrics["score"],
                0.0,
                1.0,
            )
        ),
        "lengthPx": round(path_length(path), 3),
        "meanModelSupport": round(
            float(np.average([line["meanModelSupport"] for line in selected_lines], weights=weights)),
            6,
        ),
        "meanRidgeSupport": round(
            float(np.average([line["meanRidgeSupport"] for line in selected_lines], weights=weights)),
            6,
        ),
        "parallelPrimaryMedianSeparationPx": round(
            abs(float(base_metrics["medianSeparationPx"])),
            3,
        ),
        "parallelPrimaryOverlapPx": round(float(base_metrics["overlapPx"]), 3),
        "source": "parallel_dark_ridge_companion_to_semantic_glabellar_primary",
        "points": [[round(float(x), 3), round(float(y), 3)] for x, y in path],
    }
    return [companion], {
        "parallelCandidateCount": len(candidates),
        "attachedFragmentCount": len(selected_lines) - 1,
        "companionMedianSeparationPx": companion["parallelPrimaryMedianSeparationPx"],
        "companionOverlapPx": companion["parallelPrimaryOverlapPx"],
    }


def merge_nasal_fragments(lines: list[dict]) -> list[dict]:
    groups: list[list[dict]] = []
    for line in sorted(lines, key=lambda item: float(np.median(np.asarray(item["points"])[:, 1]))):
        points = np.asarray(line["points"], dtype=np.float32)
        median_y = float(np.median(points[:, 1]))
        min_x = float(points[:, 0].min())
        max_x = float(points[:, 0].max())
        matched = None
        for group in groups:
            group_points = np.concatenate(
                [np.asarray(item["points"], dtype=np.float32) for item in group],
                axis=0,
            )
            group_y = float(np.median(group_points[:, 1]))
            group_min_x = float(group_points[:, 0].min())
            group_max_x = float(group_points[:, 0].max())
            horizontal_gap = max(0.0, max(group_min_x, min_x) - min(group_max_x, max_x))
            if abs(median_y - group_y) <= 3.0 and horizontal_gap <= 10.0:
                matched = group
                break
        if matched is None:
            groups.append([line])
        else:
            matched.append(line)

    merged = []
    for group in groups:
        if len(group) == 1:
            merged.append(group[0])
            continue
        points = np.concatenate(
            [np.asarray(item["points"], dtype=np.float32) for item in group],
            axis=0,
        )
        x_bins = np.arange(int(np.floor(points[:, 0].min())), int(np.ceil(points[:, 0].max())) + 1)
        y_values = []
        used_x = []
        for x_value in x_bins:
            selected = np.abs(points[:, 0] - x_value) <= 0.75
            if selected.any():
                used_x.append(float(x_value))
                y_values.append(float(np.median(points[selected, 1])))
        path = np.column_stack(
            [np.asarray(used_x, dtype=np.float32), gaussian_filter1d(y_values, 1.0, mode="nearest")],
        )
        weights = np.asarray([max(float(item["lengthPx"]), 1.0) for item in group], dtype=np.float32)
        merged.append({
            "id": "",
            "class": "nasal_dorsum",
            "confidence": float(np.average([item["confidence"] for item in group], weights=weights)),
            "lengthPx": round(path_length(path), 3),
            "meanModelSupport": round(
                float(np.average([item["meanModelSupport"] for item in group], weights=weights)),
                6,
            ),
            "meanRidgeSupport": round(
                float(np.average([item["meanRidgeSupport"] for item in group], weights=weights)),
                6,
            ),
            "semanticSupportFraction": round(
                float(np.average([item["semanticSupportFraction"] for item in group], weights=weights)),
                6,
            ),
            "source": "semantic_supported_dark_ridge_fragments_merged",
            "points": [[round(float(x), 3), round(float(y), 3)] for x, y in path],
        })
    return merged


def semantic_nasal_lines(
    lines: list[dict],
    semantic_probability: np.ndarray,
    nose_root_y: float,
    face_width: float,
) -> tuple[list[dict], dict]:
    semantic_seed = semantic_probability >= 0.5
    semantic_distance = cv2.distanceTransform(
        (~semantic_seed).astype(np.uint8),
        cv2.DIST_L2,
        5,
    )
    accepted = []
    rejection_counts: dict[str, int] = {}
    for line in lines:
        path = np.asarray(line["points"], dtype=np.float32)
        xy = np.round(path).astype(np.int32)
        distances = semantic_distance[xy[:, 1], xy[:, 0]]
        median_y = float(np.median(path[:, 1]))
        semantic_fraction = float((distances <= 8.0).mean())
        if not (nose_root_y - 0.03 * face_width <= median_y <= nose_root_y + 0.04 * face_width):
            rejection_counts["outside_nose_root_band"] = (
                rejection_counts.get("outside_nose_root_band", 0) + 1
            )
            continue
        if semantic_fraction < 0.70:
            rejection_counts["insufficient_semantic_proximity"] = (
                rejection_counts.get("insufficient_semantic_proximity", 0) + 1
            )
            continue
        refined = dict(line)
        refined["semanticSupportFraction"] = round(semantic_fraction, 6)
        refined["source"] = "dark_ridge_with_official_or_local_unet_semantic_seed"
        accepted.append(refined)
    merged = merge_nasal_fragments(accepted)
    return merged, {
        "ridgeCandidatesBeforeSemanticGate": len(lines),
        "ridgeCandidatesAfterSemanticGate": len(accepted),
        "mergedLineCount": len(merged),
        "semanticRejectionCounts": rejection_counts,
    }


def component_metrics(
    path: np.ndarray,
    length: float,
    score: np.ndarray,
    ridge: np.ndarray,
    model_support: np.ndarray,
    orientation: np.ndarray,
) -> dict:
    xy = np.round(path).astype(np.int32)
    xy[:, 0] = np.clip(xy[:, 0], 0, score.shape[1] - 1)
    xy[:, 1] = np.clip(xy[:, 1], 0, score.shape[0] - 1)
    values = score[xy[:, 1], xy[:, 0]]
    ridge_values = ridge[xy[:, 1], xy[:, 0]]
    model_values = model_support[xy[:, 1], xy[:, 0]]
    orientation_values = orientation[xy[:, 1], xy[:, 0]]
    centered = path - np.mean(path, axis=0, keepdims=True)
    covariance = centered.T @ centered / max(len(path) - 1, 1)
    eigenvalues = np.linalg.eigvalsh(covariance)
    elongation = float((eigenvalues[-1] + 1e-6) / (eigenvalues[0] + 1e-6))
    chord = float(np.linalg.norm(path[-1] - path[0]))
    chord_ratio = chord / max(length, 1e-6)
    return {
        "lengthPx": float(length),
        "chordPx": chord,
        "chordRatio": chord_ratio,
        "meanScore": float(np.mean(values)),
        "meanRidge": float(np.mean(ridge_values)),
        "meanModelSupport": float(np.mean(model_values)),
        "meanOrientationSupport": float(np.mean(orientation_values)),
        "elongation": elongation,
    }


def accept_component(class_name: str, metrics: dict) -> tuple[bool, str]:
    if metrics["lengthPx"] < MIN_LENGTH[class_name]:
        return False, "short"
    if metrics["meanOrientationSupport"] < 0.28:
        return False, "direction"
    if metrics["elongation"] < 2.2:
        return False, "not_elongated"
    minimum_chord_ratio = {
        "forehead": 0.72,
        "glabellar": 0.55,
        "nasal_dorsum": 0.68,
        "crow_feet": 0.52,
    }[class_name]
    if metrics["chordRatio"] < minimum_chord_ratio:
        return False, "loop_or_reversal"
    learned_support = metrics["meanModelSupport"]
    strong_ridge = metrics["meanRidge"]
    orientation = metrics["meanOrientationSupport"]
    if class_name == "glabellar":
        long_directional = metrics["lengthPx"] >= 28.0 and orientation >= 0.42 and strong_ridge >= 0.20
        short_strong = metrics["lengthPx"] >= 14.0 and orientation >= 0.55 and strong_ridge >= 0.32
        if long_directional or short_strong:
            return True, "accepted_directional_ridge_without_model"
    if class_name == "nasal_dorsum":
        if metrics["lengthPx"] >= 14.0 and orientation >= 0.62 and strong_ridge >= 0.34:
            return True, "accepted_directional_ridge_without_model"
    if learned_support < 0.02 and metrics["lengthPx"] < 42.0:
        return False, "short_without_model_support"
    if learned_support < 0.045 and strong_ridge < 0.42:
        return False, "weak_without_model_support"
    return True, "accepted"


def draw_paths(image: np.ndarray, lines: list[dict], thickness: int = 1) -> np.ndarray:
    output = image.copy()
    for line in lines:
        points = np.round(np.asarray(line["points"], dtype=np.float32)).astype(np.int32)
        if len(points) < 2:
            continue
        line_type = cv2.LINE_8 if thickness == 1 else cv2.LINE_AA
        cv2.polylines(
            output,
            [points.reshape(-1, 1, 2)],
            False,
            CLASS_COLORS[line["class"]],
            thickness,
            line_type,
        )
    return output


def merge_forehead_fragments(lines: list[dict]) -> list[dict]:
    others = [line for line in lines if line["class"] != "forehead"]
    forehead = [line.copy() for line in lines if line["class"] == "forehead"]
    changed = True
    while changed:
        changed = False
        forehead.sort(key=lambda line: min(point[0] for point in line["points"]))
        for left_index, left in enumerate(forehead):
            left_points = np.asarray(left["points"], dtype=np.float32)
            left_points = left_points[np.argsort(left_points[:, 0])]
            for right_index in range(left_index + 1, len(forehead)):
                right = forehead[right_index]
                right_points = np.asarray(right["points"], dtype=np.float32)
                right_points = right_points[np.argsort(right_points[:, 0])]
                gap_x = float(right_points[0, 0] - left_points[-1, 0])
                gap_y = float(abs(right_points[0, 1] - left_points[-1, 1]))
                if gap_x < -5.0 or gap_x > 48.0 or gap_y > 5.0:
                    continue
                bridge_count = max(0, int(round(gap_x)) - 1)
                bridge = np.empty((0, 2), dtype=np.float32)
                if bridge_count:
                    bridge = np.linspace(
                        left_points[-1],
                        right_points[0],
                        bridge_count + 2,
                        dtype=np.float32,
                    )[1:-1]
                combined = np.vstack([left_points, bridge, right_points])
                combined = smooth_path(combined)
                left_weight = max(float(left["lengthPx"]), 1.0)
                right_weight = max(float(right["lengthPx"]), 1.0)
                total_weight = left_weight + right_weight
                merged = {
                    **left,
                    "confidence": (
                        float(left["confidence"]) * left_weight
                        + float(right["confidence"]) * right_weight
                    ) / total_weight,
                    "lengthPx": round(float(np.linalg.norm(np.diff(combined, axis=0), axis=1).sum()), 3),
                    "meanModelSupport": round(
                        (
                            float(left["meanModelSupport"]) * left_weight
                            + float(right["meanModelSupport"]) * right_weight
                        ) / total_weight,
                        6,
                    ),
                    "meanRidgeSupport": round(
                        (
                            float(left["meanRidgeSupport"]) * left_weight
                            + float(right["meanRidgeSupport"]) * right_weight
                        ) / total_weight,
                        6,
                    ),
                    "points": [[round(float(x), 3), round(float(y), 3)] for x, y in combined],
                }
                forehead[left_index] = merged
                del forehead[right_index]
                changed = True
                break
            if changed:
                break
    return others + forehead


def lines_from_model_mask(mask: np.ndarray, class_name: str) -> list[dict]:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    lines = []
    for component_id in range(1, count):
        if int(stats[component_id, cv2.CC_STAT_AREA]) < 12:
            continue
        path, length = longest_path((labels == component_id).astype(np.uint8))
        path = smooth_path(path)
        if len(path) < 2 or length < MIN_LENGTH[class_name]:
            continue
        chord_ratio = float(np.linalg.norm(path[-1] - path[0]) / max(length, 1e-6))
        if chord_ratio < 0.70:
            continue
        lines.append({
            "id": "",
            "class": class_name,
            "confidence": 0.9,
            "lengthPx": round(float(length), 3),
            "meanModelSupport": 1.0,
            "meanRidgeSupport": 0.0,
            "source": "verified_yolo_centerline_with_nearby_unet_gap_support",
            "points": [[round(float(x), 3), round(float(y), 3)] for x, y in path],
        })
    return lines


def response_heatmap(image: np.ndarray, response: np.ndarray) -> np.ndarray:
    heat = cv2.applyColorMap(np.clip(response * 255, 0, 255).astype(np.uint8), cv2.COLORMAP_TURBO)
    return cv2.addWeighted(image, 0.45, heat, 0.55, 0)


def label_panel(image: np.ndarray, label: str) -> np.ndarray:
    bar = 42
    output = cv2.copyMakeBorder(image, bar, 0, 0, 0, cv2.BORDER_CONSTANT, value=(18, 14, 12))
    cv2.putText(output, label, (14, 29), cv2.FONT_HERSHEY_SIMPLEX, 0.72, (245, 245, 245), 2, cv2.LINE_AA)
    return output


def montage(panels: list[tuple[str, np.ndarray]], width: int = 560) -> np.ndarray:
    rendered = []
    for label, panel in panels:
        scale = width / panel.shape[1]
        resized = cv2.resize(panel, (width, int(round(panel.shape[0] * scale))), interpolation=cv2.INTER_AREA)
        rendered.append(label_panel(resized, label))
    rows = []
    for index in range(0, len(rendered), 3):
        row = rendered[index : index + 3]
        while len(row) < 3:
            row.append(np.zeros_like(rendered[0]))
        rows.append(np.hstack(row))
    return np.vstack(rows)


def class_closeups(image: np.ndarray, regions: dict[str, np.ndarray]) -> np.ndarray:
    panels = []
    target_width, target_height = 620, 360
    for name in CLASS_ORDER:
        ys, xs = np.where(regions[name] > 0)
        if not len(xs):
            crop = np.zeros((target_height - 42, target_width, 3), dtype=np.uint8)
        else:
            pad = 22
            x0, x1 = max(0, int(xs.min()) - pad), min(image.shape[1], int(xs.max()) + pad + 1)
            y0, y1 = max(0, int(ys.min()) - pad), min(image.shape[0], int(ys.max()) + pad + 1)
            source = image[y0:y1, x0:x1]
            scale = min(target_width / source.shape[1], (target_height - 42) / source.shape[0])
            resized = cv2.resize(
                source,
                (int(round(source.shape[1] * scale)), int(round(source.shape[0] * scale))),
                interpolation=cv2.INTER_AREA,
            )
            crop = np.zeros((target_height - 42, target_width, 3), dtype=np.uint8)
            offset_x = (target_width - resized.shape[1]) // 2
            offset_y = (crop.shape[0] - resized.shape[0]) // 2
            crop[offset_y : offset_y + resized.shape[0], offset_x : offset_x + resized.shape[1]] = resized
        panels.append(label_panel(crop, name))
    return np.vstack([np.hstack(panels[:2]), np.hstack(panels[2:])])


def run(args: argparse.Namespace) -> None:
    if args.output.exists():
        raise FileExistsError(f"Refusing to overwrite existing output directory: {args.output}")
    args.output.mkdir(parents=True)
    image = cv2.imread(str(args.input), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(args.input)
    height, width = image.shape[:2]
    landmarks = v1.load_landmarks(
        args.input,
        args.face_model,
        args.output,
        args.landmark_input,
    )
    regions, face, anatomy = v1.anatomy_regions(landmarks, width, height)
    excluded = exclusion_mask(landmarks, width, height)
    for name in CLASS_ORDER:
        regions[name] = (regions[name] & ~excluded.astype(bool)).astype(np.uint8)
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
        glabellar_gate.astype(np.uint8) & face & ~excluded.astype(bool)
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

    _, yolo_mask, yolo_centerline, _ = v1.load_yolo_evidence(
        args.yolo_evidence,
        args.input,
        width,
        height,
    )
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    illumination = gaussian_filter(gray, sigma=14.0, mode="reflect")
    normalized_gray = np.clip(gray - illumination + 0.5, 0.0, 1.0).astype(np.float32)
    ridge_raw, tangent, scale_map = dark_ridge_field(normalized_gray)
    texture = v1.hessian_texture(image)
    unet_probability, checkpoint_metadata = v1.run_unet(image, texture, args.checkpoint)
    unet_centerline = v1.morphological_skeleton(
        (unet_probability >= args.unet_threshold).astype(np.uint8),
    )
    yolo_support = cv2.GaussianBlur(yolo_mask.astype(np.float32), (0, 0), sigmaX=7.0)
    yolo_support /= max(float(yolo_support.max()), 1e-6)
    unet_support = cv2.GaussianBlur(unet_probability.astype(np.float32), (0, 0), sigmaX=3.0)
    model_support = np.maximum(yolo_support, unet_support)
    official_unet_probability = load_probability_cache(
        args.official_unet_probability,
        (height, width),
    )
    local_unet_probability = load_probability_cache(
        args.local_unet_probability,
        (height, width),
    )
    nasal_semantic_probability = np.maximum(official_unet_probability, local_unet_probability)

    all_candidates = np.zeros((height, width), dtype=np.uint8)
    accepted_lines: list[dict] = []
    rejected: list[dict] = []
    response_union = np.zeros((height, width), dtype=np.float32)
    nms_union = np.zeros((height, width), dtype=np.uint8)
    class_diagnostics = {}

    for class_name in CLASS_ORDER:
        region = regions[class_name]
        ridge = robust_unit(ridge_raw, region)
        orientation = orientation_support(class_name, tangent, anatomy, width, height)
        score = ridge * (0.52 + 0.48 * orientation) * (0.78 + 0.22 * np.sqrt(model_support))
        score *= region
        response_union = np.maximum(response_union, score)
        nms = directional_nms(score, tangent, region)
        nms_union |= nms
        candidates = hysteresis_candidates(class_name, score, nms, region)
        close_size = {
            "forehead": (31, 3),
            "glabellar": (3, 7),
            "nasal_dorsum": (7, 3),
            "crow_feet": (3, 3),
        }[class_name]
        candidates = cv2.morphologyEx(
            candidates,
            cv2.MORPH_CLOSE,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, close_size),
        )
        candidates = v1.morphological_skeleton(candidates)
        all_candidates |= candidates
        component_count, labels, stats, _ = cv2.connectedComponentsWithStats(candidates, 8)
        accepted_before = len(accepted_lines)
        rejection_counts: dict[str, int] = {}
        for component_id in range(1, component_count):
            if int(stats[component_id, cv2.CC_STAT_AREA]) < 5:
                rejection_counts["tiny"] = rejection_counts.get("tiny", 0) + 1
                continue
            component = (labels == component_id).astype(np.uint8)
            path, length = longest_path(component)
            path = smooth_path(path)
            if len(path) < 2:
                rejection_counts["no_path"] = rejection_counts.get("no_path", 0) + 1
                continue
            metrics = component_metrics(path, length, score, ridge, model_support, orientation)
            accepted, reason = accept_component(class_name, metrics)
            record = {
                "class": class_name,
                "componentId": int(component_id),
                **metrics,
            }
            if not accepted:
                record["reason"] = reason
                rejected.append(record)
                rejection_counts[reason] = rejection_counts.get(reason, 0) + 1
                continue
            confidence = float(np.clip(
                0.46 * metrics["meanRidge"]
                + 0.26 * metrics["meanModelSupport"]
                + 0.28 * metrics["meanOrientationSupport"],
                0.0,
                1.0,
            ))
            accepted_lines.append({
                "id": "",
                "class": class_name,
                "confidence": confidence,
                "lengthPx": round(metrics["lengthPx"], 3),
                "meanModelSupport": round(metrics["meanModelSupport"], 6),
                "meanRidgeSupport": round(metrics["meanRidge"], 6),
                "points": [[round(float(x), 3), round(float(y), 3)] for x, y in path],
            })
        class_diagnostics[class_name] = {
            "candidatePixels": int(candidates.sum()),
            "acceptedLineCount": len(accepted_lines) - accepted_before,
            "rejectionCounts": rejection_counts,
        }

    generic_glabellar_lines = [line for line in accepted_lines if line["class"] == "glabellar"]
    generic_nasal_lines = [line for line in accepted_lines if line["class"] == "nasal_dorsum"]
    glabellar_ridge = robust_unit(ridge_raw, regions["glabellar"])
    glabellar_lines, glabellar_semantic_diagnostics = semantic_glabellar_lines(
        official_unet_probability,
        glabellar_ridge,
        regions["glabellar"],
        center_x,
        face_width,
    )
    glabellar_companion_lines: list[dict] = []
    glabellar_companion_diagnostics = {
        "parallelCandidateCount": 0,
        "attachedFragmentCount": 0,
    }
    if glabellar_lines:
        glabellar_companion_lines, glabellar_companion_diagnostics = (
            parallel_glabellar_companion(
                generic_glabellar_lines,
                glabellar_lines[0],
                face_width,
            )
        )
        glabellar_lines.extend(glabellar_companion_lines)
    nasal_lines, nasal_semantic_diagnostics = semantic_nasal_lines(
        generic_nasal_lines,
        nasal_semantic_probability,
        nose_root_y,
        face_width,
    )
    accepted_lines = [
        line
        for line in accepted_lines
        if line["class"] not in {"forehead", "glabellar", "nasal_dorsum"}
    ]
    accepted_lines.extend(glabellar_lines)
    accepted_lines.extend(nasal_lines)
    nearby_unet = unet_centerline & cv2.dilate(
        yolo_centerline,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)),
    )
    forehead_model_region = (
        (yy >= float(anatomy["topY"]) - 0.05 * face_width)
        & (yy <= brow_y - 0.04 * face_width)
        & (np.abs(xx - center_x) <= 0.44 * face_width)
    ).astype(np.uint8)
    forehead_model_mask = (yolo_centerline | nearby_unet) & forehead_model_region
    accepted_lines.extend(lines_from_model_mask(forehead_model_mask, "forehead"))
    class_diagnostics["glabellar"] = {
        **class_diagnostics["glabellar"],
        "genericAcceptedBeforeSemanticReplacement": class_diagnostics["glabellar"][
            "acceptedLineCount"
        ],
        "acceptedLineCount": len(glabellar_lines),
        **glabellar_semantic_diagnostics,
        **glabellar_companion_diagnostics,
    }
    class_diagnostics["nasal_dorsum"] = {
        **class_diagnostics["nasal_dorsum"],
        "genericAcceptedBeforeSemanticGate": class_diagnostics["nasal_dorsum"][
            "acceptedLineCount"
        ],
        "acceptedLineCount": len(nasal_lines),
        **nasal_semantic_diagnostics,
    }
    accepted_lines.sort(key=lambda line: (CLASS_ORDER.index(line["class"]), -line["lengthPx"]))
    for index, line in enumerate(accepted_lines, start=1):
        line["id"] = f"fine-line-v2-{index:03d}"

    centerline_mask = np.zeros((height, width), dtype=np.uint8)
    for line in accepted_lines:
        points = np.round(np.asarray(line["points"], dtype=np.float32)).astype(np.int32)
        if len(points) >= 2:
            cv2.polylines(centerline_mask, [points.reshape(-1, 1, 2)], False, 1, 1, cv2.LINE_8)

    response_image = response_heatmap(image, response_union)
    nms_image = v1.draw_skeleton(image, nms_union, (0, 220, 255), 1)
    candidate_image = v1.draw_skeleton(image, all_candidates, (255, 180, 0), 1)
    final_image = draw_paths(image, accepted_lines, 1)
    final_zoom = draw_paths(image, accepted_lines, 2)
    model_image = image.copy()
    model_image = v1.draw_skeleton(model_image, yolo_centerline, (255, 180, 0), 1)
    model_image = v1.draw_skeleton(model_image, unet_centerline, (220, 80, 220), 1)
    v1_image = cv2.imread(str(args.v1_directory / "06_four_class_overlay.png"), cv2.IMREAD_COLOR)
    if v1_image is None:
        v1_image = image.copy()

    debug = args.output / "debug"
    debug.mkdir()
    landmark_artifact = args.output / "landmarks.json"
    if landmark_artifact.exists():
        landmark_artifact.replace(debug / "landmarks.json")
    cv2.imwrite(str(debug / "00_input.png"), image)
    cv2.imwrite(str(debug / "01_model_support.png"), model_image)
    cv2.imwrite(str(debug / "02_multiscale_ridge_response.png"), response_image)
    cv2.imwrite(str(debug / "03_directional_nms.png"), nms_image)
    cv2.imwrite(str(debug / "04_candidate_centerlines.png"), candidate_image)
    semantic_image = image.copy()
    glabellar_semantic_mask = (
        (official_unet_probability >= 0.5) & (regions["glabellar"] > 0)
    ).astype(np.uint8)
    nasal_semantic_mask = (
        (nasal_semantic_probability >= 0.5)
        & (regions["nasal_dorsum"] > 0)
        & (yy >= nose_root_y - 0.03 * face_width)
        & (yy <= nose_root_y + 0.04 * face_width)
    ).astype(np.uint8)
    semantic_image = v1.draw_skeleton(
        semantic_image,
        v1.morphological_skeleton(glabellar_semantic_mask),
        CLASS_COLORS["glabellar"],
        1,
    )
    semantic_image = v1.draw_skeleton(
        semantic_image,
        v1.morphological_skeleton(nasal_semantic_mask),
        CLASS_COLORS["nasal_dorsum"],
        1,
    )
    cv2.imwrite(str(debug / "05_high_resolution_semantic_seeds.png"), semantic_image)
    cv2.imwrite(str(args.output / "FINAL_wrinkle_detection.png"), final_image)
    cv2.imwrite(str(debug / "06_review_two_pixel_lines.png"), final_zoom)
    comparison = montage([
        ("Input", image),
        ("YOLO + U-Net support", model_image),
        ("Multi-scale ridge response", response_image),
        ("Directional NMS", nms_image),
        ("V1 coarse result", v1_image),
        ("V2 one-pixel centerlines", final_image),
    ])
    cv2.imwrite(str(debug / "07_v1_v3_comparison.png"), comparison)
    cv2.imwrite(str(debug / "08_four_class_closeups.png"), class_closeups(final_zoom, regions))
    line_only = np.zeros_like(image)
    line_only = draw_paths(line_only, accepted_lines, 1)
    cv2.imwrite(str(debug / "09_one_pixel_lines_only.png"), line_only)

    line_counts = {name: sum(line["class"] == name for line in accepted_lines) for name in CLASS_ORDER}
    payload = {
        "schemaVersion": "langerface.wrinkle-fine-lines.v6-experiment",
        "validated": False,
        "trainingPerformed": False,
        "rstlUsed": False,
        "source": {
            "path": str(args.input),
            "sha256": v1.sha256(args.input),
            "width": width,
            "height": height,
            "embedded": False,
        },
        "method": {
            "scalesPx": list(SCALES),
            "ridge": "positive_hessian_dark_ridge_with_shape_suppression",
            "localization": "normal_direction_non_maximum_suppression",
            "connection": "double_threshold_8_connected_propagation",
            "geometry": "longest_geodesic_component_path_gaussian_smoothed",
            "renderedStrokeWidthPx": 1,
            "modelRole": "v3_support_plus_1024_unet_semantic_seeds_for_glabella_and_nasal_dorsum",
            "classification": "landmark_roi_expected_orientation_and_high_resolution_semantic_gate",
            "glabellarGeometry": (
                "vertical_semantic_primary_plus_one_parallel_dark_ridge_companion"
            ),
            "nasalGeometry": "dark_ridge_semantic_distance_gate_and_collinear_fragment_merge",
        },
        "models": {
            "yoloEvidence": str(args.yolo_evidence),
            "unetCheckpoint": str(args.checkpoint),
            "unetMetadata": checkpoint_metadata,
            "officialUnet1024Probability": str(args.official_unet_probability),
            "localContextUnet1024Probability": str(args.local_unet_probability),
        },
        "summary": {
            "lineCount": len(accepted_lines),
            "lineCountByClass": line_counts,
            "totalLengthPx": round(sum(line["lengthPx"] for line in accepted_lines), 3),
            "centerlinePixels": int(centerline_mask.sum()),
        },
        "classDiagnostics": class_diagnostics,
        "rejectedComponents": rejected,
        "lines": accepted_lines,
        "limitations": [
            "No four-class ground truth is available; this is a single-image qualitative experiment.",
            (
                "High-resolution semantic caches are tied to this source image and are not "
                "production model assets."
            ),
            (
                "Nasal dark-ridge localization can still confuse closely spaced texture without "
                "multi-image validation."
            ),
            "One-pixel rendering is geometry output; the two-pixel image exists only for visual review.",
            "No RSTL geometry is read or modified.",
        ],
    }
    (args.output / "wrinkle_fine_lines_v6.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    diagnostics = {key: value for key, value in payload.items() if key != "lines"}
    (args.output / "diagnostics.json").write_text(
        json.dumps(diagnostics, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"output": str(args.output), **payload["summary"]}, indent=2, ensure_ascii=False))


def main() -> int:
    run(parse_args())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
