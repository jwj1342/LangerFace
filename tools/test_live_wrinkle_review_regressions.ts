import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const requireWeb = createRequire(new URL("../web/package.json", import.meta.url));
const ts = requireWeb("typescript") as typeof import("../web/node_modules/typescript/lib/typescript.js");
const source = fs.readFileSync(
  new URL("../web/src/services/liveWrinkleAnalysis.ts", import.meta.url), "utf8",
);

function actualFunction(start: string, end: string, dependencies: Record<string, unknown>, name: string) {
  const body = source.slice(source.indexOf(start), source.indexOf(end));
  assert.ok(body.startsWith(start) && body.length > start.length, `${name} source is present`);
  const js = ts.transpileModule(body.replaceAll("import.meta.env", "env")
    .replace("export function updateWrinkleUi", "function updateWrinkleUi"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${js}\nreturn ${name};`)(...Object.values(dependencies));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function delayedPhotoScenario(destination: "photo" | "camera" | "restored-photo") {
  const pending = new Map<string, ReturnType<typeof deferred<any>>>();
  const seeded: string[] = [];
  const state = { generation: 1 };
  let workerId = 0;
  const detect = actualFunction("async function detectServerImageWrinkles(",
    "\nfunction terminateWrinkleWorker", {
      state,
      setWrinkleSummary() {},
      fetch(_url: string, options: { body: { name: string } }) {
        const request = deferred<any>();
        pending.set(options.body.name, request);
        return request.promise;
      },
      AbortSignal,
      YOLO_WRINKLE_MODEL_SHA256: "model-hash",
      YOLO_WRINKLE_ONNX_VERSION: "test",
      wrinkleWorkingTransform: () => ({ scale: 1 }),
      toWrinkleWorkingPoint: (point: unknown) => point,
      numericFingerprint: async () => "fingerprint",
      wrinkleWorkerInstance: () => ({ seedYoloEvidence: async (request: { lines: Array<{ id: string }> }) => {
        seeded.push(request.lines[0].id);
        return { detectionId: `yolo-${++workerId}` };
      } }),
    }, "detectServerImageWrinkles") as (
      file: { name: string; type: string }, working: { size: number }, landmarks: number[][],
      generation: number,
    ) => Promise<{ detectionId: string } | null>;
  const file = (name: string) => ({ name, type: "image/jpeg" });
  const payload = (id: string) => ({ ok: true, json: async () => ({
    width: 100, height: 100, modelSha256: "model-hash",
    validation: { passed: true, renderedConnectedComponents: 1 },
    lines: [{ id, sourceComponentId: id, class: "forehead", lengthPx: 20, points: [[1, 2]] }],
    diagnostics: {}, timings: {},
  }) });
  const a = detect(file("A"), { size: 100 }, [[1, 2, 0]], 1);
  state.generation = 2; // resetLiveWrinkleAnalysis on source replacement
  if (destination === "photo") {
    const b = detect(file("B"), { size: 100 }, [[1, 2, 0]], 2);
    pending.get("B")!.resolve(payload("B"));
    assert.equal((await b)?.detectionId, "yolo-1");
  } else if (destination === "restored-photo") {
    state.generation = 3; // camera close and photo restoration
    const restored = detect(file("restored"), { size: 100 }, [[1, 2, 0]], 3);
    pending.get("restored")!.resolve(payload("restored"));
    assert.equal((await restored)?.detectionId, "yolo-1");
  }
  pending.get("A")!.resolve(payload("A"));
  assert.equal(await a, null, `stale A is discarded after switching to ${destination}`);
  assert.deepEqual(seeded, destination === "camera" ? [] :
    [destination === "photo" ? "B" : "restored"], "only current media seeds the worker");
}

for (const destination of ["photo", "camera", "restored-photo"] as const) {
  await delayedPhotoScenario(destination);
}

const attrs = new Map<string, string>();
const summary = {
  textContent: "",
  hidden: true,
  classList: { toggle(_name: string, value: boolean) { summary.hidden = value; } },
  setAttribute(name: string, value: string) { attrs.set(name, value); },
};
const state: Record<string, any> = {
  status: "idle", displayMode: "both", detectionId: null, refinementContext: null,
  standardLines: null, evidenceLines: [], error: null, provider: null,
  fineLineCount: 0, sourceComponentCount: 0,
};
const els = {
  wrinkleSummary: summary,
  wrinkleStatus: { textContent: "" },
  wrinkleDisplayMode: { value: "", disabled: false },
  wrinkleDetect: { textContent: "", disabled: false },
  wrinkleAutoRefine: { disabled: false },
  wrinkleRestore: { disabled: false },
};
const update = actualFunction("function setWrinkleSummary(",
  "\nexport function setWrinkleDisplayMode", {
    els, state, sourceState: { sourceKind: "image", paused: false },
    isWrinkleFrameReady: () => true,
    isStaticWrinkleSource: () => true,
    isDynamicWrinkleSourceKind: () => false,
    wrinkleV10ProcessingLocationLabel: () => "当前设备",
    statusLabel: () => "status",
    hasManualRefineChanges: () => false,
    window: { location: { hostname: "localhost", search: "" } },
    RSTL_STANDARD_CONTRACT: { atlasVersion: "test" },
    env: { VITE_SERVER_COMPUTE: "true" },
  }, "updateWrinkleUi") as () => void;
const expectSummary = (visible: boolean, content: string) => {
  update();
  assert.equal(summary.hidden, !visible);
  assert.equal(attrs.get("aria-hidden"), visible ? "false" : "true");
  assert.match(summary.textContent, new RegExp(content));
  if (state.status === "error" || state.status === "evidence") {
    assert.match(summary.textContent, /重试|重新检测/);
  }
};
state.status = "error";
state.error = "服务器照片皱纹检测失败（HTTP 503）";
expectSummary(true, "HTTP 503");
state.error = "服务器返回了无效的皱纹中心线数据";
expectSummary(true, "无效的皱纹中心线");
state.status = "evidence";
state.error = "自动微调未通过安全门禁";
expectSummary(true, "安全门禁");
state.status = "loading";
state.error = null;
expectSummary(true, "正在服务器运行");
state.status = "detected";
expectSummary(false, "YOLO 已检测");
state.status = "applied";
expectSummary(false, "共调整");

console.log("Live wrinkle review regressions passed");
