"""Run the per-image V10 four-region wrinkle detector for the local web app."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np

TOOLS = Path(__file__).resolve().parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import run_wrinkle_four_class_experiment as four_class  # noqa: E402
import run_wrinkle_paired_edge_experiment as paired  # noqa: E402
import wrinkle_illumination  # noqa: E402
import wrinkle_nasal_dorsum  # noqa: E402

REPO = TOOLS.parent
DEFAULT_CHECKPOINT = REPO / "assets" / "models" / "wrinkle_unet_patient_finetuned.pth"
CLASS_MAP = {
    "forehead": "forehead",
    "glabellar": "frown",
    "nasal_dorsum": "wrinkle",
    "crow_feet": "wrinkle",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", type=Path)
    parser.add_argument("--rgba", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--serve", action="store_true")
    return parser.parse_args()


def write_input_image(rgba_path: Path, width: int, height: int, output: Path) -> None:
    pixels = np.fromfile(rgba_path, dtype=np.uint8)
    expected = width * height * 4
    if pixels.size != expected:
        raise ValueError(f"RGBA byte count mismatch: received {pixels.size}, expected {expected}")
    rgba = pixels.reshape(height, width, 4)
    bgr = cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGR)
    if not cv2.imwrite(str(output), bgr):
        raise RuntimeError(f"Unable to write local wrinkle input: {output}")


def normalized_landmarks(payload: dict, width: int, height: int) -> np.ndarray:
    landmarks = np.asarray(payload.get("landmarks"), dtype=np.float32)
    if landmarks.ndim != 2 or landmarks.shape[0] < 468 or landmarks.shape[1] != 3:
        raise ValueError(f"Unexpected landmark shape: {landmarks.shape}")
    if not np.isfinite(landmarks).all():
        raise ValueError("Landmarks contain non-finite values")
    if np.max(np.abs(landmarks[:, :2])) > 2.0:
        landmarks = landmarks.copy()
        landmarks[:, 0] /= width
        landmarks[:, 1] /= height
        landmarks[:, 2] /= width
    return landmarks


def line_region(
    line: dict,
    regions: dict[str, np.ndarray],
    width: int,
    height: int,
) -> str | None:
    source_class = str(line.get("class", ""))
    if source_class == "forehead":
        return "forehead"
    if source_class == "frown":
        return "glabellar"
    points = np.asarray(line.get("points"), dtype=np.float32)
    if points.ndim != 2 or points.shape[0] < 2 or points.shape[1] < 2:
        return None
    xy = np.round(points[:, :2]).astype(np.int32)
    xy[:, 0] = np.clip(xy[:, 0], 0, width - 1)
    xy[:, 1] = np.clip(xy[:, 1], 0, height - 1)
    scores = {
        name: float(mask[xy[:, 1], xy[:, 0]].mean())
        for name, mask in regions.items()
    }
    selected, score = max(scores.items(), key=lambda item: item[1])
    return selected if score >= 0.20 else None


def build_baseline(
    payload: dict,
    image_path: Path,
    landmarks: np.ndarray,
    source_sha256: str,
    width: int,
    height: int,
) -> dict:
    regions, _, _ = paired.experiment_regions(landmarks, width, height)
    lines = []
    for index, source in enumerate(payload.get("baselineLines", []), start=1):
        if not isinstance(source, dict):
            continue
        region = line_region(source, regions, width, height)
        points = source.get("points")
        if region is None or not isinstance(points, list) or len(points) < 2:
            continue
        current = dict(source)
        current["id"] = f"live-yolo-{index:03d}"
        current["class"] = region
        lines.append(current)
    return {
        "schemaVersion": "langerface.dynamic-yolo-baseline.v1",
        "source": {
            "path": str(image_path),
            "sha256": source_sha256,
            "width": width,
            "height": height,
            "embedded": False,
        },
        "lines": lines,
    }


def mean_x(line: dict) -> float:
    points = np.asarray(line.get("points"), dtype=np.float32)
    return float(points[:, 0].mean()) if points.ndim == 2 and len(points) else 0.0


def vertical_glabellar_trace_lines(
    image_path: Path,
    landmarks: np.ndarray,
) -> list[dict]:
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        return []
    height, width = image.shape[:2]
    regions, face, anatomy = paired.experiment_regions(landmarks, width, height)
    face_width = float(anatomy["faceWidthPx"])
    correction = wrinkle_illumination.correct_illumination(image, face, face_width)
    traces, _, _ = wrinkle_nasal_dorsum.trace_horizontal_lines(
        np.rot90(correction.corrected_gray),
        np.rot90(regions["glabellar"]),
        face_width,
        maximum_lines=3,
    )
    output = []
    for index, trace in enumerate(traces, start=1):
        points = np.column_stack([
            width - 1.0 - trace.points[:, 1],
            trace.points[:, 0],
        ]).astype(np.float32)
        if len(points) < 2:
            continue
        output.append({
            "id": f"vertical-glabellar-trace-{index:02d}",
            "class": "glabellar",
            "confidence": float(np.clip(
                0.60 * trace.mean_response + 0.40 * trace.coverage,
                0.0,
                1.0,
            )),
            "lengthPx": paired.fine.path_length(points),
            "source": "vertical_dark_ridge_glabellar_trace",
            "points": points.tolist(),
        })
    return output


def longest_supported_trace_segment(
    points: np.ndarray,
    response: np.ndarray,
    threshold: float,
) -> tuple[np.ndarray, np.ndarray]:
    xy = np.round(points).astype(np.int32)
    xy[:, 0] = np.clip(xy[:, 0], 0, response.shape[1] - 1)
    xy[:, 1] = np.clip(xy[:, 1], 0, response.shape[0] - 1)
    values = response[xy[:, 1], xy[:, 0]]
    supported = values >= threshold
    # Bridge at most two missing samples so a one-pixel response hole does not
    # split one anatomical furrow into separate lines.
    supported = cv2.morphologyEx(
        supported.astype(np.uint8)[None, :],
        cv2.MORPH_CLOSE,
        np.ones((1, 3), dtype=np.uint8),
    )[0].astype(bool)
    starts = np.flatnonzero(supported & ~np.r_[False, supported[:-1]])
    ends = np.flatnonzero(supported & ~np.r_[supported[1:], False])
    if not len(starts):
        return np.empty((0, 2), dtype=np.float32), np.empty(0, dtype=np.float32)
    lengths = ends - starts + 1
    selected = int(np.argmax(lengths))
    start, end = int(starts[selected]), int(ends[selected]) + 1
    return points[start:end].astype(np.float32), values[start:end].astype(np.float32)


def trace_forehead_anchor_corridor(
    response: np.ndarray,
    roi: np.ndarray,
    y0: int,
    y1: int,
    x0: int,
    x1: int,
    seed_y: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Trace one quantized V10 recall corridor using only local ROI evidence."""
    height = y1 - y0
    width = x1 - x0
    if height < 3 or width < 3:
        return np.empty((0, 2), dtype=np.float32), np.empty(0, dtype=np.float32)
    local_response = response[y0:y1, x0:x1].copy()
    local_roi = roi[y0:y1, x0:x1] > 0
    local_response[~local_roi] = 0.0
    rows = np.arange(height, dtype=np.float32)
    center_row = float(seed_y - y0)
    center_penalty = 0.0025 * (rows - center_row) ** 2
    max_step = 2
    smooth_penalty = 0.060
    dp = np.full((width, height), -np.inf, dtype=np.float32)
    parent = np.full((width, height), -1, dtype=np.int16)
    dp[0] = local_response[:, 0] - center_penalty
    for column in range(1, width):
        for row in range(height):
            low = max(0, row - max_step)
            high = min(height, row + max_step + 1)
            previous_rows = np.arange(low, high, dtype=np.float32)
            transition = dp[column - 1, low:high] - smooth_penalty * (
                previous_rows - float(row)
            ) ** 2
            selected = int(np.argmax(transition))
            dp[column, row] = (
                local_response[row, column]
                - center_penalty[row]
                + transition[selected]
            )
            parent[column, row] = low + selected
    selected_rows = np.empty(width, dtype=np.int32)
    selected_rows[-1] = int(np.argmax(dp[-1]))
    for column in range(width - 1, 0, -1):
        selected_rows[column - 1] = parent[column, selected_rows[column]]
        if selected_rows[column - 1] < 0:
            return np.empty((0, 2), dtype=np.float32), np.empty(0, dtype=np.float32)
    values = local_response[selected_rows, np.arange(width)]
    smoothed_rows = wrinkle_nasal_dorsum.gaussian_filter1d(
        selected_rows.astype(np.float32) + y0,
        sigma=1.2,
        mode="nearest",
    )
    points = np.column_stack([
        np.arange(x0, x1, dtype=np.float32),
        smoothed_rows,
    ])
    return points.astype(np.float32), values.astype(np.float32)


