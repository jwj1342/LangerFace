# 个性化 RSTL（`/personalized`）：输入、阈值依据、失败降级与边界

本文是 `/personalized` 浏览器个性化 RSTL 流程的单一可审计说明：它吃什么输入、每个阈值为什么是这个值、
失败时怎么降级、隐私边界在哪、产出的图谱遵守什么契约。代码入口 `web/personalized.html` +
`web/compat/personalized/`；模型来源与许可见
[`web/compat/personalized/model/NOTICE.md`](../../web/compat/personalized/model/NOTICE.md) 与
[MODEL_CARD.md](../../web/compat/personalized/model/MODEL_CARD.md)。

> ⚠️ 与全项目一致的边界：这里产出的是**个体皮纹线证据驱动的图谱草案**（`validated:false`），
> 是决策辅助可视化，不是手术指令，也不是临床验证过的个体化 RSTL。

## 1. 为什么要个性化

标准 RSTL 图谱（`assets/atlas_rstl.json`，当前 v8.1.67 / 133 条 / 14,315 点 / `topologyId: mediapipe-468`）
是**标准脸**上的先验。重心坐标映射能让它随身份和表情形变，但它不知道**这个人**的皱纹实际长在哪里。
个性化的目标就是：用本人可观测的皱纹证据，在**受约束的范围内**把标准线往真实皮纹上拉一点，
而不是重新生成一套线。

## 2. 输入

| 输入 | 来源 | 说明 |
|---|---|---|
| 静息基线帧 | 浏览器摄像头 | 提供中性态几何与光照基线 |
| 7 个表情动作 | 用户按引导做 | `raise_brows / frown / squint / smile / puff / purse / open_mouth`，每个动作**默认只采一轮** |
| MediaPipe 468 关键点 + blendshapes | `@mediapipe/tasks-vision` | 动作检测、配准、质量门控 |
| 皱纹分割掩膜 | 本地 YOLOv8s-seg ONNX | 逐表情推理，`confidence = 0.07` |
| 标准 RSTL 图谱 | `web/assets/atlas_rstl.json` | 被微调的先验，不被替换 |

工作分辨率 `SIZE = 320`（几何/掩膜），纹理 `TEXTURE_SIZE = 640`（YOLO 输入 640×640）。

## 3. 阈值与依据

阈值分三层：**动作是否算做到了** → **这一轮采集是否可用** → **证据能否改变曲线**。

### 3.1 动作启动阈值（blendshape，相对静息）

`raise_brows 0.18 / frown 0.13 / squint 0.18 / smile 0.22 / puff 0.06 / purse 0.08 / open_mouth 0.18`

不是统一值，因为 MediaPipe 各通道灵敏度差别很大：`browDown`（皱眉）在前置手机摄像头上系统性偏弱，
`cheekPuff`（鼓腮）在很多摄像头上几乎不触发。`frown / puff / purse` 因此归入 `TIMED_ACTIONS`：
点击开始后按计时完成，不靠 blendshape 卡门，是否接收交给下面的质量门控判断。
这条设计刻意避免"用户明明做了动作却一直卡在阈值前"。

### 3.2 采集质量门控（按动作分档）

阈值不是一套，而是三档；`squint` / `frown` 因为动作本身会压低 MediaPipe 的跟踪与光照评分而放宽：

| 门控 | 默认（`QUALITY_THRESHOLDS`） | `squint` | `frown` |
|---|---|---|---|
| `tracking` | ≥ 0.62 | ≥ 0.50 | ≥ 0.50 |
| `illumination` | ≥ 0.55 | ≥ 0.40 | ≥ 0.45 |
| `minPeakFrames` | = 4（见下） | = 4 | = 4 |
| 配准残差上限（占脸尺度） | 0.018 | 0.018 | 0.025（`smile` 为 0.030） |

