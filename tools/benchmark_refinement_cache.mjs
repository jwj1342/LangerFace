import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rolldown } from "../web/node_modules/rolldown/dist/index.mjs";

// This function is bundled into an isolated browser worker, never executed in Node.
async function browserExperiment() {
  const difference = (a, b) => {
    const result = { differingNumberCount: 0, maxAbsNumericDifference: 0, structuralDifferences: 0, firstDifference: null };
    const visit = (first, second, location) => {
      if (Object.is(first, second)) return;
      if (typeof first === "number" && typeof second === "number") {
        if (!result.firstDifference) result.firstDifference = { location, first, second };
        result.differingNumberCount += 1;
        result.maxAbsNumericDifference = Math.max(result.maxAbsNumericDifference, Math.abs(first - second));
        return;
      }
      if (first && second && typeof first === "object" && typeof second === "object") {
        const keys = [...new Set([...Object.keys(first), ...Object.keys(second)])];
        for (const key of keys) visit(first[key], second[key], `${location}.${key}`);
        return;
      }
      if (!result.firstDifference) result.firstDifference = { location, first, second };
      result.structuralDifferences += 1;
    };
    visit(a, b, "output");
    return result;
  };
  const equal = (a, b, label) => {
    if (stableRefinementSerialization(a) !== stableRefinementSerialization(b)) {
      throw new Error(`Exact equality failed: ${label}`);
    }
  };
  const { fixtures, priorBaseline, rounds } = await (await fetch("/fixtures")).json();
  const api = globalThis.__refinementBenchmarkApi;
  const report = { runtime: navigator.userAgent, rounds, samples: {}, stableBaselines: {} };
  for (const name of ["white", "yellow"]) {
    const fixture = fixtures[name];
    const request = fixture.capture.request.value;
    const seeded = await api.seedYoloEvidence({
      lines: fixture.debug.evidenceLines.map(line => ({
        id: line.id, class: line.className, points: line.points, sourceComponentId: line.id, lengthPx: 0,
      })),
      summary: {}, size: request.size, landmarks: request.landmarks,
      detectorVersion: fixture.capture.response.detectorVersion,
      cacheForRefinement: true, timings: fixture.debug.timings,
    });
    if (!seeded.detectionId) throw new Error("Missing detection cache");
    const run = performanceMode => api.refine({
      ...structuredClone(request), detectionId: seeded.detectionId, performanceMode,
    });
    const baseline = await run("baseline");
    // Archived UI JSON added a profile and converted Infinity to null.
    const archivedReplay = JSON.parse(JSON.stringify(baseline.refined));
    archivedReplay.diagnostics.refinement_profile = baseline.refinementProfile;
    const historicalComparison = difference(archivedReplay, fixture.capture.response.refined);
    historicalComparison.exactEquality = stableRefinementSerialization(archivedReplay) ===
      stableRefinementSerialization(fixture.capture.response.refined);
    if (historicalComparison.structuralDifferences) {
      throw new Error(`Historical output has structural differences: ${JSON.stringify(historicalComparison)}`);
    }
    const originalHashes = await refinementOutputHashes(baseline.refined);
    historicalComparison.losslessHashesMatch = stableRefinementSerialization(originalHashes) ===
      stableRefinementSerialization(priorBaseline[name].outputHashes);
    equal(baseline.performance.outputHashes, originalHashes, `${name}: baseline worker hashes`);
    report.stableBaselines[name] = stableRefinementSerialization(baseline.refined);
    const ordinary = await run();
    equal(ordinary.refined, baseline.refined, `${name}: default product path`);
    if (ordinary.performance !== undefined) throw new Error("Default path exposes performance");
    const runs = [];
    for (let round = 0; round < rounds; round += 1) {
      for (const mode of round % 2 ? ["cached", "baseline"] : ["baseline", "cached"]) {
        const start = performance.now();
        const result = await run(mode);
        const wallMs = performance.now() - start;
        for (const field of ["curves", "diagnostics", "audit"]) {
          equal(result.refined[field], baseline.refined[field], `${name}/${mode}/${round}: ${field}`);
        }
        equal(result.refined, baseline.refined, `${name}/${mode}/${round}: complete output`);
        equal(result.performance.outputHashes, originalHashes, `${name}/${mode}/${round}: hashes`);
        runs.push({ round, mode, wallMs, ...result.performance, exactEquality: true });
        postMessage({ progress: { name, round: round + 1, mode, refinementMs: result.refinementMs } });
      }
    }
    const distribution = values => {
      const sorted = values.toSorted((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return { median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
        p95: sorted[Math.ceil(sorted.length * 0.95) - 1], min: sorted[0], max: sorted.at(-1) };
    };
    const stats = Object.fromEntries(["baseline", "cached"].map(mode => {
      const selected = runs.filter(item => item.mode === mode);
      return [mode, {
        wallMs: distribution(selected.map(item => item.wallMs)),
        refinementMs: distribution(selected.map(item => item.refinementMs)),
        foreheadMs: distribution(selected.map(item => item.forehead?.totalMs || 0)),
        glabellarMs: distribution(selected.map(item => item.glabellar?.totalMs || 0)),
        globalGuardMs: distribution(selected.map(item => item.globalGuardMs)),
      }];
    }));
    report.samples[name] = { originalHashes, priorBrowserHashes: priorBaseline[name].outputHashes,
      historicalComparison, exactEquality: true, defaultPathExactEquality: true,
      inputCurveCount: request.seeds.length,
      inputPointCount: request.seeds.reduce((sum, seed) => sum + seed.pts.length, 0),
      outputCurveCount: baseline.refined.curves.length,
      outputPointCount: baseline.refined.curves.reduce((sum, curve) => sum + curve.pts.length, 0),
      stats, runs };
  }
  postMessage({ report });
}

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = path.resolve(process.argv[2] || path.join(root, "../wrinkle_refinement_performance_20260917"));
const rounds = Number(process.argv[3] || 3);
assert.ok(Number.isInteger(rounds) && rounds >= 2, "at least two rounds are required");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "rstl-cache-benchmark-"));
const fixtures = Object.fromEntries(await Promise.all(["white", "yellow"].map(async name =>
  [name, JSON.parse(await fs.readFile(path.join(directory, `${name}-original.json`), "utf8"))])));
