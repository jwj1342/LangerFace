# 本地确定性切口 workflow

本文记录 `/app/incision` 当前保留的切口候选 workflow。它完全在浏览器内运行，不包含远程模型、AI SDK、Provider 配置、自主规划或多轮推理。

该功能是临床研究决策辅助可视化，不是自动手术指令或已验证医疗器械。

## 运行边界

- `web/src/services/incisionWorkflowTools.ts` 按固定顺序调用确定性工具，生成候选、工具 trace、门控结果和候选比较。
- `web/src/workers/workflow.worker.ts` 通过 Comlink 在 Web Worker 中执行同一套 workflow。
- `web/src/services/workflowPlanner.ts` 在 Worker 不可用时回退到主线程执行相同的确定性函数。
- `web/src/services/incisionRuntime.ts` 负责工作台编排、三维交互、导出和实时叠加衔接；route-scoped DOM 收集、临床展示文案和审阅门控分别由 `incisionDom.ts`、`incisionClinicalCopy.ts` 与 `incisionReviewPolicy.ts` 维护。
- 工作台固定使用 `mediapipe-468` 面部表面，不加载 FLAME basis，也不把 MediaPipe 图谱转换到 FLAME。
- `incisionAtlasSource.ts` 优先接收 `/personalized` 暂存的 YOLO/V6 个体化 RSTL；仅在缺失、来源不符或
  拓扑校验失败时使用内置标准 RSTL，并把降级原因写入 UI、snapshot 和审阅导出。

### 跨页面同源契约

实时页与切口页通过 `rstl-source-contract/v0.1` 报告当前图谱的 system、atlas/topology 版本、
provenance、`validated` 状态、线/点数量和确定性几何指纹。契约相同表示两条链路消费了同一份可追溯
surface 数据；故意更换图谱点、拓扑、版本或来源时，比较器会返回结构化 mismatch code。

“同源”不表示两个页面的最终像素必须完全相同。mirror、contain、pan、zoom、DPR、线密度和额头可见性
裁切属于显示阶段；它们可以产生可解释的像素差异，但不得静默改变 atlas、topology、provenance 或
surface refs。所有当前图谱仍保留 `validated:false`，同源回归只证明工程数据链一致，不构成医学验证。

### 受控标记定位 baseline

照片页的“受控标记”只在用户点击的局部 ROI 内用亮度阈值和连通域寻找黑点、贴纸或手绘标记。结果先进入
`lesion-detection-adapter/v0.1` 草案，界面只预览中心和可选边界；使用者核对肿物类型、直径、深度或
切缘后点击“确认定位”，才允许生成候选。检测全程在浏览器本地执行，不保留或导出原始像素。

该 baseline 用于验证“受控目标 -> surface refs -> 切口候选”的工程链路，不能识别真实病灶的性质、
边界、深度或切缘，也不能把眉毛、鼻孔、头发等深色区域当作无需人工确认的病灶。
- 运行时不读取模型密钥，不请求远程模型，也不把原始照片、视频帧、摄像头画面或纹理发送到外部服务。

工作台把医生需要先看的候选摘要、保护规则和验证边界保持为默认可见；workflow trace、工具门控与候选比较收进默认折叠的技术详情。移动端先展示可定位病灶的三维视图，再进入长表单。

## 固定步骤

1. `summarize_tumor_input_quality` 检查肿物输入、单位、来源、作者、深度、切缘和边界。
2. `classify_region` 计算面部分区、亚单位和敏感游离缘距离。
3. `query_rstl_direction` 从个体化 RSTL 图谱读取经 YOLO/V6 有界修正后的局部方向和 provenance；标准 RSTL 只作为显式降级。
4. `inspect_sensitive_structures` 检查敏感结构和保护性方向例外。
5. `linear_subcutaneous_incision` 或 `fusiform_cutaneous_incision` 生成主候选。
6. 对候选复查敏感距离并运行 `evaluate_guardrails`。
7. `preview_incision_on_face` 验证几何可在标准脸上预览。
8. 生成 `-10° / 0° / +10°` 三个固定方向备选，并分别复跑候选生成、敏感结构检查、guardrails 和预览。
9. `compare_candidates` 按工程指标排序，供医生审阅。

