"""Training-free multi-scale Frangi response for dark wrinkle ridges."""

from __future__ import annotations

import numpy as np
from scipy.ndimage import gaussian_filter

DEFAULT_SCALES = (1.0, 1.6, 2.4, 3.4)


def hessian_fields(
    gray: np.ndarray,
    sigma: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    ixx = gaussian_filter(gray, sigma=sigma, order=(0, 2), mode="reflect")
    ixy = gaussian_filter(gray, sigma=sigma, order=(1, 1), mode="reflect")
    iyy = gaussian_filter(gray, sigma=sigma, order=(2, 0), mode="reflect")
    delta = np.sqrt(np.maximum((ixx - iyy) ** 2 + 4.0 * ixy**2, 0.0))
    large = 0.5 * (ixx + iyy + delta)
    small = 0.5 * (ixx + iyy - delta)
    normal = 0.5 * np.arctan2(2.0 * ixy, ixx - iyy)
    return ixx, ixy, iyy, large, small, normal


def dark_ridge_response(
    gray: np.ndarray,
    roi: np.ndarray,
    scales: tuple[float, ...] = DEFAULT_SCALES,
) -> np.ndarray:
    """Return Frangi vesselness with positive curvature treated as a dark ridge."""
    if gray.ndim != 2 or roi.shape != gray.shape:
        raise ValueError("gray and roi must be matching two-dimensional arrays")
    selected_roi = roi > 0
    if not np.any(selected_roi):
        return np.zeros_like(gray, dtype=np.float32)

    best = np.zeros_like(gray, dtype=np.float32)
    for sigma in scales:
        _, _, _, large, small, _ = hessian_fields(gray, sigma)
        large = large * sigma**2
        small = small * sigma**2
        ratio = np.abs(small) / np.maximum(np.abs(large), 1e-8)
        structureness = np.sqrt(large**2 + small**2)
        contrast_scale = max(
            float(np.percentile(structureness[selected_roi], 90.0)),
            1e-6,
        )
        response = np.exp(-(ratio**2) / (2.0 * 0.50**2))
        response *= 1.0 - np.exp(
            -(structureness**2) / (2.0 * contrast_scale**2),
        )
        response[large <= 0.0] = 0.0
        best = np.maximum(best, response.astype(np.float32))
    best[~selected_roi] = 0.0
    return best
