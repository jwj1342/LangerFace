# 自然皱襞与肿物边界辅助线索原型

本文对应 GitHub issue [#22](https://github.com/jwj1342/LangerFace/issues/22)，记录自然皱襞、皱纹、美学边界和皮表肿物边界的辅助识别路线。该能力只作为低置信度线索进入医生审阅，不替代 RSTL、确定性规则或医生确认。

## 边界

- 不使用真实患者照片、视频帧或头模纹理作为公开样例。
- 不自动诊断肿物性质，不自动决定安全切缘。
- 不让未经验证的 AI/CV 输出直接改变切口方向；前端只能标为“辅助线索 / 低置信度 / 需人工确认”。
- 真实部署前需要医生标注集、伦理/合规审批和受控运行环境。

## 可选技术路线

| 路线 | 可检测内容 | 数据需求 | 隐私风险 | 部署成本 | 当前定位 |
| --- | --- | --- | --- | --- | --- |
| 传统 CV 边缘/颜色/形态学 | 合成样例、强对比皱纹、红色/色差肿物 | 少量合成或脱敏图 | 低 | 低 | 当前 baseline |
| Landmark 几何规则 | 鼻唇沟、睑缘、口角、亚单位近似边界 | MediaPipe/3DMM 点位 | 中 | 低 | 已与 #12 分区共用 |
| 通用分割模型 | 皮表边界候选 mask | 需人工标注或提示 | 高 | 中到高 | 仅限受控调研 |
| 医学/皮肤专用模型 | 病灶 mask、颜色/纹理特征 | 需合规医学数据 | 高 | 高 | 后续临床研究 |
| 医生手工修正优先 | 最终边界和方向确认 | 医生标注 | 低到中 | 中 | 当前产品路径 |

## 当前最小原型

`tools/prototype_wrinkle_lesion_cues.py` 只生成合成图，不读取真实人脸数据。它输出：

- `synthetic_input.png`：合成输入。
- `cue_overlay.png`：候选皱纹线和皮表肿物边界叠加图。
- `lesion_mask.png` / `wrinkle_mask.png`：候选 mask。
- `metrics.json`：与合成真值对比的 precision、recall 和 IoU。

运行：

```bash
python tools/prototype_wrinkle_lesion_cues.py --output-dir local_outputs/wrinkle_lesion_cues
```

测试覆盖：

```bash
pytest tests/test_wrinkle_lesion_cues.py
```

## 指标口径

- 皮表肿物边界：以 mask IoU 和边界可视化为主。
- 皱纹 / 自然皱襞：以 recall、precision 和线段角度误差为主。
- 切口设计使用时：只能作为 `secondary_source=wrinkle_or_crease_cue` 的候选依据，必须显示置信度和人工确认状态。
- 如果与局部 RSTL 或敏感结构 guardrail 冲突，guardrail 和医生审阅优先。

## 前端展示要求

- 展示文案使用“辅助线索”“低置信度”“需医生确认”，不得使用“自动识别病灶”或“推荐切口”。
- 导出审阅记录必须保留 `source=synthetic|manual|restricted_cv`、模型/脚本版本、作者和时间。
- 公开 PR Preview 不加载真实患者图像或受限模型输出。

## 下一步

1. 用医生手工边界建立受控小样本验证集，格式见 [VALIDATION.md](VALIDATION.md)。
2. 把医生修正后的边界与候选 mask 做 IoU / 边界距离统计。
3. 在 `web/incision_agent.html` 只读展示低置信度辅助线索，不自动改变候选切口。
4. 若引入远端模型，必须先完成 [PRIVACY_AND_AUDIT.md](PRIVACY_AND_AUDIT.md) 和 [INCISION_PRIVACY_AUDIT.md](INCISION_PRIVACY_AUDIT.md) 的出域审计。
