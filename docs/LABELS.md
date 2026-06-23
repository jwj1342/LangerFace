# Issue 与 PR 标签规范 (Labels)

本仓库的标签按 **5 个维度**组织。给一个 issue / PR 打标签时：

- **类型 Type**：必填，至少 1 个。
- **优先级 Priority**：建议 1 个。
- **领域 Area**：建议 ≥1 个，可叠加。
- **协作 Contributor**：按需。
- **关闭原因 Resolution**：关闭 issue / PR 时用。

> 经验法则：一个 issue 至少能用一句话回答「这是**什么类型**、**多急**、**属于哪块代码**」——分别对应类型、优先级、领域三类标签。

---

## 1. 类型 Type（必填，至少 1 个）

| 标签 | 用途 / 何时打 |
|---|---|
| `bug` | 现有功能不工作 / 行为与预期不符。 |
| `enhancement` | 新功能或改进请求。 |
| `documentation` | 仅文档（README / docs / 注释）改动。 |
| `tech-debt` | 技术债 / 可维护性（重构、解耦、单一真源），无直接用户可见行为变化。 |
| `testing` | 测试覆盖 / JS↔Python 对拍 / CI 测试基础设施。 |
| `epic` | 跨多个子任务的追踪 / 史诗 issue。 |
| `question` | 需要进一步信息 / 讨论，尚未定性。 |

一个 issue 可同时是多种类型（如「修了 bug 并补测试」= `bug` + `testing`）。

## 2. 优先级 Priority（建议 1 个）

| 标签 | 含义 |
|---|---|
| `priority: critical` | 关键路径：阻塞演示、核心迁移或多人协作，最优先。 |
| `priority: high` | 重要，近期排期。 |
| `priority: medium` | 正常排期。 |
| `priority: low` | 有空再做 / nice-to-have。 |

颜色按红→黄→绿渐变（`critical` 最深红、`low` 绿），便于一眼看出轻重。

## 3. 领域 Area（建议 ≥1 个，可叠加）

| 标签 | 覆盖范围 | 对应代码 |
|---|---|---|
| `area: web` | 网页前端与 UI。 | `web/*`（页面、交互、查看器、录制 / 导出） |
| `area: 3d` | 3D 重建 / 扫描 / 查看 / 3D 标注。 | `mode3d`, `three3d`, `projection3d`, `annotate_*` |
| `area: atlas` | 张力线图谱 / RSTL·Langer / 重心映射 / 468 点迁移。 | `lines/`, `assets/atlas_*`, `mapping`, atlas 工具脚本 |
| `area: pipeline` | 实时检测→映射→渲染，以及 Python 核心管线。 | `pipeline`, `render`, `detection`, `occlusion`, `src/langerface` 核心 |
| `area: clinical` | 临床规则 / Stage 2 / 切口生成 / 验证数据与合规。 | `tumor/`·`incision/`（规划）、验证数据集、隐私合规 |
| `area: infra` | 构建 / CI / 部署 / 资产同步 / 依赖 / 仓库工具。 | `assets`, `vercel`, `tools/`, `.github/`, 依赖清单 |

`area:` 标签统一用青色 `#006B75`，可叠加：一个「3D 网页交互」的 issue 同时打 `area: web` + `area: 3d`；一个「Stage 1 校验线图谱」的 issue 打 `area: atlas` + `area: clinical`。

## 4. 协作 Contributor（可选）

| 标签 | 用途 |
|---|---|
| `good first issue` | 适合新人上手：范围小、上下文清晰、改动局部。 |
| `help wanted` | 需要额外关注 / 欢迎认领。 |

## 5. 关闭原因 Resolution（关闭 issue / PR 时用）

| 标签 | 用途 |
|---|---|
| `duplicate` | 与已有 issue / PR 重复（请在评论里注明指向哪个）。 |
| `invalid` | 不成立 / 无法复现 / 误报。 |
| `wontfix` | 经评估决定不做。 |

---

## 打标签速查 (cheat sheet)

| 场景 | 建议标签 |
|---|---|
| 报一个 bug | `bug` + 一个 `area:` + 一个 `priority:` |
| 提一个需求 / 改进 | `enhancement` + `area:`（+ `priority:`） |
| 重构 / 解耦 / 单一真源 / 依赖卫生 | `tech-debt` + `area:` |
| 只改文档 | `documentation`（聚焦某模块时再加 `area:`） |
| 补测试 / 修 CI 对拍 | `testing` + `area:` |
| 临床 / Stage 2 功能族 | `enhancement` + `area: clinical`（常叠加 `area: atlas`） |
| 跨多子任务的大目标 | `epic` + `priority:` + 相关 `area:` |

## 维护约定

- 新增标签前，先看本表是否已有合适项，避免近义标签泛滥。
- 确需新增**领域**时，保持 `area: <name>` 命名 + 青色 `#006B75`，并在本表登记。
- **优先级 / 领域**是这套体系新增的两条主轴；类型、协作、关闭原因沿用 GitHub 默认标签与配色。
