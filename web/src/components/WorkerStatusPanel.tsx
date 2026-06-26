import { Cpu } from "lucide-react";
import { useEffect, useState } from "react";

import { Card, CardContent, CardHeader } from "./ui/card";
import { createWorkflowWorkerClient, probeWorkflowWorkerClient } from "../services/workflowWorkerClient";
import { useAppStore } from "../stores/appStore";

export function WorkerStatusPanel() {
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

    probeWorker().catch((err) => {
      if (disposed) return;
      setWorkerStatus("连接失败");
      setDetail(`Worker 连接失败：${err instanceof Error ? err.message : String(err)}`);
    });

    return () => {
      disposed = true;
      client.dispose();
      setWorkerStatus("已卸载");
    };
  }, [setWorkerStatus]);

  return (
    <Card>
      <CardHeader>
        <span className="inline-flex items-center gap-2"><Cpu size={14} /> Workflow Worker</span>
        <span>{workerStatus}</span>
      </CardHeader>
      <CardContent>
        <p className="hint">{detail}</p>
        <p className="hint">
          Comlink 只封装低频工具调用；逐帧 landmarks、mesh vertices、WebGL context 不进入 Worker API 或 Zustand store。
        </p>
      </CardContent>
    </Card>
  );
}
