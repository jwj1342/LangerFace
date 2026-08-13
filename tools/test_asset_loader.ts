import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assetNames, assetUrl, loadJsonAsset, normalizeAssetBaseUrl } from "../web/src/services/assetLoader.ts";
import { dataSource } from "../web/src/services/dataSource.ts";
import { els } from "../web/src/services/liveDom.ts";
import { modelState } from "../web/src/services/liveState.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
} = await import(pathToFileURL(join(
  root,
  "web",
  "node_modules",
  "@mediapipe",
  "tasks-vision",
  "vision_bundle.mjs",
)).href);

function createAssetServer() {
  return createServer((req, res) => {
    if (req.url === "/assets/canonical_vertices.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("[[0,0,0],[1,0,0],[0,1,0]]");
      return;
    }
    if (req.url === "/assets/topology_mediapipe_468.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"topologyId":"mediapipe-468","topologyVersion":"mediapipe-468-v1","triangles":[[0,1,2]]}');
      return;
    }
    if (req.url === "/assets/atlas_rstl.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"system":"rstl","version":"test","lines":[{"name":"r0","points":[[0,0.2,0.3]]}]}');
      return;
    }
    if (req.url === "/assets/atlas_langer.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"system":"langer","version":"test","lines":[]}');
      return;
    }
    if (req.url === "/assets/flame_basis.bin") {
      const flameBasis = readFileSync(join(root, "web/assets/flame_basis.bin"));
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(flameBasis.byteLength),
      });
      res.end(flameBasis);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("missing");
  });
}

function createHtmlFallbackAssetServer() {
  return createServer((req, res) => {
    if (req.url === "/assets/atlas_rstl.json") {
      const html = "<!DOCTYPE html><html><body>SPA fallback</body></html>";
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": String(html.length),
      });
      res.end(html);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<!DOCTYPE html><html><body>not found</body></html>");
  });
}

