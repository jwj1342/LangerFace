import * as Comlink from "comlink";

import {
  planIncisionWorkflow,
  summarizeTumorInputQuality,
} from "../services/incisionTools.ts";
import type { AnyRecord } from "../services/incisionToolCore.ts";
import type { WorkflowWorkerApi } from "./workflowWorkerContract";

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
      atlas: request.atlas as AnyRecord,
      normal: request.normal,
      angleOffsetsDeg: request.angleOffsetsDeg,
    });
  },
};

Comlink.expose(api);
