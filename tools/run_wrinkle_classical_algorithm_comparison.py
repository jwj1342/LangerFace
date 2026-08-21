"""Compare six training-free classical wrinkle detectors on one source image."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from scipy.ndimage import binary_propagation, gaussian_filter, map_coordinates

import run_wrinkle_fine_line_experiment as fine
import run_wrinkle_four_class_experiment as v1
import run_wrinkle_paired_edge_experiment as paired
import wrinkle_frangi

REPO = Path(__file__).resolve().parents[1]
PROJECT = REPO.parent
DEFAULT_INPUT = PROJECT / "langer线-cc" / "wrinkle.png"
DEFAULT_LANDMARKS = PROJECT / "langer线-cc" / "wrinkle_landmarks_browser_cpu.json"
DEFAULT_OUTPUT = PROJECT / "langer线-cc" / "wrinkle_classical_algorithm_comparison_v3_lines"
SCALES = (1.0, 1.6, 2.4, 3.4)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--landmarks", type=Path, default=DEFAULT_LANDMARKS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def steger_dark_lines(gray: np.ndarray) -> np.ndarray:
    """Steger ridge centers using Hessian normals and subpixel stationarity."""
    best = np.zeros_like(gray, dtype=np.float32)
    for sigma in SCALES:
        ixx, ixy, iyy, large, small, normal = wrinkle_frangi.hessian_fields(gray, sigma)
        gradient_x = gaussian_filter(gray, sigma=sigma, order=(0, 1), mode="reflect")
        gradient_y = gaussian_filter(gray, sigma=sigma, order=(1, 0), mode="reflect")
        normal_x = np.cos(normal)
        normal_y = np.sin(normal)
        denominator = (
            normal_x**2 * ixx
            + 2.0 * normal_x * normal_y * ixy
            + normal_y**2 * iyy
        )
        offset = -(
            gradient_x * normal_x + gradient_y * normal_y
        ) / np.where(np.abs(denominator) > 1e-8, denominator, np.inf)
        positive = np.maximum(large * sigma**2, 0.0)
        line_shape = np.exp(
            -(
                np.abs(small) / np.maximum(np.abs(large), 1e-8)
            ) ** 2
            / (2.0 * 0.45**2),
        )
        response = positive * line_shape
        response[np.abs(offset) > 0.60] = 0.0
        best = np.maximum(best, response.astype(np.float32))
    return best


def gabor_dark_lines(gray: np.ndarray) -> np.ndarray:
    """Maximum dark-line response from a multi-scale oriented Gabor bank."""
    best = np.zeros_like(gray, dtype=np.float32)
    for sigma, wavelength in ((2.2, 5.5), (3.6, 8.5), (5.0, 12.0)):
        kernel_size = int(np.ceil(6.0 * sigma)) | 1
        for theta in np.linspace(0.0, np.pi, 12, endpoint=False):
            kernel = cv2.getGaborKernel(
                (kernel_size, kernel_size),
                sigma,
                float(theta),
                wavelength,
                0.38,
                0.0,
                ktype=cv2.CV_32F,
            )
            kernel -= float(kernel.mean())
            kernel /= max(float(np.abs(kernel).sum()), 1e-8)
            filtered = cv2.filter2D(gray, cv2.CV_32F, kernel, borderType=cv2.BORDER_REFLECT)
            best = np.maximum(best, np.maximum(-filtered, 0.0))
    return best


def blackhat_dark_lines(gray: np.ndarray) -> np.ndarray:
    """Multi-scale morphological black-hat response for dark local grooves."""
    source = np.round(np.clip(gray, 0.0, 1.0) * 255.0).astype(np.uint8)
    best = np.zeros_like(gray, dtype=np.float32)
    for diameter in (5, 9, 13, 17):
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (diameter, diameter))
        response = cv2.morphologyEx(source, cv2.MORPH_BLACKHAT, kernel)
        best = np.maximum(best, response.astype(np.float32) / 255.0)
    return best


def phase_congruency_dark_lines(gray: np.ndarray, roi: np.ndarray) -> np.ndarray:
    """Dark-line phase congruency from an oriented Log-Gabor quadrature bank."""
    height, width = gray.shape
    frequency_y = np.fft.fftfreq(height).astype(np.float32)[:, None]
    frequency_x = np.fft.fftfreq(width).astype(np.float32)[None, :]
    radius = np.sqrt(frequency_x**2 + frequency_y**2)
    radius[0, 0] = 1.0
    frequency_angle = np.arctan2(frequency_y, frequency_x)
    spectrum = np.fft.fft2(gray - float(np.mean(gray[roi > 0])))
    best = np.zeros_like(gray, dtype=np.float32)
    orientation_count = 8
    angular_sigma = np.pi / orientation_count / 1.5

    for orientation in np.linspace(0.0, np.pi, orientation_count, endpoint=False):
        angle_delta = np.arctan2(
            np.sin(frequency_angle - orientation),
            np.cos(frequency_angle - orientation),
        )
        spread = np.exp(-(angle_delta**2) / (2.0 * angular_sigma**2))
        projection = frequency_x * np.cos(orientation) + frequency_y * np.sin(orientation)
        sum_even = np.zeros_like(gray, dtype=np.float32)
        sum_odd = np.zeros_like(gray, dtype=np.float32)
        sum_amplitude = np.zeros_like(gray, dtype=np.float32)

        for wavelength in (4.0, 7.0, 12.0, 20.0):
            center_frequency = 1.0 / wavelength
            log_gabor = np.exp(
                -(np.log(radius / center_frequency) ** 2)
                / (2.0 * np.log(0.58) ** 2),
            )
            log_gabor[0, 0] = 0.0
            even_filter = log_gabor * spread
            odd_filter = 1j * np.sign(projection) * even_filter
            even = np.fft.ifft2(spectrum * even_filter).real.astype(np.float32)
            odd = np.fft.ifft2(spectrum * odd_filter).real.astype(np.float32)
            sum_even += even
            sum_odd += odd
            sum_amplitude += np.sqrt(even**2 + odd**2)

        energy = np.sqrt(sum_even**2 + sum_odd**2)
        selected = sum_amplitude[roi > 0]
        noise_floor = 1.5 * float(np.percentile(selected, 15.0))
        congruency = np.maximum(energy - noise_floor, 0.0) / np.maximum(
            sum_amplitude,
            1e-8,
        )
        dark_polarity = np.clip(-sum_even / np.maximum(energy, 1e-8), 0.0, 1.0)
        best = np.maximum(best, (congruency * dark_polarity).astype(np.float32))
    return best


def paired_edge_dark_centers(gray: np.ndarray) -> np.ndarray:
    _, tangent, _ = fine.dark_ridge_field(gray)
    response, _, balance, agreement = paired.paired_edge_center_field(gray, tangent)
    return (response * np.sqrt(balance) * (0.55 + 0.45 * agreement)).astype(np.float32)


def normalize_response(
    response: np.ndarray,
    regions: dict[str, np.ndarray],
) -> np.ndarray:
    normalized = np.zeros_like(response, dtype=np.float32)
    for class_name in fine.CLASS_ORDER:
        region = regions[class_name]
        score = fine.robust_unit(response, region)
        normalized = np.maximum(normalized, score * region)
    return normalized


def scaled_odd(value: float, face_width: float, minimum: int = 3) -> int:
    size = max(minimum, int(round(value * face_width)))
    return size if size % 2 else size + 1


def candidate_mask(
    normalized: np.ndarray,
    regions: dict[str, np.ndarray],
    face_width: float,
) -> np.ndarray:
    connected_union = np.zeros_like(normalized, dtype=np.uint8)
    close_shapes = {
        "forehead": (0.035, 0.005),
        "glabellar": (0.005, 0.028),
        "nasal_dorsum": (0.026, 0.005),
        "crow_feet": (0.010, 0.010),
    }
    for class_name in fine.CLASS_ORDER:
        region = regions[class_name] > 0
        weak = (normalized >= 0.20) & region
        strong = (normalized >= 0.48) & region
        connected = binary_propagation(
            strong,
            mask=weak,
            structure=np.ones((3, 3), dtype=bool),
        ).astype(np.uint8)
        width_fraction, height_fraction = close_shapes[class_name]
        kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE,
            (
                scaled_odd(width_fraction, face_width),
                scaled_odd(height_fraction, face_width),
            ),
        )
        closed = cv2.morphologyEx(connected, cv2.MORPH_CLOSE, kernel)
        connected_union |= closed & region.astype(np.uint8)
    skeleton = v1.morphological_skeleton(connected_union)
    return v1.component_filter(
        skeleton,
        minimum_pixels=5,
        minimum_span=max(6, int(round(0.012 * face_width))),
    )


def sampled_response(path: np.ndarray, response: np.ndarray) -> float:
    values = map_coordinates(
        response,
        [path[:, 1], path[:, 0]],
        order=1,
        mode="constant",
        cval=0.0,
    )
    return float(np.mean(values)) if len(values) else 0.0


def merge_line_fragments(
    fragments: list[dict],
    response: np.ndarray,
    face_width: float,
) -> list[dict]:
    merged = [dict(fragment) for fragment in fragments]
    while True:
        best_pair = None
        best_gap = float("inf")
        for left_index, left in enumerate(merged):
            for right_index in range(left_index + 1, len(merged)):
                related, gap = paired.fragment_relationship(
                    left,
                    merged[right_index],
                    face_width,
                )
                if related and gap < best_gap:
                    best_pair = (left_index, right_index)
                    best_gap = gap
        if best_pair is None:
            break
        left_index, right_index = best_pair
        points = paired.joined_paths(
            np.asarray(merged[left_index]["points"], dtype=np.float32),
            np.asarray(merged[right_index]["points"], dtype=np.float32),
        )
        combined = {
            "class": merged[left_index]["class"],
            "points": points,
            "lengthPx": fine.path_length(points),
            "meanResponse": sampled_response(points, response),
            "fragmentCount": (
                int(merged[left_index].get("fragmentCount", 1))
                + int(merged[right_index].get("fragmentCount", 1))
            ),
        }
        merged = [
            line
            for index, line in enumerate(merged)
            if index not in {left_index, right_index}
        ]
        merged.append(combined)
    return merged


def trace_lines(
    candidates: np.ndarray,
    response: np.ndarray,
    regions: dict[str, np.ndarray],
    face_width: float,
) -> list[dict]:
    minimum_length_fraction = {
        "forehead": 0.10,
        "glabellar": 0.055,
        "nasal_dorsum": 0.040,
        "crow_feet": 0.035,
    }
    maximum_lines = {
        "forehead": 6,
        "glabellar": 4,
        "nasal_dorsum": 4,
        "crow_feet": 10,
    }
    output = []
    for class_name in fine.CLASS_ORDER:
        class_mask = (candidates & regions[class_name]).astype(np.uint8)
        count, labels, stats, _ = cv2.connectedComponentsWithStats(class_mask, 8)
        fragments = []
        for component_id in range(1, count):
            if int(stats[component_id, cv2.CC_STAT_AREA]) < 5:
                continue
            path, length = fine.longest_path((labels == component_id).astype(np.uint8))
            if length < 0.012 * face_width or len(path) < 5:
                continue
            path = fine.smooth_path(path)
            fragments.append({
                "class": class_name,
                "points": path,
                "lengthPx": fine.path_length(path),
                "meanResponse": sampled_response(path, response),
                "fragmentCount": 1,
            })
        merged = merge_line_fragments(fragments, response, face_width)
        accepted = [
            line
            for line in merged
            if float(line["lengthPx"]) >= minimum_length_fraction[class_name] * face_width
            and float(line["meanResponse"]) >= 0.24
        ]
        accepted.sort(
            key=lambda line: float(line["lengthPx"]) * float(line["meanResponse"]),
            reverse=True,
        )
        output.extend(accepted[: maximum_lines[class_name]])
    for index, line in enumerate(output, start=1):
        line["id"] = f"classical-line-{index:03d}"
        points = np.asarray(line["points"], dtype=np.float32)
        line["points"] = [
            [round(float(x), 3), round(float(y), 3)]
            for x, y in points
        ]
        line["lengthPx"] = round(float(line["lengthPx"]), 3)
        line["meanResponse"] = round(float(line["meanResponse"]), 6)
    return output


def line_mask(lines: list[dict], shape: tuple[int, int]) -> np.ndarray:
    output = np.zeros(shape, dtype=np.uint8)
    for line in lines:
        points = np.round(np.asarray(line["points"], dtype=np.float32)).astype(np.int32)
        cv2.polylines(output, [points.reshape(-1, 1, 2)], False, 1, 1, cv2.LINE_8)
    return output


def detection_overlay(image: np.ndarray, lines: list[dict]) -> np.ndarray:
    output = image.copy()
    for line in lines:
        points = np.round(np.asarray(line["points"], dtype=np.float32)).astype(np.int32)
        cv2.polylines(
            output,
            [points.reshape(-1, 1, 2)],
            False,
            (40, 245, 255),
            2,
            cv2.LINE_AA,
        )
    return output


def run(args: argparse.Namespace) -> None:
    if args.output.exists():
        raise FileExistsError(f"Refusing to overwrite existing output directory: {args.output}")
    args.output.mkdir(parents=True)
    image = cv2.imread(str(args.input), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(args.input)
    payload = json.loads(args.landmarks.read_text(encoding="utf-8"))
    if payload["sourceSha256"].upper() != v1.sha256(args.input):
        raise RuntimeError("Landmarks do not match the source image")
    landmarks = np.asarray(payload["landmarks"], dtype=np.float32)
    height, width = image.shape[:2]
    regions, _, anatomy = paired.experiment_regions(landmarks, width, height)
    roi = np.zeros((height, width), dtype=np.uint8)
    for region in regions.values():
        roi |= region.astype(np.uint8)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0

    detectors = {
        "01_steger": lambda: steger_dark_lines(gray),
        "02_frangi_hessian": lambda: wrinkle_frangi.dark_ridge_response(gray, roi),
        "03_gabor": lambda: gabor_dark_lines(gray),
        "04_blackhat": lambda: blackhat_dark_lines(gray),
        "05_phase_congruency": lambda: phase_congruency_dark_lines(gray, roi),
        "06_paired_edge": lambda: paired_edge_dark_centers(gray),
    }
    overview_panels = []
    diagnostics = {}
    line_masks = {}
    algorithm_lines = {}
    for name, detector in detectors.items():
        response = detector()
        if response.shape != gray.shape or not np.isfinite(response).all():
            raise RuntimeError(f"Invalid response from {name}")
        normalized = normalize_response(response, regions)
        face_width = float(anatomy["faceWidthPx"])
        candidates = candidate_mask(normalized, regions, face_width)
        lines = trace_lines(candidates, normalized, regions, face_width)
        final_mask = line_mask(lines, gray.shape)
        heatmap = fine.response_heatmap(image, normalized)
        fragments_overlay = v1.draw_skeleton(image, candidates, (255, 180, 0), 1)
        overlay = detection_overlay(image, lines)
        cv2.imwrite(str(args.output / f"{name}_response.png"), heatmap)
        cv2.imwrite(str(args.output / f"{name}_fragments.png"), fragments_overlay)
        cv2.imwrite(str(args.output / f"{name}_detections.png"), overlay)
        cv2.imwrite(str(args.output / f"{name}_mask.png"), final_mask * 255)
        overview_panels.append((name.removeprefix(name[:3]).replace("_", " ").title(), overlay))
        line_masks[name] = final_mask.astype(bool)
        algorithm_lines[name] = lines
        diagnostics[name] = {
            "responseMaximum": float(response.max()),
            "normalizedNonzeroPixels": int(np.count_nonzero(normalized)),
            "candidatePixels": int(np.count_nonzero(candidates)),
            "lineCount": len(lines),
            "totalLineLengthPx": round(sum(float(line["lengthPx"]) for line in lines), 3),
            "lineCountByClass": {
                class_name: sum(line["class"] == class_name for line in lines)
                for class_name in fine.CLASS_ORDER
            },
        }

    overview = fine.montage(overview_panels, width=560)
    cv2.imwrite(str(args.output / "COMPARISON_six_algorithms.png"), overview)
    pairwise_iou = {}
    names = list(line_masks)
    for left_index, left_name in enumerate(names):
        for right_name in names[left_index + 1:]:
            left = line_masks[left_name]
            right = line_masks[right_name]
            union = np.count_nonzero(left | right)
            pairwise_iou[f"{left_name}__{right_name}"] = (
                float(np.count_nonzero(left & right) / union) if union else 1.0
            )

    result = {
        "schemaVersion": "langerface.wrinkle-classical-comparison.v1",
        "trainingPerformed": False,
        "illuminationCorrectionApplied": False,
        "source": {
            "path": str(args.input),
            "sha256": v1.sha256(args.input),
            "width": width,
            "height": height,
        },
        "sharedPostprocessing": {
            "anatomicalRoi": list(fine.CLASS_ORDER),
            "hysteresisThresholds": {"weak": 0.20, "strong": 0.48},
            "fragmentTracing": "longest_geodesic_path_per_connected_component",
            "fragmentJoining": "collinear_endpoints_with_class_specific_maximum_gap",
            "minimumLineLengthFaceWidthFractionByClass": {
                "forehead": 0.10,
                "glabellar": 0.055,
                "nasal_dorsum": 0.040,
                "crow_feet": 0.035,
            },
        },
        "algorithms": diagnostics,
        "pairwiseCandidateIoU": pairwise_iou,
        "lines": algorithm_lines,
    }
    (args.output / "diagnostics.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"output": str(args.output), "algorithms": diagnostics}, indent=2))


def main() -> int:
    run(parse_args())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
