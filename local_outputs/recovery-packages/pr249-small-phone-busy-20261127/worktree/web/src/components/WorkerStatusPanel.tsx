import { Cpu } from "lucide-react";

import { Card, CardContent, CardHeader, CardHeaderTitle } from "./ui/card";
import { Hint } from "./ui/hint";
import { useWorkflowWorkerProbe } from "../hooks/useWorkflowWorkerProbe";

export function WorkerStatusPanel() {
  const { detail, workerStatus } = useWorkflowWorkerProbe();

  return (
    <Card>
      <CardHeader>
        <CardHeaderTitle><Cpu size={14} /> 后台任务状态</CardHeaderTitle>
        <span>{workerStatus}</span>
      </CardHeader>
      <CardContent>
        <Hint>{detail}</Hint>
        <Hint>
          后台任务只处理低频规划辅助；实时画布、摄像头帧和三维模型数据由独立渲染层管理。
        </Hint>
      </CardContent>
    </Card>
  );
}
