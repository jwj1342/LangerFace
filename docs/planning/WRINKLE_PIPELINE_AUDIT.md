# 皱纹检测 checkpoint、肤色偏移与代码收敛任务

本文定义皱纹检测链路的 P0 审计与收敛工作：从一张照片进入系统开始，追踪到最终绘制在脸上的皱纹线，明确每个 checkpoint、非学习算法、融合规则和输出门禁，并给出删除重复实现前必须满足的验收条件。本文是整改任务定义，不代表当前模型已经通过跨肤色验证。

## 负责人和完成定义

- **DRI（直接负责人）：`mingzhen`**
- **优先级：P0**
- **当前状态：未完成；checkpoint 完整性校验不等于来源、许可或公平性验证完成**
- **完成定义：** `mingzhen` 能用一个版本化 manifest 和一张端到端链路图回答“这张照片经过了哪些模型/规则、用了哪个确切权重、为什么输出了这些皱纹线”，并把非现行实现删除或隔离到明确的研究目录；跨肤色与成像条件的分层指标达到预先登记的 gate 后，才能关闭本任务。

## 核心问题

当前界面把能力概括为“V10 四区域检测”，但最终结果并不是由一个叫“V10”的 checkpoint 单独生成。现行单帧链路同时依赖：

1. 浏览器 YOLOv8s-seg ONNX checkpoint；
2. 服务端 FFHQ-Wrinkle U-Net checkpoint；
3. 光照校正、Hessian/paired-edge/Frangi、方向先验、形态学和骨架化；
4. YOLO baseline 与新候选的融合规则；
5. 四区域非空约束和眉间区域的候选恢复；
6. 如用户应用自动微调，还会继续经过标准 RSTL 先验、V9 7.2 微调和拓扑门禁。

因此，“到底是哪个权重”目前没有单数答案。checkpoint 文件存在 hash 只能证明加载的是预期字节，不能证明训练数据来源完整、许可有效，也不能证明不同肤色上的误差一致。尤其是浏览器 YOLO 的训练数据、样本量、肤色构成和标注规程均未知；它却是 V10 的 baseline 输入，而未被替换的 baseline 会保留到最终融合结果。

## 当前 checkpoint 台账

| 角色 | 当前资产 / hash | 已知来源 | 当前用途 | 必须补齐的证据 |
|---|---|---|---|---|
| 浏览器 baseline 分割 | `web/compat/personalized/model/wrinkle-yolov8s-seg-640.onnx.part00..03`；拼接后 SHA-256 `4BB6ECD9C5FDDDDF1A4559813FB40293F6AE552EA1287912219157B91408A744` | 第三方 `Wrinkle-Detection-StreamLit/best.pt` 经 ultralytics 8.4.98 导出；上游无 LICENSE | 浏览器以 640×640、阈值 0.07 生成 `forehead/frown/wrinkle` mask，再提取 baseline 中心线 | 上游仓库精确 URL 与 commit、原始 `best.pt` hash、训练数据/人群分布/标注协议、训练配置、许可、按肤色和成像条件分层指标 |
| V10 语义分割 | `assets/models/wrinkle_unet_patient_finetuned.pth`；SHA-256 `e301b8f70c8239c01504a0616b61acdf9ab9b5796f513d6e7294d4fa52b6a6c2` | 本地 FFHQ-Wrinkle Stage 2 U-Net 基础权重继续微调；文档记录 850/150 split、512 输入、最佳验证 Dice 0.6304 | 原始 RGB 与 Hessian texture 组成 4 通道输入，概率阈值 0.35；与传统线索和解剖区域共同筛选/新增候选 | 基础 checkpoint hash 与取得位置、训练代码 commit、样本 ID split、数据包 hash、随机种子、完整超参数、逐肤色/曝光/设备指标和许可复核 |
| TinyDexiNed 研究入口 | 默认 `local_outputs/wrinkle_edge_model.pth`，不随仓库分发、无发布 hash | `tools/train_wrinkle_edge_model.py` 本地训练 | 只被 `tools/predict_wrinkle_masks.py` 使用，不属于现行 live 路径 | 明确删除、归档或升级为受支持实验；不得与当前 V10 checkpoint 淵称“当前权重” |

权重说明的现有来源是 [`assets/models/README.md`](../../assets/models/README.md)、[`MODEL_CARD.md`](../../web/compat/personalized/model/MODEL_CARD.md) 和 [`NOTICE.md`](../../web/compat/personalized/model/NOTICE.md)。本任务要求把它们收敛成一个机器可读、由 CI 校验的 manifest；文档不再分别手写容易漂移的版本与 hash。

## 一张照片到最终皱纹线的现行链路

