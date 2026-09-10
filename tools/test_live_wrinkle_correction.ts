import assert from "node:assert/strict";
import { evaluateWrinkleCorrection } from
  "../web/src/services/liveWrinkleCorrection.ts";

const line = (className: string, y: number, dx = 0) => ({
  className,
  points: Array.from({ length: 12 }, (_, index) => [40 + dx + index * 4, y] as [number, number]),
});
const current = [line("forehead", 50), line("wrinkle", 90)];

const accepted = evaluateWrinkleCorrection({
  current,
  candidate: [line("forehead", 52, 1), line("wrinkle", 92, 1)],
  faceWidthPx: 180,
  yoloScores: [0.18, 0.22],
  yoloConfidenceThreshold: 0.07,
});
assert.equal(accepted.accepted, true, "nearby confident detections correct accumulated drift");

const jump = evaluateWrinkleCorrection({
  current,
  candidate: [line("forehead", 120), line("wrinkle", 145)],
  faceWidthPx: 180,
  yoloScores: [0.18, 0.22],
  yoloConfidenceThreshold: 0.07,
});
assert.equal(jump.accepted, false, "a spatially inconsistent detection cannot replace tracking");
assert.equal(jump.reason, "spatial-mismatch");

const weak = evaluateWrinkleCorrection({
  current,
  candidate: [line("forehead", 51), line("wrinkle", 91)],
  faceWidthPx: 180,
  yoloScores: [0.071, 0.072],
  yoloConfidenceThreshold: 0.07,
});
assert.equal(weak.accepted, false, "detections at the model floor fail confidence gating");
assert.equal(weak.reason, "low-yolo-confidence");

const collapsed = evaluateWrinkleCorrection({
  current: [...current, line("wrinkle", 110), line("wrinkle", 125)],
  candidate: [line("forehead", 51)],
  faceWidthPx: 180,
  yoloScores: [0.2],
  yoloConfidenceThreshold: 0.07,
});
assert.equal(collapsed.accepted, false, "a large line-count collapse cannot erase stable evidence");
assert.equal(collapsed.reason, "count-change");

console.log("ok: low-frequency YOLO correction confidence gate");
