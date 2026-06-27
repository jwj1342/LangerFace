import { useEffect, useState } from "react";

import { createWorkflowWorkerClient, probeWorkflowWorkerClient } from "../services/workflowWorkerClient";
import { type WorkerStatus, useAppStore } from "../stores/appStore";

interface WorkflowWorkerProbeState {
  detail: string;
  workerStatus: WorkerStatus;
}

function formatWorkerProbeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useWorkflowWorkerProbe(): WorkflowWorkerProbeState {
  const [detail, setDetail] = useState("Worker 尚未连接。");
  const workerStatus = useAppStore((state) => state.workerStatus);
  const setWorkerStatus = useAppStore((state) => state.setWorkerStatus);

  useEffect(() => {
    let disposed = false;
    const client = createWorkflowWorkerClient();
    setWorkerStatus("正在连接");

    async function probeWorker() {
      const probe = await probeWorkflowWorkerClient(client);
      if (disposed) return;
      setWorkerStatus("已连接");
      setDetail(probe.detail);
    }

    probeWorker().catch((error) => {
      if (disposed) return;
      setWorkerStatus("连接失败");
      setDetail(`Worker 连接失败：${formatWorkerProbeError(error)}`);
    });

    return () => {
      disposed = true;
      client.dispose();
      setWorkerStatus("已卸载");
    };
  }, [setWorkerStatus]);

  return { detail, workerStatus };
}
