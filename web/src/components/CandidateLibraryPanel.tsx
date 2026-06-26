import { useEffect, useState } from "react";

import { Button } from "./ui/button";
import { ButtonRow } from "./ui/button-row";
import { AgentCard, CardHeader } from "./ui/card";
import { Hint } from "./ui/hint";
import { CandidateList, CandidateRow, CandidateRowMeta, CandidateRowStatus, CandidateRowTop } from "./ui/library-list";
import { useIncisionControllerCommands } from "../hooks/useControllerCommands";
import { useIncisionStore } from "../stores/incisionStore";

export function CandidateLibraryPanel() {
  const commands = useIncisionControllerCommands();
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
    commands.library("clear_saved");
    setConfirmClear(false);
  };

  return (
    <AgentCard>
      <CardHeader><span>候选库</span><span id="savedCount">{saved.length}</span></CardHeader>
      <Button
        variant="workbenchPrimary"
        id="saveCandidateBtn"
        type="button"
        disabled={!hasCandidate}
        onClick={() => commands.library("save_current")}
      >
        保存当前候选
      </Button>
      <ButtonRow className="two-cols">
        <Button variant="workbench" id="makeVariantsBtn" type="button" disabled={!hasCandidate} onClick={() => commands.library("make_variants")}>生成备选</Button>
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
        <Button variant="workbench" id="exportJsonBtn" type="button" disabled={!hasCandidate && !hasSaved} onClick={() => commands.library("export_json")}>导出 JSON</Button>
        <Button variant="workbench" id="exportReportBtn" type="button" disabled={!hasCandidate && !hasSaved} onClick={() => commands.library("export_report")}>导出报告</Button>
        <Button variant="workbench" id="exportPngBtn" type="button" disabled={!hasCandidate} onClick={() => commands.library("export_png")}>导出截图</Button>
      </ButtonRow>
      <Button variant="workbench" id="stageLiveOverlayBtn" type="button" disabled={!hasCandidate} onClick={() => commands.library("stage_live_overlay")}>发送到实时叠加</Button>
      <CandidateList id="candidateList">
        {saved.map((item) => (
          <CandidateRow key={item.id}>
            <CandidateRowTop>
              <span>{item.title}</span>
              <CandidateRowStatus danger={item.statusDanger}>{item.statusLabel}</CandidateRowStatus>
            </CandidateRowTop>
            <CandidateRowMeta>{item.meta}</CandidateRowMeta>
            <ButtonRow className="two-cols">
              <Button variant="workbench" type="button" onClick={() => commands.library("load_candidate", item.id)}>载入</Button>
              <Button variant="workbench" type="button" onClick={() => commands.library("remove_candidate", item.id)}>删除</Button>
            </ButtonRow>
          </CandidateRow>
        ))}
      </CandidateList>
    </AgentCard>
  );
}
