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
      · 本 PR 已把实时页导出从单一主画布升级为组合录制：主 canvas 仍作为主体，右侧可附带当前可见的全脸/切口候选/区域细节放大窗和 3D 视图，输出仍为 `video/webm`；没有附加画布时保持原主画布 `captureStream` 行为。

## Stage 2：肿物与切口设计

临床目标：把标准 RSTL / 皱襞 / 美学亚单位边界迁移到患者脸上，在医生输入肿物信息后，生成可解释、可编辑、可审阅的候选切口。系统只做决策辅助，不输出手术指令。

### 临床知识与几何基础

- [ ] 结构化面部皮纹线与切口设计原则，形成可版本管理的临床规则库 — [#11](https://github.com/jwj1342/LangerFace/issues/11)
      · 本 PR 已提供 `assets/clinical_rules_face_incision.json`，包含 RSTL 首选、自然皱襞/美学亚单位次级、敏感游离缘例外、皮下/皮表策略、区域规则、provenance 和 `draft_not_clinically_validated` 状态；新增 `tools/audit_clinical_rules.py` 与前端 JS 对拍，守住资产、Python 默认规则和浏览器默认规则的版本、长度/梭形参数、guardrail 阈值与保护性方向 hint 不漂移
- [ ] 面部分区与美学亚单位定位：把人脸点位映射到临床区域 — [#12](https://github.com/jwj1342/LangerFace/issues/12)
      · 本 PR 已覆盖额部、耳周、颞颊、上下睑、内眦、鼻背/鼻翼/鼻尖、鼻唇沟、颊部、唇红、上唇、口角、颏部和下颌缘，并输出 `confidence_reasons` 与 `region_boundary_margin_norm`；前端在肿物点位选择时会实时显示当前分区、亚单位、置信度和敏感游离缘/规则边界提示；真实 MediaPipe/FLAME 分区边界和侧脸/表情稳定性仍待后续临床校验
- [ ] RSTL 局部方向服务：为切口设计提供方向、置信度与可解释依据 — [#13](https://github.com/jwj1342/LangerFace/issues/13)
      · 本 PR 已支持 atlas weighted-nearest 查询、support count、无向轴角离散度、JS/Python 对拍和结构化 `confidence_reasons`；atlas 为空、最近支持点过远、支持点过少或邻域角度冲突会进入 trace、候选 provenance、前端方向依据、guardrail 文案和报告；前端会区分 RSTL atlas、敏感结构方向例外、辅助线索只读和医生人工覆盖；临床级 atlas 质量与个体头模一致性仍待医生校验
- [ ] Borges RSTL 3DMM 拓扑先验：数字化经典图谱并注册到 FLAME/BFM 标准网格 — [#86](https://github.com/jwj1342/LangerFace/issues/86)
      · 本 PR 已新增 `rstl_mediapipe_direction_prior.json`，作为 MediaPipe 标准脸高密度方向场草案，并新增 `tools/audit_rstl_3dmm_prior.py` 自动审计 manifest / direction prior 的拓扑、`validated:false`、样本数量、单位向量、置信度范围和 FLAME/BFM pending 边界；`tools/build_flame_rstl_direction_prior.py` 可在本地 FLAME 资产就位后生成 gitignored 的 `rstl-3dmm-direction-prior/v0.1` dev-local 方向场；`tools/build_rstl_3dmm_review_packet.py` 可把草案方向先验抽样成 `rstl-3dmm-review-packet/v0.1` 医生审阅包，覆盖低置信度、高方向离散度、空间极值和均匀覆盖样本，并可额外导出 gitignored CSV 表格，保留 reviewer / decision / corrected direction / notes 等待填字段；`tools/apply_rstl_3dmm_review_packet.py` 可直接应用 JSON 审阅包，也可用 `--review-csv` 把医生表格结果按 `review_id` / sample index 回灌到 JSON packet 后再生成 gitignored 的 `rstl-3dmm-reviewed-direction-prior/v0.1` 草案，并保留 reviewer、reviewed_at、校正向量、decision source、CSV overlay 计数和 rejected excluded 标记；正式 FLAME/BFM 注册仍待 #61 资产与医生标注

### 肿物与切口候选生成

- [ ] 肿物输入模型：支持皮下肿物与皮表肿物的术前约束表达 — [#14](https://github.com/jwj1342/LangerFace/issues/14)
      · 本 PR 已支持中心点、直径/深度/切缘、椭圆/自由轮廓、来源作者、肿物 JSON 导入导出、`tumor_quality` 输入质量摘要，以及自由轮廓点数/面积/自交/中心偏移 guardrails；新增 `tools/audit_tumor_input.py` 可离线审计 `tumor-input/v0.2` 或 raw tumor JSON，检查 schema、单位、作者/深度/切缘提示、边界 summary 一致性和 raw media 隐私标记；缺作者、非 mm 单位、缺皮下深度、缺皮表切缘或边界过稀会进入 trace/报告/审阅导出；自动影像分割仍属后续
- [ ] 皮下肿物切口生成：按超声直径生成平行 RSTL 的线性切口 — [#15](https://github.com/jwj1342/LangerFace/issues/15)
      · 本 PR 已支持 RSTL 轴向线性候选、端点/长度编辑、目标长度 metrics、最大长度截断记录和直径覆盖不足 high guardrail
- [ ] 皮表肿物梭形切口生成器：长轴、比例、尖端角与平滑对称约束 — [#16](https://github.com/jwj1342/LangerFace/issues/16)
      · 本 PR 已支持边界投影覆盖、面积/自交质量指标、3:1 默认长宽比、cubic Hermite 轮廓、30° 默认尖端角目标和实际误差 metrics；真实病例曲线调参仍需医生 review
- [ ] 敏感结构保护规则：下睑、唇红缘、鼻翼等游离边缘风险提示与方向例外 — [#17](https://github.com/jwj1342/LangerFace/issues/17)
      · 本 PR 已支持敏感区提示、中心点和候选几何到敏感锚点/简化游离缘线段的距离筛查，并按下睑、唇红缘、鼻翼、鼻尖、口角使用 draft 阈值表；命中敏感结构时会输出 `protective_direction` 保护性方向建议并要求医生记录覆盖原因；新增规则 drift 审计会比较 `free_margin_distance_thresholds_mm` 与 `protective_direction_hints`，防止 Python/前端实现和 JSON 资产不一致；真实解剖边界、阈值和保护性方向仍需临床确认

### 产品化与临床验证

- [ ] 医生审阅与交互编辑工作流：候选切口必须可解释、可修改、可导出 — [#18](https://github.com/jwj1342/LangerFace/issues/18)
      · 本 PR 已支持候选保存、方向备选、工程排序比较、端点拖拽/参数编辑、撤销/重做、编辑时间线状态、候选版本 provenance、`candidate-edit-session/v0.1`、多步 `edit_history`、审阅人、确认/退回/否决、备注、JSON/Markdown/PNG 导出、审计事件、高风险确认备注约束和实时叠加确认门槛；新增 `tools/audit_incision_review_gate.py` 可离线审计 `review_gate`、`live_overlay_ready`、高风险备注、审阅人和 `agent_trace_gate` 是否自洽；正式电子签名、病例系统绑定、权限与锁定仍属临床系统集成
- [ ] 照片、视频与 AR 实时叠加：把肿物和切口候选稳定投射到患者脸上 — [#19](https://github.com/jwj1342/LangerFace/issues/19)
      · 本 PR 已支持把已确认候选以 `incision-overlay/v0.1` 暂存到实时页，按三角面重心坐标投射到照片/视频/摄像头 landmarks，并在 overlay 中保留 `review_gate`、`guardrail_summary`、审阅状态和 `raw_image_sent=false` 审计字段；实时页会在存在切口 overlay 时新增“切口候选”放大窗卡片，按肿物中心、边界和候选线联合包围盒裁剪，导出也会录制带 RSTL、肿物和切口的主 canvas；3D Beta 查看器会把同一份候选 overlay 画到扫描出的 MediaPipe 468 重建头上，FLAME 示例脸会通过既有 MediaPipe→FLAME 近邻贴面映射显示研究预览，并把 `incision-overlay-3d-view-diagnostics/v0.1` 写入 diagnostics；`measureIncisionOverlayRegistration` 可对单帧 runtime landmarks 输出 mapped point、候选线点数、退化三角形、出画面点和 bbox 尺寸，并把 registration pass/fail、mapped point count、out-of-frame count 和 bbox diagonal 写入 `window.exportLangerfaceDiagnostics()`；实时页同步显示“切口叠加 QA”状态，按实际测量结果反馈等待画面、已投射、投射需复核、抖动需复核或叠加稳定；`measureIncisionOverlayJitter` 可对静止头部/暂停视频连续帧输出 RMS/P95/max 抖动指标，当前工程门槛为 RMS ≤ 2px、P95 ≤ 4px、max ≤ 8px；实时页还会维护最近 8 帧滚动窗口，把 `incision-overlay-runtime-diagnostics/v0.1` 写入 diagnostics `sections.incision_overlay_runtime`，只导出候选摘要、registration、stability、阈值和失败原因，显式标记不导出照片/视频帧、canvas 像素或 landmark 坐标；`tools/audit_incision_overlay_replay.mjs` 可读取已脱敏 overlay、三角拓扑和 landmarks 帧数组，离线输出 `incision-overlay-replay-qa/v0.1`，同时保留逐帧 registration 和整体 jitter 证据，并可用 `--csv-output` 导出 summary/逐帧 QA 表格，供 #19 工程复放 QA、reviewer 检查和 #20 汇总脚本消费；新增 `tools/build_incision_overlay_acceptance_evidence.mjs` 可把脱敏照片/视频/摄像头 diagnostics、replay QA、webm 导出契约、资源 QA 和浏览器 diagnostics 打包成 `incision-overlay-acceptance-evidence/v0.1`，并拒绝 raw image/video/canvas/landmark payload；`tools/audit_incision_overlay_acceptance.mjs` 可把该 evidence 汇总为 `incision-overlay-acceptance-audit/v0.1`，统一检查 #19 四条工程验收标准且不读取原始影像或 landmark 坐标；`tools/test_live_incision_overlay_ui.mjs` 锁定照片/视频/摄像头入口共用实时渲染路径、registration/stability diagnostics、可见切口叠加 QA、3D overlay 和切口放大窗，`tools/test_export_canvas.mjs` 真实验证主 canvas `captureStream(30)`、`MediaRecorder`、`video/webm` Blob 和下载文件名契约，`tools/test_live_page_dist_assets.mjs` 会构建实时页并用临时 HTTP server 验证首页、bundle、模型、图谱和 3D/FLAME 资产不 404；`window.exportLangerfaceDiagnostics()` 会记录 `runtime.error` / `runtime.unhandledrejection`，用于 preview 检查新增应用级错误；患者个体化临床 AR 配准和真实摄像头稳定性评估仍属后续
- [ ] 临床验证数据集与评估指标：从演示原型走向可验证研究系统 — [#20](https://github.com/jwj1342/LangerFace/issues/20)
      · 本 PR 已补齐 Stage 1/2 指标、验证集格式、失败分类和 `tools/evaluate_stage2_validation.py`，可把脱敏 `incision-review-record/export` 汇总为候选类型、医生确认率、guardrail 分布、RSTL 偏角、梭形几何误差、敏感距离、`incision-overlay-registration/v0.1` runtime projection QA、`incision-overlay-stability/v0.1` 抖动 RMS/P95/max、`incision-overlay-3d-view-diagnostics/v0.1` 3D 预览 rendered/failure、`incision-overlay-replay-qa/v0.1` 离线复放 QA 与通过率、`overlay_3d_view_failure` 等失败模式和隐私审计计数，并可用 `--csv-output` 导出 reviewer 可读的扁平汇总表；真实病例库和医生统计验证仍需受控临床流程
- [ ] 隐私、合规与审计记录：限定临床研究使用边界 — [#21](https://github.com/jwj1342/LangerFace/issues/21)
      · 本 PR 已更新 README/隐私文档、导出字段边界、provider 配置脱敏、`privacy_audit` 字段和 `tools/audit_export_privacy.py`，可在分享审阅/肿物/诊断 JSON 前拦截原始媒体标记、未脱敏 secret、明显身份字段、疑似嵌入媒体 payload，以及辅助线索越界参与几何或 Agent prompt 的标记；`tools/audit_incision_review_gate.py` 额外检查审阅导出不会把未确认、缺 reviewer、高风险无备注或 trace gate 未过的候选标成实时叠加就绪；真实临床访问控制、日志保留、签名和 DPA 仍需合规流程
- [ ] AI 辅助识别自然皱襞、皱纹与肿物边界：作为 RSTL 之外的次级依据 — [#22](https://github.com/jwj1342/LangerFace/issues/22)
      · 本 PR 已补齐调研记录、合成 CV 原型、mask/overlay/metrics 导出、precision/recall/IoU 测试，以及 `incision_agent.html` 低置信辅助线索只读导入/展示；辅助线索会进入审阅导出但 `used_for_geometry=false`、`used_for_agent_prompt=false`，不会自动改变肿物边界或候选切口
- [ ] Epic：手术切口 Agentic 设计——肿物模拟 + RSTL 原则驱动的 LLM 切口规划 — [#64](https://github.com/jwj1342/LangerFace/issues/64)
      · 本 PR 已支持确定性工具链、工具 schema、LLM 摘要、provider 配置、SSE trace 端点、SSE `execution_event` / `trace_gate` / `react_plan` 事件、前端流式 trace、Agent 执行事件和 ReAct 计划步骤可视化、JSON fallback、`agent-trace-gate/v0.1` 工具门控、`agent-react-plan/v0.1` 可审计步骤计划、`agent-execution-events/v0.1` 可复放执行事件、后端 `-10° / 0° / +10°` 方向备选、`preview_incision_on_face` 面部预览观察、`compare_candidates` 工程排序、`agent-orchestration-audit/v0.1`、`agentic-incision-session/v0.1` 多轮医生反馈 session scaffold、`agent-session-candidate-evolution/v0.1` 跨轮候选演化 summary、`session_evolution` SSE 事件、`agent-session-audit/v0.1`、离线 `agentic-incision-trace-audit/v0.1` 审计执行器、`agentic-llm-boundary-audit/v0.1` LLM 摘要/Provider 边界审计、候选保存/审阅/导出和隐私守门；`tests/test_incision_agent.py` 已用 transient / persistent synthetic variant failure 覆盖确定性候选生成失败后的 `retry_tool_failure`、有界重试成功、`recover_tool_failure`、失败变体跳过、剩余候选继续比较、每个成功候选预览和执行事件计数，并覆盖医生反馈修正肿物输入后的两轮 session 重跑和候选长度/guardrail/comparison score delta；`tests/test_agentic_incision_audit.py` 会读取 agent plan / session / review export，重放 trace gate、ReAct plan、执行事件、候选比较、预览、重试和恢复失败计数，并检查 LLM 摘要是否保留医生复核边界、是否出现可直接执行类手术指令、是否夹带 raw provider payload、provider/API key 是否已脱敏；`tests/test_incision_agent_server.py` 会真实启动本地 `--no-llm` 代理，覆盖 JSON / SSE / session JSON / session SSE HTTP 路径、API key 脱敏、execution_event、trace gate、ReAct plan 事件、候选比较、session evolution 和 session audit；`tools/test_slurm_qwen_agent.mjs` 会静态锁定 L40S Slurm 脚本的 GPU 申请、Qwen 默认模型、vLLM OpenAI-compatible 服务、health gate、Agent provider 环境变量和端口转发提示；工具门控要求 trace 包含肿物输入质量、面部分区、RSTL 查询、确定性切口生成、guardrails 和面部预览，未通过时不能确认候选；开放式长程自主规划和跨阶段复杂失败恢复仍需后续架构拆分

> 设计原则与数据流见 [README《临床目标与 Stage 2 路线》](../README.md#临床目标与-stage-2-路线) 和 [ARCHITECTURE.md#14](ARCHITECTURE.md#14-stage-2-肿物与切口设计技术路线)。
> Stage 2 业务模块作为**同级子包**接入，复用 `geometry` / `detection` / `rendering`，不塞进 `lines/` 或 `rendering/`。

## 暂缓路线

- 肌肉骨骼实时孪生、术中级软组织/肌肉骨骼耦合模拟：当前不属于 Stage 2 切口 Agent 目标。未来如重启，需另开决策 gate，详见 [PRODUCT_BOUNDARIES.md](PRODUCT_BOUNDARIES.md)。
