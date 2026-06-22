"""Sim3 / Umeyama 对齐（纯 numpy）。"""
import numpy as np
import pytest

from langerface.geometry import apply_sim3, sim3_matrix, umeyama, weighted_umeyama_sim3


def _rot(ax, ay, az):
    cx, sx = np.cos(ax), np.sin(ax)
    cy, sy = np.cos(ay), np.sin(ay)
    cz, sz = np.cos(az), np.sin(az)
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]], float)
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], float)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]], float)
    return Rz @ Ry @ Rx


def test_umeyama_recovers_known_transform():
    rng = np.random.default_rng(0)
    src = rng.uniform(-2, 2, size=(40, 3))
    s0, R0, t0 = 1.7, _rot(0.3, -0.6, 0.9), np.array([3.0, -1.5, 0.8])
    tgt = apply_sim3(src, s0, R0, t0)

    s, R, t = umeyama(src, tgt)
    assert s == pytest.approx(s0, abs=1e-9)
    assert np.allclose(R, R0, atol=1e-9)
    assert np.allclose(t, t0, atol=1e-9)
    assert np.allclose(apply_sim3(src, s, R, t), tgt, atol=1e-8)


def test_with_scale_false_keeps_unit_scale():
    rng = np.random.default_rng(1)
    src = rng.uniform(-1, 1, size=(30, 3))
    R0, t0 = _rot(0.1, 0.2, -0.3), np.array([1.0, 2.0, -1.0])
    tgt = apply_sim3(src, 1.0, R0, t0)
    s, R, t = umeyama(src, tgt, with_scale=False)
    assert s == pytest.approx(1.0, abs=1e-9)
    assert np.allclose(apply_sim3(src, s, R, t), tgt, atol=1e-8)


def test_zero_weight_ignores_outlier():
    rng = np.random.default_rng(2)
    src = rng.uniform(-2, 2, size=(25, 3))
    s0, R0, t0 = 1.2, _rot(-0.2, 0.5, 0.1), np.array([0.5, 0.0, -2.0])
    tgt = apply_sim3(src, s0, R0, t0)
    # 污染一个目标点，但给它 0 权重 —— 解应当不受影响
    tgt_bad = tgt.copy()
    tgt_bad[7] += np.array([100.0, -80.0, 50.0])
    w = np.ones(len(src))
    w[7] = 0.0
    s, R, t = weighted_umeyama_sim3(src, tgt_bad, w)
    assert s == pytest.approx(s0, abs=1e-6)
    assert np.allclose(R, R0, atol=1e-6)
    assert np.allclose(t, t0, atol=1e-6)


def test_sim3_matrix_matches_apply():
    rng = np.random.default_rng(3)
    pts = rng.uniform(-1, 1, size=(10, 3))
    s, R, t = 0.8, _rot(0.4, 0.0, 0.7), np.array([1.0, -1.0, 2.0])
    T = sim3_matrix(s, R, t)
    hom = np.c_[pts, np.ones(len(pts))] @ T.T
    assert np.allclose(hom[:, :3], apply_sim3(pts, s, R, t), atol=1e-9)


def test_bad_shapes_raise():
    with pytest.raises(ValueError):
        umeyama(np.zeros((4, 3)), np.zeros((5, 3)))
    with pytest.raises(ValueError):
        weighted_umeyama_sim3(np.zeros((4, 3)), np.zeros((4, 3)), np.zeros(4))  # all-zero weights
