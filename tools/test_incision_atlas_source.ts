import assert from "node:assert/strict";

import { TOPOLOGY_ID, TOPOLOGY_VERSION } from "../web/src/services/constants.ts";
import { resolveIncisionAtlas } from "../web/src/services/incisionAtlasSource.ts";

function atlas(overrides: Record<string, unknown> = {}) {
  return {
    system: "rstl",
    version: "test-version",
    topologyId: TOPOLOGY_ID,
    topologyVersion: TOPOLOGY_VERSION,
    lines: [{ name: "test", points: [[0, 0.2, 0.3], [1, 0.3, 0.2]] }],
    ...overrides,
  };
}

const standardAtlas = atlas();

{
  const personalizedAtlas = atlas({
    provenance: "local-yolo-v8s-seg + browser-v6",
    validated: false,
    personalization: { source: "personalized_rstl", algorithm: "rstl-refinement-6.0" },
  });
  const result = resolveIncisionAtlas({ personalizedAtlas, standardAtlas, triangleCount: 2 });
  assert.equal(result.atlas, personalizedAtlas);
  assert.equal(result.mode, "mediapipe_personalized");
  assert.match(result.statusLabel, /个体化 RSTL/);
}

{
  const result = resolveIncisionAtlas({ personalizedAtlas: null, standardAtlas, triangleCount: 2 });
  assert.equal(result.atlas, standardAtlas);
  assert.equal(result.mode, "mediapipe_standard");
  assert.match(result.warnings.join("；"), /降级为标准先验/);
}

{
  const flameAtlas = atlas({ topologyId: "flame-2023", topologyVersion: "flame-2023-v1" });
  const result = resolveIncisionAtlas({ personalizedAtlas: flameAtlas, standardAtlas, triangleCount: 2 });
  assert.equal(result.mode, "mediapipe_standard");
  assert.match(result.warnings.join("；"), /拓扑校验/);
}

{
  const unrelatedAtlas = atlas({ provenance: "annotation-preview" });
  const result = resolveIncisionAtlas({ personalizedAtlas: unrelatedAtlas, standardAtlas, triangleCount: 2 });
  assert.equal(result.mode, "mediapipe_standard");
  assert.match(result.warnings.join("；"), /不是受支持/);
}

assert.throws(
  () => resolveIncisionAtlas({ personalizedAtlas: null, standardAtlas: atlas({ lines: [] }), triangleCount: 2 }),
  /标准 RSTL 图谱校验失败/,
);

console.log("ok: incision atlas source prioritizes personalized MediaPipe RSTL");
