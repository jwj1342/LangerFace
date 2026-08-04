"""交互式图谱标注 / 校验工具（供临床医生使用）。

在标准脸正面视图上画/改张力线曲线，保存为图谱 (tri, u, v)。
这是让图谱**可被临床校验**的关键工具——而非把医学知识硬编码。

  python tools/annotate_atlas.py --system rstl
  python tools/annotate_atlas.py --system langer --new   # 从空白开始（不加载现有线）

操作：
  左键单击      在当前曲线上加点
  n             结束当前曲线、开始新曲线
  u             撤销当前曲线最后一个点
  d             撤销本次会话最近新画的一条曲线（已载入的曲线不会被删除）
  w             写入草案（始终保持 validated=false）
  q / 关闭窗口  退出（不自动保存）

保存只生成待复核草案，不能声明临床校验已经完成。请用
``tools/atlas_clinical_review.py`` 生成逐线审阅包；只有完成医生逐线复核、
来源记录和显式签署后，finalize 子命令才会生成单独的
``validated:true`` 候选文件。
"""
from __future__ import annotations

import argparse
import getpass
import os
import re
from datetime import datetime

import numpy as np

from langerface.config import (  # noqa: E402
    ATLAS_PATHS,
    CANONICAL_OBJ,
    TOPOLOGY_ID,
    TOPOLOGY_VERSION,
    VALID_SYSTEMS,
)
from langerface.geometry import CanonicalFaceModel  # noqa: E402
from langerface.lines import Atlas, AtlasLine, atlas_line_from_points2d  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="标准脸张力线图谱标注/校验")
    ap.add_argument("--system", choices=VALID_SYSTEMS, required=True)
    ap.add_argument("--new", action="store_true", help="不加载现有线，从空白开始")
    ap.add_argument("--region", default="annotated", help="新增曲线的面部分区标签")
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
    ax.set_title(
        f"标注 {args.system}（草案） | 左键加点 n新线 u撤销 d删线 w保存 q退出"
    )
    ax.triplot(proj[:, 0], proj[:, 1], canonical.triangles, color="0.85", lw=0.3)
    ax.scatter(proj[:, 0], proj[:, 1], s=1, color="0.7")
    ax.set_aspect("equal")
    ax.invert_yaxis()  # 图像 y 向下

    # 已载入的曲线与本次会话新画的曲线分开保存：`d` 只允许撤销本次新画的线，
    # 否则一次误按就会删掉一条经临床复核的官方曲线，并被随后的 `w` 持久化。
    draft = DraftLines()
    drawn_artists = []

    # 载入已有曲线；再次保存时保留原名称、分区和表面坐标。
    if existing:
        for ln in existing.lines:
            tv = canonical.triangles[ln.tris()]
            b = ln.bary()
            xy = (
                b[:, 0:1] * proj[tv[:, 0]]
                + b[:, 1:2] * proj[tv[:, 1]]
                + b[:, 2:3] * proj[tv[:, 2]]
            )
            draft.loaded.append(
                {
                    "name": ln.name,
                    "region": ln.region,
                    "points": xy,
                    "surface_points": ln.points.copy(),
                }
            )
            ax.plot(xy[:, 0], xy[:, 1], color="tab:blue", lw=1, alpha=0.5)

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

    def commit_current():
        """把当前正在画的折线收尾成一条新曲线。`n` 与 `w` 共用这一条命名路径。"""
        nonlocal current
        if len(current) < 2:
            return False
        entry = draft.add(args.region, np.asarray(current))
        points = entry["points"]
        artist, = ax.plot(points[:, 0], points[:, 1], color="tab:green", lw=1.2)
        drawn_artists.append(artist)
        current = []
        return True

    def on_key(event):
        nonlocal current
        if event.key == "n":
            commit_current()
            current = []
            redraw()
        elif event.key == "u":
            if current:
                current.pop()
                redraw()
        elif event.key == "d":
            # 只撤销本次会话新画的线；已载入的官方曲线不可通过本键删除。
            if draft.undo_last_drawn() is not None:
                drawn_artists.pop().remove()
                fig.canvas.draw_idle()
            elif draft.loaded:
                print("[skip] 已载入的曲线不能用 d 删除；本次会话没有可撤销的新线。")
        elif event.key == "w":
            if commit_current():
                redraw()
            _save(canonical, proj, draft.all_lines(), args.system, path, existing)
            print(
                f"[ok] 已保存 {len(draft.loaded)} 条载入曲线 + {len(draft.drawn)} 条新曲线 -> {path}；"
                "validated=false，仍需逐线临床审阅"
            )
        elif event.key == "q":
            plt.close(fig)

    fig.canvas.mpl_connect("button_press_event", on_click)
    fig.canvas.mpl_connect("key_press_event", on_key)
    plt.show()
    return 0


