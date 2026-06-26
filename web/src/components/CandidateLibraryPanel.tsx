import { useEffect, useState } from "react";

import { Button } from "./ui/button";
import { dispatchIncisionLibraryCommand } from "../lib/controllerCommand";
import { useIncisionStore } from "../stores/incisionStore";

export function CandidateLibraryPanel() {
  const snapshot = useIncisionStore((state) => state.snapshot);
  const saved = snapshot?.savedCandidates || [];
  const hasCandidate = Boolean(snapshot?.candidate);
  const hasSaved = saved.length > 0;
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!hasSaved) setConfirmClear(false);
  }, [hasSaved]);

  const clearSaved = () => {
    if (!hasSaved) return;
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    dispatchIncisionLibraryCommand("clear_saved");
    setConfirmClear(false);
  };

  return (
    <div className="card agent-grid">
      <div className="quality-top"><span>候选库</span><span id="savedCount">{saved.length}</span></div>
      <Button
        variant="workbenchPrimary"
        id="saveCandidateBtn"
        type="button"
        disabled={!hasCandidate}
        onClick={() => dispatchIncisionLibraryCommand("save_current")}
      >
        保存当前候选
      </Button>
      <div className="btn-row two-cols">
        <Button variant="workbench" id="makeVariantsBtn" type="button" disabled={!hasCandidate} onClick={() => dispatchIncisionLibraryCommand("make_variants")}>生成备选</Button>
        <Button variant={confirmClear ? "miniDanger" : "workbench"} id="clearSavedBtn" type="button" disabled={!hasSaved} onClick={clearSaved}>
          {confirmClear ? "确认清空" : "清空候选库"}
        </Button>
      </div>
      {confirmClear ? (
        <div className="btn-row two-cols">
          <Button variant="workbench" type="button" onClick={() => setConfirmClear(false)}>取消</Button>
          <p className="hint">将删除当前工作台保存的全部候选草案。</p>
        </div>
      ) : null}
      <div className="btn-row three-cols">
        <Button variant="workbench" id="exportJsonBtn" type="button" disabled={!hasCandidate && !hasSaved} onClick={() => dispatchIncisionLibraryCommand("export_json")}>导出 JSON</Button>
        <Button variant="workbench" id="exportReportBtn" type="button" disabled={!hasCandidate && !hasSaved} onClick={() => dispatchIncisionLibraryCommand("export_report")}>导出报告</Button>
        <Button variant="workbench" id="exportPngBtn" type="button" disabled={!hasCandidate} onClick={() => dispatchIncisionLibraryCommand("export_png")}>导出截图</Button>
      </div>
      <Button variant="workbench" id="stageLiveOverlayBtn" type="button" disabled={!hasCandidate} onClick={() => dispatchIncisionLibraryCommand("stage_live_overlay")}>发送到实时叠加</Button>
      <div className="candidate-list" id="candidateList">
        {saved.map((item) => (
          <div className="candidate-row" key={item.id}>
            <div className="top">
              <span>{item.title}</span>
              <span className={item.statusDanger ? "danger-text" : ""}>{item.statusLabel}</span>
            </div>
            <div className="meta">{item.meta}</div>
            <div className="btn-row two-cols">
              <Button variant="workbench" type="button" onClick={() => dispatchIncisionLibraryCommand("load_candidate", item.id)}>载入</Button>
              <Button variant="workbench" type="button" onClick={() => dispatchIncisionLibraryCommand("remove_candidate", item.id)}>删除</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
