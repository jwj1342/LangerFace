"""Local patient-texture warping for mapped atlas lines."""
from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np

from langerface.lines.mapping import MappedLine

from .wrinkle_field import WrinkleField


@dataclass(frozen=True)
class TextureWarpConfig:
    """Controls how strongly patient wrinkles can locally adjust prior lines."""

    enabled: bool = False
    max_shift_px: float = 5.0
    search_radius_px: float = 8.0
    sample_step_px: float = 1.0
    min_strength: float = 0.12
    min_orientation_alignment: float = 0.35
    orientation_weight: float = 1.5
    smoothing_window: int = 5


def warp_mapped_lines(
    mapped_lines: list[MappedLine],
    field: WrinkleField,
    config: TextureWarpConfig | None = None,
) -> list[MappedLine]:
    """Nudge mapped 2D line points toward nearby wrinkle ridges.

    The prior line keeps its topology and barycentric identity; only rendered
    image-space points are locally shifted. Each point searches along the line
    normal for a nearby ridge whose Hessian tangent agrees with the local prior
    tangent, then applies a bounded, smoothed offset.
    """
    cfg = config or TextureWarpConfig()
    if not cfg.enabled or cfg.max_shift_px <= 0 or cfg.search_radius_px <= 0:
        return mapped_lines

    warped: list[MappedLine] = []
    for line in mapped_lines:
        if line.pts.shape[0] < 2:
            warped.append(line)
            continue
        pts = np.asarray(line.pts, dtype=np.float64).copy()
        offsets = _line_offsets(pts[:, :2], field, cfg)
        pts[:, :2] += offsets
        warped.append(replace(line, pts=pts))
    return warped


def _line_offsets(xy: np.ndarray, field: WrinkleField, cfg: TextureWarpConfig) -> np.ndarray:
    tangent = _polyline_tangents(xy)
    normal = np.column_stack([-tangent[:, 1], tangent[:, 0]])
    steps = _search_steps(cfg)
    candidates = xy[:, None, :] + normal[:, None, :] * steps[None, :, None]
    flat = candidates.reshape(-1, 2)
    wrinkle_dir, strength = field.sample(flat)
    wrinkle_dir = wrinkle_dir.reshape(xy.shape[0], len(steps), 2)
    strength = strength.reshape(xy.shape[0], len(steps))

    alignment = np.abs(np.sum(wrinkle_dir * tangent[:, None, :], axis=2))
    eligible = (strength >= cfg.min_strength) & (alignment >= cfg.min_orientation_alignment)
    score = np.where(eligible, strength * np.power(alignment, cfg.orientation_weight), -np.inf)
    best_idx = np.argmax(score, axis=1)
    best_score = score[np.arange(xy.shape[0]), best_idx]
    best_step = steps[best_idx]
    best_strength = strength[np.arange(xy.shape[0]), best_idx]

    shift = np.where(np.isfinite(best_score), best_step * np.clip(best_strength, 0.0, 1.0), 0.0)
    shift = np.clip(shift, -cfg.max_shift_px, cfg.max_shift_px)
    shift = _smooth_1d(shift, cfg.smoothing_window)
    return normal * shift[:, None]


def _polyline_tangents(xy: np.ndarray) -> np.ndarray:
    prev_pts = np.vstack([xy[0], xy[:-1]])
    next_pts = np.vstack([xy[1:], xy[-1]])
    tangent = next_pts - prev_pts
    norms = np.linalg.norm(tangent, axis=1)
    valid = norms > 1e-12
    tangent[valid] /= norms[valid, None]
    tangent[~valid] = np.array([1.0, 0.0], dtype=np.float64)
    return tangent


def _search_steps(cfg: TextureWarpConfig) -> np.ndarray:
    step = max(float(cfg.sample_step_px), 0.25)
    radius = max(float(cfg.search_radius_px), step)
    count = int(np.floor(radius / step))
    return np.arange(-count, count + 1, dtype=np.float64) * step


def _smooth_1d(values: np.ndarray, window: int) -> np.ndarray:
    width = int(window)
    if width <= 1 or values.size < 3:
        return values
    if width % 2 == 0:
        width += 1
    pad = width // 2
    padded = np.pad(values, (pad, pad), mode="edge")
    kernel = np.ones(width, dtype=np.float64) / width
    return np.convolve(padded, kernel, mode="valid")