def suppress_weak_forehead_fragments(
    lines: list[dict],
    face_width: float,
) -> list[dict]:
    ranked = sorted(
        lines,
        key=lambda line: (
            float(line.get("confidence", 0.0)),
            float(line.get("lengthPx", 0.0)),
        ),
        reverse=True,
    )
    kept: list[dict] = []
    for candidate in ranked:
        points = np.asarray(candidate.get("points"), dtype=np.float32)
        if points.ndim != 2 or len(points) < 2:
            continue
        x0, x1 = float(points[:, 0].min()), float(points[:, 0].max())
        median_y = float(np.median(points[:, 1]))
        span = max(1.0, x1 - x0)
        confidence = float(candidate.get("confidence", 0.0))
        fragmented = False
        for accepted in kept:
            accepted_points = np.asarray(accepted.get("points"), dtype=np.float32)
            accepted_x0 = float(accepted_points[:, 0].min())
            accepted_x1 = float(accepted_points[:, 0].max())
            accepted_span = max(1.0, accepted_x1 - accepted_x0)
            horizontal_gap = max(0.0, max(x0, accepted_x0) - min(x1, accepted_x1))
            same_layer = abs(
                median_y - float(np.median(accepted_points[:, 1]))
            ) <= 0.018 * face_width
            if (
                same_layer
                and horizontal_gap <= 0.012 * face_width
                and span <= 0.72 * accepted_span
                and confidence <= 0.72 * float(accepted.get("confidence", 0.0))
            ):
                fragmented = True
                break
        if not fragmented:
            kept.append(candidate)
    return sorted(
        kept,
        key=lambda line: float(np.median(np.asarray(line.get("points"), dtype=np.float32)[:, 1])),
    )


