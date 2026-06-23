# 署名 / Attribution — `flame_basis.npz`

`flame_basis.npz` 是从 **FLAME 2023 Open** 模型抽出的紧凑基（neutral 顶点 + 前 60 维身份
shapedirs + 三角面 + 官方 MediaPipe landmark embedding），供云函数 `api/fit.py` 离线拟合用。

- **模型来源**：FLAME (Faces Learned with an Articulated Model and Expressions),
  Max Planck Institute for Intelligent Systems — <https://flame.is.tue.mpg.de>
- **版本 / License**：**FLAME 2023 Open**，**CC-BY-4.0**（允许再分发与商用，须署名）。
- **引用**：Li, Bolkart, Black, Li, Romero,
  *Learning a model of facial shape and expression from 4D scans*, SIGGRAPH Asia 2017.
- **MediaPipe landmark embedding**：FLAME 官方提供（同站点下载）。

> 重新生成：本地放好 `assets/flame/flame2023_Open.pkl` + `mediapipe_landmark_embedding.npz`
> 后运行 `python tools/build_flame_basis.py`。
