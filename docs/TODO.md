# TODO / 路线图

待办与 [GitHub Issues](https://github.com/jwj1342/LangerFace/issues) 同步。
Stage 1 = 稳定显示张力线（当前）；Stage 2 = 肿物模拟 + 切口候选设计。

> PR #91 已把 Stage 2 的工程闭环推进到候选切口、审阅导出、2D 实时叠加、验证文档与隐私审计；合并前下列 issue 仍在 GitHub 显示 open。当前产品边界见 [PRODUCT_BOUNDARIES.md](PRODUCT_BOUNDARIES.md)。

## Stage 1 收尾
- [ ] 临床医生校验线图谱并置 `validated:true`（Stage 1 真正出口）— [#2](https://github.com/jwj1342/LangerFace/issues/2)
      · 现可用[网页 3D 标注](ARCHITECTURE.md#12-网页-3d-线标注与图谱草案导出)在标准脸上产出待复核图谱草案

## 增强
- [ ] 通用外部遮挡：语义分割识别器械 / 纱布 / 口罩 — [#3](https://github.com/jwj1342/LangerFace/issues/3)
- [ ] 3D：非刚性配准、网格导出（.obj/.glb）、3D 投影叠加手部遮挡 — [#4](https://github.com/jwj1342/LangerFace/issues/4)
- [ ] 录制 / 导出完善（含放大窗与 3D）— [#5](https://github.com/jwj1342/LangerFace/issues/5)

## Stage 2：肿物与切口设计

临床目标：把标准 RSTL / 皱襞 / 美学亚单位边界迁移到患者脸上，在医生输入肿物信息后，生成可解释、可编辑、可审阅的候选切口。系统只做决策辅助，不输出手术指令。

### 临床知识与几何基础

- [ ] 结构化面部皮纹线与切口设计原则，形成可版本管理的临床规则库 — [#11](https://github.com/jwj1342/LangerFace/issues/11)
- [ ] 面部分区与美学亚单位定位：把人脸点位映射到临床区域 — [#12](https://github.com/jwj1342/LangerFace/issues/12)
      · 本 PR 已覆盖额部、耳周、颞颊、上下睑、内眦、鼻背/鼻翼/鼻尖、鼻唇沟、颊部、唇红、上唇、口角、颏部和下颌缘，并输出 `confidence_reasons` 与 `region_boundary_margin_norm`；真实 MediaPipe/FLAME 分区边界和侧脸/表情稳定性仍待后续临床校验
- [ ] RSTL 局部方向服务：为切口设计提供方向、置信度与可解释依据 — [#13](https://github.com/jwj1342/LangerFace/issues/13)
      · 本 PR 已支持 atlas weighted-nearest 查询、support count、无向轴角离散度、JS/Python 对拍和结构化 `confidence_reasons`；atlas 为空、最近支持点过远、支持点过少或邻域角度冲突会进入 trace、候选 provenance、guardrail 文案和报告；临床级 atlas 质量与个体头模一致性仍待医生校验
- [ ] Borges RSTL 3DMM 拓扑先验：数字化经典图谱并注册到 FLAME/BFM 标准网格 — [#86](https://github.com/jwj1342/LangerFace/issues/86)
      · 本 PR 已新增 `rstl_mediapipe_direction_prior.json`，作为 MediaPipe 标准脸高密度方向场草案；FLAME/BFM 注册仍待 #61 资产与医生标注

### 肿物与切口候选生成

- [ ] 肿物输入模型：支持皮下肿物与皮表肿物的术前约束表达 — [#14](https://github.com/jwj1342/LangerFace/issues/14)
      · 本 PR 已支持中心点、直径/深度/切缘、椭圆/自由轮廓、来源作者、肿物 JSON 导入导出，以及自由轮廓点数/面积/自交/中心偏移 guardrails；自动影像分割仍属后续
- [ ] 皮下肿物切口生成：按超声直径生成平行 RSTL 的线性切口 — [#15](https://github.com/jwj1342/LangerFace/issues/15)
      · 本 PR 已支持 RSTL 轴向线性候选、端点/长度编辑、目标长度 metrics、最大长度截断记录和直径覆盖不足 high guardrail
- [ ] 皮表肿物梭形切口生成器：长轴、比例、尖端角与平滑对称约束 — [#16](https://github.com/jwj1342/LangerFace/issues/16)
      · 本 PR 已支持边界投影覆盖、面积/自交质量指标、3:1 默认长宽比、cubic Hermite 轮廓、30° 默认尖端角目标和实际误差 metrics；真实病例曲线调参仍需医生 review
- [ ] 敏感结构保护规则：下睑、唇红缘、鼻翼等游离边缘风险提示与方向例外 — [#17](https://github.com/jwj1342/LangerFace/issues/17)
      · 本 PR 已支持敏感区提示、中心点和候选几何到敏感锚点/简化游离缘线段的距离筛查，并按下睑、唇红缘、鼻翼、鼻尖、口角使用 draft 阈值表；真实解剖边界和阈值仍需临床确认

### 产品化与临床验证

- [ ] 医生审阅与交互编辑工作流：候选切口必须可解释、可修改、可导出 — [#18](https://github.com/jwj1342/LangerFace/issues/18)
      · 本 PR 已支持候选保存、方向备选、工程排序比较、端点拖拽/参数编辑、候选版本 provenance、`edit_history`、审阅人、确认/退回/否决、备注、JSON/Markdown/PNG 导出、审计事件、高风险确认备注约束和实时叠加确认门槛；正式电子签名、病例系统绑定、权限与锁定仍属临床系统集成
- [ ] 照片、视频与 AR 实时叠加：把肿物和切口候选稳定投射到患者脸上 — [#19](https://github.com/jwj1342/LangerFace/issues/19)
      · 本 PR 已支持把已确认候选以 `incision-overlay/v0.1` 暂存到实时页，按三角面重心坐标投射到照片/视频/摄像头 landmarks，并在 overlay 中保留 `review_gate`、`guardrail_summary`、审阅状态和 `raw_image_sent=false` 审计字段；患者个体化 3D/AR 配准和稳定性评估仍属后续
- [ ] 临床验证数据集与评估指标：从演示原型走向可验证研究系统 — [#20](https://github.com/jwj1342/LangerFace/issues/20)
      · 本 PR 已补齐 Stage 1/2 指标、验证集格式、失败分类和 `tools/evaluate_stage2_validation.py`，可把脱敏 `incision-review-record/export` 汇总为候选类型、医生确认率、guardrail 分布、RSTL 偏角、梭形几何误差、敏感距离、失败模式和隐私审计计数；真实病例库和医生统计验证仍需受控临床流程
- [ ] 隐私、合规与审计记录：限定临床研究使用边界 — [#21](https://github.com/jwj1342/LangerFace/issues/21)
      · 本 PR 已更新 README/隐私文档、导出字段边界、provider 配置脱敏、`privacy_audit` 字段和 `tools/audit_export_privacy.py`，可在分享审阅/肿物/诊断 JSON 前拦截原始媒体标记、未脱敏 secret、明显身份字段和疑似嵌入媒体 payload；真实临床访问控制、日志保留、签名和 DPA 仍需合规流程
- [ ] AI 辅助识别自然皱襞、皱纹与肿物边界：作为 RSTL 之外的次级依据 — [#22](https://github.com/jwj1342/LangerFace/issues/22)
- [ ] Epic：手术切口 Agentic 设计——肿物模拟 + RSTL 原则驱动的 LLM 切口规划 — [#64](https://github.com/jwj1342/LangerFace/issues/64)
      · 本 PR 已支持确定性工具链、工具 schema、LLM 摘要、provider 配置、SSE trace 端点、前端流式 trace 可视化、JSON fallback、候选保存/审阅/导出、工程候选比较和隐私守门；多轮自主规划、工具失败恢复和正式审计执行器仍需后续架构拆分

> 设计原则与数据流见 [README《临床目标与 Stage 2 路线》](../README.md#临床目标与-stage-2-路线) 和 [ARCHITECTURE.md#14](ARCHITECTURE.md#14-stage-2-肿物与切口设计技术路线)。
> Stage 2 业务模块作为**同级子包**接入，复用 `geometry` / `detection` / `rendering`，不塞进 `lines/` 或 `rendering/`。

## 暂缓路线

- 肌肉骨骼实时孪生、术中级软组织/肌肉骨骼耦合模拟：当前不属于 Stage 2 切口 Agent 目标。未来如重启，需另开决策 gate，详见 [PRODUCT_BOUNDARIES.md](PRODUCT_BOUNDARIES.md)。
