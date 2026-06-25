# Agentic 切口设计工程闭环

本文档记录 Stage 2 当前 PR 的工程闭环：肿物输入、面部分区、RSTL 方向服务、确定性切口工具、guardrails、LLM 摘要、医生调整 provenance、候选保存导出和隐私审计。它仍然是临床研究决策辅助可视化，不是自动手术指令或已验证医疗器械。

## 本 PR 已完成

- 皮下肿物：手动放置中心点，输入超声直径和深度，生成一条平行局部 RSTL 的线性候选切口；如果最大长度规则导致候选短于记录直径，系统会记录 `diameter_coverage_deficit_mm` 并触发 high guardrail。
- 皮表肿物：手动放置中心点，输入直径、安全切缘和边界，生成长轴平行局部 RSTL 的梭形候选切口；轮廓使用对称 cubic Hermite profile 约束目标尖端角，并在 metrics 中报告目标角、估计角和误差。
- 肿物数据模型：统一 `subcutaneous` / `cutaneous`、中心点、直径、深度、切缘、边界、来源、作者和单位字段，并在工具 trace、JSON 导出、审阅记录和 Markdown 报告中输出 `tumor_quality` 输入质量摘要。
- 确定性工具：面部分区、RSTL 局部方向查询、线性切口、梭形切口、敏感区 guardrails 和候选几何到敏感游离缘的最短距离筛查。
- Agent 编排：LLM 只读取工具结果并生成摘要，不计算几何、不覆盖安全规则；Python agent、SSE 代理和前端会用 `agent-trace-gate/v0.1` 检查 trace 至少包含肿物输入质量、面部分区、RSTL 查询、确定性切口生成、guardrails 和 `preview_incision_on_face` 面部预览，未通过时不能确认候选。后端现在会在主 RSTL 方向旁生成 `-10° / 0° / +10°` 三个确定性方向候选，逐个复跑切口生成、guardrails 与面部预览，再用 `compare_candidates` 输出工程排序；`agent-react-plan/v0.1` 会把肿物检查、解剖定位、RSTL 查询、主候选生成、guardrail 检查、候选预览和方向变体比较记录成可复放步骤；`agent-execution-events/v0.1` 会把同一条 trace 派生成 UI/SSE 可消费的执行事件序列，包含 tool observation、trace gate 评估、ReAct plan 评估、重试和恢复状态；`agent-orchestration-audit/v0.1` 会记录候选数、preview 数量、可渲染 preview 数量、比较状态、ReAct 计划状态、重试次数、恢复失败数和临床边界。确定性候选变体生成失败时会先追加 `retry_tool_failure` trace 并对同一工具有界重试一次；重试仍失败才追加 `recover_tool_failure` trace、跳过失败变体，并继续比较剩余候选；`tests/test_incision_agent.py` 用 transient / persistent synthetic variant failure 覆盖这两条路径。
- 前端工作台：`web/incision_agent.html` 可在标准脸上点选肿物位置，并在生成前实时显示当前肿物中心的面部分区、亚单位、置信度和靠近敏感游离缘/规则边界的提示；生成后显示肿物环、候选切口、梭形宽度/长宽比/尖端角误差、RSTL 方向来源、辅助线索只读边界、医生人工覆盖状态、流式工具调用 trace、Agent 执行事件、Agent ReAct 计划步骤、provider 状态和摘要。
- 医生调整：候选生成后可调整方向、长度、中心位移；梭形候选还可调宽度。调整会保留原始工具建议、覆盖原因、trace 和 provenance。
- 皮表肿物边界：支持椭圆近似和自由轮廓点输入；梭形生成会读取边界在 RSTL 长轴/短轴上的投影范围，必要时调整候选中心、宽度和长度，同时保留 3:1 长宽比、30° 默认尖端角和左右平滑对称的工程指标；如果最大长度规则导致候选无法覆盖边界加切缘，系统会记录 `axis_coverage_deficit_mm` 并触发 high guardrail；自由轮廓点数过少、面积退化、自交或边界中心明显偏离选中中心也会进入 guardrails；导出时保留 boundary、boundary source、author 和 units，并额外提示缺作者、非 mm 单位、缺皮下深度、缺切缘或边界过稀等输入质量问题。
- 自然皱襞 / 肿物边界辅助线索：当前提供合成样例 CV 原型、验证指标入口和工作台只读导入展示，见 `tools/prototype_wrinkle_lesion_cues.py`；它只能作为低置信度 secondary cue 进入审阅记录，`used_for_geometry=false`、`used_for_agent_prompt=false`，不自动改写肿物边界或切口几何。
- 审阅最小工作流：支持保存多个候选、生成方向备选、工程排序比较、记录审阅人/确认/退回/否决状态和备注，并导出 JSON、Markdown 报告草案和 PNG 截图；导出记录包含 `guardrail_summary`、`review_gate`、`agent_trace_gate`、`agent_react_plan`、`agent_execution_events` 和 `candidate_comparison`；候选几何调整后审阅状态会回到待医生确认；高风险 guardrail 候选确认前必须填写审阅备注或覆盖原因，发送到实时叠加前必须先确认候选草案，且 Agent 工具门控必须通过。
- 照片 / 视频 / 实时叠加：工作台只允许把已确认候选暂存为 `incision-overlay/v0.1`，payload 保留 `review_gate`、`guardrail_summary`、审阅状态和 `raw_image_sent=false` 审计字段；实时页读取后按三角面重心坐标投射到上传照片、视频或摄像头 landmarks 上，并复用背面剔除、手部遮挡和放大窗；存在切口候选时，放大窗会新增“切口候选”卡片，按肿物中心、边界和候选线的联合包围盒裁剪。导出使用 `createCanvasRecordingController` 录制主 canvas capture stream，因此会带上 RSTL、肿物和切口候选叠加；`tools/test_export_canvas.mjs` 会验证 `captureStream(30)`、`video/webm`、非空帧 chunk 和下载契约。3D Beta 查看器会把同一份候选 overlay 画到扫描出的 MediaPipe 468 重建头上；FLAME 示例脸会通过既有 MediaPipe→FLAME 近邻贴面映射显示研究预览，并把 `incision-overlay-3d-view-diagnostics/v0.1` 写入 diagnostics，标记不导出原始像素。`measureIncisionOverlayRegistration` 可对单帧 runtime landmarks 输出 `incision-overlay-registration/v0.1`，检查 mapped point、候选线点数、退化三角形、出画面点和 bbox 尺寸；实时渲染会把 registration pass/fail、mapped point count、out-of-frame count 和 bbox diagonal 写入 `window.exportLangerfaceDiagnostics()`，并在实时页“切口叠加 QA”区显示“等待画面 / 已投射 / 投射需复核 / 抖动需复核 / 叠加稳定”等工程反馈。`measureIncisionOverlayJitter` 可对静止头部或暂停视频的连续 landmarks 帧输出 `incision-overlay-stability/v0.1`，当前工程门槛为 RMS ≤ 2px、P95 ≤ 4px、max ≤ 8px；实时页还会维护最近 8 帧滚动窗口，并把 `incision-overlay-runtime-diagnostics/v0.1` 写入 diagnostics `sections.incision_overlay_runtime`，只包含候选摘要、registration、stability、阈值和失败原因，显式标记不导出照片/视频帧、canvas 像素或 landmark 坐标。`tools/audit_incision_overlay_replay.mjs` 可读取已脱敏的 overlay、三角拓扑和 landmarks 帧数组，离线输出 `incision-overlay-replay-qa/v0.1`，同时保留逐帧 registration 与整体 jitter 证据；可选 `--csv-output` 会导出一行 summary 和逐帧 registration QA 表格，但不导出 landmark 坐标或影像像素。
- Agent 工具 schema：`assets/agentic_incision_tool_schema.json` 固化工具名、输入输出、`agent-react-plan/v0.1`、`agent-execution-events/v0.1`、`preview_incision_on_face`、`propose_direction_variants`、`compare_candidates`、`retry_tool_failure`、`recover_tool_failure` 和 LLM 边界。
- Agent 离线审计：`tools/audit_agentic_incision_trace.py` 可读取 `agentic-incision-plan/v0.1`、`incision-review-record/v0.3` 或 `incision-review-export/v0.3`，重放 `agent-trace-gate/v0.1`、核对存储 gate、重放 `agent-react-plan/v0.1`、重放 `agent-execution-events/v0.1`、重放候选工程排序、检查 `agent-orchestration-audit/v0.1` 的候选/比较/计划/恢复失败计数，并输出 `agentic-incision-trace-audit/v0.1`。审计器还会输出 `agentic-llm-boundary-audit/v0.1`，检查 LLM 摘要是否保留医生复核边界、是否出现“可直接执行”类手术指令、是否夹带 raw provider payload、provider/API key 是否已脱敏，以及 LLM model 与 provider 状态是否一致。
- 隐私审计：`docs/INCISION_PRIVACY_AUDIT.md` 记录不出域数据、可发送抽象字段和导出审计字段。
- 导出守门：`tools/audit_export_privacy.py` 可在分享审阅、肿物或诊断 JSON 前拦截原始媒体标记、未脱敏 secret、明显身份字段和疑似嵌入媒体 payload。
- 验证汇总：`tools/evaluate_stage2_validation.py` 可读取脱敏审阅 JSON，汇总候选类型、医生确认率、guardrail 分布、RSTL 偏角、梭形几何误差、敏感距离、`incision-overlay-registration/v0.1` runtime projection QA、`incision-overlay-stability/v0.1` 抖动 RMS/P95/max、`incision-overlay-3d-view-diagnostics/v0.1` 3D 预览 rendered/failure 和映射模式、`incision-overlay-replay-qa/v0.1` 离线复放 QA 与通过率、失败模式和隐私审计计数；可选 `--csv-output` 会导出 reviewer 可读的扁平汇总表，不包含影像、视频帧、纹理或 landmark 坐标。
- Provider 接口：默认支持 Ollama/Qwen，本地或集群 vLLM 可通过 OpenAI-compatible endpoint 切入。
- 前端 Provider 配置：工作台暴露 Agent endpoint、Base URL、model、API Key 和 timeout；API Key 只发送给本地 Agent 代理，导出记录中会脱敏。
- Agent 代理接口：支持普通 JSON `POST /api/agentic-incision` 和 SSE trace `POST /api/agentic-incision/stream`；前端优先消费 `provider`、逐步 `execution_event`、逐步 `trace`、`trace_gate`、`react_plan`、`result` 和 `done` 事件，流式不可用时自动退回普通 JSON 请求。`tests/test_incision_agent_server.py` 会启动本地 `--no-llm` 代理，真实请求 JSON 与 SSE 两条路径，并检查 API key 脱敏、执行事件、trace gate、ReAct 计划事件、三方向候选比较和 `agent-orchestration-audit/v0.1`。

