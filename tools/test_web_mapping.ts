// Node 对拍：验证 TypeScript geometry services 的映射/遮挡与 Python 端逐点一致。
//   node tools/test_web_mapping.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapAtlas, visibleTriangles, noseTriangles, innerMouthTriangles } from "../web/src/services/geometryAtlas.ts";
import { OneEuro } from "../web/src/services/geometrySmoothing.ts";
import { mapAtlas as mapCompatAtlas } from "../web/compat/shared/geometry.js";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const J = (p) => JSON.parse(fs.readFileSync(path.join(REPO, p), "utf8"));

const triangles = J("web/assets/triangles.json");
const atlas = J("web/assets/atlas_rstl.json").lines;
const expected = J("web/test/expected.json");
const runtimeExpansionFixture = J("web/test/runtime_expansion_contract.json");
const noseTris = noseTriangles(triangles);
// #38 口裂三角面：生产渲染期永久排除，对拍时也要应用，否则 JS vis 会与
// （含口裂排除的）Python 金标在张嘴帧上出现 ~14 位不一致。
const innerMouth = innerMouthTriangles(triangles);

const expansionFixtureTs = mapAtlas(
  runtimeExpansionFixture.lines,
  runtimeExpansionFixture.landmarks,
  runtimeExpansionFixture.triangles,
);
const expansionFixtureCompat = mapCompatAtlas(
  runtimeExpansionFixture.lines,
  runtimeExpansionFixture.landmarks,
  runtimeExpansionFixture.triangles,
);
const expansionFixtureDisabledTs = mapAtlas(
  runtimeExpansionFixture.lines,
  runtimeExpansionFixture.landmarks,
  runtimeExpansionFixture.triangles,
  { expandForehead: false },
);
const expansionFixtureDisabledCompat = mapCompatAtlas(
  runtimeExpansionFixture.lines,
  runtimeExpansionFixture.landmarks,
  runtimeExpansionFixture.triangles,
  { expandForehead: false },
);
const fixtureLine = (mapped, name) => mapped.find((line) => line.name === name)?.pts;
const pointError = (actual, expectedPoints) => {
  if (!actual || actual.length !== expectedPoints.length) return Number.POSITIVE_INFINITY;
  let error = 0;
  for (let i = 0; i < actual.length; i++) {
    for (let axis = 0; axis < 3; axis++) {
      error = Math.max(error, Math.abs(actual[i][axis] - expectedPoints[i][axis]));
    }
  }
  return error;
};
const personalizedTsError = pointError(
  fixtureLine(expansionFixtureTs, "personalized"),
  runtimeExpansionFixture.expectedRawPoints,
);
const personalizedCompatError = pointError(
  fixtureLine(expansionFixtureCompat, "personalized"),
  runtimeExpansionFixture.expectedRawPoints,
);
const officialExpandedError = pointError(
  fixtureLine(expansionFixtureTs, "official"),
  runtimeExpansionFixture.expectedRawPoints,
);
const optionDisabledTsError = pointError(
  fixtureLine(expansionFixtureDisabledTs, "official"),
  runtimeExpansionFixture.expectedRawPoints,
);
const optionDisabledCompatError = pointError(
  fixtureLine(expansionFixtureDisabledCompat, "official"),
  runtimeExpansionFixture.expectedRawPoints,
);
const lowerPersonalizedTsError = pointError(
  fixtureLine(expansionFixtureTs, "personalized_lower_v13"),
  runtimeExpansionFixture.expectedRawPoints,
);
const lowerPersonalizedCompatError = pointError(
  fixtureLine(expansionFixtureCompat, "personalized_lower_v13"),
  runtimeExpansionFixture.expectedRawPoints,
);
const lowerOfficialExpandedError = pointError(
  fixtureLine(expansionFixtureTs, "official_lower_v13"),
  runtimeExpansionFixture.expectedRawPoints,
);
const lowerOptionDisabledTsError = pointError(
  fixtureLine(expansionFixtureDisabledTs, "official_lower_v13"),
  runtimeExpansionFixture.expectedRawPoints,
);
const lowerOptionDisabledCompatError = pointError(
  fixtureLine(expansionFixtureDisabledCompat, "official_lower_v13"),
  runtimeExpansionFixture.expectedRawPoints,
);
const bridgeRuntimeParityError = pointError(
  fixtureLine(expansionFixtureTs, "official"),
  fixtureLine(expansionFixtureCompat, "official"),
);
const lowerRuntimeParityError = pointError(
  fixtureLine(expansionFixtureTs, "official_lower_v13"),
  fixtureLine(expansionFixtureCompat, "official_lower_v13"),
);

let maxPosErr = 0;
let maxRuntimeParityErr = 0;
let visMismatches = 0;
let nPts = 0;

