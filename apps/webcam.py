"""实时摄像头：把张力线实时叠加到摄像头画面。

  python apps/webcam.py --system rstl

热键： t = 切换 RSTL/Langer    o = 切换遮挡剔除    s = 切换平滑    q/Esc = 退出
（macOS 首次运行需在系统设置中授予终端“摄像头”权限）
"""
from __future__ import annotations

import argparse
import os
import sys
import time

import cv2

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from langerlines.config import Config, SYSTEM_RSTL, SYSTEM_LANGER, VALID_SYSTEMS  # noqa: E402
from langerlines.pipeline import LinePipeline                                      # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="朗格线/RSTL 面部投射 — 实时摄像头")
    ap.add_argument("--system", choices=VALID_SYSTEMS, default="rstl")
    ap.add_argument("--camera", type=int, default=0, help="摄像头索引")
    ap.add_argument("--num-faces", type=int, default=1)
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        print(f"[err] 无法打开摄像头 {args.camera}")
        return 1

    cfg = Config(system=args.system, num_faces=args.num_faces)
    win = "Langer/RSTL projection (t:切换 o:遮挡 s:平滑 q:退出)"
    print("[info] 已启动。窗口热键： t 切换线系统 / o 遮挡 / s 平滑 / q 退出")

    with LinePipeline(cfg, mode="video") as pipe:
        t0 = time.monotonic()
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frame = cv2.flip(frame, 1)  # 镜像，更符合“照镜子”直觉
            ts = int((time.monotonic() - t0) * 1000)
            out = pipe.process(frame, timestamp_ms=ts)

            label = f"{cfg.system.upper()}  smooth={cfg.smoothing}  occ={cfg.occlusion}"
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
                from langerlines.occlusion import BackfaceCuller
                cfg.occlusion = not cfg.occlusion
                pipe.culler = BackfaceCuller(pipe.triangles) if cfg.occlusion else None
            elif key == ord("s"):
                cfg.smoothing = not cfg.smoothing

    cap.release()
    cv2.destroyAllWindows()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
