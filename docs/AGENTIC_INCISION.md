# Agentic 切口设计阶段性功能切片

本文档记录 Stage 2 当前 PR 的真实边界：这是一个“肿物输入 + RSTL 方向 + 确定性切口工具 + LLM 摘要 + 医生调整 provenance”的阶段性功能切片，不是完整 E-Show 产品线。

## 本 PR 已完成

- 皮下肿物：手动放置中心点，输入超声直径和深度，生成一条平行局部 RSTL 的线性候选切口。
- 皮表肿物：手动放置中心点，输入直径和安全切缘，生成长轴平行局部 RSTL 的梭形候选切口。
- 肿物数据模型：统一 `subcutaneous` / `cutaneous`、中心点、直径、深度、切缘、来源字段。
- 确定性工具：面部分区、RSTL 局部方向查询、线性切口、梭形切口、敏感区 guardrails。
- Agent 编排：LLM 只读取工具结果并生成摘要，不计算几何、不覆盖安全规则。
- 前端工作台：`web/incision_agent.html` 可在标准脸上点选肿物位置，显示肿物环、候选切口、工具调用 trace、provider 状态和摘要。
- 医生调整：候选生成后可调整方向、长度、中心位移；梭形候选还可调宽度。调整会保留原始工具建议、覆盖原因、trace 和 provenance。
- Provider 接口：默认支持 Ollama/Qwen，本地或集群 vLLM 可通过 OpenAI-compatible endpoint 切入。

## 只完成了一部分

- 肿物模拟：目前是“手动中心点 + 圆形/近圆形直径”的几何近似；还不是医生在真实照片/3D 扫描上勾画真实肿物边界。
- 皮表肿物边界：模型字段保留 `boundary`，但前端尚未实现自由勾画轮廓或从图像识别边界。
- 医生审阅：当前支持参数化调整候选、记录覆盖原因和 provenance；还没有多候选保存、撤销/重做或导出正式审阅记录。
- Guardrails：已覆盖低 RSTL 置信度、低分区置信度、下睑/唇红缘/鼻翼敏感区提示、RSTL 偏角覆盖原因检查；尚未覆盖完整面部亚单位和真实游离缘距离测量。
- LLM Agentic：当前是“确定性工具链 + LLM 摘要”的单轮功能切片；还不是完整 ReAct 多轮规划、浏览器工具执行器、SSE 流式 trace 或多候选迭代。
- 3D/AR 呈现：当前在标准脸工作台上展示候选；尚未把肿物和切口稳定叠加到上传照片、视频或实时摄像头。

## 本 PR 未完成

- 不做自动诊断、肿物性质判断或安全切缘医学推荐。
- 不做真实患者影像/扫描的完整隐私审计和出域控制。
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
