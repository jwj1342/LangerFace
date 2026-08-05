# TODO / 路线图

本文只列 GitHub 中当前为 open 的 issue；GitHub Issues 是状态真源。`tools/check_todo_issue_sync.mjs`
会比较所有未勾选 issue 链接与仓库 open issue，issue 打开、关闭或重开时由独立 workflow 自动检查。
已完成工作的历史归 PR/issue，本文件不再充当逐 PR changelog。

Stage 1 = 稳定显示并临床校验张力线；Stage 2 = 肿物表达、确定性候选切口、医生审阅和受控叠加。

## 当前产品边界

产品承诺、明确暂缓项与未来重启条件由
[`clinical/PRODUCT_BOUNDARIES.md`](../clinical/PRODUCT_BOUNDARIES.md) 维护；本文只跟踪 open issue 状态。

## 临床出口

- [ ] 临床医生校验线图谱并置 `validated:true`（Stage 1 出口）— [#2](https://github.com/jwj1342/LangerFace/issues/2)
      · 当前 PR 补齐逐线 JSON/CSV、源哈希门禁和结构化签署，并修复标注保存误置 validated/丢失既有线；只有受控临床流程中的医生能完成最终签署。

## 待合并的独立修复 / 功能

- [x] RSTL 局部方向服务 Python/TypeScript parity — [#13](https://github.com/jwj1342/LangerFace/issues/13)
      · Ready PR #121；共享金标覆盖 atlas、低置信、FLAME `points3d` 和 ±180° 轴向 wrap。
      · Ready PR #119；补齐可编辑尖端角、轮廓重算、guardrail 与 provenance。
- [ ] 3D 路线可行性裁决 — [#40](https://github.com/jwj1342/LangerFace/issues/40)
      · Ready PR #122；建议 2D-first + 3D 离线资产/标注/研究预览，等待 #40 owner 正式确认。
- [x] 修复 React 受控输入 snapshot echo — [#109](https://github.com/jwj1342/LangerFace/issues/109)
      · Ready PR #119；Chromium 回归覆盖输入保持。
- [x] 删除 Agentic/Provider 出域路径 — [#111](https://github.com/jwj1342/LangerFace/issues/111)
      · Ready PR #118；保留本地确定性 workflow，不保留 Provider UI、密钥或远程模型请求。
- [x] 统一额头 runtime expansion 契约 — [#112](https://github.com/jwj1342/LangerFace/issues/112)
      · Ready PR #120；Python/TypeScript 共享 fixture 锁定 `disableRuntimeExpansion`。
- [x] 切口与实时工作台控件对比度 — [#115](https://github.com/jwj1342/LangerFace/issues/115)
      · Ready PR #119；浏览器断言锁定 active control ≥ 4.5:1。
- [x] 修复固定名运行时资产被旧 immutable 缓存钉死 — [#135](https://github.com/jwj1342/LangerFace/issues/135)
      · Ready PR #117；改用条件回源并拆分固定名资产与带哈希构建产物的缓存策略。
- [x] 抽离 incision DOM 事件绑定并补齐卸载清理 — [#137](https://github.com/jwj1342/LangerFace/issues/137)
      · Phase 2-A；PR #138 已并入 #131。
- [x] 图谱标注器保存草稿时误置 validated:true 并丢失已加载曲线元数据 — [#139](https://github.com/jwj1342/LangerFace/issues/139)
      · 由 PR #140 修复，含 loaded/drawn 分离与命名唯一性。
- [x] 切口设计界面：生成候选无反应、滑条拖不动 — [#143](https://github.com/jwj1342/LangerFace/issues/143)
      · 与 #109 同源；PR #144 处理。
- [x] 额头张力线单侧缺失：stabilizeForeheadMask 只保留最长可见段 — [#145](https://github.com/jwj1342/LangerFace/issues/145)
      · 两套运行时须一起改，改任一侧都会让 test_forehead_visibility_parity 变红。
- [x] 闭合模拟页按钮对比度与浏览器守卫覆盖 — [#146](https://github.com/jwj1342/LangerFace/issues/146)
      · 等待具体控件/状态截图；修复时把 `/surgery` 纳入半透明背景合成后的 e2e 对比度断言。
- [x] 切口设计迁移到个体化 MediaPipe RSTL，并移除 FLAME 运行时依赖 — [#158](https://github.com/jwj1342/LangerFace/issues/158)
      · PR #159 已合并；切口主输入改为 `/personalized` 交接的个体化 atlas，并保留标准 RSTL 降级与 provenance / warning。
- [x] 统一公开工作流的蓝色临床 UI 主题 — [#160](https://github.com/jwj1342/LangerFace/issues/160)
      · PR #161 已合并；统一 React 路由与迁移页面的主题 token，绿色仅保留成功、在线和证据语义。

## 文档与架构

- [x] 肿物输入模型：支持皮下肿物与皮表肿物的术前约束表达 — [#14](https://github.com/jwj1342/LangerFace/issues/14)
      · 本 PR 已支持中心点、直径/深度/切缘、椭圆/自由轮廓、来源作者、肿物 JSON 导入导出、`tumor_quality` 输入质量摘要，以及自由轮廓点数/面积/自交/中心偏移 guardrails；新版 `boundary_summary` 会随前端导出 `units_per_mm`、`summary_axis` 和 `summary_normal`，审阅记录额外写入 `tumor_boundary_summary`，按保存候选的长轴固化边界点数、长短轴、面积、自交和中心偏移，Markdown 报告会显示“肿物边界摘要”；缺作者、非 mm 单位、缺皮下深度、缺皮表切缘或边界过稀会进入 trace/报告/审阅导出；当前由浏览器 workflow 和 JS 合约测试守住肿物输入、边界摘要、隐私预检和候选 metrics 的自洽性，自动影像分割仍属后续
- [x] 皮下肿物切口生成：按超声直径生成平行 RSTL 的线性切口 — [#15](https://github.com/jwj1342/LangerFace/issues/15)
      · 本 PR 已支持 RSTL 轴向线性候选、端点/长度编辑、目标长度 metrics、最大长度截断记录和直径覆盖不足 high guardrail
- [x] 皮表肿物梭形切口生成器：长轴、比例、尖端角与平滑对称约束 — [#16](https://github.com/jwj1342/LangerFace/issues/16)
      · 已支持边界投影覆盖、面积/自交质量指标、3:1 默认长宽比、cubic Hermite 轮廓、30° 默认尖端角目标和实际误差 metrics；Python `langerface.incision` 与 Web 生成器共用金标，测试覆盖比例、端点角、中点 C1 连续、对称单调收窄、面积和自由轮廓包络；医生可调整梭形宽度、长度、方向、中心和尖端角，系统会重算 outline/envelope 指标、复跑 guardrails，并把尖端角覆盖写入 edit history 与导出 provenance；真实病例曲线调参仍需医生 review
- [x] 敏感结构保护规则：下睑、唇红缘、鼻翼等游离边缘风险提示与方向例外 — [#17](https://github.com/jwj1342/LangerFace/issues/17)
      · 本 PR 已支持敏感区提示、中心点和候选几何到敏感锚点/简化游离缘线段的距离筛查，并按下睑、唇红缘、鼻翼、鼻尖、口角使用 draft 阈值表；命中敏感结构时会输出 `protective_direction` 保护性方向建议并要求医生记录覆盖原因；JS 合约测试会比较 `free_margin_distance_thresholds_mm` 与 `protective_direction_hints`，防止浏览器实现和 JSON 资产不一致；真实解剖边界、阈值和保护性方向仍需临床确认

### 产品化与临床验证

- [x] 移除病例向导与病例存储
      · 当前 `/app` 是无状态研究工具入口，不实现病例大厅、患者档案、病例草稿、历史恢复、本地病例持久化或 Cloudflare 病例 API。实时 2D、个性化 2D、切口候选、图谱标注与闭合演示继续作为独立工具保留。
- [x] 医生审阅与交互编辑工作流：候选切口必须可解释、可修改、可导出 — [#18](https://github.com/jwj1342/LangerFace/issues/18)
      · 本 PR 已支持候选保存、方向备选、工程排序比较、端点拖拽/参数编辑、撤销/重做、编辑时间线状态、候选版本 provenance、`candidate-edit-session/v0.1`、多步 `edit_history`、审阅人、确认/退回/否决、备注、JSON/Markdown/PNG 导出、审计事件、高风险确认备注约束和实时叠加确认门槛；前端“生成备选”会保存浏览器 workflow 生成的 `candidate_alternatives`，保留每个方向备选自己的 guardrails、preview、敏感结构复核和候选比较上下文；编辑后的线性/梭形候选都会重新计算几何、覆盖缺口、梭形包络和 guardrails，审阅状态回到待确认；每条审阅记录会保存 `tumor_quality`、`tumor_boundary_summary`、`sensitive_structure_inspection`、`workflow_trace_gate`、`workflow_plan_audit`、`workflow_execution_events` 和 `candidate_comparison`，报告会显示肿物输入提示、肿物边界摘要、中心点/候选几何敏感结构检查和梭形包络指标，减少 reviewer 只看候选线而漏看输入边界质量或敏感结构观察的风险；正式电子签名、病例系统绑定、权限与锁定仍属临床系统集成
- [x] 照片、视频与 AR 实时叠加：把肿物和切口候选稳定投射到患者脸上 — [#19](https://github.com/jwj1342/LangerFace/issues/19)
      · 本 PR 已支持把已确认候选以 `incision-overlay/v0.1` 暂存到实时页，按三角面重心坐标投射到照片/视频/摄像头 landmarks，并在 overlay 中保留 `review_gate`、`guardrail_summary`、审阅状态和 `raw_image_sent=false` 审计字段；实时页会在存在切口 overlay 时新增“切口候选”放大窗卡片，按肿物中心、边界和候选线联合包围盒裁剪，导出也会录制带 RSTL、肿物和切口的主 canvas；3D Beta 查看器会把同一份候选 overlay 画到扫描出的 MediaPipe 468 重建头上，FLAME 示例脸会通过既有 MediaPipe→FLAME 近邻贴面映射显示研究预览，并把 `incision-overlay-3d-view-diagnostics/v0.1` 写入 diagnostics；`measureIncisionOverlayRegistration` 可对单帧 runtime landmarks 输出 mapped point、候选线点数、退化三角形、出画面点和 bbox 尺寸；实时渲染会用 `incision-overlay-pose-gate/v0.2` 检查低 presence、偏航过大、快速帧间运动、明显张口和眨眼，失败时视频/摄像头主 RSTL 线束和切口候选叠加都会暂停绘制，并启用投影三角面积门槛过滤近共线退化三角；`window.exportLangerfaceDiagnostics()` 会写入 pose gate、registration pass/fail、mapped point count、out-of-frame count 和 bbox diagonal；实时页同步显示“切口叠加 QA”状态，按实际测量结果反馈等待画面、姿态需复核、已投射、投射需复核、抖动需复核或叠加稳定，主质量条也会在 gate 失败时显示“需复核”；`measureIncisionOverlayJitter` 可对静止头部/暂停视频连续帧输出 RMS/P95/max 抖动指标，当前工程门槛为 RMS ≤ 2px、P95 ≤ 4px、max ≤ 8px；实时页还会维护最近 8 帧滚动窗口，把 `incision-overlay-runtime-diagnostics/v0.1` 写入 diagnostics `sections.incision_overlay_runtime`，只导出候选摘要、pose gate、registration、stability、阈值和失败原因，显式标记不导出照片/视频帧、canvas 像素或 landmark 坐标；`tools/audit_incision_overlay_replay.ts` 可读取已脱敏 overlay、三角拓扑和 landmarks 帧数组，离线输出 `incision-overlay-replay-qa/v0.1`，同时保留逐帧 registration 和整体 jitter 证据，并可用 `--csv-output` 导出 summary/逐帧 QA 表格，供 #19 工程复放 QA、reviewer 检查和 #20 汇总脚本消费；新增 `tools/build_incision_overlay_acceptance_evidence.ts` 可把脱敏照片/视频/摄像头 diagnostics、replay QA、webm 导出契约、资源 QA 和浏览器 diagnostics 打包成 `incision-overlay-acceptance-evidence/v0.1`，并拒绝 raw image/video/canvas/landmark payload；`tools/audit_incision_overlay_acceptance.ts` 可把该 evidence 汇总为 `incision-overlay-acceptance-audit/v0.1`，统一检查 #19 四条工程验收标准并报告 local region quality 软复核分布，且不读取原始影像或 landmark 坐标；`tools/test_live_incision_overlay_ui.ts` 锁定照片/视频/摄像头入口共用实时渲染路径、pose gate、registration/stability diagnostics、可见切口叠加 QA、3D overlay 和切口放大窗，`tools/test_pose_quality.ts` 可执行覆盖侧脸、快速运动、张口和眨眼 gate，`tools/test_export_canvas.ts` 真实验证主 canvas `captureStream(30)`、`MediaRecorder`、`video/webm` Blob 和下载文件名契约，`tools/test_live_page_dist_assets.ts` 会构建实时页并用临时 HTTP server 验证首页、bundle、模型、图谱和 3D/FLAME 资产不 404；`window.exportLangerfaceDiagnostics()` 会记录 `runtime.error` / `runtime.unhandledrejection`，用于 preview 检查新增应用级错误；患者个体化临床 AR 配准、真实摄像头阈值标定和正式设备稳定性评估仍属后续
      · #39 增量：实时页新增 `rstl-local-region-quality-gate/v0.1`，在视频/摄像头中对眼眉区中等眨眼或局部快速运动、口周张口或局部快速运动触发局部降透明/断开和“局部复核”反馈；同时 Web 端 landmarks 平滑改为 `MotionStabilizedOneEuro`，先用刚性锚点估计整脸平移中心并单独滤波，再对去中心后的局部形变应用原 One-Euro，以降低快速整脸运动时的高频抖动；`tools/test_motion_stabilized_smoothing.ts` 用合成快速平移序列锁定相对逐点 One-Euro 的 jitter 降幅。local region 信号进入 `incision_overlay_runtime.local_region_quality` diagnostics，平滑策略和参数进入 `incision_overlay_runtime.landmark_smoothing`，均不导出原始帧或 landmarks。真实设备阈值标定、眼眉局部冻结策略的临床可接受性和临床视频集验证仍属后续。
- [x] 临床验证数据集与评估指标：从演示原型走向可验证研究系统 — [#20](https://github.com/jwj1342/LangerFace/issues/20)
      · 本 PR 已补齐 Stage 1/2 指标、验证集格式、失败分类和 `tools/evaluate_stage2_validation.py`，可把脱敏 `incision-review-record/export` 汇总为候选类型、医生确认率、guardrail 分布、RSTL 偏角、梭形几何误差、梭形 outline 面积/对称误差/自由轮廓包络余量与出界点数、敏感距离、`incision-overlay-registration/v0.1` runtime projection QA、`incision-overlay-stability/v0.1` 抖动 RMS/P95/max、`rstl-local-region-quality-gate/v0.1` 局部降可信 active region/action/source/reason、`landmark-motion-stabilized-smoothing/v0.1` 平滑启用率/method/参数分布、`incision-overlay-3d-view-diagnostics/v0.1` 3D 预览 rendered/failure、`incision-overlay-replay-qa/v0.1` 离线复放 QA 与通过率、`overlay_local_region_quality_review` / `overlay_3d_view_failure` 等失败模式和隐私审计计数，并可用 `--csv-output` 导出 reviewer 可读的扁平汇总表；真实病例库和医生统计验证仍需受控临床流程
- [x] 隐私、合规与审计记录：限定临床研究使用边界 — [#21](https://github.com/jwj1342/LangerFace/issues/21)
      · 本 PR 已更新 README/隐私文档、导出字段边界、`privacy_audit` 字段、浏览器 `browser-export-privacy-preflight/v0.1` 和 `tools/audit_export_privacy.py`，可在导出或分享审阅/肿物/诊断 JSON 前拦截原始媒体标记、未脱敏 secret、明显身份字段、电话邮箱模式、疑似嵌入媒体 payload，以及辅助线索越界参与几何的标记；前端 review gate 会阻止未确认、缺 reviewer、高风险无备注或 trace gate 未过的候选标成实时叠加就绪；真实临床访问控制、日志保留、签名和 DPA 仍需合规流程
- [x] AI 辅助识别自然皱襞、皱纹与肿物边界：作为 RSTL 之外的次级依据 — [#22](https://github.com/jwj1342/LangerFace/issues/22)
      · 本 PR 已补齐调研记录、合成 CV 原型、mask/overlay/metrics 导出、precision/recall/IoU 测试，以及 `/app/incision` 低置信辅助线索只读导入/展示；辅助线索会进入审阅导出但 `used_for_geometry=false`，不会自动改变肿物边界或候选切口
- [x] 浏览器本地确定性切口 workflow
      · `planIncisionWorkflow()` 固定执行肿物质量、面部分区、RSTL 查询、敏感结构检查、线性/梭形候选生成、guardrails、面部预览、`-10° / 0° / +10°` 方向备选和 `compare_candidates` 工程排序；前端展示工具 trace、`incision-workflow-trace-gate/v0.1`、`incision-workflow-plan-audit/v0.1`、`incision-workflow-execution-events/v0.1`、`incision-workflow-audit/v0.1` 和候选比较。运行时不包含远程模型、模型密钥或自主规划；工具门控未通过时不能确认候选。

> 设计原则与数据流见 [README《临床目标与 Stage 2 路线》](../../README.md#临床目标与-stage-2-路线) 和 [ARCHITECTURE.md#14](../architecture/ARCHITECTURE.md#14-stage-2-肿物与切口设计技术路线)。
> Stage 2 业务模块作为**同级子包**接入，复用 `geometry` / `detection` / `rendering`，不塞进 `lines/` 或 `rendering/`。

## 维护 / 部署

- [ ] 清理 Vercel 历史 Deployment，保持 GitHub / Vercel UI 只突出 `master` production 和当前远端 branch head
      · 2026-06-26 已完成 GitHub Deployments records 清理：从 309 条降到 44 条，保留 37 条 Production 和 7 条当前远端 branch HEAD Preview。Vercel 侧已确认实际项目为 team `team_hKrCHY2HEmfQcq5Jfs8sYznn`、project `prj_IZ6vLQva5NQtCU3DfYNNaOWRzZM2`（本地 `web/.vercel/project.json` 里的旧 `orgId/projectId` 不匹配当前 token 可访问项目）。Vercel 初始 dry-run 为 311 条，计划保留 37 条 production + 7 条 branch-head preview，删除 267 条旧 preview/canceled deployment；第一轮已删除 203 条，1 条已提前删除，随后触发 `now-rm` 429 限流（约 10 分钟 / 200 次 remove），第二轮在用户要求暂停时中断。下次继续前不要复用旧删除列表，先重新 list deployments、重新按 production + branch-head 规则 dry-run，再删除剩余旧 preview。不要把 Vercel 删除动作放进 CI；清理完成后撤销本次暴露过的 Vercel token。

## 暂缓路线

- 肌肉骨骼实时孪生、术中级软组织/肌肉骨骼耦合模拟：当前不属于 Stage 2 切口 workflow 目标。未来如重启，需另开决策 gate，详见 [PRODUCT_BOUNDARIES.md](../clinical/PRODUCT_BOUNDARIES.md)。
- [x] 合并重复文档、修正内容 owner 并自动核对 TODO 状态 — [#113](https://github.com/jwj1342/LangerFace/issues/113)
      · 当前 PR；删除专题重复页，把标注验收、FLAME 切口资产、纹理 warp 和产品边界归回各自 owner。
- [ ] Phase 2：消化大型 runtime，推进核心 TypeScript 服务化 — [#95](https://github.com/jwj1342/LangerFace/issues/95)
      · 长期 epic；当前栈已清除 Web `.js` runtime、React 生命周期转发层和全部 TypeScript suppression，并由架构测试防回流。剩余工作是继续拆分仍偏大的 runtime / God Object，抽离 scene、export、picking、command validation、edit history 与 review records。
