import { useEffect, useState, type ReactNode } from "react";

import { WorkbenchFrame, WorkbenchLayout, WorkbenchSidebar } from "./WorkbenchLayout";

const MOBILE_WORKFLOW_LAYOUT_QUERY = "(max-width: 560px) and (pointer: coarse) and (hover: none)";

interface WorkflowLayoutProps {
  liveRail: ReactNode;
  mobileOperations?: ReactNode;
  stage: ReactNode;
  incisionRail: ReactNode;
}

export function WorkflowLayout({ liveRail, mobileOperations, stage, incisionRail }: WorkflowLayoutProps) {
  const [mobileViewport, setMobileViewport] = useState(() => (
    typeof window !== "undefined" && window.matchMedia(MOBILE_WORKFLOW_LAYOUT_QUERY).matches
  ));

  useEffect(() => {
    const media = window.matchMedia(MOBILE_WORKFLOW_LAYOUT_QUERY);
    const syncViewport = () => setMobileViewport(media.matches);
    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, []);

  if (mobileViewport) {
    return (
      <WorkbenchFrame workspace="workflow">
        {stage}
        <div className="workflow-mobile-operation-pane" aria-label="移动端操作台">
          <div className="workflow-mobile-recovery-slot" />
          {mobileOperations}
          <WorkbenchSidebar aria-label="实时 RSTL 操作台" className="workflow-live-rail live-workbench">
            {liveRail}
          </WorkbenchSidebar>
          <WorkbenchSidebar aria-label="切口规划操作台" className="workflow-incision-rail incision-workbench">
            {incisionRail}
          </WorkbenchSidebar>
        </div>
      </WorkbenchFrame>
    );
  }

  return (
    <WorkbenchLayout
      secondarySidebar={incisionRail}
      secondarySidebarClassName="workflow-incision-rail incision-workbench"
      secondarySidebarLabel="切口规划操作台"
      sidebarClassName="workflow-live-rail live-workbench"
      sidebarLabel="实时 RSTL 操作台"
      stage={stage}
      workspace="workflow"
    >
      {liveRail}
    </WorkbenchLayout>
  );
}
