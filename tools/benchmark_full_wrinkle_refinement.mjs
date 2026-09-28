import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rolldown } from "../web/node_modules/rolldown/dist/index.mjs";

// Compare two independent worker bundles in one browser session. A fixed
// synthetic YOLO mask bypasses model loading; a real archived V10 response
// drives the full refinement path. This is not photo end-to-end latency.
// The API is exposed only to this local benchmark; production uses Comlink.
// Usage: node tools/benchmark_full_wrinkle_refinement.mjs CONTROL_WORKTREE
//   YOLO_FIXTURE_JSON V10_RESPONSE_JSON [ODD_ROUNDS] [REPORT_JSON]
async function browserExperiment() {
  const equal = (first, second, label) => {
    if (first !== second) throw new Error(`Exact equality failed: ${label}`);
  };
  const stable = (value) => {
    const encode = (item) => {
      if (typeof item === "number") return ["number", Object.is(item, -0) ? "-0" : String(item)];
      if (item === null || typeof item !== "object") return [typeof item, item];
      if (ArrayBuffer.isView(item)) return [item.constructor.name, Array.from(item, encode)];
      if (Array.isArray(item)) return ["array", item.map(encode)];
      return ["object", Object.keys(item).sort().map((key) => [key, encode(item[key])])];
    };
    return JSON.stringify(encode(value));
  };
  const { fixture, payload, rounds } = await (await fetch("/fixtures")).json();
  const controllers = await Promise.all(["control", "experiment"].map((name) => new Promise((resolve, reject) => {
    const worker = new Worker(`/${name}.mjs`, { type: "module" });
    let nextId = 0;
    const pending = new Map();
    worker.onmessage = ({ data }) => {
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      if (data.error) entry.reject(new Error(data.error));
      else entry.resolve(data.result);
    };
    worker.onerror = (event) => reject(new Error(event.message));
    resolve({ name, worker, call(method, request) {
      return new Promise((resolveCall, rejectCall) => {
        const id = ++nextId;
        pending.set(id, { resolve: resolveCall, reject: rejectCall });
        worker.postMessage({ id, method, request });
      });
    } });
  })));
  try {
    const request = fixture.capture.request.value;
    const detections = [];
    for (const controller of controllers) {
      const detected = await controller.call("detect", {
        pixels: new Uint8ClampedArray(request.size * request.size * 4),
        width: request.size, height: request.size, size: request.size,
        landmarks: request.landmarks, mode: "full", includeFingerprint: false,
      });
      if (!detected.detectionId) throw new Error("Missing detection ID");
      detections.push(detected);
    }
    equal(stable(detections[0].evidence), stable(detections[1].evidence), "detection evidence");
    const results = [];
    for (let round = 0; round < rounds; round += 1) {
      for (const index of round % 2 ? [1, 0] : [0, 1]) {
        const start = performance.now();
        const result = await controllers[index].call("refine", {
          ...structuredClone(request), detectionId: detections[index].detectionId,
        });
        results.push({ round, name: controllers[index].name, wallMs: performance.now() - start,
          refinementMs: result.refinementMs, noseAndVisibilityMs: result.noseAndVisibilityMs,
          refined: result.refined });
      }
    }
    const control = results.find((item) => item.name === "control");
    for (const result of results) {
      equal(stable(result.refined), stable(control.refined), `${result.name}/${result.round}: full output`);
      for (const field of ["curves", "diagnostics", "audit"]) {
        equal(stable(result.refined[field]), stable(control.refined[field]),
          `${result.name}/${result.round}: ${field}`);
      }
    }
    const stats = Object.fromEntries(controllers.map(({ name }) => {
      const values = results.filter((result) => result.name === name)
        .map((result) => result.wallMs).sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      return [name, { medianWallMs: values.length % 2 ? values[middle] :
        (values[middle - 1] + values[middle]) / 2,
        wallMs: values }];
    }));
    const hash = async (value) => {
      const bytes = new TextEncoder().encode(stable(value));
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    };
    const outputHashes = Object.fromEntries(await Promise.all(
      ["curves", "diagnostics", "audit", "complete"].map(async (field) =>
        [field, await hash(field === "complete" ? control.refined : control.refined[field])]),
    ));
    return { report: { rounds, stats, exactEquality: true, outputHashes,
      detections: detections.map((item) => ({ evidenceBuildMs: item.timings.evidenceBuildMs,
        totalMs: item.timings.totalMs })),
      runs: results.map(({ refined, ...rest }) => rest) } };
  } finally {
    for (const controller of controllers) controller.worker.terminate();
  }
}

