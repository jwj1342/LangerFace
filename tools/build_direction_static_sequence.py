"""Build the privacy-minimized real-frame fixture for RSTL direction stability.

The source video and full 478-point detections remain local.  The committed
fixture keeps only the normalized query point, two face-bounds points, and nine
nearby mapped RSTL samples required to replay ``query_direction``.  This
preserves real detector jitter without publishing raw frames or full landmark
sets.

Example:

    PYTHONPATH=src python tools/build_direction_static_sequence.py \
      --video local_media/IMG_3458.MOV

This source path requires the optional MediaPipe and OpenCV dependencies.  CI
does not run it; CI replays the committed derivative fixture in Python and
TypeScript.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from langerface.config import ATLAS_PATHS, CANONICAL_OBJ, FACE_LANDMARKER_TASK
from langerface.geometry import CanonicalFaceModel
from langerface.lines import Atlas, map_atlas, query_direction

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VIDEO = ROOT / "local_media" / "IMG_3458.MOV"
DEFAULT_OUTPUT = ROOT / "web" / "test" / "rstl_direction_contract.json"
FRAME_START = 54
FRAME_COUNT = 100
QUERY_LANDMARK_INDEX = 205
ATLAS_LINE_NAME = "standard_field_0135_right"
LOCAL_ATLAS_POINT_COUNT = 9
ROUND_DECIMALS = 8
THRESHOLDS = {
    "max_axial_angle_range_deg": 6.0,
    "max_interframe_angle_delta_deg": 1.5,
    "max_angle_std_dev_deg": 2.0,
    "min_confidence": 0.95,
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _local_line_points(points: np.ndarray, query: np.ndarray) -> np.ndarray:
    nearest = int(np.argmin(np.linalg.norm(points - query, axis=1)))
    start = max(0, min(len(points) - LOCAL_ATLAS_POINT_COUNT, nearest - 4))
    return points[start : start + LOCAL_ATLAS_POINT_COUNT]


def build_sequence(video_path: Path, frame_start: int = FRAME_START) -> dict:
    import cv2  # noqa: PLC0415 - optional source-only dependency

    from langerface.detection import FaceLandmarkDetector  # noqa: PLC0415

    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    atlas = Atlas.load(ATLAS_PATHS["rstl"])
    detector = FaceLandmarkDetector(FACE_LANDMARKER_TASK, mode="image", num_faces=1)
    capture = cv2.VideoCapture(str(video_path))
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    frames: list[dict] = []
    capture.set(cv2.CAP_PROP_POS_FRAMES, frame_start)
    try:
        for offset in range(FRAME_COUNT):
            frame_index = frame_start + offset
            ok, image = capture.read()
            if not ok:
                raise RuntimeError(f"cannot read source frame {frame_index}")
            faces = detector.detect(image)
            if len(faces) != 1:
                raise RuntimeError(f"expected one face at source frame {frame_index}, got {len(faces)}")

            landmarks = np.asarray(faces[0].landmarks_px, dtype=np.float64)
            query = landmarks[QUERY_LANDMARK_INDEX]
            mapped = map_atlas(atlas, landmarks, canonical.triangles)
            line = next((item for item in mapped if item.name == ATLAS_LINE_NAME), None)
            if line is None:
                raise RuntimeError(f"atlas line {ATLAS_LINE_NAME!r} is missing")
            local_points = _local_line_points(np.asarray(line.pts, dtype=np.float64), query)

            low = landmarks.min(axis=0)
            high = landmarks.max(axis=0)
            center = (low + high) * 0.5
            scale = max(float(high[0] - low[0]), float(high[1] - low[1]), 1e-9)
            point = np.round((query - center) / scale, ROUND_DECIMALS).tolist()
            vertices = np.round(
                np.vstack([(low - center) / scale, (high - center) / scale]),
                ROUND_DECIMALS,
            ).tolist()
            atlas_points = np.round(
                (local_points - center) / scale,
                ROUND_DECIMALS,
            ).tolist()
            local_atlas = {
                "system": "rstl",
                "lines": [{"name": ATLAS_LINE_NAME, "points3d": atlas_points}],
            }
            result = query_direction(point, vertices, [], local_atlas)
            frames.append(
                {
                    "frame_index": frame_index,
                    "point": point,
                    "vertices": vertices,
                    "triangles": [],
                    "atlas": local_atlas,
                    "expected": result.to_dict(),
                }
            )
    finally:
        capture.release()
        detector.close()

    angles = np.asarray([frame["expected"]["angle_deg"] for frame in frames])
    confidences = np.asarray([frame["expected"]["confidence"] for frame in frames])
    observed = {
        "axial_angle_range_deg": float(np.ptp(angles)),
        "max_interframe_angle_delta_deg": float(np.max(np.abs(np.diff(angles)))),
        "angle_std_dev_deg": float(np.std(angles)),
        "min_confidence": float(np.min(confidences)),
    }
    if observed["axial_angle_range_deg"] > THRESHOLDS["max_axial_angle_range_deg"]:
        raise RuntimeError(f"angle range exceeds fixture threshold: {observed}")
    if (
        observed["max_interframe_angle_delta_deg"]
        > THRESHOLDS["max_interframe_angle_delta_deg"]
    ):
        raise RuntimeError(f"interframe delta exceeds fixture threshold: {observed}")
    if observed["angle_std_dev_deg"] > THRESHOLDS["max_angle_std_dev_deg"]:
        raise RuntimeError(f"angle standard deviation exceeds fixture threshold: {observed}")
    if observed["min_confidence"] < THRESHOLDS["min_confidence"]:
        raise RuntimeError(f"confidence falls below fixture threshold: {observed}")

    return {
        "source": {
            "kind": "privacy_minimized_real_landmark_sequence",
            "description": (
                "100 consecutive frames from a held-pose local face capture. "
                "Only normalized query/bounds/local-atlas derivatives are committed; "
                "raw frames and full 478-point landmarks remain local."
            ),
            "private_media_path": "local_media/IMG_3458.MOV",
            "private_media_sha256": _sha256(video_path),
            "source_frame_start": frame_start,
            "source_frame_end": frame_start + FRAME_COUNT - 1,
            "source_fps": round(fps, 6),
            "detector_mode": "mediapipe_face_landmarker_image",
            "detected_landmark_count": 478,
            "query_landmark_index": QUERY_LANDMARK_INDEX,
            "atlas_line": ATLAS_LINE_NAME,
            "local_atlas_point_count": LOCAL_ATLAS_POINT_COUNT,
            "normalization": "face_bbox_centered_uniform_max_xy_span",
        },
        "thresholds": {"frame_count": FRAME_COUNT, **THRESHOLDS},
        "observed": observed,
        "frames": frames,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, default=DEFAULT_VIDEO)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--start-frame", type=int, default=FRAME_START)
    args = parser.parse_args()

    payload = json.loads(args.output.read_text(encoding="utf-8"))
    payload["static_face_sequence"] = build_sequence(args.video, args.start_frame)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    observed = payload["static_face_sequence"]["observed"]
    print(f"[ok] wrote {FRAME_COUNT} real-frame direction cases to {args.output}")
    print(json.dumps(observed, indent=2))


if __name__ == "__main__":
    main()
