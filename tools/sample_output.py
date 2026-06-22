"""从输出视频抽帧目检：跨时间抽样 + 连续帧拼条（看抖动/连续性）。

  python3 tools/sample_output.py out_rstl.mp4
"""
import os
import sys

import cv2
import numpy as np

video = sys.argv[1] if len(sys.argv) > 1 else "out_rstl.mp4"
outdir = "debug_frames"
os.makedirs(outdir, exist_ok=True)

cap = cv2.VideoCapture(video)
n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))


def grab(idx):
    cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
    ok, fr = cap.read()
    return fr if ok else None


def small(fr, w=380):
    s = w / fr.shape[1]
    return cv2.resize(fr, None, fx=s, fy=s)

# 跨时间抽样：6 帧拼成一张
idxs = [int(f * n) for f in (0.05, 0.25, 0.45, 0.6, 0.75, 0.95)]
tiles = [small(grab(i)) for i in idxs]
h = min(t.shape[0] for t in tiles)
tiles = [t[:h] for t in tiles]
row1 = np.hstack(tiles[:3])
row2 = np.hstack(tiles[3:])
cv2.imwrite(os.path.join(outdir, "out_grid.png"), np.vstack([row1, row2]))
print("saved out_grid.png idxs", idxs)

# 连续帧条：看抖动/连续性
c0 = 150
strip = [small(grab(c0 + k), w=300) for k in range(4)]
h = min(s.shape[0] for s in strip)
cv2.imwrite(os.path.join(outdir, "out_consecutive.png"), np.hstack([s[:h] for s in strip]))
print("saved out_consecutive.png frames", list(range(c0, c0 + 4)))

cap.release()
