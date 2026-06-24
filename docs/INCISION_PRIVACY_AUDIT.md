# 切口 Agent 隐私与审计边界

本阶段功能只处理抽象几何与结构化肿物参数。前端、Agent 代理和 LLM provider 的边界如下。

## 不出域数据

- 原始照片、视频帧和摄像头画面不发送给 Agent 代理或 LLM provider。
- MediaPipe 原始检测帧不发送给 Agent 代理或 LLM provider。
- API Key 不写入导出的审阅记录；导出时只保留 `[redacted]`。

## 可发送给 Agent 代理的数据

- 肿物类型：`subcutaneous` / `cutaneous`。
- 肿物中心：标准脸或重建脸上的抽象 3D 坐标。
- 直径、深度、安全切缘、单位、作者和来源。
- 皮表肿物边界点：抽象 3D 坐标，不包含原始影像像素。
- 候选切口几何、guardrails、工具调用 trace。
- Provider 通信配置：Base URL、model、timeout 和本次请求的 API Key。
- 实时叠加暂存：`incision-overlay/v0.1` 只保存三角面 id、重心坐标、肿物/候选几何和审计标记，不保存照片/视频像素。

## 审计记录

导出的 JSON / 报告草案必须包含：

- `tumor`：结构化肿物输入。
- `candidate` / `original_candidate`：候选几何与医生调整前后的差异。
- `guardrails`：警告、建议覆盖和是否通过。
- `guardrail_summary` / `review_gate`：高风险 guardrail 汇总、审阅备注要求和实时叠加就绪状态。
- `trace`：工具调用、输入和观察。
- `provider_config`：去敏后的 provider 配置。
- `privacy_audit`：数据出域声明，明确 `raw_image_sent=false`。
- `incision-overlay/v0.1`：用于照片/视频/实时页的短期 sessionStorage 叠加，不作为病历或长期审计系统。

## 仍需单独完成的合规工作

- 研究伦理和数据治理审批。
- 访问控制、日志保留周期和删除策略。
- 医生身份、病例 ID、审阅签名和版本锁定。
- 外部 LLM provider 的数据处理协议和审计。
