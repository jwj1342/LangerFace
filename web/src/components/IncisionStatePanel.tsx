import { Activity } from "lucide-react";

import { useIncisionStore } from "../stores/incisionStore";
import { Card, CardHeader } from "./ui/card";

function formatRuntime(snapshot: ReturnType<typeof useIncisionStore.getState>["snapshot"]) {
  if (!snapshot?.workflowRuntime) return "未运行";
  if (snapshot.workflowRuntime.worker) return "Worker";
  return snapshot.workflowRuntime.executor || "fallback";
}

export function IncisionStatePanel() {
  const snapshot = useIncisionStore((state) => state.snapshot);
  const candidate = snapshot?.candidate;

  return (
    <Card className="incision-state-panel">
      <CardHeader>
        <span className="inline-flex items-center gap-2"><Activity size={14} /> 工作台状态</span>
        <span>{formatRuntime(snapshot)}</span>
      </CardHeader>
      <div className="incision-state-grid">
        <div>
          <span className="k">肿物</span>
          <span className="v">{snapshot ? `${snapshot.tumor.kind} · ${snapshot.tumor.diameterMm ?? "—"} mm` : "—"}</span>
        </div>
        <div>
          <span className="k">候选</span>
          <span className="v">{candidate ? `${candidate.type ?? "—"} · ${candidate.lengthMm?.toFixed(1) ?? "—"} mm` : "—"}</span>
        </div>
        <div>
          <span className="k">Provider</span>
          <span className="v">{snapshot?.provider.stateLabel || "待运行"}</span>
        </div>
        <div>
          <span className="k">审阅</span>
          <span className="v">{snapshot?.review.status || "待医生确认"}</span>
        </div>
      </div>
      <p className="hint">{snapshot?.stageStatus || "正在等待 controller 发布状态。"}</p>
    </Card>
  );
}
