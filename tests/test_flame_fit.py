"""FLAME 线性形状拟合（langerface.flame）：合成模型验证，不依赖真 FLAME 资产 / scipy。

真模型的加载（load_flame_model / load_mediapipe_embedding）需本地 gitignored 资产 + scipy，
由 tools/fit_flame_to_landmarks.py 在本地运行；此处只测纯 numpy 的拟合 / 采样 / 迁移数学。
"""
import numpy as np
import pytest

from langerface.flame import (
    fit_shape_to_landmarks,
    sample_bary,
    shape_verts,
    transfer_points,
)


def _toy_model(V=40, n=3, seed=0):
    rng = np.random.default_rng(seed)
    faces = np.array([[i, (i + 1) % V, (i + 2) % V] for i in range(V)], dtype=np.int64)
    return {
        "v_template": rng.standard_normal((V, 3)),
        "shapedirs": rng.standard_normal((V, 3, n)) * 0.3,
        "faces": faces,
    }


def _toy_emb(model, L=12, seed=1):
    rng = np.random.default_rng(seed)
    raw = rng.random((L, 3)) + 0.05
    return {
        "lmk_face_idx": rng.integers(0, model["faces"].shape[0], size=L),
        "lmk_b_coords": raw / raw.sum(axis=1, keepdims=True),  # 归一化重心
        "landmark_indices": np.arange(L),
    }


def test_sample_bary_shapes():
    m = _toy_model()
    emb = _toy_emb(m)
    L = emb["landmark_indices"].size
    assert sample_bary(m["v_template"], m["faces"], emb["lmk_face_idx"], emb["lmk_b_coords"]).shape == (L, 3)
    assert sample_bary(m["shapedirs"], m["faces"], emb["lmk_face_idx"], emb["lmk_b_coords"]).shape == (L, 3, 3)


def test_fit_recovers_known_shape():
    m = _toy_model(n=3)
    emb = _toy_emb(m, L=12)
    beta_true = np.array([0.8, -0.5, 0.3])
    true_verts = shape_verts(m, beta_true)
    lmk_true = sample_bary(true_verts, m["faces"], emb["lmk_face_idx"], emb["lmk_b_coords"])
    # 观测 = 真关键点施加已知相似变换（尺度 2.5 + 绕 z 旋转 + 平移）
    th = 0.6
    rz = np.array([[np.cos(th), -np.sin(th), 0], [np.sin(th), np.cos(th), 0], [0, 0, 1]])
    observed = 2.5 * (rz @ lmk_true.T).T + np.array([1.0, -2.0, 0.5])
    res = fit_shape_to_landmarks(observed, m, emb, n_shape=3, reg=1e-8, iters=20)
    scale = float(np.linalg.norm(observed.std(axis=0)))
    # 残差远小于数据尺度（关键点拟合良好）
    assert res["residual"] < 1e-2 * scale
    # FLAME 系下，拟合后关键点 ≈ 真关键点（相似变换被 Umeyama 吸收；关键点被钉住、不受 gauge 影响）
    fit_lmk = sample_bary(res["verts"], m["faces"], emb["lmk_face_idx"], emb["lmk_b_coords"])
    assert np.allclose(fit_lmk, lmk_true, atol=1e-2 * scale)
    assert res["n_landmarks"] == 12


def test_transfer_points_rides_deformation():
    m = _toy_model(n=2)
    atlas = [[0, 0.5, 0.3], [3, 0.2, 0.2]]  # 一条线两个 [tri,u,v] 点
    p_neutral = transfer_points(atlas, m["v_template"], m["faces"])
    p_deformed = transfer_points(atlas, shape_verts(m, np.array([1.5, -1.0])), m["faces"])
    assert p_neutral.shape == (2, 3)
    assert not np.allclose(p_neutral, p_deformed)  # 同一 [tri,u,v] 形变前后采到不同 3D 位置


def test_fit_rejects_too_few_landmarks():
    m = _toy_model()
    emb = _toy_emb(m, L=12)
    with pytest.raises(ValueError):
        fit_shape_to_landmarks(np.zeros((2, 3)), m, emb)  # 观测点太少 → 可用关键点 < 4
