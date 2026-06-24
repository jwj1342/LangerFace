// Static UI contract checks for the incision agent workbench.
import fs from "node:fs";
import assert from "node:assert/strict";

const html = fs.readFileSync("incision_agent.html", "utf8");
const js = fs.readFileSync("incision_agent_main.js", "utf8");

assert.ok(html.includes('id="boundaryStatus"'), "workbench exposes tumor boundary status");
assert.ok(html.includes('id="exportTumorBtn"'), "workbench exposes tumor export button");
assert.ok(html.includes('id="importTumorBtn"'), "workbench exposes tumor import button");
assert.ok(html.includes('id="tumorImportFile"'), "workbench exposes hidden tumor import file input");
assert.ok(html.includes('id="reviewerName"'), "workbench captures clinician reviewer identity");
assert.ok(html.includes('id="reviewDecision"'), "workbench exposes clinician review decision");
assert.ok(html.includes('id="reviewNotes"'), "workbench exposes clinician review notes");
assert.ok(html.includes('id="approveCandidateBtn"'), "workbench exposes candidate approval action");
assert.ok(html.includes('id="rejectCandidateBtn"'), "workbench exposes candidate rejection action");
assert.ok(js.includes("exportTumorJson"), "workbench implements tumor JSON export");
assert.ok(js.includes("importTumorFile"), "workbench implements tumor JSON import");
assert.ok(js.includes("applyImportedTumor"), "workbench applies imported tumor payloads");
assert.ok(js.includes("summarizeTumorBoundary"), "workbench renders deterministic boundary summaries");
assert.ok(js.includes("incision-review-record/v0.3"), "review records use explicit review workflow schema");
assert.ok(js.includes("approved_for_discussion"), "review records support clinician approval");
assert.ok(js.includes("rejected_by_clinician"), "review records support clinician rejection");
assert.ok(js.includes("audit_events"), "review records include audit events");

console.log("test_incision_agent_ui: tumor boundary IO and review workflow assertions passed");
