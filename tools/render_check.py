"""渲染单帧叠加图，供人工/自查（线条是否贴脸、连续、密度合适）。

  python3 tools/render_check.py --frame 156 --system rstl --thickness 1 --out /tmp/chk.png
"""
from __future__ import annotations

import argparse
import os
import sys

import cv2

from langerface.config import Config, DEFAULT_STYLES, LineStyle
from langerface.pipeline import LinePipeline


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", default="IMG_3458.MOV")
    ap.add_argument("--frame", type=int, default=156)
    ap.add_argument("--system", default="rstl")
    ap.add_argument("--thickness", type=int, default=1)
    ap.add_argument("--alpha", type=float, default=0.9)
    ap.add_argument("--no-occlusion", action="store_true")
    ap.add_argument("--out", default="/tmp/chk.png")
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video)
    cap.set(cv2.CAP_PROP_POS_FRAMES, args.frame)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        print("cannot read frame"); return 1

    cfg = Config(system=args.system)
    cfg.occlusion = not args.no_occlusion
    base = DEFAULT_STYLES[args.system]
    cfg.styles = dict(DEFAULT_STYLES)
    cfg.styles[args.system] = LineStyle(color=base.color, thickness=args.thickness, alpha=args.alpha)

    with LinePipeline(cfg, mode="image") as pipe:
        out = pipe.process(frame)
    cv2.imwrite(args.out, out)
    print(f"[ok] {args.out}  ({out.shape[1]}x{out.shape[0]})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
