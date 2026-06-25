import * as Comlink from "comlink";

import {
  planIncisionWorkflow,
  summarizeTumorInputQuality,
  type TumorInput,
} from "../../incision_tools.js";

export type Vec3 = [number, number, number];
export type Triangle = [number, number, number];

export interface PlanIncisionRequest {
  tumor: TumorInput;
  verts: Vec3[];
  tris: Triangle[];
  atlas: unknown;
  normal?: Vec3;
  angleOffsetsDeg?: number[];
}

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
  planIncision: (request: PlanIncisionRequest) => ReturnType<typeof planIncisionWorkflow>;
}

const api: WorkflowWorkerApi = {
  diagnostics() {
    return {
      schema_version: "langerface-workflow-worker/v0.1",
      worker: "browser-comlink-workflow",
      thread: "web_worker",
      handles_high_frequency_render_state: false,
      supported_tools: ["summarize_tumor_input_quality", "plan_incision_workflow"],
    };
  },

  summarizeTumorInput(tumor) {
    return summarizeTumorInputQuality(tumor);
  },

  planIncision(request) {
    return planIncisionWorkflow({
      tumor: request.tumor,
      verts: request.verts,
      tris: request.tris,
      atlas: request.atlas,
      normal: request.normal,
      angleOffsetsDeg: request.angleOffsetsDeg,
    });
  },
};

Comlink.expose(api);
