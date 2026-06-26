// Static UI assertions for the 3D annotation page.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const compatibilityHtml = readFileSync(join(root, "web", "annotate.html"), "utf8");
const annotateUi = [
  readFileSync(join(root, "web", "src", "components", "AnnotateDrawPanel.tsx"), "utf8"),
  readFileSync(join(root, "web", "src", "components", "AnnotateLineLibraryPanel.tsx"), "utf8"),
].join("\n");
const js = readFileSync(join(root, "web", "src", "services", "annotateRuntime.ts"), "utf8");
const css = readFileSync(join(root, "web", "annotate.css"), "utf8");
const annotateSnapshots = readFileSync(join(root, "web", "src", "services", "annotateSnapshots.ts"), "utf8");

assert.ok(compatibilityHtml.includes("/app/annotate"), "legacy annotation HTML redirects to the React annotation route");
assert.ok(!compatibilityHtml.includes("annotate_main.js"), "legacy annotation HTML no longer mounts the annotation controller directly");
assert.ok(annotateUi.includes('id="currentState"'), "React annotation page exposes current drawing state");
assert.ok(annotateUi.includes('id="lineList"'), "React annotation page exposes saved line list");
assert.ok(
  js.includes("贴面路由已退回直线，需复核可能穿面"),
  "current drawing state warns when surface routing falls back",
);
assert.ok(
  js.includes("需复核：该线存在退回直线连接，可能穿面"),
  "saved line list warns when a line contains fallback routing",
);
assert.ok(js.includes("has-warning"), "saved line warning class is wired in JS");
assert.ok(annotateSnapshots.includes("buildAnnotateSavedSummary"), "React saved-line summaries come from the shared annotation snapshot service");
assert.ok(annotateSnapshots.includes("需复核：该线存在退回直线连接，可能穿面"), "shared annotation snapshot service preserves saved-line fallback warning text");
assert.ok(js.includes("./annotateSnapshots"), "annotation controller consumes the shared annotation snapshot service");
assert.ok(css.includes(".current-state.warning"), "current state fallback warning is styled");
assert.ok(css.includes(".line-warning"), "saved fallback warning is styled");

console.log("test_annotate_ui: fallback warning UI assertions passed");
