// 浏览器内 FLAME（web/flame_fit.js）的 Node 对拍：身份拟合(≈1.6mm) + 表情拟合(可恢复) + jaw 前向(张嘴动下半脸)。
// 依赖 web/assets/flame_basis.bin（CC-BY-4.0，已入库）+ web/assets/canonical_vertices.json。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { basisFromBuffer, fitExpression, fitShape, flameForward } from "../web/flame_fit.js";

const web = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const buf = readFileSync(join(web, "assets", "flame_basis.bin"));
const basis = basisFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
assert.equal(basis.shapeDirs.length, 5023 * 3 * 60, "shapeDirs 长度");
assert.equal(basis.exprDirs.length, 5023 * 3 * 50, "exprDirs 长度");
assert.equal(basis.jawW.length, 5023, "jawW 长度");

// ── 身份拟合 ≈ 1.6mm（与 Python 一致）──────────────────────────────────────────
const observed = JSON.parse(readFileSync(join(web, "assets", "canonical_vertices.json"), "utf8"));
const { beta, residual, nLandmarks } = fitShape(observed, basis);
assert.equal(beta.length, 60);
assert.ok(nLandmarks >= 50 && residual < 0.02, `身份残差 ${residual}`);

// ── jaw 前向：张嘴只动下半脸（jaw 权重>0.5 的顶点移动；权重 0 的不动）────────────
const zeros = new Float64Array(50);
const vNeutral = flameForward(basis, beta, zeros, 0);
const vOpen = flameForward(basis, beta, zeros, 1.0);
assert.equal(vNeutral.length, 5023);
let movedJaw = 0, stillTop = 0;
for (let i = 0; i < 5023; i++) {
  const d = Math.hypot(vOpen[i][0] - vNeutral[i][0], vOpen[i][1] - vNeutral[i][1], vOpen[i][2] - vNeutral[i][2]);
  if (basis.jawW[i] > 0.6 && d > 1e-3) movedJaw++;
  if (basis.jawW[i] <= 1e-3 && d < 1e-9) stillTop++;  // 前向只动 jawW>1e-3 的顶点，其余精确不动
}
assert.ok(movedJaw > 100, `张嘴应移动下半脸顶点（${movedJaw}）`);
assert.ok(stillTop > 2000, `张嘴不应移动非 jaw 顶点（${stillTop}）`);

// ── 表情拟合：给定已知 psi 合成关键点 → fitExpression 应高度还原 ────────────────
const psiTrue = new Float64Array(50); psiTrue[0] = 1.2; psiTrue[4] = -0.9;
const vExpr = flameForward(basis, beta, psiTrue, 0);
const obs = new Array(478).fill([0, 0, 0]);
for (let i = 0; i < basis.NL; i++) {
  const f = basis.lmkFaceIdx[i], a = basis.faces[f * 3], b = basis.faces[f * 3 + 1], c = basis.faces[f * 3 + 2];
  const w0 = basis.lmkBCoords[i * 3], w1 = basis.lmkBCoords[i * 3 + 1], w2 = basis.lmkBCoords[i * 3 + 2];
  obs[basis.landmarkIndices[i]] = [0, 1, 2].map((x) => w0 * vExpr[a][x] + w1 * vExpr[b][x] + w2 * vExpr[c][x]);
}
const { psi, residual: rExpr } = fitExpression(obs, basis, beta);
assert.equal(psi.length, 50);
assert.ok(rExpr < 1e-2, `表情拟合残差 ${rExpr} 应很小`);

console.log(`ok: flame_fit.js — 身份 ${(residual * 1000).toFixed(2)}mm · jaw 动 ${movedJaw} 顶点 · 表情拟合残差 ${(rExpr * 1000).toFixed(2)}mm`);
