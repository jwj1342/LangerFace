import * as Comlink from "comlink";

import type { WorkflowWorkerApi } from "../workers/workflowWorkerContract";

export type WorkflowWorkerDiagnostics = Awaited<ReturnType<WorkflowWorkerApi["diagnostics"]>>;
export type WorkflowWorkerTumorQuality = Awaited<ReturnType<WorkflowWorkerApi["summarizeTumorInput"]>>;

export interface WorkflowWorkerClient {
  api: Comlink.Remote<WorkflowWorkerApi>;
  dispose: () => void;
}

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

  return {
    api,
    dispose() {
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
