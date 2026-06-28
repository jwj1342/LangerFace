import { StageActions, StageLink, StageMeta, StageShell, StageStatus, StageViewport } from "./StageShell";

export function AnnotateStagePanel() {
  return (
    <StageShell
      top={(
        <>
          <StageStatus active>图谱标注</StageStatus>
          <StageActions>
            <StageMeta>拖拽旋转 · 滚轮缩放 · 点击落点</StageMeta>
            <StageLink to="/cases">返回病例大厅</StageLink>
          </StageActions>
        </>
      )}
    >
      <StageViewport>
        <canvas id="stage" />
      </StageViewport>
    </StageShell>
  );
}
