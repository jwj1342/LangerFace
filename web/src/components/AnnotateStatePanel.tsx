import { MousePointer2 } from "lucide-react";

import { useAnnotateStore } from "../stores/annotateStore";

function formatMesh(snapshot: ReturnType<typeof useAnnotateStore.getState>["snapshot"]) {
  if (!snapshot?.mesh.loaded) return "未加载";
  return snapshot.mesh.modeLabel || snapshot.mesh.topologyId || "已加载";
}

export function AnnotateStatePanel() {
  const snapshot = useAnnotateStore((state) => state.snapshot);
  const draft = snapshot?.draft;
  const saved = snapshot?.saved;

  return (
    <div className="card annotate-state-panel">
      <div className="quality-top">
        <span className="inline-flex items-center gap-2"><MousePointer2 size={14} /> 标注状态</span>
        <span>{formatMesh(snapshot)}</span>
      </div>
      <div className="annotate-state-grid">
        <div>
          <span className="k">线系统</span>
          <span className="v">{snapshot?.system?.toUpperCase?.() || "—"}</span>
        </div>
        <div>
          <span className="k">当前线</span>
          <span className="v">{draft?.active ? `${draft.name || "未命名"} · ${draft.controlCount} 点` : "未绘制"}</span>
        </div>
        <div>
          <span className="k">已保存</span>
          <span className="v">{saved ? `${saved.count} 条 · ${saved.totalControlPoints} 控制点` : "0 条"}</span>
        </div>
        <div>
          <span className="k">导出</span>
          <span className="v">{snapshot?.export.canExportAtlas ? "图谱 / xyz" : snapshot?.export.canExportXyz ? "xyz" : "待标注"}</span>
        </div>
      </div>
      <p className={`hint${(draft?.fallback || (saved?.warningCount || 0) > 0) ? " annotate-state-warning" : ""}`}>
        {snapshot?.hint || "正在等待 3D 标注 controller 发布状态。"}
      </p>
    </div>
  );
}
