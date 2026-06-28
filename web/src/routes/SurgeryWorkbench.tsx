import { Link } from "react-router-dom";
import type { ReactNode } from "react";

import { SurgeryControlsPanel } from "../components/SurgeryControlsPanel";
import { SurgeryHelpPanel } from "../components/SurgeryHelpPanel";
import { SurgeryMetricsPanel, type SurgeryVerdictTone } from "../components/SurgeryMetricsPanel";
import { SurgeryStagePanel } from "../components/SurgeryStagePanel";
import { Disclaimer, WorkbenchLayout } from "../components/WorkbenchLayout";
import { WorkbenchBrand } from "../components/WorkbenchBrand";
import { StatusBadge } from "../components/ui/status-badge";

interface SurgeryWorkbenchProps {
  activeCut: "along" | null;
  hint: string;
  isReady: boolean;
  lesionState: string;
  showLines: boolean;
  sizePct: number;
  stage: ReactNode;
  tensionScore: number | null;
  verdict: string;
  verdictTone: SurgeryVerdictTone;
  onExciseAlong: () => void;
  onReset: () => void;
  onShowLinesChange: (checked: boolean) => void;
  onSizeChange: (value: number) => void;
}

export function SurgeryWorkbench({
  activeCut,
  hint,
  isReady,
  lesionState,
  showLines,
  sizePct,
  stage,
  tensionScore,
  verdict,
  verdictTone,
  onExciseAlong,
  onReset,
  onShowLinesChange,
  onSizeChange,
}: SurgeryWorkbenchProps) {
  return (
    <WorkbenchLayout
      stage={<SurgeryStagePanel stage={stage} />}
      workspace="surgery"
    >
      <WorkbenchBrand
        eyebrow="病例步骤二 · 闭合模拟"
        title="张力闭合模拟"
        action={<StatusBadge asChild><Link to="/incision">返回切口规划</Link></StatusBadge>}
      />

      <SurgeryControlsPanel
        activeCut={activeCut}
        hint={hint}
        isReady={isReady}
        lesionState={lesionState}
        showLines={showLines}
        sizePct={sizePct}
        onExciseAlong={onExciseAlong}
        onReset={onReset}
        onShowLinesChange={onShowLinesChange}
        onSizeChange={onSizeChange}
      />

      <SurgeryMetricsPanel tensionScore={tensionScore} verdict={verdict} verdictTone={verdictTone} />

      <SurgeryHelpPanel />

      <Disclaimer>
        本页提供闭合张力的定性辅助观察，非有限元、非患者个体化建模，<b>不是手术指令、非医疗器械</b>。
        真实软组织力学需体网格 FEM + 影像，本工具只为直观呈现 RSTL 与闭合张力的关系。
      </Disclaimer>
    </WorkbenchLayout>
  );
}
