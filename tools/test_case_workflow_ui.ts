const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("src/App.tsx", "utf8");
const dashboard = fs.readFileSync("src/routes/DashboardRoute.tsx", "utf8");
const caseRoute = fs.readFileSync("src/routes/CaseWorkflowRoute.tsx", "utf8");
const settingsRoute = fs.readFileSync("src/routes/SettingsRoute.tsx", "utf8");
const clinicalFacePreview = fs.readFileSync("src/components/ClinicalFacePreview.tsx", "utf8");
const managedRoute = fs.readFileSync("src/components/ManagedWorkbenchRoute.tsx", "utf8");
const incisionRoute = fs.readFileSync("src/routes/IncisionRoute.tsx", "utf8");
const liveRoute = fs.readFileSync("src/routes/LiveRoute.tsx", "utf8");
const annotateRoute = fs.readFileSync("src/routes/AnnotateRoute.tsx", "utf8");
const surgeryRoute = fs.readFileSync("src/routes/SurgeryRoute.tsx", "utf8");
const workbenchLayout = fs.readFileSync("src/components/WorkbenchLayout.tsx", "utf8");
const legacyWorkbenchCopy = [
  fs.readFileSync("src/routes/IncisionWorkbench.tsx", "utf8"),
  fs.readFileSync("src/routes/LiveWorkbench.tsx", "utf8"),
  fs.readFileSync("src/routes/SurgeryWorkbench.tsx", "utf8"),
  fs.readFileSync("src/routes/AnnotateWorkbench.tsx", "utf8"),
  fs.readFileSync("src/components/IncisionStagePanel.tsx", "utf8"),
  fs.readFileSync("src/components/SurgeryStagePanel.tsx", "utf8"),
  fs.readFileSync("src/components/AnnotateStagePanel.tsx", "utf8"),
  fs.readFileSync("src/components/ProviderConfigPanel.tsx", "utf8"),
].join("\n");
const dataSource = fs.readFileSync("src/services/dataSource.ts", "utf8");
const caseStore = fs.readFileSync("src/stores/caseStore.ts", "utf8");
const styles = fs.readFileSync("src/styles.css", "utf8");
const visualCapture = fs.readFileSync("../tools/capture_case_workflow_visual.ts", "utf8");

assert.ok(app.includes('path="/cases"'), "React Router exposes the clinical case lobby");
assert.ok(app.includes('path="/case/:caseId/evaluate"'), "React Router exposes the case evaluation step");
assert.ok(app.includes('path="/case/:caseId/plan"'), "React Router exposes the case planning step");
assert.ok(app.includes('path="/case/:caseId/review"'), "React Router exposes the case review step");
assert.ok(app.includes('path="/settings/atlas"'), "React Router exposes atlas settings route");
assert.ok(app.includes('path="/settings/developer"'), "React Router exposes developer settings route");
assert.ok(app.includes("SettingsRoute"), "React Router loads the dedicated settings route");
assert.ok(app.includes('<SettingsRoute section="atlas"'), "atlas settings renders the settings route instead of redirecting");
assert.ok(app.includes('<SettingsRoute section="developer"'), "developer settings renders the settings route instead of redirecting");
assert.ok(!app.includes('to="/annotate" replace'), "atlas settings must not immediately redirect to the 3D annotation tool");
assert.ok(!app.includes('to="/three-preview" replace'), "developer settings must not immediately redirect to the R3F preview");

assert.ok(dashboard.includes("面部松弛皮肤张力线智能切口设计系统"), "case lobby uses the clinician-facing product name");
assert.ok(dashboard.includes("病例大厅"), "case lobby replaces the technical landing copy");
assert.ok(dashboard.includes("工作台大厅"), "case lobby includes a product landing surface");
assert.ok(dashboard.includes("case-lobby-landing"), "case lobby renders a dedicated landing section");
assert.ok(dashboard.includes("case-lobby-stage"), "case lobby includes a dark clinical viewport preview");
assert.ok(dashboard.includes("ClinicalFacePreview"), "case lobby reuses the high-fidelity clinical face preview component");
assert.ok(dashboard.includes("case-workflow-roadmap"), "case lobby shows the clinical workflow roadmap");
assert.ok(dashboard.includes('to="/case/new"'), "case lobby routes new cases through the preflight setup page");
assert.ok(!dashboard.includes("const createCase"), "case lobby does not bypass preflight setup by creating a case directly");
assert.ok(dashboard.includes("系统设置"), "case lobby keeps maintenance entry points in system settings");
assert.ok(!dashboard.includes("兼容 / 研发工具"), "case lobby no longer exposes compatibility tools in the doctor sidebar");
assert.ok(!dashboard.includes("开发 / 诊断信息"), "case lobby no longer exposes developer diagnostics in the doctor sidebar");
for (const route of ["/incision", "/live", "/annotate", "/three-preview", "/surgery"]) {
  assert.ok(!dashboard.includes(`to="${route}"`), `case lobby must not link directly to compatibility route ${route}`);
}
assert.ok(!dashboard.includes("CASE_STORE_BOUNDARY_NOTE"), "case lobby keeps implementation state boundary notes out of the doctor sidebar");

