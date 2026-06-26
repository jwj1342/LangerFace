import { RadioTower } from "lucide-react";

import { useLiveStore } from "../stores/liveStore";
import { Card, CardHeader } from "./ui/card";

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
        <span className="inline-flex items-center gap-2"><RadioTower size={14} /> 实时状态</span>
        <span>{routeLabel(snapshot)}</span>
      </CardHeader>
      <div className="live-state-grid">
        <div>
          <span className="k">来源</span>
          <span className="v">{snapshot?.source.kind || (snapshot?.source.running ? "运行中" : "未开始")}</span>
        </div>
        <div>
          <span className="k">图谱</span>
          <span className="v">{snapshot ? `${snapshot.render.system.toUpperCase()} · ${snapshot.render.densityPct}%` : "—"}</span>
        </div>
        <div>
          <span className="k">3D</span>
          <span className="v">{snapshot?.recon.has3dModel ? (snapshot.recon.projectable ? "可投影" : "可查看") : "未生成"}</span>
        </div>
        <div>
          <span className="k">叠加</span>
          <span className="v">{snapshot?.incisionOverlay.loaded ? snapshot.incisionOverlay.qaLabel || "已载入" : "无切口叠加"}</span>
        </div>
      </div>
      <p className="hint">{snapshot?.overlayMessage || snapshot?.modelBadge || "等待实时 controller 发布状态。"}</p>
    </Card>
  );
}
