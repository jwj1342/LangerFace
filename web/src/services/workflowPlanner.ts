import { planIncisionWorkflow } from "../../incision_tools.js";
import type {
  PlanIncisionRequest,
  WorkflowPlanResult,
} from "../workers/workflowWorkerContract";
import type { WorkflowWorkerClient } from "./workflowWorkerClient";

export type WorkflowPlanExecutor = "comlink_worker" | "main_thread_fallback";

export interface WorkflowRuntimeStatus {
  schema_version: "incision-workflow-runtime/v0.1";
  executor: WorkflowPlanExecutor;
  worker: boolean;
  thread: "web_worker" | "main_thread";
  high_frequency_render_state: false;
  error: string | null;
}

export interface WorkflowPlanExecution {
  result: WorkflowPlanResult;
  workerFailed: boolean;
  statusMessage: string | null;
  error: unknown;
}

export function workflowRuntimeStatus(executor: WorkflowPlanExecutor, error: unknown = null): WorkflowRuntimeStatus {
  return {
    schema_version: "incision-workflow-runtime/v0.1",
    executor,
    worker: executor === "comlink_worker",
    thread: executor === "comlink_worker" ? "web_worker" : "main_thread",
    high_frequency_render_state: false,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

export async function planIncisionWithWorkflowFallback({
  client,
  request,
}: {
  client: WorkflowWorkerClient | null;
  request: PlanIncisionRequest;
}): Promise<WorkflowPlanExecution> {
  if (client) {
    try {
      const result = await client.api.planIncision(request);
      result.workflow_runtime = workflowRuntimeStatus("comlink_worker");
      return {
        result,
        workerFailed: false,
        statusMessage: null,
        error: null,
      };
    } catch (error) {
      client.dispose();
      const result = planIncisionWorkflow(request);
      result.workflow_runtime = workflowRuntimeStatus("main_thread_fallback", error);
      return {
        result,
        workerFailed: true,
        statusMessage: "Worker workflow 失败，已退回主线程确定性工具。",
        error,
      };
    }
  }

  const error = new Error("workflow worker unavailable");
  const result = planIncisionWorkflow(request);
  result.workflow_runtime = workflowRuntimeStatus("main_thread_fallback", error);
  return {
    result,
    workerFailed: false,
    statusMessage: null,
    error,
  };
}
