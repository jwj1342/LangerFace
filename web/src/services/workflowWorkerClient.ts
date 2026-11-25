import * as Comlink from "comlink";

import type { WorkflowWorkerApi } from "../workers/workflowWorkerContract";

export type WorkflowWorkerDiagnostics = Awaited<ReturnType<WorkflowWorkerApi["diagnostics"]>>;
export type WorkflowWorkerTumorQuality = Awaited<ReturnType<WorkflowWorkerApi["summarizeTumorInput"]>>;

export interface WorkflowWorkerClient {
  api: Comlink.Remote<WorkflowWorkerApi>;
  ready: Promise<void>;
  dispose: () => void;
}

/**
 * Browser workers have no cancellation API for an individual Comlink call.
 * Keep the UI recoverable when a worker module or a WASM-backed operation
 * never settles; callers terminate the worker after this rejects.
 */
export function withWorkflowTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

// Keep this below the browser acceptance wait so a stuck recognition or plan
// reports a recoverable failure before the page appears frozen indefinitely.
export const WORKFLOW_WORKER_TIMEOUT_MS = 45_000;

export interface WorkflowWorkerProbeResult {
  diagnostics: WorkflowWorkerDiagnostics;
  tumorQuality: WorkflowWorkerTumorQuality;
  detail: string;
}

export function createWorkflowWorkerClient(): WorkflowWorkerClient {
  const worker = new Worker(new URL("../workers/workflow.worker.ts", import.meta.url), {
    type: "module",
    name: "langerface-workflow-worker",
  });
  const api = Comlink.wrap<WorkflowWorkerApi>(worker);
  let resolveReady: (() => void) | undefined;
  let rejectReady: ((reason?: unknown) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const failReady = (message: string) => rejectReady?.(new Error(message));
  const onWorkerError = () => failReady("切口识别线程启动失败；请刷新页面后重试。");
  const onWorkerMessageError = () => failReady("切口识别线程通信失败；请刷新页面后重试。");
  worker.addEventListener("error", onWorkerError);
  worker.addEventListener("messageerror", onWorkerMessageError);
  void ready.catch(() => undefined);
  void api.diagnostics().then(() => resolveReady?.()).catch((error) => {
    rejectReady?.(error);
  });

  return {
    api,
    ready,
    dispose() {
      worker.removeEventListener("error", onWorkerError);
      worker.removeEventListener("messageerror", onWorkerMessageError);
      const releasable = api as Comlink.Remote<WorkflowWorkerApi> & {
        [Comlink.releaseProxy]?: () => void;
      };
      releasable[Comlink.releaseProxy]?.();
      worker.terminate();
    },
  };
}

export async function probeWorkflowWorkerClient(client: WorkflowWorkerClient): Promise<WorkflowWorkerProbeResult> {
  const diagnostics = await client.api.diagnostics();
  const tumorQuality = await client.api.summarizeTumorInput({
    kind: "subcutaneous",
    center: [0, 0, 0],
    diameter_mm: 12,
    depth_mm: 6,
    margin_mm: 0,
    boundary: [],
    boundary_mode: "center_diameter",
    boundary_source: "worker_probe",
    source: "react_worker_probe",
    author: "system",
    units: "mm",
  });

  return {
    diagnostics,
    tumorQuality,
    detail: `${diagnostics.thread} · ${diagnostics.supported_tools.join(", ")} · 肿物输入检查 ${
      tumorQuality.passed ? "通过" : "需复核"
    }`,
  };
}
