"""Verify that the v8.1.86 supraorbital transition stays above eyebrow hair."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from langerface.config import CANONICAL_OBJ  # noqa: E402
from langerface.geometry import CanonicalFaceModel  # noqa: E402
from langerface.lines import Atlas  # noqa: E402

TARGET_NAMES = {
    f"standard_field_{index:04d}_{side}"
    for index in range(170, 175)
    for side in ("right", "left")
}


def _largest_dark_component(gray: np.ndarray, x0: int, x1: int) -> np.ndarray:
    candidate = np.zeros_like(gray, dtype=np.uint8)
    candidate[430:550, x0:x1] = (gray[430:550, x0:x1] < 105).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(candidate, 8)
    if count < 2:
        raise RuntimeError(f"no eyebrow component found in x=[{x0}, {x1})")
    label = max(range(1, count), key=lambda item: int(stats[item, cv2.CC_STAT_AREA]))
    return (labels == label).astype(np.uint8)


def _dense_polyline(points: np.ndarray) -> np.ndarray:
    segments = [
        np.linspace(start, end, 31, endpoint=False)
        for start, end in zip(points[:-1], points[1:], strict=True)
    ]
    return np.vstack([*segments, points[-1:]])


def _map_review_geometry(
    atlas: Atlas, landmarks: np.ndarray, triangles: np.ndarray
) -> dict[str, np.ndarray]:
    """Map the fixed review geometry before production-only regional offsets."""
    mapped = {}
    for line in atlas.lines:
        if line.name not in TARGET_NAMES:
            continue
        vertices = triangles[line.tris()]
        bary = line.bary()
        mapped[line.name] = (
            bary[:, 0:1] * landmarks[vertices[:, 0]]
            + bary[:, 1:2] * landmarks[vertices[:, 1]]
            + bary[:, 2:3] * landmarks[vertices[:, 2]]
        )[:, :2]
    return mapped


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--atlas", type=Path, default=ROOT / "assets/atlas_rstl.json")
    parser.add_argument(
        "--image", type=Path, default=ROOT.parent / "langer线-cc/new_woman.png"
    )
    parser.add_argument(
        "--landmarks",
        type=Path,
        default=ROOT.parent / "langer线-cc/new_woman_landmarks_browser_cpu.json",
    )
    parser.add_argument("--minimum-clearance", type=float, default=5.0)
    args = parser.parse_args()

    frame = cv2.imread(str(args.image))
    if frame is None:
        raise FileNotFoundError(args.image)
    height, width = frame.shape[:2]
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    eyebrow_mask = np.maximum(
        _largest_dark_component(gray, 180, 540),
        _largest_dark_component(gray, 540, 900),
    )
    distance = cv2.distanceTransform(1 - eyebrow_mask, cv2.DIST_L2, 5)

    payload = json.loads(args.landmarks.read_text(encoding="utf-8"))
    landmarks = np.asarray(payload["landmarks"], dtype=np.float64)
    landmarks *= np.asarray([width, height, width], dtype=np.float64)
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    targets = _map_review_geometry(
        Atlas.load(str(args.atlas)), landmarks, canonical.triangles
    )
    if set(targets) != TARGET_NAMES:
        raise RuntimeError(f"missing target lines: {sorted(TARGET_NAMES - set(targets))}")

    failures = []
    for name, points in sorted(targets.items()):
        samples = np.round(_dense_polyline(points)).astype(int)
        clearance = float(distance[samples[:, 1], samples[:, 0]].min())
        print(f"{name}: minimum eyebrow-hair clearance={clearance:.2f}px")
        # OpenCV's chamfer approximation reports an exact 5 px offset as 4.996887.
        if clearance + 0.01 < args.minimum_clearance:
            failures.append((name, clearance))
    if failures:
        raise RuntimeError(
            f"clearance below {args.minimum_clearance:.2f}px: {failures}"
        )


if __name__ == "__main__":
    main()