const root = fileURLToPath(new URL("../", import.meta.url));
const worktree = path.resolve(process.argv[2]);
const fixturePath = path.resolve(process.argv[3]);
const payloadPath = path.resolve(process.argv[4]);
const rounds = Number(process.argv[5] || 3);
const reportPath = process.argv[6] ? path.resolve(process.argv[6]) : null;
assert.ok(Number.isInteger(rounds) && rounds >= 3);
const fixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
const payload = JSON.parse(await fs.readFile(payloadPath, "utf8"));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "rstl-full-guidance-benchmark-"));
let server;
try {
  for (const [name, sourceRoot] of [["control", worktree], ["experiment", root]]) {
    const bundler = await rolldown({
      input: "benchmark-entry", platform: "browser", external: ["onnxruntime-web"],
      plugins: [{
        name: "local-worker-experiment",
        resolveId(id) {
          if (id === "benchmark-entry") return "\0benchmark-entry";
          if (id === "comlink") return "\0benchmark-api";
          if (id.endsWith("?url")) return "\0benchmark-asset";
        },
        load(id) {
          if (id === "\0benchmark-api") return `export const expose = api => {
            globalThis.onmessage = async ({ data }) => {
              try {
                const result = await api[data.method](data.request);
                postMessage({ id: data.id, result });
              } catch (error) {
                postMessage({ id: data.id, error: error.stack || String(error) });
              }
            };
          };`;
          if (id === "\0benchmark-asset") return 'export default "unused";';
          if (id === "\0benchmark-entry") return `
            import { YoloWrinkleOnnx, YOLO_WRINKLE_ONNX_VERSION } from
              ${JSON.stringify(path.join(sourceRoot, "web/src/services/personalized/yoloWrinkleOnnx.ts"))};
            const size = ${fixture.capture.request.value.size};
            const classMasks = Object.fromEntries(["forehead", "frown", "wrinkle"].map(name =>
              [name, new Uint8Array(size * size)]));
            for (const [name, y] of [["forehead", 300], ["frown", 500], ["wrinkle", 700]]) {
              for (let x = 400; x < 650; x++) classMasks[name][y * size + x] = 1;
            }
            YoloWrinkleOnnx.prototype.load = async function() { return this; };
            YoloWrinkleOnnx.prototype.detect = async function() {
              return { version: YOLO_WRINKLE_ONNX_VERSION, classMasks, detections: [], diagnostics: {} };
            };
            import ${JSON.stringify(path.join(sourceRoot,
              "web/src/workers/liveWrinklePipeline.worker.ts"))};`;
        },
      }],
    });
    await bundler.write({ file: path.join(temporary, `${name}.mjs`), format: "esm", codeSplitting: false });
    await bundler.close();
  }
  let finish;
  const completed = new Promise((resolve) => { finish = resolve; });
  server = http.createServer(async (request, response) => {
    try {
      if (request.url === "/fixtures") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ fixture, payload, rounds }));
      } else if (request.url === "/api/wrinkle-v10") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({
          schemaVersion: "langerface.wrinkle-v10-provider.v1",
          providerId: "local-benchmark", detectorVersion: payload.detectorVersion,
          checkpointSha256: payload.checkpointSha256,
          processingLocation: "host_machine", ready: true,
          directDetectUrl: "/detect", accessToken: null, expiresAt: null,
          maximumRequestBytes: 32 * 1024 * 1024,
        }));
      } else if (request.url === "/detect") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(payload));
      } else if (request.url === "/control.mjs" || request.url === "/experiment.mjs") {
        response.setHeader("Content-Type", "text/javascript");
        response.end(await fs.readFile(path.join(temporary, request.url.slice(1))));
      } else if (request.url === "/result" && request.method === "POST") {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const result = JSON.parse(Buffer.concat(chunks).toString());
        response.end("saved");
        finish(result);
      } else {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(`<!doctype html><html><body><pre id="status">Starting...</pre><script type="module">
          (${browserExperiment.toString()})().then(async ({ report }) => {
            await fetch('/result', { method: 'POST', body: JSON.stringify({ report }) });
            document.querySelector('#status').textContent = 'COMPLETE ' + JSON.stringify(report);
          }).catch(async error => {
            await fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack || String(error) }) });
            document.querySelector('#status').textContent = 'FAILED ' + (error.stack || String(error));
          });</script></body></html>`);
      }
    } catch (error) {
      response.statusCode = 500;
      response.end(String(error));
      finish({ error: String(error) });
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  console.log(`Open local experiment: http://127.0.0.1:${server.address().port}`);
  let timeout;
  const result = await Promise.race([completed, new Promise((resolve) => {
    timeout = setTimeout(() => resolve({ error: "Browser experiment timed out" }), 900_000);
  })]);
  clearTimeout(timeout);
  assert.ok(!result.error, result.error);
  if (reportPath) await fs.writeFile(reportPath, JSON.stringify(result.report, null, 2));
  console.log(JSON.stringify(result.report, null, 2));
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await fs.rm(temporary, { recursive: true, force: true });
}