## 当前工程边界

- 面部分区：当前覆盖额部、耳周、颞颊、上睑、下睑、内眦、鼻背、鼻翼、鼻尖、鼻唇沟、颊部、唇红、上唇白唇、口角、颏部和下颌缘；分区结果会输出 `confidence_reasons` 和 `region_boundary_margin_norm`，把 bbox 启发式、规则边界附近、面部边缘、敏感游离缘附近、耳周/口角/鼻尖等过渡区显式写入前端点位预览、trace、guardrail 和报告；前额、耳周、内眦和下颌缘等区域仍必须人工确认。
- RSTL 方向：当前使用 atlas weighted-nearest 查询并记录 support count、轴向角度 spread 和 `confidence_reasons`；角度离散度按无向切线轴计算，避免把 `179°` / `-179°` 误判为高离散；atlas 为空、最近支持点过远、支持点过少或邻域角度冲突会进入候选 provenance、前端方向依据、guardrail 文案和导出报告；同一静态查询连续 100 次保持稳定，JS/Python 有对拍测试。
- 肿物模拟：当前可表达中心点、椭圆近似和自由轮廓点，并支持肿物输入 JSON 导入/导出；`summarize_tumor_input_quality` 会把来源、作者、单位、深度、切缘和边界完整性写入 trace、导出 JSON、审阅记录和报告。真实照片/3D 扫描自动识别边界不属于本 PR 的临床验证范围。
- 医生审阅：当前支持候选保存、方向备选、工程排序比较、审阅人、审阅状态、备注、确认/否决动作、JSON/Markdown/PNG 导出和 `audit_events`；工具生成候选从 `candidate_version=1` 开始，医生参数编辑会生成 `parent_candidate_id`、`edit_id`、`candidate_version` 和 `edit_history`，报告会显示候选版本与编辑记录数；候选比较只按 guardrails、RSTL 偏角、覆盖缺口、敏感距离和几何误差做工程排序，不是临床推荐。正式电子签名、病例系统绑定、权限控制和审阅锁定属于后续受控临床系统集成。
- Guardrails：已覆盖低 RSTL 置信度、低分区置信度、中心点近敏感游离缘、候选线/轮廓近敏感游离缘、下睑/唇红缘/鼻翼/鼻尖/口角敏感区提示、皮下线性直径覆盖不足、皮表边界点数/面积/自交/中心偏移质量、梭形边界轴向覆盖不足、RSTL 偏角覆盖原因检查；敏感游离缘距离使用标准脸归一化锚点和下睑/鼻翼/唇红缘简化线段，并按下睑、唇红缘、鼻翼、鼻尖、口角等结构使用 draft 距离阈值；命中敏感结构时会在 `suggested_overrides` 中给出 `protective_direction` 保护性方向建议并要求医生记录覆盖原因。阈值和保护性方向仍需临床审核。
- LLM Agentic：LLM 只做摘要和解释，工具 schema、trace、stream 契约、工具门控、`agent-react-plan/v0.1`、`agent-execution-events/v0.1`、后端方向备选、候选比较工具、有界重试、失败恢复审计和离线 trace audit 已固化，前端会实时展示工具 trace、Agent 执行事件、Agent 工具门控、ReAct 计划步骤状态和后端候选比较；`agent-trace-gate/v0.1` 由 Python agent 输出并通过 SSE `trace_gate` 事件暴露，会把缺失工具动作、顺序异常、确定性几何缺失或候选未预览写入审阅记录，并阻断未过门控的确认候选。`agent-react-plan/v0.1` 由同一条 trace 派生，记录每个计划步骤的 required action group、observed actions、trace indexes、status 和 issues；其中 `preview_candidates` 步骤要求至少一次 `preview_incision_on_face`，且每个成功候选记录 `incision-preview-observation/v0.1`，包含可渲染状态、预览空间、候选点数、肿物边界点数、guardrail 状态和不发送原始媒体标记。`agent-execution-events/v0.1` 同样由 trace、trace gate 和 ReAct plan 派生，记录 `execution_started`、逐条 `tool_observed`、`trace_gate_evaluated`、`react_plan_evaluated` 事件，并通过 SSE `execution_event` 逐条暴露；工作台事件列表、Markdown 报告和导出 JSON 都会保留执行状态。当前已测试覆盖确定性候选变体失败后的 `retry_tool_failure`、`recover_tool_failure`、候选跳过和剩余候选继续比较；`tools/audit_agentic_incision_trace.py` 也可离线重放 trace gate、ReAct 计划、执行事件、候选比较、重试、预览和恢复失败计数，并额外审计 `llm` / `provider` / `provider_config`，确保摘要保留医生复核边界、不泄露 provider secret、不夹带 raw provider payload、不出现“无需医生复核 / 可直接执行”类手术指令。但它仍是单轮多候选工具链，不是完整长程自主规划系统，后续多轮计划和跨工具跨阶段自动重试策略仍必须受确定性工具、审计记录和医生确认约束。
- 3D/AR 呈现：当前支持从标准脸工作台向 2D 实时页投射已确认候选，也支持在 3D Beta 查看器中把肿物中心、肿物边界和候选切口显示在扫描重建头或 FLAME 示例头上；overlay 校验会拒绝未达 `live_overlay_ready` 的 payload，并可用 runtime projection registration 指标检查 surface refs 是否在当前 landmarks 上可映射、是否出画面或落在退化三角形上，也可用静态连续帧和实时滚动窗口 jitter 指标检查候选线与肿物标记是否稳定跟随 landmarks；前端合约测试覆盖照片/视频输入、摄像头入口、视频/摄像头连续帧调度、3D overlay 映射、主 canvas webm 录制导出、diagnostics 采样、脱敏 `incision_overlay_runtime` / `incision_overlay_3d_view` section、可见“切口叠加 QA”状态和“切口候选”放大窗；浏览器 diagnostics 会捕获 `runtime.error` / `runtime.unhandledrejection`，便于 preview 检查应用级错误。3D Beta overlay 是工程预览，患者个体化临床 AR 配准仍需额外验证。
- L40S/vLLM 部署：`tools/slurm/serve_qwen_agent_l40s.sbatch` 负责把 Qwen/vLLM 放到 L40S 计算节点，当前由 `tools/test_slurm_qwen_agent.mjs` 静态锁定 GPU 申请、Qwen 默认模型、OpenAI-compatible vLLM 启动、health gate、Agent proxy provider 环境变量和端口转发提示。

