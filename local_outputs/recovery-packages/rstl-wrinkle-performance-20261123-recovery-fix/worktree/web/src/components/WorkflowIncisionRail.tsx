import { MobileCandidateAdjustPanel } from "./MobileWorkflowControls";
import { ReviewControlsPanel } from "./ReviewControlsPanel";
import { TumorInputPanel } from "./TumorInputPanel";
import { WorkbenchBrand } from "./WorkbenchBrand";
import { StatusBadge } from "./ui/status-badge";

export function WorkflowIncisionRail() {
  return (
    <>
      <WorkbenchBrand
        eyebrow="切口研究工具"
        title="切口规划与候选审阅"
        action={<StatusBadge>单页工作流</StatusBadge>}
      />
      <TumorInputPanel showDepthControl={false} continuousFreehand simplifiedWorkflow />
      <MobileCandidateAdjustPanel />
      <ReviewControlsPanel />
    </>
  );
}
