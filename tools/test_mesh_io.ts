// Dependency-free tests for the TypeScript mesh parser (OBJ / PLY / JSON parsers + hardening).
// Run: node tools/test_mesh_io.ts
import { __meshIoForTests } from "../web/src/services/meshIo.ts";

const { parseJsonMesh, parseObjMesh, parsePlyMesh } = __meshIoForTests;

let passed = 0;
function ok(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  passed++;
}
function throws(fn, msg) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  ok(threw, msg + " (expected throw)");
}
function plyBuffer(text) {
  return new TextEncoder().encode(text).buffer;
}

// --- JSON ---
const j = parseJsonMesh(JSON.stringify({ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], triangles: [[0, 1, 2]] }));
ok(j.vertices.length === 3 && j.triangles.length === 1, "JSON happy path");
const jAlias = parseJsonMesh(JSON.stringify({ verts: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]] }));
ok(jAlias.triangles.length === 1, "JSON key aliases (verts/faces)");
throws(() => parseJsonMesh(JSON.stringify({ vertices: [[0, 0, "x"], [1, 0, 0], [0, 1, 0]], triangles: [[0, 1, 2]] })), "JSON non-finite vertex rejected");
throws(() => parseJsonMesh(JSON.stringify({ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], triangles: [[0, 1, 5]] })), "JSON out-of-range face index rejected");

// --- OBJ ---
const o = parseObjMesh("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");
ok(o.vertices.length === 3 && o.triangles[0].join(",") === "0,1,2", "OBJ 1-based face");
const oNeg = parseObjMesh("v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n");
ok(oNeg.triangles[0].join(",") === "0,1,2", "OBJ negative relative index");
const oQuad = parseObjMesh("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n");
ok(oQuad.triangles.length === 2, "OBJ quad fan-triangulated to 2 tris");
throws(() => parseObjMesh("v 1 2\nf 1 1 1\n"), "OBJ vertex line missing z rejected");

// --- PLY ascii ---
const plyOk = [
  "ply", "format ascii 1.0",
  "element vertex 3",
  "property float x", "property float y", "property float z",
  "element face 1",
  "property list uchar int vertex_indices",
  "end_header",
  "0 0 0", "1 0 0", "0 1 0", "3 0 1 2", "",
].join("\n");
const p = parsePlyMesh(plyBuffer(plyOk));
ok(p.vertices.length === 3 && p.triangles.length === 1, "PLY ascii happy path");

// --- PLY hardening: absurd declared element count rejected before looping ---
const plyHuge = [
  "ply", "format ascii 1.0",
  "element vertex 99999999999",
  "property float x", "property float y", "property float z",
  "end_header", "",
].join("\n");
throws(() => parsePlyMesh(plyBuffer(plyHuge)), "PLY huge element count rejected (MAX_PLY_ELEMENTS)");

console.log(`test_mesh_io: ${passed} assertions passed`);
