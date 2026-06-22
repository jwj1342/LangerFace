"""渲染：把映射后的线条画成抗锯齿折线并叠加到画面。

- 被遮挡（背面）的点处断开折线，只画可见段
- 整图 addWeighted 混合：未绘制像素 overlay==frame，故不会被压暗，只有线条像素混合
- global_alpha 供 pipeline 做丢脸淡入淡出
"""
from __future__ import annotations

import cv2
import numpy as np

from .config import LineStyle
from .mapping import MappedLine


def draw_overlay(
    frame: np.ndarray,
    mapped_lines: list[MappedLine],
    visible_tri: np.ndarray | None,
    style: LineStyle,
    global_alpha: float = 1.0,
) -> np.ndarray:
    """在 frame 上叠加线条，返回新帧（不修改入参）。

    visible_tri: (M,) bool 或 None（None=全部可见）。
    """
    if global_alpha <= 0 or not mapped_lines:
        return frame
    overlay = frame.copy()
    h, w = frame.shape[:2]

    for ln in mapped_lines:
        xy = ln.pts[:, :2]
        vis = np.ones(len(xy), dtype=bool) if visible_tri is None else visible_tri[ln.tris]
        for seg in _visible_runs(xy, vis):
            if len(seg) < 2:
                continue
            poly = np.round(seg).astype(np.int32).reshape(-1, 1, 2)
            cv2.polylines(overlay, [poly], False, style.color,
                          style.thickness, lineType=cv2.LINE_AA)
            if style.draw_direction_ticks:
                _draw_ticks(overlay, seg, style)

    a = float(np.clip(style.alpha * global_alpha, 0.0, 1.0))
    return cv2.addWeighted(overlay, a, frame, 1.0 - a, 0.0)


def _visible_runs(xy: np.ndarray, vis: np.ndarray):
    """把折线按可见性切成连续可见子段。"""
    runs = []
    cur = []
    for p, v in zip(xy, vis):
        if v and np.all(np.isfinite(p)):
            cur.append(p)
        else:
            if len(cur) >= 2:
                runs.append(np.asarray(cur))
            cur = []
    if len(cur) >= 2:
        runs.append(np.asarray(cur))
    return runs


def _draw_ticks(overlay: np.ndarray, seg: np.ndarray, style: LineStyle, every: int = 8, length: int = 5):
    for i in range(0, len(seg) - 1, every):
        p0, p1 = seg[i], seg[i + 1]
        d = p1 - p0
        n = np.array([-d[1], d[0]])
        norm = np.linalg.norm(n)
        if norm < 1e-6:
            continue
        n = n / norm * length
        a = np.round(p0 - n).astype(np.int32)
        b = np.round(p0 + n).astype(np.int32)
        cv2.line(overlay, tuple(a), tuple(b), style.color, 1, cv2.LINE_AA)
