# 项目文档索引

本文是 `docs/` 的入口：**先读这里，再决定进哪个子目录**。文档按「读者想做什么」分成 6 个语义目录，每个目录只回答一类问题。仓库总览、医学声明与已知局限在根目录 [README.md](../README.md)。

| 目录 | 一句话 | 篇数 |
|---|---|---|
| [`onboarding/`](#onboarding--上手与协作) | 我要把它跑起来、并按规矩提交 | 4 |
| [`architecture/`](#architecture--架构与算法) | 它是怎么实现的、公式是什么 | 2 |
| [`tracks/`](#tracks--技术轨与功能专题) | 某一条技术路线的设计与现状 | 6 |
| [`quality/`](#quality--质量与运维) | 怎么证明它没坏、怎么部署和观测 | 5 |
| [`clinical/`](#clinical--临床边界与合规) | 医学上能说什么、数据边界在哪 | 4 |
| [`planning/`](#planning--路线图) | 接下来做什么 | 1 |

---

## `onboarding/` — 上手与协作

**这个目录回答「我是新人，怎么让它在我机器上跑起来，以及怎么提交才不会被退回」。** 四篇按时间顺序读：[ENVIRONMENT.md](onboarding/ENVIRONMENT.md) 讲本地与集群（Compute Canada / Vulcan）环境、Python 版本约束、venv、Node 24、以及本地产物目录该放哪；[CONTRIBUTING.md](onboarding/CONTRIBUTING.md) 是协作契约本体——测试怎么跑、扩展点在哪、PR 需要满足什么，它是全仓入链最多的一篇；[ENGINEERING_LESSONS.md](onboarding/ENGINEERING_LESSONS.md) 是**事故复盘**而不是规范，每条都是真实踩过的坑加一条可执行规则（`git add -A` 误提交 symlink、伞状 PR 让在飞分支集体过期、`--admin` 与 draft 的交互、登录节点上 cv2 的已知失败基线），提交前值得扫一遍；[LABELS.md](onboarding/LABELS.md) 是 issue / PR 的标签规范。

## `architecture/` — 架构与算法

**这个目录回答「代码为什么这么组织、某个数字是怎么算出来的」，是两篇长文，占全部文档篇幅的四成。** [ARCHITECTURE.md](architecture/ARCHITECTURE.md) 是**模块契约与坐标系**的权威来源：分层结构（含三套并存的运行时——TypeScript service 层、`web/current/` 与 `web/compat/` 的纯 JS 兼容运行时）、关键点与标准脸模型、2D 重心坐标映射、3D 路线（网页入口已由 #108 关闭、runtime 保留）、图谱格式与生成、资产清单、构建与 Vercel 部署边界、网页 3D 标注、HeadSpace 离线管线。[METHODS_AND_IMPLEMENTATION_SUMMARY.md](architecture/METHODS_AND_IMPLEMENTATION_SUMMARY.md) 是**数学推导的集中地**：重心映射的仿射不变性、One-Euro、背面剔除与遮挡、方向场流线生成、Umeyama、FLAME 线性拟合、软体闭合、切口几何（3:1 长宽比、30° 尖端角、cubic Hermite 轮廓）。两者分工是「契约在前者、公式在后者」；模块该在哪、测试怎么跑不写在这里。

## `tracks/` — 技术轨与功能专题

**这个目录回答「某条技术路线当初为什么这么选、现在到哪一步了」。** 每篇对应一条相对独立、可以单独推进或搁置的轨：[FLAME_3D_TRACK.md](tracks/FLAME_3D_TRACK.md) 是 3D FLAME 配准/标注轨的选型与逐 sprint 状态，也是 FLAME 资产 license 边界的说明处（Sprint 0–5 已落地、Sprint 6 未开工，网页入口已关闭）；[INCISION_FLAME_ASSET_STRATEGY.md](tracks/INCISION_FLAME_ASSET_STRATEGY.md) 讲切口工作台如何使用 FLAME 头模资产及其回退策略；[RSTL_3DMM_PRIOR.md](tracks/RSTL_3DMM_PRIOR.md) 记录 Borges RSTL 的来源与 3DMM 拓扑先验 manifest；[PERSONALIZED_RSTL.md](tracks/PERSONALIZED_RSTL.md) 是 `/personalized` 浏览器个性化流程的单一可审计说明（采集输入、每个阈值的依据、逐层失败降级、隐私边界、图谱契约）；[PERSONALIZED_TEXTURE_WARP.md](tracks/PERSONALIZED_TEXTURE_WARP.md) 是它的 Python 兄弟（纹理/皱纹场 warp）；[INCISION_WORKFLOW.md](tracks/INCISION_WORKFLOW.md) 记录浏览器本地确定性切口 workflow、worker 回退、tool trace 与审阅边界。

## `quality/` — 质量与运维

**这个目录回答「凭什么相信它没坏、以及它是怎么上线和被观测的」。** [CROSS_LANG_PARITY.md](quality/CROSS_LANG_PARITY.md) 定义本项目最硬的那条不变式：线条几何在 Python、Web TypeScript、纯 JS 兼容运行时**三套实现**间逐点等价，以及金标的重生成流程与各自的公差；[CI_CD_VERCEL.md](quality/CI_CD_VERCEL.md) 是 Vercel 项目设置、SPA rewrite 列表、Preview 访问策略、branch protection 必需检查与排障清单的唯一 owner；[OBSERVABILITY.md](quality/OBSERVABILITY.md) 定义浏览器诊断 JSON 的结构化字段、计数器与运行时指标（看 bug report 从这里入手）；[VALIDATION.md](quality/VALIDATION.md) 定义临床验证数据集格式、Stage 1/2 指标、失败分类与人工评审表；[ANNOTATION_QA.md](quality/ANNOTATION_QA.md) 是 3D 标注贴面与导出一致性的验收清单。

## `clinical/` — 临床边界与合规

**这个目录回答「这套东西在医学上能声称什么、不能声称什么，以及哪些数据绝对不能出域」——它约束的是承诺而不是实现，改动前请谨慎。** [PRIVACY_AND_AUDIT.md](clinical/PRIVACY_AND_AUDIT.md) 是敏感数据边界、禁止提交项、导出约束与审计字段的总纲；[PRODUCT_BOUNDARIES.md](clinical/PRODUCT_BOUNDARIES.md) 记录当前聚焦表皮 RSTL 与病灶处理、暂缓肌肉骨骼实时孪生的产品决策及其重启条件；[WRINKLE_LESION_CUES.md](clinical/WRINKLE_LESION_CUES.md) 讲自然皱襞/皱纹/病灶边界作为 RSTL 之外**次级依据**的调研与边界（允许在 `/personalized` 有界微调，不允许影响 `/incision` 几何）。

## `planning/` — 路线图

**这个目录回答「接下来做什么」，只有一篇。** [TODO.md](planning/TODO.md) 是与 GitHub Issues 同步的路线图与待办，按 Stage 1 收尾 / 增强 / Stage 2 / 维护部署 / 暂缓路线分组。GitHub Issues 是状态的唯一真源，本文只做分组与上下文；两者不一致时以 Issues 为准。

---

## 维护契约（这套结构靠什么不腐烂）

1. **新增文档必须落在某个语义子目录里**，不能直接放在 `docs/` 根；文件名保持 `UPPER_SNAKE_CASE.md`。
2. **必须在本文对应目录段落里被提到**，并在根 [README.md](../README.md) 的文档索引表里加一行。
3. 以上两条由 `tools/test_docs_links.ts` 机械强制（`npm test` 内）：它会检查全仓 md 的仓库内相对链接是否都解析得到、`docs/` 根有没有散落文档、每个子目录与每篇文档是否都被本文索引。**移动或改名文档后跑一次它，断链会立刻报出来。**
4. 一篇文档只承担一个职责；发现两篇在讲同一件事，合并而不是各写一半（当前已知的重复与合并方案见 issue #113）。
5. 文档顶部用一句话点明本篇职责（「本文…」），与本文的描述一致。
6. **代码变更要同步改文档**：根 README、`architecture/ARCHITECTURE.md`、`onboarding/ENVIRONMENT.md` 必须与代码保持同步；医学相关变化同时更新根 README 的医学声明小节；路线变化更新 `planning/TODO.md`。

## 已知的文档与代码不一致（正在修，别当成事实）

读到以下内容时请知道它们已被记录为缺陷，不要照着做决定：

- **#112** —— `web/src/services/geometryAtlas.ts` 未遵守 `disableRuntimeExpansion`，导致 `/personalized` 的额头拱线在 React 实时页被二次形变；`architecture/METHODS_AND_IMPLEMENTATION_SUMMARY.md` §5 也尚未记录这段非重心变换。
- **#113** —— 9 组仍可合并的重复文档、`planning/TODO.md` 与 issue 状态双向失同步、`quality/OBSERVABILITY.md` 缺 pose-gate 一族指标、`atlasVersion` 字段无法判别图谱版本。
- **#114** —— 工程实践债（DOM 收集、临床文案和审阅策略已从 `incisionRuntime.ts` 拆出；导出、三维交互与渲染职责仍需继续拆分）。
