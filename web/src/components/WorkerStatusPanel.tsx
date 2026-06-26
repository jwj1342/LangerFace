import { Cpu } from "lucide-react";
import { useEffect, useState } from "react";

import { Card, CardContent, CardHeader } from "./ui/card";
import { createWorkflowWorkerClient } from "../services/workflowWorkerClient";
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
      if (disposed) return;
      setWorkerStatus("已连接");
      setDetail(
        `${diagnostics.thread} · ${diagnostics.supported_tools.join(", ")} · 肿物输入检查 ${
          tumorQuality.passed ? "通过" : "需复核"
        }`,
      );
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
