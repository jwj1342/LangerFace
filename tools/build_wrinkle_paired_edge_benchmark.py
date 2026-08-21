"""Build and score local paired-edge wrinkle benchmarks with known centerlines."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from scipy.optimize import linear_sum_assignment

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))

import run_wrinkle_four_class_experiment as v1  # noqa: E402
import run_wrinkle_paired_edge_experiment as paired  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
PROJECT = REPO.parent
DEFAULT_OUTPUT = PROJECT / "langer线-cc" / "wrinkle_paired_edge_synthetic_benchmark_v1"
BASE_CASES = (
    (
        "man",
        PROJECT / "langer线-cc" / "man.jpg",
        PROJECT / "langer线-cc" / "man_landmarks_browser_cpu.json",
    ),
    (
        "woman",
        PROJECT / "langer线-cc" / "new_woman.png",
        PROJECT / "langer线-cc" / "new_woman_landmarks_browser_cpu.json",
    ),
)
PROFILES = {
    "strong": {"depth": 0.105, "sigma": 1.75},
    "subtle": {"depth": 0.065, "sigma": 1.35},
}
CLASS_ORDER = ("forehead", "glabellar", "nasal_dorsum", "crow_feet")
CLASS_COLORS = {
    "forehead": (0, 165, 255),
    "glabellar": (190, 80, 255),
    "nasal_dorsum": (255, 210, 40),
    "crow_feet": (70, 205, 70),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    generate = subparsers.add_parser("generate", help="Generate synthetic wrinkle cases.")
    generate.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    evaluate = subparsers.add_parser("evaluate", help="Evaluate detection outputs under each case.")
    evaluate.add_argument("--root", type=Path, default=DEFAULT_OUTPUT)
    evaluate.add_argument("--prediction-directory", default="detection_v3")
    evaluate.add_argument("--match-distance", type=float, default=6.0)
    evaluate_mask = subparsers.add_parser(
        "evaluate-mask",
        help="Evaluate a prediction against a natural manual wrinkle mask inside anatomical ROIs.",
    )
    evaluate_mask.add_argument("--image", type=Path, required=True)
    evaluate_mask.add_argument("--mask", type=Path, required=True)
    evaluate_mask.add_argument("--landmarks", type=Path, required=True)
    evaluate_mask.add_argument("--prediction", type=Path, required=True)
    evaluate_mask.add_argument("--output", type=Path)
    evaluate_mask.add_argument("--distance", type=float, default=4.0)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def sampled_curve(points: np.ndarray, spacing: float = 1.0) -> np.ndarray:
    segment_lengths = np.linalg.norm(np.diff(points, axis=0), axis=1)
    cumulative = np.concatenate([[0.0], np.cumsum(segment_lengths)])
    count = max(2, int(np.ceil(cumulative[-1] / spacing)) + 1)
    distances = np.linspace(0.0, cumulative[-1], count)
    x = np.interp(distances, cumulative, points[:, 0])
    y = np.interp(distances, cumulative, points[:, 1])
    return np.column_stack([x, y]).astype(np.float32)


def synthetic_lines(anatomy: dict) -> list[dict]:
    face_width = float(anatomy["faceWidthPx"])
    center_x = float(anatomy["centerX"])
    top_y = float(anatomy["topY"])
    brow_y = float(anatomy["browY"])
    nose_root_y = float(anatomy["noseRootY"])
    lines: list[dict] = []

    x = np.linspace(center_x - 0.28 * face_width, center_x + 0.28 * face_width, 64)
    for index, offset in enumerate((0.060, 0.105, 0.150), start=1):
        phase = np.linspace(0.0, np.pi, len(x))
        y = np.full_like(x, top_y + offset * face_width) + 0.006 * face_width * np.sin(phase)
        lines.append({
            "id": f"synthetic-forehead-{index}",
            "class": "forehead",
            "points": sampled_curve(np.column_stack([x, y])),
        })

    y = np.linspace(brow_y - 0.045 * face_width, nose_root_y - 0.035 * face_width, 48)
    for index, side in enumerate((-1.0, 1.0), start=1):
        phase = np.linspace(0.0, np.pi, len(y))
        x = center_x + side * 0.030 * face_width + side * 0.004 * face_width * np.sin(phase)
        lines.append({
            "id": f"synthetic-glabellar-{index}",
            "class": "glabellar",
            "points": sampled_curve(np.column_stack([x, y])),
        })

    x = np.linspace(center_x - 0.060 * face_width, center_x + 0.060 * face_width, 32)
    for index, offset in enumerate((-0.014, 0.006, 0.026), start=1):
        phase = np.linspace(0.0, np.pi, len(x))
        y = np.full_like(x, nose_root_y + offset * face_width) + 0.003 * face_width * np.sin(phase)
        lines.append({
            "id": f"synthetic-nasal-{index}",
            "class": "nasal_dorsum",
            "points": sampled_curve(np.column_stack([x, y])),
        })

    for side_index, (outer_x, outer_y) in enumerate(anatomy["outerCanthi"]):
        side = -1.0 if float(outer_x) < center_x else 1.0
        for ray_index, slope in enumerate((-0.050, 0.0, 0.055), start=1):
            t = np.linspace(0.0, 1.0, 48)
            radius = (0.025 + 0.120 * t) * face_width
            x = float(outer_x) + side * radius
            y = float(outer_y) + slope * face_width * t + 0.008 * face_width * t**2
            lines.append({
                "id": f"synthetic-crow-{side_index + 1}-{ray_index}",
                "class": "crow_feet",
                "points": sampled_curve(np.column_stack([x, y])),
            })
    return lines


def line_mask(lines: list[dict], shape: tuple[int, int]) -> np.ndarray:
    mask = np.zeros(shape, dtype=np.uint8)
    for line in lines:
        points = np.round(np.asarray(line["points"], dtype=np.float32)).astype(np.int32)
        cv2.polylines(mask, [points.reshape(-1, 1, 2)], False, 1, 1, cv2.LINE_8)
    return mask


def render_grooves(image: np.ndarray, mask: np.ndarray, depth: float, sigma: float) -> np.ndarray:
    distance = cv2.distanceTransform((mask == 0).astype(np.uint8), cv2.DIST_L2, 5)
    groove = np.exp(-0.5 * (distance / sigma) ** 2).astype(np.float32)
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB).astype(np.float32)
    lab[..., 0] = np.clip(lab[..., 0] - depth * 255.0 * groove, 0.0, 255.0)
    return cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2BGR)


def serializable_lines(lines: list[dict]) -> list[dict]:
    return [
        {
            "id": line["id"],
            "class": line["class"],
            "points": [
                [round(float(x), 3), round(float(y), 3)]
                for x, y in np.asarray(line["points"], dtype=np.float32)
            ],
        }
        for line in lines
    ]


def generate_cases(output: Path) -> None:
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite existing benchmark: {output}")
    output.mkdir(parents=True)
    manifest = {"schemaVersion": "langerface.paired-edge-synthetic.v1", "cases": []}
    for base_name, image_path, landmark_path in BASE_CASES:
        image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if image is None:
            raise FileNotFoundError(image_path)
        landmark_payload = json.loads(landmark_path.read_text(encoding="utf-8"))
        if landmark_payload["sourceSha256"].upper() != sha256(image_path):
            raise RuntimeError(f"Landmarks do not match source image: {image_path}")
        landmarks = np.asarray(landmark_payload["landmarks"], dtype=np.float32)
        _, _, anatomy = v1.anatomy_regions(landmarks, image.shape[1], image.shape[0])
        lines = synthetic_lines(anatomy)
        mask = line_mask(lines, image.shape[:2])
        for profile_name, profile in PROFILES.items():
            case_name = f"{base_name}_{profile_name}"
            case_dir = output / case_name
            case_dir.mkdir()
            rendered = render_grooves(image, mask, profile["depth"], profile["sigma"])
            input_path = case_dir / "input.png"
            cv2.imwrite(str(input_path), rendered)
            cv2.imwrite(str(case_dir / "ground_truth_mask.png"), mask * 255)
            preview = rendered.copy()
            for line in lines:
                points = np.round(np.asarray(line["points"], dtype=np.float32)).astype(np.int32)
                cv2.polylines(
                    preview,
                    [points.reshape(-1, 1, 2)],
                    False,
                    CLASS_COLORS[line["class"]],
                    1,
                    cv2.LINE_8,
                )
            cv2.imwrite(str(case_dir / "ground_truth_preview.png"), preview)
            synthetic_landmarks = {
                **landmark_payload,
                "source": str(input_path),
                "sourceSha256": sha256(input_path),
                "derivedFrom": str(image_path),
                "derivation": "synthetic_low_contrast_dark_grooves",
            }
            (case_dir / "landmarks.json").write_text(
                json.dumps(synthetic_landmarks, indent=2) + "\n",
                encoding="utf-8",
            )
            ground_truth = {
                "schemaVersion": "langerface.wrinkle-centerline-ground-truth.synthetic.v1",
                "source": {
                    "path": str(input_path),
                    "sha256": sha256(input_path),
                    "width": image.shape[1],
                    "height": image.shape[0],
                },
                "profile": profile,
                "lineCount": len(lines),
                "lineCountByClass": {
                    name: sum(line["class"] == name for line in lines) for name in CLASS_ORDER
                },
                "lines": serializable_lines(lines),
            }
            (case_dir / "ground_truth.json").write_text(
                json.dumps(ground_truth, indent=2) + "\n",
                encoding="utf-8",
            )
            manifest["cases"].append({
                "name": case_name,
                "directory": str(case_dir),
                "profile": profile_name,
            })
    (output / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"output": str(output), "caseCount": len(manifest["cases"])}, indent=2))


def line_distance(left: dict, right: dict) -> float:
    left_points = np.asarray(left["points"], dtype=np.float32)
    right_points = np.asarray(right["points"], dtype=np.float32)
    distances = np.linalg.norm(left_points[:, None, :] - right_points[None, :, :], axis=2)
    return 0.5 * (
        float(np.median(distances.min(axis=1)))
        + float(np.median(distances.min(axis=0)))
    )


def mask_metrics(ground_truth: list[dict], prediction: list[dict], shape: tuple[int, int]) -> dict:
    gt_mask = line_mask(ground_truth, shape)
    prediction_mask = line_mask(prediction, shape)
    gt_distance = cv2.distanceTransform((gt_mask == 0).astype(np.uint8), cv2.DIST_L2, 5)
    prediction_distance = cv2.distanceTransform(
        (prediction_mask == 0).astype(np.uint8),
        cv2.DIST_L2,
        5,
    )
    return {
        "groundTruthCoverageAt4Px": float((prediction_distance[gt_mask > 0] <= 4.0).mean()),
        "predictionPrecisionAt4Px": (
            float((gt_distance[prediction_mask > 0] <= 4.0).mean())
            if prediction_mask.any()
            else 1.0
        ),
    }


def evaluate_case(case_dir: Path, prediction_directory: str, match_distance: float) -> dict:
    truth = json.loads((case_dir / "ground_truth.json").read_text(encoding="utf-8"))
    prediction_path = case_dir / prediction_directory / "paired_edge_fusion.json"
    prediction = json.loads(prediction_path.read_text(encoding="utf-8"))
    ground_truth_lines = truth["lines"]
    predicted_lines = prediction["fusedLines"]
    cost = np.full((len(ground_truth_lines), len(predicted_lines)), 1e6, dtype=np.float32)
    for gt_index, gt_line in enumerate(ground_truth_lines):
        for prediction_index, predicted_line in enumerate(predicted_lines):
            if gt_line["class"] == predicted_line["class"]:
                cost[gt_index, prediction_index] = line_distance(gt_line, predicted_line)
    matched = []
    if cost.size:
        rows, columns = linear_sum_assignment(cost)
        matched = [
            (int(row), int(column), float(cost[row, column]))
            for row, column in zip(rows, columns, strict=True)
            if cost[row, column] <= match_distance
        ]
    metrics = mask_metrics(
        ground_truth_lines,
        predicted_lines,
        (truth["source"]["height"], truth["source"]["width"]),
    )
    metrics.update({
        "case": case_dir.name,
        "groundTruthLineCount": len(ground_truth_lines),
        "predictedLineCount": len(predicted_lines),
        "matchedLineCount": len(matched),
        "lineRecall": len(matched) / max(len(ground_truth_lines), 1),
        "linePrecision": len(matched) / max(len(predicted_lines), 1),
        "medianMatchedDistancePx": (
            float(np.median([item[2] for item in matched])) if matched else None
        ),
        "matchedPairs": [
            {
                "groundTruthId": ground_truth_lines[row]["id"],
                "predictionId": predicted_lines[column]["id"],
                "distancePx": distance,
            }
            for row, column, distance in matched
        ],
    })
    return metrics


def evaluate_benchmark(root: Path, prediction_directory: str, match_distance: float) -> None:
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    cases = [
        evaluate_case(Path(item["directory"]), prediction_directory, match_distance)
        for item in manifest["cases"]
    ]
    summary = {
        "schemaVersion": "langerface.paired-edge-synthetic-evaluation.v1",
        "predictionDirectory": prediction_directory,
        "matchDistancePx": match_distance,
        "caseCount": len(cases),
        "macroLineRecall": float(np.mean([case["lineRecall"] for case in cases])),
        "macroLinePrecision": float(np.mean([case["linePrecision"] for case in cases])),
        "macroGroundTruthCoverageAt4Px": float(
            np.mean([case["groundTruthCoverageAt4Px"] for case in cases]),
        ),
        "macroPredictionPrecisionAt4Px": float(
            np.mean([case["predictionPrecisionAt4Px"] for case in cases]),
        ),
        "cases": cases,
    }
    output = root / f"evaluation_{prediction_directory}.json"
    output.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in summary.items() if key != "cases"}, indent=2))


def binary_mask_metrics(
    truth_mask: np.ndarray,
    prediction_mask: np.ndarray,
    distance: float,
) -> dict:
    truth_distance = cv2.distanceTransform((truth_mask == 0).astype(np.uint8), cv2.DIST_L2, 5)
    prediction_distance = cv2.distanceTransform(
        (prediction_mask == 0).astype(np.uint8),
        cv2.DIST_L2,
        5,
    )
    return {
        "manualPixelCount": int(truth_mask.sum()),
        "predictionPixelCount": int(prediction_mask.sum()),
        "manualCoverage": (
            float((prediction_distance[truth_mask > 0] <= distance).mean())
            if truth_mask.any()
            else None
        ),
        "predictionPrecision": (
            float((truth_distance[prediction_mask > 0] <= distance).mean())
            if prediction_mask.any()
            else 1.0
        ),
    }


def evaluate_manual_mask(
    image_path: Path,
    mask_path: Path,
    landmark_path: Path,
    prediction_path: Path,
    output_path: Path | None,
    distance: float,
) -> None:
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    manual = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise FileNotFoundError(image_path)
    if manual is None:
        raise FileNotFoundError(mask_path)
    if manual.shape != image.shape[:2]:
        raise RuntimeError(f"Manual mask shape {manual.shape} does not match image {image.shape[:2]}")
    source_hash = sha256(image_path)
    landmark_payload = json.loads(landmark_path.read_text(encoding="utf-8"))
    if landmark_payload["sourceSha256"].upper() != source_hash:
        raise RuntimeError("Landmarks do not match evaluation image")
    prediction = json.loads(prediction_path.read_text(encoding="utf-8"))
    if prediction["source"]["sha256"].upper() != source_hash:
        raise RuntimeError("Prediction does not match evaluation image")

    landmarks = np.asarray(landmark_payload["landmarks"], dtype=np.float32)
    regions, _, _ = paired.experiment_regions(landmarks, image.shape[1], image.shape[0])
    manual_binary = manual >= 128
    class_metrics = {}
    roi_union = np.zeros(image.shape[:2], dtype=bool)
    prediction_union = np.zeros(image.shape[:2], dtype=np.uint8)
    for class_name in CLASS_ORDER:
        region = regions[class_name].astype(bool)
        roi_union |= region
        truth = (manual_binary & region).astype(np.uint8)
        class_lines = [line for line in prediction["fusedLines"] if line["class"] == class_name]
        predicted = line_mask(class_lines, image.shape[:2])
        predicted &= region.astype(np.uint8)
        prediction_union |= predicted
        class_metrics[class_name] = {
            "lineCount": len(class_lines),
            **binary_mask_metrics(truth, predicted, distance),
        }
    overall_truth = (manual_binary & roi_union).astype(np.uint8)
    result = {
        "schemaVersion": "langerface.paired-edge-natural-mask-evaluation.v1",
        "source": {"path": str(image_path), "sha256": source_hash},
        "manualMask": str(mask_path),
        "prediction": str(prediction_path),
        "distancePx": distance,
        "overall": binary_mask_metrics(overall_truth, prediction_union, distance),
        "classes": class_metrics,
    }
    if output_path is None:
        output_path = prediction_path.parent / "manual_mask_evaluation.json"
    output_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


def main() -> int:
    args = parse_args()
    if args.command == "generate":
        generate_cases(args.output)
    elif args.command == "evaluate":
        evaluate_benchmark(args.root, args.prediction_directory, args.match_distance)
    else:
        evaluate_manual_mask(
            args.image,
            args.mask,
            args.landmarks,
            args.prediction,
            args.output,
            args.distance,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
