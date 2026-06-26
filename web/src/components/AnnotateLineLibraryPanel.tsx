import { useState } from "react";

import { Button } from "./ui/button";
import { Card, CardHeader } from "./ui/card";
import { dispatchAnnotateLibraryCommand } from "../lib/controllerCommand";
import { useAnnotateStore } from "../stores/annotateStore";

export function AnnotateLineLibraryPanel() {
  const snapshot = useAnnotateStore((state) => state.snapshot);
  const saved = snapshot?.saved;
  const lines = saved?.lines || [];
  const exportState = snapshot?.export;
  const hasLines = lines.length > 0;
  const [confirmClear, setConfirmClear] = useState(false);

  const clearLines = () => {
    if (!hasLines) return;
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    dispatchAnnotateLibraryCommand("clear_lines");
    setConfirmClear(false);
  };

  return (
    <Card>
      <CardHeader><span>3. 已保存线</span><span id="annStatus">{saved ? `${saved.count} 条` : "0 条"}</span></CardHeader>
      <div className="line-list" id="lineList">
        {lines.length ? lines.map((line) => (
          <div className={`line-row${line.fallback ? " has-warning" : ""}`} key={`${line.index}-${line.title}`}>
            <div className="line-main">
              <strong>{line.title}</strong>
              <span className="line-meta">{line.meta}</span>
              {line.warning ? <span className="line-warning">{line.warning}</span> : null}
            </div>
            <div className="line-actions">
              <Button variant="mini" type="button" onClick={() => dispatchAnnotateLibraryCommand("restore_line", line.index)}>编辑</Button>
              <Button variant="miniDanger" type="button" onClick={() => dispatchAnnotateLibraryCommand("delete_line", line.index)}>删除</Button>
            </div>
          </div>
        )) : (
          <div className="line-empty">还没有保存的线。</div>
        )}
      </div>
      <div className="btn-row annotate-export-row">
        <Button variant="workbench" id="btnExportAtlas" type="button" disabled={!exportState?.canExportAtlas} onClick={() => dispatchAnnotateLibraryCommand("export_atlas")}>导出图谱</Button>
        <Button variant="workbench" id="btnExportXyz" type="button" disabled={!exportState?.canExportXyz} onClick={() => dispatchAnnotateLibraryCommand("export_xyz")}>导出 xyz</Button>
      </div>
      <Button variant="workbenchPrimary" id="btnSetActiveAtlas" type="button" disabled={!exportState?.canPreviewActiveAtlas} onClick={() => dispatchAnnotateLibraryCommand("set_active_atlas")}>设为活动图谱并预览</Button>
      <Button variant={confirmClear ? "miniDanger" : "workbench"} id="btnClear" type="button" disabled={!hasLines} onClick={clearLines}>
        {confirmClear ? "确认清空" : "清空"}
      </Button>
      {confirmClear ? (
        <div className="btn-row annotate-clear-confirm">
          <Button variant="workbench" type="button" onClick={() => setConfirmClear(false)}>取消</Button>
          <p className="hint">将删除当前工作台保存的全部标注线。</p>
        </div>
      ) : null}
    </Card>
  );
}
