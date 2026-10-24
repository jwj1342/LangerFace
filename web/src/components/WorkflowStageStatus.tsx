import { useEffect, useState } from "react";
import { useIncisionStore } from "../stores/incisionStore";
import { isDeveloperMode } from "../services/developerMode";
import { StageMeta } from "./StageShell";

const DESKTOP_MEDIA_QUERY = "(max-width: 560px) and (pointer: coarse) and (hover: none)";

export function WorkflowStageStatus() {
  const snapshot = useIncisionStore((state) => state.snapshot);
  const [mobileViewport, setMobileViewport] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const update = () => setMobileViewport(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  const busy = Boolean(snapshot?.stageBusy);
  const warning = snapshot?.stageStatusTone === "warning";
  const developerDesktop = isDeveloperMode() && !mobileViewport;
  // Ordinary desktop and phone views omit the explanatory canvas subtitle.
  // Diagnostic capture and all candidate/confirmation gates remain unchanged.
  const showFeedback = isDeveloperMode() && (busy || warning || developerDesktop);
  const statusText = snapshot?.stageStatus || "切口规划准备中";
  const developerDetails = developerDesktop ? snapshot?.developerDetails || [] : [];

  return (
    <StageMeta
      id="workflowStageStatus"
      className="workflow-stage-status"
      hidden={!showFeedback}
      data-tone={snapshot?.stageStatusTone || "normal"}
      data-developer-details={developerDesktop ? "true" : undefined}
      aria-hidden={!showFeedback}
      role="status"
      aria-live="polite"
      aria-busy={busy}
    >
      {busy ? <span className="workflow-stage-spinner" aria-hidden="true" /> : null}
      {busy || !developerDetails.length ? <span className="workflow-stage-status-copy">{statusText}</span> : null}
      {developerDetails.map((detail, index) => (
        <span className="workflow-developer-detail" key={`${index}-${detail}`}>{detail}</span>
      ))}
    </StageMeta>
  );
}
