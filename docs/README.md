# 项目文档索引

本文是 `docs/` 的入口：**先读这里，再决定进哪个子目录**。文档按「读者想做什么」分成 6 个语义目录，每个目录只回答一类问题。仓库总览、医学声明与已知局限在根目录 [README.md](../README.md)。

| 目录 | 一句话 | 篇数 |
|---|---|---|
| [`onboarding/`](#onboarding--上手与协作) | 我要把它跑起来、并按规矩提交 | 4 |
| [`architecture/`](#architecture--架构与算法) | 它是怎么实现的、公式是什么 | 2 |
| [`tracks/`](#tracks--技术轨与功能专题) | 某一条技术路线的设计与现状 | 4 |
| [`quality/`](#quality--质量与运维) | 怎么证明它没坏、怎么部署和观测 | 4 |
| [`clinical/`](#clinical--临床边界与合规) | 医学上能说什么、数据边界在哪 | 3 |
| [`planning/`](#planning--路线图) | 接下来做什么 | 1 |

---

## `onboarding/` — 上手与协作

**这个目录回答「我是新人，怎么让它在我机器上跑起来，以及怎么提交才不会被退回」。** 四篇按时间顺序读：[ENVIRONMENT.md](onboarding/ENVIRONMENT.md) 讲本地与集群（Compute Canada / Vulcan）环境、Python 版本约束、venv、Node 24、以及本地产物目录该放哪；[CONTRIBUTING.md](onboarding/CONTRIBUTING.md) 是协作契约本体——测试怎么跑、扩展点在哪、PR 需要满足什么，它是全仓入链最多的一篇；[ENGINEERING_LESSONS.md](onboarding/ENGINEERING_LESSONS.md) 是**事故复盘**而不是规范，每条都是真实踩过的坑加一条可执行规则（`git add -A` 误提交 symlink、伞状 PR 让在飞分支集体过期、`--admin` 与 draft 的交互、登录节点上 cv2 的已知失败基线），提交前值得扫一遍；[LABELS.md](onboarding/LABELS.md) 是 issue / PR 的标签规范。

## `architecture/` — 架构与算法

**这个目录回答「代码为什么这么组织、某个数字是怎么算出来的」，是两篇长文，占全部文档篇幅的四成。** [ARCHITECTURE.md](architecture/ARCHITECTURE.md) 是**模块契约与坐标系**的权威来源：分层结构（含三套并存的运行时——TypeScript service 层、`web/current/` 与 `web/compat/` 的纯 JS 兼容运行时）、关键点与标准脸模型、2D 重心坐标映射、3D 路线（网页入口已由 #108 关闭、runtime 保留）、图谱格式与生成、资产清单、构建与 Vercel 部署边界、网页 3D 标注、HeadSpace 离线管线。[METHODS_AND_IMPLEMENTATION_SUMMARY.md](architecture/METHODS_AND_IMPLEMENTATION_SUMMARY.md) 是**数学推导的集中地**：重心映射的仿射不变性、One-Euro、背面剔除与遮挡、方向场流线生成、Umeyama、FLAME 线性拟合、软体闭合、切口几何（3:1 长宽比、30° 尖端角、cubic Hermite 轮廓）。两者分工是「契约在前者、公式在后者」；模块该在哪、测试怎么跑不写在这里。

## `tracks/` — 技术轨与功能专题

**这个目录回答「某条技术路线当初为什么这么选、现在到哪一步了」。** [FLAME_3D_TRACK.md](tracks/FLAME_3D_TRACK.md) 是 3D FLAME 配准/标注轨、与当前 MediaPipe 切口工作台的隔离契约及 license 边界的单一 owner；[RSTL_3DMM_PRIOR.md](tracks/RSTL_3DMM_PRIOR.md) 记录 Borges RSTL 来源与 3DMM 拓扑先验 manifest；[PERSONALIZED_RSTL.md](tracks/PERSONALIZED_RSTL.md) 是 `/personalized` 浏览器个性化流程及其向切口工作台交接的可审计说明；[INCISION_WORKFLOW.md](tracks/INCISION_WORKFLOW.md) 记录浏览器本地确定性切口 workflow、worker 回退、tool trace 与审阅边界。Python texture warp 与 checkpoint 许可边界已归入 clinical 的辅助线索文档。

## `quality/` — 质量与运维

**这个目录回答「凭什么相信它没坏、以及它是怎么上线和被观测的」。** [CROSS_LANG_PARITY.md](quality/CROSS_LANG_PARITY.md) 定义 Python、Web TypeScript、纯 JS 兼容运行时三方逐点等价；[CI_CD_VERCEL.md](quality/CI_CD_VERCEL.md) 是 Vercel、Preview、branch protection 与排障的唯一 owner；[OBSERVABILITY.md](quality/OBSERVABILITY.md) 定义浏览器诊断字段与指标；[VALIDATION.md](quality/VALIDATION.md) 定义临床验证数据集、Stage 1/2 指标、失败分类与人工评审表。3D 标注人工验收已归入 CONTRIBUTING。

## `clinical/` — 临床边界与合规

**这个目录回答「这套东西在医学上能声称什么、不能声称什么，以及哪些数据绝对不能出域」——它约束的是承诺而不是实现。** [PRODUCT_BOUNDARIES.md](clinical/PRODUCT_BOUNDARIES.md) 固定当前研究范围、明确暂缓项与未来重启条件；[PRIVACY_AND_AUDIT.md](clinical/PRIVACY_AND_AUDIT.md) 是敏感数据边界、禁止提交项、导出约束与审计字段的总纲；[WRINKLE_LESION_CUES.md](clinical/WRINKLE_LESION_CUES.md) 统一记录自然皱襞/皱纹/病灶边界、Python texture warp、浏览器个性化路径和 checkpoint 许可边界。

## `planning/` — 路线图

**这个目录回答「接下来做什么」，只有一篇。** [TODO.md](planning/TODO.md) 是与 GitHub Issues 自动核对的路线图与待办，按临床出口、待合并修复和文档架构分组。GitHub Issues 是状态的唯一真源，本文只做分组与上下文；产品承诺边界不放在可频繁变动的路线图里。

---

## 维护契约（这套结构靠什么不腐烂）

1. **新增文档必须落在某个语义子目录里**，不能直接放在 `docs/` 根；文件名保持 `UPPER_SNAKE_CASE.md`。
2. **必须在本文对应目录段落里被提到**，并在根 [README.md](../README.md) 的文档索引表里加一行。
3. 以上两条由 `tools/test_docs_links.ts` 机械强制（`npm test` 内）：它会检查全仓 md 的仓库内相对链接是否都解析得到、`docs/` 根有没有散落文档、每个子目录与每篇文档是否都被本文索引。**移动或改名文档后跑一次它，断链会立刻报出来。**
4. 一篇文档只承担一个职责；发现两篇在讲同一件事，合并而不是各写一半。
5. 文档顶部用一句话点明本篇职责（「本文…」），与本文的描述一致。
6. **代码变更要同步改文档**：根 README、`architecture/ARCHITECTURE.md`、`onboarding/ENVIRONMENT.md` 必须与代码保持同步；医学相关变化同时更新根 README 的医学声明小节；路线变化更新 `planning/TODO.md`。

## 已知的文档与代码不一致（正在修，别当成事实）

读到以下内容时请知道它们已被记录为缺陷，不要照着做决定：

- **#112** —— `web/src/services/geometryAtlas.ts` 尚未遵守 `disableRuntimeExpansion`，导致 `/personalized` 的额头拱线在 React 实时页被二次形变；修复在 Ready PR #120。