assert.ok(settingsRoute.includes("图谱库管理"), "settings route exposes atlas library management");
assert.ok(settingsRoute.includes("开发者诊断"), "settings route exposes developer diagnostics");
assert.ok(settingsRoute.includes("面部松弛皮肤张力线智能切口设计系统"), "settings route keeps the clinician-facing system name");
assert.ok(settingsRoute.includes("SettingsSidebar"), "settings route owns a dedicated settings navigation shell");
assert.ok(settingsRoute.includes("SettingsHero"), "settings route owns a dedicated settings landing surface");
assert.ok(settingsRoute.includes("ProviderConfigPanel"), "developer settings contains the AI service connection panel");
assert.ok(settingsRoute.includes("WorkerStatusPanel"), "developer settings contains worker diagnostics after removing them from the doctor lobby");
assert.ok(settingsRoute.includes('to="/annotate"'), "atlas settings keeps the annotation tool as a controlled entry");
assert.ok(settingsRoute.includes('to="/three-preview"'), "developer settings keeps the 3D preview as a controlled entry");
assert.ok(settingsRoute.includes('to="/surgery"'), "developer settings keeps the standalone closure demo as a controlled entry");
assert.ok(settingsRoute.includes('workspace: "settings"'), "settings route publishes settings workspace lifecycle state");
assert.ok(settingsRoute.includes("不进入医生的病例规划主流程"), "settings route explains atlas work is outside the doctor workflow");
assert.ok(settingsRoute.includes("不应重新出现在医生主导航"), "developer settings explains compatibility tools stay hidden from main navigation");

