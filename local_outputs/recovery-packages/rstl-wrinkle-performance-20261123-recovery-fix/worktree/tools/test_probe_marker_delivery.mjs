import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { captureMarkerIdentity, markerRepoRoot } from "./marker_runtime_identity.mts";
const run = promisify(execFile);
const expected = captureMarkerIdentity("small-lesion-boundary-candidate");
let mode = "good";
const server = createServer((req, res) => {
  if (mode === "timeout") return;
  if (mode === "502") { res.writeHead(502); res.end("no upstream"); return; }
  if (req.url === "/__runtime-identity.json") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(mode === "wrong-identity" ? { ...expected, head: "stale-head" } : expected));
  } else if (req.url.startsWith("/app/")) res.end('<script src="/src/main.tsx"></script>');
  else if (mode === "html-resource") res.end("<!doctype html>not a model");
  else res.end(readFileSync(resolve(markerRepoRoot, "web", req.url.slice(1))));
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;
const results = [];
try {
  for (mode of ["good", "wrong-identity", "html-resource", "502", "timeout"]) {
    let code = 0;
    try { await run(process.execPath, [resolve(markerRepoRoot, "tools/probe_marker_delivery.mjs"), url],
      { env: { ...process.env, DELIVERY_PROBE_TIMEOUT_MS: mode === "timeout" ? "100" : "20000" }, timeout: 30000 });
    } catch (e) { code = e.code; }
    assert.equal(code, mode === "good" ? 0 : 1, mode);
    results.push({ mode, exitCode: code, status: "PASS" });
  }
  console.log(JSON.stringify({ status: "PASS", results }, null, 2));
} finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
