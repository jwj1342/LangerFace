import { useEffect, useRef, useState } from "react";

import { Button } from "./ui/button";
import { WorkbenchCard, CardHeader } from "./ui/card";
import { WorkbenchNote } from "./ui/hint";
import { ReviewStatus } from "./ui/incision-status";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useIncisionControllerCommands } from "../hooks/useControllerCommands";
import { reviewStatusLabel } from "../services/incisionClinicalCopy";
import { useIncisionStore } from "../stores/incisionStore";
import { useLiveStore } from "../stores/liveStore";

function reviewLabel(status: string) {
  return reviewStatusLabel(status);
}

function reviewTone(status: string): "" | "approved" | "rejected" | "revision" {
  if (status === "rejected_by_clinician") return "rejected";
  if (status === "needs_revision") return "revision";
  return "";
}

function visibleReviewStatus(status: string) {
  return status === "approved_for_discussion"
    ? "approved_for_discussion"
    : "pending_clinician_confirmation";
}

const REVIEW_SAVE_NOTICE_REASONS = new Set([
  "review_blocked",
  "review_missing_candidate",
  "diagnostic_review_blocked",
  "diagnostic_review_acknowledged",
  "candidate_review_transition_blocked",
]);

export function ReviewControlsPanel() {
  const commands = useIncisionControllerCommands();
  const snapshot = useIncisionStore((state) => state.snapshot);
  const cameraMode = useLiveStore((state) => state.snapshot?.source.kind === "camera");
  const [status, setStatus] = useState("pending_clinician_confirmation");
  const [reviewer, setReviewer] = useState("");
  const reviewerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const next = snapshot?.review.status;
    if (next) setStatus(visibleReviewStatus(next));
  }, [snapshot?.review.status]);

  useEffect(() => {
    setReviewer(snapshot?.review.reviewer || "");
  }, [snapshot?.review.reviewer]);

  const reviewerAttentionRequired = Boolean(snapshot?.review.reviewerAttentionRequired && !reviewer.trim());
  const reviewSaveNotice = Boolean(snapshot && REVIEW_SAVE_NOTICE_REASONS.has(snapshot.reason));
  const confirmed = status === "approved_for_discussion";
  const confirmDisabled = cameraMode || confirmed || !snapshot?.candidate;
  const reviewerMissingNotice = Boolean(
    snapshot?.reason === "review_blocked"
    && snapshot.review.reviewerAttentionRequired
    && !reviewer.trim(),
  );
  const blockingReviewNotice = reviewSaveNotice
    && !(snapshot?.review.reviewerAttentionRequired && reviewer.trim());
  const reviewSaveFeedback = reviewerMissingNotice
    ? "请填写审阅人后确认"
    : "当前方案不能确认";

  useEffect(() => {
    if (!reviewSaveNotice) return;
    const target = reviewerAttentionRequired ? reviewerRef.current : null;
    if (!target) return;
    target.classList.remove("workflow-review-attention");
    void target.offsetWidth;
    target.classList.add("workflow-review-attention");
  }, [
    reviewSaveNotice,
    reviewerAttentionRequired,
    snapshot?.updatedAt,
  ]);

  return (
    <WorkbenchCard>
      <CardHeader>
        <span>医生审阅</span>
        <ReviewStatus tone={reviewTone(status)} id="reviewState">{reviewLabel(status)}</ReviewStatus>
      </CardHeader>
      <div className={cameraMode ? "workflow-disabled-field" : undefined}>
        <Label htmlFor="reviewerName">审阅人</Label>
        <Input
          ref={reviewerRef}
          id="reviewerName"
          disabled={cameraMode}
          placeholder="请输入审阅人"
          value={reviewer}
          onChange={(event) => setReviewer(event.currentTarget.value)}
          className={reviewerAttentionRequired ? "workflow-review-attention" : undefined}
          aria-invalid={reviewerAttentionRequired}
          aria-describedby={reviewerAttentionRequired ? "reviewSaveFeedback" : undefined}
        />
      </div>
      <Button
        variant="workbenchPrimary"
        id="saveReviewBtn"
        type="button"
        disabled={confirmDisabled}
        title={cameraMode ? "摄像头模式下不可进行医生审阅" : undefined}
        aria-pressed={confirmed}
        aria-describedby={blockingReviewNotice ? "reviewSaveFeedback" : undefined}
        onClick={() => commands.review("save_review")}
      >
        {confirmed ? "已确认" : "确认"}
      </Button>
      <WorkbenchNote
        id="reviewSaveFeedback"
        className="workflow-review-feedback"
        visible={blockingReviewNotice}
        role="alert"
        aria-live="assertive"
      >
        {reviewSaveFeedback}
      </WorkbenchNote>
    </WorkbenchCard>
  );
}
