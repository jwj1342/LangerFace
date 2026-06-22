"""命令行：把张力线叠加到图片或视频文件。

  python apps/cli.py --image face.jpg --system rstl -o out.png
  python apps/cli.py --video clip.mp4 --system langer -o out.mp4
"""
from __future__ import annotations

import argparse
import os
import sys

import cv2

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from langerlines.config import Config, VALID_SYSTEMS  # noqa: E402
from langerlines.pipeline import LinePipeline         # noqa: E402


def _config(args, mode) -> Config:
    cfg = Config(system=args.system, num_faces=args.num_faces)
    cfg.smoothing = not args.no_smoothing
    cfg.occlusion = not args.no_occlusion
    return cfg


def run_image(args) -> int:
    frame = cv2.imread(args.image)
    if frame is None:
        print(f"[err] 无法读取图片 {args.image}")
        return 1
    with LinePipeline(_config(args, "image"), mode="image") as pipe:
        out = pipe.process(frame)
    cv2.imwrite(args.output, out)
    print(f"[ok] 已写出 {args.output}")
    return 0


def run_video(args) -> int:
    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print(f"[err] 无法打开视频 {args.video}")
        return 1
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    from langerlines.videoio import make_writer
    writer = make_writer(args.output, fps, (w, h))

    with LinePipeline(_config(args, "video"), mode="video") as pipe:
        idx = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            ts = int(idx * 1000.0 / fps)
            writer.write(pipe.process(frame, timestamp_ms=ts))
            idx += 1
            if idx % 30 == 0:
                print(f"\r    已处理 {idx} 帧", end="", flush=True)
    cap.release()
    writer.release()
    print(f"\n[ok] 已写出 {args.output}（{idx} 帧）")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="朗格线/RSTL 面部投射 — 图片/视频")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--image", help="输入图片路径")
    src.add_argument("--video", help="输入视频路径")
    ap.add_argument("--system", choices=VALID_SYSTEMS, default="rstl", help="线系统（默认 rstl）")
    ap.add_argument("-o", "--output", required=True, help="输出路径")
    ap.add_argument("--num-faces", type=int, default=1)
    ap.add_argument("--no-smoothing", action="store_true", help="关闭时间平滑")
    ap.add_argument("--no-occlusion", action="store_true", help="关闭背面剔除")
    args = ap.parse_args()
    return run_image(args) if args.image else run_video(args)


if __name__ == "__main__":
    raise SystemExit(main())
