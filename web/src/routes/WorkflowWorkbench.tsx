import { LiveControlRail, LiveStagePanel } from "../components/LiveControlRail";
import { WorkflowIncisionRail } from "../components/WorkflowIncisionRail";
import { WorkflowLayout } from "../components/WorkflowLayout";

export function WorkflowWorkbench() {
  return (
    <WorkflowLayout
      liveRail={<LiveControlRail showIncisionEntry={false} />}
      stage={<LiveStagePanel />}
      incisionRail={<WorkflowIncisionRail />}
    />
  );
}
