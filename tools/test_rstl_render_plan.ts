import assert from "node:assert/strict";

import {
  buildRstlRenderPlan,
  standardRstlStrokeWidth,
} from "../web/src/services/rstlRenderPlan.ts";
import type { MappedAtlasLine } from "../web/src/services/geometryAtlas.ts";
import type { Triangle, Vec3 } from "../web/src/services/softBody.ts";

assert.equal(standardRstlStrokeWidth(650), 2);
assert.equal(standardRstlStrokeWidth(2600), 2);
assert.equal(standardRstlStrokeWidth(3900), 3);

const landmarks = Array.from({ length: 478 }, () => [50, 50, 0] as Vec3);
landmarks[1] = [0, 100, 0];
landmarks[2] = [100, 100, 0];
landmarks[10] = [50, 10, 0];
landmarks[20] = [20, 20, 0];
landmarks[21] = [40, 20, 0];
landmarks[22] = [20, 40, 0];
landmarks[78] = [35, 55, 0];
landmarks[80] = [50, 55, 0];
landmarks[88] = [42, 65, 0];

const triangles: Triangle[] = [
  [20, 21, 22],
  [78, 80, 88],
];
const lines: MappedAtlasLine[] = [
  {
    name: "cheek",
    region: "cheek",
    pts: [[20, 20, 0], [30, 25, 0], [20, 40, 0]],
    tris: [0, 0, 0],
  },
  {
    name: "mouth-opening",
    region: "mouth",
    pts: [[35, 55, 0], [45, 58, 0], [42, 65, 0]],
    tris: [1, 1, 1],
  },
  {
    name: "extended-forehead",
    region: "forehead_bridge_arc_v15",
    pts: [[50, -40, 0], [50, 10, 0], [50, 20, 0], [50, 30, 0], [50, 40, 0]],
    tris: [0, 0, 0, 0, 0],
  },
];

const plan = buildRstlRenderPlan({
  lines,
  landmarks,
  triangles,
  clip: true,
  densityFraction: 1,
  skinVisible: (point) => Boolean(point && point[1] >= 20),
});
assert.equal(plan.length, 3, "density-selected lines retain stable counting semantics");
assert.deepEqual(plan[0].runs, [lines[0].pts]);
assert.deepEqual(plan[1].runs, [], "mouth-opening triangles are always excluded from drawing");
assert.deepEqual(plan[2].runs, [[[50, 20, 0], [50, 30, 0], [50, 40, 0]]]);

const handOccluded = buildRstlRenderPlan({
  lines: [lines[0]],
  landmarks,
  triangles,
  clip: false,
  handMasks: [{
    palm: [[15, 15], [35, 15], [35, 45], [15, 45]],
    bones: [],
    r: 0,
  }],
});
assert.deepEqual(handOccluded[0].runs, [], "a hand mask can split away the complete short line");

const densityPlan = buildRstlRenderPlan({
  lines: Array.from({ length: 4 }, (_, index) => ({
    name: `line-${index}`,
    region: "cheek",
    pts: [[20, 20 + index, 0], [40, 20 + index, 0]],
    tris: [0, 0],
  })),
  landmarks,
  triangles,
  clip: false,
  densityFraction: 0.5,
});
assert.equal(densityPlan.length, 2, "density selection is part of the shared render plan");

console.log("test_rstl_render_plan: shared RSTL visibility and width contract passed");
