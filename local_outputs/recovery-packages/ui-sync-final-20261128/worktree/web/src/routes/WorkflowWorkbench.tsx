import { LiveControlRail, LiveStagePanel } from "../components/LiveControlRail";
import { WorkflowIncisionRail } from "../components/WorkflowIncisionRail";
import { WorkflowLayout } from "../components/WorkflowLayout";
import { MobileWorkflowControls } from "../components/MobileWorkflowControls";
import { WorkflowCanvasOverlay, WorkflowCanvasTools } from "../components/WorkflowCanvasTools";
import { WorkflowStageStatus } from "../components/WorkflowStageStatus";
import { workflowPhotoCameraEnabled } from "../services/workflowPhotoCamera";
import { WorkflowMobileSection } from "../components/WorkflowMobilePanels";

export function WorkflowWorkbench() {
  return (
    <WorkflowLayout
      liveRail={(
        <LiveControlRail
          showIncisionEntry={false}
          showStatusOverview={false}
          requireCameraPhoto={workflowPhotoCameraEnabled}
        />
      )}
      mobileOperations={<MobileWorkflowControls />}
      stage={(
        <LiveStagePanel
          compactWorkflowChrome
          workflowActions={<WorkflowMobileSection panel="incision" canvasTools><WorkflowCanvasTools /></WorkflowMobileSection>}
          workflowOverlay={<WorkflowCanvasOverlay />}
          workflowStatus={<WorkflowStageStatus />}
        />
      )}
      incisionRail={<WorkflowIncisionRail />}
    />
  );
}
