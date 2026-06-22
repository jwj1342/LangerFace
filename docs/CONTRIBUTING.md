# 贡献指南 (Contributing)

LangerFace 是一个**两阶段**面部手术可视化研究项目，多人协作：

- **Stage 1（当前）**：在 3D 人脸上稳定标注朗格 / RSTL 皮肤张力线。
- **Stage 2（规划）**：面部肿物模拟与切口设计。

`web/` 是前端可视化（静态站点，经 Vercel/CI-CD 部署）；`src/langerface/` 是后端核心库。

## 开发环境

需要 Python 3.10–3.12（mediapipe 暂无 3.13 wheel）。前端需要 Node 24.15+ / npm 11+。完整本地与集群环境步骤见 [ENVIRONMENT.md](ENVIRONMENT.md)。

```bash
# 1. 可编辑安装 + 全部附加项（含检测后端、标注工具、测试）
pip install -e ".[all]"

# 2. 下载 MediaPipe 资产并生成线图谱
python tools/download_assets.py
python tools/build_field_atlas.py
python tools/export_web_assets.py     # 同步到 web/assets/

# 3. 装上 git 钩子
pip install pre-commit && pre-commit install

# 4. 前端依赖与 Vite 构建
cd web
npm ci
npm run build
cd ..
```

可选附加项：`.[mediapipe]` 检测后端 · `.[annotate]` matplotlib 标注 · `.[dev]` 测试/lint。

## 运行测试

```bash
pytest                       # Python 单元/集成测试
cd web && npm test           # JS↔Python 几何对拍（三个 .mjs）
ruff check .                 # 代码风格
```

测试**不需要** mediapipe（注入假检测器 / 合成关键点）；资产已随仓库提交，故几何与渲染测试会真正运行。

## 架构与扩展点

分层（`src/langerface/`，每层一个职责，依赖单向向下）：

| 层 | 职责 | 稳定契约 |
|---|---|---|
| `config/` | 配置、常量、资产路径 | `Config`, `build_config`, `config.constants` |
| `geometry/` | 与领域无关几何（标准脸、重心坐标） | `CanonicalFaceModel` |
| `detection/` | 关键点检测 | **`Detector` 协议** + `FaceResult` |
| `lines/` | **Stage 1** 线图谱 | `Atlas`, `map_atlas` |
| `rendering/` | 叠加渲染、自遮挡 | `draw_overlay`, `BackfaceCuller` |
| `pipeline/` | 编排 | `LinePipeline` |
| `media/` | 视频 I/O | `process_video` |
| `apps/` | 瘦入口 | console scripts |

常见扩展：

- **新增检测后端**：实现 `detection.base.Detector` 协议，注入 `LinePipeline(cfg, detector=...)`，无需改动编排。
- **新增线系统**：在 `config.constants.VALID_SYSTEMS` 注册，提供对应图谱 JSON 与 `DEFAULT_STYLES` 样式。
- **Stage 2**：新增**同级子包** `langerface/tumor/`、`langerface/incision/`，复用 `geometry`/`detection`/`rendering`，不要把肿物/切口逻辑塞进 `lines/`。

## Engineering Principles

- **DRY (Don't Repeat Yourself)** – eliminate duplicated logic by extracting shared utilities and modules.
- **Separation of Concerns** – each module should handle one distinct responsibility.
- **Single Responsibility Principle (SRP)** – every class/module/function/file should have exactly one reason to change.
- **Clear Abstractions & Contracts** – expose intent through small, stable interfaces and hide implementation details.
- **Low Coupling, High Cohesion** – keep modules self-contained and minimize cross-dependencies.
- **Scalability & Statelessness** – design components to scale horizontally and prefer stateless services when possible.
- **Observability & Testability** – build in logging, metrics, tracing, and ensure components can be unit/integration tested.
- **KISS (Keep It Simple, Sir)** – keep solutions as simple as possible.
- **YAGNI (You're Not Gonna Need It)** – avoid speculative complexity or over-engineering.

## 约定

- 遵循上面的 Engineering Principles。
- 新增模块即补单元测试；纯逻辑测试不要依赖资产或 mediapipe。
- 不提交大二进制 / 人脸影像（`.gitignore` 已拦截，pre-commit 兜底）。
- 分支开发 + PR，CI（lint + pytest 矩阵 + JS 对拍）需通过。
