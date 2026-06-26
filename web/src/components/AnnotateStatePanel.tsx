import { MousePointer2 } from "lucide-react";

import { useAnnotateStore } from "../stores/annotateStore";
import { Card, CardHeader } from "./ui/card";
import { Hint } from "./ui/hint";
import { KeyValueGrid, KeyValueItem } from "./ui/key-value";

function formatMesh(snapshot: ReturnType<typeof useAnnotateStore.getState>["snapshot"]) {
  if (!snapshot?.mesh.loaded) return "未加载";
  return snapshot.mesh.modeLabel || snapshot.mesh.topologyId || "已加载";
}

export function AnnotateStatePanel() {
  const snapshot = useAnnotateStore((state) => state.snapshot);
  const draft = snapshot?.draft;
  const saved = snapshot?.saved;

  return (
    <Card className="annotate-state-panel">
      <CardHeader>
        <span className="inline-flex items-center gap-2"><MousePointer2 size={14} /> 标注状态</span>
        <span>{formatMesh(snapshot)}</span>
      </CardHeader>
      <KeyValueGrid className="annotate-state-grid">
        <KeyValueItem label="线系统" value={snapshot?.system?.toUpperCase?.() || "—"} />
        <KeyValueItem label="当前线" value={draft?.active ? `${draft.name || "未命名"} · ${draft.controlCount} 点` : "未绘制"} />
        <KeyValueItem label="已保存" value={saved ? `${saved.count} 条 · ${saved.totalControlPoints} 控制点` : "0 条"} />
        <KeyValueItem label="导出" value={snapshot?.export.canExportAtlas ? "图谱 / xyz" : snapshot?.export.canExportXyz ? "xyz" : "待标注"} />
      </KeyValueGrid>
      <Hint className={(draft?.fallback || (saved?.warningCount || 0) > 0) ? "annotate-state-warning" : undefined}>
        {snapshot?.hint || "正在等待 3D 标注 controller 发布状态。"}
      </Hint>
    </Card>
  );
}
