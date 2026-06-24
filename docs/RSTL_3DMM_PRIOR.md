# Borges RSTL 与 3DMM 拓扑先验

本文对应 issue [#86](https://github.com/jwj1342/LangerFace/issues/86)，记录 Borges RSTL 来源、当前标准脸草案资产、3DMM 注册边界和与 #2/#13/#61 的衔接。

## 医学来源与定义

- 当前面部主图谱采用 RSTL（relaxed skin tension lines）作为面部切口方向的第一参考。
- 来源口径沿用 Borges / Borges & Alexander 对面部 RSTL 的经典描述：活体放松状态下的皮肤张力线比尸体 Langer 裂线更适合作为面部切口方向参考。
- 本仓库不把 Borges 图谱扫描件、论文图片或受版权限制的原图提交到公开资产；只保存程序化方向场和医生可复核的拓扑绑定结果。
- RSTL 不是自动手术方案。敏感游离缘、病理边界、皮肤松弛度、可直接拉拢闭合等因素必须由医生复核。

## 当前资产状态

| 资产 | 拓扑 | 格式 | 状态 | 用途 |
| --- | --- | --- | --- | --- |
| `web/assets/atlas_rstl.json` | `mediapipe-468` | `lines[].points = [tri,u,v]` | `validated:false` | Stage 1/2 的标准脸 RSTL 草案和 #13 方向服务输入 |
| `assets/rstl_mediapipe_direction_prior.json` | `mediapipe-468` | 每个三角面中心的方向向量 / 置信度 / provenance | `validated:false` | 高密度方向场审阅资产，供 #13 方向服务和 #86 3DMM 先验注册对照 |
| `web/assets/atlas_langer.json` | `mediapipe-468` | `lines[].points = [tri,u,v]` | `validated:false` | Langer 对照 / 教学，不作为面部主切口方向 |
| `assets/rstl_3dmm_prior_manifest.json` | 多拓扑 manifest | JSON | `draft_not_clinically_validated` | 记录来源、拓扑、生成脚本和临床校验闸 |
| FLAME/BFM RSTL atlas | `flame-2023` / BFM | 待生成 `[tri,u,v]` | pending | #61 3DMM 标注/迁移轨后续资产 |

## Provenance 要求

每份 RSTL / Langer / 3DMM 先验资产必须包含或能追溯：

- `topologyId` 与 `topologyVersion`。
- `system`：`rstl` 或 `langer`。
- `validated:false`，直到医生按 #2 完成逐线校验。
- 生成脚本、规则版本、来源说明、生成日期或 commit。
- 适用范围和低置信区域说明，尤其是前额、耳周、侧脸和表情形变区域。

## 高密度方向场草案

`tools/build_rstl_direction_prior.py` 会从当前 `assets/atlas_rstl.json` 读取 RSTL 流线，在
`canonical_face_model.obj` 的每个三角面中心查询 weighted-nearest 局部方向，并输出
`assets/rstl_mediapipe_direction_prior.json`。这份资产包含：

- `topologyId:"mediapipe-468"` 和 `topologyVersion:"mediapipe-canonical-468-v1"`。
- `sample_kind:"triangle_centroid_direction"`，当前覆盖 898 个标准脸三角面。
- 每个样本的 `vector`、`angle_deg`、`confidence`、`support_count` 和 `angular_spread_deg`。
- `validated:false`、`review_status:"draft_not_clinically_validated"` 和生成脚本。

这不是新的临床真值，也不是 FLAME/BFM 图谱本体。它的作用是把现有 RSTL 草案变成可审阅、
可版本管理的高密度方向场中间资产：医生可以按 #2 复核低置信区域，#13 可以用同一套
confidence / support 语义对齐方向服务，#86 后续把同类结构注册到 FLAME/BFM 时也有明确的
provenance 和拓扑边界可对照。

## 与 #13 的衔接

#13 的局部方向服务只消费确定性资产。当前实现会读取 `atlas_rstl.json`，输出：

- `angle_deg` / `vector`
- `confidence`
- `source`
- `support_count`
- `angular_spread_deg`

当查询点远离 atlas 支撑点或方向 spread 过大时，必须返回低置信度并要求医生确认，而不是硬凑方向。

## 与 #61 的衔接

FLAME 轨保持与 MediaPipe 轨独立：

- MediaPipe atlas 不能直接喂给 FLAME 拓扑。
- FLAME 标准头上的医生标注应导出 `topologyId:"flame-2023"` 的独立 atlas。
- 同一 FLAME 拓扑下，标准头到个体头迁移使用 `[tri,u,v]` 重心坐标不变性。
- FLAME/BFM 资产不得在未授权情况下提交到公开仓库。

## 与 #2 的临床校验闸

任何图谱草案只有在医生逐线校验、修正、记录校验者和时间后，才允许置 `validated:true`。本 PR 不改变现有资产的校验状态；所有当前 RSTL/3DMM 先验仍是 `validated:false` 或 `draft_not_clinically_validated`。