const priorBaseline = JSON.parse(await fs.readFile(path.join(directory, "instrumented-baseline.json"), "utf8"));
let server;
try {
  const bundle = path.join(temporary, "worker.mjs");
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
        if (id === "\0benchmark-api") return "export const expose = api => { globalThis.__refinementBenchmarkApi = api; };";
        if (id === "\0benchmark-asset") return 'export default "unused";';
        if (id === "\0benchmark-entry") return `
          import ${JSON.stringify(path.join(root, "web/src/workers/liveWrinklePipeline.worker.ts"))};
          import { refinementOutputHashes, stableRefinementSerialization } from ${JSON.stringify(path.join(root, "web/src/services/personalized/refinementOutputHash.ts"))};
          (${browserExperiment.toString()})().catch(error => postMessage({ error: error.stack || String(error) }));
        `;
      },
    }],
  });
  await bundler.write({ file: bundle, format: "esm", codeSplitting: false });
  await bundler.close();
  let finish;
  const completed = new Promise(resolve => { finish = resolve; });
  server = http.createServer(async (request, response) => {
    try {
      if (request.url === "/fixtures") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ fixtures, priorBaseline, rounds }));
      } else if (request.url === "/worker.mjs") {
        response.setHeader("Content-Type", "text/javascript");
        response.end(await fs.readFile(bundle));
      } else if (request.url === "/result" && request.method === "POST") {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const result = JSON.parse(Buffer.concat(chunks).toString());
        if (result.report) {
          const { stableBaselines, ...report } = result.report;
          await fs.writeFile(path.join(directory, "repeated-cache-benchmark.json"), JSON.stringify(report, null, 2));
          for (const [name, serialization] of Object.entries(stableBaselines)) {
            await fs.writeFile(path.join(directory, `${name}-baseline-stable.json`), serialization);
          }
          console.log(JSON.stringify(Object.fromEntries(Object.entries(report.samples).map(([name, sample]) => [name, sample.stats])), null, 2));
        } else console.error(result.error);
        response.end("saved");
        finish(result);
      } else {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(`<!doctype html><html><head><title>Refinement cache experiment</title></head>
          <body><h1>Local refinement cache experiment</h1><pre id="status">Starting browser worker...</pre>
          <script type="module">
            const status = document.querySelector('#status');
            const worker = new Worker('/worker.mjs', { type: 'module' });
            worker.onmessage = async ({ data }) => {
              if (data.progress) {
                const p = data.progress;
                status.textContent += '\\n' + p.name + ' ' + p.round + ' ' + p.mode + ': ' + p.refinementMs.toFixed(1) + 'ms; exact equality';
                return;
              }
              await fetch('/result', { method: 'POST', body: JSON.stringify(data) });
              status.textContent += data.error ? '\\nFAILED: ' + data.error : '\\nCOMPLETE: all coordinates, diagnostics, audit and hashes are identical. Results saved locally.';
              worker.terminate();
            };
            worker.onerror = async event => {
              status.textContent += '\\nFAILED: ' + event.message;
              await fetch('/result', { method: 'POST', body: JSON.stringify({ error: event.message }) });
            };
          </script></body></html>`);
      }
    } catch (error) {
      response.statusCode = 500;
      response.end(String(error));
      finish({ error: String(error) });
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  console.log(`Open local experiment: http://127.0.0.1:${server.address().port}`);
  let timer;
  const result = await Promise.race([completed, new Promise(resolve => {
    timer = setTimeout(() => resolve({ error: "Browser experiment timed out after 15 minutes" }), 900_000);
  })]);
  clearTimeout(timer);
  assert.ok(!result.error, result.error);
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await fs.rm(temporary, { recursive: true, force: true });
}
