import assert from "node:assert/strict";

import {
  IncisionEditHistory,
  incisionEditIsActive,
  incisionEditsEqual,
  neutralIncisionEdit,
} from "../web/src/services/incisionEditHistory.ts";

const history = new IncisionEditHistory();
const neutral = neutralIncisionEdit();
assert.equal(incisionEditIsActive(neutral), false);
assert.deepEqual(history.summary(neutral), {
  committedCount: 0,
  historyCount: 0,
  version: 1,
  uncommitted: false,
  canUndo: false,
  canRedo: false,
});

const angleEdit = { ...neutral, angle_offset_deg: 12 };
assert.equal(incisionEditIsActive(angleEdit), true);
assert.deepEqual(history.entriesFor(angleEdit), [{
  ...angleEdit,
  source: "web/incision_workflow",
  interaction: "live_preview_uncommitted_edit",
  history_index: 1,
}]);

assert.equal(history.commit(angleEdit, "control_change", "2026-07-29T00:00:00.000Z"), true);
assert.equal(history.commit(angleEdit, "control_change", "2026-07-29T00:00:01.000Z"), false);
assert.deepEqual(history.summary(angleEdit), {
  committedCount: 1,
  historyCount: 1,
  version: 2,
  uncommitted: false,
  canUndo: true,
  canRedo: false,
});

const reasonEdit = { ...angleEdit, reason: "clinician adjustment" };
assert.equal(history.commit(reasonEdit, "reason_change", "2026-07-29T00:00:02.000Z"), true);
assert.ok(incisionEditsEqual(history.undo() || {}, angleEdit));
assert.equal(history.summary(angleEdit).canRedo, true);

const shiftedEdit = { ...angleEdit, shift_perp_mm: 2 };
assert.equal(history.commit(shiftedEdit, "endpoint_drag", "2026-07-29T00:00:03.000Z"), true);
assert.equal(history.summary(shiftedEdit).canRedo, false);
assert.deepEqual(
  history.entriesFor(shiftedEdit).map((entry) => entry.interaction),
  ["control_change", "endpoint_drag"],
);

history.reset();
assert.deepEqual(history.summary(neutral), {
  committedCount: 0,
  historyCount: 0,
  version: 1,
  uncommitted: false,
  canUndo: false,
  canRedo: false,
});

console.log("test_incision_edit_history: commit, preview, undo/redo, and branch truncation passed");
