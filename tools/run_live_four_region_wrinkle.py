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


def recover_glabellar_pair(payload: dict, center_x: float, face_width: float) -> None:
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


def response_payload(
    paired_payload: dict,
    source_sha256: str,
    width: int,
    height: int,
    checkpoint_sha256: str,
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
    if any(class_counts[name] == 0 for name in CLASS_MAP):
        raise RuntimeError(f"Four-region detector returned an empty region: {class_counts}")
    return {
        "schemaVersion": "langerface.wrinkle-fine-lines.v1",
        "detectorVersion": "paired-edge-v10-dynamic-four-region-1.0",
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
        },
        "lines": lines,
    }


def run(args: argparse.Namespace) -> None:
    if args.request is None or args.rgba is None or args.output is None:
        raise ValueError("--request, --rgba and --output are required")
    request = json.loads(args.request.read_text(encoding="utf-8"))
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
        output=paired_output,
    ))
    result = json.loads((paired_output / "paired_edge_fusion.json").read_text(encoding="utf-8"))
    _, _, anatomy = paired.experiment_regions(landmarks, width, height)
    recover_glabellar_pair(result, float(anatomy["centerX"]), float(anatomy["faceWidthPx"]))
    response = response_payload(
        result,
        source_sha256,
        width,
        height,
        hashlib.sha256(args.checkpoint.read_bytes()).hexdigest(),
    )
    (args.output / "response.json").write_text(
        json.dumps(response, ensure_ascii=False),
        encoding="utf-8",
    )
    print(json.dumps(response["summary"], ensure_ascii=False))


def serve(checkpoint: Path) -> None:
    # Load the immutable checkpoint before the first request so all images use
    # the same warm model path without paying initialization latency on upload.
    four_class.warm_unet(checkpoint)
    sys.stdout.write(json.dumps({
        "type": "ready",
        "detectorVersion": "paired-edge-v10-dynamic-four-region-1.0",
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
