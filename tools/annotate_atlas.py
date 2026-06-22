"""交互式图谱标注 / 校验工具（供临床医生使用）。

在标准脸正面视图上画/改张力线曲线，保存为图谱 (tri, u, v)。
这是让图谱**可被临床校验**的关键工具——而非把医学知识硬编码。

  python tools/annotate_atlas.py --system rstl
  python tools/annotate_atlas.py --system langer --new   # 从空白开始（不加载现有线）

操作：
  左键单击      在当前曲线上加点
  n             结束当前曲线、开始新曲线
  u             撤销当前曲线最后一个点
  d             删除最近完成的一条曲线
  w             写入保存（标记 validated=true，并记录校验者）
  q / 关闭窗口  退出（不自动保存）
"""
from __future__ import annotations

import argparse
import getpass
import os
import sys
from datetime import datetime

import numpy as np

from langerface.lines import Atlas, AtlasLine          # noqa: E402
from langerface.geometry import CanonicalFaceModel    # noqa: E402
from langerface.config import CANONICAL_OBJ, ATLAS_PATHS, VALID_SYSTEMS  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="标准脸张力线图谱标注/校验")
    ap.add_argument("--system", choices=VALID_SYSTEMS, required=True)
    ap.add_argument("--new", action="store_true", help="不加载现有线，从空白开始")
    args = ap.parse_args()

    import matplotlib.pyplot as plt

    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    proj = canonical.project_front()
    path = ATLAS_PATHS[args.system]

    # 已有图谱（用于显示底图 / 在其上修改）
    existing = None
    if os.path.exists(path) and not args.new:
        existing = Atlas.load(path)

    fig, ax = plt.subplots(figsize=(7, 9))
    ax.set_title(f"标注 {args.system}  |  左键加点 n新线 u撤销 d删线 w保存 q退出")
    ax.triplot(proj[:, 0], proj[:, 1], canonical.triangles, color="0.85", lw=0.3)
    ax.scatter(proj[:, 0], proj[:, 1], s=1, color="0.7")
    ax.set_aspect("equal")
    ax.invert_yaxis()  # 图像 y 向下

    # 显示已有曲线
    if existing:
        for ln in existing.lines:
            tv = canonical.triangles[ln.tris()]
            b = ln.bary()
            xy = (b[:, 0:1] * proj[tv[:, 0]] + b[:, 1:2] * proj[tv[:, 1]] + b[:, 2:3] * proj[tv[:, 2]])
            ax.plot(xy[:, 0], xy[:, 1], color="tab:blue", lw=1, alpha=0.5)

    completed: list[np.ndarray] = []   # 每条已完成曲线（proj 坐标点）
    current: list[list[float]] = []
    cur_line, = ax.plot([], [], "o-", color="tab:red", ms=3, lw=1.2)

    def redraw():
        if current:
            arr = np.asarray(current)
            cur_line.set_data(arr[:, 0], arr[:, 1])
        else:
            cur_line.set_data([], [])
        fig.canvas.draw_idle()

    def on_click(event):
        if event.inaxes != ax or event.button != 1:
            return
        current.append([event.xdata, event.ydata])
        redraw()

    def on_key(event):
        nonlocal current
        if event.key == "n":
            if len(current) >= 2:
                completed.append(np.asarray(current))
                ax.plot([p[0] for p in current], [p[1] for p in current],
                        color="tab:green", lw=1.2)
            current = []
            redraw()
        elif event.key == "u":
            if current:
                current.pop()
                redraw()
        elif event.key == "d":
            if completed:
                completed.pop()
                ax.lines[-1].remove()  # 移除最近一条绿线
                fig.canvas.draw_idle()
        elif event.key == "w":
            if len(current) >= 2:
                completed.append(np.asarray(current))
                current = []
            _save(canonical, proj, completed, args.system, path)
            print(f"[ok] 已保存 {len(completed)} 条曲线 -> {path}")
        elif event.key == "q":
            plt.close(fig)

    fig.canvas.mpl_connect("button_press_event", on_click)
    fig.canvas.mpl_connect("key_press_event", on_key)
    plt.show()
    return 0


def _save(canonical, proj, completed, system, path):
    atlas = Atlas(
        system=system, version="0.1",
        provenance=f"clinician-annotated by {getpass.getuser()} at {datetime.now().isoformat(timespec='seconds')}",
        validated=True,
    )
    for k, pts2d in enumerate(completed):
        out = np.zeros((len(pts2d), 3), dtype=np.float64)
        for i, p in enumerate(pts2d):
            tri, bary = canonical.locate(p, proj=proj)
            out[i] = [tri, bary[0], bary[1]]
        atlas.lines.append(AtlasLine(name=f"line_{k}", region="annotated", points=out))
    atlas.save(path)


if __name__ == "__main__":
    raise SystemExit(main())
