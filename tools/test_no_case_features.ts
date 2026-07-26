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
  "docs/CLINICAL_CASE_WORKFLOW_UI.md",
  "docs/BACKEND_DATA_ARCHITECTURE.md",
  "docs/CLOUDFLARE_BACKEND_ROLLOUT.md",
]) {
  assert.ok(!fs.existsSync(path.join(repositoryRoot, removedPath)), `case feature should be removed: ${removedPath}`);
}

const app = read("web/src/App.tsx");
const dashboard = read("web/src/routes/DashboardRoute.tsx");
const dataSource = read("web/src/services/dataSource.ts");
const currentRefine = read("web/current/refine2d.js");
const currentHtml = read("web/current/index.html");
const packageJson = read("web/package.json");
const ci = read(".github/workflows/ci.yml");
const deploymentDoc = read("docs/CI_CD_VERCEL.md");
const frontendAndCi = [
  readSourceTree("web/current"),
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
  assert.ok(!currentRefine.includes(forbidden), `patient-derived 2D refinement should not persist: ${forbidden}`);
}
assert.ok(!currentHtml.includes("refineSaveBtn"), "current live UI should not offer persistent refinement save");
assert.ok(!deploymentDoc.includes("VITE_API_BASE_URL"), "deployment docs should not direct the frontend to a removed case API");
assert.ok(!deploymentDoc.includes("Worker API、D1、R2"), "deployment docs should not retain the removed case backend plan");
assert.ok(dashboard.includes("不创建、恢复或保存病例"), "tool launcher should state the no-case-storage boundary");
assert.ok(dashboard.includes('href: "/personalized"'), "personalized 2D tool should remain available");
assert.ok(dashboard.includes('to: "/live"'), "live 2D tool should remain available");

console.log("No-case-feature boundary checks passed.");
