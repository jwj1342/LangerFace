import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";

import {
  inspectLocalWrinkleRuntime,
  localWrinkleV10Plugin,
  LocalProviderError,
  PersistentDetector,
  pythonCandidates,
} from "../web/dev/localWrinkleV10Plugin.ts";
import {
  WRINKLE_V10_CHECKPOINT_SHA256,
  WRINKLE_V10_DETECTOR_VERSION,
  WRINKLE_V10_PROVIDER_SCHEMA,
} from "../web/src/services/personalized/wrinkleV10Provider.ts";

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

const failingChild = () => spawn(process.execPath, ["-e", `
  process.stderr.write("ModuleNotFoundError: No module named 'torch'\\n");
  process.exit(1);
`], { stdio: ["pipe", "pipe", "pipe"] });

const repositoryCandidates = pythonCandidates({
  environment: {},
  platform: "linux",
  repositoryRoot: "/work/LangerFace",
});
assert.deepEqual(repositoryCandidates, [
  "/work/LangerFace/.venv/bin/python",
  "python3",
  "python",
]);
assert.ok(repositoryCandidates.every((candidate) => !candidate.includes("anaconda3")),
  "local runtime discovery must not contain paths from a contributor's computer");
const bridgeSource = await readFile(
  new URL("../web/dev/localWrinkleV10Plugin.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(bridgeSource, /\/opt\/anaconda3|Users\/huang/,
  "the local bridge must not contain paths from a contributor's computer");
const wrinkleConstraints = await readFile(
  new URL("../requirements-wrinkle-lock.txt", import.meta.url),
  "utf8",
);
for (const pinned of [
  "numpy==2.2.6",
  "opencv-python==4.12.0.88",
  "scipy==1.15.3",
  "torch==2.9.1",
]) {
  assert.ok(wrinkleConstraints.includes(pinned), `missing reproducibility constraint ${pinned}`);
}

const configuredCandidates = pythonCandidates({
  environment: {
    LANGERFACE_WRINKLE_PYTHON: "/custom/python",
    VIRTUAL_ENV: "/active/venv",
  },
  platform: "linux",
  repositoryRoot: "/work/LangerFace",
});
assert.deepEqual(configuredCandidates.slice(0, 3), [
  "/custom/python",
  "/active/venv/bin/python",
  "/work/LangerFace/.venv/bin/python",
]);

const windowsCandidates = pythonCandidates({
  environment: { VIRTUAL_ENV: "C:\\active\\venv" },
  platform: "win32",
  repositoryRoot: "C:\\work\\LangerFace",
});
assert.deepEqual(windowsCandidates.slice(0, 2), [
  "C:\\active\\venv\\Scripts\\python.exe",
  "C:\\work\\LangerFace\\.venv\\Scripts\\python.exe",
]);

assert.throws(
  () => inspectLocalWrinkleRuntime({
    environment: { LANGERFACE_WRINKLE_PYTHON: "/missing/python" },
  }),
  (error) => error instanceof Error
    && error.message.includes("本地 V10 环境未就绪")
    && error.message.includes("requirements-wrinkle-lock.txt"),
);

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

const failed = new PersistentDetector({ spawnDetector: failingChild, requestTimeoutMs: 500 });
await assert.rejects(
  failed.start(),
  (error) => error instanceof Error
    && error.message.includes("ModuleNotFoundError: No module named 'torch'")
    && error.message.includes("npm run doctor:wrinkle"),
);

class FakeHttpResponse extends EventEmitter {
  statusCode = 0;
  writableEnded = false;
  headersSent = false;
  body = Buffer.alloc(0);
  headers = new Map<string, string>();

  setHeader(name: string, value: string) {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  end(value: string | Buffer = "") {
    this.body = Buffer.isBuffer(value) ? value : Buffer.from(value);
    this.writableEnded = true;
    this.headersSent = true;
    return this;
  }
}

const remoteEnvironment = [
  "WRINKLE_V10_SERVICE_URL",
  "WRINKLE_V10_TICKET_SECRET",
  "WRINKLE_V10_ALLOWED_ORIGINS",
] as const;
const savedRemoteEnvironment = new Map(
  remoteEnvironment.map((name) => [name, process.env[name]]),
);
for (const name of remoteEnvironment) delete process.env[name];

let localRuns = 0;
const localDetector = {
  async start() {},
  async run(
    _requestFile: string,
    _rgbaFile: string,
    outputDirectory: string,
  ) {
    localRuns += 1;
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(`${outputDirectory}/response.json`, JSON.stringify({
      schemaVersion: "langerface.wrinkle-fine-lines.v1",
      detectorVersion: WRINKLE_V10_DETECTOR_VERSION,
      checkpointSha256: WRINKLE_V10_CHECKPOINT_SHA256,
      lines: [],
    }));
  },
  close() {},
};

try {
  let middleware: ((request: any, response: any, next: () => void) => Promise<void>) | null = null;
  const plugin = localWrinkleV10Plugin({ detector: localDetector });
  assert.equal(typeof plugin.configureServer, "function");
  (plugin.configureServer as Function)({
    httpServer: new EventEmitter(),
    middlewares: {
      use(handler: typeof middleware) {
        middleware = handler;
      },
    },
  });
  assert.ok(middleware, "the local Vite provider middleware must be installed");

  const healthRequest = Object.assign(new EventEmitter(), {
    method: "GET",
    url: "/api/wrinkle-v10",
  });
  const healthResponse = new FakeHttpResponse();
  await middleware!(healthRequest, healthResponse, () => assert.fail("unexpected next()"));
  assert.equal(healthResponse.statusCode, 200,
    "local health must work without any remote V10 configuration");
  const health = JSON.parse(healthResponse.body.toString("utf8"));
  assert.equal(health.schemaVersion, WRINKLE_V10_PROVIDER_SCHEMA);
  assert.equal(health.providerId, "local-python-v10");
  assert.equal(health.processingLocation, "host_machine");
  assert.equal(health.directDetectUrl, "/api/wrinkle-v10");
  assert.equal(health.accessToken, null);

  const metadata = Buffer.from(JSON.stringify({
    width: 1,
    height: 1,
    landmarks: [],
    baselineLines: [],
  }));
  const requestBody = Buffer.alloc(4 + metadata.length + 4);
  requestBody.writeUInt32LE(metadata.length, 0);
  metadata.copy(requestBody, 4);
  Buffer.from([0, 0, 0, 255]).copy(requestBody, 4 + metadata.length);
  const detectRequest = Object.assign(Readable.from([requestBody]), {
    method: "POST",
    url: "/api/wrinkle-v10",
  });
  const detectResponse = new FakeHttpResponse();
  await middleware!(detectRequest, detectResponse, () => assert.fail("unexpected next()"));
  assert.equal(detectResponse.statusCode, 200,
    "local image detection must not depend on remote V10 configuration");
  assert.equal(localRuns, 1);
  assert.equal(JSON.parse(detectResponse.body.toString("utf8")).detectorVersion,
    WRINKLE_V10_DETECTOR_VERSION);
} finally {
  for (const name of remoteEnvironment) {
    const value = savedRemoteEnvironment.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

console.log("local V10 bridge, no-remote-config, cancellation, timeout and concurrency tests passed");