assert.ok(caseRoute.includes("患者年龄"), "case workflow collects patient age");
assert.ok(caseRoute.includes("CaseNewSetupRoute"), "case workflow renders a dedicated new-case setup route");
assert.ok(caseRoute.includes("caseNewSetup"), "new-case setup route exposes a stable visual/test anchor");
assert.ok(caseRoute.includes("新建病例：前置参数"), "new-case route collects preflight parameters before evaluation");
assert.ok(caseRoute.includes("先录入前置参数，再进入面部评估"), "new-case route explains parameter-first workflow");
assert.ok(caseRoute.includes("创建病例草稿"), "new-case route creates the case only after preflight review");
assert.ok(caseRoute.includes("patientContext: { ageYears }"), "new-case route persists age into the created case");
assert.ok(caseRoute.includes("acquisition: { source }"), "new-case route persists acquisition pathway into the created case");
assert.ok(caseRoute.includes("marginStrategy"), "new-case route persists the lesion margin strategy");
assert.ok(caseRoute.includes("儿童 / 紧致"), "case workflow exposes the child/tight age band");
assert.ok(caseRoute.includes("老年 / 松弛"), "case workflow exposes the older/lax age band");
assert.ok(caseRoute.includes("皮下肿物 · 线性切口模式"), "case workflow exposes subcutaneous linear mode");
assert.ok(caseRoute.includes("皮表肿物 · 梭形切口模式"), "case workflow exposes cutaneous fusiform mode");
assert.ok(caseRoute.includes("需扩大安全切缘"), "case workflow exposes expanded safety margin strategy");
assert.ok(caseRoute.includes("图层看板"), "case workflow exposes the clinical layer board");
assert.ok(caseRoute.includes("采集质量门禁"), "case workflow exposes an acquisition quality gate in the clinical flow");
assert.ok(caseRoute.includes("AcquisitionQualityGate"), "case workflow renders a structured acquisition quality gate");
assert.ok(caseRoute.includes("AcquisitionPathwayPanel"), "case workflow renders a structured acquisition pathway panel");
assert.ok(caseRoute.includes("case-acquisition-path-grid"), "case workflow exposes acquisition pathways as clinical task cards");
assert.ok(caseRoute.includes("高清照片 / 视频"), "case workflow exposes the upload pathway");
assert.ok(caseRoute.includes("标准位取材"), "case workflow exposes the standard photo pathway");
assert.ok(caseRoute.includes("引导式三维重建"), "case workflow exposes the guided 3D scan pathway");
assert.ok(caseRoute.includes("AR 动态跟踪"), "case workflow exposes the realtime AR pathway");
assert.ok(caseRoute.includes("设备权限在评估采集画布中申请"), "case workflow explains device permission boundaries without blocking the case page");
assert.ok(caseRoute.includes("避免把原始影像写入普通审阅导出"), "case workflow keeps acquisition media privacy visible at the case boundary");
assert.ok(caseRoute.includes("captureViewItems"), "case workflow derives required capture views from acquisition mode");
assert.ok(caseRoute.includes("正位"), "case workflow records frontal capture completeness");
assert.ok(caseRoute.includes("左斜位"), "case workflow records oblique capture completeness");
assert.ok(caseRoute.includes("对焦清晰"), "case workflow records focus quality");
assert.ok(caseRoute.includes("曝光可读"), "case workflow records exposure quality");
assert.ok(caseRoute.includes("姿态覆盖"), "case workflow records pose coverage quality");
assert.ok(caseRoute.includes("跟踪稳定"), "case workflow records scan or live tracking quality");
assert.ok(caseRoute.includes("该状态不会锁死医生流程"), "case workflow keeps acquisition quality as a reviewable gate instead of a locked wizard");
assert.ok(caseRoute.includes("继续并标记复核"), "case workflow allows clinicians to continue with a visible review state");
assert.ok(caseRoute.includes("病灶边界记录"), "case workflow records lesion boundary inside the case planning step");
assert.ok(caseRoute.includes("LesionBoundaryPanel"), "case workflow renders a structured lesion boundary panel");
assert.ok(caseRoute.includes("lesionBoundaryTrace"), "case workflow derives lesion boundary provenance for candidates and reports");
assert.ok(caseRoute.includes("effectiveLesionDiameter"), "case workflow uses lesion boundary width when deriving candidate and closure inputs");
assert.ok(caseRoute.includes("边界模式"), "case workflow lets clinicians choose a lesion boundary mode");
assert.ok(caseRoute.includes("来源"), "case workflow records the lesion boundary source");
assert.ok(caseRoute.includes("记录者"), "case workflow records the lesion boundary author");
assert.ok(caseRoute.includes("自由轮廓点"), "case workflow records freehand lesion boundary point count");
assert.ok(caseRoute.includes("边界长轴 mm"), "case workflow records ellipse or freehand long-axis measurement");
assert.ok(caseRoute.includes("边界短轴 mm"), "case workflow records ellipse or freehand short-axis measurement");
assert.ok(caseRoute.includes("完整自由绘图仍可从受控规划入口进入"), "case workflow keeps full freehand drawing as a controlled planning handoff");
assert.ok(caseRoute.includes("RSTL 密度"), "case workflow lets clinicians tune RSTL line density");
assert.ok(caseRoute.includes("RSTL 透明度"), "case workflow lets clinicians tune RSTL opacity");
assert.ok(caseRoute.includes("皮纹透明度"), "case workflow lets clinicians tune personalized wrinkle opacity");
assert.ok(caseRoute.includes("rstlDensityLabel"), "case workflow derives clinician-facing RSTL density labels");
assert.ok(caseRoute.includes("规划依据"), "case workflow keeps explainability visible");
assert.ok(caseRoute.includes("PlanningRationalePanel"), "case workflow renders a dedicated planning rationale panel");
assert.ok(caseRoute.includes("规划依据与风险提示"), "case workflow labels planning rationale and risk together");
assert.ok(caseRoute.includes("case-rule-grid"), "case workflow renders structured clinical rule cards");
assert.ok(caseRoute.includes("case-rationale-audit"), "case workflow renders a structured audit boundary");
assert.ok(caseRoute.includes("agePlanningRule"), "case workflow derives age-based planning rule copy");
assert.ok(caseRoute.includes("lesionPlanningRule"), "case workflow derives lesion-layer planning rule copy");
assert.ok(caseRoute.includes("lesionBoundaryPlanningRule"), "case workflow derives lesion-boundary planning rule copy");
assert.ok(caseRoute.includes("marginPlanningRule"), "case workflow derives margin planning rule copy");
assert.ok(caseRoute.includes("CaseCandidateQueue"), "case workflow renders a case-level candidate queue");
assert.ok(caseRoute.includes("buildCaseCandidate"), "case workflow can create a deterministic candidate summary inside the case");
assert.ok(caseRoute.includes("保存候选草案"), "case planning lets clinicians save a candidate draft into the case");
assert.ok(caseRoute.includes("设为当前候选"), "case planning lets clinicians select a saved candidate");
assert.ok(caseRoute.includes("候选方案队列"), "case workflow exposes saved candidates as a queue");
assert.ok(caseRoute.includes("当前候选"), "case review summarizes the selected candidate");
assert.ok(caseRoute.includes("规则记录"), "case candidates expose clinician-readable rule provenance");
assert.ok(caseRoute.includes("buildCaseReviewExport"), "case review can build a sanitized structured export");
assert.ok(caseRoute.includes("buildCaseReportDraft"), "case review can build a local report draft");
assert.ok(caseRoute.includes("导出脱敏 JSON"), "case review exposes a sanitized JSON export action");
assert.ok(caseRoute.includes("下载报告草案"), "case review exposes a report draft export action");
assert.ok(caseRoute.includes("## 病灶边界"), "case report draft includes a dedicated lesion boundary section");
assert.ok(caseRoute.includes("医生审阅记录"), "case review exposes a structured clinician review record");
assert.ok(caseRoute.includes("审阅医生"), "case review requires a reviewer field");
assert.ok(caseRoute.includes("覆盖 / 退回原因"), "case review captures override or revision reasons");
assert.ok(caseRoute.includes("markReviewDecision"), "case review writes a timestamped review decision");
assert.ok(caseRoute.includes("reviewRecord"), "case review includes review records in local exports");
assert.ok(caseRoute.includes("rawImageIncluded: false"), "case review export explicitly excludes raw images");
assert.ok(caseRoute.includes("providerSecretIncluded: false"), "case review export explicitly excludes provider secrets");
assert.ok(caseRoute.includes("3.5:1"), "case workflow exposes the child/tight long-axis ratio in planning rationale");
assert.ok(caseRoute.includes("30° / 3:1"), "case workflow exposes the adult baseline angle and ratio in planning rationale");
assert.ok(caseRoute.includes("2.5:1"), "case workflow exposes the older/lax long-axis ratio in planning rationale");
assert.ok(caseRoute.includes("估算切除宽度"), "case workflow explains expanded-margin width in planning rationale");
assert.ok(caseRoute.includes("规则记录"), "case workflow keeps rule provenance visible as clinical audit context");
assert.ok(caseRoute.includes("病灶边界："), "case workflow includes lesion boundary provenance in candidate rule traces");
assert.ok(caseRoute.includes("caseClosureSimulation"), "case planning step embeds closure simulation inside the case workflow");
assert.ok(caseRoute.includes("张力闭合模拟"), "case planning step exposes closure simulation as a planning control");
assert.ok(caseRoute.includes("运行闭合模拟"), "case planning step gives doctors direct simulation feedback without leaving the workflow");
assert.ok(caseRoute.includes("estimateClosureSimulation"), "case planning step derives a persisted closure simulation summary");
assert.ok(caseRoute.includes("临床合规提示"), "case workflow includes clinical compliance copy");
assert.ok(caseRoute.includes("CaseClinicalViewport"), "case workflow renders a clinical viewport focus area for each step");
assert.ok(caseRoute.includes("ClinicalFacePreview"), "case workflow uses the shared high-fidelity clinical face preview component");
assert.ok(caseRoute.includes("case-viewport-mode-switch"), "case workflow exposes 2D/3D/live viewport mode context");
for (const viewportMode of ["2D 图像", "3D 重建", "实时叠加"]) {
  assert.ok(caseRoute.includes(viewportMode), `case workflow exposes the ${viewportMode} viewport mode`);
}
assert.ok(caseRoute.includes("case-clinical-workspace"), "case workflow uses a fixed clinical workspace instead of a stacked form");
assert.ok(caseRoute.includes("case-workspace-canvas"), "case workflow gives the face viewport a dedicated primary canvas area");
assert.ok(caseRoute.includes("case-workspace-panel"), "case workflow keeps parameters in an internal side panel");
assert.ok(caseRoute.includes("打开实时采集"), "evaluation route keeps live capture as a secondary side-panel action");
assert.ok(caseRoute.includes("打开候选画布"), "planning route keeps the legacy incision canvas as a secondary explainability action");
assert.ok(caseRoute.includes("CaseHandoffPanel"), "case workflow still wraps review/export compatibility surfaces as controlled handoffs");
assert.ok(caseRoute.includes("受控导出入口"), "review route presents export as a controlled handoff");
for (const subtask of ["标记病灶", "生成候选", "闭合模拟"]) {
  assert.ok(caseRoute.includes(subtask), `case workflow exposes the ${subtask} clinical subtask`);
}
assert.ok(!caseRoute.includes("case-next-rail"), "case workflow avoids duplicate bottom navigation that creates extra scrolling");
assert.ok(caseRoute.indexOf('CaseClinicalViewport activeCase={activeCase} step="evaluate"') < caseRoute.indexOf("图层看板"), "evaluation viewport appears before side-panel layer controls");
assert.ok(caseRoute.indexOf('CaseClinicalViewport activeCase={activeCase} step="plan"') < caseRoute.indexOf("病灶参数"), "planning viewport appears before lesion side-panel controls");
assert.ok(!caseRoute.includes("打开评估画布"), "case workflow avoids raw tool-style evaluation copy");
assert.ok(!caseRoute.includes("打开规划画布"), "case workflow avoids raw tool-style planning copy");
assert.ok(!caseRoute.includes("打开候选方案导出面板"), "case workflow avoids raw tool-style export copy");
assert.ok(!caseRoute.includes('to="/surgery"'), "case workflow must not send doctors to the standalone closure demo from planning");
assert.ok(caseRoute.includes("case-save-status"), "case workflow exposes visible save status states");
assert.ok(caseRoute.includes("caseStepStateLabel"), "case workflow derives per-step state labels");
assert.ok(caseRoute.includes("case-step-state"), "case workflow renders visible per-step state badges");
for (const stepState of ["待完善", "待采集", "需复核", "待审阅", "已确认", "保存失败"]) {
  assert.ok(caseRoute.includes(stepState), `case workflow exposes ${stepState} state feedback`);
}
assert.ok(caseRoute.includes("可返回微调，草稿保留"), "case workflow stepper avoids a locked one-way wizard");
assert.ok(caseRoute.includes("本设备"), "case workflow explains local draft saving in clinician-facing language");
assert.ok(caseRoute.includes("院内或云端病例库"), "case workflow explains future remote case storage without implementation jargon");
assert.ok(!caseRoute.includes("localStorage"), "case workflow components do not write localStorage directly");
assert.ok(caseRoute.includes("layers={activeCase.layers}"), "case workflow binds the visible layer board into the planning viewport");
assert.ok(caseRoute.includes("mode={activeMode}"), "case workflow binds acquisition mode into the planning viewport");
assert.ok(clinicalFacePreview.includes("case-face-preview-large"), "clinical face preview supports a large planning viewport");
assert.ok(clinicalFacePreview.includes("ClinicalFacePreviewLayers"), "clinical face preview owns a typed layer contract");
assert.ok(clinicalFacePreview.includes("ClinicalFaceLesionBoundaryMode"), "clinical face preview owns a typed lesion boundary overlay contract");
assert.ok(clinicalFacePreview.includes("lesionBoundaryMode"), "clinical face preview accepts the lesion boundary mode from the case");
assert.ok(clinicalFacePreview.includes("case-face-lesion-boundary"), "clinical face preview renders a lesion boundary overlay");
assert.ok(clinicalFacePreview.includes("rstlLineKeys"), "clinical face preview changes RSTL line count by density");
assert.ok(clinicalFacePreview.includes("case-face-wrinkle"), "clinical face preview renders personalized wrinkle overlays");
assert.ok(clinicalFacePreview.includes("case-face-blended-field"), "clinical face preview renders a mixed field overlay");
assert.ok(clinicalFacePreview.includes("resolvedLayers.incisionDesign"), "clinical face preview can hide incision overlays from layer state");
assert.ok(clinicalFacePreview.includes("case-face-ruler"), "clinical face preview renders a measurement ruler");
assert.ok(clinicalFacePreview.includes("case-face-eye"), "clinical face preview renders anatomical eye references");
assert.ok(clinicalFacePreview.includes("case-face-nose"), "clinical face preview renders an anatomical nose reference");
assert.ok(clinicalFacePreview.includes("case-face-mouth"), "clinical face preview renders an anatomical mouth reference");
assert.ok(clinicalFacePreview.includes("case-face-coordinate"), "clinical face preview renders stable viewport coordinates");
for (const hiddenClinicalCopy of [
  "CaseDataSource",
  "Worker API",
  "Agent trace",
  "topology",
  "FLAME",
  "MediaPipe",
  "R3F",
  "OpenAI-compatible",
  "vLLM",
  "LLM Provider",
]) {
  assert.ok(!caseRoute.includes(hiddenClinicalCopy), `case workflow does not expose implementation jargon: ${hiddenClinicalCopy}`);
}

