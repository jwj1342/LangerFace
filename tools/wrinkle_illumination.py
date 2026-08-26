"""Deterministic, training-free illumination correction for wrinkle evidence."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter


@dataclass(frozen=True)
class IlluminationCorrection:
    corrected_bgr: np.ndarray
    corrected_gray: np.ndarray
    illumination: np.ndarray
    gain: np.ndarray
    diagnostics: dict[str, float]


def _percentile(values: np.ndarray, percentile: float) -> float:
    return float(np.percentile(values, percentile))


def correct_illumination(
    image_bgr: np.ndarray,
    face_mask: np.ndarray,
    face_width: float,
    *,
    minimum_gain: float = 0.67,
    maximum_gain: float = 1.50,
) -> IlluminationCorrection:
    """Remove broad facial shading while preserving fine local contrast.

    The only scale input is the measured face width. No image-specific
    thresholds are fitted and no learned parameters or labels are used.
    """
    if image_bgr.ndim != 3 or image_bgr.shape[2] != 3:
        raise ValueError("image_bgr must have shape (height, width, 3)")
    if face_mask.shape != image_bgr.shape[:2]:
        raise ValueError("face_mask must match the image height and width")
    if not np.isfinite(face_width) or face_width <= 0.0:
        raise ValueError("face_width must be finite and positive")
    if not (0.0 < minimum_gain <= 1.0 <= maximum_gain):
        raise ValueError("gain bounds must contain 1.0")

    image_u8 = np.clip(image_bgr, 0, 255).astype(np.uint8, copy=False)
    lab = cv2.cvtColor(image_u8, cv2.COLOR_BGR2LAB)
    luminance = lab[:, :, 0].astype(np.float32) / 255.0
    mask = (face_mask > 0).astype(np.float32)
    if not np.any(mask):
        raise ValueError("face_mask must contain at least one face pixel")

    # The broad field tracks lighting changes, not wrinkle-width structures.
    sigma = float(np.clip(0.065 * face_width, 4.0, 96.0))
    blurred_mask = gaussian_filter(mask, sigma=sigma, mode="constant", cval=0.0)
    blurred_signal = gaussian_filter(
        luminance * mask,
        sigma=sigma,
        mode="constant",
        cval=0.0,
    )
    illumination = blurred_signal / np.maximum(blurred_mask, 1e-4)

    valid = mask > 0.5
    reference = float(np.median(illumination[valid]))
    raw_gain = reference / np.maximum(illumination, 1e-3)
    bounded_gain = np.clip(raw_gain, minimum_gain, maximum_gain).astype(np.float32)

    # Feather only the correction boundary. The interior receives the full
    # bounded gain and pixels away from the face remain exactly unchanged.
    feather_sigma = float(max(1.0, 0.01 * face_width))
    feather = gaussian_filter(mask, sigma=feather_sigma, mode="constant", cval=0.0)
    feather = np.clip(feather, 0.0, 1.0)
    applied_gain = 1.0 + feather * (bounded_gain - 1.0)
    corrected_luminance = np.clip(luminance * applied_gain, 0.0, 1.0)

    corrected_lab = lab.copy()
    corrected_lab[:, :, 0] = np.round(corrected_luminance * 255.0).astype(np.uint8)
    corrected_bgr = cv2.cvtColor(corrected_lab, cv2.COLOR_LAB2BGR)
    outside_correction = feather <= 1e-6
    corrected_bgr[outside_correction] = image_u8[outside_correction]
    corrected_gray = (
        cv2.cvtColor(corrected_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    )

    face_gain = bounded_gain[valid]
    face_input = luminance[valid]
    face_corrected = corrected_luminance[valid]
    clipped = (raw_gain[valid] <= minimum_gain) | (raw_gain[valid] >= maximum_gain)
    diagnostics = {
        "sigmaPx": sigma,
        "faceWidthPx": float(face_width),
        "referenceIllumination": reference,
        "gainP01": _percentile(face_gain, 1.0),
        "gainP50": _percentile(face_gain, 50.0),
        "gainP99": _percentile(face_gain, 99.0),
        "gainClippedFraction": float(np.mean(clipped)),
        "inputFaceLuminanceP10": _percentile(face_input, 10.0),
        "inputFaceLuminanceP90": _percentile(face_input, 90.0),
        "correctedFaceLuminanceP10": _percentile(face_corrected, 10.0),
        "correctedFaceLuminanceP90": _percentile(face_corrected, 90.0),
    }
    return IlluminationCorrection(
        corrected_bgr=corrected_bgr,
        corrected_gray=corrected_gray.astype(np.float32),
        illumination=illumination.astype(np.float32),
        gain=applied_gain.astype(np.float32),
        diagnostics=diagnostics,
    )


def grayscale_debug_image(field: np.ndarray) -> np.ndarray:
    """Convert a finite normalized scalar field into a PNG-ready image."""
    return np.round(np.clip(field, 0.0, 1.0) * 255.0).astype(np.uint8)


def gain_debug_image(gain: np.ndarray, minimum: float = 0.67, maximum: float = 1.50) -> np.ndarray:
    """Map bounded gain to grayscale with unity near the middle."""
    normalized = (gain - minimum) / max(maximum - minimum, 1e-6)
    return grayscale_debug_image(normalized)
