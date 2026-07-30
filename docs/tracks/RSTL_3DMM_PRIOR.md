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
| `rstl_mediapipe_direction_prior.json`（远端资产或 `local_outputs/` 本地生成） | `mediapipe-468` | 每个三角面中心的方向向量 / 置信度 / provenance | `validated:false` | 高密度方向场审阅资产，供 #13 方向服务和 #86 3DMM 先验注册对照；大 JSON 不提交进仓库 |
| `web/assets/atlas_langer.json` | `mediapipe-468` | `lines[].points = [tri,u,v]` | `validated:false` | Langer 对照 / 教学，不作为面部主切口方向 |
| `assets/rstl_3dmm_prior_manifest.json` | 多拓扑 manifest | JSON | `draft_not_clinically_validated` | 记录来源、拓扑、生成脚本和临床校验闸 |
| FLAME/BFM RSTL atlas | `flame-2023` / BFM | 待生成 `[tri,u,v]` | pending | #61 3DMM 标注/迁移轨后续资产 |
| FLAME RSTL direction prior | `flame-2023` | dev-local triangle centroid direction field | pending / `validated:false` | `tools/build_flame_rstl_direction_prior.py` 可在本地 FLAME 资产就位后生成，产物位于 gitignored `local_outputs/rstl_flame_direction_prior.json` |
| BFM/custom 3DMM RSTL direction prior | `bfm-local` / 自定义 3DMM | dev-local triangle centroid direction field | pending / `validated:false` | `tools/build_3dmm_rstl_direction_prior.py` 可读取授权本地拓扑和 neutral vertices，默认输出到 gitignored `local_outputs/rstl_3dmm_direction_prior.json` |
| FLAME/BFM review packet | `flame-2023` / BFM | `rstl-3dmm-review-packet/v0.1` | `draft_not_clinically_validated` | `tools/build_rstl_3dmm_review_packet.py` 从方向先验抽样生成医生审阅包，产物位于 gitignored `local_outputs/rstl_3dmm_review_packet.json` |
| FLAME/BFM review-applied prior | `flame-2023` / BFM | `rstl-3dmm-reviewed-direction-prior/v0.1` | `validated:false` | `tools/apply_rstl_3dmm_review_packet.py` 把医生审阅包回填到草案方向场，产物位于 gitignored `local_outputs/rstl_3dmm_reviewed_direction_prior.json` |

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
`local_outputs/rstl_mediapipe_direction_prior.json`。这份资产是大 JSON，仓库只提交
`assets/rstl_3dmm_prior_manifest.json` 中的 remote/generated 契约；需要浏览器或审阅流程消费时，应把同名
`rstl_mediapipe_direction_prior.json` 上传到配置的资产 Base URL，或在本地运行脚本生成。资产包含：

- `topologyId:"mediapipe-468"` 和 `topologyVersion:"mediapipe-canonical-468-v1"`。
- `sample_kind:"triangle_centroid_direction"`，当前覆盖 898 个标准脸三角面。
- 每个样本的 `vector`、`angle_deg`、`confidence`、`support_count` 和 `angular_spread_deg`。
- `validated:false`、`review_status:"draft_not_clinically_validated"` 和生成脚本。

这不是新的临床真值，也不是 FLAME/BFM 图谱本体。它的作用是把现有 RSTL 草案变成可审阅、
可版本管理的高密度方向场中间资产：医生可以按 #2 复核低置信区域，#13 可以用同一套
confidence / support 语义对齐方向服务，#86 后续把同类结构注册到 FLAME/BFM 时也有明确的
provenance 和拓扑边界可对照。

## FLAME / 通用 3DMM 方向先验生成器

`tools/build_flame_rstl_direction_prior.py` 会读取 `local_outputs/rstl_mediapipe_direction_prior.json`、`web/assets/topology_flame_2023.json` 和 `web/assets/flame_neutral_vertices.json`，在 FLAME neutral mesh 的每个三角形质心上生成一个 dev-local 方向样本。默认输出是 `local_outputs/rstl_flame_direction_prior.json`，该路径被 gitignore，不会把 FLAME 衍生资产提交到仓库。

```bash
python tools/build_rstl_direction_prior.py --generated-at now
python tools/export_flame_topology.py
python tools/build_flame_rstl_direction_prior.py --generated-at now
```

该生成器只是 MediaPipe 草案方向场到 FLAME 拓扑的 bbox-aligned nearest-neighbor review scaffold，输出 schema 为 `rstl-3dmm-direction-prior/v0.1`，仍保持 `validated:false`。它不是 Borges 原图的正式 FLAME/BFM 注册，也不是临床可用 atlas；真实可关闭 #86 的 FLAME/BFM 图谱仍需要 #61 的本地资产流程、医生在 FLAME/BFM 标准头上的逐线审核，以及 #2 的临床校验出口。

如果目标不是 FLAME，而是授权本地 BFM 或其他 3DMM neutral mesh，可以使用通用入口。该入口要求显式传入目标拓扑和顶点文件，并把 `target_model_name`、`target_topology_path`、`target_vertices_path` 写入 provenance：

```bash
python tools/build_3dmm_rstl_direction_prior.py \
  --target-topology local_outputs/topology_bfm_local.json \
  --target-vertices local_outputs/bfm_neutral_vertices.json \
  --target-name bfm \
  --output local_outputs/rstl_bfm_direction_prior.json \
  --generated-at now
```

