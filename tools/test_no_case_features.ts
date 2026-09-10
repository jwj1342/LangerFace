const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(process.cwd(), "..");
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
const sourceExtensions = new Set([".html", ".js", ".json", ".mjs", ".ts", ".tsx", ".yaml", ".yml"]);

function readSourceTree(relativePath) {
  const root = path.join(repositoryRoot, relativePath);
  if (!fs.existsSync(root)) return "";
  const pending = [root];
  const sources = [];
  while (pending.length) {
    const current = pending.pop();
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) pending.push(path.join(current, entry));
    } else if (sourceExtensions.has(path.extname(current))) {
      sources.push(fs.readFileSync(current, "utf8"));
    }
  }
  return sources.join("\n");
}

for (const removedPath of [
  "web/src/routes/CaseWorkflowRoute.tsx",
  "web/src/stores/caseStore.ts",
  "web/src/components/ClinicalFacePreview.tsx",
  "workers/api/package.json",
  "workers/api/src/index.ts",
  "workers/api/migrations/0001_initial.sql",
]) {
  assert.ok(!fs.existsSync(path.join(repositoryRoot, removedPath)), `case feature should be removed: ${removedPath}`);
}

// docs/ 现在按语义分了子目录，所以病例类文档要按 basename 在整棵 docs 树里找，
// 否则换一个子目录就能绕过本守卫。
{
  const forbiddenDocNames = new Set([
    "CLINICAL_CASE_WORKFLOW_UI.md",
    "BACKEND_DATA_ARCHITECTURE.md",
    "CLOUDFLARE_BACKEND_ROLLOUT.md",
  ]);
  const docsRoot = path.join(repositoryRoot, "docs");
  const stack = [docsRoot];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else {
        assert.ok(
          !forbiddenDocNames.has(entry.name),
          `case workflow doc should stay removed anywhere under docs/: ${path.relative(repositoryRoot, full)}`,
        );
      }
    }
  }
}

const app = read("web/src/App.tsx");
const dashboard = read("web/src/routes/DashboardRoute.tsx");
const dataSource = read("web/src/services/dataSource.ts");
const liveRefine = read("web/src/services/liveRefine2d.ts");
const liveRefinePanel = read("web/src/components/LiveRefinePanel.tsx");
const packageJson = read("web/package.json");
const ci = read(".github/workflows/ci.yml");
const deploymentDoc = read("docs/quality/CI_CD_VERCEL.md");
const frontendAndCi = [
  readSourceTree("web/compat/personalized"),
  readSourceTree("web/src"),
  readSourceTree(".github"),
].join("\n");

for (const forbidden of ["CaseWorkflowRoute", 'path="/cases"', 'path="/case/']) {
  assert.ok(!app.includes(forbidden), `React router should not expose case workflow: ${forbidden}`);
}

for (const forbidden of [
  "ClinicalCase",
  "langerface.cases",
  "saveCase(",
  "listCases(",
  "getCase(",
  "saveAnnotation(",
  "listAnnotations(",
  "localStorage",
]) {
  assert.ok(!dataSource.includes(forbidden), `browser data source should not persist cases: ${forbidden}`);
}

for (const forbidden of ["test_case_workflow_ui", "capture_case_workflow"]) {
  assert.ok(!packageJson.includes(forbidden), `package scripts should not reference removed case tooling: ${forbidden}`);
}

assert.ok(!ci.includes("workers/api"), "CI should not install, test, or deploy the removed case API");
for (const forbidden of [
  "/api/cases",
  "CLOUDFLARE_D1_DATABASE_ID",
  "D1Database",
  "R2Bucket",
  "CaseWorkflowRoute",
  "ClinicalCase",
  "caseStore",
  "indexedDB",
  "langerface.cases",
]) {
  assert.ok(!frontendAndCi.includes(forbidden), `frontend and CI should not contain case-record implementation: ${forbidden}`);
}
for (const forbidden of [
  "langerface-refined-2d-result",
  "localStorage",
  "saveRefine",
]) {
  assert.ok(!liveRefine.includes(forbidden), `patient-derived 2D refinement should not persist: ${forbidden}`);
}
assert.ok(!liveRefinePanel.includes("refineSaveBtn"), "live UI should not offer persistent refinement save");
assert.ok(!deploymentDoc.includes("VITE_API_BASE_URL"), "deployment docs should not direct the frontend to a removed case API");
assert.ok(!deploymentDoc.includes("Worker API、D1、R2"), "deployment docs should not retain the removed case backend plan");
assert.ok(dashboard.includes("不维护病例大厅、患者档案、历史记录或云端病例库"), "tool launcher should state the no-case-storage boundary");
assert.ok(app.includes('path="/personalized"'), "legacy personalized route should remain available directly");
assert.ok(!dashboard.includes('to: "/personalized"'), "tool launcher should hide personalized capture");
assert.ok(dashboard.includes('to: "/live"'), "live 2D tool should remain available");
assert.ok(dashboard.includes('to: "/incision"'), "incision tool should remain available");
assert.ok(dashboard.includes('to: "/app/workflow"'), "merged workflow development entry should remain available");

console.log("No-case-feature boundary checks passed.");