单轮采集靠**质量门控**保证可用性，而不是靠重复多轮取平均——重复轮次会显著拉长采集时间，
却主要在补偿"用户没做到动作"，而这一点用门控判断更直接。

两个**必须知道的例外**，否则会误判这套门控的强度：

- **`returnConsistency`（动作后能否回到静息）目前只被记录，不拦截。** 常量里写着 0.58，但唯一调用点
  `personalized.js` 在三个分支里都把它覆写成 `returnConsistency: 0`，而 `prstl_pipeline.js` 用严格
  小于判定，所以该项永不触发。真正拦头动的是上表最后一行的**配准残差上限**
  （`REGISTRATION_RESIDUAL_LIMIT_FACE_RATIO`）。若要恢复拦截，改的是那三处覆写而不是常量。
- **`frown` 的表情信号门被硬编码为通过**：皱眉走计时采集，视觉信号只当证据强度，不作采集资格门槛。
- **有效帧数不是「≥ N」而是「恰好 4」，且由聚合阶段而非门控决定**：`aggregateCycleEvidence()` 用
  `pickBestFrames(..., 4)` 选帧（该函数最多返回 k 帧），不足 4 帧直接抛「有效峰值帧不足 4 帧」；
  这发生在动作专用门控**之前**，所以门控看到的 `validPeakFrames` 恒为 4。历史上 squint / frown 的配置
  写着 3，那是永不生效的死值，已统一为 4。若将来真要允许 3 帧，必须改的是聚合阶段（让它读动作专用阈值），
  并补一条「恰好 3 帧」的回归测试——只改门控常量不会有任何效果。

### 3.3 皱纹检测阈值：YOLO `confidence = 0.07`

刻意取低阈值换**高召回**：该模型在浏览器摄像头单帧、无专业光照的输入分布上置信度整体偏低，
漏检的皱纹无法在下游补回来，而误检可以被下游约束筛掉。代价是误检偏多，因此后面必须叠：

- **严格并集融合**（`fuseStrictUnion`）：对各表情的**清洗后语义分割区域**取并集，
  并记录每像素 `support`（多少个表情支持）、方向 `q` 与方向一致性。
  注意这里 union 的是掩膜而**不是**逐表情骨架——先骨架化再并集会丢掉大部分可用证据，
  骨架化由 V6 在融合之后统一做一次。
- **皮肤域硬约束 + 禁区掩膜**：眼口、毛发等禁区内的点直接判 `occluded`，不参与个性化。

### 3.4 证据能否改变曲线：V6 微调（`interval-guarded-continuous-polyline-rstl-refinement-6.0`）

按脸尺寸归一化的比例参数（`*_FACE_RATIO`，乘以人脸尺度得到像素阈值）：

| 参数 | 值 | 作用 |
|---|---|---|
| `MAX_DISPLACEMENT_FACE_RATIO` | 0.020 | 单点最大位移上限 |
| `SEARCH_FACE_RATIO` | 0.030 | 沿法向搜索皱纹脊的范围 |
| `P90_FACE_RATIO` | 0.010 | 区间级 P90 位移保护（局部而非整条线） |
| `TRANSITION_FACE_RATIO` | 0.020 | 有证据段与无证据段之间的过渡长度，保证 C0 连续 |
| `SOFT_LINK_FACE_RATIO` | 0.013 | 软连接相邻证据段 |
| `PARALLEL_DEDUP_FACE_RATIO` | 0.006 | 平行线去重，避免两条线被同一皱纹吸到重合 |
| `DIRECTION_TOLERANCE_DEGREES` | 40° | 证据方向与原切线夹角容差，超出不采纳 |
| `SOFT_LINK_TURN_DEGREES` | 35° | 软连接允许的最大转折 |
| `REFINE_CONF` | 0.22 | 逐点标 `refined` 所需的最小证据置信度 |

设计要点：**位移是受约束的、逐区间的、可解释的**。每个点最终被分类成
`refined`（有证据）/ `prior`（无证据，回退标准线）/ `occluded`（禁区或非皮肤），
并逐点记录证据来源，供审阅时区分"这段线动了因为看到皱纹"与"这段线只是标准先验"。

