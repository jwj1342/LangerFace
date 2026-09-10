import { useEffect, useState } from "react";
import { RotateCw, Trash2 } from "lucide-react";
import { createPortal } from "react-dom";

import { handleFile } from "../services/pipelineSource";
import {
  clearWorkflowDraftSession,
  loadWorkflowDraftSession,
  requestWorkflowDraftRestore,
  WORKFLOW_DRAFT_CHANGED_EVENT,
  workflowDraftPhotoFile,
  type WorkflowDraftSession,
} from "../services/workflowDraftSession";
import { useLiveStore } from "../stores/liveStore";
import { Button } from "./ui/button";

interface WorkflowDraftRecoveryProps {
  mobilePortalSelector?: string;
}

const MOBILE_WORKFLOW_MEDIA_QUERY = "(max-width: 560px) and (pointer: coarse) and (hover: none)";

export function WorkflowDraftRecovery({ mobilePortalSelector }: WorkflowDraftRecoveryProps = {}) {
  const sourceKind = useLiveStore((state) => state.snapshot?.source.kind || null);
  const [draft, setDraft] = useState<WorkflowDraftSession | null>(() => loadWorkflowDraftSession());
  const [restoring, setRestoring] = useState(false);
  const [mobileTarget, setMobileTarget] = useState<Element | null>(null);

  useEffect(() => {
    const refresh = () => setDraft(loadWorkflowDraftSession());
    window.addEventListener(WORKFLOW_DRAFT_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(WORKFLOW_DRAFT_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    if (!mobilePortalSelector || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(MOBILE_WORKFLOW_MEDIA_QUERY);
    const sync = () => setMobileTarget(media.matches ? document.querySelector(mobilePortalSelector) : null);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [mobilePortalSelector]);

  if (!draft || sourceKind === "image") return null;

  const panel = (
    <section className="workflow-draft-recovery" aria-label="临时草稿">
      <div>
        <strong>发现未完成的本地草稿</strong>
        <small>仅保存在这个浏览器标签页，30 分钟后过期；不会上传服务器。</small>
      </div>
      <div className="workflow-draft-actions">
        <Button
          variant="workbenchPrimary"
          type="button"
          disabled={restoring}
          onClick={async () => {
            setRestoring(true);
            try {
              const file = await workflowDraftPhotoFile(draft.photo);
              await handleFile(file, { suppressScreenshotWarning: true });
              requestWorkflowDraftRestore(draft.incision);
            } finally {
              setRestoring(false);
            }
          }}
        >
          <RotateCw size={15} /> {restoring ? "恢复中…" : "恢复草稿"}
        </Button>
        <Button
          variant="workbench"
          type="button"
          onClick={() => clearWorkflowDraftSession()}
        >
          <Trash2 size={15} /> 清除草稿
        </Button>
      </div>
    </section>
  );

  return mobileTarget ? createPortal(panel, mobileTarget) : panel;
}
