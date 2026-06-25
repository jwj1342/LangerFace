"""命令行：把张力线叠加到图片或视频文件。

  langerface --image face.jpg --system rstl -o out.png
  langerface --video clip.mp4 --system langer -o out.mp4
（或在未安装时：python -m langerface.apps.cli ...）
"""
from __future__ import annotations

import argparse
from dataclasses import replace

from ..config.constants import VALID_SYSTEMS
from ..config.settings import build_config
from ..log import configure_logging, get_logger
from ..media.video import process_video
from ..pipeline.line_pipeline import LinePipeline

log = get_logger(__name__)


def run_image(args) -> int:
    import cv2

    frame = cv2.imread(args.image)
    if frame is None:
        log.error("无法读取图片 %s", args.image)
        return 1
    wrinkle_mask = None
    if args.wrinkle_mask:
        wrinkle_mask = cv2.imread(args.wrinkle_mask, cv2.IMREAD_GRAYSCALE)
        if wrinkle_mask is None:
            log.error("unable to read wrinkle mask %s", args.wrinkle_mask)
            return 1
    cfg = _config_from_args(args)
    with LinePipeline(cfg, mode="image") as pipe:
        out = pipe.process(frame, wrinkle_mask=wrinkle_mask)
    cv2.imwrite(args.output, out)
    log.info("已写出 %s", args.output)
    return 0


def run_video(args) -> int:
    cfg = _config_from_args(args)
    with LinePipeline(cfg, mode="video") as pipe:
        process_video(args.video, args.output, pipe.process)
    return 0


def _config_from_args(args):
    cfg = build_config(
        args.system,
        args.num_faces,
        smoothing=not args.no_smoothing,
        occlusion=not args.no_occlusion,
        texture_warp=args.texture_warp,
    )
    cfg.texture_warp = replace(
        cfg.texture_warp,
        max_shift_px=args.texture_warp_max_shift,
        search_radius_px=args.texture_warp_radius,
    )
    return cfg


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="朗格线/RSTL 面部投射 — 图片/视频")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--image", help="输入图片路径")
    src.add_argument("--video", help="输入视频路径")
    ap.add_argument("--system", choices=VALID_SYSTEMS, default="rstl", help="线系统（默认 rstl）")
    ap.add_argument("-o", "--output", required=True, help="输出路径")
    ap.add_argument("--num-faces", type=int, default=1)
    ap.add_argument("--no-smoothing", action="store_true", help="关闭时间平滑")
    ap.add_argument("--no-occlusion", action="store_true", help="关闭背面剔除")
    ap.add_argument(
        "--texture-warp",
        action="store_true",
        help="enable patient wrinkle-guided local warping",
    )
    ap.add_argument(
        "--texture-warp-max-shift",
        type=float,
        default=5.0,
        help="maximum local warp shift in pixels",
    )
    ap.add_argument(
        "--texture-warp-radius",
        type=float,
        default=8.0,
        help="normal-search radius for wrinkle ridges",
    )
    ap.add_argument(
        "--wrinkle-mask",
        help="optional model-predicted wrinkle mask for --image texture warping",
    )
    return ap


def main() -> int:
    configure_logging()
    args = build_parser().parse_args()
    return run_image(args) if args.image else run_video(args)


if __name__ == "__main__":
    raise SystemExit(main())
