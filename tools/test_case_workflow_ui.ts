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
assert.ok(caseRoute.includes("儿童 / 紧致"), "case workflow exposes the child/tight age band");
assert.ok(caseRoute.includes("老年 / 松弛"), "case workflow exposes the older/lax age band");
assert.ok(caseRoute.includes("皮下肿物 · 线性切口模式"), "case workflow exposes subcutaneous linear mode");
assert.ok(caseRoute.includes("皮表肿物 · 梭形切口模式"), "case workflow exposes cutaneous fusiform mode");
assert.ok(caseRoute.includes("需扩大安全切缘"), "case workflow exposes expanded safety margin strategy");
assert.ok(caseRoute.includes("图层看板"), "case workflow exposes the clinical layer board");
assert.ok(caseRoute.includes("规划依据"), "case workflow keeps explainability visible");
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
assert.ok(caseRoute.includes("CaseTaskStrip"), "case workflow renders clinical subtask strips inside each major step");
assert.ok(caseRoute.includes("CaseHandoffPanel"), "case workflow wraps legacy work surfaces as controlled clinical handoffs");
assert.ok(caseRoute.includes("受控评估入口"), "evaluation route presents the live canvas as a controlled handoff");
assert.ok(caseRoute.includes("受控规划入口"), "planning route presents the incision canvas as a controlled handoff");
assert.ok(caseRoute.includes("受控导出入口"), "review route presents export as a controlled handoff");
for (const subtask of ["标记病灶", "生成候选", "闭合模拟"]) {
  assert.ok(caseRoute.includes(subtask), `case workflow exposes the ${subtask} clinical subtask`);
}
assert.ok(caseRoute.includes("case-step-stage-grid"), "case workflow pairs the viewport with the step command panel");
assert.ok(caseRoute.indexOf("图层看板") < caseRoute.indexOf("进入评估采集画布"), "evaluation work surface appears after patient/acquisition/layer parameters");
assert.ok(caseRoute.indexOf("规划依据") < caseRoute.indexOf("进入候选规划画布"), "planning work surface appears after lesion and margin parameters");
assert.ok(!caseRoute.includes("打开评估画布"), "case workflow avoids raw tool-style evaluation copy");
assert.ok(!caseRoute.includes("打开规划画布"), "case workflow avoids raw tool-style planning copy");
assert.ok(!caseRoute.includes("打开候选方案导出面板"), "case workflow avoids raw tool-style export copy");
assert.ok(!caseRoute.includes('to="/surgery"'), "case workflow must not send doctors to the standalone closure demo from planning");
assert.ok(caseRoute.includes("case-save-status"), "case workflow exposes visible save status states");
assert.ok(caseRoute.includes("caseStepStateLabel"), "case workflow derives per-step state labels");
assert.ok(caseRoute.includes("case-step-state"), "case workflow renders visible per-step state badges");
for (const stepState of ["待完善", "待审阅", "已确认", "保存失败"]) {
  assert.ok(caseRoute.includes(stepState), `case workflow exposes ${stepState} state feedback`);
}
assert.ok(caseRoute.includes("可返回微调，草稿保留"), "case workflow stepper avoids a locked one-way wizard");
assert.ok(caseRoute.includes("本设备"), "case workflow explains local draft saving in clinician-facing language");
assert.ok(caseRoute.includes("院内或云端病例库"), "case workflow explains future remote case storage without implementation jargon");
assert.ok(!caseRoute.includes("localStorage"), "case workflow components do not write localStorage directly");
assert.ok(caseRoute.includes("<ClinicalFacePreview large showZones />"), "case workflow reserves a high-contrast face planning viewport");
assert.ok(clinicalFacePreview.includes("case-face-preview-large"), "clinical face preview supports a large planning viewport");
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
assert.ok(dataSource.includes("saveCase(payload"), "dataSource exposes a case save method");
assert.ok(dataSource.includes("listCases()"), "dataSource exposes case listing");
assert.ok(dataSource.includes("getCase(id"), "dataSource exposes case recovery");
assert.ok(dataSource.includes("classifyCaseAge"), "dataSource owns age-band parameter hints");
assert.ok(dataSource.includes("3.5:1"), "dataSource preserves the child/tight ratio hint");
assert.ok(dataSource.includes("2.5:1"), "dataSource preserves the older/lax ratio hint");

assert.ok(caseStore.includes("CASE_STORE_BOUNDARY_NOTE"), "case store documents low-frequency state ownership");
assert.ok(caseStore.includes("dataSource.saveCase"), "case store persists through the BrowserDataSource contract");
assert.ok(caseStore.includes("closureSimulation"), "case store merges closure simulation updates through the case data boundary");
assert.ok(!caseStore.includes("localStorage"), "case store does not bypass the dataSource boundary");

assert.ok(styles.includes("--font-clinical-sans"), "styles expose the clinical font token");
assert.ok(styles.includes("--clinical-accent: #0f62fe"), "styles use a clinical blue accent instead of the legacy green primary");
assert.ok(styles.includes("--clinical-dark-bg"), "styles expose a dark immersive clinical shell token");
assert.ok(styles.includes(".clinical-number"), "styles define tabular clinical numbers");
assert.ok(styles.includes(".case-workflow-page .btn-primary"), "styles override legacy green primary buttons inside the case workflow");
assert.ok(styles.includes(".case-workflow-page .react-shell-sidebar"), "styles darken the case workflow sidebar");
assert.ok(styles.includes(".case-lobby-landing"), "styles implement the case lobby landing page");
assert.ok(styles.includes(".case-lobby-stage"), "styles implement the case lobby viewport preview");
assert.ok(styles.includes(".case-workflow-roadmap"), "styles implement the clinical workflow roadmap");
assert.ok(styles.includes(".case-clinical-viewport"), "styles implement the PACS-like clinical viewport");
assert.ok(styles.includes(".case-viewport-mode-switch"), "styles implement compact 2D/3D/live viewport mode controls");
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

console.log("test_case_workflow_ui: clinical case workflow contracts passed");
