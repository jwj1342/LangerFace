"""命令行：把张力线叠加到图片或视频文件。

  langerface --image face.jpg --system rstl -o out.png
  langerface --video clip.mp4 --system langer -o out.mp4
（或在未安装时：python -m langerface.apps.cli ...）
"""
from __future__ import annotations

import argparse

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
    cfg = build_config(args.system, args.num_faces,
                       smoothing=not args.no_smoothing, occlusion=not args.no_occlusion)
    with LinePipeline(cfg, mode="image") as pipe:
        out = pipe.process(frame)
    cv2.imwrite(args.output, out)
    log.info("已写出 %s", args.output)
    return 0


def run_video(args) -> int:
    cfg = build_config(args.system, args.num_faces,
                       smoothing=not args.no_smoothing, occlusion=not args.no_occlusion)
    with LinePipeline(cfg, mode="video") as pipe:
        process_video(args.video, args.output, pipe.process)
    return 0


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
    return ap


def main() -> int:
    configure_logging()
    args = build_parser().parse_args()
    return run_image(args) if args.image else run_video(args)


if __name__ == "__main__":
    raise SystemExit(main())
