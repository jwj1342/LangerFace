"""多视角 3D 关键点融合与权重（纯 numpy）。

用于把多个标定视角各自交到 mesh 上的 3D 关键点，鲁棒融合成一套 3D 关键点，
再供 Sim3 配准（geometry.alignment）使用。来源：HeadSpace 多视角标定管线。
"""
from __future__ import annotations

import numpy as np

# MediaPipe FaceMesh 关键点分组（用于配准时的加权）。
FACE_CONTOUR_IDX = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
    152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
]
FACE_FINE_IDX = sorted({
    33, 133, 160, 159, 158, 157, 173, 246, 7, 163, 144, 145, 153, 154, 155,
    263, 362, 387, 386, 385, 384, 398, 466, 249, 390, 373, 374, 380, 381, 382,
    70, 63, 105, 66, 107, 55, 65, 52, 53, 46,
    336, 296, 334, 293, 300, 285, 295, 282, 283, 276,
    1, 2, 98, 327, 168, 195, 5, 4, 6, 197, 236, 456,
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291,
    78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308,
})


def build_landmark_weights(
    n: int, preset: str = "fine", w_fine: float = 4.0, w_contour: float = 0.25,
) -> np.ndarray:
    """构造 (n,) 关键点权重：上调五官细节点、下调脸缘轮廓点。

    preset="fine" 时进一步把非细节点整体下调，强调五官区域的配准精度。
    """
    w = np.ones((n,), dtype=np.float64)
    contour = [i for i in FACE_CONTOUR_IDX if 0 <= i < n]
    fine = [i for i in FACE_FINE_IDX if 0 <= i < n]
    w[contour] *= w_contour
    w[fine] *= w_fine
    if preset == "fine":
        mask_fine = np.zeros((n,), dtype=bool)
        mask_fine[fine] = True
        w[~mask_fine] *= 0.2
    return w


def normalize_view_weights(n_views: int, view_weights=None) -> np.ndarray:
    """规整每视角权重为 (n_views,)；None=等权。"""
    if view_weights is None:
        return np.ones((n_views,), dtype=np.float64)
    if len(view_weights) != n_views:
        raise ValueError(f"视角权重个数不符：得到 {len(view_weights)}，需 {n_views}")
    w = np.clip(np.array(view_weights, dtype=np.float64), 0.0, None)
    if np.all(w <= 0):
        raise ValueError("视角权重全为 0")
    return w


def medoid_fuse(points: np.ndarray, weights: np.ndarray, inlier_thresh: float) -> np.ndarray:
    """对同一关键点的多视角候选点做鲁棒融合：取 medoid 邻域内的加权均值。"""
    points = np.asarray(points, dtype=np.float64)
    if points.shape[0] == 1:
        return points[0]
    d = np.linalg.norm(points[:, None, :] - points[None, :, :], axis=2)
    medoid_idx = int(np.argmin(d.sum(axis=1)))
    keep = d[medoid_idx] <= inlier_thresh
    pts = points[keep]
    ws = np.asarray(weights, dtype=np.float64)[keep]
    if pts.shape[0] == 0:
        pts, ws = points, np.asarray(weights, dtype=np.float64)
    ws = ws / (ws.sum() + 1e-12)
    return (ws[:, None] * pts).sum(axis=0)


def fuse_landmarks_multiview(view_points, view_hits, view_weights, inlier_thresh: float):
    """跨视角融合每个关键点的 3D 估计。

    view_points[v]: (L,3)；view_hits[v]: (L,) bool；view_weights: (n_views,)。
    返回 (fused(L,3), hit(L,) bool, support(L,) int)。
    """
    n_views = len(view_points)
    n_lmk = view_points[0].shape[0]
    fused = np.full((n_lmk, 3), np.nan, dtype=np.float64)
    hit = np.zeros((n_lmk,), dtype=bool)
    support = np.zeros((n_lmk,), dtype=np.int32)
    for i in range(n_lmk):
        pts, ws = [], []
        for v in range(n_views):
            if view_hits[v][i] and np.isfinite(view_points[v][i, 0]):
                pts.append(view_points[v][i])
                ws.append(view_weights[v])
        support[i] = len(pts)
        if not pts:
            continue
        fused[i] = medoid_fuse(np.array(pts, dtype=np.float64), np.array(ws, dtype=np.float64), inlier_thresh)
        hit[i] = True
    return fused, hit, support
