// Node 对拍：验证 web/geometry.js 的映射/遮挡与 Python 端逐点一致。
//   node tools/test_web_mapping.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapAtlas, visibleTriangles, noseTriangles, innerMouthTriangles, OneEuro } from "../web/geometry.js";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const J = (p) => JSON.parse(fs.readFileSync(path.join(REPO, p), "utf8"));

const triangles = J("web/assets/triangles.json");
const atlas = J("web/assets/atlas_rstl.json").lines;
const expected = J("web/test/expected.json");
const noseTris = noseTriangles(triangles);
// #38 口裂三角面：生产渲染期永久排除，对拍时也要应用，否则 JS vis 会与
// （含口裂排除的）Python 金标在张嘴帧上出现 ~14 位不一致。
const innerMouth = innerMouthTriangles(triangles);

let maxPosErr = 0;
let visMismatches = 0;
let nPts = 0;

for (const fr of expected.frames) {
  const lm = fr.landmarks; // [[x,y,z]...478]
  const mapped = mapAtlas(atlas, lm, triangles);
  const vis = visibleTriangles(lm, triangles, noseTris);

  if (mapped.length !== fr.lines.length) {
    console.error(`FAIL frame ${fr.idx}: line count ${mapped.length} != ${fr.lines.length}`);
    process.exit(1);
  }
  for (let li = 0; li < mapped.length; li++) {
    const js = mapped[li], py = fr.lines[li];
    for (let i = 0; i < js.pts.length; i++) {
      nPts++;
      const dx = Math.abs(js.pts[i][0] - py.pts[i][0]);
      const dy = Math.abs(js.pts[i][1] - py.pts[i][1]);
      maxPosErr = Math.max(maxPosErr, dx, dy);
      const tri = js.tris[i];
      const jsVis = (vis[tri] && !innerMouth.has(tri)) ? 1 : 0;
      if (jsVis !== py.vis[i]) visMismatches++;
    }
  }
}

// One-Euro 跨语言夹具：用 Python 端常量生成的固定输入序列，断言 JS OneEuro 逐位一致。
// 同一夹具也被 tests/test_cross_lang_parity.py 断言 → Python==JS==golden 三方闭环。
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
console.log(`visibility mismatches: ${visMismatches}`);
console.log(`one-euro fixture max error: ${oeErr.toExponential(3)}`);

const ok = maxPosErr < 1e-2 && visMismatches === 0 && oeErr < 1e-9;
console.log(ok ? "\n✅ JS 几何与 Python 一致" : "\n❌ 存在不一致");
process.exit(ok ? 0 : 1);
