"""One-Euro 时间平滑——去除视频/实时关键点抖动，同时保持低滞后。

参考: Casiez, Roussel, Vogel (2012) "1€ Filter"。
对整组关键点 (N, 3) 逐元素向量化滤波，按帧时间戳自适应截止频率。
默认参数取自 config.constants（与 Config 同一事实来源）。
"""
from __future__ import annotations

import numpy as np

from ..config.constants import ONEEURO_BETA, ONEEURO_DCUTOFF, ONEEURO_MIN_CUTOFF


def _alpha(cutoff: float, dt: float) -> float:
    tau = 1.0 / (2.0 * np.pi * cutoff)
    return 1.0 / (1.0 + tau / dt)


class LandmarkSmoother:
    """对 (N, 3) 关键点数组做 One-Euro 平滑，保持每个分量的内部状态。"""

    def __init__(
        self,
        min_cutoff: float = ONEEURO_MIN_CUTOFF,
        beta: float = ONEEURO_BETA,
        dcutoff: float = ONEEURO_DCUTOFF,
    ):
        self.min_cutoff = float(min_cutoff)
        self.beta = float(beta)
        self.dcutoff = float(dcutoff)
        self._x_prev: np.ndarray | None = None
        self._dx_prev: np.ndarray | None = None
        self._t_prev: float | None = None

    def reset(self) -> None:
        self._x_prev = self._dx_prev = self._t_prev = None

    def filter(self, x: np.ndarray, t: float) -> np.ndarray:
        """x: (N, 3) 当前帧关键点；t: 秒。返回平滑后的 (N, 3)。"""
        x = np.asarray(x, dtype=np.float64)
        if self._x_prev is None:
            self._x_prev = x.copy()
            self._dx_prev = np.zeros_like(x)
            self._t_prev = t
            return x

        dt = t - self._t_prev
        if dt <= 0:
            dt = 1e-3
        self._t_prev = t

        dx = (x - self._x_prev) / dt
        a_d = _alpha(self.dcutoff, dt)
        dx_hat = a_d * dx + (1 - a_d) * self._dx_prev
        self._dx_prev = dx_hat

        cutoff = self.min_cutoff + self.beta * np.abs(dx_hat)
        a = 1.0 / (1.0 + (1.0 / (2.0 * np.pi * cutoff)) / dt)
        x_hat = a * x + (1 - a) * self._x_prev
        self._x_prev = x_hat
        return x_hat
