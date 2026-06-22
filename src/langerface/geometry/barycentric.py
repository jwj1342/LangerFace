"""重心坐标基元（与领域无关的纯几何）。"""
from __future__ import annotations

import numpy as np


def barycentric_batch(p: np.ndarray, a: np.ndarray, b: np.ndarray, c: np.ndarray) -> np.ndarray:
    """对一批三角面 (a,b,c) 计算点 p 的重心坐标，返回 (M, 3) = (u,v,w) 对应 (a,b,c)。"""
    v0 = b - a
    v1 = c - a
    v2 = p[None, :] - a
    d00 = np.einsum("ij,ij->i", v0, v0)
    d01 = np.einsum("ij,ij->i", v0, v1)
    d11 = np.einsum("ij,ij->i", v1, v1)
    d20 = np.einsum("ij,ij->i", v2, v0)
    d21 = np.einsum("ij,ij->i", v2, v1)
    denom = d00 * d11 - d01 * d01
    denom = np.where(np.abs(denom) < 1e-12, 1e-12, denom)
    v = (d11 * d20 - d01 * d21) / denom
    w = (d00 * d21 - d01 * d20) / denom
    u = 1.0 - v - w
    return np.column_stack([u, v, w])