## 输出契约

- `candidate_alternatives`：方向备选及各自的几何、guardrails、敏感结构检查和预览。
- `candidate_comparison`：工程排序，不是临床推荐。
- `workflow_trace_gate`：检查固定关键步骤是否执行且顺序正确。
- `workflow_plan_audit`：从 trace 派生的步骤审计。
- `workflow_execution_events`：用于 UI 和导出的本地执行事件。
- `workflow_audit`：候选数、预览数、比较状态、失败重试与恢复摘要。
- `summary` 与 `next_step`：由本地规则生成的固定说明文本。

机器可读契约见 [`assets/incision_workflow_schema.json`](../../assets/incision_workflow_schema.json)。

原始 YOLO mask 或单独导入的皱纹 / 病灶 metrics 不直接参与上述方向查询。进入几何的个体化 RSTL 已经
过 V6 的 prior 约束、方向一致性、最大位移、皮肤域、禁区与拓扑校验；它仍是研究草案，不能替代医生审阅。

审阅记录与导出容器从 Agentic 字段迁移后分别使用 `incision-review-record/v0.4` 和
`incision-review-export/v0.4`；React controller snapshot 因移除 provider 状态并把 `agent_*` UI 字段改为
`workflow_*`，升级为 `react-incision-controller-snapshot/v0.2`。`tools/evaluate_stage2_validation.py`
仍兼容读取旧 `v0.3` 审阅导出，并在 summary 中分开报告源 schema，避免旧新结构静默混读。

旧书签 `/incision_agent.html` 只保留一个无运行时代码的跳转页，统一重定向到 `/app/incision`；
它不会恢复 Agentic 模式、Provider UI 或远程模型调用。

## 医生审阅

候选可编辑、确认、退回或否决；每次编辑都会重算几何和 guardrails，并记录 provenance。医生通过单一状态选择器选择“待确认 / 确认 / 退回 / 否决”，再用“保存所选审阅状态”写入候选库，避免状态选择器和确认/否决按钮重复表达同一决策。工具门控未通过、缺少审阅人或高风险提示缺少说明时，候选不能标记为可发送到实时叠加。

“生成候选切口”的计数只记录医生明确点击生成按钮的次数。点击面部重选病灶或修改直径、深度、切缘等参数仍会自动刷新候选预览，但不再冒充一次明确生成。

## 实时叠加交接

确认候选后点击“进入实时叠加”，工作台会把经过审阅门控的 MediaPipe 表面引用写入当前标签页的 `sessionStorage`，随后直接进入 `/live?incisionOverlay=staged`。实时页会显示独立的“切口候选叠加”状态卡；上传照片、视频或开启摄像头后，候选以带深色描边的青绿色线随 MediaPipe 关键点逐帧映射，病灶中心和边界分别使用黄色标记。用户可在实时页明确清除候选，不影响 RSTL 图谱。

照片、视频和摄像头共用 `render2d.ts` 的同一叠加函数。实时源仍受姿态、快速运动、张口和眨眼质量门控；被门控的帧会在“切口叠加 QA”中显示原因，而不是静默表现为按钮无效。

该闭环是研究可视化工程实现，不等于临床功能完成：切口页使用 MediaPipe 468 标准规划表面，不是患者个体三维重建；病灶位置和边界仍由医生输入；规则资产仍处于未临床验证状态；尚未完成前瞻性临床验证、真实深度/组织力学建模或监管验证。

## 验证

```bash
cd web
npm run typecheck
npm test
npm run test:browser
npm run build
```

相关静态和数值测试覆盖 worker 回退、固定工具顺序、trace 门控、候选比较、医生编辑、审阅导出和浏览器隐私预检；Playwright 回归覆盖 `/app/incision` 与 `/live` 的控件对比度、受控滑杆状态保持、移动端三维视图顺序、临床中文和规则验证边界。
