import type {
  planIncisionWorkflow,
  summarizeTumorInputQuality,
  TumorInput,
} from "../../incision_tools.js";

export type WorkflowVec3 = [number, number, number];
export type WorkflowTriangle = [number, number, number];

export type WorkflowTumorQuality = ReturnType<typeof summarizeTumorInputQuality>;
export type WorkflowPlanResult = ReturnType<typeof planIncisionWorkflow>;

export interface PlanIncisionRequest {
  tumor: TumorInput;
  verts: WorkflowVec3[];
  tris: WorkflowTriangle[];
  atlas: unknown;
  normal?: WorkflowVec3;
  angleOffsetsDeg?: number[];
}

export interface WorkflowWorkerDiagnostics {
  schema_version: "langerface-workflow-worker/v0.1";
  worker: "browser-comlink-workflow";
  thread: "web_worker";
  handles_high_frequency_render_state: false;
  supported_tools: string[];
}

export interface WorkflowWorkerApi {
  diagnostics: () => WorkflowWorkerDiagnostics;
  summarizeTumorInput: (tumor: TumorInput) => WorkflowTumorQuality;
  planIncision: (request: PlanIncisionRequest) => WorkflowPlanResult;
}
