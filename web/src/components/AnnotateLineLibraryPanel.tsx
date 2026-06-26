import { Button } from "./ui/button";
import { dispatchControllerCommand } from "../lib/controllerCommand";
import { ANNOTATE_LIBRARY_REACT_COMMAND_EVENT } from "../lib/controllerEvents";
import { useAnnotateStore } from "../stores/annotateStore";

function dispatchLibraryCommand(command: string, index?: number) {
  dispatchControllerCommand(ANNOTATE_LIBRARY_REACT_COMMAND_EVENT, { command, index });
}

export function AnnotateLineLibraryPanel() {
  const snapshot = useAnnotateStore((state) => state.snapshot);
  const saved = snapshot?.saved;
  const lines = saved?.lines || [];
  const exportState = snapshot?.export;
  const hasLines = lines.length > 0;

  const clearLines = () => {
    if (!hasLines) return;
    if (window.confirm("清空所有线？")) dispatchLibraryCommand("clear_lines");
  };

  return (
    <div className="card">
      <div className="quality-top"><span>3. 已保存线</span><span id="annStatus">{saved ? `${saved.count} 条` : "0 条"}</span></div>
      <div className="line-list" id="lineList">
        {lines.length ? lines.map((line) => (
          <div className={`line-row${line.fallback ? " has-warning" : ""}`} key={`${line.index}-${line.title}`}>
            <div className="line-main">
              <strong>{line.title}</strong>
              <span className="line-meta">{line.meta}</span>
              {line.warning ? <span className="line-warning">{line.warning}</span> : null}
            </div>
            <div className="line-actions">
              <Button variant="mini" type="button" onClick={() => dispatchLibraryCommand("restore_line", line.index)}>编辑</Button>
              <Button variant="miniDanger" type="button" onClick={() => dispatchLibraryCommand("delete_line", line.index)}>删除</Button>
            </div>
          </div>
        )) : (
          <div className="line-empty">还没有保存的线。</div>
        )}
      </div>
      <div className="btn-row annotate-export-row">
        <Button variant="workbench" id="btnExportAtlas" type="button" disabled={!exportState?.canExportAtlas} onClick={() => dispatchLibraryCommand("export_atlas")}>导出图谱</Button>
        <Button variant="workbench" id="btnExportXyz" type="button" disabled={!exportState?.canExportXyz} onClick={() => dispatchLibraryCommand("export_xyz")}>导出 xyz</Button>
      </div>
      <Button variant="workbenchPrimary" id="btnSetActiveAtlas" type="button" disabled={!exportState?.canPreviewActiveAtlas} onClick={() => dispatchLibraryCommand("set_active_atlas")}>设为活动图谱并预览</Button>
      <Button variant="workbench" id="btnClear" type="button" disabled={!hasLines} onClick={clearLines}>清空</Button>
    </div>
  );
}