async function withAssetBase(server, fn) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const originalLocation = globalThis.location;
  const originalStorage = globalThis.localStorage;
  const store = new Map<string, string>();
  globalThis.location = { search: `?assetBase=http://127.0.0.1:${port}/assets` };
  globalThis.localStorage = {
    getItem(key) { return store.has(String(key)) ? store.get(String(key)) ?? "" : ""; },
    setItem(key, value) { store.set(String(key), String(value)); },
    removeItem(key) { store.delete(String(key)); },
  };
  try {
    await fn();
  } finally {
    if (originalLocation === undefined) delete globalThis.location;
    else globalThis.location = originalLocation;
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
assert.equal(assetNames.atlasRstl, "atlas_rstl.json", "asset names expose RSTL atlas filename");
assert.equal(assetNames.canonicalVertices, "canonical_vertices.json", "asset names expose canonical vertices filename");

const relative = normalizeAssetBaseUrl("assets/");
assert.ok(relative.endsWith("/assets/"), "bare local asset base resolves under root /assets/");
assert.ok(!relative.startsWith("https://assets/"), "bare assets path is not treated as a hostname");

const originalDocument = globalThis.document;
globalThis.document = { baseURI: "https://example.test/app/incision" };
try {
  assert.equal(
    normalizeAssetBaseUrl("assets/"),
    "https://example.test/assets/",
    "bare local asset base does not resolve under nested SPA routes",
  );
  assert.equal(
    normalizeAssetBaseUrl("/assets/"),
    "https://example.test/assets/",
    "root asset base remains stable under nested SPA routes",
  );
} finally {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
}

assert.equal(
  normalizeAssetBaseUrl("cdn.example.com/langerface-assets"),
  "https://cdn.example.com/langerface-assets/",
  "host-like asset base gets https and trailing slash",
);
assert.equal(
  normalizeAssetBaseUrl("https://cdn.example.com/langerface-assets/"),
  "https://cdn.example.com/langerface-assets/",
  "absolute asset base is preserved",
);

assert.ok(assetUrl("atlasRstl").endsWith("/assets/atlas_rstl.json"), "default RSTL asset URL resolves under /assets/");
assert.ok(assetUrl("faceLandmarkerTask").endsWith("/assets/face_landmarker.task"), "task model resolves under /assets/");

{
  const originalFetch = globalThis.fetch;
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    requestInit = init;
    return new Response('{"version":"cache-policy-probe"}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await loadJsonAsset("cache_policy_probe.json");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(
    requestInit?.cache,
    "no-cache",
    "stable-name runtime assets must revalidate even when the browser has a fresh legacy immutable entry",
  );
}

await withAssetBase(createAssetServer(), async () => {
  const data = await loadJsonAsset("canonicalVertices", { label: "标准脸顶点" });
  assert.deepEqual(data, [[0, 0, 0], [1, 0, 0], [0, 1, 0]], "JSON asset loader fetches from configured asset base");
  const head = await dataSource.getHeadMesh("mediapipe-468");
  assert.equal(head.topologyId, "mediapipe-468", "data source returns topology metadata with head mesh");
  assert.deepEqual(head.triangles, [[0, 1, 2]], "data source returns canonical mesh triangles");
  const heads = await dataSource.listHeads();
  assert.ok(heads.some((item) => item.id === "flame-2023" && item.topologyId === "flame-2023"),
    "data source advertises the FLAME head asset");
  const flameHead = await dataSource.getHeadMesh("flame-2023");
  assert.equal(flameHead.topologyId, "flame-2023", "data source can build the FLAME head from the bundled basis");
  assert.equal(flameHead.vertices.length, 5023, "FLAME head exposes neutral vertices from flame_basis.bin");
  assert.equal(flameHead.triangles.length, 9976, "FLAME head exposes topology faces from flame_basis.bin");
  const rstl = await dataSource.loadAtlas("rstl");
  assert.equal(rstl.system, "rstl", "data source loads RSTL atlas by system");
  await assert.rejects(
    () => loadJsonAsset("triangles", { label: "三角拓扑" }),
    /资产加载失败：三角拓扑 HTTP 404/,
    "missing lazy-loaded assets fail loudly with the HTTP status",
  );
});

await withAssetBase(createHtmlFallbackAssetServer(), async () => {
  await assert.rejects(
    () => loadJsonAsset("atlasRstl", { label: "RSTL 图谱" }),
    /资产解析失败：RSTL 图谱 不是有效 JSON.*响应看起来是 HTML/,
    "HTML SPA fallbacks fail with an actionable JSON asset error",
  );
});

for (const rel of [
  "web/src/services/pipelineModels.ts",
  "web/src/services/annotateRuntime.ts",
  "web/src/services/standardFaceAssets.ts",
]) {
  const source = readFileSync(join(root, rel), "utf8");
  assert.ok(!/fetch\(\s*assetUrls\.(topology|atlasRstl|atlasLanger|canonicalVertices|triangles)/.test(source),
    `${rel} reads static JSON assets through dataSource instead of direct asset fetches`);
}

for (const rel of ["web/src/services/pipelineModels.ts"]) {
  const source = readFileSync(join(root, rel), "utf8");
  assert.match(source, /let readyPromise(?:: Promise<void> \| null)? = null;/,
    `${rel} owns one module-scoped readiness promise`);
  assert.match(source, /readyPromise = initializeReady\(\)\.catch/,
    `${rel} shares the complete initialization attempt`);
  assert.match(source, /readyPromise = null;\s*throw error;/,
    `${rel} clears a failed attempt before retry`);
}

{
  const originalLoadTopology = dataSource.loadTopology;
  const originalLoadAtlas = dataSource.loadAtlas;
  const originalForVisionTasks = FilesetResolver.forVisionTasks;
  const originalCreateFace = FaceLandmarker.createFromOptions;
  const originalCreateHand = HandLandmarker.createFromOptions;
  const originalBadge = els.badge;
  const originalConsoleInfo = console.info;
  const originalConsoleWarn = console.warn;
  const originalModelState = {
    landmarker: modelState.landmarker,
    handLandmarker: modelState.handLandmarker,
    topology: modelState.topology,
    triangles: modelState.triangles,
    noseTris: modelState.noseTris,
    atlases: modelState.atlases,
    officialAtlases: modelState.officialAtlases,
  };
  let topologyLoads = 0;
  let atlasLoads = 0;
  let resolverLoads = 0;
  const faceDelegates: string[] = [];
  const handDelegates: string[] = [];
  let rejectFaceAttempt = true;
  const faceModel = { kind: "face" };
  const handModel = { kind: "hand" };

  try {
    modelState.landmarker = null;
    modelState.handLandmarker = null;
    modelState.topology = null;
    modelState.triangles = null;
    modelState.noseTris = null;
    modelState.atlases = {};
    modelState.officialAtlases = {};
    els.badge = {
      textContent: "",
      classList: { remove() {} },
    } as unknown as HTMLElement;
    console.info = () => {};
    console.warn = () => {};

    dataSource.loadTopology = async () => {
      topologyLoads += 1;
      return {
        topologyId: "mediapipe-468",
        topologyVersion: "mediapipe-canonical-468-v1",
        triangles: [[0, 1, 2]],
      };
    };
    dataSource.loadAtlas = async (system: string) => {
      atlasLoads += 1;
      return {
        system,
        version: "0.2",
        topologyId: "mediapipe-468",
        topologyVersion: "mediapipe-canonical-468-v1",
        lines: [{ name: `${system}-line`, points: [[0, 0.2, 0.2], [0, 0.3, 0.2]] }],
      };
    };
    FilesetResolver.forVisionTasks = async () => {
      resolverLoads += 1;
      return {} as never;
    };
    FaceLandmarker.createFromOptions = async (
      _resolver: unknown,
      options: { baseOptions?: { delegate?: unknown } },
    ) => {
      const delegate = String(options.baseOptions?.delegate);
      faceDelegates.push(delegate);
      if (rejectFaceAttempt) throw new Error(`${delegate} initialization failed`);
      return faceModel as never;
    };
    HandLandmarker.createFromOptions = async (
      _resolver: unknown,
      options: { baseOptions?: { delegate?: unknown } },
    ) => {
      handDelegates.push(String(options.baseOptions?.delegate));
      return handModel as never;
    };

    const moduleUrl = new URL("../web/src/services/pipelineModels.ts", import.meta.url);
    moduleUrl.searchParams.set("single-flight-test", String(Date.now()));
    const { ensureReady } = await import(moduleUrl.href);

    const failedA = ensureReady();
    const failedB = ensureReady();
    assert.strictEqual(failedB, failedA, "concurrent callers share the failed initialization promise");
    await assert.rejects(failedA, /CPU initialization failed/);
    assert.deepEqual(faceDelegates, ["GPU", "CPU"], "GPU fallback runs once for one shared attempt");
    assert.equal(topologyLoads, 1, "shared failed attempt loads topology once");
    assert.equal(atlasLoads, 2, "shared failed attempt loads each atlas once");
    assert.equal(resolverLoads, 1, "shared failed attempt creates one fileset resolver");

    rejectFaceAttempt = false;
    const retryA = ensureReady();
    const retryB = ensureReady();
    assert.notStrictEqual(retryA, failedA, "a failed attempt is cleared for retry");
    assert.strictEqual(retryB, retryA, "concurrent retry callers share one promise");
    await retryA;
    assert.deepEqual(faceDelegates, ["GPU", "CPU", "GPU"], "retry starts one fresh GPU attempt");
    assert.deepEqual(handDelegates, ["GPU"], "successful retry initializes the hand model once");
    assert.equal(modelState.landmarker, faceModel, "successful initialization publishes one face instance");
    assert.equal(modelState.handLandmarker, handModel, "successful initialization publishes one hand instance");
    assert.strictEqual(ensureReady(), retryA, "later callers reuse the successful readiness promise");
  } finally {
    dataSource.loadTopology = originalLoadTopology;
    dataSource.loadAtlas = originalLoadAtlas;
    FilesetResolver.forVisionTasks = originalForVisionTasks;
    FaceLandmarker.createFromOptions = originalCreateFace;
    HandLandmarker.createFromOptions = originalCreateHand;
    console.info = originalConsoleInfo;
    console.warn = originalConsoleWarn;
    if (originalBadge === undefined) delete (els as Partial<typeof els>).badge;
    else els.badge = originalBadge;
    Object.assign(modelState, originalModelState);
  }
}

console.log("test_asset_loader: runtime asset URL and lazy-load failure assertions passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
