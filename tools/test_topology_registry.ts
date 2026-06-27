// 拓扑登记表测试（纯模块，无 DOM）。  node tools/test_topology_registry.ts
import assert from "node:assert/strict";

import { TOPOLOGY_ID, TOPOLOGY_VERSION } from "../web/src/services/constants.ts";
import { TOPOLOGIES, topologyMeta } from "../web/src/services/topologyRegistry.ts";

assert.ok(TOPOLOGIES.length >= 2, "至少两套拓扑");

const mp = topologyMeta("mediapipe-468");
assert.equal(mp.id, TOPOLOGY_ID, "mediapipe id 与常量一致");
assert.equal(mp.version, TOPOLOGY_VERSION, "mediapipe 版本与常量一致");
assert.equal(mp.bundled, true, "mediapipe 内置");

const fl = topologyMeta("flame-2023");
assert.equal(fl.id, "flame-2023");
assert.equal(fl.version, "flame-2023-v1");
assert.equal(fl.bundled, false, "flame 为 dev-local，非内置");

assert.equal(topologyMeta("nope"), null, "未知拓扑返回 null");

console.log("ok: topology registry");
