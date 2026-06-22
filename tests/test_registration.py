"""多视角关键点融合与权重（纯 numpy）+ 折线重采样。"""
import numpy as np
import pytest

from langerface.geometry import resample_polyline_arclen
from langerface.registration import (
    build_landmark_weights,
    fuse_landmarks_multiview,
    medoid_fuse,
    normalize_view_weights,
)


def test_medoid_fuse_rejects_far_outlier():
    pts = np.array([[0, 0, 0], [0.01, 0, 0], [-0.01, 0.01, 0], [5, 5, 5]], float)
    w = np.ones(4)
    fused = medoid_fuse(pts, w, inlier_thresh=0.1)
    assert np.linalg.norm(fused) < 0.05  # 远离群点被剔除


def test_fuse_landmarks_multiview_shapes_and_support():
    L = 3
    v0 = np.array([[0, 0, 0], [1, 1, 1], [np.nan, np.nan, np.nan]], float)
    v1 = np.array([[0.01, 0, 0], [np.nan, np.nan, np.nan], [2, 2, 2]], float)
    hits0 = np.array([True, True, False])
    hits1 = np.array([True, False, True])
    fused, hit, support = fuse_landmarks_multiview([v0, v1], [hits0, hits1], np.array([1.0, 1.0]), 0.1)
    assert fused.shape == (L, 3) and hit.shape == (L,) and support.shape == (L,)
    assert support.tolist() == [2, 1, 1]
    assert hit.all()
    assert np.allclose(fused[0], [0.005, 0, 0], atol=1e-6)


def test_build_landmark_weights_emphasizes_fine():
    w = build_landmark_weights(468, preset="fine")
    assert w.shape == (468,)
    assert w[1] > w[10]  # 鼻尖(细节) 权重 > 前额顶(轮廓)


def test_normalize_view_weights():
    assert np.allclose(normalize_view_weights(3), np.ones(3))
    with pytest.raises(ValueError):
        normalize_view_weights(3, [1.0, 1.0])  # 个数不符


def test_resample_polyline_arclen():
    P = np.array([[0, 0, 0], [10, 0, 0]], float)
    out = resample_polyline_arclen(P, 11)
    assert out.shape == (11, 3)
    assert np.allclose(out[0], P[0]) and np.allclose(out[-1], P[-1])
    # 直线等弧长重采样 → x 均匀步进
    assert np.allclose(np.diff(out[:, 0]), 1.0, atol=1e-9)
