# Agentic 切口设计浏览器 Workflow

本文档记录 Stage 2 切口设计在本 PR 中的最新边界：Python Agent 后端、SSE 代理、多轮 session 后端和 L40S/Slurm Agent 启动脚本已经移除。当前运行时只保留浏览器内确定性 workflow，用结构化工具 trace、候选比较和审阅导出支撑医生复核。

这仍然是临床研究决策辅助可视化，不是自动手术指令或已验证医疗器械。

## 当前架构

- `web/incision_tools.js` 是切口候选生成的唯一运行时编排位置，`planIncisionWorkflow()` 会顺序执行确定性工具并生成 trace、ReAct plan、execution events、候选备选和审计结果。
- `web/src/services/incisionAgentRuntime.ts` 直接调用浏览器 workflow，不再请求 `/api/agentic-incision`、`/stream` 或 session 接口。
- `web/llm_provider.js` 只保留 OpenAI-compatible / vLLM Provider 的 Base URL 规范化和 `/models` 连通性测试；Provider 暂不参与候选几何、工具 trace 或 guardrails。
- `assets/agentic_incision_tool_schema.json` 只描述浏览器 workflow 工具、trace gate、候选比较和导出审阅契约。

## Workflow 步骤

每次点击生成候选时，浏览器会执行同一条确定性流程：

1. `summarize_tumor_input_quality` 汇总肿物输入质量、来源、作者、单位、深度、切缘和边界提示。
2. `classify_region` 计算面部分区、亚单位、置信度和敏感游离缘距离。
3. `query_rstl_direction` 查询局部 RSTL 方向、support count、角度离散度和置信度原因。
4. `inspect_sensitive_structures` 在候选生成前检查肿物中心和保护性方向例外。
5. `linear_subcutaneous_incision` 或 `fusiform_cutaneous_incision` 生成主候选。
6. `inspect_sensitive_structures` 在候选生成后复核候选几何到敏感游离缘的距离。
7. `evaluate_guardrails` 评估 RSTL 置信度、分区置信度、敏感结构、覆盖缺口和边界质量。
8. `preview_incision_on_face` 生成可渲染的标准脸预览观察。
9. `propose_direction_variants` 生成 `-10° / 0° / +10°` 三个方向备选。
10. 对每个方向备选复跑候选生成、敏感结构复核、guardrails 和预览。
11. `compare_candidates` 输出工程排序和候选比较摘要。

## 输出契约

浏览器 workflow 会随候选结果写入：

- `candidate_alternatives`：三条方向候选，含各自的切口几何、guardrails、敏感结构复核和预览。
- `candidate_comparison`：按 guardrail、RSTL 偏角、覆盖缺口、敏感距离和几何误差形成的工程排序，不是临床推荐。
- `agent_trace_gate`：检查 trace 是否包含肿物质量、分区、RSTL、敏感结构检查、候选生成、guardrails 和面部预览。
- `agent_react_plan`：从 trace 派生的可复放步骤计划，用于 UI 可视化和导出审阅。
- `agent_execution_events`：从 trace 派生的执行事件序列，用于前端反馈。
- `agent_orchestration_audit`：候选数、预览数、候选比较、trace gate、ReAct plan 和恢复状态的汇总审计。

## Provider 边界

前端只暴露一个 OpenAI-compatible / vLLM Provider 配置区，包含 Base URL、Model、API Key 和 timeout。连接测试固定请求 `${base_url}/models`。

在 Vercel preview 中测试 Provider 时，Base URL 必须是浏览器可直接访问、允许当前 preview origin 的 HTTPS/API 地址。浏览器页面不能绕过目标 Provider 的 CORS、Mixed Content 或 Private Network 限制。用户也可以提供自己已经处理好 CORS 的本机或远端兼容服务。

当前候选生成不调用 LLM。后续如恢复 LLM 摘要，也应只在浏览器内读取确定性 workflow 的抽象结果，不计算几何、不覆盖 guardrails、不接收原始照片、视频帧、摄像头画面或纹理。

## 已移除内容

- Python Agent planning 后端和 HTTP 代理。
- `/api/agentic-incision`、`/api/agentic-incision/stream`、session JSON/SSE 接口。
- L40S/Slurm Agent 服务脚本。
- Python 侧肿物、切口、guardrails、Agent mirror 实现及其专项测试。
- 离线 Agent trace/session 审计脚本；当前门控由浏览器 workflow 和 JS 合约测试覆盖。

## 验证

```bash
cd web
node ../tools/test_incision_tools.mjs
node ../tools/test_incision_agent_ui.mjs
node ../tools/test_llm_provider.mjs
npm test
npm run build
```

这些测试覆盖浏览器 workflow、Provider 连通性 helper、UI 文案/入口、trace gate、ReAct plan、execution events、候选备选、候选比较、导出前隐私预检和前端构建。

## 临床与合规边界

- 不做自动诊断、肿物性质判断或安全切缘医学推荐。
- 不把原始患者影像、视频帧、摄像头画面、纹理或 provider secret 写入审阅导出。
- 不把候选切口表达为自动手术指令；所有输出都必须进入医生复核。
- 当前面部分区、RSTL 方向、敏感结构阈值和保护性方向仍是研究原型，需要医生审阅和临床验证。