def forehead_trace_is_duplicate(candidate: np.ndarray, lines: list[dict], face_width: float) -> bool:
    candidate_x_min = float(candidate[:, 0].min())
    candidate_x_max = float(candidate[:, 0].max())
    candidate_y = float(np.median(candidate[:, 1]))
    for line in lines:
        if line.get("class") != "forehead":
            continue
        points = np.asarray(line.get("points"), dtype=np.float32)
        if points.ndim != 2 or len(points) < 2:
            continue
        overlap = max(
            0.0,
            min(candidate_x_max, float(points[:, 0].max()))
            - max(candidate_x_min, float(points[:, 0].min())),
        )
        shorter = max(
            1.0,
            min(candidate_x_max - candidate_x_min, float(np.ptp(points[:, 0]))),
        )
        if (
            overlap / shorter >= 0.35
            and abs(candidate_y - float(np.median(points[:, 1]))) <= 0.018 * face_width
        ):
            return True
    return False


def recover_forehead_traces(
    payload: dict,
    image_path: Path,
    landmarks: np.ndarray,
) -> None:
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        return
    height, width = image.shape[:2]
    regions, face, anatomy = paired.experiment_regions(landmarks, width, height)
    face_width = float(anatomy["faceWidthPx"])
    regions["forehead"] = paired.extended_forehead_region(
        anatomy,
        width,
        height,
    )
    context_radius = max(1, int(round(0.025 * face_width)))
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (2 * context_radius + 1, 2 * context_radius + 1),
    )
    correction_mask = cv2.dilate(regions["forehead"], kernel)
    correction = wrinkle_illumination.correct_illumination(image, correction_mask, face_width)
    traces, normalized, _ = wrinkle_nasal_dorsum.trace_horizontal_lines(
        correction.corrected_gray,
        regions["forehead"],
        face_width,
        maximum_lines=8,
    )
    fused = payload.get("fusedLines", [])
    recovered = []
    for trace in traces:
        points, values = longest_supported_trace_segment(trace.points, normalized, 0.18)
        if len(points) < 2 or paired.fine.path_length(points) < 0.035 * face_width:
            continue
        if float(np.ptp(points[:, 1])) > 0.040 * face_width:
            continue
        if forehead_trace_is_duplicate(points, fused + recovered, face_width):
            continue
        recovered.append({
            "id": f"local-forehead-trace-{len(recovered) + 1:02d}",
            "class": "forehead",
            "confidence": float(np.clip(0.55 * float(values.mean()) + 0.45 * trace.coverage, 0.0, 1.0)),
            "lengthPx": paired.fine.path_length(points),
            "source": "isolated_forehead_horizontal_dark_ridge_trace",
            "points": points.tolist(),
        })
    fused.extend(recovered)
    payload["isolatedForeheadTraceCount"] = len(recovered)


