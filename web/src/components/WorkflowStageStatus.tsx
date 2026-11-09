import { useEffect, useState } from "react";
import { useIncisionStore } from "../stores/incisionStore";
import { isDeveloperMode } from "../services/developerMode";
import { StageMeta } from "./StageShell";

const TOUCH_ONLY_MEDIA_QUERY = "(pointer: coarse) and (hover: none)";
const UPLOAD_ERROR_MESSAGES = new Set([
  "仅支持上传照片或视频。",
  "无法读取或检测该文件。请重新上传；若仍失败，请换用受支持的清晰照片或视频。",
]);

export function WorkflowStageStatus() {
  const snapshot = useIncisionStore((state) => state.snapshot);
  const [touchOnly, setTouchOnly] = useState(
    () => typeof window !== "undefined" && window.matchMedia(TOUCH_ONLY_MEDIA_QUERY).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(TOUCH_ONLY_MEDIA_QUERY);
    const update = () => setTouchOnly(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  const busy = Boolean(snapshot?.stageBusy);
  const developerDesktop = isDeveloperMode() && !touchOnly;
  const [uploadFeedback, setUploadFeedback] = useState<string | null>(null);
  useEffect(() => {
    if (!developerDesktop) {
      setUploadFeedback(null);
      return;
    }
    const messageElement = document.getElementById("overlayMsg");
    if (!messageElement) {
      setUploadFeedback(null);
      return;
    }
    const update = () => {
      const message = messageElement.textContent?.trim() || "";
      // Compact chrome keeps this node hidden; its class controls message expiry.
      setUploadFeedback(!messageElement.classList.contains("hidden") && UPLOAD_ERROR_MESSAGES.has(message)
        ? message : null);
    };
    const observer = new MutationObserver(update);
    observer.observe(messageElement, {
      attributes: true, attributeFilter: ["class"], childList: true, characterData: true, subtree: true,
    });
    update();
    return () => observer.disconnect();
  }, [developerDesktop]);
  // Explanatory subtitles are limited to desktop developer testing.
  // Diagnostic capture and all candidate/confirmation gates remain unchanged.
  const showFeedback = developerDesktop;
  const statusText = snapshot?.stageStatus || "切口规划准备中";
  const developerDetails = developerDesktop
    ? (snapshot?.developerDetails || []).filter((detail) => detail !== statusText)
    : [];
  const uploadError = developerDesktop ? uploadFeedback : null;
  if (uploadError && uploadError !== statusText && !developerDetails.includes(uploadError)) {
    developerDetails.push(uploadError);
  }

  return (
    <StageMeta
      id="workflowStageStatus"
      className="workflow-stage-status"
      hidden={!showFeedback}
      data-tone={uploadError ? "warning" : snapshot?.stageStatusTone || "normal"}
      data-developer-details={developerDesktop ? "true" : undefined}
      aria-hidden={!showFeedback}
      role="status"
      aria-live="polite"
      aria-busy={busy}
    >
      {busy ? <span className="workflow-stage-spinner" aria-hidden="true" /> : null}
      <span className="workflow-stage-status-copy">{statusText}</span>
      {developerDetails.map((detail, index) => (
        <span className="workflow-developer-detail" key={`${index}-${detail}`}>{detail}</span>
      ))}
    </StageMeta>
  );
}
