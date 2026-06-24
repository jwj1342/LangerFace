"""FLAME 离线拟合（3D 轨 · 模式 A：关键点）。见 docs/FLAME_3D_TRACK.md。

纯 numpy 的**线性形状拟合**：FLAME 的 neutral 身份是线性 PCA 基（shapedirs），关键点位置
因此线性于形状系数 β。配合官方 mediapipe_landmark_embedding（105 个 MediaPipe 关键点 ↔
FLAME 表面重心点）+ 项目已有的 Umeyama 刚性对齐，求 β 的（带 ridge 正则）最小二乘解
→ 个体 FLAME neutral 网格。**不需要 PyTorch/GPU，CPU 秒级，离线运行**（合 #40）。

张力线迁移“免费”：flame-2023 图谱的 [tri,u,v] 在固定拓扑下形变不变，从拟合后的顶点重心
采样即得个体脸上的线（见 transfer_points）。

License：仅用 FLAME 2023 Open(CC-BY-4.0) + 本仓库自有代码；模型/embedding 经 assets/flame/
（gitignore）本地加载、不提交。读 .pkl 需 scipy（含稀疏 J_regressor）。
"""
from __future__ import annotations

import numpy as np

from .geometry.alignment import apply_sim3, umeyama

FLAME_N_SHAPE = 300  # shapedirs 前 300 维为身份，后 100 维为表情


def load_flame_model(pkl_path: str, n_shape: int = FLAME_N_SHAPE) -> dict:
    """读 FLAME .pkl → {v_template(5023,3), shapedirs(5023,3,n), faces(9976,3)}。需 scipy。"""
    import pickle

    with open(pkl_path, "rb") as fh:
        m = pickle.load(fh, encoding="latin1")
    v0 = np.asarray(m["v_template"], dtype=np.float64).reshape(-1, 3)
    sd = np.asarray(m["shapedirs"], dtype=np.float64)
    faces = np.asarray(m["f"], dtype=np.int64).reshape(-1, 3)
    n = min(n_shape, sd.shape[2])
    return {"v_template": v0, "shapedirs": sd[:, :, :n], "faces": faces}


def load_mediapipe_embedding(npz_path: str) -> dict:
    """读官方 mediapipe_landmark_embedding.npz → {lmk_face_idx, lmk_b_coords, landmark_indices}。"""
    e = np.load(npz_path, allow_pickle=True)
    return {
        "lmk_face_idx": np.asarray(e["lmk_face_idx"], dtype=np.int64),
        "lmk_b_coords": np.asarray(e["lmk_b_coords"], dtype=np.float64),
        "landmark_indices": np.asarray(e["landmark_indices"], dtype=np.int64),
    }


def sample_bary(arr: np.ndarray, faces: np.ndarray, face_idx: np.ndarray, b_coords: np.ndarray) -> np.ndarray:
    """重心采样。arr (V,3) → (L,3)；arr (V,3,n) → (L,3,n)。"""
    arr = np.asarray(arr, dtype=np.float64)
    tri = np.asarray(faces, dtype=np.int64)[np.asarray(face_idx, dtype=np.int64)]  # (L,3) 顶点索引
    pts = arr[tri]  # (L,3[,3,n])
    bc = np.asarray(b_coords, dtype=np.float64)
    if arr.ndim == 2:
        return np.einsum("lc,lcx->lx", bc, pts)
    return np.einsum("lc,lcxn->lxn", bc, pts)


def shape_verts(model: dict, beta: np.ndarray) -> np.ndarray:
    """v(β) = v_template + shapedirs[:, :, :len(β)] @ β。"""
    beta = np.asarray(beta, dtype=np.float64)
    n = beta.shape[0]
    return model["v_template"] + np.einsum("vxn,n->vx", model["shapedirs"][:, :, :n], beta)


def transfer_points(atlas_points, verts: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """把 flame 图谱点 [[tri,u,v], ...] 重心采样到给定顶点上 → (P,3) 3D 点。

    同一组 [tri,u,v] 在 neutral / 拟合后顶点上采样得不同 3D 位置——这就是“线随形变迁移”。
    """
    pts = np.asarray(atlas_points, dtype=np.float64)
    tri = pts[:, 0].astype(np.int64)
    u, v = pts[:, 1], pts[:, 2]
    w = 1.0 - u - v
    f = np.asarray(faces, dtype=np.int64)[tri]  # (P,3)
    V = np.asarray(verts, dtype=np.float64)
    return u[:, None] * V[f[:, 0]] + v[:, None] * V[f[:, 1]] + w[:, None] * V[f[:, 2]]


def fit_shape_to_landmarks(
    observed: np.ndarray,
    model: dict,
    emb: dict,
    n_shape: int = 100,
    reg: float = 1e-4,
    iters: int = 4,
) -> dict:
    """把 FLAME 拟合到一组观测关键点（observed (N,3)，按 landmark_indices 取用）。

    交替：Umeyama 把观测对齐进 FLAME 系 → 解 β 的 ridge 最小二乘。返回
    {beta(n,), verts(V,3 FLAME 系), sim(s,R,t 观测→FLAME), residual, n_landmarks}。
    """
    observed = np.asarray(observed, dtype=np.float64)
    fi, bc, li = emb["lmk_face_idx"], emb["lmk_b_coords"], emb["landmark_indices"]
    keep = li < observed.shape[0]
    fi, bc, li = fi[keep], bc[keep], li[keep]
    if li.size < 4:
        raise ValueError("可用关键点不足（embedding 与观测点不匹配）")
    target = observed[li]  # (L,3)

    faces = model["faces"]
    n = min(n_shape, model["shapedirs"].shape[2])
    SD = model["shapedirs"][:, :, :n]
    L0 = sample_bary(model["v_template"], faces, fi, bc)  # (L,3)
    J = sample_bary(SD, faces, fi, bc)                    # (L,3,n)
    A = J.reshape(-1, n)                                  # (3L,n)
    AtA = A.T @ A + reg * np.eye(n)

    beta = np.zeros(n)
    s = 1.0
    R = np.eye(3)
    t = np.zeros(3)
    for _ in range(max(1, iters)):
        Lmodel = L0 + (A @ beta).reshape(-1, 3)
        s, R, t = umeyama(target, Lmodel)                # 观测 → FLAME 系
        tgt = apply_sim3(target, s, R, t)
        beta = np.linalg.solve(AtA, A.T @ (tgt - L0).reshape(-1))

    verts = model["v_template"] + np.einsum("vxn,n->vx", SD, beta)
    fit_lmk = sample_bary(verts, faces, fi, bc)
    resid = float(np.sqrt(np.mean((fit_lmk - apply_sim3(target, s, R, t)) ** 2)))
    return {"beta": beta, "verts": verts, "sim": (s, R, t), "residual": resid, "n_landmarks": int(li.size)}
