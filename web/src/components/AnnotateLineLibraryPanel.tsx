import { useState } from "react";

import { Button } from "./ui/button";
import { ButtonRow } from "./ui/button-row";
import { Card, CardHeader } from "./ui/card";
import { Hint } from "./ui/hint";
import { LineActions, LineEmpty, LineList, LineMain, LineMeta, LineRow, LineWarning } from "./ui/library-list";
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
      <LineList id="lineList">
        {lines.length ? lines.map((line) => (
          <LineRow warn={line.fallback} key={`${line.index}-${line.title}`}>
            <LineMain>
              <strong>{line.title}</strong>
              <LineMeta>{line.meta}</LineMeta>
              {line.warning ? <LineWarning>{line.warning}</LineWarning> : null}
            </LineMain>
            <LineActions>
              <Button variant="mini" type="button" onClick={() => dispatchAnnotateLibraryCommand("restore_line", line.index)}>编辑</Button>
              <Button variant="miniDanger" type="button" onClick={() => dispatchAnnotateLibraryCommand("delete_line", line.index)}>删除</Button>
            </LineActions>
          </LineRow>
        )) : (
          <LineEmpty>还没有保存的线。</LineEmpty>
        )}
      </LineList>
      <ButtonRow className="annotate-export-row">
        <Button variant="workbench" id="btnExportAtlas" type="button" disabled={!exportState?.canExportAtlas} onClick={() => dispatchAnnotateLibraryCommand("export_atlas")}>导出图谱</Button>
        <Button variant="workbench" id="btnExportXyz" type="button" disabled={!exportState?.canExportXyz} onClick={() => dispatchAnnotateLibraryCommand("export_xyz")}>导出 xyz</Button>
      </ButtonRow>
      <Button variant="workbenchPrimary" id="btnSetActiveAtlas" type="button" disabled={!exportState?.canPreviewActiveAtlas} onClick={() => dispatchAnnotateLibraryCommand("set_active_atlas")}>设为活动图谱并预览</Button>
      <Button variant={confirmClear ? "miniDanger" : "workbench"} id="btnClear" type="button" disabled={!hasLines} onClick={clearLines}>
        {confirmClear ? "确认清空" : "清空"}
      </Button>
      {confirmClear ? (
        <ButtonRow className="annotate-clear-confirm">
          <Button variant="workbench" type="button" onClick={() => setConfirmClear(false)}>取消</Button>
          <Hint>将删除当前工作台保存的全部标注线。</Hint>
        </ButtonRow>
      ) : null}
    </Card>
  );
}
