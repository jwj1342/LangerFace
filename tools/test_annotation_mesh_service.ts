import assert from "node:assert/strict";

import type { HeadMeshPayload, MeshTopologyPayload } from "../web/src/services/dataSource.ts";
import {
  AnnotationMeshService,
  fetchAnnotationMeshJson,
  type AnnotationFlameAssetName,
} from "../web/src/services/annotationMeshService.ts";
import type { ParsedMesh } from "../web/src/services/meshIo.ts";
import type { Triangle, Vec3 } from "../web/src/services/softBody.ts";

const vertices: Vec3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
const triangles: Triangle[] = [[0, 1, 2]];
const flameMeta = {
  id: "flame-2023",
  version: "flame-2023-v1",
  label: "高精度三维头模",
  bundled: false,
};
const lookupTopology = (id: string) => id === flameMeta.id ? flameMeta : null;
const noFlameAssets = (_name: AnnotationFlameAssetName) => null;

let bundledLoads = 0;
const canonicalService = new AnnotationMeshService({
  flameAssetUrl: noFlameAssets,
  loadBundledMesh: async () => {
    bundledLoads += 1;
    return { vertices, triangles };
  },
  lookupTopology,
});
const [canonicalA, canonicalB] = await Promise.all([
  canonicalService.loadCanonical(),
  canonicalService.loadCanonical(),
]);
assert.equal(bundledLoads, 1, "parallel canonical loads reuse one bundled mesh promise");
assert.equal(canonicalA.modeLabel, "高精度标准图谱");
assert.equal(canonicalA.canonical, true);
assert.deepEqual(canonicalA.topology, {
  topologyId: flameMeta.id,
  topologyVersion: flameMeta.version,
});
assert.equal(canonicalB.vertices, vertices, "cached canonical loads preserve the loaded mesh");

let canonicalAttempts = 0;
const fallbackHead = {
  vertices,
  triangles,
  topology: {
    topologyId: "mediapipe-468",
    topologyVersion: "mediapipe-canonical-468-v1",
    triangles,
  },
} as HeadMeshPayload;
const fallbackService = new AnnotationMeshService({
  flameAssetUrl: noFlameAssets,
  loadBundledMesh: async () => {
    canonicalAttempts += 1;
    if (canonicalAttempts === 1) throw new Error("basis unavailable");
    return { vertices, triangles };
  },
  loadFallbackHead: async () => fallbackHead,
  lookupTopology,
});
const fallback = await fallbackService.loadCanonical();
assert.equal(fallback.modeLabel, "基础标准图谱");
assert.deepEqual(fallback.topology, fallbackHead.topology);
const retried = await fallbackService.loadCanonical();
assert.equal(canonicalAttempts, 2, "a rejected bundled load is cleared so a later load can retry");
assert.equal(retried.modeLabel, "高精度标准图谱");

const unavailable = await canonicalService.loadFlame("neutral");
assert.equal(unavailable.status, "unavailable");
assert.match(unavailable.message, /FLAME 资产未生成/);

const assetUrls: Record<AnnotationFlameAssetName, string | null> = {
  topology_flame_2023: "/topology.json",
  flame_neutral_vertices: "/neutral.json",
  flame_fitted_vertices: "/fitted.json",
};
const requested: Array<{ url: string; label: string }> = [];
const flameService = new AnnotationMeshService({
  flameAssetUrl: (name) => assetUrls[name],
  fetchJson: async <T>(url: string, label: string): Promise<T> => {
    requested.push({ url, label });
    if (url === "/topology.json") {
      return {
        topologyId: flameMeta.id,
        topologyVersion: flameMeta.version,
        triangles,
        vertexCount: 5023,
      } as MeshTopologyPayload as T;
    }
    return vertices as T;
  },
  lookupTopology,
});
assert.equal(flameService.flameAvailable("neutral"), true);
assert.equal(flameService.flameAvailable("fitted"), true);
const fitted = await flameService.loadFlame("fitted");
assert.equal(fitted.status, "loaded");
if (fitted.status === "loaded") {
  assert.equal(fitted.mesh.modeLabel, "FLAME 个体（拟合）");
  assert.match(fitted.mesh.hint, /5023 顶点/);
  assert.deepEqual(fitted.mesh.triangles, triangles);
}
assert.deepEqual(requested.map(({ url }) => url).sort(), ["/fitted.json", "/topology.json"]);

const parsedMesh: ParsedMesh = { vertices, triangles, colors: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
const uploadedService = new AnnotationMeshService({
  flameAssetUrl: noFlameAssets,
  parseFile: async () => parsedMesh,
});
const uploaded = await uploadedService.loadFile({ name: "patient.obj" } as File);
assert.equal(uploaded.canonical, false);
assert.equal(uploaded.topology, null);
assert.equal(uploaded.colors, parsedMesh.colors);
assert.match(uploaded.hint, /patient\.obj：3 顶点 \/ 1 三角面/);

await assert.rejects(
  fetchAnnotationMeshJson(
    "/broken.json",
    "FLAME 拓扑",
    (async () => new Response("unavailable", { status: 503 })) as typeof fetch,
  ),
  /FLAME 拓扑加载失败：HTTP 503/,
);

console.log("test_annotation_mesh_service OK");
