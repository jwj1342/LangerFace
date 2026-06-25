"""Build a local multi-image preview board for wrinkle-guided texture warping."""
from __future__ import annotations

import argparse
import sys
from dataclasses import replace
from pathlib import Path

import cv2
import numpy as np

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))

from langerface.config.constants import SYSTEM_RSTL  # noqa: E402
from langerface.config.settings import Config, LineStyle  # noqa: E402
from langerface.pipeline import LinePipeline  # noqa: E402


def main() -> int:
    args = parse_args()
    rows = []
    for image_id in args.ids:
        image = image_path(args.dataset, image_id)
        mask = args.mask_dir / f"{image_id}_wrinkle_mask.png"
        if not mask.exists():
            raise FileNotFoundError(f"missing mask for {image_id}: {mask}")
        rows.append(render_row(image_id, image, mask, args))
    board = np.vstack(rows)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(args.out), board)
    print(f"[ok] {args.out}")
    return 0


def render_row(image_id: str, image_file: Path, mask_file: Path, args) -> np.ndarray:
    frame = cv2.imread(str(image_file), cv2.IMREAD_COLOR)
    mask = cv2.imread(str(mask_file), cv2.IMREAD_GRAYSCALE)
    if frame is None or mask is None:
        raise FileNotFoundError(f"unreadable image/mask for {image_id}")

    baseline = render_overlay(frame, None, warp=False, color=(0, 255, 255), args=args)
    warped = render_overlay(frame, mask, warp=True, color=(0, 255, 0), args=args)
    delta = highlight_delta(frame, baseline, warped)

    prob_file = args.mask_dir / f"{image_id}_wrinkle_prob.png"
    prob = cv2.imread(str(prob_file), cv2.IMREAD_GRAYSCALE)
    prob_bgr = cv2.applyColorMap(prob if prob is not None else mask, cv2.COLORMAP_INFERNO)
    mask_bgr = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)

    return np.hstack(
        [
            tile(f"{image_id} original", frame, args.tile),
            tile("U-Net prob", prob_bgr, args.tile),
            tile("mask", mask_bgr, args.tile),
            tile("baseline RSTL", baseline, args.tile),
            tile("texture warped", warped, args.tile),
            tile("delta", delta, args.tile),
        ]
    )


def render_overlay(
    frame: np.ndarray,
    mask: np.ndarray | None,
    *,
    warp: bool,
    color: tuple[int, int, int],
    args,
):
    cfg = Config(system=SYSTEM_RSTL, occlusion=False)
    cfg.styles = dict(cfg.styles)
    cfg.styles[SYSTEM_RSTL] = LineStyle(color=color, thickness=args.thickness, alpha=args.alpha)
    cfg.texture_warp = replace(cfg.texture_warp, enabled=warp)
    with LinePipeline(cfg, mode="image") as pipe:
        return pipe.process(frame, wrinkle_mask=mask)


def highlight_delta(frame: np.ndarray, baseline: np.ndarray, warped: np.ndarray) -> np.ndarray:
    baseline_mask = overlay_line_mask(frame, baseline)
    warped_mask = overlay_line_mask(frame, warped)
    mask = cv2.bitwise_xor(baseline_mask, warped_mask)
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=1)
    out = warped.copy()
    out[mask > 0] = (0.25 * out[mask > 0] + 0.75 * np.array([0, 255, 255])).astype(np.uint8)
    return out


def overlay_line_mask(frame: np.ndarray, overlay: np.ndarray) -> np.ndarray:
    diff = cv2.absdiff(frame, overlay)
    gray = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)
    _, mask = cv2.threshold(gray, 18, 255, cv2.THRESH_BINARY)
    return mask


def tile(label: str, image: np.ndarray, size: int) -> np.ndarray:
    header = 34
    h, w = image.shape[:2]
    scale = min(size / w, (size - header) / h)
    resized = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    canvas = np.full((size, size, 3), 245, dtype=np.uint8)
    y = header + (size - header - resized.shape[0]) // 2
    x = (size - resized.shape[1]) // 2
    canvas[y : y + resized.shape[0], x : x + resized.shape[1]] = resized
    cv2.putText(canvas, label, (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (15, 15, 15), 2, cv2.LINE_AA)
    return canvas


def image_path(dataset: Path, image_id: str) -> Path:
    bucket = f"{(int(image_id) // 1000) * 1000:05d}"
    return dataset / "images1024x1024" / bucket / f"{image_id}.png"


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ids", nargs="+", default=["00001", "00011", "00016", "00017"])
    ap.add_argument("--dataset", type=Path, default=REPO / "local_archives" / "datasets" / "ffhq_wrinkle")
    ap.add_argument("--mask-dir", type=Path, default=REPO / "local_outputs" / "wrinkle_masks")
    ap.add_argument("--out", type=Path, default=REPO / "local_outputs" / "texture_warp_multi_rstl_board.png")
    ap.add_argument("--tile", type=int, default=280)
    ap.add_argument("--thickness", type=int, default=3)
    ap.add_argument("--alpha", type=float, default=1.0)
    return ap.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())
