# 技术架构与复现细节

本文面向想**深入理解或从零复现**本项目的人，覆盖每个模块的职责、关键算法、坐标系约定、
数据格式、网页客户端结构与验证基准。配合 [README.md](../README.md)（总览/使用，含医学声明与已知局限）阅读。

> 维护约定：代码变更必须同步更新本文与 README。

---

## 1. 总体架构

两套等价的几何实现，共享同一份图谱与三角拓扑：

- **Python 库 `src/langerface/`**：分层核心库 + console scripts + **验证基准（ground truth）** + 3D 重建离线工具。
- **浏览器客户端 `web/`**：Vite 8 + 原生 ES Modules + MediaPipe Tasks Vision + `geometry.js`
  （Python 几何的忠实移植）+ `three3d.js`（3D Beta）。实时、本地、不上传。
  前端状态在 `state.js` 中按 `modelState` / `renderState` / `sourceState` / `recordingState` / `reconState`
  分片；`pipeline.js` 不依赖 `mode3d.js`，3D 实时投影通过无 DOM 的 `projection3d.js` 适配，避免模块环。

> 关键不变式：`web/geometry.js` 的映射/遮挡/平滑必须与 Python 端**逐点一致**，由
> `tools/test_web_mapping.mjs` 持续对拍保证（误差 < 1e-2 px、可见性 0 不一致）。

---

## 2. 关键点与标准脸模型

- **检测器**：MediaPipe **Face Landmarker**（`face_landmarker.task`），输出 **478** 个关键点
  （前 468 与标准网格拓扑对应，后 10 为虹膜）。归一化坐标 `x,y∈[0,1]`，`z` 为相对深度（与 x 同量级）。
  - 像素化：`px = x·W, py = y·H, pz = z·W`（z 乘宽，保持与 x 同尺度，供 3D 法向计算）。
- **标准脸模型** `canonical_face_model.obj`（MediaPipe 提供）：468 顶点（厘米，x 右 / y 上 / z 朝观察者）、
  **898 个三角面**、UV。顶点顺序 == 关键点索引 0..467，故 obj 的三角面可直接用于检测到的关键点。
  解析见 [`src/langerface/geometry/canonical.py`](../src/langerface/geometry/canonical.py)。

---

## 3. 2D 路线：重心坐标映射（核心）

图谱每个线点存 `(tri, u, v)`；`w = 1−u−v`。运行时取该三角面三个顶点的检测位置 `V0,V1,V2`：

```
P = u·V0 + v·V1 + w·V2
```

- 实现：[`src/langerface/lines/mapping.py`](../src/langerface/lines/mapping.py) 与 `web/geometry.js: mapAtlas`。
- 性质：**对仿射变换不变**——人脸做任意仿射形变，线条随之等价形变。由 `tests/test_mapping.py` 证明。
- 这等价于 AR"脸绘"的纹理贴合：线条天生贴在皮肤上、随姿态/表情/身份变化。

### 3.1 时间平滑（One-Euro）
[`src/langerface/detection/smoothing.py`](../src/langerface/detection/smoothing.py) / `web/geometry.js: OneEuro`。逐关键点逐坐标自适应低通：
低速重平滑（去抖），高速低滞后（跟手）。参数 `min_cutoff / beta / dcutoff`；网页"平滑"滑杆映射到 `min_cutoff/beta`。

### 3.2 背面剔除（自遮挡）
[`src/langerface/rendering/occlusion.py`](../src/langerface/rendering/occlusion.py) / `web/geometry.js: visibleTriangles`。
对每个三角面用检测到的 3D 顶点求法向，取 `nz`；**用鼻尖(索引1)所在三角面自标定"朝前"的符号**
（避免依赖缠绕方向/手性），`sign·nz ≥ 阈值` 即可见。转头时背侧线条隐藏。

### 3.3 手部遮挡（外物，仅网页）
`web/geometry.js: buildHandMasks / pointInHandMasks`。并行跑 MediaPipe **Hand Landmarker**（`hand_landmarker.task`，21 点/手）：
- 不用整手大凸包（会连指缝一起挡），而是**贴合手形掩膜** = 手掌点凸包 + 沿各指骨的"胶囊"（半径按掌宽自适应）。
- 落在掌内或任一指骨胶囊内的脸部线点剔除；**张开手指间的缝隙保留**（脸继续显示）。
- 由 `tools/test_occlusion.mjs` 验证（缝隙点不被挡，旧凸包会误挡）。

