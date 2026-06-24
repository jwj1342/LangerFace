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
- [ ] RSTL 局部方向服务：为切口设计提供方向、置信度与可解释依据 — [#13](https://github.com/jwj1342/LangerFace/issues/13)
      · 本 PR 已支持 atlas weighted-nearest 查询、support count、低置信度提示、JS/Python 对拍和无向轴角离散度，避免 179°/-179° 边界误降置信度；临床级 atlas 质量与个体头模一致性仍待医生校验
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

### 产品化与临床验证

- [ ] 医生审阅与交互编辑工作流：候选切口必须可解释、可修改、可导出 — [#18](https://github.com/jwj1342/LangerFace/issues/18)
      · 本 PR 已支持候选保存、方向备选、端点拖拽/参数编辑、审阅人、确认/退回/否决、备注、JSON/Markdown/PNG 导出和审计事件；正式电子签名、病例系统绑定、权限与锁定仍属临床系统集成
- [ ] 照片、视频与 AR 实时叠加：把肿物和切口候选稳定投射到患者脸上 — [#19](https://github.com/jwj1342/LangerFace/issues/19)
- [ ] 临床验证数据集与评估指标：从演示原型走向可验证研究系统 — [#20](https://github.com/jwj1342/LangerFace/issues/20)
- [ ] 隐私、合规与审计记录：限定临床研究使用边界 — [#21](https://github.com/jwj1342/LangerFace/issues/21)
- [ ] AI 辅助识别自然皱襞、皱纹与肿物边界：作为 RSTL 之外的次级依据 — [#22](https://github.com/jwj1342/LangerFace/issues/22)

> 设计原则与数据流见 [README《临床目标与 Stage 2 路线》](../README.md#临床目标与-stage-2-路线) 和 [ARCHITECTURE.md#14](ARCHITECTURE.md#14-stage-2-肿物与切口设计技术路线)。
> Stage 2 业务模块作为**同级子包**接入，复用 `geometry` / `detection` / `rendering`，不塞进 `lines/` 或 `rendering/`。

## 暂缓路线

- 肌肉骨骼实时孪生、术中级软组织/肌肉骨骼耦合模拟：当前不属于 Stage 2 切口 Agent 目标。未来如重启，需另开决策 gate，详见 [PRODUCT_BOUNDARIES.md](PRODUCT_BOUNDARIES.md)。
