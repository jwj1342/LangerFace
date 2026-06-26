import { StageActions, StageLink, StageShell, StageViewport } from "./StageShell";

export function AnnotateStagePanel() {
  return (
    <StageShell
      top={(
        <>
          <span className="live on"><span className="dot" />标注模式</span>
          <StageActions>
            <span className="fps">拖拽旋转 · 滚轮缩放 · 点击落点</span>
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
