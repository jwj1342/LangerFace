// Dependency-free tests for web/incision_tools.js.
import { __incisionToolsForTests as T } from "../web/incision_tools.js";

let passed = 0;
function ok(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  passed++;
}
function near(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

const verts = [
  [0, 0, 0],
  [10, 0, 0],
  [0, 10, 0],
  [10, 10, 0],
];
const tris = [[0, 1, 2], [1, 3, 2]];
const atlas = {
  system: "rstl",
  lines: [{
    name: "horizontal_rstl",
    region: "cheek",
    points: [
      [0, 0.7, 0.1],
      [0, 0.35, 0.45],
      [0, 0.0, 0.8],
    ],
  }],
};

const direction = T.queryDirection([4, 2, 0], verts, tris, atlas);
ok(direction.confidence > 0.5, "queryDirection returns useful confidence near atlas line");
ok(Math.abs(direction.vector[0]) > 0.95, "queryDirection follows horizontal atlas tangent");

const linear = T.generateLinearIncision(
  { kind: "subcutaneous", center: [4, 2, 0], diameter_mm: 10, depth_mm: 5 },
  { vector: [1, 0, 0], confidence: 0.9 },
  0.1,
);
ok(linear.type === "linear", "linear candidate generated");
ok(near(linear.length_mm, 12.5), "linear length follows multiplier");
ok(near(linear.endpoints[0][0], 3.375) && near(linear.endpoints[1][0], 4.625), "linear endpoints centered on tumor");

const fusiform = T.generateFusiformIncision(
  { kind: "cutaneous", center: [4, 2, 0], diameter_mm: 8, margin_mm: 2 },
  { vector: [1, 0, 0], confidence: 0.9 },
  0.1,
  [0, 0, 1],
);
ok(fusiform.type === "fusiform", "fusiform candidate generated");
ok(near(fusiform.width_mm, 12), "fusiform width includes margins");
ok(near(fusiform.length_mm, 36), "fusiform length uses 3:1 default");
ok(fusiform.outline.length > 20, "fusiform outline is renderable");

const anatomy = T.classifyRegion([3, 6, 0], verts);
const guard = T.evaluateGuardrails({ direction_confidence: 0.8 }, anatomy);
ok(anatomy.region === "lower_eyelid", "region classifier reaches sensitive lower eyelid bucket");
ok(guard.passed === false && guard.warnings.some((w) => w.severity === "high"), "guardrails flag sensitive region");

const plan = T.planIncisionDeterministic({
  tumor: { kind: "subcutaneous", center: [4, 2, 0], diameter_mm: 10, depth_mm: 5 },
  verts,
  tris,
  atlas,
});
ok(plan.trace.length === 4, "deterministic plan records four tool calls");
ok(plan.candidate.type === "linear", "deterministic plan returns candidate");

const edited = T.applyCandidateEdit(plan, {
  angle_offset_deg: 20,
  length_scale: 1.2,
  shift_along_mm: 1,
  shift_perp_mm: -0.5,
  reason: "manual free-margin protection",
}, [0, 0, 1], 0.1);
ok(edited.candidate.edited === true, "edited candidate is marked");
ok(near(edited.candidate.length_mm, 15), "edited linear length is recalculated");
ok(near(edited.candidate.metrics.rstl_deviation_deg, 20), "edited candidate records RSTL deviation");
ok(edited.candidate.provenance.clinician_edit.reason.includes("free-margin"), "edited candidate records override reason");
ok(edited.trace.some((step) => step.action === "clinician_edit_candidate"), "edited plan adds trace step");
ok(edited.guardrails.warnings.some((w) => w.code === "rstl_deviation_override"), "edited deviation triggers guardrail warning");

console.log(`test_incision_tools: ${passed} assertions passed`);
