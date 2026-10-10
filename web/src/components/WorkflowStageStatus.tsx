import { useIncisionStore } from "../stores/incisionStore";
import { StageMeta } from "./StageShell";

export function WorkflowStageStatus() {
  const snapshot = useIncisionStore((state) => state.snapshot);
  const busy = Boolean(snapshot?.stageBusy);
  const warning = snapshot?.stageStatusTone === "warning";
  const showFeedback = busy || warning;
  const statusText = (snapshot?.stageStatus || "切口规划准备中")
    .replace("亮紫色虚线仅供诊断", "候选边界仅保留在诊断日志中");

  return (
    <StageMeta
      id="workflowStageStatus"
      className="workflow-stage-status"
      hidden={!showFeedback}
      data-tone={snapshot?.stageStatusTone || "normal"}
      aria-hidden={!showFeedback}
      role="status"
      aria-live="polite"
      aria-busy={busy}
    >
      {busy ? <span className="workflow-stage-spinner" aria-hidden="true" /> : null}
      <span>{statusText}</span>
    </StageMeta>
  );
}
