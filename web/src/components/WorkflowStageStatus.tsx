import { useIncisionStore } from "../stores/incisionStore";
import { StageMeta } from "./StageShell";

export function WorkflowStageStatus() {
  const snapshot = useIncisionStore((state) => state.snapshot);
  const busy = Boolean(snapshot?.stageBusy);

  return (
    <StageMeta
      id="workflowStageStatus"
      className="workflow-stage-status"
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
