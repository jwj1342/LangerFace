import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type WorkflowMobilePanel = "texture" | "incision" | "more";

export interface WorkflowMobilePanelLayout {
  mobile: boolean;
  selected: WorkflowMobilePanel | null;
  select: (panel: WorkflowMobilePanel | null) => void;
  slots: Record<WorkflowMobilePanel, HTMLDivElement>;
  markerActive: boolean;
  markerSlot: HTMLDivElement;
}

export const WorkflowMobilePanelContext = createContext<WorkflowMobilePanelLayout | null>(null);

export function useWorkflowMobilePanels() {
  return useContext(WorkflowMobilePanelContext);
}

/** Phone-only disclosure; desktop keeps the same content expanded in place. */
export function WorkflowMobileDisclosure({ title, children, initialOpen = false }: {
  title: string;
  children: ReactNode;
  initialOpen?: boolean;
}) {
  const mobile = useWorkflowMobilePanels()?.mobile || false;
  const [open, setOpen] = useState(initialOpen);
  return (
    <details className="workflow-mobile-disclosure" name={mobile ? "workflow-mobile-incision-sections" : undefined} open={!mobile || open}
      onToggle={event => { if (mobile) setOpen(event.currentTarget.open); }}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

/** Move a stable portal host, keeping the original controls and bindings alive. */
export function WorkflowMobileSection({ panel, children, canvasTools = false }: { panel: WorkflowMobilePanel; children: ReactNode; canvasTools?: boolean }) {
  const layout = useWorkflowMobilePanels();
  if (!layout) return children;
  return <PlacedSection panel={panel} layout={layout} canvasTools={canvasTools}>{children}</PlacedSection>;
}

function PlacedSection({ panel, children, layout, canvasTools }: {
  panel: WorkflowMobilePanel;
  children: ReactNode;
  layout: WorkflowMobilePanelLayout;
  canvasTools: boolean;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [host] = useState(() => {
    const node = document.createElement("div");
    node.className = "workflow-mobile-section-host";
    return node;
  });
  const { mobile, slots, markerActive, markerSlot } = layout;
  useLayoutEffect(() => {
    const target = mobile ? (canvasTools && markerActive ? markerSlot : slots[panel]) : anchor.current;
    target?.append(host);
  }, [host, mobile, panel, slots, canvasTools, markerActive, markerSlot]);
  useLayoutEffect(() => () => host.remove(), [host]);
  return <><div ref={anchor} className="workflow-mobile-section-anchor" />{createPortal(children, host)}</>;
}
