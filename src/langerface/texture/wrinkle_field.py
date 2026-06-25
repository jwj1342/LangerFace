"""Wrinkle direction fields extracted from patient images.

The default extractor is intentionally classical and lightweight: it uses the
Hessian matrix of the grayscale image to estimate the local ridge tangent of
fine skin folds. A trained segmentation model can still feed this module by
passing its wrinkle mask as ``wrinkle_mask``; the mask gates the field strength
without changing the runtime dependency surface.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class WrinkleFieldConfig:
    """Parameters for Hessian-based wrinkle direction extraction."""

    gaussian_sigma: float = 1.4
    normalize_percentile: float = 98.0
    min_strength: float = 0.04
    mask_weight: float = 0.65
    use_clahe: bool = True


@dataclass(frozen=True)
class WrinkleField:
    """Dense axial wrinkle tangent field in image coordinates."""

    direction_xy: np.ndarray
    strength: np.ndarray
    config: WrinkleFieldConfig

    def sample(self, xy: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Bilinearly sample tangent directions and strengths at ``xy`` pixels."""
        pts = np.asarray(xy, dtype=np.float64).reshape(-1, 2)
        dirs_x = _sample_bilinear(self.direction_xy[:, :, 0], pts)
        dirs_y = _sample_bilinear(self.direction_xy[:, :, 1], pts)
        dirs = np.column_stack([dirs_x, dirs_y])
        norms = np.linalg.norm(dirs, axis=1)
        valid = norms > 1e-12
        dirs[valid] /= norms[valid, None]
        dirs[~valid] = np.array([1.0, 0.0], dtype=np.float64)
        return dirs, _sample_bilinear(self.strength, pts)


class HessianWrinkleExtractor:
    """Extract fine wrinkle ridge tangents from a BGR/RGB patient image."""

    def __init__(self, config: WrinkleFieldConfig | None = None):
        self.config = config or WrinkleFieldConfig()

    def extract(self, frame_bgr: np.ndarray, wrinkle_mask: np.ndarray | None = None) -> WrinkleField:
        import cv2

        cfg = self.config
        if frame_bgr.ndim == 3:
            gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        else:
            gray = np.asarray(frame_bgr)
        gray = gray.astype(np.float32) / 255.0

        if cfg.use_clahe:
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            gray = clahe.apply(np.clip(gray * 255.0, 0, 255).astype(np.uint8)).astype(np.float32) / 255.0

        sigma = max(float(cfg.gaussian_sigma), 0.1)
        smooth = cv2.GaussianBlur(gray, (0, 0), sigmaX=sigma, sigmaY=sigma)
        ixx = cv2.Sobel(smooth, cv2.CV_32F, 2, 0, ksize=3)
        ixy = cv2.Sobel(smooth, cv2.CV_32F, 1, 1, ksize=3)
        iyy = cv2.Sobel(smooth, cv2.CV_32F, 0, 2, ksize=3)

        normal_x, normal_y, lambda_large, lambda_small = _dominant_hessian_axis(ixx, ixy, iyy)
        tangent = np.stack([-normal_y, normal_x], axis=2)
        tangent_norm = np.linalg.norm(tangent, axis=2)
        valid = tangent_norm > 1e-12
        tangent[valid] /= tangent_norm[valid, None]
        tangent[~valid] = np.array([1.0, 0.0], dtype=np.float32)
        tangent = _canonicalize_axial(tangent)

        strength = np.maximum(0.0, np.abs(lambda_large) - np.abs(lambda_small))
        strength = _normalize_strength(strength, cfg.normalize_percentile)
        if wrinkle_mask is not None:
            mask = _resize_mask(wrinkle_mask, strength.shape)
            strength = strength * ((1.0 - cfg.mask_weight) + cfg.mask_weight * mask)
        strength[strength < cfg.min_strength] = 0.0

        return WrinkleField(
            direction_xy=tangent.astype(np.float32),
            strength=strength.astype(np.float32),
            config=cfg,
        )


def _dominant_hessian_axis(
    ixx: np.ndarray,
    ixy: np.ndarray,
    iyy: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    trace = ixx + iyy
    delta = np.sqrt(np.maximum((ixx - iyy) ** 2 + 4.0 * ixy * ixy, 0.0))
    l1 = 0.5 * (trace + delta)
    l2 = 0.5 * (trace - delta)
    use_l1 = np.abs(l1) >= np.abs(l2)
    lam_large = np.where(use_l1, l1, l2)
    lam_small = np.where(use_l1, l2, l1)

    vx = np.where(use_l1, ixy, ixy)
    vy = np.where(use_l1, l1 - ixx, l2 - ixx)
    fallback = (np.abs(vx) + np.abs(vy)) < 1e-9
    vx = np.where(fallback, 1.0, vx)
    vy = np.where(fallback, 0.0, vy)
    norm = np.sqrt(vx * vx + vy * vy)
    vx = vx / np.maximum(norm, 1e-12)
    vy = vy / np.maximum(norm, 1e-12)
    return vx, vy, lam_large, lam_small


def _canonicalize_axial(direction_xy: np.ndarray) -> np.ndarray:
    out = np.asarray(direction_xy, dtype=np.float32).copy()
    flip = (out[:, :, 0] < 0) | ((np.abs(out[:, :, 0]) < 1e-6) & (out[:, :, 1] < 0))
    out[flip] *= -1.0
    return out


def _normalize_strength(strength: np.ndarray, percentile: float) -> np.ndarray:
    values = np.asarray(strength, dtype=np.float32)
    positive = values[values > 0]
    if positive.size == 0:
        return np.zeros_like(values, dtype=np.float32)
    scale = float(np.percentile(positive, np.clip(percentile, 50.0, 100.0)))
    if scale <= 1e-12:
        return np.zeros_like(values, dtype=np.float32)
    return np.clip(values / scale, 0.0, 1.0).astype(np.float32)


def _resize_mask(mask: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    import cv2

    arr = np.asarray(mask)
    if arr.ndim == 3:
        arr = arr[:, :, 0]
    arr = arr.astype(np.float32)
    if arr.max(initial=0.0) > 1.0:
        arr /= 255.0
    if arr.shape != shape:
        arr = cv2.resize(arr, (shape[1], shape[0]), interpolation=cv2.INTER_LINEAR)
    return np.clip(arr, 0.0, 1.0)


def _sample_bilinear(image: np.ndarray, xy: np.ndarray) -> np.ndarray:
    h, w = image.shape[:2]
    x = np.clip(xy[:, 0], 0.0, max(0.0, w - 1.0))
    y = np.clip(xy[:, 1], 0.0, max(0.0, h - 1.0))
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    x1 = np.minimum(x0 + 1, w - 1)
    y1 = np.minimum(y0 + 1, h - 1)
    wx = x - x0
    wy = y - y0
    return (
        (1.0 - wx) * (1.0 - wy) * image[y0, x0]
        + wx * (1.0 - wy) * image[y0, x1]
        + (1.0 - wx) * wy * image[y1, x0]
        + wx * wy * image[y1, x1]
    )
