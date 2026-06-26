import { StageActions, StageLink, StageMeta, StageShell, StageStatus, StageViewport } from "./StageShell";

export function AnnotateStagePanel() {
  return (
    <StageShell
      top={(
        <>
          <StageStatus active>标注模式</StageStatus>
          <StageActions>
            <StageMeta>拖拽旋转 · 滚轮缩放 · 点击落点</StageMeta>
            <StageLink to="/live">返回实时显示</StageLink>
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
