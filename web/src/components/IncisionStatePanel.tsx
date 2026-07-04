import { Activity } from "lucide-react";

import { useIncisionStore } from "../stores/incisionStore";
import { Card, CardHeader, CardHeaderTitle } from "./ui/card";
import { Hint } from "./ui/hint";
import { KeyValueGrid, KeyValueItem } from "./ui/key-value";

function formatRuntime(snapshot: ReturnType<typeof useIncisionStore.getState>["snapshot"]) {
  if (!snapshot?.workflowRuntime) return "未运行";
  if (snapshot.workflowRuntime.worker) return "Worker";
  return snapshot.workflowRuntime.executor || "fallback";
}

function formatModelVersion(snapshot: ReturnType<typeof useIncisionStore.getState>["snapshot"]) {
  const topologyId = snapshot?.headAsset.topologyId || "";
  if (topologyId === "flame-2023") return "高精度三维预览";
  if (topologyId === "mediapipe-468") return "标准三维模型";
  return "待识别";
}

export function IncisionStatePanel() {
  const snapshot = useIncisionStore((state) => state.snapshot);
  const candidate = snapshot?.candidate;

  return (
    <Card className="incision-state-panel">
      <CardHeader>
        <CardHeaderTitle><Activity size={14} /> 工作台状态</CardHeaderTitle>
        <span>{formatRuntime(snapshot)}</span>
      </CardHeader>
      <KeyValueGrid className="incision-state-grid">
        <KeyValueItem label="头模" value={snapshot?.headAsset.statusLabel || "加载中"} />
        <KeyValueItem label="模型版本" value={formatModelVersion(snapshot)} />
        <KeyValueItem label="肿物" value={snapshot ? `${snapshot.tumor.kind} · ${snapshot.tumor.diameterMm ?? "—"} mm` : "—"} />
        <KeyValueItem label="候选" value={candidate ? `${candidate.type ?? "—"} · ${candidate.lengthMm?.toFixed(1) ?? "—"} mm` : "—"} />
        <KeyValueItem label="AI 服务" value={snapshot?.provider.stateLabel || "待运行"} />
        <KeyValueItem label="审阅" value={snapshot?.review.status || "待医生确认"} />
      </KeyValueGrid>
      {snapshot?.headAsset.warnings.length ? (
        <Hint>{snapshot.headAsset.warnings.join("；")}</Hint>
      ) : null}
      <Hint>{snapshot?.stageStatus || "正在等待 controller 发布状态。"}</Hint>
    </Card>
  );
}
