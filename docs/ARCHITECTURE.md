# 技术架构与复现细节

本文面向想**深入理解或从零复现**本项目的人，覆盖每个模块的职责、关键算法、坐标系约定、
数据格式、网页客户端结构与验证基准。配合 [README.md](../README.md)（总览/使用，含医学声明与已知局限）阅读。

> 维护约定：代码变更必须同步更新本文与 README。

---

## 1. 总体架构

两套等价的几何实现，共享同一份图谱与三角拓扑：

- **Python 库 `src/langerface/`**：分层核心库 + console scripts + **验证基准（ground truth）** + 3D 重建离线工具。
- **浏览器客户端 `web/`**：Vite 8 + 原生 ES Modules + MediaPipe Tasks Vision + `geometry/`
  （Python 几何的忠实移植，按 atlas / smoothing / occluders / transform 子系统分模块，`geometry.js` 为兼容 barrel re-export）
  + `three3d.js`（3D Beta）。实时、本地、不上传。
  前端状态在 `state.js` 中按 `modelState` / `renderState` / `sourceState` / `recordingState` / `reconState`
  分片；`pipeline.js` 不依赖 `mode3d.js`，3D 实时投影通过无 DOM 的 `projection3d.js` 适配，避免模块环。

> 关键不变式：`web/geometry/` 的映射/遮挡/平滑必须与 Python 端**逐点一致**，由
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

- 实现：[`src/langerface/lines/mapping.py`](../src/langerface/lines/mapping.py) 与 `web/geometry/atlas.js: mapAtlas`。
- 性质：**对仿射变换不变**——人脸做任意仿射形变，线条随之等价形变。由 `tests/test_mapping.py` 证明。
- 这等价于 AR"脸绘"的纹理贴合：线条天生贴在皮肤上、随姿态/表情/身份变化。

### 3.1 时间平滑（One-Euro）
[`src/langerface/detection/smoothing.py`](../src/langerface/detection/smoothing.py) / `web/geometry/smoothing.js: OneEuro`。逐关键点逐坐标自适应低通：
低速重平滑（去抖），高速低滞后（跟手）。参数 `min_cutoff / beta / dcutoff`；网页"平滑"滑杆映射到 `min_cutoff/beta`。

### 3.2 背面剔除（自遮挡）
[`src/langerface/rendering/occlusion.py`](../src/langerface/rendering/occlusion.py) / `web/geometry/atlas.js: visibleTriangles`。
对每个三角面用检测到的 3D 顶点求法向，取 `nz`；**用鼻尖(索引1)所在三角面自标定"朝前"的符号**
（避免依赖缠绕方向/手性），`sign·nz ≥ 阈值` 即可见。转头时背侧线条隐藏。

### 3.3 手部遮挡（外物，仅网页）
`web/geometry/occluders.js: buildHandMasks / pointInHandMasks`。并行跑 MediaPipe **Hand Landmarker**（`hand_landmarker.task`，21 点/手）：
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
- Umeyama 实现：`web/geometry/transform.js: umeyama/applySim`（3×3 对称特征分解 Jacobi → SVD → R, c, t），
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
- Vite 的唯一应用入口是 `web/app/index.html`。`index.html`、`annotate.html`、`incision_agent.html`、`surgery.html`
  只作为轻量兼容跳转页复制进 `dist/`，不再作为 Rollup 多入口应用构建。
- `web/assets.js` 用 Vite `?url` 导入 `.task`、atlas JSON 与 3D 示例资产，构建后自动进入哈希化 `dist/assets/`。
- `tools/serve_web.py` 仍可服务未打包的 `web/` 源文件，但正式前端开发与部署以 Vite 为准。
- `getUserMedia`（摄像头）要求安全上下文：`http://localhost`/`127.0.0.1` 即可（无需 https）。
- 首次加载从 CDN 拉取 MediaPipe wasm（数秒）；之后浏览器缓存。

