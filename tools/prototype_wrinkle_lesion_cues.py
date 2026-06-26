#!/usr/bin/env python3
"""Synthetic wrinkle and lesion cue prototype for Stage 2 planning.

This script is intentionally limited to synthetic data. It gives issue #22 a
repeatable CV baseline without introducing real patient imagery or unchecked
model outputs into the web app.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np


def _polyline_mask(mask: np.ndarray, points: list[tuple[int, int]], thickness: int) -> None:
    pts = np.asarray(points, dtype=np.int32).reshape((-1, 1, 2))
    cv2.polylines(mask, [pts], isClosed=False, color=255, thickness=thickness, lineType=cv2.LINE_AA)


def make_synthetic_case(size: int = 256) -> dict[str, Any]:
    """Return a synthetic BGR image and ground-truth masks.

    The sample contains a red cutaneous lesion and dark wrinkle/crease cues.
    It is not meant to resemble a real patient; it only exercises the export
    and metric contracts.
    """

    image = np.full((size, size, 3), (146, 176, 206), dtype=np.uint8)
    lesion_mask = np.zeros((size, size), dtype=np.uint8)
    wrinkle_mask = np.zeros((size, size), dtype=np.uint8)

    center = (int(size * 0.60), int(size * 0.53))
    axes = (int(size * 0.075), int(size * 0.052))
    cv2.ellipse(lesion_mask, center, axes, 18, 0, 360, 255, -1, cv2.LINE_AA)
    cv2.ellipse(image, center, axes, 18, 0, 360, (55, 66, 214), -1, cv2.LINE_AA)
    cv2.ellipse(image, center, axes, 18, 0, 360, (32, 40, 150), 2, cv2.LINE_AA)
    cv2.ellipse(lesion_mask, center, axes, 18, 0, 360, 255, 2, cv2.LINE_AA)

    wrinkle_sets = [
        [(48, 70), (85, 64), (125, 66), (170, 61), (208, 66)],
        [(68, 100), (92, 94), (114, 95)],
        [(177, 96), (195, 91), (216, 93)],
        [(82, 119), (71, 144), (78, 171), (99, 198)],
        [(170, 122), (188, 147), (186, 174), (163, 200)],
        [(99, 210), (125, 216), (154, 212)],
    ]
    for pts in wrinkle_sets:
        scaled = [(int(x * size / 256), int(y * size / 256)) for x, y in pts]
        _polyline_mask(wrinkle_mask, scaled, thickness=max(2, size // 96))

    image[wrinkle_mask > 0] = (72, 76, 86)
    return {"image_bgr": image, "truth": {"lesion_mask": lesion_mask, "wrinkle_mask": wrinkle_mask}}


def _clean_mask(mask: np.ndarray, kernel_size: int = 3) -> np.ndarray:
    kernel = np.ones((kernel_size, kernel_size), dtype=np.uint8)
    opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    return cv2.morphologyEx(opened, cv2.MORPH_CLOSE, kernel)


def _contours_to_polylines(mask: np.ndarray, *, min_area: float = 8.0) -> list[list[list[int]]]:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    lines: list[list[list[int]]] = []
    for contour in contours:
        if cv2.contourArea(contour) < min_area and cv2.arcLength(contour, closed=False) < min_area:
            continue
        eps = max(1.5, 0.01 * cv2.arcLength(contour, closed=True))
        approx = cv2.approxPolyDP(contour, eps, closed=True)
        lines.append([[int(p[0][0]), int(p[0][1])] for p in approx])
    return lines


def detect_cues(image_bgr: np.ndarray) -> dict[str, Any]:
    """Detect low-confidence wrinkle and lesion cues from a BGR image."""

    b, g, r = cv2.split(image_bgr)
    r_i = r.astype(np.int16)
    lesion = ((r_i > g.astype(np.int16) + 35) & (r_i > b.astype(np.int16) + 45) & (r > 145))
    lesion_mask = (lesion.astype(np.uint8)) * 255

    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    dark = cv2.inRange(gray, 0, 118)
    lesion_dilate = cv2.dilate(lesion_mask, np.ones((7, 7), dtype=np.uint8))
    wrinkle_mask = cv2.bitwise_and(dark, cv2.bitwise_not(lesion_dilate))

    return {
        "lesion_mask": lesion_mask,
        "wrinkle_mask": wrinkle_mask,
        "lesion_polylines": _contours_to_polylines(lesion_mask, min_area=12.0),
        "wrinkle_polylines": _contours_to_polylines(wrinkle_mask, min_area=5.0),
        "confidence_label": "low_confidence_cv_cue_requires_manual_confirmation",
    }


def binary_metrics(pred_mask: np.ndarray, truth_mask: np.ndarray) -> dict[str, float]:
    pred = pred_mask > 0
    truth = truth_mask > 0
    tp = int(np.logical_and(pred, truth).sum())
    fp = int(np.logical_and(pred, ~truth).sum())
    fn = int(np.logical_and(~pred, truth).sum())
    union = int(np.logical_or(pred, truth).sum())
    return {
        "precision": tp / max(tp + fp, 1),
        "recall": tp / max(tp + fn, 1),
        "iou": tp / max(union, 1),
        "tp": float(tp),
        "fp": float(fp),
        "fn": float(fn),
    }


def _overlay(image_bgr: np.ndarray, cues: dict[str, Any]) -> np.ndarray:
    overlay = image_bgr.copy()
    for line in cues["wrinkle_polylines"]:
        pts = np.asarray(line, dtype=np.int32).reshape((-1, 1, 2))
        cv2.polylines(overlay, [pts], isClosed=True, color=(255, 220, 60), thickness=1, lineType=cv2.LINE_AA)
    for line in cues["lesion_polylines"]:
        pts = np.asarray(line, dtype=np.int32).reshape((-1, 1, 2))
        cv2.polylines(overlay, [pts], isClosed=True, color=(0, 255, 255), thickness=2, lineType=cv2.LINE_AA)
    return overlay


def run_synthetic(output_dir: str | Path) -> dict[str, Any]:
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    case = make_synthetic_case()
    cues = detect_cues(case["image_bgr"])
    metrics = {
        "lesion": binary_metrics(cues["lesion_mask"], case["truth"]["lesion_mask"]),
        "wrinkle": binary_metrics(cues["wrinkle_mask"], case["truth"]["wrinkle_mask"]),
        "confidence_label": cues["confidence_label"],
        "outputs": {
            "synthetic_input": "synthetic_input.png",
            "cue_overlay": "cue_overlay.png",
            "lesion_mask": "lesion_mask.png",
            "wrinkle_mask": "wrinkle_mask.png",
        },
    }
    cv2.imwrite(str(output / "synthetic_input.png"), case["image_bgr"])
    cv2.imwrite(str(output / "cue_overlay.png"), _overlay(case["image_bgr"], cues))
    cv2.imwrite(str(output / "lesion_mask.png"), cues["lesion_mask"])
    cv2.imwrite(str(output / "wrinkle_mask.png"), cues["wrinkle_mask"])
    (output / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    return metrics


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="local_outputs/wrinkle_lesion_cues")
    args = parser.parse_args()
    metrics = run_synthetic(args.output_dir)
    print(json.dumps(metrics, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
