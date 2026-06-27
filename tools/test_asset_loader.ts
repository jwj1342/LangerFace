import assert from "node:assert/strict";
import { createServer } from "node:http";

import { assetNames, assetUrl, loadJsonAsset, normalizeAssetBaseUrl } from "../web/src/services/assetLoader.ts";

function createAssetServer() {
  return createServer((req, res) => {
    if (req.url === "/assets/canonical_vertices.json") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": "7",
      });
      res.end("[1,2,3]");
      return;
    }
    if (req.url === "/assets/atlas_rstl.json") {
      const html = "<!DOCTYPE html><html><body>SPA fallback</body></html>";
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": String(html.length),
      });
      res.end(html);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("missing");
  });
}

async function withAssetBase(server, fn) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const originalLocation = globalThis.location;
  const originalStorage = globalThis.localStorage;
  globalThis.location = { search: `?assetBase=http://127.0.0.1:${port}/assets` };
  globalThis.localStorage = {
    getItem() { return ""; },
    setItem() {},
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

await withAssetBase(createAssetServer(), async () => {
  const data = await loadJsonAsset("canonicalVertices", { label: "标准脸顶点" });
  assert.deepEqual(data, [1, 2, 3], "JSON asset loader fetches from configured asset base");
  await assert.rejects(
    () => loadJsonAsset("triangles", { label: "三角拓扑" }),
    /资产加载失败：三角拓扑 HTTP 404/,
    "missing lazy-loaded assets fail loudly with the HTTP status",
  );
  await assert.rejects(
    () => loadJsonAsset("atlasRstl", { label: "RSTL 图谱" }),
    /资产解析失败：RSTL 图谱 不是有效 JSON.*响应看起来是 HTML/,
    "HTML SPA fallbacks fail with an actionable JSON asset error",
  );
});

console.log("test_asset_loader: runtime asset URL and lazy-load failure assertions passed");
