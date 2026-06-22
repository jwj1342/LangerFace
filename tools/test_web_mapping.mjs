// Node 对拍：验证 web/geometry.js 的映射/遮挡与 Python 端逐点一致。
//   node tools/test_web_mapping.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapAtlas, visibleTriangles, noseTriangles, OneEuro } from "../web/geometry.js";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const J = (p) => JSON.parse(fs.readFileSync(path.join(REPO, p), "utf8"));

const triangles = J("web/assets/triangles.json");
const atlas = J("web/assets/atlas_rstl.json").lines;
const expected = J("web/test/expected.json");
const noseTris = noseTriangles(triangles);

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
      const jsVis = vis[js.tris[i]] ? 1 : 0;
      if (jsVis !== py.vis[i]) visMismatches++;
    }
  }
}

// One-Euro 基本正确性：静止信号输出应收敛
const oe = new OneEuro({ minCutoff: 1.5, beta: 0.05 });
let last = null;
const base = [[100, 200, 0], [300, 50, 5]];
for (let i = 0; i < 60; i++) last = oe.filter(base.map((p) => p.slice()), i / 30);
const oeErr = Math.max(...last.flatMap((p, i) => p.map((v, k) => Math.abs(v - base[i][k]))));

console.log(`points compared: ${nPts}`);
console.log(`max position error (px): ${maxPosErr.toExponential(3)}`);
console.log(`visibility mismatches: ${visMismatches}`);
console.log(`one-euro steady-state error: ${oeErr.toExponential(3)}`);

const ok = maxPosErr < 1e-2 && visMismatches === 0 && oeErr < 1e-6;
console.log(ok ? "\n✅ JS 几何与 Python 一致" : "\n❌ 存在不一致");
process.exit(ok ? 0 : 1);
