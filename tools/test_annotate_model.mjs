// 网页标注纯模型测试（无 Three.js / DOM）。  node tools/test_annotate_model.mjs
import { AnnotationModel, barycentric } from "../web/src/services/annotationModel.ts";
import { TOPOLOGY_ID, TOPOLOGY_VERSION } from "../web/src/services/constants.ts";

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
ok(atlas.topologyId === TOPOLOGY_ID && atlas.topologyVersion === TOPOLOGY_VERSION, "图谱拓扑声明正确");
ok(atlas.lines[0].points[0].length === 3, "图谱点为 [tri,u,v] 三元组");
ok(atlas.lines[0].points[0][0] === 5, "图谱点保留三角面 id");

// ── FLAME 拓扑：在 FLAME 头上标注，导出图谱应打 flame-2023 标（独立 3D 轨图谱）──
const mf = new AnnotationModel("rstl");
mf.setTopology({ topologyId: "flame-2023", topologyVersion: "flame-2023-v1" });
mf.startLine({ name: "f0", region: "cheek" });
mf.addPoint({ xyz: [0, 0, 0], tri: 9000, bary: [0.5, 0.3, 0.2] });
mf.addPoint({ xyz: [1, 0, 0], tri: 9001, bary: [0.2, 0.4, 0.4] });
mf.finishLine();
const fAtlas = mf.toAtlasJSON();
ok(fAtlas.topologyId === "flame-2023" && fAtlas.topologyVersion === "flame-2023-v1", "FLAME 图谱导出打 flame-2023 标");
ok(fAtlas.lines[0].points[0][0] === 9000, "FLAME 图谱点保留 FLAME 三角面 id");

// ── 导出 xyz ─────────────────────────────────────────────────────────────────
const xyz = m.toXyzJSON();
ok(xyz.lines[0].points[0].length === 3 && xyz.lines[0].points.length === 2, "xyz 折线导出正确");

// ── 表面路径：跨三角形的控制点应展开为沿网格边的路径，而不是空间直线 ───────
const surf = new AnnotationModel("rstl");
const verts = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0],
  [1, 1, 0.5],
];
const tris = [[0, 1, 2], [1, 3, 2]];
surf.setSurface(verts, tris);
surf.startLine({ name: "surface" });
surf.addPoint({ xyz: [0.2, 0.2, 0], tri: 0, bary: [0.6, 0.2, 0.2] });
surf.addPoint({ xyz: [0.8, 0.8, 0.35], tri: 1, bary: [0.2, 0.6, 0.2] });
surf.finishLine();
ok(surf.lines[0].points.length > 2, "跨三角形控制点展开为表面路径点");
const previewPointCount = surf.lines[0].points.length;
const exportedSurfaceLine = surf.toAtlasJSON().lines[0];
ok(exportedSurfaceLine.points.length === previewPointCount, "图谱导出与屏幕预览路径点数一致");
ok(exportedSurfaceLine.points.length > surf.lines[0].controls.length, "图谱导出使用贴面展开后的路径点");
ok(surf.lines[0].fallback === false, "连通网格预览线无 fallback 风险");

let threw = false;
const custom = new AnnotationModel("rstl");
custom.setSurface(verts, tris);
custom.startLine({ name: "custom" });
custom.addPoint({ xyz: [0.2, 0.2, 0], tri: 0, bary: [0.6, 0.2, 0.2], exportable: false });
custom.addPoint({ xyz: [0.8, 0.8, 0.35], tri: 1, bary: [0.2, 0.6, 0.2], exportable: false });
custom.finishLine();
ok(custom.toXyzJSON().lines[0].points.length > 2, "自定义头模也使用表面路径导出 xyz");
threw = false;
try { custom.toAtlasJSON(); } catch { threw = true; }
ok(threw, "自定义头模表面路径不允许导出项目图谱格式");

// ── 断连网格：跨岛连线必须退回直线，且非静默（带 fallback 标记）─────────────
const disjoint = new AnnotationModel("rstl");
const islandVerts = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0],   // 岛 A
  [5, 5, 5], [6, 5, 5], [5, 6, 5],   // 岛 B（顶点集与 A 不相交）
];
const islandTris = [[0, 1, 2], [3, 4, 5]];
disjoint.setSurface(islandVerts, islandTris);
disjoint.startLine({ name: "cross-island" });
const r0 = disjoint.addPoint({ xyz: [0.2, 0.2, 0], tri: 0, bary: [0.6, 0.2, 0.2] });
ok(r0.fallback === false, "断连网格：首点不触发 fallback");
const r1 = disjoint.addPoint({ xyz: [5.2, 5.2, 5], tri: 1, bary: [0.6, 0.2, 0.2] });
ok(r1.fallback === true, "断连网格：跨岛连线被标记为 fallback（非静默）");
ok(disjoint.current.points.length === 2, "断连网格：退回直线只有两个端点");

// ── 单连通多三角：路由路径沿表面（点数 > 2 且每个点都落在网格上）─────────────
const conn = new AnnotationModel("rstl");
const connVerts = [
  [0, 0, 0], [1, 0, 0], [2, 0, 0],
  [0, 1, 0], [1, 1, 0.4], [2, 1, 0],
];
const connTris = [[0, 1, 3], [1, 4, 3], [1, 2, 4], [2, 5, 4]];
conn.setSurface(connVerts, connTris);
conn.startLine({ name: "along-surface" });
const c0 = conn.addPoint({ xyz: [0.2, 0.2, 0], tri: 0, bary: [0.6, 0.2, 0.2] });
const c1 = conn.addPoint({ xyz: [1.8, 0.8, 0], tri: 3, bary: [0.2, 0.6, 0.2] });
ok(c0.fallback === false && c1.fallback === false, "单连通网格：跨三角路由不触发 fallback");
ok(conn.current.points.length > 2, "单连通网格：路由路径点 > 2（沿面而非直线）");
const onMesh = (q) => connVerts.some((v) => close(v[0], q[0]) && close(v[1], q[1]) && close(v[2], q[2]));
const middle = conn.current.points.slice(1, -1);
ok(middle.length > 0 && middle.every((p) => onMesh(p.xyz)), "单连通网格：中间路径点全部落在网格顶点上（沿面）");

// ── 无重心时拒绝导出图谱 ─────────────────────────────────────────────────────
const m2 = new AnnotationModel();
m2.startLine();
m2.addPoint({ xyz: [0, 0, 0], tri: null, bary: null });
m2.addPoint({ xyz: [1, 1, 1], tri: null, bary: null });
m2.finishLine();
threw = false;
try { m2.toAtlasJSON(); } catch { threw = true; }
ok(threw, "缺重心坐标时拒绝导出图谱格式");

m.deleteLine(0);
ok(m.lines.length === 0, "删除线生效");

console.log(fail === 0 ? "\n✅ 标注模型正确" : `\n❌ ${fail} 项失败`);
process.exit(fail ? 1 : 0);
