import { Button } from "./ui/button";
import { dispatchControllerCommand } from "../lib/controllerCommand";
import { INCISION_LIBRARY_REACT_COMMAND_EVENT } from "../lib/controllerEvents";
import { useIncisionStore } from "../stores/incisionStore";

function dispatchLibraryCommand(command: string, id?: string) {
  dispatchControllerCommand(INCISION_LIBRARY_REACT_COMMAND_EVENT, { command, id });
}

export function CandidateLibraryPanel() {
  const snapshot = useIncisionStore((state) => state.snapshot);
  const saved = snapshot?.savedCandidates || [];
  const hasCandidate = Boolean(snapshot?.candidate);
  const hasSaved = saved.length > 0;

  return (
    <div className="card agent-grid">
      <div className="quality-top"><span>候选库</span><span id="savedCount">{saved.length}</span></div>
      <Button
        variant="workbenchPrimary"
        id="saveCandidateBtn"
        type="button"
        disabled={!hasCandidate}
        onClick={() => dispatchLibraryCommand("save_current")}
      >
        保存当前候选
      </Button>
      <div className="btn-row two-cols">
        <Button variant="workbench" id="makeVariantsBtn" type="button" disabled={!hasCandidate} onClick={() => dispatchLibraryCommand("make_variants")}>生成备选</Button>
        <Button variant="workbench" id="clearSavedBtn" type="button" disabled={!hasSaved} onClick={() => dispatchLibraryCommand("clear_saved")}>清空候选库</Button>
      </div>
      <div className="btn-row three-cols">
        <Button variant="workbench" id="exportJsonBtn" type="button" disabled={!hasCandidate && !hasSaved} onClick={() => dispatchLibraryCommand("export_json")}>导出 JSON</Button>
        <Button variant="workbench" id="exportReportBtn" type="button" disabled={!hasCandidate && !hasSaved} onClick={() => dispatchLibraryCommand("export_report")}>导出报告</Button>
        <Button variant="workbench" id="exportPngBtn" type="button" disabled={!hasCandidate} onClick={() => dispatchLibraryCommand("export_png")}>导出截图</Button>
      </div>
      <Button variant="workbench" id="stageLiveOverlayBtn" type="button" disabled={!hasCandidate} onClick={() => dispatchLibraryCommand("stage_live_overlay")}>发送到实时叠加</Button>
      <div className="candidate-list" id="candidateList">
        {saved.map((item) => (
          <div className="candidate-row" key={item.id}>
            <div className="top">
              <span>{item.title}</span>
              <span className={item.statusDanger ? "danger-text" : ""}>{item.statusLabel}</span>
            </div>
            <div className="meta">{item.meta}</div>
            <div className="btn-row two-cols">
              <Button variant="workbench" type="button" onClick={() => dispatchLibraryCommand("load_candidate", item.id)}>载入</Button>
              <Button variant="workbench" type="button" onClick={() => dispatchLibraryCommand("remove_candidate", item.id)}>删除</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