def refine_forehead_anchor_lines(
    anchors: list[dict],
    image_path: Path,
    landmarks: np.ndarray,
) -> list[dict]:
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None or not anchors:
        return []
    height, width = image.shape[:2]
    regions, face, anatomy = paired.experiment_regions(landmarks, width, height)
    face_width = float(anatomy["faceWidthPx"])
    forehead = paired.extended_forehead_region(
        anatomy,
        width,
        height,
    )
    context_radius = max(1, int(round(0.025 * face_width)))
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (2 * context_radius + 1, 2 * context_radius + 1),
    )
    correction_mask = cv2.dilate(forehead, kernel)
    correction = wrinkle_illumination.correct_illumination(image, correction_mask, face_width)
    response, _ = wrinkle_nasal_dorsum.horizontal_dark_ridge_response(
        correction.corrected_gray,
        forehead,
    )
    normalized = wrinkle_nasal_dorsum._normalize_response(response, forehead)
    region_y, region_x = np.nonzero(forehead)
    region_x0 = int(region_x.min() + round(0.025 * face_width))
    region_x1 = int(region_x.max() - round(0.025 * face_width) + 1)
    corridor = max(8, int(round(0.022 * face_width)))
    layer_quantization = max(2, int(round(0.006 * face_width)))
    endpoint_quantization = max(4, int(round(0.012 * face_width)))
    refined = []
    for index, anchor in enumerate(sorted(
        anchors,
        key=lambda line: float(np.median(np.asarray(line.get("points"), dtype=np.float32)[:, 1])),
    ), start=1):
        anchor_points = np.asarray(anchor.get("points"), dtype=np.float32)
        if anchor_points.ndim != 2 or len(anchor_points) < 2:
            continue
        seed_y = layer_quantization * round(
            float(np.median(anchor_points[:, 1])) / layer_quantization,
        )
        seed_x0 = endpoint_quantization * round(
            float(anchor_points[:, 0].min()) / endpoint_quantization,
        )
        seed_x1 = endpoint_quantization * round(
            float(anchor_points[:, 0].max()) / endpoint_quantization,
        )
        x0 = max(region_x0, int(seed_x0))
        x1 = min(region_x1, int(seed_x1) + 1)
        y0 = max(int(region_y.min()), int(round(seed_y - corridor)))
        y1 = min(int(region_y.max()) + 1, int(round(seed_y + corridor + 1)))
        points, values = trace_forehead_anchor_corridor(
            normalized,
            forehead,
            y0,
            y1,
            x0,
            x1,
            seed_y,
        )
        if len(points) < 2:
            points = np.column_stack([
                np.arange(x0, x1, dtype=np.float32),
                np.full(x1 - x0, seed_y, dtype=np.float32),
            ])
            source = "roi_quantized_current_input_v10_recall_fallback"
            confidence = float(anchor.get("confidence", 0.0))
        else:
            source = "roi_refined_current_input_v10_recall_corridor"
            coverage = float(np.mean(values >= 0.12))
            confidence = float(np.clip(
                0.55 * float(values.mean()) + 0.45 * coverage,
                0.0,
                1.0,
            ))
        refined.append({
            **anchor,
            "id": f"refined-forehead-anchor-{index:02d}",
            "class": "forehead",
            "confidence": confidence,
            "lengthPx": paired.fine.path_length(points),
            "source": source,
            "points": points.tolist(),
        })
    return suppress_weak_forehead_fragments(refined, face_width)


