"""把 FLAME 拟合到一组观测 MediaPipe 关键点 → 个体 FLAME neutral 网格（3D 轨 · 模式 A）。

用法：
  python tools/fit_flame_to_landmarks.py [landmarks.json]
landmarks.json：(N,3) 数组（MediaPipe 关键点，N≥468；含 iris 的 478 亦可）。缺省用
web/assets/canonical_vertices.json 做**自包含 demo**（把 FLAME 拟合到标准 MediaPipe 脸）。

输出 web/assets/flame_fitted_vertices.json（gitignore，dev-local）：个体 FLAME 顶点(5023,3)，
供 3D 查看器渲染；flame-2023 图谱（医生标注线）在该顶点上重心采样即得个体脸上的线。
读 FLAME .pkl 需 scipy（集群 `module load scipy-stack`，或 venv 内 `pip install --no-index scipy`）。
"""
import json
import os
import sys

import numpy as np

from langerface.flame import fit_shape_to_landmarks, load_flame_model, load_mediapipe_embedding

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKL = os.path.join(REPO, "assets", "flame", "flame2023_Open.pkl")
NPZ = os.path.join(REPO, "assets", "flame", "mediapipe_landmark_embedding.npz")
WEB = os.path.join(REPO, "web", "assets")
OUT = os.path.join(WEB, "flame_fitted_vertices.json")
DEFAULT_OBS = os.path.join(WEB, "canonical_vertices.json")


def main() -> int:
    if not (os.path.exists(PKL) and os.path.exists(NPZ)):
        print(f"[skip] 缺 FLAME 资产（{PKL} / {NPZ}）。见 assets/flame/README.md。")
        return 0
    obs_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OBS
    with open(obs_path, encoding="utf-8") as f:
        observed = np.asarray(json.load(f), dtype=float)
    model = load_flame_model(PKL, n_shape=100)
    emb = load_mediapipe_embedding(NPZ)
    res = fit_shape_to_landmarks(observed, model, emb)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(res["verts"].tolist(), f)
    print(
        f"[ok] {OUT}  β={res['beta'].size}d  {res['n_landmarks']} 关键点  "
        f"residual={res['residual']:.4g}  (观测={os.path.basename(obs_path)})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