| 阶段 | 输入 → 输出 | 现行实现 | 审计重点 |
|---|---|---|---|
| 1. 取帧与人脸几何 | 上传照片或冻结视频帧 → 最大 1280 的黑底正方形 RGBA 工作帧、MediaPipe 468 点、标准 RSTL seeds | `web/src/services/liveWrinkleAnalysis.ts` | 原始分辨率、缩放/填充、方向、颜色空间、相机/曝光信息是否记录；黑边不得进入肤色或阈值统计 |
| 2. 浏览器 YOLO | RGBA → RGB `[0,1]`、640 letterbox → 三类 mask | `web/src/services/personalized/yoloWrinkleOnnx.ts` | 无颜色校准、白平衡或曝光归一化；0.07 低阈值会扩大分布外噪声 |
| 3. baseline 中心线 | YOLO mask → 清理、骨架化、最短长度门禁 → baseline lines | `web/src/services/personalized/fineWrinkleLines.ts`、`web/src/workers/liveWrinklePipeline.worker.ts` | baseline 必须非空才能继续；逐类误检和拒绝原因必须可观测 |
| 4. V10 请求 | 同一工作帧 + 468 点 + YOLO baseline → V10 provider | `web/src/workers/liveWrinklePipeline.worker.ts`、`web/src/services/personalized/wrinkleV10Provider.ts` | 请求必须绑定图像 hash、两个 checkpoint hash、代码 commit 和全部有效参数 |
| 5. 四区域融合 | 工作帧 → 额头、眉间、鼻背、鱼尾纹候选 | `tools/run_live_four_region_wrinkle.py` → `tools/run_wrinkle_paired_edge_experiment.py` → `tools/run_wrinkle_fine_line_experiment.py` / `tools/run_wrinkle_four_class_experiment.py` | U-Net、传统算子和实验脚本之间的真实依赖必须显式化；生产入口不应继续依赖以 `experiment` 命名的多代文件 |
| 6. 后处理与响应 | paired-edge 候选 + YOLO baseline → `fusedLines` → 四区域中心线 JSON | `tools/run_wrinkle_paired_edge_experiment.py`、`tools/run_live_four_region_wrinkle.py` | 未被 replacement 替换的 YOLO baseline 当前直接保留；眉间少于两条时会从 rejected 候选恢复；任一区域为空会报错。这些规则会改变不同人群的假阳性、失败率和展示偏差 |
| 7. 浏览器显示 | 四区域 JSON → evidence lines → 叠加到照片 | `web/src/workers/liveWrinklePipeline.worker.ts`、`web/src/services/liveWrinkleAnalysis.ts` | UI 必须区分“检测到的皱纹”与“由皱纹引导移动的 RSTL”，并显示模型/规则版本及不确定性 |
| 8. 可选 RSTL 微调 | 除鼻背外的 evidence + 标准 seeds → V9 7.2 微调；鼻背直接构造 RSTL → 拓扑/交叉门禁 | `web/src/services/personalized/v6RstlRefinementV9.ts`、`directNoseDorsumRstl.ts` | 这一步输出是个体化 RSTL，不是皱纹标注；不得把两者的指标或临床含义混为一谈 |

必须为每次检测保存不含原始人脸的可审计 trace：代码 commit、checkpoint manifest 版本、两个模型 hash、输入与派生数据 hash、预处理参数、每阶段候选/拒绝计数、最终每条线的来源（YOLO 保留、传统/语义新增、恢复候选）和失败/弃权原因。

## 为什么 checkpoint 不明确会表现为肤色偏移

“checkpoint 不明确”不是肤色偏移的唯一直接原因，但它让数据偏差、成像偏差和后处理偏差无法定位或复现。当前最需要验证的机制如下；这些是基于代码的风险假设，不是已经完成的因果证明。

1. **训练分布不可审计。** YOLO 训练人群完全未知；U-Net 只有总 Dice，没有按客观肤色、设备、曝光或光照分层的指标。无法判断误差来自数据缺口还是推理/后处理。
2. **光学与预处理耦合。** 皮肤中的黑色素会改变可见光反射与局部对比度，摄像头自动曝光、白平衡、gamma、压缩和高光又会非线性改变细纹信噪比。浏览器 YOLO 只做 RGB `/255` 和 letterbox；U-Net 使用原图与推理时 Hessian texture，并没有与训练过程一致的颜色/曝光标准化。
3. **区域内相对归一化会放大噪声。** paired-edge 路径按每个解剖区域的分位数把响应拉伸后再阈值化。低信噪比区域也总会有“最强的一批像素”，所以阴影、毛发、压缩纹理或高光边缘可能被抬升成候选。
4. **方向先验和形态学会把噪声组织成看似合理的线。** 方向加权、闭运算和骨架化可以把零散响应连接成符合额纹/眉间纹形状的中心线，使错误在视觉上更可信。
5. **融合和非空规则会保留或制造系统性差异。** YOLO baseline 不是逐条重新通过绝对证据门禁；眉间恢复会重新接纳 rejected 候选；四区域必须非空会把“没有证据”变成整次失败，而不是可解释的弃权。不同肤色/曝光组合因此可能分别表现为过检、漏检或失败率升高。

