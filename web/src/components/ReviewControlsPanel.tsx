import { useEffect, useRef, useState } from "react";

import { Button } from "./ui/button";
import { WorkbenchCard, CardHeader } from "./ui/card";
import { WorkbenchNote } from "./ui/hint";
import { ReviewStatus } from "./ui/incision-status";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select } from "./ui/select";
import { Textarea } from "./ui/textarea";
import { useIncisionControllerCommands } from "../hooks/useControllerCommands";
import { reviewStatusLabel } from "../services/incisionClinicalCopy";
import { useIncisionStore } from "../stores/incisionStore";

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
]);

export function ReviewControlsPanel() {
  const commands = useIncisionControllerCommands();
  const snapshot = useIncisionStore((state) => state.snapshot);
  const [status, setStatus] = useState("pending_clinician_confirmation");
  const [reviewer, setReviewer] = useState("");
  const [notesPresent, setNotesPresent] = useState(false);
  const reviewerRef = useRef<HTMLInputElement>(null);
  const decisionRef = useRef<HTMLSelectElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const next = snapshot?.review.status;
    if (next) setStatus(visibleReviewStatus(next));
  }, [snapshot?.review.status]);

  useEffect(() => {
    setReviewer(snapshot?.review.reviewer || "");
  }, [snapshot?.review.reviewer]);

  useEffect(() => {
    setNotesPresent(Boolean(snapshot?.review.notesPresent));
  }, [snapshot?.review.notesPresent]);

  const reviewerAttentionRequired = Boolean(snapshot?.review.reviewerAttentionRequired && !reviewer.trim());
  const decisionAttentionRequired = Boolean(snapshot?.review.decisionAttentionRequired);
  const notesAttentionRequired = Boolean(snapshot?.review.notesAttentionRequired && !notesPresent);
  const reviewSaveNotice = Boolean(snapshot && REVIEW_SAVE_NOTICE_REASONS.has(snapshot.reason));

  useEffect(() => {
    if (!reviewSaveNotice) return;
    const target = reviewerAttentionRequired
      ? reviewerRef.current
      : decisionAttentionRequired
        ? decisionRef.current
        : notesAttentionRequired
          ? notesRef.current
          : null;
    if (!target) return;
    target.classList.remove("workflow-review-attention");
    void target.offsetWidth;
    target.classList.add("workflow-review-attention");
  }, [
    decisionAttentionRequired,
    notesAttentionRequired,
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
      <div>
        <Label htmlFor="reviewerName">审阅人</Label>
        <Input
          ref={reviewerRef}
          id="reviewerName"
          placeholder="请输入审阅人"
          value={reviewer}
          onChange={(event) => setReviewer(event.currentTarget.value)}
          className={reviewerAttentionRequired ? "workflow-review-attention" : undefined}
          aria-invalid={reviewerAttentionRequired}
          aria-describedby={reviewerAttentionRequired ? "reviewSaveFeedback" : undefined}
        />
      </div>
      <Select
        ref={decisionRef}
        id="reviewDecision"
        value={status}
        className={decisionAttentionRequired ? "workflow-review-attention" : undefined}
        aria-invalid={decisionAttentionRequired}
        aria-describedby={decisionAttentionRequired ? "reviewSaveFeedback" : undefined}
        onChange={(event) => {
          setStatus(event.currentTarget.value);
          commands.review("review_state_changed");
        }}
      >
        <option value="pending_clinician_confirmation">待医生确认</option>
        <option value="approved_for_discussion">确认候选草案</option>
      </Select>
      <Textarea
        ref={notesRef}
        id="reviewNotes"
        placeholder="普通待确认可留空；红色阻断或高风险确认必须填写"
        className={notesAttentionRequired ? "workflow-review-attention" : undefined}
        aria-invalid={notesAttentionRequired}
        aria-describedby={notesAttentionRequired ? "reviewSaveFeedback" : undefined}
        onInput={(event) => setNotesPresent(Boolean(event.currentTarget.value.trim()))}
      />
      <Button
        variant="workbenchPrimary"
        id="saveReviewBtn"
        type="button"
        aria-describedby={reviewSaveNotice ? "reviewSaveFeedback" : undefined}
        onClick={() => commands.review("save_review")}
      >
        保存所选审阅状态
      </Button>
      <WorkbenchNote
        id="reviewSaveFeedback"
        className="workflow-review-feedback"
        visible={reviewSaveNotice}
        role="alert"
        aria-live="assertive"
      >
        {snapshot?.stageStatus || "当前状态未保存，请检查候选和审阅资料。"}
      </WorkbenchNote>
      <WorkbenchNote>“已确认研究候选”只表示已完成本次研究审阅，不是手术指令。候选形状一旦调整，状态会自动回到“待医生确认”。视野受限或比例不标准的结果只能保存为待确认记录，不能直接显示到实时画面。</WorkbenchNote>
    </WorkbenchCard>
  );
}
