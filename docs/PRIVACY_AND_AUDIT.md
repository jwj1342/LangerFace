# 隐私、合规与审计边界

本文对应 GitHub issue [#21](https://github.com/jwj1342/LangerFace/issues/21)，定义 LangerFace 在临床研究协作中的数据边界和审计记录最小字段。它不是法律意见，真实临床部署仍需机构合规团队确认。

## 基本原则

- 本地优先：默认在浏览器或本地脚本中处理，不上传用户画面。
- 最小化：只采集完成验证或审阅所必需的坐标、版本和诊断信息。
- 可追溯：任何图谱、候选切口或医生覆盖都必须能追到作者、时间、版本和依据。
- 可撤回：受限数据应有明确所有者、保存期限和删除路径。
- 医生确认：系统不得把候选线描述为自动手术指令。

## 数据分级

| 数据类型 | 示例 | 公开仓库 | 受控存储 / 内网 | 备注 |
| --- | --- | --- | --- | --- |
| 代码与文档 | `src/`, `web/`, `docs/` | 允许 | 允许 | 不含敏感样例 |
| 合成或公开授权夹具 | 合成 landmarks、匿名 JSON | 允许 | 允许 | 需说明来源和许可 |
| 图谱草案 | `validated:false` atlas JSON | 允许，需无患者身份 | 允许 | 必须保留 provenance |
| 诊断 JSON | fps、失败原因、资产版本 | 允许，需脱敏 | 允许 | 不得包含图像像素或人脸纹理 |
| 患者照片 / 视频 | 原始人脸影像 | 禁止 | 允许，需审批 | 视为敏感个人信息 |
| 3D 头模 / 纹理 | OBJ/GLB、扫描纹理 | 禁止 | 允许，需审批 | 可识别生物特征 |
| 超声 / 病理信息 | 肿物深度、病理结果 | 禁止 | 允许，需审批 | 可能构成医疗记录 |
| Vercel Preview 公开资产 | `web/assets/recon_demo.json` | 仅限示例/授权 | 不适用 | 不要放真实患者头模 |

## 禁止提交

- 真实患者照片、视频、3D 头模、纹理、超声原始文件。
- 可逆推出身份的文件名、EXIF、病例号、医院号、姓名或联系方式。
- 未授权的第三方数据集样例。
- Vercel / Cloudflare / GitHub secret、bypass token、私有下载链接。

## 导出格式约束

默认导出只应包含：

- atlas 坐标、xyz 折线、候选切口几何。
- `validated`、`provenance`、`topologyId`、`topologyVersion`、`atlasVersion` 等版本字段。
- 诊断事件、计数器、阶段耗时、fps、失败原因枚举。
- 审阅记录中的医生编号或角色编码。
- 低置信辅助线索的结构化摘要、metrics、来源和人工确认状态；若包含 mask / overlay，只能保存文件名或受控对象引用，不得内嵌像素。

默认导出不应包含：

- 原始图像像素、视频帧、头模纹理。
- 未脱敏病历、超声图像或病理文本。
- 可识别个人身份的自由文本。
- 辅助线索的 base64 mask、overlay、DICOM、视频帧或任何可还原人脸/病灶影像的 payload。

## 审计记录最小字段

```json
{
  "auditId": "audit-0001",
  "caseId": "coded-case-id",
  "createdAt": "2026-06-24T00:00:00Z",
  "actor": {
    "id": "coded-user-id",
    "role": "annotator|reviewer|surgeon|maintainer"
  },
  "action": "create_atlas|edit_line|review_candidate|override_rule|export",
  "assetVersions": {
    "appVersion": "0.2.0",
    "topologyId": "mediapipe-468",
    "atlasSystem": "rstl",
    "atlasVersion": "0.2"
  },
  "objectRef": {
    "type": "atlas|line|tumor|incision_candidate|diagnostics",
    "id": "object-id"
  },
  "decision": {
    "status": "draft|accepted|rejected|overridden",
    "reason": "free-text-without-PII"
  }
}
```

## 医生覆盖记录

当医生修改或否决系统候选时，必须记录：

- 原候选 id 与版本。
- 修改后的几何或参数。
- 覆盖原因，例如敏感结构、皮肤松弛度、自然皱襞、病理边界或术者经验。
- 覆盖者角色和时间。
- 是否需要二次复核。

## Preview 与部署

- PR Preview 只能展示公开示例、合成数据或授权 demo 资产。
- 若 Preview 需要展示受限数据，必须启用访问控制并单独评估；默认不这么做。
- Production 站点不得包含真实患者资产。
- `web/assets/recon_demo.json` 这类随站点公开的文件必须保持示例性质。

## 浏览器诊断 JSON

浏览器端 `window.exportLangerfaceDiagnostics()` 只导出结构化事件、计数器、指标和资产版本，不导出 canvas 像素。分享前仍需检查：

- `events[].detail` 中没有姓名、病例号或自由文本身份信息。
- `assetVersions` 不含私有下载 URL 或 secret。
- 诊断文件只用于调试、验证汇总或 PR 说明，不作为临床病历系统替代品。

## 导出前自动审计

分享审阅记录、肿物输入或诊断 JSON 前，可运行：

```bash
python tools/audit_export_privacy.py incision_review_*.json tumor_input_*.json
python tools/audit_incision_review_gate.py incision_review_*.json
python tools/audit_tumor_input.py tumor_input_*.json
```

脚本输出 `export-privacy-audit/v0.1` 报告，默认发现违规即返回非 0。当前检查项包括：

- `privacy_audit.raw_image_sent`、`raw_video_sent` 或 `contains_face_image` 被置为 `true`。
- `api_key`、`token`、`secret`、`authorization` 等字段未脱敏。
- `patient_name`、`mrn`、`phone`、`email`、`date_of_birth` 等身份字段被填充。
- 自由文本中出现 email 或电话样式字符串。
- 媒体相关字段中疑似嵌入 base64 图像 / 视频 / DICOM payload。
- `secondary_cues.used_for_geometry` 或 `secondary_cues.used_for_agent_prompt` 被置为 `true`。

辅助线索当前只能作为医生审阅时的只读证据进入导出，不得自动改变肿物边界、候选切口或 LLM Agent 的 prompt；若后续要让受控 CV/LLM 模型参与几何生成，必须重新定义出域、访问控制和临床验证流程。

`tools/audit_tumor_input.py` 输出 `tumor-input-audit/v0.1`，用于肿物输入导出前的结构化工程门禁：检查 `tumor-input/v0.2` schema、`tumor_quality` 对应的单位 / 作者 / 深度 / 切缘提示、导出边界 summary 与实际肿物轮廓点数是否一致，以及 `privacy_audit` 是否声明未包含原始影像。它只验证抽象几何和隐私边界，不判断病灶性质、切缘充分性或临床可用性。

`tools/audit_incision_review_gate.py` 输出 `incision-review-gate-audit/v0.1`，用于审阅记录分享前的 workflow 门禁：检查 `approved_for_discussion` 是否有审阅人、高风险 guardrail 是否有备注或覆盖理由、`agent_trace_gate` 是否通过，以及 `live_overlay_ready` 是否只在这些条件同时满足时为 `true`。它只检查导出状态自洽，不替代医生签名或病例系统权限控制。

该脚本只是工程守门，不能替代机构合规审查。
