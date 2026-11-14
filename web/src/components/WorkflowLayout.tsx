import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { WorkbenchFrame } from "./WorkbenchLayout";
import { narrowTouchWorkflowViewportActive, subscribeWorkflowViewport } from "../services/workflowViewport";

interface WorkflowLayoutProps {
  liveRail: ReactNode;
  mobileOperations?: ReactNode;
  stage: ReactNode;
  incisionRail: ReactNode;
}

export function WorkflowLayout({ liveRail, mobileOperations, stage, incisionRail }: WorkflowLayoutProps) {
  const [mobileViewport, setMobileViewport] = useState(narrowTouchWorkflowViewportActive);
  const paneRef = useRef<HTMLDivElement>(null);
  const [rails] = useState(() => {
    const rail = (label: string, className: string) => {
      const host = document.createElement("aside");
      host.className = `sidebar ${className}`;
      host.setAttribute("aria-label", label);
      return host;
    };
    return {
      live: rail("实时 RSTL 操作台", "workflow-live-rail live-workbench"),
      incision: rail("切口规划操作台", "workflow-incision-rail incision-workbench"),
    };
  });

  useEffect(() => {
    const syncViewport = () => setMobileViewport(narrowTouchWorkflowViewportActive());
    syncViewport();
    return subscribeWorkflowViewport(syncViewport);
  }, []);

  useLayoutEffect(() => {
    const pane = paneRef.current;
    const root = pane?.parentElement;
    const stageNode = root?.querySelector(":scope > .stage");
    if (!pane || !root || !stageNode) throw new Error("工作流布局缺少画布或操作台容器");
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const preserveFocus = focused && (rails.live.contains(focused) || rails.incision.contains(focused));
    // Portal targets remain identical. Moving only these owned containers keeps
    // controller bindings, photo state and desktop keyboard order intact.
    if (mobileViewport) {
      if (rails.live.parentElement !== pane) pane.append(rails.live, rails.incision);
    } else {
      if (rails.live.parentElement !== root) root.insertBefore(rails.live, stageNode);
      if (rails.incision.parentElement !== root) root.append(rails.incision);
    }
    if (preserveFocus && focused !== document.activeElement) focused.focus({ preventScroll: true });
  }, [mobileViewport, rails]);

  useLayoutEffect(() => () => {
    rails.live.remove();
    rails.incision.remove();
  }, [rails]);

  return (
    <WorkbenchFrame workspace="workflow" data-workflow-mobile={String(mobileViewport)}>
      {stage}
      <div ref={paneRef} className="workflow-mobile-operation-pane" aria-label="移动端操作台">
        <div className="workflow-mobile-recovery-slot" />
        {mobileViewport ? mobileOperations : null}
      </div>
      {createPortal(liveRail, rails.live, "workflow-live")}
      {createPortal(incisionRail, rails.incision, "workflow-incision")}
    </WorkbenchFrame>
  );
}
