import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

import { WorkbenchFrame } from "./WorkbenchLayout";
import { narrowTouchWorkflowViewportActive, subscribeWorkflowViewport } from "../services/workflowViewport";
import { useIncisionStore } from "../stores/incisionStore";
import { WorkflowMobilePanelContext, type WorkflowMobilePanel } from "./WorkflowMobilePanels";

interface WorkflowLayoutProps {
  liveRail: ReactNode;
  mobileOperations?: ReactNode;
  stage: ReactNode;
  incisionRail: ReactNode;
}

export function WorkflowLayout({ liveRail, mobileOperations, stage, incisionRail }: WorkflowLayoutProps) {
  const [mobileViewport, setMobileViewport] = useState(narrowTouchWorkflowViewportActive);
  const markerActive = useIncisionStore(state => Boolean(state.snapshot?.workflowTools?.controlledMarkerMode));
  const markerSlotRef = useRef<HTMLDivElement>(null);
  const [markerSlot] = useState(() => document.createElement("div"));
  const paneRef = useRef<HTMLDivElement>(null);
  const incisionSlotRef = useRef<HTMLDivElement>(null);
  const [selected, select] = useState<WorkflowMobilePanel | null>(null);
  const [slots] = useState(() => Object.fromEntries(
    (["texture", "incision", "more"] as const).map((name) => {
      const node = document.createElement("div");
      node.className = `workflow-mobile-panel-content workflow-mobile-${name}-content`;
      return [name, node];
    }),
  ) as Record<WorkflowMobilePanel, HTMLDivElement>);
  const [rails] = useState(() => {
    const rail = (label: string, className: string) => {
      const host = document.createElement("aside");
      host.className = `sidebar ${className}`;
      host.setAttribute("aria-label", label);
      return host;
    };
    return {
      live: rail("实时皮纹线操作台", "workflow-live-rail live-workbench"),
      incision: rail("切口规划操作台", "workflow-incision-rail incision-workbench"),
    };
  });

  useEffect(() => {
    const syncViewport = () => setMobileViewport(narrowTouchWorkflowViewportActive());
    syncViewport();
    return subscribeWorkflowViewport(syncViewport);
  }, []);

  useLayoutEffect(() => {
    if (mobileViewport && markerActive) select(null);
  }, [mobileViewport, markerActive]);

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
      if (rails.live.parentElement !== pane) pane.append(rails.live);
      incisionSlotRef.current?.append(rails.incision);
    } else {
      if (rails.live.parentElement !== root) root.insertBefore(rails.live, stageNode);
      if (rails.incision.parentElement !== root) root.append(rails.incision);
    }
    if (preserveFocus && focused !== document.activeElement) focused.focus({ preventScroll: true });
  }, [mobileViewport, rails]);

  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    markerSlotRef.current?.append(markerSlot);
    for (const name of ["texture", "incision", "more"] as const) {
      pane.querySelector(`[data-mobile-panel-slot="${name}"]`)?.prepend(slots[name]);
    }
  }, [slots, markerSlot]);

  useLayoutEffect(() => () => {
    rails.live.remove();
    rails.incision.remove();
  }, [rails]);

  return (
    <WorkflowMobilePanelContext.Provider value={{ mobile: mobileViewport, selected, select, slots, markerActive, markerSlot }}>
    <WorkbenchFrame workspace="workflow" data-workflow-mobile={String(mobileViewport)} data-mobile-marker-active={String(mobileViewport && markerActive)} data-mobile-panel={mobileViewport ? selected || "closed" : undefined}>
      {stage}
      <div ref={paneRef} className="workflow-mobile-operation-pane" aria-label="移动端操作台">
        <div className="workflow-mobile-recovery-slot" />
        <section className="workflow-mobile-sheet" hidden={!mobileViewport || !selected || markerActive} aria-label={selected === "texture" ? "皮肤纹理" : selected === "incision" ? "切口设计" : "更多"}>
          <header className="workflow-mobile-sheet-heading">
            <strong>{selected === "texture" ? "皮肤纹理" : selected === "incision" ? "切口设计" : "更多"}</strong>
            <button type="button" onClick={() => select(null)} aria-label="收起操作面板"><ChevronDown size={18} aria-hidden="true" /></button>
          </header>
          <div className="workflow-mobile-sheet-scroll">
            <div data-mobile-panel-slot="texture" hidden={selected !== "texture"} />
            <div data-mobile-panel-slot="incision" ref={incisionSlotRef} hidden={selected !== "incision"} />
            <div data-mobile-panel-slot="more" hidden={selected !== "more"} />
          </div>
        </section>
        <div ref={markerSlotRef} className="workflow-mobile-marker-tools" aria-label="标记操作" />
        {mobileViewport ? mobileOperations : null}
      </div>
      {createPortal(liveRail, rails.live, "workflow-live")}
      {createPortal(incisionRail, rails.incision, "workflow-incision")}
    </WorkbenchFrame>
    </WorkflowMobilePanelContext.Provider>
  );
}
