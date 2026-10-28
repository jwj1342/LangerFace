import fs from "node:fs";
import assert from "node:assert/strict";

const controller = fs.readFileSync(new URL("../web/src/services/workflowIncisionController.ts", import.meta.url), "utf8");
const start = controller.indexOf("async function runWorkflow(");
const end = controller.indexOf("function ", start + 30);
const workflow = controller.slice(start, end);
assert(start >= 0 && workflow.includes("queryIncisionPhotoRstlDirection"));
assert.doesNotMatch(workflow, /centerRef:\s*candidateCenterRef/,
  "moving a fusiform envelope must not re-anchor the RSTL query at the incision center");
assert.match(workflow, /direction_query_center:\s*"lesion_center"/,
  "audit must name the lesion-center anchor, not the movable incision center");
console.log("PASS workflow lesion-center direction anchor contract");
