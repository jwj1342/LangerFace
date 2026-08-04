# 贡献指南 (Contributing)

本文是开发、测试、提交与人工验收的协作契约；环境细节和部署访问分别由链接的专门文档维护。

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
python3 tools/build_field_atlas_standard_v1.py \
        assets/rstl_standard_reference_v8_1_67.json assets/atlas_rstl.json
#   ⚠️ 不要裸跑 tools/build_field_atlas.py：它会同时重写 assets/atlas_rstl.json 与
#      assets/atlas_langer.json，把上面这份正式 v8.1.67 图谱覆盖成 61 条流线的旧首版，
#      并让 tests/test_rstl_standard_v8_1_67.py 失败。只在需要重造 Langer 对照时才跑它。
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
cd web && npm test           # 全量：typecheck + 下面 7 组（共 49 支脚本）
cd web && npm run test:browser # 生产构建上的 Playwright UI/对比度回归
ruff check .                 # 代码风格
```

测试**不需要** mediapipe（注入假检测器 / 合成关键点）；资产已随仓库提交，故几何与渲染测试会真正运行。

各测试覆盖（从 README 收口到此，作为测试事实来源）：

`npm test` 按语义分成 7 组，调试时可以只跑相关的一组（组名即职责，全部由 `npm test` 串起来，不会漏跑）：

| 组 | 覆盖 |
|---|---|
| `npm run test:arch` | 架构与文档守卫：import 无环、旧 JS runtime 不回流、文档链接与索引、主特性对拍、dist 资产 |
| `npm run test:geometry` | 几何与图谱契约：三方映射对拍、额头可见性两实现对拍、遮挡、姿态门控、Umeyama、拓扑守卫、soft-body |
| `npm run test:live` | 实时页与采集源：摄像头、图片源、画布适配、资产加载、导出、诊断 JSON |
| `npm run test:annotate` | 标注与 3D 路线 |
| `npm run test:incision` | 切口工作台：overlay、回放 QA、验收审计、工具契约 |
| `npm run test:privacy` | 隐私与 Provider 边界 |
| `npm run test:personalized` | `/personalized` 浏览器个性化链路（含 YOLO/V6） |

分组的另一个作用是减少冲突面：这一行原本是串了 40 多项的**单行字符串**，任何两个想加测试的 PR 都必然文本冲突（#117↔#116、#142↔#116/#121 各撞过一次）。现在只会撞在实际改动的那一组上。

- **Web TypeScript ↔ Python 逐点对拍**（`cd web && npm test`）：先查 `web/src/**/*.ts(x)` 静态 import 无模块环并阻止旧根目录 JS runtime 回流，再用真实帧关键点对拍映射（误差 ~5×10⁻⁵px）/ 背面剔除（0 不一致）/ One-Euro fixture；并含 `test_occlusion`（贴合手形掩膜、指缝保留、无手不剔除）、`test_umeyama`（恢复已知相似变换 ~1e-13）、`topologyId`/`topologyVersion` 守卫与 atlas roundtrip 契约、FLAME basis 拟合 + jaw/表情前向、RSTL 切除闭合 soft-body 张力方向断言、`test_logger`（`window.exportLangerfaceDiagnostics()` 结构化 JSON 契约）。
- **Python 单测**（`pytest`）：图谱完整性、标准脸解析、映射仿射不变性、平滑降抖动、端到端渲染、`assets/`↔`web/assets/` 同步门禁、结构化可观测性。
- **浏览器回归**（`cd web && npm run test:browser`）：在 Vite 生产构建上运行 Chromium，覆盖 `/surgery` 按钮状态、透明背景合成后的文本对比度与伪元素颜色读取；首次本地运行前执行 `npx playwright install chromium`。
- **目检脚本**：`tools/render_check.py`、`inspect_frames.py`、`montage.py`、`sample_output.py`、`debug_one.py`。
- **浏览器实测**：UI/3D 查看通过截图核对；实时摄像头链路需在带摄像头的浏览器中确认。

跨语言对拍的不变式与金标重生成见 [CROSS_LANG_PARITY.md](../quality/CROSS_LANG_PARITY.md)。

### 3D 标注人工验收

修改 `/annotate`、网格路由或图谱导出后，除自动测试外还要在浏览器核对：

1. 打开 `/app/annotate`，加载标准脸；画线模式下点击同一连通表面的不同三角面，再点“保存当前线”。
2. 预览线应沿表面展开，不应穿过网格内部；fallback 时 UI 必须明确提示，不能静默导出直线。
3. 若本地 FLAME 资产可用，加载头模后重复跨三角面绘制；缺少 dev-local 资产时应正常降级，不能作为 fresh clone 的必过步骤。
4. 导出 atlas JSON，确认每个点为 `[tri,u,v]`、包含 `topologyId`/`topologyVersion` 且
   `validated:false`；导出点数与屏幕预览路径点一致。上传任意自定义头模时只能导出 xyz，
   不能伪装成项目 atlas。
5. 返回实时页预览 MediaPipe atlas，确认线条连续、无明显漂移；FLAME atlas 不得越过 topology gate 注入 2D 实时页。

自动覆盖在 `tools/test_annotate_model.ts`、`tools/test_annotate_ui.ts`、
`tools/test_atlas_contract.ts`、`tools/test_topology_registry.ts` 和
`tools/test_atlas_roundtrip.ts`；人工验收只负责浏览器贴面反馈与视觉连续性。

## PR / Preview 工作流

本项目采用 **GitHub Actions 做质量门禁，Vercel Git 集成做网页 Preview / Production 部署**。日常协作不要手动 `npx vercel deploy --prod`；按 PR 流程走，避免绕过测试和审阅。

推荐流程：

1. 从 `master` 拉出功能分支。
2. 本地完成改动，至少运行相关检查：
   ```bash
   ruff check .
   pytest -q
   cd web && npm run build && npm test && npm run test:browser
   ```
3. push 分支并创建 PR。可以先开 Draft PR。
4. 等 GitHub Actions 自动运行；默认不要为每个 PR 自动创建 Vercel Preview。
5. 如需线上人工验收，由维护者用 Vercel Dashboard 或 CLI 手动创建一次 Preview，再打开对应链接检查。
6. checks 全绿、必要的 Preview 验收通过、且至少 1 个 reviewer approval 后，把 Draft PR 标记为 ready。需要自动合并时，由维护者添加 `automerge:stack` 标签；GitHub 会在保护规则满足后 squash merge，不需要 reviewer 再点 Merge。
7. 合并到 `master` 后，Vercel 自动发布 Production。

PR 描述必须保留“技术资料 / 临床依据”小节。凡涉及医学规则、CV/AI 算法、模型、数据集、部署平台或隐私边界的改动，应在 PR 中列出使用的资料链接、医生团队说明、关联 issue 和设计文档；若不适用，也要显式写“不适用”。这样 reviewer 不需要反向猜测实现依据。

### 自动合并与 stacked PR

`automerge:stack` 是维护者的显式授权标签，不是绕过审核的开关：

- 只有非 Draft、带该标签、且**当前 base 已经是 `master`** 的 PR 才会被
  [Auto-merge workflow](../../.github/workflows/automerge-approved.yml) 处理。
- workflow 只启用 GitHub 原生 Auto-merge；`master` 的 branch protection 仍要求
  必需 checks 通过和至少 1 个 approving review，脚本不会使用 admin bypass。
- 合并方式固定为 squash，并用当前 head SHA 做并发保护；review 后若又 push 了新
  commit，`master` 的 `dismiss_stale_reviews: true` 会撤销旧 approval，必须针对新
  head 重新审核。该仓库设置是自动合并的安全前提，不得关闭。
- stacked PR 仍按父到子顺序 review。父 PR 合并后 head branch 自动删除，GitHub 会把
  以该分支为 base 的子 PR retarget 到 `master`；切 base 会取消原 Auto-merge 请求，
  workflow 会在事件触发或最长约 5 分钟的轮询后处理。如果分支落后于 `master`，
  workflow 会先按精确 head SHA 自动更新分支；更新产生的新 head 必须重新跑 CI 和审核，
  下一轮才启用 Auto-merge。
- 不需要自动合并时不要添加该标签。若要暂停一个已经启用 Auto-merge 的 PR，同时
  移除标签并运行 `gh pr merge <PR号> --disable-auto`，避免后续条件满足时继续合并。

自动化的权限、安全边界和排障方式见
[CI/CD 与 Vercel 部署指南](../quality/CI_CD_VERCEL.md#github-auto-merge-与-stacked-pr)。

PR 上应关注这些 checks：

| Check | 作用 |
|---|---|
| `lint` | Python lint / import 排序 |
| `python-tests (3.10/3.11/3.12)` | Python 测试矩阵 |
| `js-tests` | Vite build + JS/Python 几何对拍 + 标注模型测试 |
| `Vercel` | Production 部署状态；临时 Preview 只在维护者手动创建时出现 |
| `Vercel Preview Comments` | 手动创建 Preview 时，Vercel 可能在 PR 中发布 Preview 链接 |

Vercel Preview 只在维护者按需手动创建时服务当前开发分支；当前策略见 [CI/CD 与 Vercel 部署指南](../quality/CI_CD_VERCEL.md#自动部署范围与限流控制)。普通 feature / integration 分支仍跑 GitHub Actions 质量门禁，但不会自动创建 Vercel Preview，避免长 PR 高频 push 打满 Vercel 限流或继续累积 GitHub deployment records。

Preview 人工验收清单：

- 首页能打开，模型与图谱加载完成。
- 上传照片 / 视频入口能正常进入检测流程。
- 摄像头入口在 HTTPS Preview 中能请求权限。
- `/app/annotate` 能打开，标准脸能加载，不出现 `/assets/*.json` 404；旧 `annotate.html` 只需跳转到 React SPA。
- `/app/incision` 能打开，切口工作台标准脸 / RSTL 资产能加载；Network 面板里的运行时资产应请求 `/assets/...`，不能请求 `/app/assets/...`。
- 如果控制台出现 `Unexpected token '<'` 或 `<!DOCTYPE` JSON 解析错误，优先检查资产 URL 是否被嵌套 SPA 路由错误解析。
- 浏览器控制台没有新的应用级错误。MediaPipe 的 WebGL / XNNPACK 初始化日志通常是正常信息。

Preview protection、协作者/外部评审/自动化三种访问方式、Production URL 与 branch protection 的唯一 owner 是
[CI/CD 与 Vercel 部署指南](../quality/CI_CD_VERCEL.md)。不要在贡献指南复制 token 或访问策略。

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
