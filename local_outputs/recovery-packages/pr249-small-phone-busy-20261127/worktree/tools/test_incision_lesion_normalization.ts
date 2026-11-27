import assert from "node:assert/strict";

import {
  INCISION_LESION_NORMALIZATION_SCHEMA,
  normalizePlanningLesion,
} from "../web/src/services/incisionLesionNormalization.ts";

const controlled = normalizePlanningLesion({
  center: [0, 0, 0],
  boundary: [[1, 1, 0], [3, 1, 0], [3, 3, 0], [1, 3, 0]],
  diameter_mm: 12,
  boundary_mode: "controlled_marker",
  boundary_source: "controlled_marker_confirmed",
}, 0.1);

assert.equal(controlled.schema, INCISION_LESION_NORMALIZATION_SCHEMA);
assert.equal(controlled.applied, true);
assert.equal(controlled.status, "normalized");
assert.equal(controlled.boundary_role, "planning_scale");
assert.deepEqual(controlled.planning_center, [0, 0, 0],
  "boundary measurements cannot replace the detector-confirmed lesion center");
assert.deepEqual(controlled.detected_centroid?.map((value) => Number(value.toFixed(9))), [2, 2, 0],
  "the boundary centroid remains available for audit without becoming the planning center");
assert.ok(Math.abs(controlled.planning_diameter_mm - (controlled.detected_enclosing_diameter_mm || 0)) < 1e-9,
  "controlled cutaneous planning uses a class-round diameter that encloses the detected region");
assert.ok(controlled.planning_diameter_mm > (controlled.detected_equivalent_diameter_mm || 0),
  "the class-round planning circle covers polygon corners instead of using an equal-area circle that can clip them");
assert.ok(Math.abs((controlled.detected_area_mm2 || 0) - 400) < 1e-9);
assert.ok((controlled.detected_equivalent_diameter_mm || 0) > 22);
assert.equal(controlled.clinical_scale_source, "controlled_marker_enclosing_circle");
assert.equal(controlled.clinical_scale_status, "derived_from_detected_boundary");

const manualFreehand = normalizePlanningLesion({
  center: [0, 0, 0],
  boundary: [[1, 1, 0], [3, 1, 0], [3, 3, 0], [1, 3, 0]],
  diameter_mm: 12,
  boundary_mode: "freehand",
  boundary_source: "manual_freehand",
}, 0.1);
assert.equal(manualFreehand.applied, true, "manual freehand uses the same boundary-scale contract as controlled marker");
assert.equal(manualFreehand.status, "normalized");
assert.deepEqual(manualFreehand.planning_center, [0, 0, 0]);
assert.ok(Math.abs(manualFreehand.planning_diameter_mm - (manualFreehand.detected_enclosing_diameter_mm || 0)) < 1e-9,
  "manual freehand scale comes from the drawn boundary rather than the operator slider");
assert.equal(manualFreehand.clinical_scale_source, "manual_freehand_enclosing_circle");
const manualFreehandWithDifferentSlider = normalizePlanningLesion({
  center: [0, 0, 0],
  boundary: [[1, 1, 0], [3, 1, 0], [3, 3, 0], [1, 3, 0]],
  diameter_mm: 36,
  boundary_mode: "freehand",
  boundary_source: "manual_freehand",
}, 0.1);
assert.equal(manualFreehandWithDifferentSlider.planning_diameter_mm, manualFreehand.planning_diameter_mm,
  "changing the disabled diameter slider cannot resize manual-freehand planning");

const degenerate = normalizePlanningLesion({
  center: [1, 2, 3],
  boundary: [[0, 0, 0], [1, 0, 0], [2, 0, 0]],
  diameter_mm: 9,
  boundary_mode: "controlled_marker",
}, 0.1);
assert.equal(degenerate.applied, false);
assert.equal(degenerate.status, "degenerate_boundary");
assert.deepEqual(degenerate.planning_center, [1, 2, 3]);
assert.equal(degenerate.detected_equivalent_diameter_mm, null);
assert.equal(degenerate.detected_enclosing_diameter_mm, null);

console.log("test_incision_lesion_normalization: controlled-marker and manual-freehand boundary scale passed");
