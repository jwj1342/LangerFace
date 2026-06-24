# Agentic 切口设计工程闭环

本文档记录 Stage 2 当前 PR 的工程闭环：肿物输入、面部分区、RSTL 方向服务、确定性切口工具、guardrails、LLM 摘要、医生调整 provenance、候选保存导出和隐私审计。它仍然是临床研究决策辅助可视化，不是自动手术指令或已验证医疗器械。

## 本 PR 已完成

- 皮下肿物：手动放置中心点，输入超声直径和深度，生成一条平行局部 RSTL 的线性候选切口；如果最大长度规则导致候选短于记录直径，系统会记录 `diameter_coverage_deficit_mm` 并触发 high guardrail。
- 皮表肿物：手动放置中心点，输入直径、安全切缘和边界，生成长轴平行局部 RSTL 的梭形候选切口；轮廓使用对称 cubic Hermite profile 约束目标尖端角，并在 metrics 中报告目标角、估计角和误差。
- 肿物数据模型：统一 `subcutaneous` / `cutaneous`、中心点、直径、深度、切缘、边界、来源、作者和单位字段。
- 确定性工具：面部分区、RSTL 局部方向查询、线性切口、梭形切口、敏感区 guardrails 和候选几何到敏感游离缘的最短距离筛查。
- Agent 编排：LLM 只读取工具结果并生成摘要，不计算几何、不覆盖安全规则。
- 前端工作台：`web/incision_agent.html` 可在标准脸上点选肿物位置，显示肿物环、候选切口、梭形宽度/长宽比/尖端角误差、流式工具调用 trace、provider 状态和摘要。
- 医生调整：候选生成后可调整方向、长度、中心位移；梭形候选还可调宽度。调整会保留原始工具建议、覆盖原因、trace 和 provenance。
- 皮表肿物边界：支持椭圆近似和自由轮廓点输入；梭形生成会读取边界在 RSTL 长轴/短轴上的投影范围，必要时调整候选中心、宽度和长度，同时保留 3:1 长宽比、30° 默认尖端角和左右平滑对称的工程指标；如果最大长度规则导致候选无法覆盖边界加切缘，系统会记录 `axis_coverage_deficit_mm` 并触发 high guardrail；自由轮廓点数过少、面积退化、自交或边界中心明显偏离选中中心也会进入 guardrails；导出时保留 boundary、boundary source、author 和 units。
- 自然皱襞 / 肿物边界辅助线索：当前只提供合成样例 CV 原型和验证指标入口，见 `tools/prototype_wrinkle_lesion_cues.py`；它只能作为低置信度 secondary cue，不自动改写切口几何。
- 审阅最小工作流：支持保存多个候选、生成方向备选、工程排序比较、记录审阅人/确认/退回/否决状态和备注，并导出 JSON、Markdown 报告草案和 PNG 截图；导出记录包含 `guardrail_summary`、`review_gate` 和 `candidate_comparison`；候选几何调整后审阅状态会回到待医生确认；高风险 guardrail 候选确认前必须填写审阅备注或覆盖原因，发送到实时叠加前必须先确认候选草案。
- 照片 / 视频 / 实时叠加：工作台只允许把已确认候选暂存为 `incision-overlay/v0.1`，payload 保留 `review_gate`、`guardrail_summary`、审阅状态和 `raw_image_sent=false` 审计字段；实时页读取后按三角面重心坐标投射到上传照片、视频或摄像头 landmarks 上，并复用背面剔除、手部遮挡和放大窗。
- Agent 工具 schema：`assets/agentic_incision_tool_schema.json` 固化工具名、输入输出和 LLM 边界。
- 隐私审计：`docs/INCISION_PRIVACY_AUDIT.md` 记录不出域数据、可发送抽象字段和导出审计字段。
- 导出守门：`tools/audit_export_privacy.py` 可在分享审阅、肿物或诊断 JSON 前拦截原始媒体标记、未脱敏 secret、明显身份字段和疑似嵌入媒体 payload。
- 验证汇总：`tools/evaluate_stage2_validation.py` 可读取脱敏审阅 JSON，汇总候选类型、医生确认率、guardrail 分布、RSTL 偏角、梭形几何误差、敏感距离、失败模式和隐私审计计数。
- Provider 接口：默认支持 Ollama/Qwen，本地或集群 vLLM 可通过 OpenAI-compatible endpoint 切入。
- 前端 Provider 配置：工作台暴露 Agent endpoint、Base URL、model、API Key 和 timeout；API Key 只发送给本地 Agent 代理，导出记录中会脱敏。
- Agent 代理接口：支持普通 JSON `POST /api/agentic-incision` 和 SSE trace `POST /api/agentic-incision/stream`；前端优先消费 `provider`、逐步 `trace`、`result` 和 `done` 事件，流式不可用时自动退回普通 JSON 请求。

## 当前工程边界

- 面部分区：当前覆盖额部、耳周、颞颊、上睑、下睑、内眦、鼻背、鼻翼、鼻尖、鼻唇沟、颊部、唇红、上唇白唇、口角、颏部和下颌缘；前额、耳周、内眦和下颌缘等区域会保守给出较低置信度，必须人工确认。
- RSTL 方向：当前使用 atlas weighted-nearest 查询并记录 support count、轴向角度 spread 和低置信度；角度离散度按无向切线轴计算，避免把 `179°` / `-179°` 误判为高离散；同一静态查询连续 100 次保持稳定，JS/Python 有对拍测试。
- 肿物模拟：当前可表达中心点、椭圆近似和自由轮廓点，并支持肿物输入 JSON 导入/导出；真实照片/3D 扫描自动识别边界不属于本 PR 的临床验证范围。
- 医生审阅：当前支持候选保存、方向备选、工程排序比较、审阅人、审阅状态、备注、确认/否决动作、JSON/Markdown/PNG 导出和 `audit_events`；候选比较只按 guardrails、RSTL 偏角、覆盖缺口、敏感距离和几何误差做工程排序，不是临床推荐。正式电子签名、病例系统绑定、权限控制和审阅锁定属于后续受控临床系统集成。
- Guardrails：已覆盖低 RSTL 置信度、低分区置信度、中心点近敏感游离缘、候选线/轮廓近敏感游离缘、下睑/唇红缘/鼻翼/鼻尖/口角敏感区提示、皮下线性直径覆盖不足、皮表边界点数/面积/自交/中心偏移质量、梭形边界轴向覆盖不足、RSTL 偏角覆盖原因检查；敏感游离缘距离使用标准脸归一化锚点和下睑/鼻翼/唇红缘简化线段，阈值仍需临床审核。
- LLM Agentic：LLM 只做摘要和解释，工具 schema、trace、stream 契约和候选比较工具已固化，前端会实时展示工具 trace；长程自主规划仍必须受确定性工具、审计记录和医生确认约束。
- 3D/AR 呈现：当前支持从标准脸工作台向 2D 实时页投射已确认候选；overlay 校验会拒绝未达 `live_overlay_ready` 的 payload。3D Beta 头模上的患者个体化切口 overlay 仍需额外配准和临床验证。

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
cd web && npm test && npm run build
```

全仓测试仍是进入主分支前的更高一级 release gate。
