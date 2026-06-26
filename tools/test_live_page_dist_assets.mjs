import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WEB = path.join(ROOT, "web");
const viteBin = path.join(WEB, "node_modules", "vite", "bin", "vite.js");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "langerface-live-dist-"));

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

function normalizeLocalUrl(value) {
  if (!value || /^(?:data:|https?:|mailto:|#)/.test(value)) return null;
  if (/[${}`+]/.test(value)) return null;
  const clean = value.split("#")[0].split("?")[0];
  if (!clean) return null;
  return clean.startsWith("/") ? clean : `/${clean}`;
}

function collectLocalRefs(outDir) {
  const refs = new Set(["/index.html"]);
  const files = walkFiles(outDir);
  for (const file of files) {
    const rel = `/${path.relative(outDir, file).replaceAll(path.sep, "/")}`;
    if (/\.(?:js|css|html)$/.test(file)) refs.add(rel);
    if (!/\.(?:js|css|html)$/.test(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
      const ref = normalizeLocalUrl(match[1]);
      if (ref) refs.add(ref);
    }
    for (const match of text.matchAll(/["'`](\/?assets\/[^"'`)]+)["'`]/g)) {
      const ref = normalizeLocalUrl(match[1]);
      if (ref) refs.add(ref);
    }
    for (const match of text.matchAll(/url\(([^)]+)\)/g)) {
      const raw = match[1].trim().replace(/^["']|["']$/g, "");
      const ref = normalizeLocalUrl(raw);
      if (ref) refs.add(ref);
    }
  }
  return [...refs].sort();
}

function hasBuiltAsset(outDir, pattern) {
  return walkFiles(path.join(outDir, "assets")).some((file) => pattern.test(path.basename(file)));
}

function mimeFor(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".task") || file.endsWith(".bin")) return "application/octet-stream";
  return "application/octet-stream";
}

function createStaticServer(root) {
  return createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    let file = path.resolve(root, rel.slice(1));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    if ((!fs.existsSync(file) || !fs.statSync(file).isFile()) && (rel === "/app" || rel.startsWith("/app/"))) {
      file = path.resolve(root, "app/index.html");
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mimeFor(file), "Cache-Control": "no-store" });
    res.end(fs.readFileSync(file));
  });
}

async function withServer(root, fn) {
  const server = createStaticServer(root);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

try {
  const build = spawnSync(
    process.execPath,
    [viteBin, "build", "--outDir", outDir, "--emptyOutDir"],
    { cwd: WEB, encoding: "utf8" },
  );
  assert.equal(build.status, 0, build.stderr || build.stdout);

  const refs = collectLocalRefs(outDir);
  assert.ok(refs.length > 3, "built live page should expose local resource references");
  assert.ok(
    refs.some((ref) => ref.startsWith("/assets/") && ref.endsWith(".js")),
    "built live page should emit JS assets",
  );

  const requiredAssets = [
    [/^face_landmarker.*\.task$/, "face landmarker task"],
    [/^hand_landmarker.*\.task$/, "hand landmarker task"],
    [/^atlas_rstl.*\.json$/, "RSTL atlas JSON"],
    [/^atlas_langer.*\.json$/, "Langer atlas JSON"],
    [/^topology_mediapipe_468.*\.json$/, "MediaPipe topology JSON"],
    [/^canonical_vertices.*\.json$/, "canonical vertices JSON"],
    [/^triangles.*\.json$/, "triangles JSON"],
    [/^recon_demo.*\.json$/, "3D reconstruction demo JSON"],
    [/^flame_basis.*\.bin$/, "FLAME basis binary"],
    [/^workflow\.worker.*\.js$/, "React workflow Comlink worker"],
  ];
  for (const [pattern, label] of requiredAssets) {
    assert.ok(hasBuiltAsset(outDir, pattern), `built live page should include ${label}`);
  }

  await withServer(outDir, async (base) => {
    for (const ref of refs) {
      const response = await fetch(`${base}${ref}`);
      assert.equal(response.status, 200, `${ref} should not 404 in built live page`);
      const body = await response.arrayBuffer();
      assert.ok(body.byteLength > 0, `${ref} should not be empty`);
    }
  });

  console.log(`test_live_page_dist_assets: ${refs.length} built live page resources returned 200`);
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}
