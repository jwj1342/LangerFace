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
cd web && npm test           # Web TypeScript↔Python 几何对拍（多支 .ts）
ruff check .                 # 代码风格
```

测试**不需要** mediapipe（注入假检测器 / 合成关键点）；资产已随仓库提交，故几何与渲染测试会真正运行。

各测试覆盖（从 README 收口到此，作为测试事实来源）：

- **Web TypeScript ↔ Python 逐点对拍**（`cd web && npm test`）：先查 `web/src/**/*.ts(x)` 静态 import 无模块环并阻止旧根目录 JS runtime 回流，再用真实帧关键点对拍映射（误差 ~5×10⁻⁵px）/ 背面剔除（0 不一致）/ One-Euro fixture；并含 `test_occlusion`（贴合手形掩膜、指缝保留、无手不剔除）、`test_umeyama`（恢复已知相似变换 ~1e-13）、`topologyId`/`topologyVersion` 守卫与 atlas roundtrip 契约、FLAME basis 拟合 + jaw/表情前向、RSTL 切除闭合 soft-body 张力方向断言、`test_logger`（`window.exportLangerfaceDiagnostics()` 结构化 JSON 契约）。
- **Python 单测**（`pytest`）：图谱完整性、标准脸解析、映射仿射不变性、平滑降抖动、端到端渲染、`assets/`↔`web/assets/` 同步门禁、结构化可观测性。
- **目检脚本**：`tools/render_check.py`、`inspect_frames.py`、`montage.py`、`sample_output.py`、`debug_one.py`。
- **浏览器实测**：UI/3D 查看通过截图核对；实时摄像头链路需在带摄像头的浏览器中确认。

跨语言对拍的不变式与金标重生成见 [CROSS_LANG_PARITY.md](CROSS_LANG_PARITY.md)。

## PR / Preview 工作流

本项目采用 **GitHub Actions 做质量门禁，Vercel Git 集成做网页 Preview / Production 部署**。日常协作不要手动 `npx vercel deploy --prod`；按 PR 流程走，避免绕过测试和审阅。

推荐流程：

1. 从 `master` 拉出功能分支。
2. 本地完成改动，至少运行相关检查：
   ```bash
   ruff check .
   pytest -q
   cd web && npm run build && npm test
   ```
3. push 分支并创建 PR。可以先开 Draft PR。
4. 等 GitHub Actions 和 Vercel Preview check 自动运行。
5. 打开 PR 里的 Vercel Preview 链接做人工验收。
6. checks 全绿、Preview 验收通过、且至少 1 个 reviewer approval 后，把 Draft PR 标记为 ready 并合并到 `master`。
7. 合并到 `master` 后，Vercel 自动发布 Production。

PR 描述必须保留“技术资料 / 临床依据”小节。凡涉及医学规则、CV/AI 算法、模型、数据集、部署平台或隐私边界的改动，应在 PR 中列出使用的资料链接、医生团队说明、关联 issue 和设计文档；若不适用，也要显式写“不适用”。这样 reviewer 不需要反向猜测实现依据。

PR 上应关注这些 checks：

| Check | 作用 |
|---|---|
| `lint` | Python lint / import 排序 |
| `python-tests (3.10/3.11/3.12)` | Python 测试矩阵 |
| `js-tests` | Vite build + JS/Python 几何对拍 + 标注模型测试 |
| `Vercel` | Production 或临时 Preview 的部署状态；当前长 PR 默认不为每次 push 生成 Preview |
| `Vercel Preview Comments` | 临时打开 Preview 时，Vercel 在 PR 中发布 Preview 链接 |

Vercel Preview 只在维护者按需打开时服务当前开发分支；当前策略见 [CI/CD 与 Vercel 部署指南](CI_CD_VERCEL.md#自动部署范围与限流控制)。普通短期 feature 分支仍跑 GitHub Actions 质量门禁，但不会自动创建 Vercel Preview；当前开发分支也默认关闭 Git 自动部署，避免长 PR 高频 push 打满 Vercel 限流。需要线上验收时，由维护者临时打开当前开发分支的 Vercel 部署，或使用团队约定的手动部署方式刷新一次 Preview；部署完成后再关回去。

Preview 人工验收清单：

- 首页能打开，模型与图谱加载完成。
- 上传照片 / 视频入口能正常进入检测流程。
- 摄像头入口在 HTTPS Preview 中能请求权限。
- `/app/annotate` 能打开，标准脸能加载，不出现 `/assets/*.json` 404；旧 `annotate.html` 只需跳转到 React SPA。
- 浏览器控制台没有新的应用级错误。MediaPipe 的 WebGL / XNNPACK 初始化日志通常是正常信息。

注意：

- Vercel Preview 可能启用了 Deployment Protection。协作者访问规则如下：
  - 项目组成员：加入 Vercel project/team 后，用自己的 Vercel 账号登录访问 Preview。
  - 外部临床评审：由维护者在 Vercel 生成 Shareable Link，或临时开启 Password Protection 并单独发送密码。
  - 自动化测试：只使用 Vercel Protection Bypass for Automation，secret 放在 GitHub Secrets；不要把 bypass token 当作人工分享链接。
  - 只有确认 Preview 不含受限头模、真实人脸影像或未公开数据时，才考虑关闭 Preview protection。
- PR Preview 和生产站不是同一个地址。验证分支改动时不要只看 Production URL（见 [CI/CD 与 Vercel 部署指南](CI_CD_VERCEL.md#production-url)）；那是 `master` 的生产环境。
- `master` 受 GitHub Branch Protection 保护：PR 合并前必须通过必需 checks，并至少获得 1 个 approving review。
- 详细的 Vercel 项目设置、branch protection 和排障信息见 [CI/CD 与 Vercel 部署指南](CI_CD_VERCEL.md)。

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

## Issue 标签 (Labels)

给 issue / PR 打标签时按维度走，方便筛选与排期。**每个 issue 至少 1 个「类型」**，建议再各加 1 个「优先级」与 ≥1 个「领域」：

- **类型**（必填）：`bug` · `enhancement` · `documentation` · `tech-debt` · `testing` · `epic` · `question`
- **优先级**（建议）：`priority: critical | high | medium | low`
- **领域**（建议，可叠加）：`area: web` · `area: 3d` · `area: atlas` · `area: pipeline` · `area: clinical` · `area: infra`
- **协作 / 关闭原因**（按需）：`good first issue` · `help wanted` ／ `duplicate` · `invalid` · `wontfix`

速查：报 bug → `bug` + 一个 `area:` + 优先级；提需求 → `enhancement` + `area:`；重构 / 解耦 → `tech-debt` + `area:`；只改文档 → `documentation`。

每个标签的精确定义、何时打哪个、颜色约定，见 **[标签规范 (LABELS.md)](LABELS.md)**。

## 约定

- 遵循上面的 Engineering Principles。
- 按 [标签规范 (LABELS.md)](LABELS.md) 给 issue / PR 打标签：至少 1 个类型，建议补优先级与领域。
- 新增模块即补单元测试；纯逻辑测试不要依赖资产或 mediapipe。
- 不提交大二进制 / 人脸影像（`.gitignore` 已拦截，pre-commit 兜底）。
- 用 `git add <明确路径>` 暂存，**不要** `git add -A` / `.`（避免误提交 `node_modules` symlink 等本地产物，见下）。
- 分支开发 + PR；CI、Vercel Preview、至少 1 个 reviewer approval 和必要的人工验收需通过后再合并。

> 多人并行改本仓库踩过的坑（`git add -A` 误提交、伞状 PR 合并后批量过期、分支保护与合并机制、
> 登录节点测试、行为保持式重构纪律）已沉淀到 [工程教训 (ENGINEERING_LESSONS.md)](ENGINEERING_LESSONS.md)，提交前值得过一遍速查清单。
