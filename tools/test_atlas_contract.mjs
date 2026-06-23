import assert from "node:assert/strict";
import { ATLAS_VERSION, TOPOLOGY_ID, TOPOLOGY_VERSION } from "../web/constants.js";
import { resolveAtlasForInjection, validateAtlas } from "../web/atlas_contract.js";

function atlas(overrides = {}) {
  return {
    system: "rstl",
    version: ATLAS_VERSION,
    topologyId: TOPOLOGY_ID,
    topologyVersion: TOPOLOGY_VERSION,
    lines: [{
      name: "test",
      region: "test",
      points: [[0, 0.3, 0.3], [1, 0.2, 0.2]],
    }],
    ...overrides,
  };
}

assert.deepEqual(validateAtlas(atlas(), 2, { expectedSystem: "rstl" }), []);
assert.deepEqual(validateAtlas(atlas(), 2, { expectedSystem: "rstl", expectedTopologyId: TOPOLOGY_ID }), []);
assert.match(validateAtlas(atlas({ lines: [] }), 2, { expectedSystem: "rstl" }).join(";"), /不含任何曲线/);
assert.match(validateAtlas(atlas({ lines: [{ name: "short", points: [[0, 0.2, 0.2]] }] }), 2).join(";"), /点数 < 2/);
assert.match(validateAtlas(atlas({ lines: [{ name: "tri", points: [[9, 0.2, 0.2], [9, 0.3, 0.3]] }] }), 2).join(";"), /三角面索引越界/);
assert.match(validateAtlas(atlas({ lines: [{ name: "bary", points: [[0, 1.2, 0.2], [1, 0.3, 0.3]] }] }), 2).join(";"), /重心坐标越界/);
assert.match(validateAtlas(atlas({ system: "langer" }), 2, { expectedSystem: "rstl" }).join(";"), /system/);
assert.match(validateAtlas(atlas({ version: "0.1" }), 2, { expectedSystem: "rstl" }).join(";"), /version/);
assert.match(
  validateAtlas(atlas({ topologyId: "flame-2023" }), 2, { expectedTopologyId: TOPOLOGY_ID }).join(";"),
  /topologyId/,
);
assert.match(
  validateAtlas(atlas({ topologyVersion: "other" }), 2, { expectedTopologyVersion: TOPOLOGY_VERSION }).join(";"),
  /topologyVersion/,
);
assert.deepEqual(
  validateAtlas(atlas({ topologyId: undefined, topologyVersion: undefined }), 2, { expectedTopologyId: TOPOLOGY_ID }),
  [],
);

console.log("ok: atlas runtime contract validation");

// ── 注入判定 resolveAtlasForInjection ──────────────────────────────────────────
// 直接覆盖 setActiveAtlas 的运行时分支（对象/数组判别 + 走哪个校验器 + ok 契约 + 拓扑守卫），
// 该路径因 pipeline.js 的 DOM 依赖无法在 Node 端经 setActiveAtlas 触达（见 #65 review）。
const TRIS2 = [[0, 1, 2], [0, 2, 3]];

// 完整 atlas 对象、拓扑匹配 → 接受并返回 lineList
{
  const r = resolveAtlasForInjection(atlas(), TRIS2,
    { expectedSystem: "rstl", expectedTopologyId: TOPOLOGY_ID, expectedTopologyVersion: TOPOLOGY_VERSION });
  assert.equal(r.ok, true);
  assert.equal(r.lineList.length, 1);
}
// 完整 atlas 对象、拓扑不匹配 → 拒绝（reason=atlas）
{
  const r = resolveAtlasForInjection(atlas({ topologyId: "flame-2023" }), TRIS2,
    { expectedSystem: "rstl", expectedTopologyId: TOPOLOGY_ID });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "atlas");
}
// 完整 atlas 对象、拓扑版本不匹配 → 拒绝
{
  const r = resolveAtlasForInjection(atlas({ topologyVersion: "other" }), TRIS2,
    { expectedTopologyVersion: TOPOLOGY_VERSION });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "atlas");
}
// system 不符 → 拒绝（reason=atlas）
{
  const r = resolveAtlasForInjection(atlas({ system: "langer" }), TRIS2, { expectedSystem: "rstl" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "atlas");
}
// 裸 lines 数组（老注入路径、无拓扑信封）→ 接受（向后兼容）
{
  const r = resolveAtlasForInjection(atlas().lines, TRIS2,
    { expectedSystem: "rstl", expectedTopologyId: TOPOLOGY_ID });
  assert.equal(r.ok, true);
  assert.equal(r.lineList.length, 1);
}
// 裸 lines 数组、三角面越界 → 拒绝（reason=lines）
{
  const r = resolveAtlasForInjection([{ name: "x", points: [[9, 0.3, 0.3]] }], TRIS2, {});
  assert.equal(r.ok, false);
  assert.equal(r.reason, "lines");
}

console.log("ok: resolveAtlasForInjection injection decision");
