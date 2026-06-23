# TODO / 路线图

待办与 [GitHub Issues](https://github.com/jwj1342/LangerFace/issues) 同步。
Stage 1 = 稳定显示张力线（当前）；Stage 2 = 肿物模拟 + 切口候选设计。

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

### 肿物与切口候选生成

- [ ] 肿物输入模型：支持皮下肿物与皮表肿物的术前约束表达 — [#14](https://github.com/jwj1342/LangerFace/issues/14)
- [ ] 皮下肿物切口生成：按超声直径生成平行 RSTL 的线性切口 — [#15](https://github.com/jwj1342/LangerFace/issues/15)
- [ ] 皮表肿物梭形切口生成器：长轴、比例、尖端角与平滑对称约束 — [#16](https://github.com/jwj1342/LangerFace/issues/16)
- [ ] 敏感结构保护规则：下睑、唇红缘、鼻翼等游离边缘风险提示与方向例外 — [#17](https://github.com/jwj1342/LangerFace/issues/17)

### 产品化与临床验证

- [ ] 医生审阅与交互编辑工作流：候选切口必须可解释、可修改、可导出 — [#18](https://github.com/jwj1342/LangerFace/issues/18)
- [ ] 照片、视频与 AR 实时叠加：把肿物和切口候选稳定投射到患者脸上 — [#19](https://github.com/jwj1342/LangerFace/issues/19)
- [ ] 临床验证数据集与评估指标：从演示原型走向可验证研究系统 — [#20](https://github.com/jwj1342/LangerFace/issues/20)
- [ ] 隐私、合规与审计记录：限定临床研究使用边界 — [#21](https://github.com/jwj1342/LangerFace/issues/21)
- [ ] AI 辅助识别自然皱襞、皱纹与肿物边界：作为 RSTL 之外的次级依据 — [#22](https://github.com/jwj1342/LangerFace/issues/22)

> 设计原则与数据流见 [README《临床目标与 Stage 2 路线》](../README.md#临床目标与-stage-2-路线) 和 [ARCHITECTURE.md#14](ARCHITECTURE.md#14-stage-2-肿物与切口设计技术路线)。
> Stage 2 业务模块作为**同级子包**接入，复用 `geometry` / `detection` / `rendering`，不塞进 `lines/` 或 `rendering/`。
