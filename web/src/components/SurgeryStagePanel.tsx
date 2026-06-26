import { Link } from "react-router-dom";
import type { ReactNode } from "react";

interface SurgeryStagePanelProps {
  stage: ReactNode;
}

export function SurgeryStagePanel({ stage }: SurgeryStagePanelProps) {
  return (
    <main className="stage">
      <div className="stage-top">
        <span className="live on"><span className="dot" />沿 RSTL 闭合演示</span>
        <div className="stage-actions">
          <span className="fps">拖拽旋转 · 滚轮缩放 · 点击标记肿物</span>
          <Link className="stage-link" to="/annotate">返回 3D 标注</Link>
        </div>
      </div>
      <div className="stage-body">
        <div className="main-wrap">
          {stage}
        </div>
      </div>
    </main>
  );
}
