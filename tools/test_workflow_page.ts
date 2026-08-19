import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

const app = read("web/src/App.tsx");
const route = read("web/src/routes/WorkflowRoute.tsx");
const workbench = read("web/src/routes/WorkflowWorkbench.tsx");
const layout = read("web/src/components/WorkflowLayout.tsx");
const sharedLayout = read("web/src/components/WorkbenchLayout.tsx");
const styles = read("web/src/styles.css");

assert.match(app, /path="\/app\/workflow"\s+element={<WorkflowRoute\s*\/>}/, "workflow route stays inside the React SPA");
assert.match(route, /import\("\.\.\/services\/liveRuntime"\)/, "workflow route reuses the live media runtime");
assert.doesNotMatch(route, /incisionRuntime/, "workflow route must not mount the legacy incision runtime beside liveRuntime");
assert.equal((workbench.match(/<LiveStagePanel\s*\/>/g) || []).length, 1, "workflow renders one visible live stage");
assert.match(layout, /<WorkbenchLayout/, "workflow reuses the shared workbench shell");
assert.match(layout, /workflow-live-rail/, "workflow exposes a dedicated RSTL rail");
assert.match(layout, /workflow-incision-rail/, "workflow exposes a dedicated incision rail");
assert.match(sharedLayout, /secondarySidebar/, "shared workbench shell owns the optional third-column primitive");
assert.match(styles, /grid-template-columns:\s*clamp\(240px,\s*17vw,\s*280px\)\s+minmax\(640px,\s*1fr\)\s+clamp\(280px,\s*20vw,\s*340px\)/, "desktop layout reserves a large central canvas column");
assert.match(styles, /\.workflow-workbench \.zoom-strip\s*{[^}]*max-height:/s, "zoom strip is bounded so it cannot crowd out the main face canvas");
assert.match(styles, /@media \(max-width:\s*1180px\)\s*{[\s\S]*?\.workflow-workbench\.app\s*{[\s\S]*?grid-template-columns:\s*1fr;/, "workflow collapses before its three-column minimum can overflow");

console.log("test_workflow_page: routed single-runtime layout boundary passed");