### 部署（Vercel，纯静态）
- Vercel 使用 [`web/vercel.json`](../web/vercel.json) 运行 `npm run build`，输出目录为 `dist/`。
- [`web/vercel.json`](../web/vercel.json)：`/assets/*` 设 `Cache-Control: immutable` 长缓存（~11MB 模型只下一次）。
- [`web/.vercelignore`](../web/.vercelignore)：排除本地测试/构建缓存。
- Vercel 自动 HTTPS → 线上摄像头（getUserMedia，安全上下文）可用。
- 线上：见 [CI/CD 与 Vercel 部署指南](CI_CD_VERCEL.md#production-url) 中的 Production URL。
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
- `web/logger.js` 统一记录浏览器端关键故障、降级事件、帧指标和资产版本；调试时可在控制台查看 `window.langerfaceDiagnostics`，或调用 `window.exportLangerfaceDiagnostics()` 导出脱敏 JSON。字段约定见 [OBSERVABILITY.md](OBSERVABILITY.md)。
- `web/.npmrc` 启用 `engine-strict=true`，安装依赖时会严格执行 `package.json` 中的 Node/npm 版本要求。

---

## 12. 网页 3D 线标注与图谱草案导出

网页 3D 标注把医生在 3D 头模上标注张力线的工作流，从桌面专业软件（早期 3D Slicer 方案）搬进**浏览器**：
与项目现有 Vite + Three.js 前端同栈、零安装，并能导出待复核的项目图谱草案。当前网页工具不载入既有 atlas 做复核，也不写入医生署名或 `validated:true`。

### 打开方式

```bash
cd web
npm run dev
# 浏览器打开 Vite 地址下的 /app/annotate，例如 http://127.0.0.1:5173/app/annotate
```

生产构建（Vercel）以 `/app/*` React SPA 为唯一应用入口；`annotate.html` 仅复制为 `/app/annotate` 的兼容跳转页，
不参与 Rollup 多入口构建。配置见 [`web/vite.config.js`](../web/vite.config.js)。

### 标注工作流

1. **加载网格**：点「加载标准脸」使用内置标准脸网格；或「上传头模 JSON」（`{vertices:[[x,y,z]...], triangles:[[a,b,c]...]}`）。
2. **选线系统**：RSTL（首选）/ Langer；可填写线名与区域。
3. **画线**：拖拽旋转、滚轮缩放；点击在网格表面落控制点。相邻控制点会沿三角网格表面连接，避免直接穿过头模。
4. **保存线**：一条线至少 2 个控制点；保存后可继续标下一条线，也可从列表中编辑或删除已保存线。
5. **导出**：
   - **导出图谱**（仅标准脸）：输出 langerface 图谱格式，每点 `[三角面 id, u, v]`（重心坐标，`w=1-u-v`），与 [`src/langerface/lines/atlas.py`](../src/langerface/lines/atlas.py)、`assets/atlas_*.json` 一致；导出结果保持 `validated:false`，作为后续临床复核草案。
   - **导出 xyz**（任意头模）：输出 3D 折线坐标（`[x,y,z]`，网格局部坐标），与 `tools/headspace` 的 `*_xyz` 线兼容。

### 接入项目

- **临床校验闭环（issue #2）**：网页标注器只生成候选图谱草案；评审通过后，再由 `tools/annotate_atlas.py` 或资产维护流程替换 `assets/atlas_rstl.json` / `assets/atlas_langer.json`，将 `validated` 置 `true`，并在 `provenance` 记录校验者。
- **3D 头模标注**：HeadSpace 等头模经离线管线导出为 `{vertices, triangles}` JSON 后，可在 `/app/annotate` 上传加载；标注得到的 xyz 线可继续经 `langerface.geometry`（加权 Sim3）在头模与标准脸之间迁移。
- **数据隐私**：真实头模（HeadSpace / FaceScape）不入库，仅本地使用；标注产物（图谱/xyz JSON，仅坐标）可入库评审。

### 实现文件

| 文件 | 职责 |
|---|---|
| `web/annotate_model.js` | 纯数据模型：线/点管理、表面路径展开、重心坐标、导出图谱/xyz（node 可单测，见 `tools/test_annotate_model.mjs`） |
| `web/annotate_viewer.js` | Three.js 场景：网格加载、射线表面拾取、线与控制点渲染 |
| `web/src/services/annotateRuntime.ts` | 标注 runtime 装配（指针拖拽/点击、导出、列表、快捷键；严格 TypeScript，依赖 `.d.ts` 边界承接旧 JS 模块） |
| `web/app/index.html` / `web/src/routes/AnnotateRoute.tsx` / `web/src/components/Annotate*.tsx` | React 标注页入口与 UI |
| `web/annotate.html` / `web/annotate.css` | 标注兼容跳转页与历史样式 |

---

## 13. HeadSpace / FaceScape 离线数据与配准管线

`tools/headspace/` 是把模板张力线配准到 3D 头模的离线管线：多视角标定 → 3D 关键点 → 加权 Sim3 配准 + 局部残差 → 渲染/叠加。该部分整理自外部实现（`pre_facegeo_headspace_pipeline`），可复用算法核心已收敛到 `langerface` 包，脚本层只保留数据集相关 I/O、编排与渲染。

### 数据获取与本地目录

HeadSpace / FaceScape 数据集受许可限制，且含真人生物特征，因此**不随本仓库分发，也不应提交到公开仓库**。请各自申请许可后放在本地目录；仓库已通过 `.gitignore` 忽略数据目录。

- **HeadSpace**：多视角 PNG + `.tka` 标定 + textured OBJ。
- **FaceScape**：模板头模 / landmarks。

本地目录示例（可经 CLI 参数覆盖）：

```
tools/headspace/data/            # 本地，被 .gitignore 忽略
├─ headspacePngTka/              # 多视角采集：subjects/<sid>/<capture>/*.png + calib_*.tka
├─ headspaceOnline/              # textured OBJ：subjects/<sid>/<capture>.obj(.mtl/.bmp)
└─ out/                          # 检测/融合/配准/渲染产物
```

脚本通过 `--png_tka_root / --online_root / --out_root / --target_mesh / ...` 指定路径，无内置绝对路径默认值。
`assets/face_landmarker.task`（仓库已含）即 MediaPipe Face Landmarker，脚本默认用它，无需另置外部副本。

### 算法核心

| 能力 | 包内位置（已测试） |
|---|---|
| 加权 Umeyama / Sim3、`apply_sim3`、折线重采样 | `langerface.geometry`（`alignment.py` / `polyline.py`） |
| 多视角关键点融合、关键点加权 | `langerface.registration.landmarks` |
| 标定相机射线 / 投影 / 射线-网格求交 | `langerface.registration.camera` |

`tools/headspace/scripts/` 里的脚本通过 `from langerface... import ...` 消费上述核心，避免重复实现。

### 脚本清单

- `headspace_detect_468_landmarks.py`：多视角 PNG+TKA 上检测 MediaPipe 468 点。
- `headspace_fuse_468_from_tka.py`：用 TKA 标定把 2D 点抬升并融合为 3D 关键点。
- `lmk2d_to_3d_and_prealign_weighted_multiview.py`：多视角加权 Sim3 预对齐 CLI（也是兄弟脚本的核心 re-export 入口）。
- `facescape_to_headspace_468_sim3.py`：模板线 → 目标头模的 Sim3 配准。
- `headspace_apply_local_residual.py`：全局 Sim3 之上的局部残差场修正。
- `headspace_eval_sim3_regions.py`：配准区域误差评估。
- `headspace_overlay_lines_on_tka_image.py` / `headspace_overlay_mesh_projection_on_tka_image.py`：投影到真实采集照片。
- `render_headspace_*.py`：Blender 渲染（转台 / TKA 视角 / 视频 / 正脸），需 `bpy` + `ffmpeg`。

### 依赖与网页标注关系

`pip install -e ".[mediapipe]"` + `trimesh`；Blender 脚本另需 Blender 与 ffmpeg。脚本均为 argparse 驱动，原作者机器上的绝对路径默认值已移除（改为 `required`）。

离线管线产出/配准 3D 头模与线；交互式标注/校验使用网页 `/app/annotate`。把头模导出为 `{vertices, triangles}` JSON 后上传到标注页，导出的标注线（xyz / 图谱）只含坐标，可入库评审。

---

## 14. Stage 2 肿物与切口设计技术路线

Stage 2 目标是把当前“面部 RSTL / Langer 线迁移”扩展为“面部皮肤肿物术前切口候选设计”。系统仍然坚持一个边界：**算法只生成可解释候选与风险提示，最终切口由临床医生确认**。

### 14.1 临床输入与输出

输入分三类：

| 输入 | 来源 | 说明 |
|---|---|---|
| 患者脸部几何 | 照片 / 视频 / 实时摄像头 / 3D 扫描 | 由 MediaPipe 关键点、标准脸拓扑、2D/3D 配准得到可投射坐标系 |
| 肿物约束 | 医生标注 / 术前超声 / 病理判断 | 皮下肿物以中心、直径、深度为主；皮表肿物以边界、类圆化直径、安全切缘为主 |
| 临床规则 | 医生团队规则库 | RSTL、自然皱襞、美学亚单位边界、敏感结构例外、安全边界和禁用范围 |

输出不是“手术方案”，而是：

- RSTL / 皱襞 / 亚单位边界叠加图。
- 一个或多个候选切口线（线性或梭形）。
- 规则命中、角度偏差、长宽/尖端角/平滑指标、敏感结构警告。
- 医生编辑后的确认版本和 provenance。

高风险 guardrail 候选进入“确认候选草案”前必须记录审阅备注或覆盖原因；实时叠加入口只接受已确认候选草案，避免把未审阅草案误当成可用方案。

### 14.2 模块拆分

| 模块 | 计划位置 | 职责 | Issue |
|---|---|---|---|
| 临床规则库 | `assets/clinical_rules_face_incision.json` | 结构化区域规则、优先级、例外、审核状态 | #11 |
| 面部分区 / 亚单位 | `web/incision_tools.js` | 把点或肿物中心映射到临床区域 / 美学亚单位，并输出 bbox/边界/过渡区/敏感游离缘相关 `confidence_reasons` | #12 |
| RSTL 方向服务 | `web/incision_tools.js` | 查询局部方向、置信度和依据；离散度使用无向轴角，并输出 atlas 为空、支持点过远/过少、角度冲突等 `confidence_reasons` | #13 |
| 肿物模型 | `web/incision_tools.js`, `web/incision_agent*.js` | 表示皮下 / 皮表肿物输入、单位与输入质量摘要 | #14 |
| 皮下线性切口 | `web/incision_tools.js` | 基于超声直径和 RSTL 方向生成线性候选 | #15 |
| 皮表梭形切口 | `web/incision_tools.js` | 生成梭形候选，约束比例、尖端角和平滑对称 | #16 |
| 敏感结构 guardrails | `web/incision_tools.js` | 下睑、唇红缘、鼻翼、鼻尖、口角等风险提示、分结构 draft 距离阈值、`protective_direction` 保护性方向建议和方向例外 | #17 |
| 医生审阅 UI | `web/incision*.js` | 候选解释、编辑、版本化 provenance、覆盖、导出 | #18 |
| AR / 视频叠加 | `web/render.js`, `web/projection3d.js` | 把肿物和切口候选投射回照片、视频、实时视图 | #19 |
| 验证指标 | `docs/VALIDATION.md` | 角度误差、稳定性、医生接受率、失败分类 | #20 |
| 隐私 / 审计 | `docs/PRIVACY_AND_AUDIT.md` | 敏感数据边界、审计记录、受限存储 | #21 |
| AI 次级依据 | `tools/`, future model scripts | 皱襞/皱纹/肿物边界候选识别 | #22 |

这些模块应与 `lines/`、`rendering/` 同级接入：`lines/` 仍只负责张力线图谱，`tumor/` 负责病灶几何输入，`incision/` 负责候选曲线生成与规则解释。

### 14.3 规则优先级

默认方向选择按以下顺序：

1. **RSTL**：首选。切口长轴尽量平行松弛皮肤张力线，以降低闭合时垂直张力。
2. **自然皱襞 / 皱纹**：次选。额纹、鱼尾纹、鼻唇沟、睑缘纹、颏纹等自然凹陷可隐藏瘢痕。
3. **美学亚单位边界**：次选。眉缘、唇红缘、发际线、鼻翼沟、耳前皱襞等结构边界可降低视觉干扰。
4. **敏感结构例外**：下睑、唇红缘、鼻翼等游离边缘附近，如果平行 RSTL 会导致牵拉方向伤害形态或功能，系统必须提示，并允许医生选择保护性方向。

规则库不能只存一句文本；它至少应包含：

```json
{
  "region": "lower_eyelid",
  "primary_axis": "parallel_to_lid_margin",
  "priority": ["rstl", "natural_crease", "free_margin_guardrail"],
  "warnings": ["avoid_vertical_tension_that_may_pull_lid_margin"],
  "requires_manual_confirmation": true,
  "review_status": "draft",
  "source": "clinical_team"
}
```

### 14.4 两类肿物的候选生成

#### 皮下肿物

皮下肿物默认不设计梭形切除。候选线由肿物中心、术前超声直径、局部 RSTL 方向和医生配置的长度规则决定：

```
center = tumor.center_on_face
axis = query_rstl_direction(center)
length = f(ultrasound_diameter, clinical_rule)
candidate = segment(center, axis, length)
```

必须显示：

- 超声直径与单位来源。
- 切口长度规则。
- `length_target_mm`、`diameter_coverage_required_mm` 与 `diameter_coverage_deficit_mm`；如果最大长度规则导致线性候选短于记录直径，guardrails 必须提示医生复核。
- 与局部 RSTL 的角度偏差。
- 是否命中敏感结构 guardrail。

#### 皮表肿物

皮表肿物生成梭形候选。医生给出的当前默认规则是：长轴平行 RSTL；长轴与类圆化后的肿物直径按 3:1 控制；两端尖角默认 30°；两侧弧线对称平滑，从最宽处向两端逐渐收窄至尖点。当前实现使用对称 cubic Hermite profile：端点切线由 `tip_angle_deg` 决定，中点达到最大宽度且切线水平，导出 `tip_angle_target_deg`、`tip_angle_estimated_deg` 和 `tip_angle_error_deg`。同时导出 `boundary_point_count`、`boundary_area_mm2`、`boundary_self_intersection`、`boundary_center_shift_mm`、`axis_coverage_required_mm`、`axis_coverage_deficit_mm`、`outline_area_mm2`、`outline_half_width_monotone`、`outline_symmetry_max_error_mm`、`outline_self_intersection`、`boundary_envelope_min_margin_mm` 与 `boundary_envelope_outside_count`；当自由轮廓点数过少、面积退化、自交、边界中心明显偏离选中肿物中心、候选 outline 自交 / 非单调收窄、自由轮廓点落在实际梭形包络之外，或最大长度规则导致候选短于边界加切缘覆盖需求时，guardrails 必须提示医生复核。肿物输入还会先经过 `summarize_tumor_input_quality`，把缺作者、非 mm 单位、缺皮下深度、缺皮表切缘或边界过稀记录到 trace、审阅 JSON 和报告中。

实现时要把这些写成**参数化临床规则**，不要硬编码为不可变数学常量。原因是 3:1 与 30°在几何上并不总能同时严格成立；工程上应显示实际指标，让医生在比例、尖端角、邻近解剖结构和可直接拉拢缝合之间做判断。

候选输出建议格式：

```json
{
  "type": "fusiform",
  "axis_source": "rstl",
  "center": [0.52, 0.41],
  "axis_angle_deg": 18.5,
  "length_mm": 18.0,
  "width_mm": 6.0,
  "target_ratio": 3.0,
  "tip_angle_deg": 30.0,
  "curve": [[0.1, 0.2], [0.2, 0.25]],
  "warnings": [],
  "overrides": []
}
```

### 14.5 区域规则最小集

医生团队给出的区域规则先作为规则库 draft 进入，不直接作为 validated 临床依据：

| 区域 | 默认方向 / 设计提示 |
|---|---|
| 额部 | RSTL 水平，长轴尽量嵌入额纹；靠近眉部可贴近眉上缘阴影 |
| 颞部 / 外眦 | 斜行，沿鱼尾纹方向 |
| 上睑 | 平行睑缘弧形，优先重睑线或自然皱襞 |
| 下睑 | 平行睑缘，沿睫毛下皱襞；严禁造成纵向牵拉风险 |
| 内眦 | 沿内眦赘皮自然皱襞斜行，避免破坏内眦形态 |
| 鼻背 / 鼻根 | 中线肿物可考虑纵行，避免横跨鼻梁造成视觉干扰 |
| 鼻翼 / 鼻侧壁 | 优先鼻翼沟、鼻唇沟上段；警惕鼻翼移位或塌陷 |
| 鼻尖 | 皮肤致密、松弛度差，仅小肿物适合直接切除候选 |
| 颊部 / 鼻唇沟 | 长轴倾向平行鼻唇沟 |
| 唇红 / 口周 | 唇红缘对齐优先；避免造成唇红切迹、外翻或口角牵拉 |
| 颏部 / 下颌缘 | 颏部水平弧形；下颌缘平行下颌缘弧线 |
| 耳周 | 耳前皱襞或耳后沟是优先隐藏位置 |

### 14.6 验证与失败模式

Stage 2 必须先定义验证指标，再谈临床可用：

- RSTL 方向误差：候选长轴与医生确认方向的角度差。
- 投影稳定性：视频 / AR 中候选线端点和肿物中心的帧间抖动。
- 肿物边界误差：人工边界与系统边界的 IoU / Hausdorff / 直径误差。
- 几何规则误差：长宽比例、尖端角、曲率连续性、左右对称性。
- 敏感结构安全：敏感区警告召回率和误报率。
- 医生接受率：候选被直接接受、轻微修改、重大修改、否决的比例。

失败模式必须显式记录：检测失败、面部分区错分、方向低置信度、图谱未 validated、皮肤松弛度不足、病变性质/切缘未输入、敏感结构漏警、用户把系统输出误认为手术指令等。当前敏感游离缘距离是标准脸归一化锚点与下睑/鼻翼/唇红缘简化线段的工程筛查，并用 draft 分结构阈值触发提示，不是临床测量。

### 14.7 参考依据

- DermNet: [Skin tension lines](https://dermnetnz.org/topics/skin-tension-lines) 说明 RSTL / BEST 等张力线与切口张力、瘢痕的关系，也指出 Langer 线并不总适合作为手术切口方向。
- Google AI Edge: [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker) 输出 3D face landmarks、blendshapes 与 transformation matrices，是当前感知层依据。
- MediaPipe Wiki: [Face Mesh](https://github.com/google-ai-edge/mediapipe/wiki/MediaPipe-Face-Mesh) 描述 canonical face model、468 拓扑与 AR face effect 的几何管线。
- PubMed: [Fusiform excision](https://pubmed.ncbi.nlm.nih.gov/12722855/) 记录传统梭形切除 3:1 与 30°经验规则；后续数学模型文献提示该规则需要参数化处理，不能无条件同时严格满足。
