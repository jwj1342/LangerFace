"""从 FLAME 2023 Open .pkl 抽出紧凑基。

两份产物：web/api/flame_basis.npz（云函数·身份）+ web/assets/flame_basis.bin（浏览器·身份+表情+jaw）。

浏览器 .bin 固定布局（小端），供 web/flame_fit.js 切 typed arrays / 实现 FLAME 前向（含表情 + jaw 蒙皮）：
  v_template f32(NV*3) · shapeDirs f32(NV*3*NS) · exprDirs f32(NV*3*NE) · faces i32(NF*3)
  · lmk_face_idx i32(NL) · lmk_b_coords f32(NL*3) · landmark_indices i32(NL)
  · jawReg f32(NV)   —— J_regressor 第 2 行（jaw 关节）· jawW f32(NV) —— weights[:,2]（jaw 蒙皮权重）
计数固定：NV=5023 NF=9976 NL=105 NS=60 NE=50（FLAME 2023 Open + 官方 embedding）。

License：FLAME 2023 Open = CC-BY-4.0，衍生基可随仓库分发（署名见 web/api/flame_basis.NOTICE.md）。
读 .pkl 需 scipy；以 `PYTHONPATH=src` 运行。
"""
import os
import pickle

import numpy as np
import scipy.sparse as sp

from langerface.flame import load_flame_model, load_mediapipe_embedding

NS, NE = 60, 50          # 身份 / 表情 PCA 维数
JAW_JOINT = 2            # FLAME 关节：0 global · 1 neck · 2 jaw · 3/4 eyes

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKL = os.path.join(REPO, "assets", "flame", "flame2023_Open.pkl")
NPZ_EMB = os.path.join(REPO, "assets", "flame", "mediapipe_landmark_embedding.npz")
OUT = os.path.join(REPO, "web", "api", "flame_basis.npz")
WEB_BIN = os.path.join(REPO, "web", "assets", "flame_basis.bin")


def _raw(pkl):
    with open(pkl, "rb") as f:
        m = pickle.load(f, encoding="latin1")
    sd = np.asarray(m["shapedirs"], dtype=np.float64)  # (NV,3,400) = 300 shape + 100 expr
    jr = m["J_regressor"]
    jr = jr.toarray() if sp.issparse(jr) else np.asarray(jr)
    return {
        "v_template": np.asarray(m["v_template"], dtype=np.float64).reshape(-1, 3),
        "shape": sd[:, :, :NS],
        "expr": sd[:, :, 300:300 + NE],
        "faces": np.asarray(m["f"], dtype=np.int64).reshape(-1, 3),
        "jaw_reg": np.asarray(jr[JAW_JOINT], dtype=np.float64),       # (NV,)
        "jaw_w": np.asarray(m["weights"], dtype=np.float64)[:, JAW_JOINT],  # (NV,)
    }


def main() -> int:
    if not (os.path.exists(PKL) and os.path.exists(NPZ_EMB)):
        print(f"[skip] 缺 FLAME 资产（{PKL} / {NPZ_EMB}）。见 assets/flame/README.md。")
        return 0
    emb = load_mediapipe_embedding(NPZ_EMB)

    # 云函数 npz（身份 only，运行时只需 numpy）—— 维持不变
    model = load_flame_model(PKL, n_shape=NS)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    np.savez_compressed(
        OUT,
        v_template=model["v_template"].astype(np.float32),
        shapedirs=model["shapedirs"].astype(np.float32),
        faces=model["faces"].astype(np.int32),
        lmk_face_idx=emb["lmk_face_idx"].astype(np.int32),
        lmk_b_coords=emb["lmk_b_coords"].astype(np.float32),
        landmark_indices=emb["landmark_indices"].astype(np.int32),
    )
    print(f"[ok] {OUT}  {os.path.getsize(OUT) / 1e6:.2f} MB（云·身份）")

    # 浏览器 .bin（身份 + 表情 + jaw）
    r = _raw(PKL)
    with open(WEB_BIN, "wb") as f:
        f.write(np.ascontiguousarray(r["v_template"], dtype="<f4").tobytes())
        f.write(np.ascontiguousarray(r["shape"], dtype="<f4").tobytes())
        f.write(np.ascontiguousarray(r["expr"], dtype="<f4").tobytes())
        f.write(np.ascontiguousarray(r["faces"], dtype="<i4").tobytes())
        f.write(np.ascontiguousarray(emb["lmk_face_idx"], dtype="<i4").tobytes())
        f.write(np.ascontiguousarray(emb["lmk_b_coords"], dtype="<f4").tobytes())
        f.write(np.ascontiguousarray(emb["landmark_indices"], dtype="<i4").tobytes())
        f.write(np.ascontiguousarray(r["jaw_reg"], dtype="<f4").tobytes())
        f.write(np.ascontiguousarray(r["jaw_w"], dtype="<f4").tobytes())
    print(f"[ok] {WEB_BIN}  {os.path.getsize(WEB_BIN) / 1e6:.2f} MB（浏览器·身份+表情+jaw，NS={NS} NE={NE}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