通用入口与 FLAME 入口共用同一套 `rstl-3dmm-direction-prior/v0.1` schema 和置信度规则。它只解决“本地授权 3DMM 拓扑可生成可审阅方向场”的工程接口问题，不解决临床注册、个体化迁移或医生校验问题；这些仍然归 #61、#2 和 #13 后续规则服务处理。

## FLAME/BFM 医生审阅包

`tools/build_rstl_3dmm_review_packet.py` 会读取 `validated:false` 的方向先验，生成
`rstl-3dmm-review-packet/v0.1` 审阅包。默认输入是
`local_outputs/rstl_mediapipe_direction_prior.json`，默认输出是 gitignored
`local_outputs/rstl_3dmm_review_packet.json`；当本地 FLAME 方向先验可用时，也可以显式传入
`local_outputs/rstl_flame_direction_prior.json`。

```bash
python tools/build_rstl_3dmm_review_packet.py \
  --prior local_outputs/rstl_flame_direction_prior.json \
  --csv-output default \
  --generated-at now
```

审阅包会优先抽取低置信度、高方向离散度、空间极值和均匀覆盖样本，并为每个样本保留：

- `tri` / `bary` / `point` / `vector` / `angle_deg` 等拓扑和方向字段。
- `confidence`、`angular_spread_deg`、`support_count` 和 `priority_reasons`。
- `clinician_review` 占位字段：`decision`、`reviewer`、`reviewed_at`、`region_label`、`direction_accepted`、`corrected_angle_deg`、`corrected_vector`、`notes`。

可选 `--csv-output` 会同时写出可放进表格工具的审阅表，默认路径为 gitignored
`local_outputs/rstl_3dmm_review_packet.csv`。CSV 保留 `review_id`、sample index、tri、point、vector、angle、confidence、
priority reasons 和上述 clinician review 待填字段，方便医生逐项填写；JSON 审阅包仍是回填工具的审计输入，CSV 不会把任何资产置为 `validated:true`。

这一步只把草案方向先验变成可分发、可抽查、可回填的医生审阅任务包。它不会把任何方向置为
`validated:true`，也不能替代正式 FLAME/BFM 标准头逐线标注、医生审核和临床校验。

## 审阅回填应用

医生在审阅包里填写 `clinician_review` 后，可以用
`tools/apply_rstl_3dmm_review_packet.py` 把 `accepted`、`corrected`、`rejected` 和 `pending`
决策应用到一个新的草案方向先验中。默认输入是 gitignored 的
`local_outputs/rstl_3dmm_review_packet.json`，默认输出是 gitignored 的
`local_outputs/rstl_3dmm_reviewed_direction_prior.json`：

```bash
python tools/apply_rstl_3dmm_review_packet.py \
  --prior local_outputs/rstl_flame_direction_prior.json \
  --packet local_outputs/rstl_3dmm_review_packet.json \
  --generated-at now
```

如果医生是在表格里填写审阅结果，可以把上一步导出的 CSV 作为 decision overlay 输入；脚本会按
`review_id` 或 `source_sample_index` 把 CSV 中的 `decision`、`reviewer`、`reviewed_at`、
`region_label`、`direction_accepted`、`corrected_angle_deg`、`corrected_vector` 和 `notes`
覆盖到 JSON 审阅包对应条目，然后继续走同一套拓扑、sample index、tri 和 review 状态校验：

```bash
python tools/apply_rstl_3dmm_review_packet.py \
  --prior local_outputs/rstl_flame_direction_prior.json \
  --packet local_outputs/rstl_3dmm_review_packet.json \
  --review-csv default \
  --generated-at now
```

CSV 只是医生审阅决策的表格输入层，不能单独替代 JSON 审阅包；输出会记录
`source_review_csv`、`review_application.decision_source` 和 `review_application.csv_overlay`，方便追溯哪些
行来自表格回灌。

输出 schema 为 `rstl-3dmm-reviewed-direction-prior/v0.1`，并保留：

- `review_application`：reviewed / accepted / corrected / rejected / pending 计数、reviewer 计数、校正和拒绝样本索引。
- `applied_reviews`：每条已应用审阅的 sample index、tri、decision、reviewer、reviewed_at、是否改向量、是否 excluded。
- `samples[*].clinician_review`：接受、校正或拒绝的原始审阅元数据。

校正方向可以使用 `corrected_vector`，也可以使用 `corrected_angle_deg` 生成单位方向向量；拒绝项会标记
`excluded_from_reviewed_prior=true`，不会被静默删除。该工具仍强制输出 `validated:false` 和
`draft_not_clinically_validated`，所以它只是审阅回填记录，不是临床验证出口。

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

## 自动审计

`tools/audit_rstl_3dmm_prior.py` 会检查 `assets/rstl_3dmm_prior_manifest.json` 的拓扑、`validated:false`、`draft_not_clinically_validated`、remote/generated 大资产边界和 FLAME/BFM pending 边界。它的目标不是证明 #86 已经完成临床注册，而是防止草案方向场、MediaPipe atlas 与 FLAME/BFM pending 资产被误表达为已验证图谱或误提交为仓库内置大 JSON。

```bash
python tools/audit_rstl_3dmm_prior.py --json
```
