# TODO / 路线图

待办与 [GitHub Issues](https://github.com/jwj1342/LangerFace/issues) 同步。
Stage 1 = 稳定显示张力线（当前）；Stage 2 = 肿物模拟 + 切口设计。

## Stage 1 收尾
- [ ] 临床医生校验线图谱并置 `validated:true`（Stage 1 真正出口）— [#2](https://github.com/jwj1342/LangerFace/issues/2)
      · 现可用[网页 3D 标注](ARCHITECTURE.md#12-网页-3d-线标注与图谱校验)在标准脸上直接产出图谱格式

## 增强
- [ ] 通用外部遮挡：语义分割识别器械 / 纱布 / 口罩 — [#3](https://github.com/jwj1342/LangerFace/issues/3)
- [ ] 3D：非刚性配准、网格导出（.obj/.glb）、3D 投影叠加手部遮挡 — [#4](https://github.com/jwj1342/LangerFace/issues/4)
- [ ] 录制 / 导出完善（含放大窗与 3D）— [#5](https://github.com/jwj1342/LangerFace/issues/5)

## Stage 2（规划）
- [ ] 肿物模拟：新增 `src/langerface/tumor/`、`web/tumor*.js`——表示病灶位置 / 边界 / 大小 / 深度与皮肤表面关系，作为切口规划的约束输入。
- [ ] 切口设计：新增 `src/langerface/incision/`、`web/incision*.js`——综合张力线方向、肿物边界、安全边距与医生编辑，生成候选切口可视化（只做决策辅助，不输出手术指令）。

> 设计原则与数据流见 [README《系统模块与数据流》](../README.md#系统模块与数据流) 和 [ARCHITECTURE.md](ARCHITECTURE.md)。
> 这两个 Stage 2 业务模块作为**同级子包**接入，复用 `geometry` / `detection` / `rendering`，不塞进 `lines/` 或 `rendering/`。
