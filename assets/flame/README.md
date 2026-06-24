# FLAME 原始资产目录（license-gated，**不入库**）

本目录用于本地存放 **FLAME 2023 Open** 原始模型和官方 MediaPipe landmark embedding，供 3D FLAME 轨（见 issue #61）的拓扑导出、basis 构建和离线拟合使用。

> ⚠️ **本目录除本 README 外全部 gitignore。** 不要提交原始 `.pkl`、embedding、neutral OBJ、纹理模型或本地生成的完整顶点 JSON。
> 当前仓库只提交了一组从 **FLAME 2023 Open (CC-BY-4.0)** 抽出的紧凑运行时 basis，用于浏览器实时孪生和兜底拟合；署名见 `web/api/flame_basis.NOTICE.md`。

## License

- FLAME 模型：在 <https://flame.is.tue.mpg.de> 注册账号、接受 model license 后下载。
  - 旧版 FLAME 多为 *non-commercial scientific research* license；本项目运行时 basis 基于 **FLAME 2023 Open**（CC-BY-4.0）。
  - FLAME **texture model** 为 CC-BY-NC-SA 4.0（非商用 + share-alike）——**不要**用于公开部署的生产路径。
- 引用：Li et al., *Learning a model of facial shape and expression from 4D scans*, SIGGRAPH Asia 2017。

## 放什么

| 文件 | 用途 |
|---|---|
| `flame2023_Open.pkl` | 首选原始模型文件。`tools/export_flame_topology.py`、`tools/build_flame_basis.py`、`tools/fit_flame_to_landmarks.py` 都会优先读取它。 |
| `mediapipe_landmark_embedding.npz` | FLAME 官方 MediaPipe landmark embedding；关键点拟合和 basis 构建需要它。 |
| `flame_neutral.obj` | 可选 fallback neutral 头模 OBJ；仅用于 `tools/export_flame_topology.py` 在没有 `.pkl` 时导出拓扑。 |
| `generic_model.pkl` / `FLAME2023/` | 旧版或本地解包目录；仅用于本地研究，不要提交。 |

仓库中允许提交的精简产物在 `web/` 下：

| 文件 | 用途 |
|---|---|
| `web/assets/flame_basis.bin` | 浏览器端 FLAME 身份 + 表情 + jaw 紧凑 basis，供 `web/flame_fit.js` 使用。 |
| `web/api/flame_basis.npz` | `web/api/fit.py` 兜底拟合使用的身份 basis。 |
| `web/api/flame_basis.NOTICE.md` | FLAME 2023 Open 署名和重新生成说明。 |

本地生成但不提交的 FLAME 顶点 / 拓扑产物包括 `web/assets/topology_flame_2023.json`、`web/assets/flame_neutral_vertices.json`、`web/assets/flame_fitted_vertices.json`。

## 用法

```bash
# 资产就位后，导出 web 端拓扑契约（仅含三角拓扑 + 元数据；产物 gitignore）
python tools/export_flame_topology.py

# 构建可公开分发的紧凑运行时 basis（产物已提交时无需重复）
python tools/build_flame_basis.py

# 拟合到 MediaPipe 关键点，生成本地个体 FLAME 顶点（产物 gitignore）
python tools/fit_flame_to_landmarks.py [landmarks.json]

# 从 RSTL/RSTL PRSgo.png 经典图谱抽线，生成 RSTL-on-FLAME 草案图谱；
# 读取随仓库分发的 flame_basis.npz，不需要原始 pkl
python tools/register_rstl_atlas_to_flame.py
```

资产缺失时这些脚本会安全跳过并打印获取指引，CI / 他人 checkout 不受影响。

亦可用环境变量 `LANGERFACE_ASSETS_DIR` 把资产目录指到仓库外的本地路径（见 `src/langerface/config/assets.py`）。

`register_rstl_atlas_to_flame.py` 会读取本地 `RSTL/RSTL PRSgo.png` 经典正面图谱，
自动抽取 RSTL 线段，并把 `RSTL/` 资料清单写入 provenance，输出
`assets/atlas_rstl_flame.json`。该资产是
`topologyId:"flame-2023"` 的几何注册草案，始终保持 `validated:false`，
不得替代逐线临床复核。
