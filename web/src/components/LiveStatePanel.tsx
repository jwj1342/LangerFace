import { RadioTower } from "lucide-react";

import { useLiveStore } from "../stores/liveStore";
import { Card, CardHeader, CardHeaderTitle } from "./ui/card";
import { Hint } from "./ui/hint";
import { KeyValueGrid, KeyValueItem } from "./ui/key-value";

function routeLabel(snapshot: ReturnType<typeof useLiveStore.getState>["snapshot"]) {
  if (!snapshot) return "待机";
  if (snapshot.route.route === "3d") return `3D · ${snapshot.route.mode3d}`;
  return "2D 实时";
}

export function LiveStatePanel() {
  const snapshot = useLiveStore((state) => state.snapshot);

  return (
    <Card className="live-state-panel">
      <CardHeader>
        <CardHeaderTitle><RadioTower size={14} /> 实时状态</CardHeaderTitle>
        <span>{routeLabel(snapshot)}</span>
      </CardHeader>
      <KeyValueGrid className="live-state-grid">
        <KeyValueItem label="来源" value={snapshot?.source.kind || (snapshot?.source.running ? "运行中" : "未开始")} />
        <KeyValueItem label="图谱" value={snapshot ? `${snapshot.render.system.toUpperCase()} · ${snapshot.render.densityPct}%` : "—"} />
        <KeyValueItem label="3D" value={snapshot?.recon.has3dModel ? (snapshot.recon.projectable ? "可投影" : "可查看") : "未生成"} />
        <KeyValueItem label="叠加" value={snapshot?.incisionOverlay.loaded ? snapshot.incisionOverlay.qaLabel || "已载入" : "无切口叠加"} />
      </KeyValueGrid>
      <Hint>{snapshot?.overlayMessage || snapshot?.modelBadge || "等待实时 controller 发布状态。"}</Hint>
    </Card>
  );
}
