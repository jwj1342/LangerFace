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
python tools/evaluate_stage2_validation.py incision_review_*.json --output stage2_validation_summary.json
```

脚本只读取审阅 JSON，不需要原始照片、视频帧、头模纹理或超声影像。输出 schema 为
`stage2-validation-summary/v0.1`，包含：

- 候选数、肿物类型分布、切口类型分布。
- 医生确认 / 否决状态计数和确认率。
- guardrail 通过率、warning severity/code 分布。
- `rstl_deviation_deg`、方向置信度、皮下直径覆盖缺口、梭形长宽比、尖端角误差、边界覆盖缺口、敏感游离缘距离和边界面积比的 count / mean / median / P90 / min / max。
- `secondary_cues` 汇总：低置信辅助线索导入数、人工确认率、来源/置信标签分布、lesion/wrinkle precision/recall/IoU，以及 `used_for_geometry_count` / `used_for_agent_prompt_count`。后两项必须保持 0。
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
