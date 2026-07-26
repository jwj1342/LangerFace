const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(process.cwd(), "..");
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

for (const removedPath of [
  "web/src/routes/CaseWorkflowRoute.tsx",
  "web/src/stores/caseStore.ts",
  "web/src/components/ClinicalFacePreview.tsx",
  "workers/api/package.json",
  "workers/api/src/index.ts",
  "workers/api/migrations/0001_initial.sql",
  "docs/CLINICAL_CASE_WORKFLOW_UI.md",
  "docs/BACKEND_DATA_ARCHITECTURE.md",
  "docs/CLOUDFLARE_BACKEND_ROLLOUT.md",
]) {
  assert.ok(!fs.existsSync(path.join(repositoryRoot, removedPath)), `case feature should be removed: ${removedPath}`);
}

const app = read("web/src/App.tsx");
const dashboard = read("web/src/routes/DashboardRoute.tsx");
const dataSource = read("web/src/services/dataSource.ts");
const packageJson = read("web/package.json");
const ci = read(".github/workflows/ci.yml");

for (const forbidden of ["CaseWorkflowRoute", 'path="/cases"', 'path="/case/']) {
  assert.ok(!app.includes(forbidden), `React router should not expose case workflow: ${forbidden}`);
}

for (const forbidden of [
  "ClinicalCase",
  "langerface.cases",
  "saveCase(",
  "listCases(",
  "getCase(",
]) {
  assert.ok(!dataSource.includes(forbidden), `browser data source should not persist cases: ${forbidden}`);
}

for (const forbidden of ["test_case_workflow_ui", "capture_case_workflow"]) {
  assert.ok(!packageJson.includes(forbidden), `package scripts should not reference removed case tooling: ${forbidden}`);
}

assert.ok(!ci.includes("workers/api"), "CI should not install, test, or deploy the removed case API");
assert.ok(dashboard.includes("不创建、恢复或保存病例"), "tool launcher should state the no-case-storage boundary");
assert.ok(dashboard.includes('href: "/personalized"'), "personalized 2D tool should remain available");
assert.ok(dashboard.includes('to: "/live"'), "live 2D tool should remain available");

console.log("No-case-feature boundary checks passed.");
