import * as Comlink from "comlink";

import type { WorkflowWorkerApi } from "../workers/workflow.worker";

export interface WorkflowWorkerClient {
  api: Comlink.Remote<WorkflowWorkerApi>;
  dispose: () => void;
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
