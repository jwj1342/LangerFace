"""折线（线条）几何工具：等弧长重采样。"""
from __future__ import annotations

import numpy as np


def resample_polyline_arclen(points: np.ndarray, n_samples: int, smooth: float = 0.0) -> np.ndarray:
    """按弧长把折线 ``points (N, 3)`` 均匀重采样为 ``n_samples`` 个点。

    smooth > 0 时对结果做几次保端点的拉普拉斯平滑（lam=smooth）。
    """
    P = np.asarray(points, dtype=np.float64)
    if P.shape[0] < 2:
        return P.copy()
    seg = np.linalg.norm(P[1:] - P[:-1], axis=1)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    length = s[-1]
    if length < 1e-12:
        return np.repeat(P[:1], n_samples, axis=0)
    s /= length
    s_new = np.linspace(0.0, 1.0, n_samples)
    out = np.empty((n_samples, P.shape[1]), dtype=np.float64)
    for k in range(P.shape[1]):
        out[:, k] = np.interp(s_new, s, P[:, k])
    if smooth > 0:
        lam = float(smooth)
        Q = out.copy()
        for _ in range(5):
            Q[1:-1] = (1 - lam) * Q[1:-1] + 0.5 * lam * (Q[:-2] + Q[2:])
        out = Q
    return out
