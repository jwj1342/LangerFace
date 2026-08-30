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
import { ChevronsUp } from "lucide-react";

import { WorkflowDraftRecovery } from "./WorkflowDraftRecovery";

interface LiveStagePanelProps {
  mobileControls?: ReactNode;
  workflowActions?: ReactNode;
  workflowOverlay?: ReactNode;
  workflowStatus?: ReactNode;
}

export function LiveStagePanel({ mobileControls, workflowActions, workflowOverlay, workflowStatus }: LiveStagePanelProps = {}) {
  return (
    <StageShell
      top={(
        <>
          <StageStatus id="livePill">待机</StageStatus>
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
      {mobileControls ? (
        <div className="workflow-mobile-scroll-zone" aria-label="从这里向上滑动查看下方操作">
          <ChevronsUp size={18} aria-hidden="true" />
          <span>从这里向上滑动，查看更多操作</span>
        </div>
      ) : null}
      {mobileControls ? <WorkflowDraftRecovery /> : null}
      {mobileControls}
      <StageZoomStrip id="zoomStrip" />
    </StageShell>
  );
}
