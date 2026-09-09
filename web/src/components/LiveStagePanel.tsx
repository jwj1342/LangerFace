import {
  StageCanvas,
  StageActions,
  StageMeta,
  StageOverlayMessage,
  StageShell,
  StageStatus,
  StageViewport,
  StageZoomStrip,
} from "./StageShell";
import type { ReactNode } from "react";

import { WorkflowDraftRecovery } from "./WorkflowDraftRecovery";

interface LiveStagePanelProps {
  workflowActions?: ReactNode;
  workflowOverlay?: ReactNode;
  workflowStatus?: ReactNode;
}

export function LiveStagePanel({ workflowActions, workflowOverlay, workflowStatus }: LiveStagePanelProps = {}) {
  return (
    <StageShell
      top={(
        <>
          <StageStatus id="livePill">待机</StageStatus>
          <div className="workflow-mobile-quality-slot" aria-label="画布质量状态" />
          {workflowStatus}
          {workflowActions ? <StageActions className="workflow-stage-actions">{workflowActions}</StageActions> : null}
          <StageMeta id="fps">— fps</StageMeta>
        </>
      )}
    >
      <StageViewport>
        <video id="video" playsInline autoPlay muted />
        <StageCanvas id="canvas" mirror width="1280" height="720" />
        {workflowOverlay}
        <StageOverlayMessage id="overlayMsg">点击「摄像头」或「上传照片」开始</StageOverlayMessage>
      </StageViewport>
      <WorkflowDraftRecovery mobilePortalSelector=".workflow-workbench .workflow-mobile-recovery-slot" />
      <StageZoomStrip id="zoomStrip" />
    </StageShell>
  );
}
