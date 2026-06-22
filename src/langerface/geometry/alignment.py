"""刚性 + 尺度对齐（Sim3 / Umeyama）——3D 配准的公共基元。

整合自多视角 HeadSpace 标定管线（tools/headspace 的加权多视角预对齐）与
tools/reconstruct_3d.py 的相似变换，统一到此处，并与 web/geometry.js 的 umeyama
算法保持一致。纯 numpy，可单测。
"""
from __future__ import annotations

import numpy as np


def weighted_umeyama_sim3(
    src: np.ndarray,
    tgt: np.ndarray,
    weights: np.ndarray | None = None,
    with_scale: bool = True,
) -> tuple[float, np.ndarray, np.ndarray]:
    """加权 Umeyama 相似变换：求 (s, R, t) 使 ``s·R·src + t ≈ tgt`` 的加权最小二乘解。

    src, tgt: (N, 3)；weights: (N,) 或 None（等权）。返回 ``(s, R(3,3), t(3,))``。
    """
    src = np.asarray(src, dtype=np.float64)
    tgt = np.asarray(tgt, dtype=np.float64)
    if src.shape != tgt.shape or src.ndim != 2 or src.shape[1] != 3:
        raise ValueError("src/tgt 必须是同形的 (N, 3)")

    n = src.shape[0]
    if weights is None:
        w = np.ones(n)
    else:
        w = np.clip(np.asarray(weights, dtype=np.float64).reshape(-1), 0.0, None)
    sw = w.sum()
    if sw <= 1e-12:
        raise ValueError("权重之和为 0")
    w = w / sw

    mu_x = (w[:, None] * src).sum(axis=0)
    mu_y = (w[:, None] * tgt).sum(axis=0)
    X = src - mu_x
    Y = tgt - mu_y

    cov = (w[:, None, None] * (Y[:, :, None] @ X[:, None, :])).sum(axis=0)
    U, D, Vt = np.linalg.svd(cov)
    S = np.eye(3)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        S[2, 2] = -1.0
    R = U @ S @ Vt

    if with_scale:
        var_x = (w[:, None] * (X * X)).sum()
        s = float(np.trace(np.diag(D) @ S) / (var_x + 1e-12))
    else:
        s = 1.0

    t = mu_y - s * (R @ mu_x)
    return s, R, t


def umeyama(src: np.ndarray, tgt: np.ndarray, with_scale: bool = True):
    """等权 Umeyama 相似变换（weighted 版的便捷封装）。"""
    return weighted_umeyama_sim3(src, tgt, None, with_scale=with_scale)


def apply_sim3(points: np.ndarray, s: float, R: np.ndarray, t: np.ndarray) -> np.ndarray:
    """对点集 ``points (N, 3)`` 施加 Sim3：``s·R·P + t``。"""
    points = np.asarray(points, dtype=np.float64)
    Rm = np.asarray(R, dtype=np.float64)
    tv = np.asarray(t, dtype=np.float64).reshape(1, 3)
    return (s * (Rm @ points.T)).T + tv


def sim3_matrix(s: float, R: np.ndarray, t: np.ndarray) -> np.ndarray:
    """把 (s, R, t) 组装成 4x4 齐次矩阵（左上 3x3 已含尺度 s·R）。"""
    T = np.eye(4, dtype=np.float64)
    T[:3, :3] = s * np.asarray(R, dtype=np.float64)
    T[:3, 3] = np.asarray(t, dtype=np.float64).reshape(3)
    return T
