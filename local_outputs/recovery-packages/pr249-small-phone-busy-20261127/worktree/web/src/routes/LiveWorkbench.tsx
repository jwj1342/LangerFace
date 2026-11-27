import { LiveControlRail, LiveStagePanel } from "../components/LiveControlRail";
import { WorkbenchLayout } from "../components/WorkbenchLayout";

export function LiveWorkbench() {
  return (
    <WorkbenchLayout
      stage={<LiveStagePanel />}
      workspace="live"
    >
      <LiveControlRail />
    </WorkbenchLayout>
  );
}
