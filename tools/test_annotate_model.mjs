// 网页标注纯模型测试（无 Three.js / DOM）。  node tools/test_annotate_model.mjs
import { AnnotationModel, barycentric } from "../web/annotate_model.js";

let fail = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); fail++; } else console.log("ok:", m); };
const close = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

// ── barycentric ──────────────────────────────────────────────────────────────
const A = [0, 0, 0], B = [2, 0, 0], C = [0, 2, 0];
let bc = barycentric(A, A, B, C);
ok(close(bc[0], 1) && close(bc[1], 0) && close(bc[2], 0), "顶点 A -> [1,0,0]");
bc = barycentric(B, A, B, C);
ok(close(bc[0], 0) && close(bc[1], 1) && close(bc[2], 0), "顶点 B -> [0,1,0]");
const centroid = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, 0];
bc = barycentric(centroid, A, B, C);
ok(close(bc[0], 1 / 3) && close(bc[1], 1 / 3) && close(bc[2], 1 / 3), "质心 -> [1/3,1/3,1/3]");
// 重建：u*A+v*B+w*C == p
const p = [0.5, 0.7, 0];
bc = barycentric(p, A, B, C);
const recon = [0, 1, 2].map((k) => bc[0] * A[k] + bc[1] * B[k] + bc[2] * C[k]);
ok(close(recon[0], p[0]) && close(recon[1], p[1]), "重心重建回到原点");

// ── 模型：增删/撤销/完成 ──────────────────────────────────────────────────────
const m = new AnnotationModel("rstl");
m.startLine({ name: "f0", region: "forehead" });
m.addPoint({ xyz: [0, 0, 0], tri: 5, bary: [0.6, 0.3, 0.1] });
m.addPoint({ xyz: [1, 0, 0], tri: 5, bary: [0.2, 0.7, 0.1] });
m.addPoint({ xyz: [9, 9, 9], tri: 6, bary: [0.1, 0.1, 0.8] });
m.undoPoint();                                  // 撤销最后一点
ok(m.current.points.length === 2, "撤销点后剩 2 点");
m.finishLine();
ok(m.lines.length === 1, "完成线后 lines=1");

// 少于 2 点的线不应被收录
m.startLine({ name: "x" });
m.addPoint({ xyz: [0, 0, 0], tri: 1, bary: [1, 0, 0] });
m.finishLine();
ok(m.lines.length === 1, "单点线不收录");

// ── 导出图谱格式 ──────────────────────────────────────────────────────────────
const atlas = m.toAtlasJSON();
ok(atlas.system === "rstl" && atlas.validated === false, "图谱 system/validated 正确");
ok(atlas.lines[0].points[0].length === 3, "图谱点为 [tri,u,v] 三元组");
ok(atlas.lines[0].points[0][0] === 5, "图谱点保留三角面 id");

// ── 导出 xyz ─────────────────────────────────────────────────────────────────
const xyz = m.toXyzJSON();
ok(xyz.lines[0].points[0].length === 3 && xyz.lines[0].points.length === 2, "xyz 折线导出正确");

// ── 无重心时拒绝导出图谱 ─────────────────────────────────────────────────────
const m2 = new AnnotationModel();
m2.startLine();
m2.addPoint({ xyz: [0, 0, 0], tri: null, bary: null });
m2.addPoint({ xyz: [1, 1, 1], tri: null, bary: null });
m2.finishLine();
let threw = false;
try { m2.toAtlasJSON(); } catch { threw = true; }
ok(threw, "缺重心坐标时拒绝导出图谱格式");

m.deleteLine(0);
ok(m.lines.length === 0, "删除线生效");

console.log(fail === 0 ? "\n✅ 标注模型正确" : `\n❌ ${fail} 项失败`);
process.exit(fail ? 1 : 0);
