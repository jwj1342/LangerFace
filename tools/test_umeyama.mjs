// 验证 Umeyama 相似变换：施加已知 (scale,rot,trans) 后能否恢复。
//   node tools/test_umeyama.mjs
import { umeyama, applySim } from "../web/src/services/geometryTransform.ts";

let fail = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); fail++; } else console.log("ok:", m); };

// 随机点
const S = [];
for (let i = 0; i < 30; i++) S.push([Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2]);

// 已知变换：绕 y 轴 35°，绕 x 轴 -20°，缩放 1.7，平移
const ay = 35 * Math.PI / 180, ax = -20 * Math.PI / 180;
const Ry = [[Math.cos(ay), 0, Math.sin(ay)], [0, 1, 0], [-Math.sin(ay), 0, Math.cos(ay)]];
const Rx = [[1, 0, 0], [0, Math.cos(ax), -Math.sin(ax)], [0, Math.sin(ax), Math.cos(ax)]];
const mm = (A, B) => A.map((r, i) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const R0 = mm(Ry, Rx);
const c0 = 1.7, t0 = [3, -1.5, 0.8];
const T = applySim({ c: c0, R: R0, t: t0 }, S);

const sol = umeyama(S, T);
const rec = applySim(sol, S);
let maxErr = 0;
for (let i = 0; i < S.length; i++) for (let k = 0; k < 3; k++) maxErr = Math.max(maxErr, Math.abs(rec[i][k] - T[i][k]));

console.log(`recovered scale c=${sol.c.toFixed(4)} (truth ${c0})`);
console.log(`max reconstruction error: ${maxErr.toExponential(3)}`);
ok(Math.abs(sol.c - c0) < 1e-3, "尺度恢复正确");
ok(maxErr < 1e-4, "逐点重建误差极小");

console.log(fail === 0 ? "\n✅ Umeyama 正确" : `\n❌ ${fail} 项失败`);
process.exit(fail ? 1 : 0);
