import type { ReactNode } from "react";

import { StageActions, StageLink, StageShell, StageViewport } from "./StageShell";

interface SurgeryStagePanelProps {
  stage: ReactNode;
}

export function SurgeryStagePanel({ stage }: SurgeryStagePanelProps) {
  return (
    <StageShell
      top={(
        <>
          <span className="live on"><span className="dot" />沿 RSTL 闭合演示</span>
          <StageActions>
            <span className="fps">拖拽旋转 · 滚轮缩放 · 点击标记肿物</span>
            <StageLink to="/annotate">返回 3D 标注</StageLink>
          </StageActions>
        </>
      )}
    >
      <StageViewport>
        {stage}
      </StageViewport>
    </StageShell>
  );
}
