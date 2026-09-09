import { useEffect, useState } from "react";

import { useIncisionStore } from "../stores/incisionStore";
import { StageMeta } from "./StageShell";

const MOBILE_WORKFLOW_MEDIA_QUERY = "(max-width: 560px) and (pointer: coarse) and (hover: none)";

export function WorkflowStageStatus() {
  const snapshot = useIncisionStore((state) => state.snapshot);
  const busy = Boolean(snapshot?.stageBusy);
  const warning = snapshot?.stageStatusTone === "warning";
  const activeTool = Boolean(
    snapshot?.workflowTools?.selectionMode
    || snapshot?.workflowTools?.controlledMarkerMode
    || snapshot?.workflowTools?.repairMode
    || snapshot?.tumor.boundaryActive,
  );
  const persistent = busy || warning || activeTool;
  const [visible, setVisible] = useState(true);
  const [mobileViewport, setMobileViewport] = useState(() => (
    typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia(MOBILE_WORKFLOW_MEDIA_QUERY).matches
  ));

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(MOBILE_WORKFLOW_MEDIA_QUERY);
    const sync = () => setMobileViewport(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    setVisible(true);
    if (!mobileViewport || persistent) return;
    const timer = window.setTimeout(() => setVisible(false), 4_000);
    return () => window.clearTimeout(timer);
  }, [mobileViewport, persistent, snapshot?.reason, snapshot?.stageStatus, snapshot?.stageStatusTone]);

  return (
    <StageMeta
      id="workflowStageStatus"
      className={`workflow-stage-status${!mobileViewport || visible || persistent ? "" : " is-collapsed"}`}
      data-tone={snapshot?.stageStatusTone || "normal"}
      role="status"
      aria-live="polite"
      aria-busy={busy}
    >
      {busy ? <span className="workflow-stage-spinner" aria-hidden="true" /> : null}
      <span>{snapshot?.stageStatus || "切口规划准备中"}</span>
    </StageMeta>
  );
}