assert.ok(managedRoute.includes("legacyNotice"), "managed legacy routes can display compatibility notices");
assert.ok(managedRoute.includes("react-legacy-banner"), "managed legacy routes render a visible compatibility banner");
assert.ok(incisionRoute.includes("正式临床流程请从病例大厅进入"), "incision route warns that it is not the main clinical flow");
assert.ok(liveRoute.includes("正式临床流程请从病例大厅进入"), "live route warns that it is not the main clinical flow");
assert.ok(annotateRoute.includes("不属于医生病例主流程"), "annotate route is framed as atlas management");
assert.ok(surgeryRoute.includes("正式方案应从病例流程"), "surgery demo is framed as a case workflow tool");
assert.ok(legacyWorkbenchCopy.includes('to="/settings/atlas"'), "legacy workbenches route atlas maintenance through settings");
assert.ok(!legacyWorkbenchCopy.includes('to="/annotate">图谱库管理'), "legacy workbenches do not bypass atlas settings for atlas maintenance");

assert.ok(workbenchLayout.includes("clinical-compat-workbench"), "legacy workbench routes share the clinical compatibility shell");
assert.ok(legacyWorkbenchCopy.includes("切口规划与候选审阅"), "incision workbench uses clinician-facing planning copy");
assert.ok(legacyWorkbenchCopy.includes("面部评估与张力线映射"), "live workbench uses clinician-facing evaluation copy");
assert.ok(legacyWorkbenchCopy.includes("张力闭合模拟"), "surgery workbench is named as a planning simulation, not a standalone demo");
assert.ok(legacyWorkbenchCopy.includes("3D 张力线图谱标注"), "annotate workbench is framed as atlas management");
assert.ok(legacyWorkbenchCopy.includes("clinical-developer-disclosure"), "developer/provider settings are folded out of the clinical sidebar");
assert.ok(legacyWorkbenchCopy.includes("AI 摘要服务配置"), "provider settings use clinician-facing AI service copy");
for (const hiddenCopy of [
  "切口 Agent 工作台",
  "COMPUTER VISION PROTOTYPE",
  "STAGE 2 · AGENTIC INCISION",
  "RSTL · CLOSURE DEMO",
  "3D LINE ANNOTATION",
  "面部朗格线迁移",
  "返回 3D 标注",
  "LLM Provider</span>",
  "Provider 类型固定",
]) {
  assert.ok(!legacyWorkbenchCopy.includes(hiddenCopy), `legacy workbench no longer exposes technical/prototype copy: ${hiddenCopy}`);
}

