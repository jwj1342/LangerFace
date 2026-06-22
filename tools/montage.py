"""把整段输出视频均匀抽 16 帧拼成 4x4 montage，做整体目检。

  python3 tools/montage.py local_media/out_rstl.mp4
"""
import os
import sys

import cv2
import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL_MEDIA = os.path.join(REPO, "local_media")

video = sys.argv[1] if len(sys.argv) > 1 else os.path.join(LOCAL_MEDIA, "out_rstl.mp4")
cap = cv2.VideoCapture(video)
n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

idxs = [int((k + 0.5) / 16 * n) for k in range(16)]
tiles = []
for i in idxs:
    cap.set(cv2.CAP_PROP_POS_FRAMES, i)
    ok, fr = cap.read()
    if not ok:
        continue
    s = 250 / fr.shape[1]
    fr = cv2.resize(fr, None, fx=s, fy=s)
    cv2.putText(fr, str(i), (6, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
    tiles.append(fr)
cap.release()

h = min(t.shape[0] for t in tiles)
w = min(t.shape[1] for t in tiles)
tiles = [t[:h, :w] for t in tiles]
rows = [np.hstack(tiles[r * 4:r * 4 + 4]) for r in range(4)]
cv2.imwrite("debug_frames/montage.png", np.vstack(rows))
print("saved debug_frames/montage.png frames", idxs)