## 临床与合规边界

- 不做自动诊断、肿物性质判断或安全切缘医学推荐。
- 不把原始患者影像、视频帧、摄像头画面或纹理默认送给 LLM Provider。
- 不做临床验证数据集、医生评分、误差指标或论文级评估。
- 不做 FLAME/BFM 个体化 3DMM 拟合和 RSTL 3D 拓扑先验的完整注册。
- 不把候选切口表达为自动手术指令；所有输出都必须进入医生复核。

## L40S 集群部署 Qwen/vLLM

登录节点或当前 shell 可能没有 GPU；这只说明“当前执行环境是 CPU-only”，不代表本项目应该在 CPU 上跑 Qwen。实际开发/测试应通过 Slurm 把 Qwen/vLLM 放到 L40S 计算节点。

提交 GPU 服务作业：

```bash
sbatch tools/slurm/serve_qwen_agent_l40s.sbatch
```

默认脚本会：

- 申请 `gpu:l40s:1`；
- 启动 vLLM OpenAI-compatible 服务，默认模型为 `Qwen/Qwen3-14B`；
- 在同一个计算节点启动 `tools/serve_incision_agent.py`；
- 让前端继续访问同一个 agent proxy 契约：`/api/agentic-incision`。

可按需覆盖：

```bash
LANGERFACE_LLM_MODEL=Qwen/Qwen3-8B \
VLLM_PORT=8000 \
AGENT_PORT=8765 \
sbatch tools/slurm/serve_qwen_agent_l40s.sbatch
```

