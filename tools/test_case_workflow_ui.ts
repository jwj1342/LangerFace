const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("src/App.tsx", "utf8");
const dashboard = fs.readFileSync("src/routes/DashboardRoute.tsx", "utf8");
const caseRoute = fs.readFileSync("src/routes/CaseWorkflowRoute.tsx", "utf8");
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
assert.ok(dashboard.includes("兼容工具入口"), "technical tools are retained as compatibility entries");
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
assert.ok(caseRoute.includes("CaseDataSource"), "case workflow copy explains the DataSource save boundary");
assert.ok(!caseRoute.includes("localStorage"), "case workflow components do not write localStorage directly");

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
assert.ok(styles.includes(".clinical-number"), "styles define tabular clinical numbers");
assert.ok(styles.includes(".case-workflow-main"), "styles define the case workflow surface");

console.log("test_case_workflow_ui: clinical case workflow contracts passed");
