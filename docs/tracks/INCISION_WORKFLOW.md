# 本地确定性切口 workflow

本文记录 `/app/incision` 当前保留的切口候选 workflow。它完全在浏览器内运行，不包含远程模型、AI SDK、Provider 配置、自主规划或多轮推理。

该功能是临床研究决策辅助可视化，不是自动手术指令或已验证医疗器械。

## 运行边界

- `web/src/services/incisionWorkflowTools.ts` 按固定顺序调用确定性工具，生成候选、工具 trace、门控结果和候选比较。
- `web/src/workers/workflow.worker.ts` 通过 Comlink 在 Web Worker 中执行同一套 workflow。
- `web/src/services/workflowPlanner.ts` 在 Worker 不可用时回退到主线程执行相同的确定性函数。
- `web/src/services/incisionRuntime.ts` 负责工作台交互、审阅、导出和实时叠加衔接。
- 运行时不读取模型密钥，不请求远程模型，也不把原始照片、视频帧、摄像头画面或纹理发送到外部服务。

## 固定步骤

1. `summarize_tumor_input_quality` 检查肿物输入、单位、来源、作者、深度、切缘和边界。
2. `classify_region` 计算面部分区、亚单位和敏感游离缘距离。
3. `query_rstl_direction` 从本地图谱读取局部 RSTL 方向及其置信信息。
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

审阅记录与导出容器从 Agentic 字段迁移后分别使用 `incision-review-record/v0.4` 和
`incision-review-export/v0.4`；React controller snapshot 因移除 provider 状态并把 `agent_*` UI 字段改为
`workflow_*`，升级为 `react-incision-controller-snapshot/v0.2`。`tools/evaluate_stage2_validation.py`
仍兼容读取旧 `v0.3` 审阅导出，并在 summary 中分开报告源 schema，避免旧新结构静默混读。

旧书签 `/incision_agent.html` 只保留一个无运行时代码的跳转页，统一重定向到 `/app/incision`；
它不会恢复 Agentic 模式、Provider UI 或远程模型调用。

## 医生审阅

候选可编辑、确认、退回或否决；每次编辑都会重算几何和 guardrails，并记录 provenance。工具门控未通过、缺少审阅人或高风险提示缺少说明时，候选不能标记为可发送到实时叠加。

## 验证

```bash
cd web
npm run typecheck
npm test
npm run build
```

相关静态和数值测试覆盖 worker 回退、固定工具顺序、trace 门控、候选比较、医生编辑、审阅导出和浏览器隐私预检。
