// Static UI assertions for the 3D annotation page.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "web", "annotate.html"), "utf8");
const js = readFileSync(join(root, "web", "annotate_main.js"), "utf8");
const css = readFileSync(join(root, "web", "annotate.css"), "utf8");

assert.ok(html.includes('id="currentState"'), "annotation page exposes current drawing state");
assert.ok(html.includes('id="lineList"'), "annotation page exposes saved line list");
assert.ok(
  js.includes("贴面路由已退回直线，需复核可能穿面"),
  "current drawing state warns when surface routing falls back",
);
assert.ok(
  js.includes("需复核：该线存在退回直线连接，可能穿面"),
  "saved line list warns when a line contains fallback routing",
);
assert.ok(js.includes("has-warning"), "saved line warning class is wired in JS");
assert.ok(css.includes(".current-state.warning"), "current state fallback warning is styled");
assert.ok(css.includes(".line-warning"), "saved fallback warning is styled");

console.log("test_annotate_ui: fallback warning UI assertions passed");
