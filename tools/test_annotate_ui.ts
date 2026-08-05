// Static UI assertions for the 3D annotation page.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAnnotationSessionGuard } from "../web/src/services/annotationSession.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const compatibilityHtml = readFileSync(join(root, "web", "annotate.html"), "utf8");
const annotateUi = [
  readFileSync(join(root, "web", "src", "components", "AnnotateDrawPanel.tsx"), "utf8"),
  readFileSync(join(root, "web", "src", "components", "AnnotateLineLibraryPanel.tsx"), "utf8"),
].join("\n");
const js = readFileSync(join(root, "web", "src", "services", "annotateRuntime.ts"), "utf8");
const css = readFileSync(join(root, "web", "annotate.css"), "utf8");
const annotateSnapshots = readFileSync(join(root, "web", "src", "services", "annotateSnapshots.ts"), "utf8");
const annotationSession = readFileSync(join(root, "web", "src", "services", "annotationSession.ts"), "utf8");

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
assert.ok(annotationSession.includes("createAnnotationSessionGuard"), "annotation session guard is provided by a dedicated service");
assert.ok(!/\b(?:document|window|HTML\w*|THREE)\b/.test(annotationSession), "annotation session guard stays independent from browser and Three.js APIs");
assert.ok(js.includes("createAnnotationSessionGuard"), "annotation runtime consumes the shared session guard");
assert.ok(js.includes("activeSession.dispose()"), "annotation runtime invalidates the active session on dispose");
assert.ok(js.includes("activeSession.mount()"), "annotation runtime creates a fresh session on mount");

const sessionGuard = createAnnotationSessionGuard();
assert.ok(!sessionGuard.isMounted(), "new annotation session guard starts unmounted");
const firstSession = sessionGuard.mount();
assert.ok(sessionGuard.isMounted(), "mount marks the annotation session active");
assert.ok(sessionGuard.isActive(firstSession), "mounted annotation session is active");
sessionGuard.dispose();
assert.ok(!sessionGuard.isMounted(), "dispose marks the annotation session inactive");
assert.ok(!sessionGuard.isActive(firstSession), "dispose invalidates pending work from the old annotation session");
sessionGuard.dispose();
assert.ok(!sessionGuard.isMounted(), "repeated dispose keeps the annotation session inactive");
assert.ok(!sessionGuard.isActive(firstSession), "repeated dispose remains idempotent");
const secondSession = sessionGuard.mount();
assert.notEqual(secondSession, firstSession, "remount receives a distinct annotation session token");
assert.ok(sessionGuard.isActive(secondSession), "remount activates its new annotation session");
assert.ok(!sessionGuard.isActive(firstSession), "old async work cannot become active after remount");

console.log("test_annotate_ui: fallback warning UI assertions passed");
