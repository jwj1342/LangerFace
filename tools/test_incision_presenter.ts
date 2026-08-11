import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildGuardrailDetailsPresentation,
  buildIncisionResultPresentation,
  buildWorkflowComparisonPresentation,
  buildWorkflowGatePresentation,
} from "../web/src/services/incisionPresenter.ts";

const presenterSource = fs.readFileSync(
  new URL("../web/src/services/incisionPresenter.ts", import.meta.url),
  "utf8",
);
assert.ok(!presenterSource.includes("document"), "incision presenter must not access DOM globals");
assert.ok(!presenterSource.includes("window"), "incision presenter must not access window globals");
assert.ok(!presenterSource.includes("THREE"), "incision presenter must not import Three.js");

const emptyGuardrails = buildGuardrailDetailsPresentation();
assert.equal(emptyGuardrails.text, "保护提示：未发现需要复核的规则项。");
assert.deepEqual(emptyGuardrails.classNames, []);

const mediumGuardrails = buildGuardrailDetailsPresentation({
  warnings: [{ code: "candidate_near_sensitive_free_margin", severity: "medium" }],
  suggested_overrides: [{
    kind: "protective_direction",
    structure: "lower_eyelid",
    direction_hint: "parallel_to_lower_eyelid_margin_or_eyelid_crease",
  }],
});
assert.match(mediumGuardrails.text, /候选切口靠近敏感游离缘（需复核）/);
assert.match(mediumGuardrails.text, /下眼睑优先采用平行下眼睑缘或睑皱襞/);
assert.deepEqual(mediumGuardrails.classNames, ["warn"]);

const highGuardrails = buildGuardrailDetailsPresentation({
  warnings: [{ code: "candidate_near_sensitive_free_margin", severity: "high" }],
});
assert.deepEqual(highGuardrails.classNames, ["danger"]);

const hardGuardrails = buildGuardrailDetailsPresentation({
  hard_violations: [{ code: "candidate_outside_canonical_surface", recovery: "重新生成候选" }],
  warnings: [],
});
assert.match(hardGuardrails.text, /工程硬阻断：candidate_outside_canonical_surface（重新生成候选）/);
assert.deepEqual(hardGuardrails.classNames, ["danger"]);

const failedGate = buildWorkflowGatePresentation({
  passed: false,
  observed_actions: ["classify_region"],
  missing_actions: [{ label: "生成候选" }],
});
assert.equal(failedGate.text, "工作流工具门控：未通过；缺 生成候选 · 1 个动作；完整 workflow trace 已写入 DevTools Console。");
assert.equal(failedGate.title, "observed_actions=classify_region");
assert.deepEqual(failedGate.classNames, ["warn"]);

const recoveredComparison = buildWorkflowComparisonPresentation({
  candidate_comparison: [{ id: "candidate-1", rank: 1, label: "主候选", score: 8.2 }],
  workflow_audit: {
    tool_failure_count: 1,
    recovered_failures: [{ variant: "左偏 10°", tool: "guardrail", recovery: "skipped_failed_variant_and_kept_other_candidates" }],
  },
});
assert.match(recoveredComparison.text, /恢复失败 1 个（左偏 10°\/guardrail：已跳过失败变体并继续比较）/);
assert.equal(recoveredComparison.title, "recovered_failures=左偏 10°/guardrail：已跳过失败变体并继续比较");
assert.deepEqual(recoveredComparison.classNames, ["warn"]);

const presentation = buildIncisionResultPresentation({
  result: {
    candidate: {
      type: "fusiform",
      length_mm: 20,
      width_mm: 5,
      tip_angle_deg: 30,
      edited: true,
      metrics: { length_to_width_ratio: 4, tip_angle_error_deg: 2, rstl_deviation_deg: 1 },
    },
    direction: { source: "rstl_atlas_weighted_nearest", confidence: 0.2, support_count: 3, angular_spread_deg: 4 },
    anatomy: { region: "cheek" },
    guardrails: { passed: false, warnings: [], suggested_overrides: [] },
    summary: "候选摘要",
    next_step: "医生复核",
  },
  workflowGate: { passed: true, observed_actions: [], missing_actions: [] },
  tumorQuality: { warning_count: 1, warnings: [{ code: "missing_tumor_author", severity: "medium" }] },
  secondaryCuesPresent: true,
  generationCount: 2,
  headStatusLabel: "标准脸",
  privacyAudit: { local_workflow_fields: ["tumor"], secondary_cues_present: true },
});
assert.equal(presentation.candidateType, "梭形");
assert.equal(presentation.candidateWidth, "5.0 mm / 4.00:1");
assert.equal(presentation.candidateRstlDeviation, "1.0°");
assert.match(presentation.guardrailDetails.text, /肿物输入：缺少记录者（需复核）/);
assert.match(presentation.directionSource.text, /皱襞\/边界辅助线索：只读审阅，不参与几何/);
assert.match(presentation.directionSource.text, /医生人工覆盖已记录/);
assert.deepEqual(presentation.directionSource.classNames, ["warn"]);
assert.equal(presentation.stageStatus, "浏览器确定性 workflow 已更新候选 · 已明确生成 2 次 · 已记录医生调整 · 标准脸");

console.log("test_incision_presenter: pure guardrail, workflow, candidate, and tumor-quality presentations passed");
