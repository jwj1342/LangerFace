import { dispatchControllerCommand } from "../lib/controllerCommand";
import { useIncisionStore } from "../stores/incisionStore";

const LIBRARY_REACT_COMMAND_EVENT = "langerface:incision-library-react-command";

function dispatchLibraryCommand(command: string, id?: string) {
  dispatchControllerCommand(LIBRARY_REACT_COMMAND_EVENT, { command, id });
}

export function CandidateLibraryPanel() {
  const snapshot = useIncisionStore((state) => state.snapshot);
  const saved = snapshot?.savedCandidates || [];
  const hasCandidate = Boolean(snapshot?.candidate);
  const hasSaved = saved.length > 0;

  return (
    <div className="card agent-grid">
      <div className="quality-top"><span>候选库</span><span id="savedCount">{saved.length}</span></div>
      <button
        className="btn btn-primary"
        id="saveCandidateBtn"
        type="button"
        disabled={!hasCandidate}
        onClick={() => dispatchLibraryCommand("save_current")}
      >
        保存当前候选
      </button>
      <div className="btn-row two-cols">
        <button className="btn" id="makeVariantsBtn" type="button" disabled={!hasCandidate} onClick={() => dispatchLibraryCommand("make_variants")}>生成备选</button>
        <button className="btn" id="clearSavedBtn" type="button" disabled={!hasSaved} onClick={() => dispatchLibraryCommand("clear_saved")}>清空候选库</button>
      </div>
      <div className="btn-row three-cols">
        <button className="btn" id="exportJsonBtn" type="button" disabled={!hasCandidate && !hasSaved} onClick={() => dispatchLibraryCommand("export_json")}>导出 JSON</button>
        <button className="btn" id="exportReportBtn" type="button" disabled={!hasCandidate && !hasSaved} onClick={() => dispatchLibraryCommand("export_report")}>导出报告</button>
        <button className="btn" id="exportPngBtn" type="button" disabled={!hasCandidate} onClick={() => dispatchLibraryCommand("export_png")}>导出截图</button>
      </div>
      <button className="btn" id="stageLiveOverlayBtn" type="button" disabled={!hasCandidate} onClick={() => dispatchLibraryCommand("stage_live_overlay")}>发送到实时叠加</button>
      <div className="candidate-list" id="candidateList">
        {saved.map((item) => (
          <div className="candidate-row" key={item.id}>
            <div className="top">
              <span>{item.title}</span>
              <span className={item.statusDanger ? "danger-text" : ""}>{item.statusLabel}</span>
            </div>
            <div className="meta">{item.meta}</div>
            <div className="btn-row two-cols">
              <button className="btn" type="button" onClick={() => dispatchLibraryCommand("load_candidate", item.id)}>载入</button>
              <button className="btn" type="button" onClick={() => dispatchLibraryCommand("remove_candidate", item.id)}>删除</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
