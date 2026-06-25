import * as Comlink from "comlink";

import {
  summarizeTumorInputQuality,
  type TumorInput,
} from "../../incision_tools.js";

export interface WorkerDiagnostics {
  schema_version: "langerface-workflow-worker/v0.1";
  worker: "browser-comlink-workflow";
  thread: "web_worker";
  handles_high_frequency_render_state: false;
  supported_tools: string[];
}

export interface WorkflowWorkerApi {
  diagnostics: () => WorkerDiagnostics;
  summarizeTumorInput: (tumor: TumorInput) => ReturnType<typeof summarizeTumorInputQuality>;
}

const api: WorkflowWorkerApi = {
  diagnostics() {
    return {
      schema_version: "langerface-workflow-worker/v0.1",
      worker: "browser-comlink-workflow",
      thread: "web_worker",
      handles_high_frequency_render_state: false,
      supported_tools: ["summarize_tumor_input_quality"],
    };
  },

  summarizeTumorInput(tumor) {
    return summarizeTumorInputQuality(tumor);
  },
};

Comlink.expose(api);
