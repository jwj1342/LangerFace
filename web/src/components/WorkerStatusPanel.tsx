import { Cpu } from "lucide-react";

import { Card, CardContent, CardHeader, CardHeaderTitle } from "./ui/card";
import { Hint } from "./ui/hint";
import { useWorkflowWorkerProbe } from "../hooks/useWorkflowWorkerProbe";

export function WorkerStatusPanel() {
  const { detail, workerStatus } = useWorkflowWorkerProbe();

  return (
    <Card>
      <CardHeader>
        <CardHeaderTitle><Cpu size={14} /> Workflow Worker</CardHeaderTitle>
        <span>{workerStatus}</span>
      </CardHeader>
      <CardContent>
        <Hint>{detail}</Hint>
        <Hint>
          Comlink 只封装低频工具调用；逐帧 landmarks、mesh vertices、WebGL context 不进入 Worker API 或 Zustand store。
        </Hint>
      </CardContent>
    </Card>
  );
}
