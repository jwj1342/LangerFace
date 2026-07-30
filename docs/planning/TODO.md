# TODO / 路线图

本文只列 GitHub 中当前为 open 的 issue；GitHub Issues 是状态真源。`tools/check_todo_issue_sync.mjs`
会比较所有未勾选 issue 链接与仓库 open issue，issue 打开、关闭或重开时由独立 workflow 自动检查。
已完成工作的历史归 PR/issue，本文件不再充当逐 PR changelog。

Stage 1 = 稳定显示并临床校验张力线；Stage 2 = 肿物表达、确定性候选切口、医生审阅和受控叠加。

## 当前产品边界

产品承诺、明确暂缓项与未来重启条件由
[`clinical/PRODUCT_BOUNDARIES.md`](../clinical/PRODUCT_BOUNDARIES.md) 维护；本文只跟踪 open issue 状态。

## 临床出口

- [ ] 临床医生校验线图谱并置 `validated:true`（Stage 1 出口）— [#2](https://github.com/jwj1342/LangerFace/issues/2)
      · 工程侧可生成 review packet、网页 3D 标注草案和指标，但只有受控临床流程中的医生能完成此项。

## 待合并的独立修复 / 功能

- [ ] RSTL 局部方向服务 Python/TypeScript parity — [#13](https://github.com/jwj1342/LangerFace/issues/13)
      · Ready PR #121；共享金标覆盖 atlas、低置信、FLAME `points3d` 和 ±180° 轴向 wrap。
- [ ] 皮表梭形切口完整验收 — [#16](https://github.com/jwj1342/LangerFace/issues/16)
      · Ready PR #119；补齐可编辑尖端角、轮廓重算、guardrail 与 provenance。
- [ ] 3D 路线可行性裁决 — [#40](https://github.com/jwj1342/LangerFace/issues/40)
      · Ready PR #122；裁决 2D-first + 3D 离线资产/标注/研究预览。
- [ ] 修复 React 受控输入 snapshot echo — [#109](https://github.com/jwj1342/LangerFace/issues/109)
      · Ready PR #119；Chromium 回归覆盖输入保持。
- [ ] 删除 Agentic/Provider 出域路径 — [#111](https://github.com/jwj1342/LangerFace/issues/111)
      · Ready PR #118；保留本地确定性 workflow，不保留 Provider UI、密钥或远程模型请求。
- [ ] 统一额头 runtime expansion 契约 — [#112](https://github.com/jwj1342/LangerFace/issues/112)
      · Ready PR #120；Python/TypeScript 共享 fixture 锁定 `disableRuntimeExpansion`。
- [ ] 切口与实时工作台控件对比度 — [#115](https://github.com/jwj1342/LangerFace/issues/115)
      · Ready PR #119；浏览器断言锁定 active control ≥ 4.5:1。
- [ ] 修复固定名运行时资产被旧 immutable 缓存钉死 — [#135](https://github.com/jwj1342/LangerFace/issues/135)
      · Ready PR #117；改用条件回源并拆分固定名资产与带哈希构建产物的缓存策略。

## 文档与架构

- [ ] 合并重复文档、修正内容 owner 并自动核对 TODO 状态 — [#113](https://github.com/jwj1342/LangerFace/issues/113)
      · 当前 PR；删除专题重复页，把标注验收、FLAME 切口资产、纹理 warp 和产品边界归回各自 owner。
- [ ] Phase 2：消化大型 runtime，推进核心 TypeScript 服务化 — [#95](https://github.com/jwj1342/LangerFace/issues/95)
      · 长期 epic；当前 PR 删除无逻辑的 `legacyControllers.ts` 转发层，三个 route 直接组合 TS runtime；scene、export、live state/lifecycle 和 annotation 继续按小 PR 拆。
