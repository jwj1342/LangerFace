// Static UI contract checks for the incision agent workbench.
import fs from "node:fs";
import assert from "node:assert/strict";

const html = fs.readFileSync("incision_agent.html", "utf8");
const js = fs.readFileSync("incision_agent_main.js", "utf8");

assert.ok(html.includes('id="boundaryStatus"'), "workbench exposes tumor boundary status");
assert.ok(html.includes('id="exportTumorBtn"'), "workbench exposes tumor export button");
assert.ok(html.includes('id="importTumorBtn"'), "workbench exposes tumor import button");
assert.ok(html.includes('id="tumorImportFile"'), "workbench exposes hidden tumor import file input");
assert.ok(js.includes("exportTumorJson"), "workbench implements tumor JSON export");
assert.ok(js.includes("importTumorFile"), "workbench implements tumor JSON import");
assert.ok(js.includes("applyImportedTumor"), "workbench applies imported tumor payloads");
assert.ok(js.includes("summarizeTumorBoundary"), "workbench renders deterministic boundary summaries");

console.log("test_incision_agent_ui: tumor boundary IO assertions passed");
