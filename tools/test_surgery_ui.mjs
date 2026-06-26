// Static UI assertions for the surgery closure demo.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "web", "surgery.html"), "utf8");
const js = readFileSync(join(root, "web", "surgery_main.js"), "utf8");

assert.ok(html.includes("沿 RSTL 闭合演示"), "surgery page keeps the along-RSTL closure title");
assert.ok(html.includes('id="btnAlong"'), "surgery page exposes the along-RSTL action");
assert.equal((html.match(/id="btnAlong"/g) || []).length, 1, "surgery page has exactly one cut action");
assert.ok(!html.includes("逆 RSTL 切除"), "surgery page does not expose inverse-RSTL action copy");
assert.ok(!html.includes("不好"), "surgery page avoids good/bad binary comparison copy");
assert.ok(!html.includes("btnAcross"), "surgery page does not expose an inverse-RSTL button");
assert.ok(!js.includes("btnAcross"), "surgery controller does not bind an inverse-RSTL UI action");
assert.ok(!js.includes("cut-across"), "surgery controller does not style an inverse-RSTL UI action");

console.log("test_surgery_ui: along-RSTL-only closure UI assertions passed");