公平性审计应使用客观皮肤色阶/反射或受控色卡信息，而不是让模型从照片推断种族。必须同时记录光照、曝光、白平衡、设备和图像压缩；同一受试者在受控成像条件下的重复拍摄是区分“肤色”与“拍摄条件”影响的关键对照。不得把合成换肤色当作唯一验证数据。

## 代码库收敛范围

当前不是简单的“两份等价代码”，而是现行混合运行时外加多代兼容/研究入口：

| 类别 | 现状 | 收敛要求 |
|---|---|---|
| 现行 live 混合路径 | Worker 中先跑浏览器 YOLO，再调用 Python V10；Python live 入口继续 import `run_wrinkle_*_experiment.py` | 抽出稳定的 `wrinkle_runtime` 核心包；live、CLI 和 benchmark 只做薄适配，共享同一配置和 manifest |
| 旧的 YOLO-only 通用路径 | `web/src/services/personalized/liveWrinklePipeline.ts` 已不被 live 页面调用，但仍被测试和“latest pipeline”校验脚本直接执行 | 把仍有价值的纯函数测试迁到现行 Worker/core；随后删除该并行 pipeline，避免测试验证的是非生产代码 |
| compatibility 单图实验 | `web/compat/personalized/wrinkleRstlExperiment.ts` 与多代 `run_wrinkle_rstl_experiment_v*.mjs` 用于历史复放 | 移入明确的 `experiments/` 边界，冻结 manifest；不得从生产运行时 import，也不得在 UI 中误称当前实现 |
| Python 多代实验 | `run_wrinkle_four_class_experiment.py`、`run_wrinkle_fine_line_experiment.py`、`run_wrinkle_paired_edge_experiment.py` 同时承担实验与生产依赖 | 按“模型加载、预处理、候选生成、融合、序列化”拆分稳定模块；每个算法只保留一个权威实现，实验只覆盖参数/策略 |
| TinyDexiNed 与其他原型 | 训练/预测入口仍可被发现，但不属于发布路径 | 有有效研究 owner 和基准则隔离保留，否则删除；所有非发布入口必须显式标记 `research_only` |

不得先删除 YOLO 或 U-Net 中任意一个，再宣称“偏差已修复”。`mingzhen` 应先做模型与后处理消融：YOLO-only、U-Net-only、传统-only、现行融合、去除 baseline 直通、去除眉间恢复，分别比较总体与分层误差，再依据证据确定唯一发布方案。

## `mingzhen` 的交付清单

- [ ] 画出并评审“照片 → 工作帧/landmarks → YOLO → V10/U-Net/传统线索 → fusion → 最终皱纹 overlay → 可选 RSTL 微调”的唯一链路图，标明数据是否离开浏览器。
- [ ] 新增机器可读 checkpoint manifest；CI 同时校验来源、hash、许可状态、预处理契约、训练/评估数据版本和代码 commit，运行时只从 manifest 读取版本信息。
- [ ] 对每条最终线记录 provenance；禁止无法解释来源的 baseline 直通和 rejected-candidate 恢复。
- [ ] 允许区域输出为空并返回 calibrated uncertainty / abstention，分别统计过检、漏检和失败率。
- [ ] 建立受控验证集和预登记 gate：按客观肤色、设备、光照、曝光分层报告 line precision/recall、Dice 或 clDice、每 ROI 假线数、空结果率、失败率和置信校准；同时报告最差组，不只报告总体均值。
- [ ] 完成 YOLO/U-Net/传统/融合及关键后处理的消融，给出保留哪个检测器和哪些规则的证据。
- [ ] 把现行 Python runtime 从多代 `experiment` 文件抽出；删除或隔离 YOLO-only、compat、TinyDexiNed 和旧版本 runner，更新依赖图与测试。
- [ ] 补回归测试：两个 checkpoint hash/manifest 不匹配立即失败；低证据区域可以弃权；最终输出不要求四区域强制非空；每条线都有可序列化 provenance。
- [ ] 更新 [`PERSONALIZED_RSTL.md`](../tracks/PERSONALIZED_RSTL.md)、[`WRINKLE_LESION_CUES.md`](../clinical/WRINKLE_LESION_CUES.md)、模型卡、部署说明和根 README，使“当前路径”和“研究路径”只有一个一致说法。

## 合并与发布 gate

在上述工作完成前，产品和文档不得声称“已解决不同肤色偏移”或把现有总体验证分数外推到任一肤色组。任何替换 checkpoint 的 PR 必须同时提交 manifest 变更、来源/许可证据、训练与评估数据版本、分层回归结果和可回滚方案；只替换二进制文件或只更新 hash 不可合并。