作业启动后，从日志里读取计算节点名，然后建立端口转发：

```bash
ssh -N -L 8765:<compute-node>:8765 <login-node>
```

前端 `web/incision_agent.html` 默认请求 `http://127.0.0.1:8765/api/agentic-incision`，因此端口转发后无需改前端代码。

## 本地 Ollama 仅作降级开发

如果只是验证确定性工具链，可以在登录节点或普通工作站跑 Ollama：

```bash
ollama serve
ollama pull qwen3:8b
export LANGERFACE_LLM_PROVIDER=ollama
export LANGERFACE_OLLAMA_BASE_URL=http://127.0.0.1:11434
export LANGERFACE_LLM_MODEL=qwen3:8b
export LANGERFACE_LLM_TIMEOUT_S=20
python tools/serve_incision_agent.py
```

CPU-only 环境下 Qwen 可能超过 UI timeout；这时 agent 会返回确定性候选和 fallback 状态。最终 Qwen 性能测试应以 L40S/vLLM 作业为准。

## 远端 Provider 切换

后续切到远端 vLLM 或托管 OpenAI-compatible 服务时，不改切口规划代码，只改环境变量：

```bash
export LANGERFACE_LLM_PROVIDER=openai-compatible
export LANGERFACE_LLM_BASE_URL=https://example.internal/v1
export LANGERFACE_LLM_MODEL=Qwen/Qwen3-14B
export LANGERFACE_LLM_API_KEY=...
export LANGERFACE_LLM_TIMEOUT_S=60
python tools/serve_incision_agent.py
```

## 前端

```bash
cd web
npm run dev
```

打开 `incision_agent.html`。页面会优先请求 `http://127.0.0.1:8765/api/agentic-incision`；如果本地代理不可用，会退回浏览器内确定性工具，并在 provider 状态中标注 fallback。

## 验证

```bash
pytest tests/test_incision_agent.py
pytest tests/test_incision_agent_server.py
cd web && node ../tools/test_export_canvas.mjs
cd web && node ../tools/test_slurm_qwen_agent.mjs
cd web && npm test && npm run build
```

全仓测试仍是进入主分支前的更高一级 release gate。