def trace_companion(
    accepted: list[dict],
    traces: list[dict],
    center_x: float,
    face_width: float,
) -> dict | None:
    if not accepted or not traces:
        return None
    reference = max(accepted, key=lambda line: float(line.get("confidence", 0.0)))
    reference_x = mean_x(reference)
    reference_points = np.asarray(reference.get("points"), dtype=np.float32)
    if reference_points.ndim != 2 or len(reference_points) < 2:
        return None
    candidates = []
    for trace in traces:
        trace_x = mean_x(trace)
        if (reference_x - center_x) * (trace_x - center_x) > 0.0:
            continue
        spacing = abs(trace_x - reference_x)
        midpoint_offset = abs(0.5 * (trace_x + reference_x) - center_x)
        if not (0.060 * face_width <= spacing <= 0.115 * face_width):
            continue
        if midpoint_offset > 0.035 * face_width:
            continue
        candidates.append((midpoint_offset, -float(trace.get("confidence", 0.0)), trace))
    if not candidates:
        return None
    selected = dict(min(candidates, key=lambda item: (item[0], item[1]))[2])
    points = np.asarray(selected["points"], dtype=np.float32)
    margin = 0.005 * face_width
    y_min = float(reference_points[:, 1].min()) - margin
    y_max = float(reference_points[:, 1].max()) + margin
    points = points[(points[:, 1] >= y_min) & (points[:, 1] <= y_max)]
    if len(points) < 2:
        return None
    selected["points"] = points.tolist()
    selected["lengthPx"] = paired.fine.path_length(points)
    selected["source"] = "vertical_dark_ridge_companion_to_glabellar_candidate"
    return selected


def recover_glabellar_pair(
    payload: dict,
    center_x: float,
    face_width: float,
    *,
    image_path: Path | None = None,
    landmarks: np.ndarray | None = None,
) -> None:
    fused = payload.get("fusedLines", [])
    accepted = [line for line in fused if line.get("class") == "glabellar"]
    if len(accepted) >= 2:
        return
    rejected = [
        line for line in payload.get("candidateDecisions", [])
        if line.get("class") == "glabellar"
        and line.get("decision") == "rejected"
        and float(line.get("lengthPx", 0.0)) >= 0.028 * face_width
        and abs(mean_x(line) - center_x) <= 0.10 * face_width
    ]
    for candidate in sorted(
        rejected,
        key=lambda line: (float(line.get("confidence", 0.0)), float(line.get("lengthPx", 0.0))),
        reverse=True,
    ):
        candidate_x = mean_x(candidate)
        if any(abs(candidate_x - mean_x(line)) < 0.025 * face_width for line in accepted):
            continue
        recovered = dict(candidate)
        recovered["id"] = f"dynamic-glabellar-pair-{len(accepted) + 1:02d}"
        recovered["decision"] = "addition"
        recovered["decisionReason"] = "dynamic_bilateral_glabellar_pair"
        fused.append(recovered)
        accepted.append(recovered)
        if len(accepted) >= 2:
            break
    if len(accepted) < 2 and image_path is not None and landmarks is not None:
        traces = vertical_glabellar_trace_lines(image_path, landmarks)
        companion = trace_companion(accepted, traces, center_x, face_width)
        if companion is not None:
            companion["id"] = f"dynamic-glabellar-trace-{len(accepted) + 1:02d}"
            companion["decision"] = "addition"
            companion["decisionReason"] = "dynamic_vertical_dark_ridge_companion"
            fused.append(companion)
            accepted.append(companion)


def recover_strong_crow_feet_traces(payload: dict, face_width: float) -> None:
    fused = payload.get("fusedLines", [])
    candidates = [
        line for line in payload.get("candidateDecisions", [])
        if line.get("class") == "crow_feet"
        and line.get("decision") == "rejected"
        and line.get("decisionReason") == "crow_feet_without_semantic_support"
        and line.get("screeningReason") == "accepted"
        and float(line.get("confidence", 0.0)) >= 0.55
        and float(line.get("lengthPx", 0.0)) >= 0.023 * face_width
        and float(line.get("chordRatio", 0.0)) >= 0.80
        and float(line.get("meanOrientationSupport", 0.0)) >= 0.70
    ]
    for candidate in sorted(
        candidates,
        key=lambda line: (
            float(line.get("confidence", 0.0)),
            float(line.get("lengthPx", 0.0)),
        ),
        reverse=True,
    ):
        recovered = dict(candidate)
        recovered["id"] = f"local-crow-feet-trace-{len(fused) + 1:02d}"
        recovered["decision"] = "addition"
        recovered["decisionReason"] = "strong_local_multicue_crow_feet_without_yolo_support"
        recovered["source"] = "isolated_strong_multicue_crow_feet_trace"
        fused.append(recovered)
    payload["isolatedCrowFeetRecoveryCount"] = len(candidates)


