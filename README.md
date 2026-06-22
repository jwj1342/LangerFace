# 面部朗格线迁移 · Facial Langer/RSTL Line Projection

把皮肤张力线（**RSTL / Langer 线**）**稳定地、贴合地**叠加到人脸的照片、视频或实时摄像头画面上，
作为面部手术**切口规划的决策辅助可视化**——医生能直观看到沿哪个方向下刀疤痕最小、恢复最好。

> ⚠️ **医学声明**：本工具是决策辅助可视化，**不是**手术指令，**不是**受监管的医疗器械。
> 内置线条图谱为**示意性首版（未经临床验证）**，方向参考 Borges RSTL，几何为近似，
> 必须经临床医生用标注工具校验后方可参考。最终切口由主刀医生负责。详见 [docs/MEDICAL.md](docs/MEDICAL.md)。

---

## 目录
- [项目定位](#项目定位)
- [它能做什么](#它能做什么)
- [核心原理（为什么稳，而非"图一乐"）](#核心原理)
- [两条技术路线](#两条技术路线)
- [快速开始 / 复现](#快速开始--复现)
- [使用方式](#使用方式)
- [线条图谱（数据）](#线条图谱数据)
- [目录结构](#目录结构)
- [验证与测试](#验证与测试)
- [已知局限](#已知局限)
- [部署（Vercel）](#部署vercel)
- [开发文档](#开发文档)
- [后续路线图](#后续路线图)
- [文档维护约定](#文档维护约定)

---

## 项目定位

LangerFace 是一个面向面部手术规划研究的计算机视觉原型。它把医学上可校验、可编辑的 RSTL / Langer 线图谱编码到 MediaPipe 标准脸网格上，再在照片、视频或实时摄像头画面中将图谱稳定映射到当前人脸。

项目分成三层：

1. **领域数据层**：`assets/` 与 `web/assets/` 保存标准脸、关键点模型、三角拓扑和线条图谱。
2. **核心算法层**：`src/langerface/` 和 `web/geometry.js` 实现关键点输入、重心坐标映射、平滑、遮挡、渲染与 3D 配准。
3. **用户界面层**：`web/` 提供唯一正式前端；`src/langerface/apps/` 只保留 CLI 和 OpenCV webcam 入口。

当前阶段是 **Stage 1：稳定显示面部 RSTL / Langer 皮肤张力线**。Stage 2 才会扩展到肿物模拟、切口设计和更完整的术前辅助工作流。项目不训练自定义医学模型，不上传用户图像，也不声称自动给出手术方案。

---

## 它能做什么

- 🎥 **网页实时摄像头**：浏览器打开网址 → 开摄像头 → 张力线实时贴合人脸，做任何动作线条都跟随。
- 🖼️ **上传照片/视频**：网页上传，叠加后返回（图片单帧、视频逐帧）。
- 🧰 **命令行批处理**：对图片/视频文件离线渲染输出。
- 🔬 **两种线系统**：RSTL（Borges，面部首选）与经典 Langer，可一键切换、按区域分色。
- 🖐️ **遮挡处理**：转头时背面线条隐藏；**手挡在脸前时，手覆盖处不画线**（贴合手形掩膜，指缝保留）。
- 🔍 **关键区域放大窗**：主画面下方 6 个放大窗（额·眉间 / 双眼周 / 鼻·鼻唇沟 / 口周 / 颏部）同屏显示细节。
- 🧊 **3D 重建（Beta）**：多视角转头扫描 → 重建个性化 3D 人头 → 把线贴到 3D 表面 → 可旋转查看 / 实时配准投影。
- 🎛️ **实时可调**：线密度、平滑强度、透明度、遮挡、镜像、分区着色、放大窗等。
- 🔒 **全程本地运行**，不上传任何画面（隐私友好）。

---

## 核心原理

这是一个 **模板配准（template registration）** 问题，**不是**"训练模型预测线条"——也不存在这样的训练数据。

1. **预训练 AI 负责感知**：用 Google MediaPipe Face Landmarker 输出 **478 个 3D 人脸关键点**（前 468 个与标准网格拓扑一致），实时、跨姿态、跨身份。
2. **医学知识编码为"贴在标准脸上的图谱"**：张力线一次性数字化到 MediaPipe **标准脸网格**，每个线点存成 `(三角面 id, 重心坐标 u, v)`。
3. **线条随脸网格变形**：运行时同一套三角拓扑把图谱映射到检测到的人脸上——
   `点 = u·V0 + v·V1 + w·V2`（V 为该三角面三个检测顶点）。这是精确的**分片仿射变形**（即 AR"脸绘"技术），
   对身份、姿态、表情天然不变，是稳定性的根基。
4. **稳定性工程**：One-Euro 时间平滑去抖动、置信度门控淡入淡出、背面剔除、手部遮挡掩膜。

> 不训练自定义模型是刻意为之：复用稳健的预训练关键点模型 + 可编辑可校验的图谱资产，
> 才有可复现、可解释、可被临床医生修正的系统，而不是一个抖动不可控的黑盒。

单帧数据流（2D 路线）：

```
图像/帧 → MediaPipe 478 关键点 → One-Euro 平滑 → 重心坐标映射(图谱) → 背面剔除 + 手部遮挡 → 抗锯齿叠加
```

---

## 两条技术路线

网页左上「技术路线」可切换；**默认 2D（稳定）**，3D 为 Beta。

| | **2D 贴合（默认）** | **3D 重建（Beta）** |
|---|---|---|
| 思路 | 每帧把图谱按重心坐标贴到当前帧脸网格（2.5D：用 3D 关键点，z 仅用于背面剔除）| 多视角扫描重建**持久的个性化 3D 人头**，线贴到 3D 表面，实时把 3D 头刚性配准到活体脸再投影 |
| 个性化 | 隐式（逐帧跟随真实关键点）| 显式（重建出你的中性脸网格，可旋转查看、可导出潜力）|
| 表情 | 线随表情自然形变 | 刚性配准，线不随表情抖动（更像稳定的"皮肤张力图"）|
| 遮挡 | 背面剔除（启发式）| 渲染时 z 缓冲精确自遮挡 |
| 成熟度 | 稳定、已大量验证 | Beta：示例重建+旋转查看已验证；在线扫描/投影需摄像头实测 |
| 实现 | Canvas 2D | Three.js（WebGL）|

3D 重建流程：每帧 478 关键点 → 用相似变换(Umeyama)对齐到统一参考系 → **各顶点取中位数**得到稳定中性脸 →
图谱按重心坐标贴到该网格 → Three.js 渲染（可旋转）/ 每帧 Umeyama 刚性配准到活体脸投影（z 缓冲遮挡）。

---

## 快速开始 / 复现

环境：**Python 3.10–3.12**（勿用 3.13，mediapipe 暂不支持）、**Node 24.15+ / npm 11+**（Vite 前端）、现代浏览器（建议 Chrome）。
在 Compute Canada / Alliance 集群上，前端开发可先运行 `module load nodejs/24.15.0`。

```bash
# 1) 依赖
pip install -e ".[all]"

# 2) 下载 MediaPipe 资产（标准脸 obj + 人脸关键点模型）
python3 tools/download_assets.py
#   手部模型（用于手部遮挡，网页端）：
curl -L -o web/assets/hand_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task

# 3) 生成线条图谱（稠密方向场流线，RSTL + Langer）
python3 tools/build_field_atlas.py 0.014        # 数字越小越密

# 4) 导出网页端资产（triangles / atlas / canonical_vertices / 复制模型）
python3 tools/export_web_assets.py

# 5)（可选）用示例视频重建一个 3D 头，供 3D Beta 直接体验
python3 tools/reconstruct_3d.py local_media/IMG_3458.MOV    # -> web/assets/recon_demo.json

# 6) 测试 / 构建
pytest -q                         # Python 端
cd web
npm ci
npm run build                      # Vite 生产构建
npm test                           # JS 几何/遮挡/Umeyama 对拍
cd ..

# 7) 启动网页
cd web
npm run dev                      # Vite dev server，默认 http://127.0.0.1:5173
```

浏览器打开 Vite 提示的本地地址 → 点「摄像头」→ 允许权限。首次加载会从 CDN 下载 MediaPipe wasm（数秒）。

---

## 使用方式

### 网页（推荐，实时）
进入 `web/` 后运行 `npm run dev`，打开 Vite 提示的本地地址：
- **数据源**：上传照片/视频，或开摄像头；可暂停、导出（录制画布为 webm）。
- **模板**：RSTL（首选）/ Langer。
- **滑杆**：线密度、平滑、透明度。
- **开关**：限制在面部轮廓内（背面剔除）、前方手部遮挡、镜像、按面部分区着色、细节放大窗、显示网格采样点。
- **技术路线**：2D（默认）/ 3D 重建（Beta，含"用示例重建/转头扫描/旋转查看/投影到画面"）。
- **统计**：追踪质量、状态、脸部占比、偏航估计、线束数量、fps。

### 命令行
```bash
langerface --image face.jpg --system rstl -o out.png
langerface --video clip.mp4 --system langer -o out.mp4
langerface-webcam --system rstl          # 原生窗口实时（热键 t/o/s/q）
```

### 临床校验图谱（关键）
内置图谱仅为示意，临床医生用标注工具修正后才可作正式参考：
```bash
python3 tools/annotate_atlas.py --system rstl                       # 在标准脸上直接画/改
python3 tools/digitize_from_diagram.py --system rstl --diagram ref.png  # 从文献图描线
```

---

## 线条图谱（数据）

- **格式**（JSON）：每条线是点序列，每点 `[三角面id, u, v]`（重心坐标，`w = 1−u−v`）。见 [`src/langerface/lines/atlas.py`](src/langerface/lines/atlas.py)。
- **生成**：[`tools/build_field_atlas.py`](tools/build_field_atlas.py) —— 在"人脸归一化框"上定义张力线**方向场** θ(x,y)
  （前额横、鼻/人中竖、眼周同心、口周放射、颊部斜行），用 Jobard–Lefèvre **等间距流线**算法追踪出布满全脸的细密线，
  再投影到网格三角面。当前 RSTL **132 条线**、Langer **110 条线**。
- **来源与状态**：方向遵循 **Borges RSTL** 的总体走向；几何为**近似**；`validated: false`。
- **校验闭环**：`annotate_atlas.py` / `digitize_from_diagram.py` 让临床医生修正，保存后 `validated` 置 `true` 并记录校验者。

---

## 目录结构

| 路径 | 作用 |
|---|---|
| `.claude/` | Claude Code 相关启动配置；本地私有设置文件已被 `.gitignore` 排除。 |
| `.github/` | GitHub Actions CI；包含 Python 测试、JS/Vite 构建和几何对拍。 |
| `assets/` | Python 端权威资产：MediaPipe 标准脸 obj、人脸 landmarker `.task`、RSTL/Langer atlas JSON。 |
| `docs/` | 项目文档：架构、医学声明、环境配置、贡献指南。 |
| `src/langerface/` | Python 核心库，按 `config/geometry/detection/lines/rendering/pipeline/media/apps` 分层。 |
| `tests/` | pytest 测试，覆盖图谱、标准脸、映射、稳定性、渲染和 pipeline 行为。 |
| `tools/` | 资产下载、图谱生成、web 资产导出、3D 重建、临床标注、目检和对拍脚本。 |
| `web/` | Vite 8 前端；原生 ES Modules + Canvas 2D + MediaPipe Tasks + Three.js 3D Beta。 |
| `web/assets/` | 浏览器端静态资产，由 `tools/export_web_assets.py` 同步或复制。 |
| `web/test/` | JS/Python 几何对拍用 ground truth 和本地测试图像；真实图片被忽略。 |
| `local_media/` | 本地视频、照片和输出视频，例如 `IMG_3458.MOV`、`out_rstl.mp4`；不提交。 |
| `logs/` | 本地运行日志；不提交。 |
| `local_outputs/` | 本地调试输出，例如 `local_outputs/debug_frames/` 里的目检截图和拼图；不提交。 |
| `local_archives/` | 本地压缩包、外部资料归档；不提交。 |

关键文件：

| 文件 | 作用 |
|---|---|
| `pyproject.toml` | Python 包元数据、可选依赖、console scripts、ruff/pytest 配置。 |
| `requirements.txt` | 兼容旧流程的 Python 依赖入口；推荐使用 `pip install -e ".[all]"`。 |
| `web/package.json` | Node 24 / Vite 8 前端脚本和 npm 依赖。 |
| `web/vite.config.js` | Vite 静态资产处理、生产构建和本地 dev server 配置。 |

---

## 验证与测试

- **JS 与 Python 逐点一致**（`cd web && npm test`）：用真实帧关键点对拍，映射误差 ~5×10⁻⁵px、遮挡 0 不一致。
- **手部遮挡掩膜**（`node tools/test_occlusion.mjs`）：手指上/手掌被挡、**指缝保留**、无手不剔除。
- **Umeyama 相似变换**（`node tools/test_umeyama.mjs`）：施加已知变换可恢复（误差 ~1e-13）。
- **Python 单测**（`pytest`）：图谱完整性、标准脸解析、映射仿射不变性、平滑降抖动、端到端渲染。
- **目检脚本**：`tools/render_check.py`、`inspect_frames.py`、`montage.py`、`sample_output.py`、`debug_one.py`。
- **浏览器实测**：UI/3D 查看通过截图核对；实时摄像头链路需在带摄像头的浏览器中确认。

---

## 已知局限

- **图谱医学准确性**是限制因素：CV 管线可做到很稳，但源图谱须临床专家验证（当前 `validated:false`）。
- **前额**关键点稀疏、**极端侧脸**、**强光/低分辨率**会降低精度。
- **外部遮挡**：已支持**手部**（贴合手形掩膜）；器械、纱布、口罩等暂不识别。
- **3D Beta**：刚性配准不随表情形变；在线扫描/实时投影需摄像头实测；尚未做非刚性配准与导出。

---

## 部署（Vercel）

网页端是 **Vite 构建出的纯静态站点**（`web/dist/`，全部在浏览器运行，无后端），可直接部署到 Vercel。
Vercel 自动提供 **HTTPS**，因此线上 `getUserMedia`（摄像头）可用。

- **线上地址**：https://web-black-one-34.vercel.app
- **部署命令**（从 `web/` 目录）：
  ```bash
  cd web
  npm ci
  npm run build
  npx vercel login          # 首次：登录你的 Vercel 账号
  npx vercel deploy --prod --yes
  ```
- **配置文件**：
  - [`web/vite.config.js`](web/vite.config.js)：Vite 静态资产导入与生产构建设置。
  - [`web/vercel.json`](web/vercel.json)：Vercel 使用 `npm run build`，输出 `dist/`，并为 `/assets/*` 配置长缓存。
  - [`web/.vercelignore`](web/.vercelignore)：排除本地测试/构建缓存。
- **更新流程**：改完 `web/` 后（若动了图谱/几何/3D 资产，先 `python3 tools/export_web_assets.py` 重新导出），再 `cd web && npm run build && npx vercel deploy --prod`。
- **隐私**：`web/assets/recon_demo.json` 是示例视频重建出的 3D 人头，会随站点**公开**。不想公开就把它加入 `web/.vercelignore`（此时网页"用示例重建"按钮会失效，仍可用"转头扫描"）。

## 开发文档

- [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)：本地环境、集群环境、venv、Node 24、测试与本地产物目录。
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)：协作流程、测试约定、扩展点和 PR 要求。
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：核心算法、坐标系、2D/3D 路线、资产与部署细节。
- [docs/MEDICAL.md](docs/MEDICAL.md)：医学声明、图谱状态和临床局限。

## 后续路线图

- [ ] 临床医生校验图谱，置 `validated:true`
- [ ] 通用遮挡（语义分割：器械/纱布/口罩）
- [ ] 3D：非刚性配准、网格导出（.obj/.glb）、3D 投影叠加手部遮挡
- [ ] 录制/导出更完善（含放大窗、3D）

---

## 文档维护约定

**本仓库的 [README.md](README.md)、[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) 必须与代码保持同步。**
任何功能更新（新增/修改特性、改动数据流、增删模块或资产、调整使用方式）都要在同一改动中更新这些文档，
确保"读文档即可了解全貌并复现项目"。医学相关变化同时更新 [docs/MEDICAL.md](docs/MEDICAL.md)。
