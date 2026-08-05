import assert from "node:assert/strict";

import {
  applyCurveRefinementTransport,
  buildCurveRefinementTransport,
  curveEraseTargets,
  deformCurveWide,
} from "../web/src/services/liveRefineMath.ts";

const automatic = [{ name: "left", pts: [[10, 20, 0], [20, 20, 0], [30, 20, 0]] }];
const deformed = deformCurveWide(automatic[0].pts, 1, [20, 28], { width: 100, height: 100 });
assert.deepEqual(deformed[1].slice(0, 2), [20, 28], "grabbed point must follow the pointer exactly");
assert.ok(deformed[0][1] > 20 && deformed[2][1] > 20, "curve-wide falloff must move neighbouring points smoothly");

const transport = buildCurveRefinementTransport(automatic, [{ ...automatic[0], pts: deformed }]);
const nextFrame = [{ name: "left", pts: [[20, 40, 0], [40, 40, 0], [60, 40, 0]] }];
const transported = applyCurveRefinementTransport(nextFrame, transport, { width: 100, height: 100 });
assert.ok(transported[0].pts[1][1] > 50, "frozen-frame normal edit must scale onto a later live frame");
assert.deepEqual(curveEraseTargets(2, 7, true), [2, 7], "symmetry erase must include the partner curve");
assert.deepEqual(curveEraseTargets(2, 7, false), [2], "independent erase must affect only the selected curve");

console.log("test_live_refine: curve deformation, transport, and symmetric erase passed");