### 3.4 渲染
`web/render.js: draw` / [`src/langerface/rendering/overlay.py`](../src/langerface/rendering/overlay.py)：抗锯齿折线，被遮挡点处**断开**子段；
按面部上/中/下三段分色（额=琥珀、中=蓝、下=绿）；alpha 由"透明度"控制 + 丢脸淡入淡出。

### 3.5 关键区域放大窗
`web/render.js: drawZooms`。6 个区域（额·眉间/右眼周/左眼周/鼻·鼻唇沟/口周/颏部）各由一组关键点界定取景框，
直接从**已叠加线条的主画布**裁剪放大到小窗 → 线条/配色/遮挡自动带过去；随脸移动；与主画面同步镜像。

---

## 4. 3D 路线（Beta）

### 4.1 重建个性化 3D 人头
离线：[`tools/reconstruct_3d.py`](../tools/reconstruct_3d.py)；在线：`web/mode3d.js: startScan/finishScan`。
- 每帧取 478→前 468 关键点；用 **Umeyama 相似变换**（scale+rot+trans）把该帧网格的**刚性锚点**
  （眼角、鼻梁、轮廓极值等 16 点 `RIGID3D`）对齐到统一参考系（标准脸翻到关键点手性）。
- 对齐后的网格**逐顶点取中位数** → 稳定的个性化中性脸（中位数对表情/抖动/遮挡鲁棒）。
- 坐标统一在**屏幕手性**（x 右 / y 下 / z 入屏），便于实时配准；查看时前端翻 y/z 成 y 上。
- Umeyama 实现：`web/geometry.js: umeyama/applySim`（3×3 对称特征分解 Jacobi → SVD → R, c, t），
  由 `tools/test_umeyama.mjs` 验证（恢复已知变换误差 ~1e-13）。

### 4.2 把线贴到 3D 头并查看
[`web/three3d.js`](../web/three3d.js)（Three.js 0.184，由 Vite 打包，按需动态加载）：
- 头网格 = 重建顶点 + 898 三角面，皮肤材质 + 光照。
- 线条 = 图谱重心坐标 → 重建顶点上的 3D 点，**沿插值法向微抬**避免 z-fighting，按高度分色。
- `depthTest` + 头网格深度 → 旋转时背面线条被头自动遮挡。鼠标拖拽旋转。

### 4.3 实时配准投影
`web/mode3d.js: projectVerts`（投影模式）：每帧用 `RIGID3D` 锚点做 `umeyama(重建网格 → 当前帧活体关键点)`，
把整套重建顶点刚性变换到屏幕空间，再走 2D 的 `draw`（含背面剔除/手部遮挡）。
线条来自**稳定的重建网格**，不随表情抖动。

---

## 5. 坐标系与手性（容易踩坑）

- **关键点/屏幕**：x 右、y 下、z 入屏（左手系）。像素化乘 (W,H,W)。
- **标准脸 obj**：x 右、y 上、z 朝观察者（右手系）。
- 3D 重建统一用**屏幕手性**存储（与活体关键点一致 → Umeyama 只需旋转、无需反射）；
  Three.js 查看时翻 y、z 成 y 上展示。
- 网页/原生实时为"照镜子"体验做了**水平镜像**（CSS / cv2.flip）；放大窗同步镜像；统计文字不镜像。

---

## 6. 图谱（数据）生成与格式

- 文件：`assets/atlas_rstl.json` / `assets/atlas_langer.json`（导出到 `web/assets/`）。
- 结构：
  ```json
  {"system":"rstl","version":"0.2","provenance":"...","validated":false,
   "lines":[{"name":"f0","region":"rstl","points":[[tri,u,v], ...]}, ...]}
  ```
- 方向场流线生成 [`tools/build_field_atlas.py`](../tools/build_field_atlas.py)：
  1. 在归一化人脸框内定义朝向场 θ(x,y)：用 `(cos2θ,sin2θ)` 加权平均融合各区走向（前额横/鼻竖/眼周同心/口周放射/颊斜）。
  2. Jobard–Lefèvre 等间距流线追踪（`d_sep` 控密度，越小越密；当前 0.014）。
  3. 椭圆掩膜裁剪在脸内、挖去眼/口；每点投影到最近三角面 → `(tri,u,v)`。
- 旧的稀疏示意版见 `tools/build_initial_atlas.py`（保留备用）。

---

## 7. Python ↔ 网页 的对拍验证基准

