"""从参考示意图描线生成首版图谱（半自动）。

把一张大致正面的参考张力线示意图作为半透明底图，对齐到标准脸正面投影框，
在其上描线、保存为图谱。用于从教科书/文献图（在版权允许下）快速得到首版，再交临床医生校验。

  python tools/digitize_from_diagram.py --system rstl --diagram refs/rstl_face.png

对齐假设：示意图为大致正面、人脸基本充满画面。可用 --pad 调整边距贴合。
操作键与 annotate_atlas.py 相同：左键加点 / n 新线 / u 撤销 / d 删线 / w 保存 / q 退出。
"""
from __future__ import annotations

import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from langerlines.atlas import Atlas, AtlasLine          # noqa: E402
from langerlines.canonical import CanonicalFaceModel    # noqa: E402
from langerlines.config import CANONICAL_OBJ, ATLAS_PATHS, VALID_SYSTEMS  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="从参考示意图描线生成图谱")
    ap.add_argument("--system", choices=VALID_SYSTEMS, required=True)
    ap.add_argument("--diagram", required=True, help="参考示意图路径")
    ap.add_argument("--pad", type=float, default=0.1, help="人脸框外扩比例以贴合示意图")
    args = ap.parse_args()

    import matplotlib.image as mpimg
    import matplotlib.pyplot as plt

    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    proj = canonical.project_front()
    origin, size = canonical.face_frame()
    pad = args.pad * size
    extent = [origin[0] - pad[0], origin[0] + size[0] + pad[0],
              origin[1] + size[1] + pad[1], origin[1] - pad[1]]  # 注意 y 反向

    img = mpimg.imread(args.diagram)
    fig, ax = plt.subplots(figsize=(7, 9))
    ax.imshow(img, extent=extent, alpha=0.55, aspect="auto")
    ax.triplot(proj[:, 0], proj[:, 1], canonical.triangles, color="0.8", lw=0.25, alpha=0.5)
    ax.set_aspect("equal")
    ax.invert_yaxis()
    ax.set_title(f"描线 {args.system}  |  左键加点 n新线 u撤销 d删线 w保存 q退出")

    completed: list[np.ndarray] = []
    current: list[list[float]] = []
    cur_line, = ax.plot([], [], "o-", color="tab:red", ms=3, lw=1.2)

    def redraw():
        arr = np.asarray(current) if current else np.empty((0, 2))
        cur_line.set_data(arr[:, 0] if len(arr) else [], arr[:, 1] if len(arr) else [])
        fig.canvas.draw_idle()

    def on_click(event):
        if event.inaxes == ax and event.button == 1:
            current.append([event.xdata, event.ydata])
            redraw()

    def on_key(event):
        nonlocal current
        if event.key == "n" and len(current) >= 2:
            completed.append(np.asarray(current))
            ax.plot([p[0] for p in current], [p[1] for p in current], color="tab:green", lw=1.2)
            current = []
            redraw()
        elif event.key == "u" and current:
            current.pop(); redraw()
        elif event.key == "d" and completed:
            completed.pop(); ax.lines[-1].remove(); fig.canvas.draw_idle()
        elif event.key == "w":
            if len(current) >= 2:
                completed.append(np.asarray(current)); current = []
            atlas = Atlas(system=args.system, version="0.1",
                          provenance=f"digitized from diagram {os.path.basename(args.diagram)}",
                          validated=False)
            for k, pts2d in enumerate(completed):
                out = np.zeros((len(pts2d), 3))
                for i, p in enumerate(pts2d):
                    tri, bary = canonical.locate(p, proj=proj)
                    out[i] = [tri, bary[0], bary[1]]
                atlas.lines.append(AtlasLine(f"line_{k}", "digitized", out))
            atlas.save(ATLAS_PATHS[args.system])
            print(f"[ok] 已保存 {len(completed)} 条曲线 -> {ATLAS_PATHS[args.system]}（validated=false，待临床校验）")
        elif event.key == "q":
            plt.close(fig)

    fig.canvas.mpl_connect("button_press_event", on_click)
    fig.canvas.mpl_connect("key_press_event", on_key)
    plt.show()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
