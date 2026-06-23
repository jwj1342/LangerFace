import assert from "node:assert/strict";
import { ATLAS_VERSION } from "../web/constants.js";
import { validateAtlas } from "../web/atlas_contract.js";

function atlas(overrides = {}) {
  return {
    system: "rstl",
    version: ATLAS_VERSION,
    lines: [{
      name: "test",
      region: "test",
      points: [[0, 0.3, 0.3], [1, 0.2, 0.2]],
    }],
    ...overrides,
  };
}

assert.deepEqual(validateAtlas(atlas(), 2, { expectedSystem: "rstl" }), []);
assert.match(validateAtlas(atlas({ lines: [] }), 2, { expectedSystem: "rstl" }).join(";"), /不含任何曲线/);
assert.match(validateAtlas(atlas({ lines: [{ name: "short", points: [[0, 0.2, 0.2]] }] }), 2).join(";"), /点数 < 2/);
assert.match(validateAtlas(atlas({ lines: [{ name: "tri", points: [[9, 0.2, 0.2], [9, 0.3, 0.3]] }] }), 2).join(";"), /三角面索引越界/);
assert.match(validateAtlas(atlas({ lines: [{ name: "bary", points: [[0, 1.2, 0.2], [1, 0.3, 0.3]] }] }), 2).join(";"), /重心坐标越界/);
assert.match(validateAtlas(atlas({ system: "langer" }), 2, { expectedSystem: "rstl" }).join(";"), /system/);
assert.match(validateAtlas(atlas({ version: "0.1" }), 2, { expectedSystem: "rstl" }).join(";"), /version/);

console.log("ok: atlas runtime contract validation");
