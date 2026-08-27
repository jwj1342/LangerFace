import assert from "node:assert/strict";
import { spawn } from "node:child_process";

import {
  LocalProviderError,
  PersistentDetector,
} from "../web/dev/localWrinkleV10Plugin.ts";

const respondingChild = () => spawn(process.execPath, ["-e", `
  process.stdout.write(JSON.stringify({
    type: "ready",
    detectorVersion: "paired-edge-v10-dynamic-four-region-1.0",
    checkpointSha256: "e301b8f70c8239c01504a0616b61acdf9ab9b5796f513d6e7294d4fa52b6a6c2"
  }) + "\\n");
  process.stdin.setEncoding("utf8");
  let buffered = "";
  process.stdin.on("data", (chunk) => {
    buffered += chunk;
    const newline = buffered.indexOf("\\n");
    if (newline < 0) return;
    const request = JSON.parse(buffered.slice(0, newline));
    process.stdout.write(JSON.stringify({ id: request.id, ok: true }) + "\\n");
  });
`], { stdio: ["pipe", "pipe", "pipe"] });

const hangingChild = () => spawn(process.execPath, ["-e", "process.stdin.resume()"], {
  stdio: ["pipe", "pipe", "pipe"],
});

const successful = new PersistentDetector({ spawnDetector: respondingChild, requestTimeoutMs: 500 });
await successful.run("request", "rgba", "output", new AbortController().signal);
successful.close();

const bounded = new PersistentDetector({ spawnDetector: hangingChild, requestTimeoutMs: 2_000 });
const boundedController = new AbortController();
const first = bounded.run("request", "rgba", "output", boundedController.signal);
await assert.rejects(
  bounded.run("request-2", "rgba-2", "output-2", new AbortController().signal),
  (error) => error instanceof LocalProviderError && error.statusCode === 429,
);
boundedController.abort();
await assert.rejects(first, /浏览器已取消/);

const timed = new PersistentDetector({ spawnDetector: hangingChild, requestTimeoutMs: 50 });
await assert.rejects(
  timed.run("request", "rgba", "output", new AbortController().signal),
  (error) => error instanceof LocalProviderError && error.statusCode === 504,
);

console.log("local V10 bridge response, cancellation, timeout and bounded concurrency tests passed");
