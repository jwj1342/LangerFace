// Node 对拍：验证生产 TypeScript geometry services 的映射/遮挡与 Python 金标逐点一致。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapAtlas, visibleTriangles, noseTriangles, innerMouthTriangles } from "../web/src/services/geometryAtlas.ts";
import { OneEuro } from "../web/src/services/geometrySmoothing.ts";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const J = (p) => JSON.parse(fs.readFileSync(path.join(REPO, p), "utf8"));
const triangles = J("web/assets/triangles.json");
const atlas = J("web/assets/atlas_rstl.json").lines;
const expected = J("web/test/expected.json");
const fixture = J("web/test/runtime_expansion_contract.json");
const noseTris = noseTriangles(triangles);
const innerMouth = innerMouthTriangles(triangles);

const expanded = mapAtlas(fixture.lines, fixture.landmarks, fixture.triangles);
const raw = mapAtlas(fixture.lines, fixture.landmarks, fixture.triangles, { expandForehead: false });
const fixtureLine = (mapped, name) => mapped.find((line) => line.name === name)?.pts;
const pointError = (actual, wanted) => {
  if (!actual || actual.length !== wanted.length) return Number.POSITIVE_INFINITY;
  let error = 0;
  for (let i = 0; i < actual.length; i++) {
    for (let axis = 0; axis < 3; axis++) error = Math.max(error, Math.abs(actual[i][axis] - wanted[i][axis]));
  }
  return error;
};
const personalizedError = pointError(fixtureLine(expanded, "personalized"), fixture.expectedRawPoints);
const officialExpandedError = pointError(fixtureLine(expanded, "official"), fixture.expectedRawPoints);
const optionDisabledError = pointError(fixtureLine(raw, "official"), fixture.expectedRawPoints);
const lowerPersonalizedError = pointError(fixtureLine(expanded, "personalized_lower_v13"), fixture.expectedRawPoints);
const lowerOfficialExpandedError = pointError(fixtureLine(expanded, "official_lower_v13"), fixture.expectedRawPoints);
const lowerOptionDisabledError = pointError(fixtureLine(raw, "official_lower_v13"), fixture.expectedRawPoints);

let maxPosErr = 0;
let visMismatches = 0;
let nPts = 0;
for (const frame of expected.frames) {
  const mapped = mapAtlas(atlas, frame.landmarks, triangles);
  const visible = visibleTriangles(frame.landmarks, triangles, noseTris);
  if (mapped.length !== frame.lines.length) {
    console.error(`FAIL frame ${frame.idx}: line counts ts=${mapped.length}, python=${frame.lines.length}`);
    process.exit(1);
  }
  for (let lineIndex = 0; lineIndex < mapped.length; lineIndex++) {
    const browserLine = mapped[lineIndex];
    const pythonLine = frame.lines[lineIndex];
    for (let pointIndex = 0; pointIndex < browserLine.pts.length; pointIndex++) {
      nPts++;
      maxPosErr = Math.max(
        maxPosErr,
        Math.abs(browserLine.pts[pointIndex][0] - pythonLine.pts[pointIndex][0]),
        Math.abs(browserLine.pts[pointIndex][1] - pythonLine.pts[pointIndex][1]),
      );
      const triangle = browserLine.tris[pointIndex];
      const browserVisible = visible[triangle] && !innerMouth.has(triangle) ? 1 : 0;
      if (browserVisible !== pythonLine.vis[pointIndex]) visMismatches++;
    }
  }
}

const oneEuroFixture = expected.oneEuro;
const oneEuro = new OneEuro({
  minCutoff: oneEuroFixture.minCutoff,
  beta: oneEuroFixture.beta,
  dcutoff: oneEuroFixture.dcutoff,
});
let oneEuroError = 0;
for (let frame = 0; frame < oneEuroFixture.inputs.length; frame++) {
  const actual = oneEuro.filter(oneEuroFixture.inputs[frame].map((point) => point.slice()), oneEuroFixture.times[frame]);
  const wanted = oneEuroFixture.expected[frame];
  for (let point = 0; point < actual.length; point++) {
    for (let axis = 0; axis < actual[point].length; axis++) {
      oneEuroError = Math.max(oneEuroError, Math.abs(actual[point][axis] - wanted[point][axis]));
    }
  }
}

const expansionContractOk = personalizedError < 1e-9
  && officialExpandedError > 1e-3
  && optionDisabledError < 1e-9
  && lowerPersonalizedError < 1e-9
  && lowerOfficialExpandedError > 1e-3
  && lowerOptionDisabledError < 1e-9
  && fixture.fixturePurpose.includes("not a production atlas");
const ok = maxPosErr < 1e-2 && visMismatches === 0 && oneEuroError < 1e-9 && expansionContractOk;

console.log(`points compared: ${nPts}`);
console.log(`max position error (px): ${maxPosErr.toExponential(3)}`);
console.log(`visibility mismatches: ${visMismatches}`);
console.log(`one-euro fixture max error: ${oneEuroError.toExponential(3)}`);
console.log(`personalized expansion-contract error: ${personalizedError.toExponential(3)}`);
console.log(ok ? "\n✅ Web TypeScript 几何与 Python 一致" : "\n❌ 存在不一致");
process.exit(ok ? 0 : 1);
