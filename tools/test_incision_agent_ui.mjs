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
assert.ok(html.includes('id="guardrailDetails"'), "workbench exposes guardrail detail feedback");
assert.ok(html.includes('id="approveCandidateBtn"'), "workbench exposes candidate approval action");
assert.ok(html.includes('id="rejectCandidateBtn"'), "workbench exposes candidate rejection action");
assert.ok(html.includes('id="candidateWidth"'), "workbench exposes fusiform width and ratio metric");
assert.ok(html.includes('id="candidateTipAngle"'), "workbench exposes fusiform tip angle metric");
assert.ok(js.includes("exportTumorJson"), "workbench implements tumor JSON export");
assert.ok(js.includes("importTumorFile"), "workbench implements tumor JSON import");
assert.ok(js.includes("applyImportedTumor"), "workbench applies imported tumor payloads");
assert.ok(js.includes("summarizeTumorBoundary"), "workbench renders deterministic boundary summaries");
assert.ok(js.includes("tip_angle_error_deg"), "workbench renders fusiform tip angle error");
assert.ok(js.includes("incision-review-record/v0.3"), "review records use explicit review workflow schema");
assert.ok(js.includes("approved_for_discussion"), "review records support clinician approval");
assert.ok(js.includes("rejected_by_clinician"), "review records support clinician rejection");
assert.ok(js.includes("audit_events"), "review records include audit events");
assert.ok(js.includes("guardrail_summary"), "review records include guardrail summary");
assert.ok(js.includes("review_gate"), "review records include review gate state");
assert.ok(js.includes("candidate_comparison"), "review export includes candidate comparison");
assert.ok(js.includes("不是临床推荐或手术指令"), "candidate comparison warns it is not clinical recommendation");
assert.ok(js.includes("reviewReadiness"), "review workflow validates approval readiness");
assert.ok(js.includes("highGuardrailWarnings"), "review workflow detects high guardrail warnings");
assert.ok(js.includes("live_overlay_ready"), "review gate records live overlay readiness");
assert.ok(js.includes("handleAgentStreamEvent"), "workbench consumes agent SSE trace events");
assert.ok(js.includes("stream: true"), "workbench prefers streaming agent trace");
assert.ok(js.includes("SSE trace 不可用"), "workbench reports JSON fallback when streaming is unavailable");
assert.ok(js.includes("建议覆盖项"), "markdown report includes suggested override details");
assert.ok(js.includes("最近敏感游离缘"), "markdown report includes sensitive free-margin distance");
assert.ok(js.includes("候选版本"), "markdown report includes candidate version provenance");
assert.ok(js.includes("发送到实时叠加前，请先确认当前候选草案"), "live overlay requires candidate approval");
assert.ok(js.includes("当前候选有高风险 guardrail"), "high-risk approval requires review notes");

console.log("test_incision_agent_ui: tumor boundary IO and review workflow assertions passed");
