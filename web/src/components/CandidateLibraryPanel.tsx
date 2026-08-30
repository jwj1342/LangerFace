import { useEffect, useState } from "react";

import { Button } from "./ui/button";
import { ButtonRow } from "./ui/button-row";
import { WorkbenchCard, CardHeader } from "./ui/card";
import { Hint } from "./ui/hint";
import { CandidateList, CandidateRow, CandidateRowMeta, CandidateRowStatus, CandidateRowTop } from "./ui/library-list";
import { useIncisionControllerCommands } from "../hooks/useControllerCommands";
import { useIncisionStore } from "../stores/incisionStore";

export function CandidateLibraryPanel({
  automaticOverlay = false,
  showHandoffStatus = true,
  showDirectionVariants = true,
  showJsonExport = true,
  showSaveAndExportActions = true,
  showCandidateRowActions = true,
  showReviewTransitions = false,
}: {
  automaticOverlay?: boolean;
  showHandoffStatus?: boolean;
  showDirectionVariants?: boolean;
  showJsonExport?: boolean;
  showSaveAndExportActions?: boolean;
  showCandidateRowActions?: boolean;
  showReviewTransitions?: boolean;
}) {
  const commands = useIncisionControllerCommands();
  const snapshot = useIncisionStore((state) => state.snapshot);
  const saved = snapshot?.savedCandidates || [];
  const hasCandidate = Boolean(snapshot?.candidate);
  const hasSaved = saved.length > 0;
  const [confirmClear, setConfirmClear] = useState(false);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);

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
    <WorkbenchCard>
      <CardHeader><span>候选库</span><span id="savedCount">{saved.length}</span></CardHeader>
      {showSaveAndExportActions ? (
        <Button
          variant="workbenchPrimary"
          id="saveCandidateBtn"
          type="button"
          disabled={!hasCandidate}
          onClick={() => commands.library("save_current")}
        >
          保存当前候选
        </Button>
      ) : null}
      {showDirectionVariants ? (
        <ButtonRow className="two-cols">
          <Button variant="workbench" id="makeVariantsBtn" type="button" disabled={!hasCandidate} onClick={() => commands.library("make_variants")}>保存方向备选</Button>
          <Button variant={confirmClear ? "miniDanger" : "workbench"} id="clearSavedBtn" type="button" disabled={!hasSaved} onClick={clearSaved}>
            {confirmClear ? "确认清空" : "清空候选库"}
          </Button>
        </ButtonRow>
      ) : (
        <Button variant={confirmClear ? "miniDanger" : "workbench"} id="clearSavedBtn" type="button" disabled={!hasSaved} onClick={clearSaved}>
          {confirmClear ? "确认清空" : "清空候选库"}
        </Button>
      )}
      {confirmClear ? (
        <ButtonRow className="two-cols">
          <Button variant="workbench" type="button" onClick={() => setConfirmClear(false)}>取消</Button>
          <Hint>将删除当前工作台保存的全部候选草案。</Hint>
        </ButtonRow>
      ) : null}
      {showSaveAndExportActions ? (
        <ButtonRow className={showJsonExport ? "three-cols" : "two-cols"}>
          {showJsonExport ? (
            <Button variant="workbench" id="exportJsonBtn" type="button" disabled={!hasCandidate && !hasSaved} onClick={() => commands.library("export_json")}>导出 JSON</Button>
          ) : null}
          <Button variant="workbench" id="exportReportBtn" type="button" disabled={!hasCandidate && !hasSaved} onClick={() => commands.library("export_report")}>导出报告</Button>
          <Button variant="workbench" id="exportPngBtn" type="button" disabled={!hasCandidate} onClick={() => commands.library("export_png")}>导出截图</Button>
        </ButtonRow>
      ) : null}
      {automaticOverlay ? null : (
        <Button variant="workbenchPrimary" id="stageLiveOverlayBtn" type="button" disabled={!hasCandidate} onClick={() => commands.library("stage_live_overlay")}>进入实时叠加</Button>
      )}
      {showHandoffStatus ? (
        <Hint id="liveOverlayHandoffStatus" aria-live="polite">
          {snapshot?.stageStatus || (automaticOverlay
            ? "候选通过审阅检查后，将自动显示在当前画布上。"
            : "填写审阅人并确认候选后，可在照片、视频或摄像头画面中显示。")}
        </Hint>
      ) : null}
      <CandidateList id="candidateList">
        {saved.map((item) => (
          <CandidateRow key={item.id} className={activeCandidateId === item.id ? "active" : undefined}>
            <CandidateRowTop>
              <span>{item.title}</span>
              <CandidateRowStatus danger={item.statusDanger}>{item.statusLabel}</CandidateRowStatus>
            </CandidateRowTop>
            <CandidateRowMeta>{item.meta}</CandidateRowMeta>
            <CandidateRowMeta>{item.reviewerLabel}</CandidateRowMeta>
            <CandidateRowMeta>{item.reviewNotesLabel}</CandidateRowMeta>
            <CandidateRowMeta
              className={item.overlayStatusWarning ? "candidate-overlay-status warning" : "candidate-overlay-status"}
              role="status"
            >
              {item.overlayStatusLabel}
            </CandidateRowMeta>
            {showCandidateRowActions ? (
              <ButtonRow
                className={`candidate-actions ${showReviewTransitions && item.reviewTransitionLabel ? "three-cols" : "two-cols"}`}
              >
                <Button
                  variant="workbench"
                  type="button"
                  aria-pressed={activeCandidateId === item.id}
                  onClick={() => {
                    setActiveCandidateId(item.id);
                    commands.library("load_candidate", item.id);
                  }}
                >
                  {activeCandidateId === item.id ? "已载入" : "载入"}
                </Button>
                <Button variant="workbench" type="button" onClick={() => commands.library("remove_candidate", item.id)}>删除</Button>
                {showReviewTransitions && item.reviewTransitionLabel ? (
                  <Button
                    variant="workbench"
                    type="button"
                    data-candidate-review-toggle={item.reviewStatus}
                    onClick={() => commands.library("toggle_candidate_review_status", item.id)}
                  >
                    {item.reviewTransitionLabel}
                  </Button>
                ) : null}
              </ButtonRow>
            ) : null}
          </CandidateRow>
        ))}
      </CandidateList>
    </WorkbenchCard>
  );
}
