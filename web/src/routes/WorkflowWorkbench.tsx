import { LiveControlRail, LiveStagePanel } from "../components/LiveControlRail";
import { WorkflowIncisionRail } from "../components/WorkflowIncisionRail";
import { WorkflowLayout } from "../components/WorkflowLayout";
import { MobileWorkflowControls } from "../components/MobileWorkflowControls";
import { WorkflowCanvasOverlay, WorkflowCanvasTools } from "../components/WorkflowCanvasTools";
import { WorkflowStageStatus } from "../components/WorkflowStageStatus";

export function WorkflowWorkbench() {
  return (
    <WorkflowLayout
      liveRail={(
        <LiveControlRail
          moveQualityToMobileStage
          showIncisionEntry={false}
          showStatusOverview={false}
          showPersonalizedHint={false}
        />
      )}
      stage={(
        <LiveStagePanel
          mobileControls={<MobileWorkflowControls />}
          workflowActions={<WorkflowCanvasTools />}
          workflowOverlay={<WorkflowCanvasOverlay />}
          workflowStatus={<WorkflowStageStatus />}
        />
      )}
      incisionRail={<WorkflowIncisionRail />}
    />
  );
}
