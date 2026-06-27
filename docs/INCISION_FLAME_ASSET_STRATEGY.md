# 切口工作台 FLAME 头模资产策略

本文记录 `/app/incision` 切口工作台从 MediaPipe 标准脸过渡到 FLAME 头模预览时的核验点、设计边界和验收重点。它不是临床规则更新，也不把 FLAME 预览线标记为临床已验证资产。

## 核验要点

- 工作台启动时应优先加载 `flame-2023`，当前来源是已入仓的 `web/assets/flame_basis.bin`，由前端生成 neutral 顶点和三角面；不提交本地 `flame_neutral_vertices.json`、`topology_flame_2023.json` 等派生 JSON。
- 若 FLAME basis 加载或转换失败，工作台必须回退到 `mediapipe-468`，并在 UI / snapshot / 审阅导出中显示回退原因。
- 不能把 MediaPipe RSTL 图谱的 `[tri,u,v]` 直接套到 FLAME 三角面上。当前实现会把 MediaPipe RSTL 草案转换为 FLAME neutral 上的 `points3d` 预览线，并明确标记 `validated:false`。
- 切口候选若基于 FLAME topology 生成，不能直接发送到实时 MediaPipe 叠加；必须在 review gate 里阻断，直到后续提供显式 topology 映射或独立 FLAME AR 叠加路径。
- 审阅 JSON / Markdown 必须保留 `head_asset`、`topologyId`、`topologyVersion`、顶点/三角面数量、预览线来源和 warning，方便 reviewer 复核当前是否真的在用 FLAME。

## 设计方案

- `dataSource` 负责头模资产边界：
  - `mediapipe-468` 继续来自 `canonical_vertices.json` 与 `topology_mediapipe_468.json`。
  - `flame-2023` 来自 `flame_basis.bin`，通过 `flameHeadAssets.ts` 生成 neutral mesh。
- `flameHeadAssets.ts` 负责 FLAME 相关的无 DOM 逻辑：
  - 加载并缓存 FLAME basis。
  - 生成 neutral 顶点和 faces。
  - 把 MediaPipe RSTL 草案投到 FLAME neutral 表面，生成仅用于研究预览的 `points3d` atlas。
- `incisionAgentRuntime.ts` 负责工作台编排：
  - 默认优先 `flame-2023`。
  - 失败时回退 `mediapipe-468`。
  - 发布 React snapshot 中的 `headAsset` 状态。
  - 在 live overlay gate 中阻断 FLAME topology 候选被误送到 MediaPipe 实时叠加。
- React UI 只展示低频状态：
  - 画布顶部显示当前头模状态。
  - 工作台状态卡显示头模、拓扑和 warning。
  - 不把 mesh 顶点、三角面或 Three.js 对象放入 Zustand。

## 验收重点

- 访问 `/app/incision` 后，工作台状态显示 `FLAME neutral 头模 · RSTL 预览`，并显示 `flame-2023` topology。
- 若 `flame_basis.bin` 缺失或解析失败，页面仍可使用，并显示 `MediaPipe 468 回退`。
- 候选生成、端点编辑、候选保存、JSON/Markdown 导出仍可运行。
- 基于 FLAME 的候选点击“发送到实时叠加”时应被阻断，并提示需要单独 topology 映射。
- `cd web && npm run typecheck` 通过。
- `node ../tools/test_asset_loader.ts` 验证 `dataSource.getHeadMesh("flame-2023")` 能从 `flame_basis.bin` 生成 5023 顶点 / 9976 三角面。
- `node ../tools/test_incision_tools.ts` 验证 `queryDirection` 支持 `points3d` atlas，不误用跨拓扑 `[tri,u,v]`。

## 相关 issue

- #61：FLAME 3D 配准 / 标注主线，仍负责标准 FLAME 头标注、个体拟合和张力线随形变迁移。
- #64：切口 Agentic 设计主 epic，本 PR 只补齐工作台头模资产和 topology gate，不实现完整多轮 ReAct。
- #13：RSTL 局部方向服务。当前 FLAME 方向来自预览 `points3d`，后续应接入正式 `flame-2023` 方向服务。
- #19：照片、视频与 AR 实时叠加。FLAME 候选暂不直接进入 MediaPipe live overlay。
- #86：Borges RSTL 3DMM 拓扑先验已经关闭，但其临床校验仍受 #2 约束。
- #47 / #48：资产单一真源与数据源抽象已经落地，本 PR 在其上补 FLAME head descriptor。

## 非目标

- 不把 FLAME 预览线标记为 `validated:true`。
- 不提交本地 license-gated FLAME 原始资产或派生 JSON。
- 不实现患者个体 FLAME 拟合。
- 不实现 FLAME topology 到实时 MediaPipe overlay 的临床可用映射。
- 不关闭 #61、#13、#19 或 #2。