assert.ok(dataSource.includes("interface ClinicalCaseRecord"), "dataSource owns the structured case record contract");
assert.ok(dataSource.includes("closureSimulation"), "dataSource persists closure simulation state inside the case record");
assert.ok(dataSource.includes("ClosureSimulationStatus"), "dataSource gives closure simulation a typed status");
assert.ok(dataSource.includes("CaseIncisionCandidateRecord"), "dataSource owns the structured case candidate record contract");
assert.ok(dataSource.includes("incisionCandidates"), "dataSource persists incision candidates inside the case record");
assert.ok(dataSource.includes("selectedCandidateId"), "dataSource persists the selected candidate pointer");
assert.ok(dataSource.includes("normalizeIncisionCandidate"), "dataSource normalizes saved candidate records for draft recovery");
assert.ok(dataSource.includes("RstlLayerDensity"), "dataSource persists typed RSTL layer density");
assert.ok(dataSource.includes("rstlOpacity"), "dataSource persists RSTL opacity with the case draft");
assert.ok(dataSource.includes("wrinkleOpacity"), "dataSource persists personalized wrinkle opacity with the case draft");
assert.ok(dataSource.includes("normalizeOpacity"), "dataSource clamps persisted layer opacity values");
assert.ok(dataSource.includes("ClinicalCaseReviewRecord"), "dataSource owns the structured case review record contract");
assert.ok(dataSource.includes("ClinicalCaseReviewDecision"), "dataSource owns typed review decisions");
assert.ok(dataSource.includes("normalizeReviewRecord"), "dataSource normalizes review records for draft recovery");
assert.ok(dataSource.includes("ClinicalCaseCaptureSet"), "dataSource owns structured acquisition capture views");
assert.ok(dataSource.includes("ClinicalCaseAcquisitionQuality"), "dataSource owns structured acquisition quality checks");
assert.ok(dataSource.includes("ClinicalCaseLesionBoundary"), "dataSource owns structured lesion boundary records");
assert.ok(dataSource.includes("LesionBoundaryMode"), "dataSource owns typed lesion boundary modes");
assert.ok(dataSource.includes("LesionBoundarySource"), "dataSource owns typed lesion boundary sources");
assert.ok(dataSource.includes("deriveLesionBoundary"), "dataSource derives lesion boundary status and summary from case inputs");
assert.ok(dataSource.includes("normalizeBoundaryMode"), "dataSource normalizes saved lesion boundary mode values");
assert.ok(dataSource.includes("normalizeBoundaryPointCount"), "dataSource normalizes freehand lesion boundary point counts");
assert.ok(dataSource.includes("deriveAcquisitionQuality"), "dataSource derives acquisition quality status from required views and checks");
assert.ok(dataSource.includes("requiredCaptureViews"), "dataSource derives required capture views from source mode");
assert.ok(dataSource.includes("normalizeQualityCheck"), "dataSource normalizes acquisition quality checks for draft recovery");
assert.ok(dataSource.includes("saveCase(payload"), "dataSource exposes a case save method");
assert.ok(dataSource.includes("listCases()"), "dataSource exposes case listing");
assert.ok(dataSource.includes("getCase(id"), "dataSource exposes case recovery");
assert.ok(dataSource.includes("classifyCaseAge"), "dataSource owns age-band parameter hints");
assert.ok(dataSource.includes("3.5:1"), "dataSource preserves the child/tight ratio hint");
assert.ok(dataSource.includes("2.5:1"), "dataSource preserves the older/lax ratio hint");

