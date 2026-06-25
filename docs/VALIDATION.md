# 临床验证与评估指标

本文对应 GitHub issue [#20](https://github.com/jwj1342/LangerFace/issues/20)，用于把 LangerFace 从演示原型推进到可复现的研究系统。当前内容是验证设计基线，不代表已经完成临床验证。

## 验证边界

- 系统输出是决策辅助可视化，不是手术指令。
- 内置 RSTL / Langer 图谱默认 `validated:false`，只能作为示意或待复核草案。
- 真实临床使用前必须经过医生团队验证、伦理/合规审查和病例级风险评估。
- 验证数据不得包含可公开识别的人脸原图、视频、头模纹理或超声原始资料。

## 数据集格式

最小验证集建议按病例编号组织，只保存必要的几何、标注和评审结果：

```json
{
  "caseId": "LF-STAGE1-0001",
  "stage": "stage1",
  "sourceKind": "photo|video|camera|scan3d",
  "assets": {
    "topologyId": "mediapipe-468",
    "atlasSystem": "rstl",
    "atlasVersion": "0.2",
    "appVersion": "0.2.0"
  },
  "inputs": {
    "landmarks": "local-or-restricted-reference",
    "imageRef": "restricted-storage-only"
  },
  "groundTruth": {
    "doctorLines": "polyline-or-atlas-reference",
    "reviewerId": "coded-reviewer-id"
  },
  "outputs": {
    "systemLines": "polyline-or-atlas-reference",
    "diagnosticsRef": "sanitized-json-reference"
  },
  "review": {
    "accepted": false,
    "failureModes": [],
    "notes": ""
  }
}
```

公开仓库只能提交合成数据、脱敏坐标夹具、统计汇总和不含身份信息的诊断 JSON。真实影像、视频、3D 头模、纹理和超声资料只能放在受控存储或医院内网环境。

## Stage 1 指标

| 目标 | 指标 | 计算方式 | 建议报告 |
| --- | --- | --- | --- |
| 图谱方向准确性 | 角度误差 | 系统局部切线方向 vs 医生标注方向 | 平均值、中位数、P90、分区统计 |
| 图谱位置贴合 | 距离误差 | 系统线点到医生标注线最近距离，按脸宽归一化 | 均值、P90、失败样例 |
| 实时稳定性 | 漂移率 | 静止头部连续帧线点位移 RMS | 每秒均值、峰值、设备信息 |
| 遮挡处理 | 遮挡失败率 | 被遮挡区域仍画线或未遮挡区域误删的比例 | 分类混淆表 |
| 检测鲁棒性 | 检测失败率 | 无脸、多人脸、侧脸、强光、低光等枚举原因 | 按失败原因汇总 |
| 医生可接受度 | 人工评分 | 医生对每个区域 1-5 分或接受/拒绝 | reviewer 一致性 |

## Stage 2 指标

Stage 2 涉及肿物模拟和候选切口，只能在医生审阅路径中评估：

| 目标 | 指标 | 说明 |
| --- | --- | --- |
| 肿物输入一致性 | 中心/直径/边界误差 | 与人工边界或超声直径对比 |
| 皮表边界辅助线索 | mask IoU、precision、recall | 仅用于低置信度 CV/AI 辅助线索，不自动改切口 |
| 皱纹 / 自然皱襞辅助线索 | recall、precision、角度误差 | 作为 RSTL 外的次级候选依据，必须人工确认 |
| 切口方向 | RSTL 偏角 | 候选长轴与局部 RSTL 方向差 |
| 梭形几何 | 长宽比、尖端角、平滑性 | 皮表肿物候选必须报告 |
| 敏感结构保护 | 警告召回率 | 下睑、唇红缘、鼻翼等风险区域 |
| 医生审阅 | 接受率、修改次数、覆盖原因 | 系统建议不能绕过医生确认 |
| 照片 / 视频 / 实时叠加 | overlay 注册质量 | 当前帧 landmarks 能否稳定映射 `incision-overlay/v0.1` surface refs；记录 mapped point count、候选线点数、退化三角形、出画面点、bbox diagonal / frame fraction |
| 照片 / 视频 / 实时叠加 | overlay 抖动 RMS / P95 / max | 静止头部或暂停视频连续 landmarks 帧中，肿物中心、边界和候选线 surface refs 的帧间像素位移；当前工程门槛 RMS ≤ 2px、P95 ≤ 4px、max ≤ 8px |
| 照片 / 视频 / 实时叠加 | overlay 可见 QA 反馈 | 实时页“切口叠加 QA”按实际 pose gate / local region gate / registration / stability 结果显示等待画面、姿态需复核、局部需复核、已投射、投射需复核、抖动需复核或叠加稳定；低 presence、偏航过大、快速帧间运动、明显张口/眨眼或近共线退化三角会阻止候选叠加；视频/摄像头主 RSTL 线束也会在 pose gate 失败时暂停绘制，质量条显示“需复核”，眼眉/口周局部高形变会触发 `rstl-local-region-quality-gate/v0.1` 并降透明或断开局部线条，质量条显示“局部复核” |
| 3D Beta 查看器 | overlay 3D 预览 | 已确认候选可在扫描重建头或 FLAME 示例头上显示肿物中心、边界和候选切口；diagnostics 记录 mapping mode 和 render summary，但这只是工程预览 |
| 照片 / 视频 / 实时叠加 | preview 诊断导出 | `window.exportLangerfaceDiagnostics()` 的 `sections.incision_overlay_runtime` 保存 pose gate、local region gate、最近一帧 registration 与最近 8 帧滚动 stability 摘要；只含 QA 数值、阈值和失败原因，不含照片/视频帧、canvas 像素或 landmark 坐标 |
| 照片 / 视频 / 实时叠加 | #19 工程验收门禁 | `tools/build_incision_overlay_acceptance_evidence.mjs` 把脱敏 photo/video/camera diagnostics、视频复放 QA、webm 导出契约和资源 QA 打包为标准 evidence；`tools/audit_incision_overlay_acceptance.mjs` 检查照片投射、视频复放/导出、摄像头稳定、浏览器 runtime error、资源 404 和 evidence 脱敏是否同时满足 |

当前公开仓库只提供合成样例原型，见 [WRINKLE_LESION_CUES.md](WRINKLE_LESION_CUES.md) 和
`tools/prototype_wrinkle_lesion_cues.py`。该脚本输出 `metrics.json`，字段包括：

```json
{
  "lesion": {"precision": 0.0, "recall": 0.0, "iou": 0.0},
  "wrinkle": {"precision": 0.0, "recall": 0.0, "iou": 0.0},
  "confidence_label": "low_confidence_cv_cue_requires_manual_confirmation"
}
```

真实数据验证时必须把这些指标替换为医生手工边界 / 皱纹线标注的对比结果，不能用合成样例分数代表临床性能。

## Stage 2 审阅导出汇总

切口 Agent 工作台导出的 `incision-review-record/v0.3` 或 `incision-review-export/v0.3` 可用脚本汇总为脱敏指标：

```bash
python tools/evaluate_stage2_validation.py \
  incision_review_*.json \
  --output stage2_validation_summary.json \
  --csv-output stage2_validation_summary.csv
```

脚本只读取审阅 JSON，不需要原始照片、视频帧、头模纹理或超声影像。输出 schema 为
`stage2-validation-summary/v0.1`。可选 CSV 会把同一份 summary 展平成
`section / metric / submetric / value / count / mean / median / p90 / min / max / clinical_boundary`
表格，供 reviewer 快速检查计数、通过率、overlay QA、privacy gate 和 secondary cue 是否越界；CSV 不包含影像、视频帧、纹理或 landmark 坐标。JSON 包含：

- 候选数、肿物类型分布、切口类型分布。
- 医生确认 / 否决状态计数和确认率。
- guardrail 通过率、warning severity/code 分布。
- `rstl_deviation_deg`、方向置信度、皮下直径覆盖缺口、梭形长宽比、尖端角误差、边界覆盖缺口、敏感游离缘距离和边界面积比的 count / mean / median / P90 / min / max。
- `secondary_cues` 汇总：低置信辅助线索导入数、人工确认率、来源/置信标签分布、lesion/wrinkle precision/recall/IoU，以及 `used_for_geometry_count` / `used_for_agent_prompt_count`。后两项必须保持 0。
- `incision-overlay-registration/v0.1`：可由 `measureIncisionOverlayRegistration` 对单帧 runtime landmarks 计算 surface refs 投射质量；脚本会汇总 `present_count`、`passed_count`、`failed_count`、`pass_rate`、`reason_counts`、`context_counts`，并把 mapped point count、candidate point count、invalid ref、missing landmark、degenerate triangle、out-of-frame、bbox diagonal 和 frame fraction 写入 `metrics`。该指标用于工程 QA，不代表患者个体化临床 AR 配准。
- `incision-overlay-stability/v0.1`：可由 `measureIncisionOverlayJitter` 对连续 landmarks 帧计算候选切口和肿物叠加的 RMS / P95 / max 像素抖动；脚本会汇总 `present_count`、`passed_count`、`failed_count`、`pass_rate`、`reason_counts`、`context_counts`，并把 RMS / P95 / max、tracked point count 和 sample count 写入 `metrics`。该指标用于工程回归，不替代真实视频/摄像头目检和临床评审。
- `incision-overlay-runtime-diagnostics/v0.1`：浏览器实时页在有候选 overlay 时写入 diagnostics `sections.incision_overlay_runtime`，包含候选摘要、`incision-overlay-pose-gate/v0.2` 姿态/运动/表情门禁、`rstl-local-region-quality-gate/v0.1` 眼眉/口周局部降可信门禁、最近一帧 registration、最近 8 帧滚动 stability、阈值、失败原因和 `exported_landmarks=false` / `exported_raw_pixels=false` 标记；候选切换或 overlay 清空时会重置该 section。`tools/evaluate_stage2_validation.py` 会把 `local_region_quality` 汇总为 `incision_overlay_local_region_quality` 的 present/pass/fail/pass_rate、reason/action/source/active region 分布，并把 active region count、局部 motion norm 和 expression value 写入 `metrics`；该汇总用于 reviewer 复盘局部降可信触发频率，不进入长期病例记录。
- `incision-overlay-3d-view-diagnostics/v0.1`：3D Beta 查看器在有候选 overlay 且重建头可用时写入 diagnostics `sections.incision_overlay_3d_view`，包含 mapping mode、重建显示空间、候选摘要、rendered 状态、候选线点数、肿物边界点数和 `exported_raw_pixels=false` 标记；脚本会汇总 `present_count`、`rendered_count`、`failed_count`、`rendered_rate`、`reason_counts`、`mapping_mode_counts`，并把候选线点数和肿物边界点数写入 `metrics`。FLAME 示例脸使用 MediaPipe refs 到 FLAME 示例头的近邻贴面映射，只作为工程预览。
- `incision-overlay-replay-qa/v0.1`：可由 `tools/audit_incision_overlay_replay.mjs` 读取已脱敏的 `incision-overlay/v0.1`、三角拓扑和 runtime landmarks 帧数组，离线复算每帧 registration 与整体 jitter；脚本会汇总 `present_count`、`passed_count`、`failed_count`、`pass_rate`、`reason_counts`，并把复放帧数、registration 失败帧数和 registration pass rate 写入 `metrics`。可选 `--csv-output` 会写出一行 summary 和逐帧 registration QA 表格，便于 reviewer 检查通过率、首个失败帧、bbox、出画面计数和 jitter 指标；CSV 不包含照片、视频帧、纹理、超声影像或 landmark 坐标。输入不包含照片、视频帧、纹理或超声影像；该指标只是 #19 的工程复放 QA，不是临床 AR 验证。
- `incision-overlay-acceptance-evidence/v0.1`：可由 `tools/build_incision_overlay_acceptance_evidence.mjs` 从脱敏照片/视频/摄像头 diagnostics、`incision-overlay-replay-qa/v0.1`、webm 导出契约、资源 QA 和浏览器 diagnostics 生成。builder 会拒绝 `landmark_frames`、raw image/video/canvas/pixel payload、`data:image/*` / `data:video/*` 以及 raw media 标记为 true 的输入，避免 reviewer 为了跑验收而拼接原始影像或 landmark 坐标。
- `incision-overlay-acceptance-audit/v0.1`：可由 `tools/audit_incision_overlay_acceptance.mjs --input acceptance_evidence.json --output acceptance_audit.json` 汇总脱敏 evidence，统一回答 #19 的工程验收问题：照片 source 是否有通过 registration 的肿物/切口叠加，视频 source 是否有通过 replay 或 stability 且导出为可播放 webm，摄像头 source 是否有通过 registration + stability，浏览器 diagnostics 是否没有 `runtime.error` / `runtime.unhandledrejection`，构建资源 QA 是否无 404，以及 evidence 是否没有 raw image/video/canvas/landmark payload。该脚本只验证工程证据完整性，不证明真实患者 AR 配准或临床安全。
- 失败模式计数：脚本会读取人工 `failure_modes`，也会把高层 warning code 映射到 `direction_error`、`region_misclassification`、`sensitive_structure_warning`、`incision_rule_violation`、`tumor_boundary_input_quality` 等验证分类。
- 隐私审计计数：`raw_media_sent_count` 和 `provider_secret_leak_count` 必须保持 0。

这个汇总只能证明工程记录可复现，不能证明临床安全性。正式研究仍需受控病例库、医生标注和统计计划。

## 失败案例分类

每个失败样例至少记录一个主因：

- `no_face_detected`：未检测到人脸。
- `low_confidence_landmarks`：关键点置信度不足或明显漂移。
- `pose_out_of_range`：转头或俯仰超出有效范围。
- `occlusion_failure`：手、纸张、器械或头发遮挡处理失败。
- `atlas_mismatch`：图谱拓扑、系统或版本与当前网格不匹配。
- `region_misclassification`：眼周、鼻唇沟、口周等区域判断错误。
- `direction_error`：局部张力线方向与医生标注偏差过大。
- `incision_rule_violation`：Stage 2 候选违反长宽比、尖端角或敏感结构约束。
- `review_rejected`：医生明确拒绝候选结果。
- `overlay_registration_failure`：切口 / 肿物实时叠加的 `incision-overlay-registration/v0.1` 未通过 surface-ref 投射质量门槛，例如 landmarks 缺失、运行时三角形退化、出画面或映射点不足。
- `overlay_instability`：切口 / 肿物实时叠加的 `incision-overlay-stability/v0.1` 未通过工程抖动阈值。
- `overlay_replay_failure`：切口 / 肿物实时叠加的 `incision-overlay-replay-qa/v0.1` 离线复放未通过，通常来自单帧 registration 失败或连续帧 jitter 超阈值。
- `overlay_3d_view_failure`：3D Beta 查看器的 `incision-overlay-3d-view-diagnostics/v0.1` 未能渲染候选切口或肿物边界点，通常来自缺少可映射 surface refs 或示例头近邻贴面映射失败。

## 人工评审表

建议每条样例保留：

- reviewer 编号、角色、评审日期。
- atlas 系统、版本、topologyId、应用版本。
- 输入类型和受控数据引用，不保存公开可访问原始影像。
- 每个面部分区的方向评分、位置评分、稳定性评分。
- 失败模式枚举和自由文本备注。
- 医生最终接受、修改或拒绝的结论。

## 采集流程

1. 先运行本地或受控环境 demo，导出不含图像像素的诊断 JSON。
2. 医生在标注器或审阅工具中给出参考线、评分和失败分类。
3. 用脚本计算角度、距离、漂移、遮挡失败等量化指标。
4. 汇总为病例级和区域级报告；只把脱敏统计提交到公开仓库。
5. 若指标口径变化，同步更新本文和相关测试夹具。
