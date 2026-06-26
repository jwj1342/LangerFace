import { useEffect, useState } from "react";

import { Button } from "./ui/button";
import { ButtonRow } from "./ui/button-row";
import { Card, CardHeader } from "./ui/card";
import { Hint } from "./ui/hint";
import { CandidateList, CandidateRow, CandidateRowMeta, CandidateRowStatus, CandidateRowTop } from "./ui/library-list";
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
    <Card className="agent-grid">
      <CardHeader><span>候选库</span><span id="savedCount">{saved.length}</span></CardHeader>
      <Button
        variant="workbenchPrimary"
        id="saveCandidateBtn"
        type="button"
        disabled={!hasCandidate}
        onClick={() => dispatchIncisionLibraryCommand("save_current")}
      >
        保存当前候选
      </Button>
      <ButtonRow className="two-cols">
        <Button variant="workbench" id="makeVariantsBtn" type="button" disabled={!hasCandidate} onClick={() => dispatchIncisionLibraryCommand("make_variants")}>生成备选</Button>
        <Button variant={confirmClear ? "miniDanger" : "workbench"} id="clearSavedBtn" type="button" disabled={!hasSaved} onClick={clearSaved}>
          {confirmClear ? "确认清空" : "清空候选库"}
        </Button>
      </ButtonRow>
      {confirmClear ? (
        <ButtonRow className="two-cols">
          <Button variant="workbench" type="button" onClick={() => setConfirmClear(false)}>取消</Button>
          <Hint>将删除当前工作台保存的全部候选草案。</Hint>
        </ButtonRow>
      ) : null}
      <ButtonRow className="three-cols">
        <Button variant="workbench" id="exportJsonBtn" type="button" disabled={!hasCandidate && !hasSaved} onClick={() => dispatchIncisionLibraryCommand("export_json")}>导出 JSON</Button>
        <Button variant="workbench" id="exportReportBtn" type="button" disabled={!hasCandidate && !hasSaved} onClick={() => dispatchIncisionLibraryCommand("export_report")}>导出报告</Button>
        <Button variant="workbench" id="exportPngBtn" type="button" disabled={!hasCandidate} onClick={() => dispatchIncisionLibraryCommand("export_png")}>导出截图</Button>
      </ButtonRow>
      <Button variant="workbench" id="stageLiveOverlayBtn" type="button" disabled={!hasCandidate} onClick={() => dispatchIncisionLibraryCommand("stage_live_overlay")}>发送到实时叠加</Button>
      <CandidateList id="candidateList">
        {saved.map((item) => (
          <CandidateRow key={item.id}>
            <CandidateRowTop>
              <span>{item.title}</span>
              <CandidateRowStatus danger={item.statusDanger}>{item.statusLabel}</CandidateRowStatus>
            </CandidateRowTop>
            <CandidateRowMeta>{item.meta}</CandidateRowMeta>
            <ButtonRow className="two-cols">
              <Button variant="workbench" type="button" onClick={() => dispatchIncisionLibraryCommand("load_candidate", item.id)}>载入</Button>
              <Button variant="workbench" type="button" onClick={() => dispatchIncisionLibraryCommand("remove_candidate", item.id)}>删除</Button>
            </ButtonRow>
          </CandidateRow>
        ))}
      </CandidateList>
    </Card>
  );
}