assert.ok(caseStore.includes("CASE_STORE_BOUNDARY_NOTE"), "case store documents low-frequency state ownership");
assert.ok(caseStore.includes("dataSource.saveCase"), "case store persists through the BrowserDataSource contract");
assert.ok(caseStore.includes("closureSimulation"), "case store merges closure simulation updates through the case data boundary");
assert.ok(caseStore.includes("...draft"), "case store preserves top-level candidate queue updates through the case data boundary");
assert.ok(caseStore.includes("reviewRecord"), "case store merges structured review records through the case data boundary");
assert.ok(caseStore.includes("captureSet"), "case store merges nested acquisition capture updates through the case data boundary");
assert.ok(caseStore.includes("quality"), "case store merges nested acquisition quality updates through the case data boundary");
assert.ok(caseStore.includes("boundary: { ...current.lesion.boundary"), "case store merges nested lesion boundary updates through the case data boundary");
assert.ok(!caseStore.includes("localStorage"), "case store does not bypass the dataSource boundary");

assert.ok(styles.includes("--font-clinical-sans"), "styles expose the clinical font token");
assert.ok(styles.includes("--clinical-accent: #0f62fe"), "styles use a clinical blue accent instead of the legacy green primary");
assert.ok(styles.includes("--clinical-dark-bg"), "styles expose a dark immersive clinical shell token");
assert.ok(styles.includes(".clinical-number"), "styles define tabular clinical numbers");
assert.ok(styles.includes(".case-workflow-page .btn-primary"), "styles override legacy green primary buttons inside the case workflow");
assert.ok(styles.includes(".case-workflow-page .react-shell-sidebar"), "styles darken the case workflow sidebar");
assert.ok(styles.includes("body:has(.case-workflow-page)"), "styles lock browser-level scrolling while the case workbench is mounted");
assert.ok(styles.includes("height: 100dvh"), "styles use a full-viewport clinical workbench layout");
assert.ok(styles.includes("overflow: hidden"), "styles constrain global overflow instead of using page scrolling");
assert.ok(styles.includes("border-radius: 2px"), "styles use minimal clinical radii instead of SaaS-style rounded cards");
assert.ok(styles.includes(".case-lobby-landing"), "styles implement the case lobby landing page");
assert.ok(styles.includes(".case-lobby-stage"), "styles implement the case lobby viewport preview");
assert.ok(styles.includes(".case-workflow-roadmap"), "styles implement the clinical workflow roadmap");
assert.ok(styles.includes(".case-clinical-viewport"), "styles implement the PACS-like clinical viewport");
assert.ok(styles.includes(".case-clinical-workspace"), "styles implement the two-pane clinical workspace");
assert.ok(styles.includes(".case-workspace-canvas"), "styles give the face viewport primary workspace ownership");
assert.ok(styles.includes(".case-workspace-panel"), "styles make parameter panels internally scrollable");
assert.ok(styles.includes(".case-workspace-canvas .case-face-preview-large"), "styles keep the large face preview expanded inside the workspace");
assert.ok(styles.includes(".case-viewport-mode-switch"), "styles implement compact 2D/3D/live viewport mode controls");
assert.ok(styles.includes(".case-layer-controls"), "styles implement compact layer parameter controls");
assert.ok(styles.includes(".case-acquisition-gate"), "styles implement the acquisition quality gate");
assert.ok(styles.includes(".case-acquisition-path-panel"), "styles implement the acquisition pathway panel");
assert.ok(styles.includes(".case-acquisition-path-card"), "styles implement acquisition pathway cards");
assert.ok(styles.includes(".case-acquisition-path-meta"), "styles implement dense acquisition pathway metadata");
assert.ok(styles.includes(".case-capture-grid"), "styles implement compact capture completeness controls");
assert.ok(styles.includes(".case-quality-grid"), "styles implement compact acquisition quality controls");
assert.ok(styles.includes(".case-acquisition-status-ready"), "styles implement acquisition quality status feedback");
assert.ok(styles.includes(".case-lesion-boundary-panel"), "styles implement the lesion boundary planning panel");
assert.ok(styles.includes(".case-boundary-grid"), "styles implement compact lesion boundary controls");
assert.ok(styles.includes(".case-boundary-metrics"), "styles implement lesion boundary measurements");
assert.ok(styles.includes(".case-lesion-boundary-status-ready"), "styles implement lesion boundary status feedback");
assert.ok(styles.includes(".case-face-lesion-boundary"), "styles implement the lesion boundary overlay");
assert.ok(styles.includes(".case-face-boundary-point"), "styles implement freehand boundary point markers");
assert.ok(styles.includes(".case-face-density-high"), "styles implement high-density RSTL overlays");
assert.ok(styles.includes("--case-rstl-opacity"), "styles bind RSTL opacity into the face viewport");
assert.ok(styles.includes("--case-wrinkle-opacity"), "styles bind personalized wrinkle opacity into the face viewport");
assert.ok(styles.includes(".case-face-blended-field"), "styles implement the mixed-field overlay");
assert.ok(styles.includes(".case-face-wrinkle"), "styles implement personalized wrinkle overlays");
assert.ok(styles.includes(".case-rule-grid"), "styles implement structured planning rule cards");
assert.ok(styles.includes(".case-rationale-audit"), "styles implement dense planning audit rows");
assert.ok(styles.includes(".case-candidate-panel"), "styles implement the case candidate panel");
assert.ok(styles.includes(".case-candidate-metrics"), "styles implement dense candidate metrics");
assert.ok(styles.includes(".case-candidate-rationale"), "styles implement candidate provenance rows");
assert.ok(styles.includes(".case-review-output"), "styles implement the review output surface");
assert.ok(styles.includes(".case-review-record"), "styles implement the clinician review record form");
assert.ok(styles.includes(".case-review-textarea"), "styles implement dense review note fields");
assert.ok(styles.includes(".case-export-actions"), "styles implement compact case export actions");
assert.ok(styles.includes(".case-export-privacy"), "styles implement privacy boundary rows for export");
assert.ok(styles.includes(".case-closure-grid"), "styles implement the embedded closure simulation panel");
assert.ok(styles.includes(".case-closure-meter"), "styles implement closure simulation score feedback");
assert.ok(styles.includes(".case-step-stage-grid"), "styles prioritize a viewport-plus-command step layout");
assert.ok(styles.includes(".case-task-strip"), "styles implement compact clinical subtask strips");
assert.ok(styles.includes(".case-handoff-panel"), "styles implement controlled handoff panels");
assert.ok(styles.includes(".case-step-state"), "styles implement compact per-step state badges");
assert.ok(styles.includes(".case-face-preview"), "styles implement the high-contrast face planning surface");
assert.ok(styles.includes(".case-face-ruler"), "styles implement a clinical measurement ruler inside the face viewport");
assert.ok(styles.includes(".case-face-depth"), "styles implement depth reference contours inside the face viewport");
assert.ok(styles.includes(".case-disclosure"), "styles implement collapsed compatibility and developer sections");
assert.ok(styles.includes(".react-legacy-banner"), "styles render legacy route notices");
assert.ok(styles.includes(".case-workflow-main"), "styles define the case workflow surface");
assert.ok(styles.includes(".settings-workbench-page"), "styles scope the settings workbench inside the clinical shell");
assert.ok(styles.includes(".settings-hero"), "styles implement the settings landing surface");
assert.ok(styles.includes(".settings-panel-grid"), "styles implement the settings panel grid");
assert.ok(styles.includes(".settings-provider-panel"), "styles frame provider diagnostics inside settings");
assert.ok(styles.includes(".settings-boundary-list"), "styles implement dense settings boundary copy");
assert.ok(styles.includes(".clinical-compat-workbench"), "styles apply the dark clinical shell to legacy workbenches");
assert.ok(styles.includes(".clinical-compat-workbench .sidebar"), "styles darken legacy workbench sidebars");
assert.ok(styles.includes(".clinical-compat-workbench .stage"), "styles darken legacy workbench stages");
assert.ok(styles.includes(".clinical-developer-disclosure"), "styles collapse developer/provider configuration");
assert.ok(styles.includes(".surgery-highlight-copy"), "styles avoid green-as-primary copy in closure controls");
assert.ok(!styles.includes(".surgery-green-copy"), "styles remove the legacy green closure copy class");

