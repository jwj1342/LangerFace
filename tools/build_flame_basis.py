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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
