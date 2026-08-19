import type { ReactNode } from "react";

import { WorkbenchLayout } from "./WorkbenchLayout";

interface WorkflowLayoutProps {
  liveRail: ReactNode;
  stage: ReactNode;
  incisionRail: ReactNode;
}

export function WorkflowLayout({ liveRail, stage, incisionRail }: WorkflowLayoutProps) {
  return (
    <WorkbenchLayout
      secondarySidebar={incisionRail}
      secondarySidebarClassName="workflow-incision-rail"
      secondarySidebarLabel="切口规划操作台"
      sidebarClassName="workflow-live-rail"
      sidebarLabel="实时 RSTL 操作台"
      stage={stage}
      workspace="workflow"
    >
      {liveRail}
    </WorkbenchLayout>
  );
}
