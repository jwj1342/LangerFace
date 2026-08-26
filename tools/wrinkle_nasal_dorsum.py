"""Training-free horizontal dark-ridge tracing for the nasal dorsum."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter, gaussian_filter1d

SCALES = (1.0, 1.6, 2.4, 3.4, 4.6)


@dataclass(frozen=True)
class NasalTrace:
    points: np.ndarray
    mean_response: float
    coverage: float
    scale: float


def horizontal_dark_ridge_response(
    gray: np.ndarray,
    roi: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Return positive-curvature, horizontally oriented dark-ridge evidence."""
    if gray.ndim != 2 or roi.shape != gray.shape:
        raise ValueError("gray and roi must be matching two-dimensional arrays")
    best = np.zeros_like(gray, dtype=np.float32)
    best_scale = np.zeros_like(gray, dtype=np.float32)
    valid = roi > 0
    if not np.any(valid):
        return best, best_scale

    for sigma in SCALES:
        ixx = gaussian_filter(gray, sigma=sigma, order=(0, 2), mode="reflect") * sigma**2
        iyy = gaussian_filter(gray, sigma=sigma, order=(2, 0), mode="reflect") * sigma**2
        ixy = gaussian_filter(gray, sigma=sigma, order=(1, 1), mode="reflect") * sigma**2
        positive_normal = np.maximum(iyy, 0.0)
        horizontal_shape = np.exp(
            -(np.abs(ixx) / np.maximum(positive_normal, 1e-8)) ** 2
            / (2.0 * 0.75**2),
        )
        normal_alignment = np.exp(
            -(np.abs(ixy) / np.maximum(positive_normal, 1e-8)) ** 2
            / (2.0 * 0.85**2),
        )
        response = positive_normal * horizontal_shape * normal_alignment
        response[~valid] = 0.0
        update = response > best
        best[update] = response[update]
        best_scale[update] = sigma
    return best.astype(np.float32), best_scale.astype(np.float32)


def _normalize_response(response: np.ndarray, roi: np.ndarray) -> np.ndarray:
    values = response[roi > 0]
    values = values[np.isfinite(values)]
    if values.size == 0:
        return np.zeros_like(response, dtype=np.float32)
    low, high = np.percentile(values, [55.0, 99.0])
    return np.clip((response - low) / max(float(high - low), 1e-8), 0.0, 1.0).astype(np.float32)


def _trace_one(
    score: np.ndarray,
    roi: np.ndarray,
    y0: int,
    y1: int,
    x0: int,
    x1: int,
    *,
    max_step: int = 3,
    smooth_penalty: float = 0.045,
    scale_map: np.ndarray | None = None,
) -> NasalTrace | None:
    height = y1 - y0
    width = x1 - x0
    local_score = score[y0:y1, x0:x1].copy()
    local_roi = roi[y0:y1, x0:x1] > 0
    local_score[~local_roi] = 0.0
    if height < 3 or width < 3:
        return None

    # Dynamic programming follows the strongest horizontal ridge while
    # limiting row motion so eye corners and diagonal nose-side shadows cannot
    # hijack the path.
    dp = np.full((width, height), -np.inf, dtype=np.float32)
    parent = np.full((width, height), -1, dtype=np.int16)
    dp[0] = local_score[:, 0]
    for column in range(1, width):
        for row in range(height):
            low = max(0, row - max_step)
            high = min(height, row + max_step + 1)
            previous_rows = np.arange(low, high)
            transition = dp[column - 1, low:high] - smooth_penalty * (
                previous_rows.astype(np.float32) - float(row)
            ) ** 2
            best_index = int(np.argmax(transition))
            dp[column, row] = local_score[row, column] + transition[best_index]
            parent[column, row] = low + best_index

    last = int(np.argmax(dp[-1]))
    rows = np.empty(width, dtype=np.int32)
    rows[-1] = last
    for column in range(width - 1, 0, -1):
        rows[column - 1] = parent[column, rows[column]]
        if rows[column - 1] < 0:
            return None
    values = local_score[rows, np.arange(width)]
    coverage = float(np.mean(values >= 0.12))
    mean_response = float(np.mean(values))
    if coverage < 0.58 or mean_response < 0.16:
        return None
    points = np.column_stack(
        [
            np.arange(x0, x1, dtype=np.float32),
            gaussian_filter1d(rows.astype(np.float32) + y0, sigma=1.2, mode="nearest"),
        ],
    )
    scale = 0.0
    if scale_map is not None:
        sampled_scale = scale_map[y0 + rows, x0 + np.arange(width)]
        sampled_scale = sampled_scale[np.isfinite(sampled_scale) & (sampled_scale > 0)]
        if sampled_scale.size:
            scale = float(np.median(sampled_scale))
    return NasalTrace(
        points=points,
        mean_response=mean_response,
        coverage=coverage,
        scale=scale,
    )


def trace_horizontal_lines(
    gray: np.ndarray,
    roi: np.ndarray,
    face_width: float,
    *,
    maximum_lines: int = 4,
) -> tuple[list[NasalTrace], np.ndarray, np.ndarray]:
    """Trace separated, continuous horizontal nasal wrinkles."""
    response, scale_map = horizontal_dark_ridge_response(gray, roi)
    normalized = _normalize_response(response, roi)
    ys, xs = np.where(roi > 0)
    if not len(xs):
        return [], normalized, scale_map
    # Trim the ROI to leave a small margin from the eye corners and nasal sides.
    x0 = int(xs.min() + round(0.025 * face_width))
    x1 = int(xs.max() - round(0.025 * face_width) + 1)
    y0 = int(ys.min())
    y1 = int(ys.max() + 1)
    if x1 <= x0 or y1 <= y0:
        return [], normalized, scale_map

    working = normalized.copy()
    traces: list[NasalTrace] = []
    minimum_separation = max(7, int(round(0.014 * face_width)))
    for _ in range(maximum_lines):
        trace = _trace_one(
            working,
            roi,
            y0,
            y1,
            x0,
            x1,
            scale_map=scale_map,
        )
        if trace is None:
            break
        traces.append(trace)
        points = np.round(trace.points).astype(np.int32)
        for x, y in points:
            cv2.circle(working, (int(x), int(y)), minimum_separation, 0.0, -1)
    traces.sort(key=lambda trace: float(np.mean(trace.points[:, 1])))
    return traces, normalized, scale_map