## 4. 失败降级

流程的每一层都必须能单独失败而不毁掉整个页面：

| 失败点 | 降级行为 |
|---|---|
| 摄像头权限被拒 / 打开失败 | 提示原因，`/personalized` 不进入采集，不影响其它页面 |
| 某个动作用户做不出来 | 可「跳过本步」；该动作不提供证据，相关区域回退先验 |
| 单轮质量门控不通过 | 该轮不被接收，不污染证据 |
| ONNX 模型加载失败 / SHA-256 不匹配 | 抛错并提示，不产出个性化结果；标准图谱仍可用 |
| 某表情推理失败 | 该表情不进入严格并集，其余表情证据照常融合 |
| 某点无证据或落在禁区 | 该点标 `prior` / `occluded`，保持标准线位置 |
| 整条线证据不足（`evidenceOk=false`） | 整条线回退先验，只保留遮挡标记 |
| `sessionStorage` 不可用 | 预览图谱暂存失败并提示，不静默丢数据 |
| 预览图谱解析失败 | 实时端返回 `null` 并回退内置图谱，绝不因坏数据中断启动 |

## 5. 隐私边界

- 摄像头帧、YOLO 推理、严格并集融合、V6 微调**全部在当前浏览器本地完成**，不上传服务器，无推理后端。
- **不写入** `localStorage` / `IndexedDB` 任何患者衍生数据（图像、线条、掩膜、审阅记录）。
  `localStorage` 只用于非患者配置（资产 base URL、Provider URL/model/timeout）。
- 跨页只经 `sessionStorage` 的 `langerface.previewAtlas` 传一次性预览图谱，
  `takePreviewAtlas()` **读取即删**，关标签页即清；不形成病例、档案或历史记录。
- 人脸调试视频录制（静息与每个表情每轮的视频 + 同步关键点）**默认关闭**；勾选后还需一次显式同意，
  只留在当前标签页内存中，可点「丢弃调试录制」立即清除，`pagehide` 时回收 Blob URL。
- 用户主动点下载导出的 JSON / 视频由用户自己保管；不要把它们提交进仓库，见
  [PRIVACY_AND_AUDIT.md](../clinical/PRIVACY_AND_AUDIT.md)。

## 6. 图谱契约

个性化输出仍是标准 langerface 图谱信封，因此能被实时页直接消费：

- `system: "rstl"`、`topologyId: "mediapipe-468"`、`topologyVersion: "mediapipe-canonical-468-v1"`，
  每点 `[tri, u, v]`（`w = 1-u-v`）。
- `validated: false` 恒定：个性化只改几何、不改校验状态，不代表任何临床复核结论。
- 注入实时页时仍走 `validateAtlas()` 的拓扑身份校验：拓扑不匹配的图谱不会被静默渲染（#65 守卫）。
- FLAME（`topologyId: "flame-2023"`）图谱与本流程**互不通用**，不能交叉注入。

## 7. 相关文档

- [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) — 重心坐标映射、坐标系、资产与部署
- [METHODS_AND_IMPLEMENTATION_SUMMARY.md](../architecture/METHODS_AND_IMPLEMENTATION_SUMMARY.md) — 数学推导集中参考
- [WRINKLE_LESION_CUES.md](../clinical/WRINKLE_LESION_CUES.md) — 皱襞 / 皱纹 / 病灶边界作为 secondary cue 的调研（#22）
- [PRIVACY_AND_AUDIT.md](../clinical/PRIVACY_AND_AUDIT.md) — 敏感数据边界与禁止提交项
- [MODEL_CARD.md](../../web/compat/personalized/model/MODEL_CARD.md) / [NOTICE.md](../../web/compat/personalized/model/NOTICE.md) — 权重来源、许可未确认状态与使用边界
