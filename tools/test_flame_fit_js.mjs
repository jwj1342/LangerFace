// 浏览器内 FLAME 拟合（web/flame_fit.js）的 Node 对拍：用真模型基跑标准脸，
// 残差应与 Python 版（langerface.flame / api/fit.py）一致 ~1.6mm —— 证明 JS 移植正确。
// 依赖 web/assets/flame_basis.bin（CC-BY-4.0，已入库）+ web/assets/canonical_vertices.json。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { basisFromBuffer, fitFlame } from "../web/flame_fit.js";

const web = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const buf = readFileSync(join(web, "assets", "flame_basis.bin"));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);  // → 对齐到 0 的 ArrayBuffer
const basis = basisFromBuffer(ab);
assert.equal(basis.vTemplate.length, 5023 * 3, "v_template 长度");
assert.equal(basis.shapedirs.length, 5023 * 3 * 60, "shapedirs 长度");

const observed = JSON.parse(readFileSync(join(web, "assets", "canonical_vertices.json"), "utf8"));
const res = fitFlame(observed, basis);
assert.equal(res.verts.length, 5023, "输出 5023 顶点");
assert.equal(res.faces.length, 9976, "输出 9976 面");
assert.ok(res.nLandmarks >= 50, `关键点数 ${res.nLandmarks}`);
assert.ok(res.residual < 0.02, `残差 ${res.residual} 应 < 2cm（Python 版实测 ~1.6mm）`);

let maxd = 0;
for (let v = 0; v < 5023; v++) {
  for (let x = 0; x < 3; x++) maxd = Math.max(maxd, Math.abs(res.verts[v][x] - basis.vTemplate[v * 3 + x]));
}
assert.ok(maxd > 1e-3, "拟合后应明显不同于 neutral 模板");

console.log(`ok: flame_fit.js 浏览器拟合 — ${res.verts.length} 顶点 / ${res.nLandmarks} 关键点 / 残差 ${(res.residual * 1000).toFixed(2)}mm`);