def response_payload(
    paired_payload: dict,
    source_sha256: str,
    width: int,
    height: int,
    checkpoint_sha256: str,
    target_region: str | None = None,
) -> dict:
    class_counts = {name: 0 for name in CLASS_MAP}
    lines = []
    ordered = sorted(
        paired_payload.get("fusedLines", []),
        key=lambda line: (
            list(CLASS_MAP).index(str(line.get("class")))
            if str(line.get("class")) in CLASS_MAP else len(CLASS_MAP),
            mean_x(line),
        ),
    )
    for line in ordered:
        anatomical_class = str(line.get("class", ""))
        if target_region is not None and anatomical_class != target_region:
            continue
        mapped_class = CLASS_MAP.get(anatomical_class)
        points = line.get("points")
        if mapped_class is None or not isinstance(points, list) or len(points) < 2:
            continue
        class_counts[anatomical_class] += 1
        slug = anatomical_class.replace("_", "-")
        lines.append({
            "id": f"paired-edge-live-{slug}-{class_counts[anatomical_class]:03d}",
            "sourceSegmentId": str(line.get("id", "")),
            "class": mapped_class,
            "anatomicalClass": anatomical_class,
            "lengthPx": float(line.get("lengthPx", 0.0)),
            "points": points,
        })
    required_regions = (target_region,) if target_region is not None else tuple(CLASS_MAP)
    if any(class_counts[name] == 0 for name in required_regions):
        raise RuntimeError(f"Four-region detector returned an empty region: {class_counts}")
    return {
        "schemaVersion": "langerface.wrinkle-fine-lines.v1",
        "detectorVersion": "paired-edge-v10-dynamic-four-region-1.1",
        "checkpointSha256": checkpoint_sha256,
        "source": {
            "imageSha256": source_sha256,
            "width": width,
            "height": height,
        },
        "summary": {
            "lineCount": len(lines),
            "lineCountByAnatomicalClass": class_counts,
            "sourceConnectedComponents": len(lines),
            "baselineLineCount": int(paired_payload.get("summary", {}).get("baselineLineCount", 0)),
            "targetRegion": target_region,
        },
        "modelInputTensorSha256": paired_payload.get("model", {}).get("inputTensorSha256"),
        "lines": lines,
    }


