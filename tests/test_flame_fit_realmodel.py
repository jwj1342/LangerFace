"""真模型集成测试：把 FLAME 2023 Open 拟合到标准 MediaPipe 脸，验证 Sprint 3 端到端效果。

依赖本地 gitignored 资产（assets/flame/flame2023_Open.pkl + mediapipe_landmark_embedding.npz）
与 scipy；CI / 他人 checkout 无资产时**整文件自动跳过**。本地运行：
    source .venv/bin/activate
    PYTHONPATH=src python -m pytest tests/test_flame_fit_realmodel.py -v
"""
import json
import os

import numpy as np
import pytest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKL = os.path.join(REPO, "assets", "flame", "flame2023_Open.pkl")
NPZ = os.path.join(REPO, "assets", "flame", "mediapipe_landmark_embedding.npz")
CANON = os.path.join(REPO, "web", "assets", "canonical_vertices.json")

pytestmark = pytest.mark.skipif(
    not (os.path.exists(PKL) and os.path.exists(NPZ)),
    reason="FLAME 模型未本地就位（assets/flame/，gitignore）——见 assets/flame/README.md",
)


def _fit():
    from langerface.flame import fit_shape_to_landmarks, load_flame_model, load_mediapipe_embedding

    observed = np.asarray(json.load(open(CANON, encoding="utf-8")), dtype=float)
    model = load_flame_model(PKL, n_shape=100)
    emb = load_mediapipe_embedding(NPZ)
    return model, fit_shape_to_landmarks(observed, model, emb)


def test_fit_real_flame_to_canonical_face():
    """拟合真 FLAME 到标准脸：输出 5023 顶点、关键点残差小、个体明显不同于 neutral 模板。"""
    model, res = _fit()
    assert res["verts"].shape == (5023, 3), "应输出 FLAME 全分辨率 5023 顶点"
    assert res["n_landmarks"] >= 50, f"可用关键点过少：{res['n_landmarks']}"
    assert res["residual"] < 0.02, f"关键点残差过大：{res['residual']} m（实测约 1.6mm）"
    assert not np.allclose(res["verts"], model["v_template"], atol=1e-3), "拟合后应明显不同于 neutral 模板"


def test_line_transfer_moves_with_fit():
    """同一组 flame-2023 图谱点 [tri,u,v] 在 neutral vs 个体顶点上采到不同 3D 位置——线随形变迁移。"""
    from langerface.flame import transfer_points

    model, res = _fit()
    atlas = [[100, 0.5, 0.3], [2000, 0.2, 0.2], [9000, 0.33, 0.33]]  # 任意合法 [tri,u,v]
    p_neutral = transfer_points(atlas, model["v_template"], model["faces"])
    p_fitted = transfer_points(atlas, res["verts"], model["faces"])
    assert p_neutral.shape == (3, 3)
    assert not np.allclose(p_neutral, p_fitted), "线条未随个体形变迁移（neutral 与个体采样相同）"
