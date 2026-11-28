import { MobileCandidateAdjustPanel } from "./MobileWorkflowControls";
import { ReviewControlsPanel } from "./ReviewControlsPanel";
import { TumorInputPanel } from "./TumorInputPanel";
import { WorkbenchBrand } from "./WorkbenchBrand";
import { StatusBadge } from "./ui/status-badge";
import { WorkflowMobileDisclosure } from "./WorkflowMobilePanels";

export function WorkflowIncisionRail() {
  return (
    <>
      <WorkbenchBrand
        eyebrow="切口研究工具"
        title="切口规划与候选审阅"
        action={<StatusBadge>单页工作流</StatusBadge>}
      />
      <WorkflowMobileDisclosure title="切口规划">
        <TumorInputPanel showDepthControl={false} continuousFreehand simplifiedWorkflow />
      </WorkflowMobileDisclosure>
      <WorkflowMobileDisclosure title="候选微调">
        <MobileCandidateAdjustPanel />
      </WorkflowMobileDisclosure>
      <div className="workflow-mobile-review-row">
        <ReviewControlsPanel />
      </div>
    </>
  );
}
