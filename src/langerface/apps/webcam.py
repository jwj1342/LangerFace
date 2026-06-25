"""实时摄像头：把张力线实时叠加到摄像头画面。

  langerface-webcam --system rstl
（或：python -m langerface.apps.webcam --system rstl）

热键： t = 切换 RSTL/Langer    o = 切换遮挡剔除    s = 切换平滑    q/Esc = 退出
（macOS 首次运行需在系统设置中授予终端“摄像头”权限）
"""
from __future__ import annotations

import argparse
import time

from ..config.constants import SYSTEM_LANGER, SYSTEM_RSTL, VALID_SYSTEMS
from ..config.settings import build_config
from ..log import configure_logging, get_logger
from ..pipeline.line_pipeline import LinePipeline

log = get_logger(__name__)


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="朗格线/RSTL 面部投射 — 实时摄像头")
    ap.add_argument("--system", choices=VALID_SYSTEMS, default="rstl")
    ap.add_argument("--camera", type=int, default=0, help="摄像头索引")
    ap.add_argument("--num-faces", type=int, default=1)
    ap.add_argument("--texture-warp", action="store_true", help="enable patient wrinkle-guided local warping")
    return ap


def main() -> int:
    import cv2

    configure_logging()
    args = build_parser().parse_args()

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        log.error("无法打开摄像头 %s", args.camera)
        return 1

    cfg = build_config(args.system, args.num_faces, texture_warp=args.texture_warp)
    win = "Langer/RSTL projection (t:切换 o:遮挡 s:平滑 q:退出)"
    log.info("已启动。窗口热键： t 切换线系统 / o 遮挡 / s 平滑 / q 退出")

    with LinePipeline(cfg, mode="video") as pipe:
        t0 = time.monotonic()
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frame = cv2.flip(frame, 1)  # 镜像，更符合“照镜子”直觉
            ts = int((time.monotonic() - t0) * 1000)
            out = pipe.process(frame, timestamp_ms=ts)

            label = (
                f"{cfg.system.upper()}  smooth={cfg.smoothing}  "
                f"occ={cfg.occlusion}  warp={cfg.texture_warp.enabled}"
            )
            cv2.putText(out, label, (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            cv2.putText(out, "decision-support overlay - not a surgical instruction",
                        (12, out.shape[0] - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)
            cv2.imshow(win, out)

            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), 27):
                break
            elif key == ord("t"):
                pipe.set_system(SYSTEM_LANGER if cfg.system == SYSTEM_RSTL else SYSTEM_RSTL)
            elif key == ord("o"):
                pipe.set_occlusion(not cfg.occlusion)
            elif key == ord("s"):
                pipe.set_smoothing(not cfg.smoothing)
            elif key == ord("w"):
                pipe.set_texture_warp(not cfg.texture_warp.enabled)

    cap.release()
    cv2.destroyAllWindows()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
