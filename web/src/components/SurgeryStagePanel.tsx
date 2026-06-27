import type { ReactNode } from "react";

import { StageActions, StageLink, StageMeta, StageShell, StageStatus, StageViewport } from "./StageShell";

interface SurgeryStagePanelProps {
  stage: ReactNode;
}

export function SurgeryStagePanel({ stage }: SurgeryStagePanelProps) {
  return (
    <StageShell
      top={(
        <>
          <StageStatus active>沿 RSTL 闭合演示</StageStatus>
          <StageActions>
            <StageMeta>拖拽旋转 · 滚轮缩放 · 点击标记肿物</StageMeta>
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
