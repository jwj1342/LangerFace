// 手术「切除→闭合」demo 的物理核心对拍：
//  1. rstlDirField 产出每顶点单位切向；boundaryVerts 找到面壳边界。
//  2. 关键力学断言：在同一处、同样大小的梭形切除，**长轴沿 RSTL** 闭合后的残余张力
//     应低于 **长轴逆 RSTL**（临床「切口顺皮纹更平和」的力学根据）。验证各向异性刚度的符号正确。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { boundaryVerts, buildSoftBody, excise, stepSoftBody, vertexTension } from "../web/soft_body.js";
import { rstlDirField } from "../web/rstl_field.js";

const web = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const load = (f) => JSON.parse(readFileSync(join(web, "assets", f), "utf8"));
const verts = load("canonical_vertices.json");
const tris = load("triangles.json");
const atlas = load("atlas_rstl.json");
const N = verts.length;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// ── RSTL 方向场：468 个单位向量 ───────────────────────────────────────────────
const dir = rstlDirField(verts, tris, atlas);
assert.equal(dir.length, N, "方向场长度");
for (const d of dir) assert.ok(Math.abs(len(d) - 1) < 1e-6, "方向场应为单位向量");

// ── 边界锚点：存在且非全部 ────────────────────────────────────────────────────
const anchored = boundaryVerts(tris, N);
const nAnchor = anchored.reduce((s, v) => s + v, 0);
assert.ok(nAnchor > 10 && nAnchor < N * 0.6, `边界顶点数合理（${nAnchor}/${N}）`);

// 顶点法向（用于求"逆 RSTL"轴 = 表面内垂直方向）
const vn = verts.map(() => [0, 0, 0]);
for (const [a, b, c] of tris) {
  const n = cross(sub(verts[b], verts[a]), sub(verts[c], verts[a]));
  for (const i of [a, b, c]) for (let k = 0; k < 3; k++) vn[i][k] += n[k];
}
for (let i = 0; i < N; i++) vn[i] = norm(vn[i]);

// 平均边长 → 切除尺寸
let eSum = 0, eN = 0;
for (const [a, b, c] of tris) for (const [p, q] of [[a, b], [b, c], [c, a]]) { eSum += len(sub(verts[p], verts[q])); eN++; }
const meanEdge = eSum / eN;
const LA = meanEdge * 2.6, LB = meanEdge * 1.0;   // 梭形：长轴 2.6×、短轴 1.0× 平均边长

// 取若干"最深内部"顶点（离边界最远）作切除中心 → 周围皮肤充足
const depth = verts.map((v, i) => {
  if (anchored[i]) return -1;
  let bd = Infinity;
  for (let j = 0; j < N; j++) if (anchored[j]) bd = Math.min(bd, len(sub(v, verts[j])));
  return bd;
});
const centers = [...depth.keys()].filter((i) => depth[i] > 0).sort((a, b) => depth[b] - depth[a]).slice(0, 8);
assert.ok(centers.length >= 4, "应有足够深内部顶点");

// 沿 longAxis 做梭形"切除→沉降"，返回跨伤口（短轴=闭合方向）的瘢痕张力均值
function closureTension(center, longAxis) {
  const shortAxis = norm(cross(vn[center], longAxis));   // 伤口短轴 = 闭合拉合方向
  const sb = buildSoftBody(verts, tris, dir, { anchored });
  excise(sb, verts, verts[center], longAxis, LA, LB);
  stepSoftBody(sb, 600);
  const tens = vertexTension(sb, shortAxis);
  let s = 0, c = 0;
  for (let i = 0; i < N; i++) {
    if (sb.removed[i] || anchored[i]) continue;
    if (len(sub(verts[i], verts[center])) < LA * 2.2) { s += tens[i]; c++; }
  }
  return c ? s / c : 0;
}

let along = 0, across = 0, wins = 0;
for (const ci of centers) {
  const tAlong = closureTension(ci, dir[ci]);                       // 长轴沿 RSTL（短轴=逆 RSTL=软）
  const tAcross = closureTension(ci, norm(cross(vn[ci], dir[ci]))); // 长轴逆 RSTL（短轴=沿 RSTL=硬）
  along += tAlong; across += tAcross;
  if (tAlong < tAcross) wins++;
}
along /= centers.length; across /= centers.length;
console.log(`沿线残余张力均值 ${along.toFixed(4)} < 逆线 ${across.toFixed(4)}；逐点沿<逆 ${wins}/${centers.length}`);
assert.ok(along < across, "长轴沿 RSTL 的闭合残余张力应低于逆 RSTL（各向异性符号正确）");
assert.ok(wins >= Math.ceil(centers.length * 0.6), "多数切除中心应满足沿线更平和");

// ── 切除确实移除顶点、闭合让伤口收缩 ──────────────────────────────────────────
const sb = buildSoftBody(verts, tris, dir, { anchored });
const removed = excise(sb, verts, verts[centers[0]], dir[centers[0]], LA, LB);
assert.ok(removed >= 1, `切除应移除顶点（${removed}）`);
const ringBefore = ringSpan(sb, centers[0]);
stepSoftBody(sb, 600);
const ringAfter = ringSpan(sb, centers[0]);
assert.ok(ringAfter < ringBefore, `闭合应让伤口邻域收拢（${ringBefore.toFixed(3)}→${ringAfter.toFixed(3)}）`);

// 伤口邻域（被移除点的一环邻居）的平均间距，作"洞口大小"代理
function ringSpan(sb, center) {
  const neigh = new Set();
  for (const [a, b, c] of tris) {
    const rm = [a, b, c].filter((i) => sb.removed[i]).length;
    if (rm >= 1 && rm < 3) for (const i of [a, b, c]) if (!sb.removed[i]) neigh.add(i);
  }
  const ids = [...neigh];
  if (ids.length < 2) return 0;
  let cen = [0, 0, 0];
  for (const i of ids) for (let k = 0; k < 3; k++) cen[k] += sb.pos[i][k] / ids.length;
  let s = 0;
  for (const i of ids) s += len(sub(sb.pos[i], cen));
  return s / ids.length;
}

console.log("test_soft_body OK");