for (const fr of expected.frames) {
  const lm = fr.landmarks; // [[x,y,z]...478]
  const mapped = mapAtlas(atlas, lm, triangles);
  const mappedCompat = mapCompatAtlas(atlas, lm, triangles);
  const vis = visibleTriangles(lm, triangles, noseTris);

  if (mapped.length !== fr.lines.length || mappedCompat.length !== mapped.length) {
    console.error(
      `FAIL frame ${fr.idx}: line counts ts=${mapped.length}, compat=${mappedCompat.length}, ` +
      `python=${fr.lines.length}`,
    );
    process.exit(1);
  }
  for (let li = 0; li < mapped.length; li++) {
    const js = mapped[li], py = fr.lines[li];
    const compat = mappedCompat[li];
    if (compat.pts.length !== js.pts.length) {
      console.error(`FAIL frame ${fr.idx}, line ${li}: mapped point count mismatch`);
      process.exit(1);
    }
    for (let i = 0; i < js.pts.length; i++) {
      nPts++;
      const dx = Math.abs(js.pts[i][0] - py.pts[i][0]);
      const dy = Math.abs(js.pts[i][1] - py.pts[i][1]);
      maxPosErr = Math.max(maxPosErr, dx, dy);
      maxRuntimeParityErr = Math.max(
        maxRuntimeParityErr,
        Math.abs(js.pts[i][0] - compat.pts[i][0]),
        Math.abs(js.pts[i][1] - compat.pts[i][1]),
      );
      const tri = js.tris[i];
      const jsVis = (vis[tri] && !innerMouth.has(tri)) ? 1 : 0;
      if (jsVis !== py.vis[i]) visMismatches++;
    }
  }
}

// One-Euro 跨语言夹具：用 Python 端常量生成的固定输入序列，断言 Web TypeScript OneEuro 逐位一致。
// 同一夹具也被 tests/test_cross_lang_parity.py 断言 → Python==Web TypeScript==golden 三方闭环。
const oeFix = expected.oneEuro;
const oe = new OneEuro({
  minCutoff: oeFix.minCutoff, beta: oeFix.beta, dcutoff: oeFix.dcutoff,
});
let oeErr = 0;
for (let f = 0; f < oeFix.inputs.length; f++) {
  const out = oe.filter(oeFix.inputs[f].map((p) => p.slice()), oeFix.times[f]);
  const exp = oeFix.expected[f];
  for (let i = 0; i < out.length; i++) {
    for (let k = 0; k < out[i].length; k++) {
      oeErr = Math.max(oeErr, Math.abs(out[i][k] - exp[i][k]));
    }
  }
}

console.log(`points compared: ${nPts}`);
console.log(`max position error (px): ${maxPosErr.toExponential(3)}`);
console.log(`max browser-runtime parity error (px): ${maxRuntimeParityErr.toExponential(3)}`);
console.log(`visibility mismatches: ${visMismatches}`);
console.log(`one-euro fixture max error: ${oeErr.toExponential(3)}`);
console.log(`personalized expansion-contract TS error: ${personalizedTsError.toExponential(3)}`);
console.log(`personalized expansion-contract compat error: ${personalizedCompatError.toExponential(3)}`);
console.log(`official expansion delta: ${officialExpandedError.toExponential(3)}`);
console.log(`expandForehead=false TS error: ${optionDisabledTsError.toExponential(3)}`);
console.log(`expandForehead=false compat error: ${optionDisabledCompatError.toExponential(3)}`);
console.log(`personalized lower-v13 TS error: ${lowerPersonalizedTsError.toExponential(3)}`);
console.log(`personalized lower-v13 compat error: ${lowerPersonalizedCompatError.toExponential(3)}`);
console.log(`official lower-v13 expansion delta: ${lowerOfficialExpandedError.toExponential(3)}`);
console.log(`lower-v13 expandForehead=false TS error: ${lowerOptionDisabledTsError.toExponential(3)}`);
console.log(`lower-v13 expandForehead=false compat error: ${lowerOptionDisabledCompatError.toExponential(3)}`);
console.log(`bridge expanded TS/compat parity error: ${bridgeRuntimeParityError.toExponential(3)}`);
console.log(`lower-v13 expanded TS/compat parity error: ${lowerRuntimeParityError.toExponential(3)}`);

const expansionContractOk = personalizedTsError < 1e-9
  && personalizedCompatError < 1e-9
  && officialExpandedError > 1e-3
  && optionDisabledTsError < 1e-9
  && optionDisabledCompatError < 1e-9
  && lowerPersonalizedTsError < 1e-9
  && lowerPersonalizedCompatError < 1e-9
  && lowerOfficialExpandedError > 1e-3
  && lowerOptionDisabledTsError < 1e-9
  && lowerOptionDisabledCompatError < 1e-9
  && bridgeRuntimeParityError < 1e-9
  && lowerRuntimeParityError < 1e-9
  && runtimeExpansionFixture.fixturePurpose.includes("not a production atlas");
const ok = maxPosErr < 1e-2
  && maxRuntimeParityErr < 1e-9
  && visMismatches === 0
  && oeErr < 1e-9
  && expansionContractOk;
console.log(ok ? "\n✅ Web TypeScript 几何与 Python 一致" : "\n❌ 存在不一致");
process.exit(ok ? 0 : 1);