_ANNOTATED_NAME = re.compile(r"^annotated_(\d+)$")


class DraftLines:
    """一次标注会话的曲线状态。

    已载入的曲线（``loaded``）与本次新画的曲线（``drawn``）分开保存，因为它们的
    可删除性不同：``d`` 只能撤销本次新画的线。合并前两者放在同一个列表里，一次误按
    ``d`` 就会删掉一条经临床复核的官方曲线，并被随后的 ``w`` 写进文件。
    """

    def __init__(self, loaded=None):
        self.loaded: list[dict] = list(loaded or [])
        self.drawn: list[dict] = []

    def add(self, region: str, points) -> dict:
        entry = {
            "name": next_annotated_name(self.loaded, self.drawn),
            "region": region,
            "points": points,
        }
        self.drawn.append(entry)
        return entry

    def undo_last_drawn(self):
        """撤销最近一条新画的线。没有新线时返回 ``None``，且绝不触及 ``loaded``。"""
        return self.drawn.pop() if self.drawn else None

    def all_lines(self) -> list[dict]:
        return self.loaded + self.drawn


def next_annotated_name(*line_groups) -> str:
    """生成不与任何既有曲线重名的 ``annotated_NNNN``。

    不能用 ``len(lines)`` 当序号：删除再新增、或载入的图谱里本来就含
    ``annotated_*`` 名字时会撞名，而 ``atlas_clinical_review.py`` 要求线名唯一，
    到那一步才报错排查成本很高。
    """
    highest = -1
    for group in line_groups:
        for line in group:
            match = _ANNOTATED_NAME.match(str(line.get("name", "")))
            if match:
                highest = max(highest, int(match.group(1)))
    return f"annotated_{highest + 1:04d}"


def _save(canonical, proj, completed, system, path, existing=None):
    previous_provenance = existing.provenance if existing else ""
    edit_note = (
        f"Draft atlas edited by {getpass.getuser()} "
        f"at {datetime.now().astimezone().isoformat(timespec='seconds')}; "
        "requires line-by-line clinical review."
    )
    atlas = Atlas(
        system=system,
        version=existing.version if existing else "0.1",
        atlas_version=existing.atlas_version if existing else None,
        topology_id=existing.topology_id if existing else TOPOLOGY_ID,
        topology_version=existing.topology_version if existing else TOPOLOGY_VERSION,
        provenance=f"{previous_provenance} {edit_note}".strip(),
        validated=False,
    )
    for entry in completed:
        if "surface_points" in entry:
            atlas.lines.append(
                AtlasLine(
                    entry["name"],
                    entry["region"],
                    np.asarray(entry["surface_points"], dtype=np.float64).copy(),
                )
            )
        else:
            atlas.lines.append(
                atlas_line_from_points2d(
                    canonical,
                    entry["name"],
                    entry["region"],
                    entry["points"],
                    proj=proj,
                )
            )
    atlas.save(path)


if __name__ == "__main__":
    raise SystemExit(main())