1. `tools/dump_landmarks.py`：对示例视频若干帧跑 Python 管线，导出 关键点 + 映射结果 + 逐点可见性 → `web/test/expected.json`。
2. `tools/test_web_mapping.mjs`：用同一关键点在 JS 跑 `mapAtlas/visibleTriangles`，与 Python 结果逐点比对。
3. 改动几何后务必重跑 1+2，保持 JS==Python。

---

## 8. 资产清单与来源

| 资产 | 来源 | 用途 |
|---|---|---|
| `canonical_face_model.obj` | MediaPipe 仓库 | 顶点/三角拓扑/UV（图谱坐标基底）|
| `face_landmarker.task` (~3.6M) | MediaPipe models | 478 人脸关键点 |
| `hand_landmarker.task` (~7.5M) | MediaPipe models | 21 手部关键点（手部遮挡）|
| `atlas_rstl.json` / `atlas_langer.json` | 本项目生成（Borges RSTL 走向，示意首版）| 线条图谱 |
| `triangles.json` / `canonical_vertices.json` | 由 obj 导出 | 网页端拓扑/几何 |
| `recon_demo.json` | 示例视频重建 | 3D Beta 直接体验 |
| MediaPipe tasks-vision (JS) | npm `@mediapipe/tasks-vision@0.10.35` + jsDelivr wasm `@0.10.35` | 浏览器端推理（wasm）|
| Three.js | npm `three@0.184.0` | 3D 渲染 |

下载脚本：`tools/download_assets.py`（obj + 人脸模型）；手部模型与 web 资产见 README 复现步骤；`tools/export_web_assets.py` 导出网页资产。

---

## 9. 网页开发、构建与部署

- 本地开发：`cd web && npm run dev`，Vite 默认监听 `http://127.0.0.1:5173`。
- 生产构建：`cd web && npm ci && npm run build`，输出 `web/dist/`。
- 生产预览：`cd web && npm run preview`，Vite 默认监听 `http://127.0.0.1:4173`。
- `web/assets.js` 用 Vite `?url` 导入 `.task`、atlas JSON 与 3D 示例资产，构建后自动进入哈希化 `dist/assets/`。
- `tools/serve_web.py` 仍可服务未打包的 `web/` 源文件，但正式前端开发与部署以 Vite 为准。
- `getUserMedia`（摄像头）要求安全上下文：`http://localhost`/`127.0.0.1` 即可（无需 https）。
- 首次加载从 CDN 拉取 MediaPipe wasm（数秒）；之后浏览器缓存。

### 部署（Vercel，纯静态）
- Vercel 使用 [`web/vercel.json`](../web/vercel.json) 运行 `npm run build`，输出目录为 `dist/`。
- [`web/vercel.json`](../web/vercel.json)：`/assets/*` 设 `Cache-Control: immutable` 长缓存（~11MB 模型只下一次）。
- [`web/.vercelignore`](../web/.vercelignore)：排除本地测试/构建缓存。
- Vercel 自动 HTTPS → 线上摄像头（getUserMedia，安全上下文）可用。
- 线上：https://web-black-one-34.vercel.app
- 推荐使用 Vercel Git 集成自动部署，GitHub Actions 负责质量门禁；Vercel Project 的 Root Directory 设为 `web`。操作手册见 [CI/CD 与 Vercel 部署指南](CI_CD_VERCEL.md)。
- 更新：改 `web/` 后（动了几何/图谱/3D 资产先 `export_web_assets.py`）发 PR；CI 与 Vercel Preview 通过后合并到 `master`，由 Vercel 自动发布生产环境。

---

## 10. 从零复现要点（清单）

1. Python 3.10–3.12 + `pip install -e ".[all]"`；Node 24.15+ / npm 11+。
2. `download_assets.py` + 手部模型 → `build_field_atlas.py` → `export_web_assets.py`。
3.（可选）`reconstruct_3d.py` 生成 3D 示例。
4. `pytest` + `cd web && npm test` 全绿；`cd web && npm run build` 可生产构建。
5. `cd web && npm run dev` → 浏览器打开 Vite 地址，验证 2D 实时与 3D 查看。
6. 临床校验图谱（`annotate_atlas.py`）后置 `validated:true` 方可作正式参考。

## 11. 前端鲁棒性约束

- `tools/test_web_architecture.mjs` 会检查 `web/*.js` 的静态相对 import 图，禁止新增模块环。
- `web/logger.js` 统一记录浏览器端关键故障与降级事件；调试时可在控制台查看 `window.langerfaceDiagnostics`。
- `web/.npmrc` 启用 `engine-strict=true`，安装依赖时会严格执行 `package.json` 中的 Node/npm 版本要求。
