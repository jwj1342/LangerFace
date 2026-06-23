"""从 FLAME 2023 Open .pkl 抽出云函数所需的**紧凑基** → web/api/flame_basis.npz。

内容（float32/int32 压缩）：v_template、shapedirs[:, :, :N_SHAPE]、faces、官方 mediapipe embedding。
供 Vercel Python 云函数 web/api/fit.py 离线加载（运行时只需 numpy，**不需 scipy**——
scipy 只在这里读原始 .pkl 时用到）。

License：FLAME 2023 Open = CC-BY-4.0，衍生基可随仓库分发，**须保留署名**
（见 web/api/flame_basis.NOTICE.md）。读 .pkl 需 scipy（集群 `module load scipy-stack`
或 venv 内 `pip install --no-index scipy`），并以 `PYTHONPATH=src` 运行。
"""
import os

import numpy as np

from langerface.flame import load_flame_model, load_mediapipe_embedding

N_SHAPE = 60  # 身份 PCA 维数：60 维已覆盖绝大多数个体形状，控制基体积（~3.6MB）

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKL = os.path.join(REPO, "assets", "flame", "flame2023_Open.pkl")
NPZ = os.path.join(REPO, "assets", "flame", "mediapipe_landmark_embedding.npz")
OUT = os.path.join(REPO, "web", "api", "flame_basis.npz")
WEB_BIN = os.path.join(REPO, "web", "assets", "flame_basis.bin")
# 浏览器内拟合的紧凑基（固定布局，小端）：web/flame_fit.js 按此顺序切 typed arrays。
# 顺序：v_template f32(nVerts*3) · shapedirs f32(nVerts*3*nShape) · faces i32(nFaces*3)
#       · lmk_face_idx i32(nLmk) · lmk_b_coords f32(nLmk*3) · landmark_indices i32(nLmk)
# 计数固定：nVerts=5023 nFaces=9976 nLmk=105 nShape=60（FLAME 2023 Open + 官方 embedding）。


def main() -> int:
    if not (os.path.exists(PKL) and os.path.exists(NPZ)):
        print(f"[skip] 缺 FLAME 资产（{PKL} / {NPZ}）。见 assets/flame/README.md。")
        return 0
    model = load_flame_model(PKL, n_shape=N_SHAPE)
    emb = load_mediapipe_embedding(NPZ)
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
    mb = os.path.getsize(OUT) / 1e6
    print(f"[ok] {OUT}  {mb:.2f} MB  verts={model['v_template'].shape[0]} "
          f"shapedirs={model['shapedirs'].shape} faces={model['faces'].shape}")

    # 浏览器二进制基（固定布局，小端）——供 web/flame_fit.js 本地拟合（CC-BY-4.0，可入库）。
    with open(WEB_BIN, "wb") as f:
        f.write(np.ascontiguousarray(model["v_template"], dtype="<f4").tobytes())
        f.write(np.ascontiguousarray(model["shapedirs"], dtype="<f4").tobytes())
        f.write(np.ascontiguousarray(model["faces"], dtype="<i4").tobytes())
        f.write(np.ascontiguousarray(emb["lmk_face_idx"], dtype="<i4").tobytes())
        f.write(np.ascontiguousarray(emb["lmk_b_coords"], dtype="<f4").tobytes())
        f.write(np.ascontiguousarray(emb["landmark_indices"], dtype="<i4").tobytes())
    print(f"[ok] {WEB_BIN}  {os.path.getsize(WEB_BIN) / 1e6:.2f} MB  (浏览器本地拟合基)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
