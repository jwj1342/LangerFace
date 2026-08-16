import assert from "node:assert/strict";

import { queryDirection } from "../web/src/services/incisionToolCore.ts";
import {
  INCISION_LOCAL_RSTL_DIRECTION_SCHEMA,
  queryIncisionLocalRstlDirection,
} from "../web/src/services/incisionLocalRstlDirection.ts";

const verts = [[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 10, 0]];
const tris = [[0, 1, 2], [1, 3, 2]] as [number, number, number][];

const nearestVertical = queryIncisionLocalRstlDirection([5, 5, 0], verts, tris, {
  lines: [
    { name: "local_vertical", points3d: [[5, 4, 0], [5, 6, 0]] },
    { name: "nearby_horizontal", points3d: [[4, 5.02, 0], [6, 5.02, 0]] },
  ],
});
assert.equal(nearestVertical.schema, INCISION_LOCAL_RSTL_DIRECTION_SCHEMA);
assert.equal(nearestVertical.source, "rstl_atlas_nearest_segment");
assert.equal(nearestVertical.line_id, "local_vertical");
assert.equal(nearestVertical.line_index, 0);
assert.equal(nearestVertical.segment_index, 0);
assert.ok(Math.abs(nearestVertical.vector[1]) > 0.999999);
assert.equal(nearestVertical.support_count, 1, "incision direction comes from exactly one nearest segment");

const repeated = Array.from({ length: 100 }, () => queryIncisionLocalRstlDirection([5, 5, 0], verts, tris, {
  lines: [
    { name: "local_vertical", points3d: [[5, 4, 0], [5, 6, 0]] },
    { name: "nearby_horizontal", points3d: [[4, 5.02, 0], [6, 5.02, 0]] },
  ],
}));
assert.ok(repeated.every((result) => result.line_id === "local_vertical" && result.angle_deg === repeated[0].angle_deg),
  "nearest-segment selection is deterministic");

const exactTie = queryIncisionLocalRstlDirection([5, 5, 0], verts, tris, {
  lines: [
    { name: "stable_first", points3d: [[4, 5, 0], [6, 5, 0]] },
    { name: "conflicting_second", points3d: [[5, 4, 0], [5, 6, 0]] },
  ],
});
assert.equal(exactTie.line_id, "stable_first", "an exact tie uses stable atlas order instead of cross-line averaging");
assert.ok(exactTie.confidence <= 0.25);
assert.ok(exactTie.confidence_reasons.includes("equidistant_rstl_segments"));

const barycentric = queryIncisionLocalRstlDirection([4, 2, 0], verts, tris, {
  lines: [{ name: "barycentric_horizontal", points: [[0, 0.7, 0.1], [0, 0.35, 0.45], [0, 0, 0.8]] }],
});
assert.equal(barycentric.line_id, "barycentric_horizontal");
assert.ok(Math.abs(barycentric.vector[0]) > 0.999999);

const empty = queryIncisionLocalRstlDirection([4, 2, 0], verts, tris, { lines: [] });
assert.equal(empty.confidence, 0);
assert.equal(empty.source, "rstl_atlas_empty");
assert.ok(empty.confidence_reasons.includes("empty_atlas"));

const sharedDirection = queryDirection([5, 5, 0], verts, tris, {
  lines: [{ name: "shared_horizontal", points3d: [[4, 5, 0], [6, 5, 0]] }],
});
assert.equal(sharedDirection.source, "rstl_atlas_weighted_nearest",
  "the existing shared TypeScript/Python direction contract remains unchanged");

console.log("test_incision_local_rstl_direction: nearest-segment consumer and shared-contract protection passed");