assert.ok(visualCapture.includes("incisionCandidates"), "Playwright visual case seed includes saved candidates");
assert.ok(visualCapture.includes("/app/case/new"), "Playwright visual case smoke test captures the new-case setup page");
assert.ok(visualCapture.includes("02-new-case.png"), "Playwright visual case smoke test writes a new-case setup screenshot");
assert.ok(!visualCapture.includes("--full-page"), "Playwright visual case smoke test captures viewport screenshots instead of long full-page screenshots");
assert.ok(visualCapture.includes("visual-candidate-1"), "Playwright visual case seed includes a selected candidate");
assert.ok(visualCapture.includes("boundary:"), "Playwright visual case seed includes lesion boundary records");
assert.ok(visualCapture.includes("axisDiameterMm"), "Playwright visual case seed exercises lesion boundary axis measurements");
assert.ok(visualCapture.includes("病灶边界：椭圆边界"), "Playwright visual case seed exposes lesion boundary provenance");
assert.ok(visualCapture.includes("captureSet"), "Playwright visual case seed includes capture completeness");
assert.ok(visualCapture.includes("quality"), "Playwright visual case seed includes acquisition quality checks");
assert.ok(visualCapture.includes("采集质量：采集可用"), "Playwright visual case seed includes acquisition quality provenance");
assert.ok(visualCapture.includes('rstlDensity: "high"'), "Playwright visual case seed exercises high-density RSTL controls");
assert.ok(visualCapture.includes("rstlOpacity: 0.78"), "Playwright visual case seed exercises persisted RSTL opacity");
assert.ok(visualCapture.includes("wrinkleOpacity: 0.7"), "Playwright visual case seed exercises persisted wrinkle opacity");
assert.ok(visualCapture.includes("图层状态：RSTL 高密度 78%，皮纹 70%"), "Playwright visual case seed exposes layer state in candidate provenance");
assert.ok(visualCapture.includes("reviewRecord"), "Playwright visual case seed includes a structured review record");
assert.ok(visualCapture.includes("示例医生"), "Playwright visual case seed exercises the reviewer field");

console.log("test_case_workflow_ui: clinical case workflow contracts passed");