def run(args: argparse.Namespace) -> None:
    if args.request is None or args.rgba is None or args.output is None:
        raise ValueError("--request, --rgba and --output are required")
    request = json.loads(args.request.read_text(encoding="utf-8"))
    trace_enabled = bool(request.get("trace", False))
    target_region = request.get("targetRegion")
    if target_region is not None and target_region not in CLASS_MAP:
        raise ValueError(f"Unsupported targetRegion: {target_region}")
    width = int(request.get("width", 0))
    height = int(request.get("height", 0))
    if width <= 0 or height <= 0 or width != height:
        raise ValueError(f"Expected a positive square working frame, received {width}x{height}")
    args.output.mkdir(parents=True, exist_ok=False)
    image_path = args.output / "input.png"
    write_input_image(args.rgba, width, height, image_path)
    source_sha256 = hashlib.sha256(image_path.read_bytes()).hexdigest().upper()
    landmarks = normalized_landmarks(request, width, height)
    landmarks_path = args.output / "landmarks.json"
    landmarks_path.write_text(json.dumps({
        "source": str(image_path),
        "sourceSha256": source_sha256,
        "landmarks": landmarks.tolist(),
    }), encoding="utf-8")
    recall_anchors = request.get("recallAnchorLines", [])
    if target_region == "forehead" and recall_anchors:
        request["baselineLines"] = refine_forehead_anchor_lines(
            recall_anchors,
            image_path,
            landmarks,
        )
    baseline = build_baseline(
        request,
        image_path,
        landmarks,
        source_sha256,
        width,
        height,
    )
    baseline_path = args.output / "baseline.json"
    baseline_path.write_text(json.dumps(baseline), encoding="utf-8")
    paired_output = args.output / "paired"
    paired.run(SimpleNamespace(
        input=image_path,
        landmark_input=landmarks_path,
        face_model=REPO / "assets" / "face_landmarker.task",
        checkpoint=args.checkpoint,
        baseline=baseline_path,
        without_baseline=False,
        target_region=target_region,
        trace=trace_enabled,
        output=paired_output,
    ))
    result = json.loads((paired_output / "paired_edge_fusion.json").read_text(encoding="utf-8"))
    _, _, anatomy = paired.experiment_regions(landmarks, width, height)
    live_timeline = args.output / "live_timeline"
    live_steps: list[dict] = []
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR) if trace_enabled else None

    def capture_live_step(file_name: str, operation: str) -> None:
        if not trace_enabled or image is None:
            return
        lines = result.get("fusedLines", [])
        paired.trace_write(
            live_timeline / file_name,
            paired.trace_line_overlay(
                image,
                lines,
                default_color=(60, 220, 70),
                thickness=3,
            ),
        )
        live_steps.append({
            "file": file_name,
            "operation": operation,
            "lineCount": len(lines),
        })

    if trace_enabled:
        live_timeline.mkdir()
        capture_live_step("01_before_live_recovery.png", "paired_edge_fusion_complete")
    if target_region == "forehead" and not recall_anchors:
        recover_forehead_traces(result, image_path, landmarks)
        capture_live_step("02_after_forehead_recovery.png", "forehead_recovery")
    if target_region in (None, "glabellar"):
        recover_glabellar_pair(
            result,
            float(anatomy["centerX"]),
            float(anatomy["faceWidthPx"]),
            image_path=image_path,
            landmarks=landmarks,
        )
        capture_live_step("03_after_glabellar_recovery.png", "glabellar_recovery")
    if target_region in (None, "crow_feet"):
        recover_strong_crow_feet_traces(
            result,
            float(anatomy["faceWidthPx"]),
        )
        capture_live_step("04_after_crow_feet_recovery.png", "crow_feet_recovery")
    response = response_payload(
        result,
        source_sha256,
        width,
        height,
        hashlib.sha256(args.checkpoint.read_bytes()).hexdigest(),
        target_region=target_region,
    )
    (args.output / "response.json").write_text(
        json.dumps(response, ensure_ascii=False),
        encoding="utf-8",
    )
    if trace_enabled and image is not None:
        paired.trace_write(
            live_timeline / "05_final_response.png",
            paired.trace_line_overlay(
                image,
                response.get("lines", []),
                default_color=(60, 220, 70),
                thickness=3,
            ),
        )
        live_steps.append({
            "file": "05_final_response.png",
            "operation": "response_payload",
            "lineCount": len(response.get("lines", [])),
        })
        (live_timeline / "steps.json").write_text(
            json.dumps(live_steps, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    print(json.dumps(response["summary"], ensure_ascii=False))


def serve(checkpoint: Path) -> None:
    # Load the immutable checkpoint before the first request so all images use
    # the same warm model path without paying initialization latency on upload.
    four_class.warm_unet(checkpoint)
    sys.stdout.write(json.dumps({
        "type": "ready",
        "detectorVersion": "paired-edge-v10-dynamic-four-region-1.1",
        "checkpointSha256": hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
    }) + "\n")
    sys.stdout.flush()
    for raw_line in sys.stdin:
        request_id = None
        try:
            message = json.loads(raw_line)
            request_id = message.get("id")
            args = SimpleNamespace(
                request=Path(message["request"]),
                rgba=Path(message["rgba"]),
                output=Path(message["output"]),
                checkpoint=Path(message.get("checkpoint") or checkpoint),
            )
            with redirect_stdout(sys.stderr):
                run(args)
            result = {"id": request_id, "ok": True}
        except Exception as error:  # pragma: no cover - exercised by the Vite bridge
            result = {"id": request_id, "ok": False, "error": str(error)}
        sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def main() -> int:
    args = parse_args()
    if args.serve:
        serve(args.checkpoint)
    else:
        run(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
