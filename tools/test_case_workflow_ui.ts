const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("src/App.tsx", "utf8");
const dashboard = fs.readFileSync("src/routes/DashboardRoute.tsx", "utf8");
const caseRoute = fs.readFileSync("src/routes/CaseWorkflowRoute.tsx", "utf8");
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
assert.ok(app.includes('path="/settings/atlas"'), "React Router exposes atlas settings redirect");
assert.ok(app.includes('path="/settings/developer"'), "React Router exposes developer settings redirect");

assert.ok(dashboard.includes("面部松弛皮肤张力线智能切口设计系统"), "case lobby uses the clinician-facing product name");
assert.ok(dashboard.includes("病例大厅"), "case lobby replaces the technical landing copy");
assert.ok(dashboard.includes("工作台大厅"), "case lobby includes a product landing surface");
assert.ok(dashboard.includes("case-lobby-landing"), "case lobby renders a dedicated landing section");
assert.ok(dashboard.includes("case-lobby-stage"), "case lobby includes a dark clinical viewport preview");
assert.ok(dashboard.includes("case-workflow-roadmap"), "case lobby shows the clinical workflow roadmap");
assert.ok(dashboard.includes("兼容 / 研发工具"), "technical tools are retained behind a compatibility disclosure");
assert.ok(dashboard.includes("旧工作台"), "legacy tools are explicitly downgraded from the main clinical path");
for (const route of ["/incision", "/live", "/annotate", "/three-preview", "/surgery"]) {
  assert.ok(dashboard.includes(`to="${route}"`), `case lobby keeps ${route} as a React Router compatibility link`);
}
assert.ok(dashboard.includes("CASE_STORE_BOUNDARY_NOTE"), "case lobby surfaces the case store state boundary");

assert.ok(caseRoute.includes("患者年龄"), "case workflow collects patient age");
assert.ok(caseRoute.includes("儿童 / 紧致"), "case workflow exposes the child/tight age band");
assert.ok(caseRoute.includes("老年 / 松弛"), "case workflow exposes the older/lax age band");
assert.ok(caseRoute.includes("皮下肿物 · 线性切口模式"), "case workflow exposes subcutaneous linear mode");
assert.ok(caseRoute.includes("皮表肿物 · 梭形切口模式"), "case workflow exposes cutaneous fusiform mode");
assert.ok(caseRoute.includes("需扩大安全切缘"), "case workflow exposes expanded safety margin strategy");
assert.ok(caseRoute.includes("图层看板"), "case workflow exposes the clinical layer board");
assert.ok(caseRoute.includes("规划依据"), "case workflow keeps explainability visible");
assert.ok(caseRoute.includes("临床合规提示"), "case workflow includes clinical compliance copy");
assert.ok(caseRoute.includes("CaseClinicalViewport"), "case workflow renders a clinical viewport focus area for each step");
assert.ok(caseRoute.includes("case-step-stage-grid"), "case workflow pairs the viewport with the step command panel");
assert.ok(caseRoute.includes("case-face-preview-large"), "case workflow reserves a high-contrast face planning viewport");
assert.ok(caseRoute.includes("case-save-status"), "case workflow exposes visible save status states");
assert.ok(caseRoute.includes("可返回微调，草稿保留"), "case workflow stepper avoids a locked one-way wizard");
assert.ok(caseRoute.includes("CaseDataSource"), "case workflow copy explains the DataSource save boundary");
assert.ok(!caseRoute.includes("localStorage"), "case workflow components do not write localStorage directly");

assert.ok(managedRoute.includes("legacyNotice"), "managed legacy routes can display compatibility notices");
assert.ok(managedRoute.includes("react-legacy-banner"), "managed legacy routes render a visible compatibility banner");
assert.ok(incisionRoute.includes("正式临床流程请从病例大厅进入"), "incision route warns that it is not the main clinical flow");
assert.ok(liveRoute.includes("正式临床流程请从病例大厅进入"), "live route warns that it is not the main clinical flow");
assert.ok(annotateRoute.includes("不属于医生病例主流程"), "annotate route is framed as atlas management");
assert.ok(surgeryRoute.includes("正式方案应从病例流程"), "surgery demo is framed as a case workflow tool");

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
assert.ok(dataSource.includes("saveCase(payload"), "dataSource exposes a case save method");
assert.ok(dataSource.includes("listCases()"), "dataSource exposes case listing");
assert.ok(dataSource.includes("getCase(id"), "dataSource exposes case recovery");
assert.ok(dataSource.includes("classifyCaseAge"), "dataSource owns age-band parameter hints");
assert.ok(dataSource.includes("3.5:1"), "dataSource preserves the child/tight ratio hint");
assert.ok(dataSource.includes("2.5:1"), "dataSource preserves the older/lax ratio hint");

assert.ok(caseStore.includes("CASE_STORE_BOUNDARY_NOTE"), "case store documents low-frequency state ownership");
assert.ok(caseStore.includes("dataSource.saveCase"), "case store persists through the BrowserDataSource contract");
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
assert.ok(styles.includes(".case-step-stage-grid"), "styles prioritize a viewport-plus-command step layout");
assert.ok(styles.includes(".case-face-preview"), "styles implement the high-contrast face planning surface");
assert.ok(styles.includes(".case-disclosure"), "styles implement collapsed compatibility and developer sections");
assert.ok(styles.includes(".react-legacy-banner"), "styles render legacy route notices");
assert.ok(styles.includes(".case-workflow-main"), "styles define the case workflow surface");
assert.ok(styles.includes(".clinical-compat-workbench"), "styles apply the dark clinical shell to legacy workbenches");
assert.ok(styles.includes(".clinical-compat-workbench .sidebar"), "styles darken legacy workbench sidebars");
assert.ok(styles.includes(".clinical-compat-workbench .stage"), "styles darken legacy workbench stages");
assert.ok(styles.includes(".clinical-developer-disclosure"), "styles collapse developer/provider configuration");
assert.ok(styles.includes(".surgery-highlight-copy"), "styles avoid green-as-primary copy in closure controls");
assert.ok(!styles.includes(".surgery-green-copy"), "styles remove the legacy green closure copy class");

console.log("test_case_workflow_ui: clinical case workflow contracts passed");
