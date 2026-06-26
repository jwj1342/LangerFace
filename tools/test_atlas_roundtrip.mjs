// 标注 → 实时 闭环（Epic #33 M0）数据保真对拍：纯 node、无 Three.js / DOM。
//   node tools/test_atlas_roundtrip.mjs
// 断言「医生在标注端画的点」经 toAtlasJSON() 序列化、再经实时端 mapAtlas() 还原后，
// 与原始 3D 坐标逐点一致 —— 即闭环不丢、不漂。同时验证注入前的边界校验 validateAtlasLines。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "../web/node_modules/typescript/lib/typescript.js";

import { AnnotationModel, barycentric } from "../web/src/services/annotationModel.ts";
import { TOPOLOGY_ID, TOPOLOGY_VERSION } from "../web/src/services/constants.ts";
import { mapAtlas, validateAtlasLines } from "../web/src/services/geometryAtlas.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function importTypeScriptModule(rel) {
  const source = fs.readFileSync(path.join(root, rel), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

const { dataSource } = await importTypeScriptModule("web/src/services/dataSource.ts");

let fail = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); fail++; } else console.log("ok:", m); };
const close = (a, b, e = 1e-4) => Math.abs(a - b) <= e;

// ── 合成网格（landmarks 充当顶点）+ 已知三角拓扑 ──────────────────────────────
const lm = [[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 10, 2], [5, -5, 1]];
const triangles = [[0, 1, 2], [1, 3, 2]];
const mix = (a, b, c, u, v, w) => [0, 1, 2].map((k) => u * a[k] + v * b[k] + w * c[k]);
const [A, B, C] = [lm[0], lm[1], lm[2]];

// 在三角 0 内取两个已知点，重心坐标由 barycentric 反算（与标注端一致）。
const p0 = mix(A, B, C, 0.5, 0.3, 0.2);
const p1 = mix(A, B, C, 0.2, 0.5, 0.3);
const bary0 = barycentric(p0, A, B, C);
const bary1 = barycentric(p1, A, B, C);

const model = new AnnotationModel("rstl");
model.startLine({ name: "rt0", region: "forehead" });
model.addPoint({ xyz: p0, tri: 0, bary: bary0 });
model.addPoint({ xyz: p1, tri: 0, bary: bary1 });
model.finishLine();

// ── 序列化（标注端产物）──────────────────────────────────────────────────────
const atlas = model.toAtlasJSON({ provenance: "web-annotator-live" });
ok(atlas.system === "rstl" && atlas.validated === false, "图谱 system/validated 正确");
ok(atlas.topologyId === TOPOLOGY_ID && atlas.topologyVersion === TOPOLOGY_VERSION, "图谱声明 MediaPipe 468 拓扑");
ok(Array.isArray(atlas.lines) && atlas.lines[0].points[0].length === 3, "图谱点为 [tri,u,v] 三元组");
ok(validateAtlasLines(
  atlas,
  triangles,
  { expectedTopologyId: TOPOLOGY_ID, expectedTopologyVersion: TOPOLOGY_VERSION },
), "标注产物通过注入边界校验");

// ── 还原（实时端消费）：mapAtlas(atlas.lines) 应逐点重建原始 xyz ───────────────
const mapped = mapAtlas(atlas.lines, lm, triangles);
ok(mapped.length === 1 && mapped[0].pts.length === 2, "映射回 1 条线 / 2 点");
const orig = [p0, p1];
let maxErr = 0;
for (let i = 0; i < mapped[0].pts.length; i++) {
  for (let k = 0; k < 3; k++) maxErr = Math.max(maxErr, Math.abs(mapped[0].pts[i][k] - orig[i][k]));
}
ok(close(maxErr, 0), `闭环逐点保真，最大误差 ${maxErr.toExponential(2)} < 1e-4`);

// ── validateAtlasLines 边界（注入护栏，防黑屏）────────────────────────────────
ok(validateAtlasLines(null, triangles) === false, "拒绝 null 图谱");
ok(validateAtlasLines([], triangles) === false, "拒绝空图谱");
ok(validateAtlasLines([{ name: "x", points: [[999, 0.3, 0.3]]}], triangles) === false, "拒绝越界三角面 id");
ok(validateAtlasLines([{ name: "x", points: [[0, NaN, 0.3]]}], triangles) === false, "拒绝非有限重心坐标");
ok(validateAtlasLines([{ name: "x", points: [[0, 0.3, 0.3]]}], triangles) === true, "接受合法图谱");
ok(validateAtlasLines({ ...atlas, topologyId: "flame-2023" }, triangles, { expectedTopologyId: TOPOLOGY_ID }) === false,
  "拒绝错误拓扑的完整图谱");
ok(validateAtlasLines(
  { ...atlas, topologyVersion: "other" },
  triangles,
  { expectedTopologyVersion: TOPOLOGY_VERSION },
) === false, "拒绝错误拓扑版本的完整图谱");

// ── mapAtlas 对坏数据降级而非抛错（最后一道防线）────────────────────────────
let threw = false;
try {
  const bad = mapAtlas([{ name: "b", points: [[999, 0.3, 0.3]]}], lm, triangles);
  ok(bad[0].pts.length === 0, "越界点被跳过而非崩溃整帧");
} catch { threw = true; }
ok(!threw, "mapAtlas 遇越界三角面不抛错");
threw = false;
try { ok(mapAtlas(null, lm, triangles).length === 0, "mapAtlas(null) 返回空而非抛错"); }
catch { threw = true; }
ok(!threw, "mapAtlas(null) 不抛错");

// ── dataSource 跨页预览桥：一次性消费 + 存储失败降级 ─────────────────────────
function makeSessionStorage() {
  const store = new Map();
  return {
    setItem(k, v) { store.set(String(k), String(v)); },
    getItem(k) { return store.has(String(k)) ? store.get(String(k)) : null; },
    removeItem(k) { store.delete(String(k)); },
  };
}

globalThis.sessionStorage = makeSessionStorage();
ok(dataSource.stagePreviewAtlas(atlas), "预览图谱可暂存到 sessionStorage");
const staged = dataSource.takePreviewAtlas();
ok(staged?.system === "rstl" && staged.lines.length === atlas.lines.length, "预览图谱可跨入口取出");
ok(dataSource.takePreviewAtlas() === null, "预览图谱取出后立即清除");

globalThis.sessionStorage = {
  setItem() { throw new Error("blocked"); },
  getItem() { return null; },
  removeItem() {},
};
ok(dataSource.stagePreviewAtlas(atlas) === false, "sessionStorage 写入失败时返回 false");

globalThis.sessionStorage = {
  setItem() {},
  getItem() { return "{bad json"; },
  removeItem() {},
};
ok(dataSource.takePreviewAtlas() === null, "sessionStorage 坏数据返回 null 而非抛错");
delete globalThis.sessionStorage;

console.log(fail === 0 ? "\n✅ 标注→实时 闭环保真" : `\n❌ ${fail} 项失败`);
process.exit(fail ? 1 : 0);
