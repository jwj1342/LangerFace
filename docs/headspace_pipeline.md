# HeadSpace 离线 3D 配准管线（tools/headspace）

把模板张力线**配准到 3D 头模**的离线管线（多视角标定 → 3D 关键点 → 加权 Sim3
配准 + 局部残差 → 渲染/叠加）。整理自外部实现（`pre_facegeo_headspace_pipeline`），
可复用的算法核心已收敛到 `langerface` 包，这里只保留数据集相关的 I/O、编排与渲染。

> 注：真实头模（HeadSpace / FaceScape）属受限数据集，**不随仓库提供**。
> 获取方式与本地目录约定见 [headspace_data.md](headspace_data.md)。

## 算法核心在哪里

| 能力 | 包内位置（已测试） |
|---|---|
| 加权 Umeyama / Sim3、`apply_sim3`、折线重采样 | `langerface.geometry`（`alignment.py` / `polyline.py`） |
| 多视角关键点融合、关键点加权 | `langerface.registration.landmarks` |
| 标定相机射线 / 投影 / 射线-网格求交 | `langerface.registration.camera` |

`tools/headspace/scripts/` 里的脚本通过 `from langerface... import ...` 消费上述核心（不再重复实现）。

## 脚本（`tools/headspace/scripts/`）

- `headspace_detect_468_landmarks.py` —— 多视角 PNG+TKA 上检测 MediaPipe 468 点。
- `headspace_fuse_468_from_tka.py` —— 用 TKA 标定把 2D 点抬升并融合为 3D 关键点。
- `lmk2d_to_3d_and_prealign_weighted_multiview.py` —— 多视角加权 Sim3 预对齐 CLI（也是兄弟脚本的核心 re-export 入口）。
- `facescape_to_headspace_468_sim3.py` —— 模板线 → 目标头模的 Sim3 配准。
- `headspace_apply_local_residual.py` —— 全局 Sim3 之上的局部残差场修正。
- `headspace_eval_sim3_regions.py` —— 配准区域误差评估。
- `headspace_overlay_lines_on_tka_image.py` / `headspace_overlay_mesh_projection_on_tka_image.py` —— 投影到真实采集照片。
- `render_headspace_*.py` —— **Blender** 渲染（转台 / TKA 视角 / 视频 / 正脸），需 `bpy` + `ffmpeg`。

## 依赖

`pip install -e ".[mediapipe]"` + `trimesh`；Blender 脚本另需 Blender 与 ffmpeg。
脚本均为 argparse 驱动，原作者机器上的绝对路径默认值已移除（改为 `required`）。

## 与网页标注的关系

离线管线产出/配准 3D 头模与线；交互式标注/校验请用[网页 3D 标注](annotation_web.md)
（把头模导出为 `{vertices, triangles}` JSON 后在 `/annotate.html` 加载）。
